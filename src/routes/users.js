'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
const ROLES = ['admin', 'operator', 'viewer'];

router.use(authRequired, requireRole('admin'));

router.get('/', (req, res) => sendData(res, 200, store.listUsers()));

router.post('/', (req, res) => {
  const { username, password, name, role = 'viewer', active = true } = req.body || {};
  if (!username || !password || !name) return sendError(res, 400, '用户名、密码、姓名不能为空');
  if (!ROLES.includes(role)) return sendError(res, 400, '非法的角色');
  if (store.getUserByUsername(username)) return sendError(res, 409, '用户名已存在');
  return sendData(res, 201, store.createUser({ username, password, name, role, active }));
});

router.put('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!store.getUserById(id)) return sendError(res, 404, '用户不存在');
    const { role } = req.body || {};
    if (role !== undefined && !ROLES.includes(role)) return sendError(res, 400, '非法的角色');
    return sendData(res, 200, store.updateUser(id, req.body || {}));
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === req.user.id) return sendError(res, 400, '不能删除当前登录用户');
    if (!store.getUserById(id)) return sendError(res, 404, '用户不存在');
    store.deleteUser(id);
    return sendData(res, 200, { id });
  } catch (e) {
    return sendError(res, e.statusCode || 500, e.message);
  }
});

module.exports = router;
