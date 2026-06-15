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
