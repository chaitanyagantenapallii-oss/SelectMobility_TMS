'use strict';

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError } = require('../utils/helpers');

const base = createResource({
  collection: 'routes',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'RTE',
  sortField: 'code',
  searchFields: ['code', 'name'],
  filterFields: ['status', 'shiftId'],
  defaults: { status: 'active', stops: [], distanceKm: 0 },
  validate: validators.combine(
    validators.required(['code', 'name', 'shiftId']),
    validators.unique('code', 'Route code'),
    validators.inRange('distanceKm', 0, 500, 'Distance (km)'),
    validators.oneOf('status', ['active', 'suspended'], 'Status'),
  ),
  decorate: (record) => {
    const shift = store.find('shifts', (s) => s.id === record.shiftId);
    const employees = store.filter('employees', (e) => e.routeId === record.id && e.status === 'active');
    const trips = store.filter('trips', (t) => t.routeId === record.id);
    return {
      ...record,
      stopCount: (record.stops || []).length,
      shiftName: shift ? shift.name : 'Unassigned',
      shiftCode: shift ? shift.code : '-',
      employeeCount: employees.length,
      tripsLogged: trips.length,
      utilisation: store.find('vehicles', (v) => false) ? null : null,
    };
  },
});

const router = express.Router();
router.use(authenticate);

/** GET /api/routes/:id/roster - employees assigned to a route, grouped by stop. */
router.get('/:id/roster', (req, res) => {
  const route = store.find('routes', (r) => r.id === req.params.id);
  if (!route) throw new ApiError(404, `Route ${req.params.id} was not found.`);

  const employees = store.filter('employees', (e) => e.routeId === route.id && e.status === 'active');
  const byStop = (route.stops || []).map((stop) => ({
    stop,
    employees: employees.filter((e) => e.stop === stop).map((e) => ({ id: e.id, code: e.code, name: e.name, phone: e.phone, department: e.department })),
  }));

  res.json({
    data: {
      route: { id: route.id, code: route.code, name: route.name, distanceKm: route.distanceKm },
      totalEmployees: employees.length,
      stops: byStop,
      unassignedStop: employees.filter((e) => !(route.stops || []).includes(e.stop)).map((e) => ({ id: e.id, code: e.code, name: e.name })),
    },
  });
});

/** PUT /api/routes/:id/stops - replace the ordered stop list. */
router.put('/:id/stops', requireRole('operations'), (req, res) => {
  const route = store.find('routes', (r) => r.id === req.params.id);
  if (!route) throw new ApiError(404, `Route ${req.params.id} was not found.`);
  const stops = Array.isArray(req.body?.stops) ? req.body.stops.map((s) => String(s).trim()).filter(Boolean) : null;
  if (!stops || stops.length < 2) throw new ApiError(400, 'A route needs at least two stops.');

  const updated = store.update('routes', route.id, { stops });
  audit(req, 'routes.stops', `Updated stop sequence for ${route.code}`);
  res.json({ data: updated });
});

router.use('/', base);

module.exports = router;
