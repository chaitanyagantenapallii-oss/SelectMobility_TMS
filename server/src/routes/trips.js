'use strict';

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, today, round } = require('../utils/helpers');

const base = createResource({
  collection: 'trips',
  prefix: 'TRP',
  sortField: 'date',
  searchFields: ['id', 'date', 'status', 'notes'],
  filterFields: ['date', 'status', 'routeId', 'vehicleId', 'driverId', 'shiftId'],
  defaults: {
    date: today(),
    status: 'scheduled',
    plannedKm: 0,
    actualKm: 0,
    fuelCost: 0,
    tollCost: 0,
    notes: '',
  },
  validate: validators.combine(
    validators.required(['date', 'routeId', 'vehicleId', 'driverId', 'shiftId']),
    validators.oneOf('status', ['scheduled', 'in-progress', 'completed', 'cancelled'], 'Trip status'),
    validators.inRange('plannedKm', 0, 1000, 'Planned km'),
    validators.inRange('actualKm', 0, 1000, 'Actual km'),
    (payload) => {
      if (payload.routeId && !store.find('routes', (r) => r.id === payload.routeId)) {
        throw new ApiError(400, `Route ${payload.routeId} does not exist.`);
      }
      if (payload.vehicleId && !store.find('vehicles', (v) => v.id === payload.vehicleId)) {
        throw new ApiError(400, `Vehicle ${payload.vehicleId} does not exist.`);
      }
      if (payload.driverId && !store.find('drivers', (d) => d.id === payload.driverId)) {
        throw new ApiError(400, `Driver ${payload.driverId} does not exist.`);
      }
    },
  ),
  decorate: (record) => {
    const route = store.find('routes', (r) => r.id === record.routeId);
    const vehicle = store.find('vehicles', (v) => v.id === record.vehicleId);
    const driver = store.find('drivers', (d) => d.id === record.driverId);
    const shift = store.find('shifts', (s) => s.id === record.shiftId);
    const bookings = store.filter('bookings', (b) => b.tripId === record.id);
    const boarded = bookings.filter((b) => b.status === 'completed').length;
    const noShow = bookings.filter((b) => b.status === 'no-show').length;

    return {
      ...record,
      routeName: route ? `${route.code} - ${route.name}` : 'Unknown route',
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unassigned',
      driverName: driver ? driver.name : 'Unassigned',
      driverPhone: driver ? driver.phone : null,
      shiftName: shift ? shift.name : 'Unassigned',
      passengersAllocated: bookings.length,
      passengersBoarded: boarded,
      noShows: noShow,
      occupancy: vehicle && vehicle.seats ? round((bookings.length / vehicle.seats) * 100, 1) : null,
      varianceKm: round((Number(record.actualKm) || 0) - (Number(record.plannedKm) || 0), 1),
    };
  },
});

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/trips/:id/manifest
 * Driver-facing passenger list for a single run, ordered by stop sequence.
 */
router.get('/:id/manifest', (req, res) => {
  const trip = store.find('trips', (t) => t.id === req.params.id);
  if (!trip) throw new ApiError(404, `Trip ${req.params.id} was not found.`);

  const route = store.find('routes', (r) => r.id === trip.routeId);
  const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
  const driver = store.find('drivers', (d) => d.id === trip.driverId);
  const bookings = store.filter('bookings', (b) => b.tripId === trip.id);

  const passengers = bookings.map((b) => {
    const emp = store.find('employees', (e) => e.id === b.employeeId) || {};
    const att = store.find('attendance', (a) => a.bookingId === b.id);
    return {
      bookingId: b.id,
      employeeId: emp.id,
      code: emp.code,
      name: emp.name,
      phone: emp.phone,
      department: emp.department,
      stop: b.stop,
      status: b.status,
      boarded: att ? att.boarded : null,
    };
  });

  const stops = (route?.stops || []).map((stop) => ({
    stop,
    passengers: passengers.filter((p) => p.stop === stop),
  }));
  const unlisted = passengers.filter((p) => !(route?.stops || []).includes(p.stop));

  res.json({
    data: {
      trip: { id: trip.id, date: trip.date, status: trip.status, departureAt: trip.departureAt, arrivalAt: trip.arrivalAt },
      route: route ? { code: route.code, name: route.name, distanceKm: route.distanceKm } : null,
      vehicle: vehicle ? { regNo: vehicle.regNo, model: vehicle.model, seats: vehicle.seats } : null,
      driver: driver ? { name: driver.name, phone: driver.phone } : null,
      summary: {
        total: passengers.length,
        boarded: passengers.filter((p) => p.boarded === true).length,
        absent: passengers.filter((p) => p.boarded === false).length,
        pending: passengers.filter((p) => p.boarded === null).length,
        seatsAvailable: vehicle ? Math.max(0, vehicle.seats - passengers.length) : null,
      },
      stops,
      unlisted,
    },
  });
});

/** POST /api/trips/:id/attendance - bulk mark boarded / no-show. */
router.post('/:id/attendance', requireRole('operations'), (req, res) => {
  const trip = store.find('trips', (t) => t.id === req.params.id);
  if (!trip) throw new ApiError(404, `Trip ${req.params.id} was not found.`);

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!entries.length) throw new ApiError(400, 'Provide an "entries" array of { bookingId, boarded }.');

  let updated = 0;
  for (const entry of entries) {
    const booking = store.find('bookings', (b) => b.id === entry.bookingId && b.tripId === trip.id);
    if (!booking) continue;

    const boarded = Boolean(entry.boarded);
    const existing = store.find('attendance', (a) => a.bookingId === booking.id);
    const attPayload = {
      boarded,
      boardedAt: boarded ? new Date().toISOString() : null,
      boardStop: booking.stop,
      markedBy: req.user.email,
    };
    if (existing) {
      store.update('attendance', existing.id, attPayload);
    } else {
      store.insert('attendance', {
        id: `ATT${String(store.collection('attendance').length + 1).padStart(5, '0')}`,
        tripId: trip.id,
        bookingId: booking.id,
        employeeId: booking.employeeId,
        date: trip.date,
        ...attPayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    store.update('bookings', booking.id, { status: boarded ? 'completed' : 'no-show' });
    updated += 1;
  }

  const boarded = store.filter('bookings', (b) => b.tripId === trip.id && b.status === 'completed').length;
  store.update('trips', trip.id, { passengersBoarded: boarded, passengersAllocated: store.filter('bookings', (b) => b.tripId === trip.id).length });

  audit(req, 'trips.attendance', `Marked ${updated} attendance entr${updated === 1 ? 'y' : 'ies'} on ${trip.id}`);
  res.json({ ok: true, updated, boarded });
});

/** POST /api/trips/:id/complete - close out a run with final readings. */
router.post('/:id/complete', requireRole('operations'), (req, res) => {
  const trip = store.find('trips', (t) => t.id === req.params.id);
  if (!trip) throw new ApiError(404, `Trip ${req.params.id} was not found.`);

  const { actualKm, fuelCost, tollCost, notes } = req.body || {};
  const updated = store.update('trips', trip.id, {
    status: 'completed',
    actualKm: actualKm !== undefined ? Number(actualKm) : trip.actualKm,
    fuelCost: fuelCost !== undefined ? Number(fuelCost) : trip.fuelCost,
    tollCost: tollCost !== undefined ? Number(tollCost) : trip.tollCost,
    notes: notes !== undefined ? notes : trip.notes,
    arrivalAt: new Date().toISOString(),
  });

  audit(req, 'trips.complete', `Completed trip ${trip.id}`);
  res.json({ data: updated });
});

/** POST /api/trips/:id/cancel */
router.post('/:id/cancel', requireRole('operations'), (req, res) => {
  const trip = store.find('trips', (t) => t.id === req.params.id);
  if (!trip) throw new ApiError(404, `Trip ${req.params.id} was not found.`);
  const reason = req.body?.reason || 'Cancelled by operations';

  const updated = store.update('trips', trip.id, { status: 'cancelled', notes: reason });
  for (const booking of store.filter('bookings', (b) => b.tripId === trip.id)) {
    store.update('bookings', booking.id, { status: 'cancelled' });
  }
  audit(req, 'trips.cancel', `Cancelled trip ${trip.id}: ${reason}`);
  res.json({ data: updated });
});

router.use('/', base);

module.exports = router;
