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
  defaults: { status: 'active', stops: [], stopPoints: [], distanceKm: 0 },
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

/**
 * PUT /api/routes/:id/stop-points - give the stops coordinates.
 *
 * Kept beside the name list rather than replacing it: the roster endpoint and
 * every existing screen match staff to stops by name, so `stops` has to stay a
 * plain array of strings. This adds the geometry the tracking map needs.
 */
router.put('/:id/stop-points', requireRole('operations'), (req, res) => {
  const route = store.find('routes', (r) => r.id === req.params.id);
  if (!route) throw new ApiError(404, `Route ${req.params.id} was not found.`);

  const points = Array.isArray(req.body?.stopPoints) ? req.body.stopPoints : null;
  if (!points) throw new ApiError(400, 'Send a stopPoints array of { name, lat, lon }.');

  const cleaned = points.map((p) => {
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    if (!String(p.name || '').trim()) throw new ApiError(400, 'Every stop point needs a name.');
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new ApiError(400, `"${p.name}" has an unusable latitude.`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new ApiError(400, `"${p.name}" has an unusable longitude.`);
    }
    return { name: String(p.name).trim(), lat, lon };
  });

  const updated = store.update('routes', route.id, { stopPoints: cleaned });
  audit(req, 'routes.stopPoints', `Mapped ${cleaned.length} stop position(s) for ${route.code}`);
  res.json({ data: updated });
});

router.use('/', base);

module.exports = router;
