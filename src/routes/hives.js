'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();

router.use(authRequired);

/** GET /api/hives —— 蜂箱列表，支持 apiaryId / status / keyword 过滤。 */
router.get('/', (req, res) => {
  const { apiaryId, status, keyword } = req.query;
  const filter = { status, keyword };
  if (apiaryId !== undefined) filter.apiaryId = Number(apiaryId);
  return sendData(res, 200, store.listHives(filter));
});

/** GET /api/hives/:id —— 蜂箱详情。 */
router.get('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const hive = store.getHiveById(id);
    if (!hive) return sendError(res, 404, '蜂箱不存在');
    return sendData(res, 200, hive);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

/** GET /api/hives/:id/inspections —— 某蜂箱的检查记录。 */
router.get('/:id/inspections', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getHiveById(id)) return sendError(res, 404, '蜂箱不存在');
    return sendData(res, 200, store.listInspections({ hiveId: id }));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

/** POST /api/hives/:id/inspections —— 为某蜂箱登记一条检查记录。 */
router.post('/:id/inspections', requireRole('admin', 'operator'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getHiveById(id)) return sendError(res, 404, '蜂箱不存在');
    const { inspectDate } = req.body || {};
    if (!inspectDate) return sendError(res, 400, '检查日期不能为空');
    const rec = store.createInspection({ ...req.body, hiveId: id, inspectorId: req.user.id });
    return sendData(res, 201, rec);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.post('/', requireRole('admin', 'operator'), (req, res) => {
  const { code, apiaryId } = req.body || {};
  if (!code || apiaryId === undefined) return sendError(res, 400, '编号和所属蜂场不能为空');
  if (!store.getApiaryById(Number(apiaryId))) return sendError(res, 400, '所属蜂场不存在');
  if (store.getHiveByCode(code)) return sendError(res, 409, '蜂箱编号已存在');
  return sendData(res, 201, store.createHive({ ...req.body, apiaryId: Number(apiaryId) }));
});

router.put('/:id', requireRole('admin', 'operator'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getHiveById(id)) return sendError(res, 404, '蜂箱不存在');
    return sendData(res, 200, store.updateHive(id, req.body || {}));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getHiveById(id)) return sendError(res, 404, '蜂箱不存在');
    store.deleteHive(id);
    return sendData(res, 200, { id });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

module.exports = router;
