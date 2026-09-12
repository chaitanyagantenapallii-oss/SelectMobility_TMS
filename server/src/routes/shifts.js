'use strict';

/**
 * Shift timings.
 *
 * Shifts are a first-class collection - each route is assigned to one shift, and
 * the trip schedule is derived from the shift's pickup and drop windows. The
 * frontend needs a plain CRUD surface for them (the Trip Logs, Routes & Stops,
 * Shift Timings and Employees pages all load the shift list as a lookup).
 */

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { requireRole, audit, authenticate } = require('../middleware/auth');
const { ApiError } = require('../utils/helpers');

/** Normalise "H:MM" / "HH:MM" to zero-padded "HH:MM". */
function normaliseTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const TIME_FIELDS = ['pickupStart', 'pickupEnd', 'dropStart', 'dropEnd'];

const base = createResource({
  collection: 'shifts',
  prefix: 'SHF',
  sortField: 'code',
  searchFields: ['code', 'name'],
  filterFields: ['status'],
  defaults: { status: 'active' },
  validate: validators.combine(
    validators.required(['code', 'name']),
    validators.unique('code', 'Shift code'),
    validators.oneOf('status', ['active', 'inactive'], 'Status'),
    (payload) => {
      // Time fields are optional, but any that are supplied must be valid so the
      // trip scheduler can compare them as strings.
      for (const field of TIME_FIELDS) {
        if (payload[field] === undefined || payload[field] === '') continue;
        const normalised = normaliseTime(payload[field]);
        if (!normalised) {
          throw new ApiError(400, `${field} must be a time in HH:MM format (24-hour).`);
        }
        payload[field] = normalised;
      }

      // A pickup window that ends before it starts would schedule trips backwards.
      if (payload.pickupStart && payload.pickupEnd && payload.pickupEnd < payload.pickupStart) {
        throw new ApiError(400, 'Pickup window end time cannot be earlier than the start time.');
      }
      if (payload.dropStart && payload.dropEnd && payload.dropEnd < payload.dropStart) {
        throw new ApiError(400, 'Drop window end time cannot be earlier than the start time.');
      }
    },
  ),
  decorate: (record) => {
    const routes = store.filter('routes', (r) => r.shiftId === record.id);
    return {
      ...record,
      routeCount: routes.length,
      activeRouteCount: routes.filter((r) => r.status === 'active').length,
    };
  },
});

const router = express.Router();

/**
 * Authentication must run before any custom route below, otherwise these
 * handlers would be reachable without a token. The generic resource router
 * (mounted last) applies its own authenticate, so this only guards the
 * hand-written routes above it.
 */
router.use(authenticate);

/** GET /api/shifts/:id/usage - what depends on this shift, before deletion. */
router.get('/:id/usage', (req, res) => {
  const shift = store.find('shifts', (s) => s.id === req.params.id);
  if (!shift) throw new ApiError(404, `Shift ${req.params.id} was not found.`);

  const routes = store.filter('routes', (r) => r.shiftId === shift.id);
  const employees = store.filter('employees', (e) => e.shiftId === shift.id);
  const trips = store.filter('trips', (t) => t.shiftId === shift.id);

  res.json({
    data: {
      shift: { id: shift.id, code: shift.code, name: shift.name },
      routes: routes.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      employeeCount: employees.length,
      tripCount: trips.length,
      canDelete: routes.length === 0 && employees.length === 0 && trips.length === 0,
    },
  });
});

/** DELETE /api/shifts/:id - refuse while anything still references the shift. */
router.delete('/:id', requireRole('operations'), (req, res) => {
  const shift = store.find('shifts', (s) => s.id === req.params.id);
  if (!shift) throw new ApiError(404, `Shift ${req.params.id} was not found.`);

  const blockers = [];
  const routeCount = store.filter('routes', (r) => r.shiftId === shift.id).length;
  const employeeCount = store.filter('employees', (e) => e.shiftId === shift.id).length;
  const tripCount = store.filter('trips', (t) => t.shiftId === shift.id).length;
  if (routeCount) blockers.push(`${routeCount} route(s)`);
  if (employeeCount) blockers.push(`${employeeCount} employee(s)`);
  if (tripCount) blockers.push(`${tripCount} trip(s)`);

  if (blockers.length) {
    throw new ApiError(
      409,
      `Shift ${shift.code} is still used by ${blockers.join(', ')}. Reassign them first.`,
    );
  }

  store.remove('shifts', shift.id);
  audit(req, 'shifts.delete', `Deleted shift ${shift.code}`);
  res.json({ ok: true, id: shift.id });
});

router.use('/', base);

module.exports = router;
