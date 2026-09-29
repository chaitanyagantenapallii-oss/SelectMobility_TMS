'use strict';

/**
 * Trip requests - the desk side of the Client app's "Request a ride".
 *
 * The Client app has always been able to raise a request, but the record it
 * wrote (`serviceRequests`) was read by nothing: there was no desk page for it,
 * no API, and no path from a request to an actual trip. A client typed a
 * paragraph, the row landed in a table nobody could open, and that was the end
 * of it. Requesting a ride was, in practice, a dead end.
 *
 * This module gives a request a lifecycle:
 *
 *   pending --approve--> scheduled (a real trip exists, crew assigned)
 *           --decline--> declined (reason recorded, client told why)
 *
 * Two request kinds are supported:
 *
 *   'ad-hoc-trip'  An extra journey that is not on any existing route. On
 *                  approval the desk names a route, vehicle, driver and shift,
 *                  and a real trip is created with the requester's staff booked
 *                  onto it.
 *   'route-seat'   Extra seats on a route that already runs. On approval the
 *                  requested headcount is booked onto the named trip.
 *
 * Requests raised before this module existed have no `kind`; they are treated as
 * 'general' and can be answered with a reply but not auto-converted, because
 * there is nothing structured to convert.
 */

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, today, nowIso, paginate } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requireRole('admin', 'operations', 'viewer'));
const canWrite = requireRole('operations');

const KINDS = ['ad-hoc-trip', 'route-seat', 'general'];
const STATUSES = ['pending', 'scheduled', 'declined', 'cancelled'];

/**
 * Resolve the employees a request refers to.
 *
 * The client app sends staff codes, not ids, because that is what it displays.
 * Unknown or out-of-company codes are dropped rather than rejected, so one bad
 * code does not destroy an otherwise valid request - but the count is kept so
 * the desk can see something was dropped.
 */
function resolveStaff(request, organisation) {
  const codes = Array.isArray(request.staffCodes) ? request.staffCodes : [];
  const found = [];
  const missing = [];

  for (const code of codes) {
    const emp = store.find(
      'employees',
      (e) => e.code === code && e.organisation === organisation,
    );
    if (emp) found.push(emp);
    else missing.push(code);
  }
  return { found, missing };
}

/** Attach display fields the desk and the phone both need. */
function decorate(record) {
  const trip = record.tripId ? store.find('trips', (t) => t.id === record.tripId) : null;
  const vehicle = record.assignedVehicleId
    ? store.find('vehicles', (v) => v.id === record.assignedVehicleId)
    : trip
      ? store.find('vehicles', (v) => v.id === trip.vehicleId)
      : null;
  const driver = record.assignedDriverId
    ? store.find('drivers', (d) => d.id === record.assignedDriverId)
    : trip
      ? store.find('drivers', (d) => d.id === trip.driverId)
      : null;
  const route = record.routeId ? store.find('routes', (r) => r.id === record.routeId) : null;
  const company = store.find('organisations', (o) => o.name === record.organisation);

  return {
    ...record,
    companyId: company ? company.id : null,
    tripRef: trip ? trip.id : null,
    tripStatus: trip ? trip.status : null,
    routeName: route ? `${route.code} - ${route.name}` : null,
    vehicleRegNo: vehicle ? vehicle.regNo : null,
    driverName: driver ? driver.name : null,
    driverPhone: driver ? driver.phone : null,
    // What the client app shows as the answer to their request.
    resolution: record.status === 'scheduled' && trip
      ? {
        tripId: trip.id,
        date: trip.date,
        departureAt: trip.departureAt,
        vehicleRegNo: vehicle ? vehicle.regNo : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        routeName: route ? route.name : null,
      }
      : null,
  };
}

/** Recommend an available crew for a client request without creating a trip. */
router.get('/:id/recommendation', canWrite, (req, res, next) => {
  try {
    const record = store.find('serviceRequests', (r) => r.id === req.params.id);
    if (!record) throw new ApiError(404, `Request ${req.params.id} was not found.`);
    if (record.status !== 'pending') throw new ApiError(409, 'Only pending requests can be allocated.');
    const date = record.date || today();
    const seatsNeeded = Number(record.headcount) || 1;
    const occupiedVehicles = new Set(store.filter('trips', (t) => t.date === date && !['cancelled', 'completed'].includes(t.status)).map((t) => t.vehicleId));
    const occupiedDrivers = new Set(store.filter('trips', (t) => t.date === date && !['cancelled', 'completed'].includes(t.status)).map((t) => t.driverId));
    const vehicle = store.collection('vehicles')
      .filter((v) => v.status === 'active' && Number(v.seats || 0) >= seatsNeeded && !occupiedVehicles.has(v.id))
      .sort((a, b) => Number(a.seats || 0) - Number(b.seats || 0))[0];
    const driver = store.collection('drivers')
      .filter((d) => d.status === 'active' && !occupiedDrivers.has(d.id))
      .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))[0];
    const route = store.collection('routes').find((r) => {
      const text = `${r.name} ${r.code}`.toLowerCase();
      return [record.pickupPoint, record.dropPoint].filter(Boolean).some((p) => text.includes(String(p).toLowerCase()));
    }) || store.collection('routes')[0];
    const shift = route ? store.find('shifts', (s) => s.id === route.shiftId) : store.collection('shifts')[0];
    res.json({ data: { vehicle: vehicle || null, driver: driver || null, route: route || null, shift: shift || null, seatsNeeded, confidence: vehicle && driver ? 'recommended' : 'manual-review' } });
  } catch (err) { next(err); }
});

/** GET /api/trip-requests?status=&organisation=&kind= */
router.get('/', (req, res) => {
  let rows = store.collection('serviceRequests').slice();

  for (const field of ['status', 'organisation', 'kind', 'priority', 'category']) {
    const raw = req.query[field];
    if (raw === undefined || raw === '' || raw === 'all') continue;
    const values = String(raw).split(',').map((v) => v.trim());
    rows = rows.filter((r) => values.includes(String(r[field] || '')));
  }
  if (req.query.search) {
    const needle = String(req.query.search).toLowerCase();
    rows = rows.filter((r) =>
      ['subject', 'detail', 'raisedByName', 'id', 'organisation'].some((f) =>
        String(r[f] || '').toLowerCase().includes(needle),
      ),
    );
  }

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const data = rows.map(decorate);
  const usePaging = req.query.page !== undefined || req.query.pageSize !== undefined;
  if (usePaging) {
    const { data: page, meta } = paginate(data, req.query);
    return res.json({ data: page, meta });
  }

  const counts = {
    total: data.length,
    pending: data.filter((r) => r.status === 'pending').length,
    scheduled: data.filter((r) => r.status === 'scheduled').length,
    declined: data.filter((r) => r.status === 'declined').length,
  };
  res.json({ data, meta: counts });
});

/** GET /api/trip-requests/:id */
router.get('/:id', (req, res) => {
  const record = store.find('serviceRequests', (r) => r.id === req.params.id);
  if (!record) throw new ApiError(404, `Request ${req.params.id} was not found.`);
  const { found, missing } = resolveStaff(record, record.organisation);
  res.json({ data: { ...decorate(record), staff: found.map((e) => ({ id: e.id, code: e.code, name: e.name, stop: e.stop })), unknownStaffCodes: missing } });
});

/**
 * POST /api/trip-requests/:id/approve
 *
 * Body for kind 'ad-hoc-trip':
 *   { trip: { routeId, vehicleId, driverId, shiftId, date, departureAt, plannedKm?, notes? } }
 * Body for kind 'route-seat':
 *   { tripId }   - an existing scheduled trip to add seats to
 *
 * Creates the trip (or books seats), links the request to it, and flips the
 * status so the client app can show the answer.
 */
router.post('/:id/approve', canWrite, (req, res) => {
  const record = store.find('serviceRequests', (r) => r.id === req.params.id);
  if (!record) throw new ApiError(404, `Request ${req.params.id} was not found.`);
  if (record.status === 'scheduled') {
    throw new ApiError(409, `Request ${record.id} has already been scheduled.`);
  }
  if (record.status === 'declined') {
    throw new ApiError(409, `Request ${record.id} was declined. Reopen it before approving.`);
  }

  const kind = record.kind || 'general';
  if (kind === 'general') {
    throw new ApiError(
      400,
      'This request has no structured trip details (it predates ride requests). Answer it with a reply instead.',
    );
  }

  const { found: staff, missing } = resolveStaff(record, record.organisation);
  const body = req.body || {};

  let trip = null;

  if (kind === 'route-seat') {
    if (!body.tripId) throw new ApiError(400, 'Choose the trip to add these seats to.');
    trip = store.find('trips', (t) => t.id === body.tripId);
    if (!trip) throw new ApiError(404, `Trip ${body.tripId} was not found.`);
    if (trip.status === 'completed' || trip.status === 'cancelled') {
      throw new ApiError(409, `Trip ${trip.id} is ${trip.status} and cannot take new passengers.`);
    }
  } else {
    const spec = body.trip || {};
    for (const field of ['routeId', 'vehicleId', 'driverId', 'shiftId']) {
      if (!spec[field]) {
        throw new ApiError(400, `Assign a ${field.replace('Id', '')} before approving this request.`);
      }
    }
    if (!store.find('routes', (r) => r.id === spec.routeId)) throw new ApiError(400, `Route ${spec.routeId} does not exist.`);
    if (!store.find('vehicles', (v) => v.id === spec.vehicleId)) throw new ApiError(400, `Vehicle ${spec.vehicleId} does not exist.`);
    if (!store.find('drivers', (d) => d.id === spec.driverId)) throw new ApiError(400, `Driver ${spec.driverId} does not exist.`);
    if (!store.find('shifts', (s) => s.id === spec.shiftId)) throw new ApiError(400, `Shift ${spec.shiftId} does not exist.`);

    const vehicle = store.find('vehicles', (v) => v.id === spec.vehicleId);
    const seatsNeeded = record.headcount || staff.length || 1;
    if (vehicle && vehicle.seats && seatsNeeded > vehicle.seats) {
      throw new ApiError(
        400,
        `${vehicle.regNo} seats ${vehicle.seats}, but this request is for ${seatsNeeded}. Pick a larger vehicle.`,
      );
    }

    const shift = store.find('shifts', (s) => s.id === spec.shiftId);
    const route = store.find('routes', (r) => r.id === spec.routeId);
    const date = spec.date || record.date || today();

    // Departure defaults to the shift's pickup window start, so the desk can
    // leave it blank. Shifts store `pickupStart`/`pickupEnd`, not `startTime`.
    let departureAt = spec.departureAt || null;
    if (!departureAt && shift && shift.pickupStart) {
      departureAt = `${date}T${String(shift.pickupStart).slice(0, 5)}:00`;
    }

    trip = {
      id: store.nextId('trips', 'TRP'),
      date,
      status: 'scheduled',
      driverAcceptance: 'pending',
      routeId: spec.routeId,
      vehicleId: spec.vehicleId,
      driverId: spec.driverId,
      shiftId: spec.shiftId,
      plannedKm: Number(spec.plannedKm) || (route ? route.distanceKm : 0) || 0,
      actualKm: 0,
      fuelCost: 0,
      tollCost: 0,
      departureAt,
      arrivalAt: null,
      notes: String(spec.notes || `Ad-hoc trip requested by ${record.organisation}`).slice(0, 500),
      // Traceability: this trip exists because of a client request.
      sourceRequestId: record.id,
      organisation: record.organisation,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.insert('trips', trip);

    /*
     * Book the staff onto the new trip.
     *
     * If the request named specific people we book those; otherwise we fall back
     * to every active employee of the company whose route matches, which is the
     * same rule the desk's own "create trip" path uses. Either way the driver app
     * gets a manifest instead of an empty trip.
     */
    const toBook = staff.length
      ? staff
      : store
        .filter('employees', (e) => e.organisation === record.organisation
          && e.routeId === spec.routeId
          && e.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const emp of toBook) {
      store.insert('bookings', {
        id: store.nextId('bookings', 'BKG'),
        tripId: trip.id,
        employeeId: emp.id,
        stop: emp.stop,
        status: 'confirmed',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }

    store.update('trips', trip.id, {
      passengersAllocated: toBook.length,
      passengersBoarded: 0,
      updatedAt: nowIso(),
    });
  }

  const bookings = store.filter('bookings', (b) => b.tripId === trip.id);
  store.update('serviceRequests', record.id, {
    status: 'scheduled',
    tripId: trip.id,
    routeId: trip.routeId,
    assignedVehicleId: trip.vehicleId,
    assignedDriverId: trip.driverId,
    decidedBy: req.user.email,
    decidedAt: nowIso(),
    response: body.response
      ? String(body.response).slice(0, 1000)
      : `Approved. ${trip.id} on ${trip.date} with ${bookings.length} seat(s) booked.`,
    updatedAt: nowIso(),
  });

  audit(req, 'tripRequests.approve', `Approved ${record.id} -> trip ${trip.id} (${bookings.length} seats)`);

  const updated = store.find('serviceRequests', (r) => r.id === record.id);
  res.json({
    data: decorate(updated),
    trip: { id: trip.id, date: trip.date, status: trip.status, seats: bookings.length },
    message: `Approved. Trip ${trip.id} created with ${bookings.length} passenger(s).`,
  });
});

/** POST /api/trip-requests/:id/decline  Body: { reason } */
router.post('/:id/decline', canWrite, (req, res) => {
  const record = store.find('serviceRequests', (r) => r.id === req.params.id);
  if (!record) throw new ApiError(404, `Request ${req.params.id} was not found.`);
  if (record.status === 'scheduled') {
    throw new ApiError(409, 'This request already became a trip. Cancel the trip instead.');
  }

  const reason = String((req.body && req.body.reason) || '').trim();
  if (reason.length < 5) {
    // The reason is shown to the client, so an empty one is useless to them.
    throw new ApiError(400, 'Give a short reason. The client sees it on their request.');
  }

  store.update('serviceRequests', record.id, {
    status: 'declined',
    response: reason.slice(0, 1000),
    decidedBy: req.user.email,
    decidedAt: nowIso(),
    updatedAt: nowIso(),
  });

  audit(req, 'tripRequests.decline', `Declined ${record.id}: ${reason}`);
  res.json({ data: decorate(store.find('serviceRequests', (r) => r.id === record.id)) });
});

/** POST /api/trip-requests/:id/reply  Body: { response } - answer without deciding. */
router.post('/:id/reply', canWrite, (req, res) => {
  const record = store.find('serviceRequests', (r) => r.id === req.params.id);
  if (!record) throw new ApiError(404, `Request ${req.params.id} was not found.`);

  const response = String((req.body && req.body.response) || '').trim();
  if (!response) throw new ApiError(400, 'Type a reply first.');

  store.update('serviceRequests', record.id, {
    response: response.slice(0, 1000),
    repliedBy: req.user.email,
    repliedAt: nowIso(),
    updatedAt: nowIso(),
  });

  audit(req, 'tripRequests.reply', `Replied to ${record.id}`);
  res.json({ data: decorate(store.find('serviceRequests', (r) => r.id === record.id)) });
});

module.exports = router;
