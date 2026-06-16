'use strict';

// 测试使用内存库，必须在 require 任何用到 db 的模块之前设置。
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { getDb, resetAll } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

const app = createApp();

function beforeEachReset() {
  getDb();
  resetAll();
  seed();
}

async function loginAs(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  assert.strictEqual(res.status, 200, `登录失败: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

test('健康检查无需鉴权', async () => {
  beforeEachReset();
  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('登录：正确账号密码返回 token 和用户信息', async () => {
  beforeEachReset();
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.token);
  assert.strictEqual(res.body.data.user.role, 'admin');
  assert.strictEqual(res.body.data.user.name, '系统管理员'); // 中文不乱码
});

test('登录：错误密码被拒', async () => {
  beforeEachReset();
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
  assert.strictEqual(res.status, 401);
});

test('未带令牌访问受保护接口返回 401', async () => {
  beforeEachReset();
  const res = await request(app).get('/api/apiaries');
  assert.strictEqual(res.status, 401);
});

test('GET /api/auth/me 返回当前用户', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.username, 'keeper');
});

test('蜂场列表能读到种子数据，中文字段正确', async () => {
  beforeEachReset();
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/apiaries').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.length, 3);
  const names = res.body.data.map((a) => a.name);
  assert.ok(names.includes('阿坝高山中蜂场'), '中文蜂场名应正确返回');
});

test('operator 可新建蜂场并能再查到（含中文）', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const create = await request(app)
    .post('/api/apiaries')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'FC-GZ-009', name: '甘孜高原中蜂示范场', location: '甘孜州康定折多山', district: '甘孜州', keeper: '王养蜂' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  const id = create.body.data.id;
  const get = await request(app).get(`/api/apiaries/${id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(get.status, 200);
  assert.strictEqual(get.body.data.name, '甘孜高原中蜂示范场');
  assert.strictEqual(get.body.data.district, '甘孜州');
});

test('viewer 无权新建蜂场（403）', async () => {
  beforeEachReset();
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app)
    .post('/api/apiaries')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'FC-X-001', name: '测试', location: '某地', district: '某州' });
  assert.strictEqual(res.status, 403);
});

test('蜂场编号重复返回 409', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const res = await request(app)
    .post('/api/apiaries')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'FC-ABA-001', name: '重复编号', location: '某地', district: '某州' });
  assert.strictEqual(res.status, 409);
});

test('蜂箱：列出某蜂场的蜂箱、新建蜂箱', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const apiaries = (await request(app).get('/api/apiaries').set('Authorization', `Bearer ${token}`)).body.data;
  const a1 = apiaries.find((a) => a.code === 'FC-ABA-001');
  const list = await request(app).get(`/api/apiaries/${a1.id}/hives`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.data.length, 3);

  const create = await request(app)
    .post('/api/hives')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'XF-099', apiaryId: a1.id, queenYear: 2026, frameCount: 5, strength: 'medium' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  assert.strictEqual(create.body.data.apiaryId, a1.id);
});

test('检查记录：为蜂箱登记并按蜂箱查询', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const hives = (await request(app).get('/api/hives').set('Authorization', `Bearer ${token}`)).body.data;
  const hive = hives[0];
  const create = await request(app)
    .post(`/api/hives/${hive.id}/inspections`)
    .set('Authorization', `Bearer ${token}`)
    .send({ inspectDate: '2026-06-01', hasQueen: true, broodFrames: 4, honeyFrames: 2, disease: 'none', note: '群势良好' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  assert.strictEqual(create.body.data.note, '群势良好');

  const list = await request(app).get(`/api/hives/${hive.id}/inspections`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.length >= 1);
});

test('采收批次：登记并按蜂场过滤', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const apiaries = (await request(app).get('/api/apiaries').set('Authorization', `Bearer ${token}`)).body.data;
  const a1 = apiaries.find((a) => a.code === 'FC-ABA-001');
  const create = await request(app)
    .post('/api/harvests')
    .set('Authorization', `Bearer ${token}`)
    .send({ batchNo: 'HV-2026-9999', apiaryId: a1.id, harvestDate: '2026-06-10', product: 'honey', quantityKg: 12.3, note: '夏蜜' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  const list = await request(app).get(`/api/harvests?apiaryId=${a1.id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.some((h) => h.batchNo === 'HV-2026-9999'));
});

test('删除蜂场需要 admin，operator 删除被拒 403', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const apiaries = (await request(app).get('/api/apiaries').set('Authorization', `Bearer ${token}`)).body.data;
  const res = await request(app).delete(`/api/apiaries/${apiaries[0].id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 403);
});

test('不存在的接口返回 404', async () => {
  beforeEachReset();
  const res = await request(app).get('/api/not-exist');
  assert.strictEqual(res.status, 404);
});

test('溯源批次列表能读到种子数据', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const res = await request(app).get('/api/trace/batches').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.length >= 6, `应有 6+ 批次，实际 ${res.body.data.length}`);
  const raws = res.body.data.filter((b) => b.batchType === 'raw');
  assert.strictEqual(raws.length, 2);
  const finished = res.body.data.filter((b) => b.batchType === 'finished');
  assert.strictEqual(finished.length, 2);
});

test('溯源批次详情含边和凭据', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=raw').set('Authorization', `Bearer ${token}`);
  const rawId = list.body.data[0].id;
  const detail = await request(app).get(`/api/trace/batches/${rawId}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(detail.status, 200);
  assert.ok(detail.body.data.credential, '应有凭据');
  assert.ok(detail.body.data.credential.credentialHash, '凭据应有哈希');
  assert.ok(Array.isArray(detail.body.data.childEdges), '应有子边');
});

test('新建溯源批次并自动生成凭据', async () => {
  beforeEachReset();
  const token = await loginAs('keeper', 'keeper123');
  const harvests = (await request(app).get('/api/harvests').set('Authorization', `Bearer ${token}`)).body.data;
  const hv = harvests[0];
  const res = await request(app)
    .post('/api/trace/batches')
    .set('Authorization', `Bearer ${token}`)
    .send({ batchNo: 'TB-TEST-001', batchType: 'raw', quantityKg: 10, product: 'honey', harvestId: hv.id, apiaryId: hv.apiaryId });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.data.batch);
  assert.ok(res.body.data.credential);
  assert.ok(res.body.data.credential.credentialHash);
});

test('批次拆分：创建子批次和边，数量守恒', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=raw').set('Authorization', `Bearer ${token}`);
  const rawId = list.body.data[0].id;
  const res = await request(app)
    .post(`/api/trace/batches/${rawId}/split`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      children: [
        { batchNo: 'TB-SPLIT-A', quantityKg: 5, batchType: 'intermediate' },
        { batchNo: 'TB-SPLIT-B', quantityKg: 3, lossKg: 0.5, batchType: 'intermediate', note: '滤渣' },
      ],
    });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.children.length, 2);
  assert.strictEqual(res.body.data.children[0].batch.quantityKg, 5);
  assert.strictEqual(res.body.data.children[1].batch.quantityKg, 3);
  assert.ok(res.body.data.children[0].credential.credentialHash);
});

test('批次拆分：数量超出源批次返回 400', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=raw').set('Authorization', `Bearer ${token}`);
  const rawId = list.body.data[0].id;
  const res = await request(app)
    .post(`/api/trace/batches/${rawId}/split`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      children: [
        { batchNo: 'TB-SPLIT-TOO-MUCH', quantityKg: 999, batchType: 'intermediate' },
      ],
    });
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.message.includes('超过'));
});

test('批次合并：多来源合并成一个', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=intermediate').set('Authorization', `Bearer ${token}`);
  const mids = list.body.data;
  assert.ok(mids.length >= 2, `需要至少 2 个中间批次，实际 ${mids.length}`);
  const res = await request(app)
    .post('/api/trace/batches/merge')
    .set('Authorization', `Bearer ${token}`)
    .send({
      target: { batchNo: 'TB-MERGE-001', quantityKg: 5, product: 'honey' },
      sources: [
        { batchId: mids[0].id, quantityKg: 3 },
        { batchId: mids[1].id, quantityKg: 2.1, lossKg: 0.1 },
      ],
    });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.target.batch.quantityKg, 5);
  assert.strictEqual(res.body.data.edges.length, 2);
  assert.ok(res.body.data.target.credential.credentialHash);
});

test('批次合并：目标量超过投入返回 400', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=intermediate').set('Authorization', `Bearer ${token}`);
  const mids = list.body.data;
  const res = await request(app)
    .post('/api/trace/batches/merge')
    .set('Authorization', `Bearer ${token}`)
    .send({
      target: { batchNo: 'TB-MERGE-BAD', quantityKg: 999 },
      sources: [
        { batchId: mids[0].id, quantityKg: 1 },
      ],
    });
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.message.includes('超过'));
});

test('灌装：中间批次灌装为成品', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=intermediate').set('Authorization', `Bearer ${token}`);
  const midId = list.body.data[0].id;
  const res = await request(app)
    .post(`/api/trace/batches/${midId}/bottle`)
    .set('Authorization', `Bearer ${token}`)
    .send({ batchNo: 'TB-BOTTLE-001', quantityKg: 2, lossKg: 0.05, product: 'honey' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.batch.batchType, 'finished');
  assert.strictEqual(res.body.data.batch.status, 'warehoused');
  assert.ok(res.body.data.credential.credentialHash);
});

test('采收-蜂群关联：创建并查询', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const harvests = (await request(app).get('/api/harvests').set('Authorization', `Bearer ${token}`)).body.data;
  const hives = (await request(app).get('/api/hives').set('Authorization', `Bearer ${token}`)).body.data;
  const res = await request(app)
    .post('/api/trace/harvest-hives')
    .set('Authorization', `Bearer ${token}`)
    .send({ harvestId: harvests[0].id, hiveId: hives[0].id, quantityKg: 8.5 });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.quantityKg, 8.5);

  const byHarvest = await request(app).get(`/api/trace/harvest-hives/harvest/${harvests[0].id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(byHarvest.status, 200);
  assert.ok(byHarvest.body.data.length >= 1);
});

test('正向追踪：从蜂群追踪到成品批次', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const hives = (await request(app).get('/api/hives').set('Authorization', `Bearer ${token}`)).body.data;
  const target = hives.find((h) => h.code === 'XF-001');
  assert.ok(target, '应找到 XF-001 蜂群');
  const res = await request(app).get(`/api/trace/forward/${target.id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.rawBatches.length >= 1, '应有原始批次');
  assert.ok(res.body.data.finishedBatches.length >= 1, '应有成品批次');
});

test('逆向溯源：从成品批次倒查到蜂群和检查记录', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=finished').set('Authorization', `Bearer ${token}`);
  const finId = list.body.data[0].id;
  const res = await request(app).get(`/api/trace/reverse/${finId}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.rawBatches.length >= 1, '应有原始批次');
  assert.ok(res.body.data.hives.length >= 1, '应有蜂群');
  assert.ok(res.body.data.inspections.length >= 1, '应有检查记录');
  assert.ok(res.body.data.apiaries.length >= 1, '应有蜂场');
});

test('哈希链完整性校验：种子数据全部通过', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=raw').set('Authorization', `Bearer ${token}`);
  const rawId = list.body.data[0].id;
  const res = await request(app).get(`/api/trace/verify/${rawId}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.single.valid, true, `单批校验应通过: ${JSON.stringify(res.body.data.single)}`);
  assert.strictEqual(res.body.data.chain.valid, true, `链校验应通过: ${JSON.stringify(res.body.data.chain)}`);
});

test('数量守恒校验：种子数据全部通过', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const res = await request(app).get('/api/trace/conservation').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.ok, true, `全局守恒应通过: ${JSON.stringify(res.body.data.violations)}`);
});

test('单个批次数守恒校验', async () => {
  beforeEachReset();
  const token = await loginAs('admin', 'admin123');
  const list = await request(app).get('/api/trace/batches?batchType=raw').set('Authorization', `Bearer ${token}`);
  const rawId = list.body.data[0].id;
  const res = await request(app).get(`/api/trace/conservation/${rawId}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.ok, true);
});
