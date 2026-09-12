'use strict';

/**
 * Generic REST resource factory.
 *
 * Produces list / read / create / update / delete handlers for a JSON
 * collection, with validation, search, filtering, sorting and pagination.
 * Keeps the individual route modules focused on domain rules only.
 */

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, paginate, matchesSearch, nowIso } = require('../utils/helpers');

/**
 * @param {object} options
 * @param {string} options.collection  store collection name
 * @param {string} options.prefix      id prefix, e.g. 'VEH'
 * @param {string[]} options.searchFields
 * @param {string[]} options.filterFields  query params matched as exact equality
 * @param {object} options.defaults    field defaults applied on create
 * @param {Function} [options.validate] (payload, { existing, mode }) => void | throws ApiError
 * @param {Function} [options.decorate] (record, req) => record  enrich output
 * @param {string} [options.sortField]
 * @param {string} [options.writeRole] role required for writes (default: operations)
 */
function createResource(options) {
  const {
    collection,
    prefix,
    searchFields = [],
    filterFields = [],
    defaults = {},
    validate,
    decorate,
    afterCreate,
    sortField = 'createdAt',
    writeRole = 'operations',
  } = options;

  const router = express.Router();
  router.use(authenticate);

  const canWrite = requireRole(writeRole);

  const enrich = (record, req) => (decorate ? decorate({ ...record }, req) : { ...record });

  // LIST ------------------------------------------------------------------
  router.get('/', (req, res) => {
    let rows = store.collection(collection).slice();

    if (req.query.search) rows = rows.filter((r) => matchesSearch(r, req.query.search, searchFields));

    for (const field of filterFields) {
      const raw = req.query[field];
      if (raw === undefined || raw === '' || raw === 'all') continue;
      const values = String(raw).split(',').map((v) => v.trim());
      rows = rows.filter((r) => values.includes(String(r[field])));
    }

    if (req.query.from) rows = rows.filter((r) => !r.date || r.date >= req.query.from);
    if (req.query.to) rows = rows.filter((r) => !r.date || r.date <= req.query.to);

    const dir = req.query.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });

    const usePaging = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (usePaging) {
      const { data, meta } = paginate(rows, req.query);
      return res.json({ data: data.map((r) => enrich(r, req)), meta });
    }
    return res.json({ data: rows.map((r) => enrich(r, req)), meta: { total: rows.length } });
  });

  // READ ------------------------------------------------------------------
  router.get('/:id', (req, res) => {
    const record = store.find(collection, (r) => r.id === req.params.id);
    if (!record) throw new ApiError(404, `${prefix} record ${req.params.id} was not found.`);
    res.json({ data: enrich(record, req) });
  });

  // CREATE ----------------------------------------------------------------
  router.post('/', canWrite, (req, res) => {
    const payload = { ...defaults, ...(req.body || {}) };
    delete payload.id;
    if (validate) validate(payload, { existing: store.collection(collection), mode: 'create' });

    const record = {
      id: store.nextId(collection, prefix),
      ...payload,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (payload.regNo) record.regNo = String(payload.regNo).toUpperCase();
    store.insert(collection, record);
    // Some resources own child records that must exist alongside them - a trip,
    // for example, is useless without the passenger bookings that make up its
    // manifest. Runs after insert so the parent id is available.
    if (afterCreate) afterCreate(record, req);
    audit(req, `${collection}.create`, `Created ${record.id}`);
    res.status(201).json({ data: enrich(record, req) });
  });

  // UPDATE ----------------------------------------------------------------
  router.put('/:id', canWrite, (req, res) => {
    const existing = store.find(collection, (r) => r.id === req.params.id);
    if (!existing) throw new ApiError(404, `${prefix} record ${req.params.id} was not found.`);

    const payload = { ...(req.body || {}) };
    delete payload.id;
    delete payload.createdAt;
    if (payload.regNo) payload.regNo = String(payload.regNo).toUpperCase();
    if (validate) validate({ ...existing, ...payload }, { existing: store.collection(collection), mode: 'update', id: req.params.id });

    const updated = store.update(collection, req.params.id, payload);
    audit(req, `${collection}.update`, `Updated ${req.params.id}`);
    res.json({ data: enrich(updated, req) });
  });

  // DELETE ----------------------------------------------------------------
  router.delete('/:id', canWrite, (req, res) => {
    const existing = store.find(collection, (r) => r.id === req.params.id);
    if (!existing) throw new ApiError(404, `${prefix} record ${req.params.id} was not found.`);
    store.remove(collection, req.params.id);
    audit(req, `${collection}.delete`, `Deleted ${req.params.id}`);
    res.json({ ok: true, id: req.params.id });
  });

  return router;
}

/**
 * Validator helpers shared by resource modules.
 */
const validators = {
  required(fields) {
    return (payload) => {
      const missing = fields.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
      if (missing.length) throw new ApiError(400, `Missing required field(s): ${missing.join(', ')}.`, { fields: missing });
    };
  },
  unique(field, label) {
    return (payload, { existing, mode, id }) => {
      if (payload[field] === undefined) return;
      const clash = existing.find(
        (r) => r.id !== id && String(r[field]).toLowerCase() === String(payload[field]).toLowerCase(),
      );
      if (clash) throw new ApiError(409, `${label || field} "${payload[field]}" already exists (${clash.id}).`);
    };
  },
  inRange(field, min, max, label) {
    return (payload) => {
      if (payload[field] === undefined || payload[field] === '') return;
      const n = Number(payload[field]);
      if (Number.isNaN(n)) throw new ApiError(400, `${label || field} must be a number.`);
      if (n < min || n > max) throw new ApiError(400, `${label || field} must be between ${min} and ${max}.`);
    };
  },
  oneOf(field, allowed, label) {
    return (payload) => {
      if (payload[field] === undefined || payload[field] === '') return;
      if (!allowed.includes(payload[field])) {
        throw new ApiError(400, `${label || field} must be one of: ${allowed.join(', ')}.`);
      }
    };
  },
  combine(...fns) {
    return (payload, ctx) => fns.forEach((fn) => fn(payload, ctx));
  },
};

module.exports = { createResource, validators };
