'use strict';

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { ApiError, nowIso } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

/** GET /api/users */
router.get('/', (_req, res) => {
  const data = store.collection('users').map(({ passwordHash, ...rest }) => ({ ...rest, hasPassword: Boolean(passwordHash) }));
  res.json({ data });
});

/** POST /api/users - create an operator account. */
router.post('/', (req, res) => {
  const { name, email, password, role = 'viewer' } = req.body || {};
  if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required.');
  if (String(password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
  if (!['admin', 'operations', 'viewer'].includes(role)) throw new ApiError(400, 'Role must be admin, operations or viewer.');
  if (store.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    throw new ApiError(409, `A user with email ${email} already exists.`);
  }

  const user = {
    id: store.nextId('users', 'USR'),
    name,
    email: String(email).toLowerCase().trim(),
    role,
    status: 'active',
    passwordHash: hashPassword(password),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.insert('users', user);
  audit(req, 'users.create', `Created user ${user.email} (${role})`);

  const { passwordHash, ...safe } = user;
  res.status(201).json({ data: safe });
});

/** PUT /api/users/:id - update profile / role / status. */
router.put('/:id', (req, res) => {
  const user = store.find('users', (u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, `User ${req.params.id} was not found.`);

  const patch = {};
  for (const field of ['name', 'email', 'role', 'status']) {
    if (req.body?.[field] !== undefined) patch[field] = req.body[field];
  }
  if (patch.role && !['admin', 'operations', 'viewer'].includes(patch.role)) {
    throw new ApiError(400, 'Role must be admin, operations or viewer.');
  }
  if (patch.email && store.find('users', (u) => u.id !== user.id && u.email.toLowerCase() === String(patch.email).toLowerCase())) {
    throw new ApiError(409, `A user with email ${patch.email} already exists.`);
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
    patch.passwordHash = hashPassword(req.body.password);
  }

  const updated = store.update('users', user.id, patch);
  audit(req, 'users.update', `Updated user ${user.email}`);
  const { passwordHash, ...safe } = updated;
  res.json({ data: safe });
});

/** DELETE /api/users/:id */
router.delete('/:id', (req, res) => {
  const user = store.find('users', (u) => u.id === req.params.id);
  if (!user) throw new ApiError(404, `User ${req.params.id} was not found.`);
  if (user.id === req.user.id) throw new ApiError(400, 'You cannot delete the account you are signed in with.');
  if (store.collection('users').filter((u) => u.role === 'admin').length === 1 && user.role === 'admin') {
    throw new ApiError(400, 'At least one administrator account must remain.');
  }
  store.remove('users', user.id);
  audit(req, 'users.delete', `Deleted user ${user.email}`);
  res.json({ ok: true, id: user.id });
});

/** GET /api/users/audit-log */
router.get('/audit-log', (_req, res) => {
  const data = store.collection('auditLog').slice().reverse().slice(0, 300);
  res.json({ data });
});

module.exports = router;
