'use strict';

/**
 * Client organisations ("companies").
 *
 * A company is the billing and scoping unit for a corporate customer. It is not
 * decorative: the employee record carries an `organisation` string, every
 * `/api/mobile/client/*` read filters on `organisation`, and a client login is
 * useless without one because it would see an empty roster.
 *
 * Until now these values existed only as two hard-coded strings in the seed
 * ('Bharat Forge Ltd', 'Kirloskar Pneumatic'), which meant a new corporate
 * customer could not be onboarded from the product at all. This module makes
 * them first-class records so the desk can create a company, keep its address
 * and GST details, and see which staff serve it.
 *
 * `name` is the join key. Employees, users and service requests all store the
 * company *name* rather than its id, so renaming rewrites those fields. The
 * rename cascade is handled here rather than in the generic factory.
 */

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, nowIso } = require('../utils/helpers');

/**
 * Collections that denormalise the company name. A rename has to touch all of
 * them, or a client login keeps scoping to a company that no longer exists and
 * silently shows an empty roster.
 */
const NAME_LINKED = ['employees', 'users', 'serviceRequests'];

/** Keep junk out of the stored contact list. */
function cleanContacts(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new ApiError(400, 'Contacts must be a list.');
  return raw
    .filter((c) => c && (c.name || c.email || c.phone))
    .slice(0, 10)
    .map((c) => ({
      name: String(c.name || '').slice(0, 80),
      role: String(c.role || '').slice(0, 80),
      email: String(c.email || '').slice(0, 120),
      phone: String(c.phone || '').slice(0, 24),
    }));
}

/** Live counts for one company name. Never stored - they would drift. */
function statsFor(name) {
  const employees = store.filter('employees', (e) => e.organisation === name);
  const employeeIds = new Set(employees.map((e) => e.id));
  const bookings = store.filter('bookings', (b) => employeeIds.has(b.employeeId));
  return {
    employeeCount: employees.length,
    activeEmployeeCount: employees.filter((e) => e.status === 'active').length,
    userCount: store.filter('users', (u) => u.organisation === name).length,
    tripsServed: new Set(bookings.map((b) => b.tripId)).size,
    boardedCount: bookings.filter((b) => b.status === 'completed').length,
    stops: [...new Set(employees.map((e) => e.stop).filter(Boolean))].sort(),
  };
}

const generic = createResource({
  collection: 'organisations',
  prefix: 'ORG',
  sortField: 'name',
  searchFields: ['name', 'code', 'city', 'gstin', 'contactName', 'contactEmail'],
  filterFields: ['status', 'city', 'industry'],
  defaults: {
    status: 'active',
    city: 'Pune, Maharashtra, India',
    industry: 'Manufacturing',
    billingCycle: 'monthly',
    contractTill: '',
  },
  validate: validators.combine(
    validators.required(['name']),
    validators.unique('name', 'Company name'),
    validators.unique('code', 'Company code'),
    validators.oneOf('status', ['active', 'onboarding', 'suspended'], 'Status'),
    validators.oneOf('billingCycle', ['monthly', 'fortnightly', 'per-trip'], 'Billing cycle'),
    (payload) => {
      if (payload.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(payload.contactEmail))) {
        throw new ApiError(400, 'Contact email is not a valid address.');
      }
    },
  ),
  decorate: (record) => ({ ...record, ...statsFor(record.name) }),
});

const router = express.Router();
router.use(authenticate);

/*
 * Writes are restricted to admin/operations. Reads are staff-only: this
 * collection holds every corporate customer's contract and GST details, which
 * a driver or client token has no business enumerating.
 */
const canRead = requireRole('admin', 'operations', 'viewer');
const canWrite = requireRole('operations');

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
router.get('/', canRead, (req, res) => {
  let rows = store.collection('organisations').slice();
  if (req.query.search) {
    const needle = String(req.query.search).toLowerCase();
    rows = rows.filter((r) =>
      ['name', 'code', 'city', 'gstin', 'contactName', 'contactEmail'].some((f) =>
        String(r[f] || '').toLowerCase().includes(needle),
      ),
    );
  }
  for (const field of ['status', 'city', 'industry']) {
    const raw = req.query[field];
    if (raw === undefined || raw === '' || raw === 'all') continue;
    const values = String(raw).split(',').map((v) => v.trim());
    rows = rows.filter((r) => values.includes(String(r[field])));
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const data = rows.map((r) => ({ ...r, ...statsFor(r.name) }));
  res.json({ data, meta: { total: data.length } });
});

// ---------------------------------------------------------------------------
// READ ONE
// ---------------------------------------------------------------------------
router.get('/:id', canRead, (req, res) => {
  const record = store.find('organisations', (o) => o.id === req.params.id);
  if (!record) throw new ApiError(404, `Company ${req.params.id} was not found.`);

  const employees = store
    .filter('employees', (e) => e.organisation === record.name)
    .map((e) => ({
      id: e.id, code: e.code, name: e.name, department: e.department, stop: e.stop, status: e.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const users = store
    .filter('users', (u) => u.organisation === record.name)
    .map(({ passwordHash, ...rest }) => ({ ...rest, hasPassword: Boolean(passwordHash) }));

  res.json({ data: { ...record, ...statsFor(record.name), employees, users } });
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
router.post('/', canWrite, (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.id;

  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(400, 'Missing required field(s): name.');

  const clash = store.find('organisations', (o) => o.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ApiError(409, `A company named "${name}" already exists (${clash.id}).`);

  const code = body.code !== undefined ? String(body.code).trim() : '';
  if (code) {
    const codeClash = store.find('organisations', (o) => String(o.code || '').toLowerCase() === code.toLowerCase());
    if (codeClash) throw new ApiError(409, `Company code "${code}" already exists (${codeClash.id}).`);
  }
  if (body.status && !['active', 'onboarding', 'suspended'].includes(body.status)) {
    throw new ApiError(400, 'Status must be one of: active, onboarding, suspended.');
  }
  if (body.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.contactEmail))) {
    throw new ApiError(400, 'Contact email is not a valid address.');
  }
  if (body.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug).trim())) {
    throw new ApiError(400, 'Tenant URL slug must use lowercase letters, numbers and hyphens.');
  }
  if (body.logoUrl !== undefined && String(body.logoUrl).length > 500) {
    throw new ApiError(400, 'Tenant logo URL is too long.');
  }
  if (body.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug).trim())) {
    throw new ApiError(400, 'Tenant URL slug must use lowercase letters, numbers and hyphens.');
  }
  if (body.logoUrl !== undefined && String(body.logoUrl).length > 500) {
    throw new ApiError(400, 'Tenant logo URL is too long.');
  }

  const record = {
    id: store.nextId('organisations', 'ORG'),
    status: 'active',
    city: 'Pune, Maharashtra, India',
    industry: 'Manufacturing',
    billingCycle: 'monthly',
    contractTill: '',
    slug: code.toLowerCase(),
    logoUrl: '',
    loginPath: '',
    ...body,
    name,
    code,
    contacts: cleanContacts(body.contacts) || [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.insert('organisations', record);
  audit(req, 'organisations.create', `Created company "${name}"`);
  res.status(201).json({ data: { ...record, ...statsFor(name) } });
});

// ---------------------------------------------------------------------------
// UPDATE (with rename cascade)
//
// `name` is denormalised into employees, users and service requests. Renaming
// without rewriting those rows orphans every employee from the client account
// that is meant to see them, which presents as an empty roster in the Client
// app and is very hard to trace back to a rename. So it is one operation.
// ---------------------------------------------------------------------------
router.put('/:id', canWrite, (req, res) => {
  const existing = store.find('organisations', (o) => o.id === req.params.id);
  if (!existing) throw new ApiError(404, `Company ${req.params.id} was not found.`);

  const body = { ...(req.body || {}) };
  delete body.id;
  delete body.createdAt;
  if (body.contacts !== undefined) body.contacts = cleanContacts(body.contacts);

  const nextName = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!nextName) throw new ApiError(400, 'Company name cannot be empty.');

  const clash = store.find(
    'organisations',
    (o) => o.id !== existing.id && o.name.toLowerCase() === nextName.toLowerCase(),
  );
  if (clash) throw new ApiError(409, `A company named "${nextName}" already exists (${clash.id}).`);

  if (body.code !== undefined) {
    const code = String(body.code).trim();
    const codeClash = store.find(
      'organisations',
      (o) => o.id !== existing.id && String(o.code || '').toLowerCase() === code.toLowerCase(),
    );
    if (codeClash) throw new ApiError(409, `Company code "${code}" already exists (${codeClash.id}).`);
  }
  if (body.status && !['active', 'onboarding', 'suspended'].includes(body.status)) {
    throw new ApiError(400, 'Status must be one of: active, onboarding, suspended.');
  }
  if (body.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.contactEmail))) {
    throw new ApiError(400, 'Contact email is not a valid address.');
  }

  const renamed = nextName !== existing.name;
  const updated = store.update('organisations', existing.id, {
    ...body,
    name: nextName,
    updatedAt: nowIso(),
  });

  let moved = 0;
  if (renamed) {
    for (const collection of NAME_LINKED) {
      for (const row of store.collection(collection)) {
        if (row.organisation === existing.name) {
          store.update(collection, row.id, { organisation: nextName, updatedAt: nowIso() });
          moved += 1;
        }
      }
    }
    audit(req, 'organisations.rename', `Renamed "${existing.name}" to "${nextName}" (${moved} linked records moved)`);
  } else {
    audit(req, 'organisations.update', `Updated ${existing.id}`);
  }

  res.json({
    data: { ...updated, ...statsFor(nextName), renamedFrom: renamed ? existing.name : undefined, linkedMoved: moved },
  });
});

// ---------------------------------------------------------------------------
// DELETE
//
// Refused while staff are still attached. Deleting the company would leave those
// employees pointing at a name that no longer exists, and the client account for
// that company would keep signing in to an empty roster.
// ---------------------------------------------------------------------------
router.delete('/:id', canWrite, (req, res) => {
  const existing = store.find('organisations', (o) => o.id === req.params.id);
  if (!existing) throw new ApiError(404, `Company ${req.params.id} was not found.`);

  const staff = store.filter('employees', (e) => e.organisation === existing.name);
  if (staff.length) {
    throw new ApiError(
      409,
      `${existing.name} still has ${staff.length} employee(s) on its roster. Move or remove them first.`,
    );
  }
  const users = store.filter('users', (u) => u.organisation === existing.name);
  if (users.length) {
    throw new ApiError(
      409,
      `${existing.name} still has ${users.length} login(s) attached. Reassign or delete those accounts first.`,
    );
  }

  store.remove('organisations', existing.id);
  audit(req, 'organisations.delete', `Deleted company "${existing.name}"`);
  res.json({ ok: true, id: existing.id });
});

module.exports = router;
