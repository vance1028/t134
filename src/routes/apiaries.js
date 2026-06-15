'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();

router.use(authRequired);

/** GET /api/apiaries —— 蜂场列表，支持 district / status / keyword 过滤。 */
router.get('/', (req, res) => {
  const { district, status, keyword } = req.query;
  return sendData(res, 200, store.listApiaries({ district, status, keyword }));
});

/** GET /api/apiaries/:id —— 蜂场详情。 */
router.get('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const apiary = store.getApiaryById(id);
    if (!apiary) return sendError(res, 404, '蜂场不存在');
    return sendData(res, 200, apiary);
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

/** GET /api/apiaries/:id/hives —— 某蜂场的蜂箱列表。 */
router.get('/:id/hives', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getApiaryById(id)) return sendError(res, 404, '蜂场不存在');
    return sendData(res, 200, store.listHives({ apiaryId: id }));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.post('/', requireRole('admin', 'operator'), (req, res) => {
  const { code, name, location, district } = req.body || {};
  if (!code || !name || !location || !district) {
    return sendError(res, 400, '编号、名称、地点、区域不能为空');
  }
  if (store.getApiaryByCode(code)) return sendError(res, 409, '蜂场编号已存在');
  return sendData(res, 201, store.createApiary(req.body));
});

router.put('/:id', requireRole('admin', 'operator'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getApiaryById(id)) return sendError(res, 404, '蜂场不存在');
    return sendData(res, 200, store.updateApiary(id, req.body || {}));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getApiaryById(id)) return sendError(res, 404, '蜂场不存在');
    store.deleteApiary(id);
    return sendData(res, 200, { id });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

module.exports = router;
