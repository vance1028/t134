'use strict';

const { getDb } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：SQL 集中在这里，路由层只调用方法。
 * 对外统一返回 camelCase 字段对象。
 */

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role,
    active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapApiary(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, name: r.name, location: r.location,
    district: r.district, keeper: r.keeper, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapHive(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, apiaryId: r.apiary_id, queenYear: r.queen_year,
    frameCount: r.frame_count, strength: r.strength, status: r.status,
    installedAt: r.installed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapInspection(r) {
  if (!r) return null;
  return {
    id: r.id, hiveId: r.hive_id, inspectorId: r.inspector_id, inspectDate: r.inspect_date,
    hasQueen: !!r.has_queen, broodFrames: r.brood_frames, honeyFrames: r.honey_frames,
    disease: r.disease, note: r.note, createdAt: r.created_at,
  };
}

function mapHarvest(r) {
  if (!r) return null;
  return {
    id: r.id, batchNo: r.batch_no, apiaryId: r.apiary_id, harvestDate: r.harvest_date,
    product: r.product, quantityKg: r.quantity_kg, note: r.note, createdAt: r.created_at,
  };
}

/* ----------------------------- 用户 ----------------------------- */

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function getUserById(id) {
  return mapUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}
function listUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY id ASC').all().map(mapUser);
}
function createUser({ username, password, name, role = 'viewer', active = true }) {
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, name, role, active) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword(password), name, role, active ? 1 : 0);
  return getUserById(info.lastInsertRowid);
}
function updateUser(id, fields) {
  const sets = [];
  const params = [];
  if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
  if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role); }
  if (fields.active !== undefined) { sets.push('active = ?'); params.push(fields.active ? 1 : 0); }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length === 0) return getUserById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getUserById(id);
}
function deleteUser(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}
function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/* ----------------------------- 蜂场 ----------------------------- */

function listApiaries({ district, status, keyword } = {}) {
  const where = [];
  const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(code LIKE ? OR name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM apiaries ${clause} ORDER BY id DESC`).all(...params).map(mapApiary);
}
function getApiaryById(id) {
  return mapApiary(getDb().prepare('SELECT * FROM apiaries WHERE id = ?').get(id));
}
function getApiaryByCode(code) {
  return mapApiary(getDb().prepare('SELECT * FROM apiaries WHERE code = ?').get(code));
}
function createApiary(d) {
  const info = getDb()
    .prepare(`INSERT INTO apiaries (code, name, location, district, keeper, status)
              VALUES (@code, @name, @location, @district, @keeper, @status)`)
    .run({
      code: d.code, name: d.name, location: d.location, district: d.district,
      keeper: d.keeper ?? '', status: d.status || 'active',
    });
  return getApiaryById(info.lastInsertRowid);
}
function updateApiary(id, d) {
  const allowed = { name: 'name', location: 'location', district: 'district', keeper: 'keeper', status: 'status' };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length === 0) return getApiaryById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE apiaries SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getApiaryById(id);
}
function deleteApiary(id) {
  return getDb().prepare('DELETE FROM apiaries WHERE id = ?').run(id).changes > 0;
}

/* ----------------------------- 蜂箱/蜂群 ----------------------------- */

function listHives({ apiaryId, status, keyword } = {}) {
  const where = [];
  const params = [];
  if (apiaryId !== undefined) { where.push('apiary_id = ?'); params.push(apiaryId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('code LIKE ?'); params.push(`%${keyword}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM hives ${clause} ORDER BY id DESC`).all(...params).map(mapHive);
}
function getHiveById(id) {
  return mapHive(getDb().prepare('SELECT * FROM hives WHERE id = ?').get(id));
}
function getHiveByCode(code) {
  return mapHive(getDb().prepare('SELECT * FROM hives WHERE code = ?').get(code));
}
function createHive(d) {
  const info = getDb()
    .prepare(`INSERT INTO hives (code, apiary_id, queen_year, frame_count, strength, status, installed_at)
              VALUES (@code, @apiaryId, @queenYear, @frameCount, @strength, @status, @installedAt)`)
    .run({
      code: d.code, apiaryId: d.apiaryId, queenYear: d.queenYear ?? null,
      frameCount: d.frameCount ?? 0, strength: d.strength || 'medium',
      status: d.status || 'active', installedAt: d.installedAt ?? null,
    });
  return getHiveById(info.lastInsertRowid);
}
function updateHive(id, d) {
  const allowed = {
    queenYear: 'queen_year', frameCount: 'frame_count', strength: 'strength',
    status: 'status', installedAt: 'installed_at',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length === 0) return getHiveById(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE hives SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getHiveById(id);
}
function deleteHive(id) {
  return getDb().prepare('DELETE FROM hives WHERE id = ?').run(id).changes > 0;
}

/* ----------------------------- 检查记录 ----------------------------- */

function listInspections({ hiveId } = {}) {
  if (hiveId !== undefined) {
    return getDb()
      .prepare('SELECT * FROM inspections WHERE hive_id = ? ORDER BY inspect_date DESC, id DESC')
      .all(hiveId).map(mapInspection);
  }
  return getDb().prepare('SELECT * FROM inspections ORDER BY inspect_date DESC, id DESC').all().map(mapInspection);
}
function createInspection(d) {
  const info = getDb()
    .prepare(`INSERT INTO inspections (hive_id, inspector_id, inspect_date, has_queen, brood_frames, honey_frames, disease, note)
              VALUES (@hiveId, @inspectorId, @inspectDate, @hasQueen, @broodFrames, @honeyFrames, @disease, @note)`)
    .run({
      hiveId: d.hiveId, inspectorId: d.inspectorId ?? null, inspectDate: d.inspectDate,
      hasQueen: d.hasQueen === false ? 0 : 1, broodFrames: d.broodFrames ?? 0,
      honeyFrames: d.honeyFrames ?? 0, disease: d.disease || 'none', note: d.note ?? '',
    });
  return mapInspection(getDb().prepare('SELECT * FROM inspections WHERE id = ?').get(info.lastInsertRowid));
}

/* ----------------------------- 采收批次 ----------------------------- */

function listHarvests({ apiaryId, product } = {}) {
  const where = [];
  const params = [];
  if (apiaryId !== undefined) { where.push('apiary_id = ?'); params.push(apiaryId); }
  if (product) { where.push('product = ?'); params.push(product); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM harvests ${clause} ORDER BY harvest_date DESC, id DESC`).all(...params).map(mapHarvest);
}
function getHarvestByBatchNo(batchNo) {
  return mapHarvest(getDb().prepare('SELECT * FROM harvests WHERE batch_no = ?').get(batchNo));
}
function createHarvest(d) {
  const info = getDb()
    .prepare(`INSERT INTO harvests (batch_no, apiary_id, harvest_date, product, quantity_kg, note)
              VALUES (@batchNo, @apiaryId, @harvestDate, @product, @quantityKg, @note)`)
    .run({
      batchNo: d.batchNo, apiaryId: d.apiaryId, harvestDate: d.harvestDate,
      product: d.product || 'honey', quantityKg: d.quantityKg ?? 0, note: d.note ?? '',
    });
  return mapHarvest(getDb().prepare('SELECT * FROM harvests WHERE id = ?').get(info.lastInsertRowid));
}

module.exports = {
  mapUser, mapApiary, mapHive, mapInspection, mapHarvest,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listApiaries, getApiaryById, getApiaryByCode, createApiary, updateApiary, deleteApiary,
  listHives, getHiveById, getHiveByCode, createHive, updateHive, deleteHive,
  listInspections, createInspection,
  listHarvests, getHarvestByBatchNo, createHarvest,
};
