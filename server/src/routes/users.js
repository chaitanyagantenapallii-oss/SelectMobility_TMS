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
  const { name, email, password, role = 'viewer', organisation } = req.body || {};
  if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required.');
  if (String(password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
  if (!['admin', 'operations', 'viewer', 'driver', 'client'].includes(role)) throw new ApiError(400, 'Role must be admin, operations, viewer, driver or client.');
  if (store.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    throw new ApiError(409, `A user with email ${email} already exists.`);
  }

  /*
   * A `client` login is scoped entirely by `organisation`: every read in
   * /api/mobile/client/* filters on it. Creating one without a company produced
   * an account that signed in successfully and then showed an empty roster,
   * which looks like broken software rather than a missing field. So the
   * company is required for that role, and it has to actually exist.
   */
  let company = null;
  if (organisation) {
    company = store.find('organisations', (o) => o.name === organisation);
    if (!company) throw new ApiError(400, `No company named "${organisation}" exists. Create it first.`);
  }
  if (role === 'client' && !company) {
    throw new ApiError(400, 'A client login must be attached to a company, or it will see no staff.');
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
  if (company) user.organisation = company.name;
  store.insert('users', user);
  audit(req, 'users.create', `Created user ${user.email} (${role}${company ? `, ${company.name}` : ''})`);

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
  if (req.body?.driverId !== undefined) {
    if (req.body.driverId === '' || req.body.driverId === null) {
      patch.driverId = undefined;
    } else {
      const driver = store.find('drivers', (d) => d.id === req.body.driverId);
      if (!driver) throw new ApiError(400, `Driver ${req.body.driverId} does not exist.`);
      const linked = store.find('users', (u) => u.id !== user.id && u.driverId === driver.id);
      if (linked) throw new ApiError(409, `Driver ${driver.id} is already linked to ${linked.email}.`);
      patch.driverId = driver.id;
    }
  }
  if (req.body?.organisation !== undefined) {
    if (req.body.organisation === '' || req.body.organisation === null) {
      patch.organisation = undefined;
    } else {
      const company = store.find('organisations', (o) => o.name === req.body.organisation);
      if (!company) throw new ApiError(400, `No company named "${req.body.organisation}" exists.`);
      patch.organisation = company.name;
    }
  }
  if (patch.role && !['admin', 'operations', 'viewer', 'driver', 'client'].includes(patch.role)) {
    throw new ApiError(400, 'Role must be admin, operations, viewer, driver or client.');
  }
  /*
   * Moving a client login off its company, or changing a user into a client
   * without one, recreates the empty-roster problem. Check the post-update
   * state rather than the patch so both paths are covered.
   */
  const finalRole = patch.role || user.role;
  const finalOrg = patch.organisation !== undefined ? patch.organisation : user.organisation;
  if (finalRole === 'client' && !finalOrg) {
    throw new ApiError(400, 'A client login must be attached to a company, or it will see no staff.');
  }
  if (patch.email && store.find('users', (u) => u.id !== user.id && u.email.toLowerCase() === String(patch.email).toLowerCase())) {
    throw new ApiError(409, `A user with email ${patch.email} already exists.`);
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
    patch.passwordHash = hashPassword(req.body.password);
  }

  const updated = store.update('users', user.id, patch);

  // Keep the driver-side ownership link in sync with the login assignment.
  // Driver mobile endpoints resolve the driver from driver.userId, while the
  // admin user record stores the inverse driverId relationship.
  if (req.body?.driverId !== undefined) {
    for (const driver of store.collection('drivers')) {
      if (driver.userId === user.id && driver.id !== patch.driverId) {
        store.update('drivers', driver.id, { userId: undefined, updatedAt: nowIso() });
      }
    }
    if (patch.driverId) {
      store.update('drivers', patch.driverId, { userId: user.id, updatedAt: nowIso() });
    }
  }
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
