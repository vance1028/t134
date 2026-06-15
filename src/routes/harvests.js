'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError } = require('../utils/http');

const router = express.Router();

router.use(authRequired);

/** GET /api/harvests —— 采收批次列表，支持 apiaryId / product 过滤。 */
router.get('/', (req, res) => {
  const { apiaryId, product } = req.query;
  const filter = { product };
  if (apiaryId !== undefined) filter.apiaryId = Number(apiaryId);
  return sendData(res, 200, store.listHarvests(filter));
});

/** POST /api/harvests —— 登记一条采收批次。 */
router.post('/', requireRole('admin', 'operator'), (req, res) => {
  const { batchNo, apiaryId, harvestDate } = req.body || {};
  if (!batchNo || apiaryId === undefined || !harvestDate) {
    return sendError(res, 400, '批次号、所属蜂场、采收日期不能为空');
  }
  if (!store.getApiaryById(Number(apiaryId))) return sendError(res, 400, '所属蜂场不存在');
  if (store.getHarvestByBatchNo(batchNo)) return sendError(res, 409, '批次号已存在');
  return sendData(res, 201, store.createHarvest({ ...req.body, apiaryId: Number(apiaryId) }));
});

module.exports = router;
