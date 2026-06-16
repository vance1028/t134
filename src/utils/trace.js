'use strict';

const crypto = require('crypto');
const store = require('../data/store');

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function computeCredentialHash(batch, parentHashes) {
  const payload = {
    batchNo: batch.batchNo,
    batchType: batch.batchType,
    quantityKg: batch.quantityKg,
    product: batch.product,
    status: batch.status,
    createdAt: batch.createdAt,
  };
  const sorted = JSON.stringify({ payload, parentHashes: parentHashes.slice().sort() });
  return sha256(sorted);
}

function issueCredential(batchId) {
  const batch = store.getTraceBatchById(batchId);
  if (!batch) throw new Error('批次不存在');
  const parentEdges = store.listEdgesToBatch(batchId);
  const parentHashes = parentEdges.map((e) => {
    const cred = store.getCredentialByBatchId(e.fromBatchId);
    return cred ? cred.credentialHash : '';
  });
  const credentialHash = computeCredentialHash(batch, parentHashes);
  const payload = {
    batchNo: batch.batchNo,
    batchType: batch.batchType,
    quantityKg: batch.quantityKg,
    product: batch.product,
    status: batch.status,
    createdAt: batch.createdAt,
  };
  return store.createCredential({
    batchId,
    credentialHash,
    parentHashes: JSON.stringify(parentHashes),
    payload: JSON.stringify(payload),
  });
}

function verifyChain(batchId) {
  const visited = new Set();
  const broken = [];
  const queue = [batchId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const batch = store.getTraceBatchById(currentId);
    if (!batch) { broken.push({ batchId: currentId, reason: '批次不存在' }); continue; }

    const stored = store.getCredentialByBatchId(currentId);
    if (!stored) { broken.push({ batchId: currentId, batchNo: batch.batchNo, reason: '缺少凭据' }); continue; }

    const parentEdges = store.listEdgesToBatch(currentId);
    const parentHashes = parentEdges.map((e) => {
      const c = store.getCredentialByBatchId(e.fromBatchId);
      return c ? c.credentialHash : '';
    });
    const expected = computeCredentialHash(batch, parentHashes);
    if (expected !== stored.credentialHash) {
      broken.push({ batchId: currentId, batchNo: batch.batchNo, reason: '哈希不匹配，数据可能被篡改' });
    }

    const childEdges = store.listEdgesFromBatch(currentId);
    for (const edge of childEdges) {
      queue.push(edge.toBatchId);
    }
  }

  return { valid: broken.length === 0, checked: visited.size, broken };
}

function verifySingleBatch(batchId) {
  const batch = store.getTraceBatchById(batchId);
  if (!batch) return { valid: false, reason: '批次不存在' };
  const stored = store.getCredentialByBatchId(batchId);
  if (!stored) return { valid: false, reason: '缺少凭据' };
  const parentEdges = store.listEdgesToBatch(batchId);
  const parentHashes = parentEdges.map((e) => {
    const c = store.getCredentialByBatchId(e.fromBatchId);
    return c ? c.credentialHash : '';
  });
  const expected = computeCredentialHash(batch, parentHashes);
  if (expected !== stored.credentialHash) {
    return { valid: false, reason: '哈希不匹配，数据可能被篡改', batchNo: batch.batchNo };
  }
  return { valid: true, batchNo: batch.batchNo };
}

function checkQuantityConservation(batchId) {
  const batch = store.getTraceBatchById(batchId);
  if (!batch) return { ok: false, errors: ['批次不存在'] };

  const errors = [];
  const EPS = 0.001;

  const childEdges = store.listEdgesFromBatch(batchId);
  if (childEdges.length > 0) {
    const totalOut = childEdges.reduce((s, e) => s + e.quantityKg + e.lossKg, 0);
    if (totalOut > batch.quantityKg + EPS) {
      errors.push(
        `批次 ${batch.batchNo} 数量不守恒：输出 ${totalOut.toFixed(3)}kg > 批次量 ${batch.quantityKg.toFixed(3)}kg`
      );
    }
  }

  const parentEdges = store.listEdgesToBatch(batchId);
  if (parentEdges.length > 1) {
    const totalIn = parentEdges.reduce((s, e) => s + e.quantityKg, 0);
    const totalLoss = parentEdges.reduce((s, e) => s + e.lossKg, 0);
    if (totalIn - totalLoss < batch.quantityKg - EPS) {
      errors.push(
        `合并批次 ${batch.batchNo} 数量不守恒：投入 ${totalIn.toFixed(3)}kg - 损耗 ${totalLoss.toFixed(3)}kg < 批次量 ${batch.quantityKg.toFixed(3)}kg`
      );
    }
    if (batch.quantityKg > totalIn + EPS) {
      errors.push(
        `合并批次 ${batch.batchNo} 数量异常：批次量 ${batch.quantityKg.toFixed(3)}kg > 投入总量 ${totalIn.toFixed(3)}kg，凭空多出`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function checkAllConservation() {
  const batches = store.listTraceBatches({});
  const results = [];
  for (const b of batches) {
    const check = checkQuantityConservation(b.id);
    if (!check.ok) results.push({ batchId: b.id, batchNo: b.batchNo, errors: check.errors });
  }
  return { ok: results.length === 0, violations: results };
}

function forwardTrack(hiveId) {
  const harvestHives = store.listHarvestHivesByHive(hiveId);
  const harvestIds = harvestHives.map((hh) => hh.harvestId);
  const rawBatches = [];
  const seen = new Set();
  for (const hid of harvestIds) {
    const b = store.getTraceBatchByHarvestId(hid);
    if (b && !seen.has(b.id)) { rawBatches.push(b); seen.add(b.id); }
  }

  const reachable = new Set();
  const queue = rawBatches.map((b) => b.id);
  for (const id of queue) reachable.add(id);

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const edges = store.listEdgesFromBatch(cur);
    for (const e of edges) {
      if (!reachable.has(e.toBatchId)) {
        reachable.add(e.toBatchId);
        queue.push(e.toBatchId);
      }
    }
  }

  const allBatches = store.listTraceBatches({});
  const reached = allBatches.filter((b) => reachable.has(b.id));

  const finished = reached.filter((b) => b.batchType === 'finished');
  const intermediates = reached.filter((b) => b.batchType === 'intermediate');
  const raws = reached.filter((b) => b.batchType === 'raw');

  return { hiveId, rawBatches: raws, intermediateBatches: intermediates, finishedBatches: finished };
}

function reverseTrack(batchId) {
  const batch = store.getTraceBatchById(batchId);
  if (!batch) return null;

  const visited = new Set();
  const queue = [batchId];
  const allBatchIds = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    allBatchIds.add(cur);

    const parentEdges = store.listEdgesToBatch(cur);
    for (const e of parentEdges) {
      queue.push(e.fromBatchId);
    }
  }

  const allBatches = store.listTraceBatches({});
  const reached = allBatches.filter((b) => allBatchIds.has(b.id));
  const raws = reached.filter((b) => b.batchType === 'raw');

  const hiveIds = new Set();
  const harvestLinks = [];
  for (const raw of raws) {
    if (raw.harvestId) {
      const hhs = store.listHarvestHivesByHarvest(raw.harvestId);
      for (const hh of hhs) {
        hiveIds.add(hh.hiveId);
        harvestLinks.push({ harvestId: raw.harvestId, hiveId: hh.hiveId, quantityKg: hh.quantityKg });
      }
    }
  }

  const hives = [];
  for (const hid of hiveIds) {
    const h = store.getHiveById(hid);
    if (h) hives.push(h);
  }

  const inspections = [];
  for (const hid of hiveIds) {
    const insps = store.listInspections({ hiveId: hid });
    inspections.push(...insps);
  }

  const apiaryIds = new Set();
  for (const raw of raws) {
    if (raw.apiaryId) apiaryIds.add(raw.apiaryId);
  }
  const apiaries = [];
  for (const aid of apiaryIds) {
    const a = store.getApiaryById(aid);
    if (a) apiaries.push(a);
  }

  return {
    batch,
    rawBatches: raws,
    apiaries,
    hives,
    harvestLinks,
    inspections,
    allBatches: reached,
  };
}

module.exports = {
  sha256,
  computeCredentialHash,
  issueCredential,
  verifyChain,
  verifySingleBatch,
  checkQuantityConservation,
  checkAllConservation,
  forwardTrack,
  reverseTrack,
};
