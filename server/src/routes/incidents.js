'use strict';

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, today } = require('../utils/helpers');

const base = createResource({
  collection: 'incidents',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'INC',
  sortField: 'date',
  searchFields: ['description', 'type', 'actionTaken'],
  filterFields: ['vehicleId', 'type', 'severity', 'status', 'routeId'],
  defaults: { date: today(), status: 'open', severity: 'low', type: 'breakdown' },
  validate: validators.combine(
    validators.required(['vehicleId', 'type', 'description', 'date']),
    validators.oneOf('type', ['breakdown', 'accident', 'delay', 'complaint', 'safety', 'other'], 'Incident type'),
    validators.oneOf('severity', ['low', 'medium', 'high', 'critical'], 'Severity'),
    validators.oneOf('status', ['open', 'under-review', 'closed'], 'Status'),
  ),
  decorate: (record) => {
    const vehicle = store.find('vehicles', (v) => v.id === record.vehicleId);
    const route = record.routeId ? store.find('routes', (r) => r.id === record.routeId) : null;
    return {
      ...record,
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown',
      routeName: route ? route.code : '-',
    };
  },
});

const router = express.Router();
router.use(authenticate);

/** POST /api/incidents/:id/resolve - close an incident with a resolution note. */
router.post('/:id/resolve', requireRole('operations'), (req, res) => {
  const incident = store.find('incidents', (i) => i.id === req.params.id);
  if (!incident) throw new ApiError(404, `Incident ${req.params.id} was not found.`);
  const { actionTaken, status = 'closed' } = req.body || {};
  if (!['closed', 'under-review'].includes(status)) throw new ApiError(400, 'Status must be "closed" or "under-review".');

  const updated = store.update('incidents', incident.id, {
    actionTaken: actionTaken || incident.actionTaken,
    status,
    resolvedBy: req.user.email,
    resolvedAt: new Date().toISOString(),
  });
  audit(req, 'incidents.resolve', `Incident ${incident.id} set to ${status}`);
  res.json({ data: updated });
});

router.use('/', base);

module.exports = router;
