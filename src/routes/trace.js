'use strict';

const express = require('express');
const store = require('../data/store');
const trace = require('../utils/trace');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();

router.use(authRequired);

router.get('/batches', (req, res) => {
  const { batchType, status } = req.query;
  return sendData(res, 200, store.listTraceBatches({ batchType, status }));
});

router.get('/batches/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const batch = store.getTraceBatchById(id);
    if (!batch) return sendError(res, 404, '溯源批次不存在');
    const childEdges = store.listEdgesFromBatch(id);
    const parentEdges = store.listEdgesToBatch(id);
    const credential = store.getCredentialByBatchId(id);
    return sendData(res, 200, { batch, parentEdges, childEdges, credential });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.post('/batches', requireRole('admin', 'operator'), (req, res) => {
  const { batchNo, batchType, quantityKg } = req.body || {};
  if (!batchNo || !batchType || quantityKg === undefined) {
    return sendError(res, 400, '批次号、批次类型、数量不能为空');
  }
  if (!['raw', 'intermediate', 'finished'].includes(batchType)) {
    return sendError(res, 400, '批次类型必须为 raw/intermediate/finished');
  }
  if (store.getTraceBatchByBatchNo(batchNo)) {
    return sendError(res, 409, '溯源批次号已存在');
  }
  if (batchType === 'raw' && req.body.harvestId) {
    if (!store.getHarvestByBatchNo && !store.getTraceBatchByHarvestId(req.body.harvestId)) {
      return sendError(res, 400, '关联的采收记录不存在');
    }
  }
  const batch = store.createTraceBatch(req.body);
  const credential = trace.issueCredential(batch.id);
  return sendData(res, 201, { batch, credential });
});

router.post('/batches/:id/split', requireRole('admin', 'operator'), (req, res) => {
  try {
    const parentId = parseId(req.params.id);
    const parent = store.getTraceBatchById(parentId);
    if (!parent) return sendError(res, 404, '源批次不存在');

    const { children } = req.body || {};
    if (!Array.isArray(children) || children.length === 0) {
      return sendError(res, 400, '拆分子批次列表不能为空');
    }

    const totalChildQty = children.reduce((s, c) => s + (c.quantityKg || 0), 0);
    const totalLoss = children.reduce((s, c) => s + (c.lossKg || 0), 0);
    if (totalChildQty + totalLoss > parent.quantityKg + 0.001) {
      return sendError(res, 400, `拆分总量 ${totalChildQty.toFixed(3)}kg + 损耗 ${totalLoss.toFixed(3)}kg 超过源批次量 ${parent.quantityKg.toFixed(3)}kg`);
    }

    const results = [];
    for (const child of children) {
      if (!child.batchNo || child.quantityKg === undefined) {
        return sendError(res, 400, '每个子批次需要 batchNo 和 quantityKg');
      }
      if (store.getTraceBatchByBatchNo(child.batchNo)) {
        return sendError(res, 409, `批次号 ${child.batchNo} 已存在`);
      }
      const childBatch = store.createTraceBatch({
        batchNo: child.batchNo,
        batchType: child.batchType || 'intermediate',
        quantityKg: child.quantityKg,
        product: child.product || parent.product,
        note: child.note || `由 ${parent.batchNo} 拆分`,
      });
      store.createTraceEdge({
        transferType: 'split',
        fromBatchId: parentId,
        toBatchId: childBatch.id,
        quantityKg: child.quantityKg,
        lossKg: child.lossKg || 0,
        note: child.edgeNote || '',
      });
      const cred = trace.issueCredential(childBatch.id);
      results.push({ batch: childBatch, credential: cred });
    }
    return sendData(res, 201, { parent, children: results });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.post('/batches/merge', requireRole('admin', 'operator'), (req, res) => {
  const { target, sources } = req.body || {};
  if (!target || !target.batchNo || target.quantityKg === undefined) {
    return sendError(res, 400, '目标批次信息不完整');
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    return sendError(res, 400, '来源批次列表不能为空');
  }
  if (store.getTraceBatchByBatchNo(target.batchNo)) {
    return sendError(res, 409, '目标批次号已存在');
  }

  const sourceBatchIds = [];
  for (const src of sources) {
    if (!src.batchId || src.quantityKg === undefined) {
      return sendError(res, 400, '每个来源需要 batchId 和 quantityKg');
    }
    const srcBatch = store.getTraceBatchById(src.batchId);
    if (!srcBatch) return sendError(res, 400, `来源批次 ${src.batchId} 不存在`);
    sourceBatchIds.push({ batch: srcBatch, quantityKg: src.quantityKg, lossKg: src.lossKg || 0 });
  }

  const totalInput = sourceBatchIds.reduce((s, x) => s + x.quantityKg, 0);
  const totalLoss = sourceBatchIds.reduce((s, x) => s + x.lossKg, 0);
  if (target.quantityKg > totalInput + 0.001) {
    return sendError(res, 400, `合并目标量 ${target.quantityKg.toFixed(3)}kg 超过投入总量 ${totalInput.toFixed(3)}kg`);
  }
  if (totalInput - totalLoss < target.quantityKg - 0.001) {
    return sendError(res, 400, `合并数量不守恒：投入 ${totalInput.toFixed(3)}kg - 损耗 ${totalLoss.toFixed(3)}kg < 目标 ${target.quantityKg.toFixed(3)}kg`);
  }

  const targetBatch = store.createTraceBatch({
    batchNo: target.batchNo,
    batchType: target.batchType || 'intermediate',
    quantityKg: target.quantityKg,
    product: target.product || sourceBatchIds[0].batch.product,
    note: target.note || '合并批次',
  });

  const edges = [];
  for (const src of sourceBatchIds) {
    const edge = store.createTraceEdge({
      transferType: 'merge',
      fromBatchId: src.batch.id,
      toBatchId: targetBatch.id,
      quantityKg: src.quantityKg,
      lossKg: src.lossKg,
      note: src.note || '',
    });
    edges.push(edge);
  }

  const credential = trace.issueCredential(targetBatch.id);
  return sendData(res, 201, { target: { batch: targetBatch, credential }, edges });
});

router.post('/batches/:id/bottle', requireRole('admin', 'operator'), (req, res) => {
  try {
    const sourceId = parseId(req.params.id);
    const source = store.getTraceBatchById(sourceId);
    if (!source) return sendError(res, 404, '源批次不存在');

    const { batchNo, quantityKg, lossKg, note } = req.body || {};
    if (!batchNo || quantityKg === undefined) {
      return sendError(res, 400, '灌装批次号和数量不能为空');
    }
    if (store.getTraceBatchByBatchNo(batchNo)) {
      return sendError(res, 409, '灌装批次号已存在');
    }
    const lkg = lossKg || 0;
    if (quantityKg + lkg > source.quantityKg + 0.001) {
      return sendError(res, 400, '灌装量 + 损耗超过源批次量');
    }

    const finished = store.createTraceBatch({
      batchNo,
      batchType: 'finished',
      quantityKg,
      product: req.body.product || source.product,
      status: 'warehoused',
      note: note || `由 ${source.batchNo} 灌装`,
    });
    store.createTraceEdge({
      transferType: 'bottle',
      fromBatchId: sourceId,
      toBatchId: finished.id,
      quantityKg,
      lossKg: lkg,
      note: '',
    });
    const credential = trace.issueCredential(finished.id);
    return sendData(res, 201, { batch: finished, credential });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.post('/harvest-hives', requireRole('admin', 'operator'), (req, res) => {
  const { harvestId, hiveId, quantityKg } = req.body || {};
  if (harvestId === undefined || hiveId === undefined || quantityKg === undefined) {
    return sendError(res, 400, '采收ID、蜂群ID、数量不能为空');
  }
  const link = store.createHarvestHive({ harvestId, hiveId, quantityKg });
  return sendData(res, 201, link);
});

router.get('/harvest-hives/harvest/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    return sendData(res, 200, store.listHarvestHivesByHarvest(id));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/harvest-hives/hive/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    return sendData(res, 200, store.listHarvestHivesByHive(id));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/forward/:hiveId', (req, res) => {
  try {
    const hiveId = parseId(req.params.hiveId);
    const hive = store.getHiveById(hiveId);
    if (!hive) return sendError(res, 404, '蜂群不存在');
    const result = trace.forwardTrack(hiveId);
    return sendData(res, 200, result);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/reverse/:batchId', (req, res) => {
  try {
    const batchId = parseId(req.params.batchId);
    const batch = store.getTraceBatchById(batchId);
    if (!batch) return sendError(res, 404, '批次不存在');
    const result = trace.reverseTrack(batchId);
    return sendData(res, 200, result);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/verify/:batchId', (req, res) => {
  try {
    const batchId = parseId(req.params.batchId);
    const batch = store.getTraceBatchById(batchId);
    if (!batch) return sendError(res, 404, '批次不存在');
    const singleResult = trace.verifySingleBatch(batchId);
    const chainResult = trace.verifyChain(batchId);
    return sendData(res, 200, { batch: { id: batch.id, batchNo: batch.batchNo }, single: singleResult, chain: chainResult });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/conservation/:batchId', (req, res) => {
  try {
    const batchId = parseId(req.params.batchId);
    const batch = store.getTraceBatchById(batchId);
    if (!batch) return sendError(res, 404, '批次不存在');
    const result = trace.checkQuantityConservation(batchId);
    return sendData(res, 200, { batch: { id: batch.id, batchNo: batch.batchNo }, ...result });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.get('/conservation', (req, res) => {
  const result = trace.checkAllConservation();
  return sendData(res, 200, result);
});

module.exports = router;
