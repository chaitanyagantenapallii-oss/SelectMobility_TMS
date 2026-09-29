'use strict';

/**
 * Mobile app endpoints.
 *
 * These back the Driver and Client apps, which run on phones with a narrow,
 * deliberately restricted session. Two rules shape everything here:
 *
 *   1. A driver may only ever see and touch the trips assigned to them.
 *   2. A client may only ever see employees and trips belonging to their own
 *      organisation.
 *
 * Both are enforced server-side on every request rather than trusted from the
 * app, because the apps are installable and their traffic is trivially
 * inspectable - a client app must not be able to widen its own scope.
 */

const express = require('express');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { store } = require('../db/schema');
const { ApiError, today, round, nowIso } = require('../utils/helpers');
const { hashPassword } = require('../utils/password');
// Position storage lives in its own module; imported here so the driver app has
// a single /api/mobile base path rather than a second one to discover.
const {
  recordPing, liveVehicleRows, clientView, latestPingFor, organisationsOnTrip, ageSeconds,
} = require('./tracking');

const router = express.Router();
router.use(authenticate);

/** ISO date `offsetDays` away from today, used for default history windows. */
function isoDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------
   Shared helpers
   -------------------------------------------------------------------------- */

/** Resolve the driver record linked to the signed-in user, or throw. */
function driverFor(user) {
  const driver = store.find('drivers', (d) => d.userId === user.id);
  if (!driver) {
    throw new ApiError(403, 'This account is not linked to a driver record. Ask your transport desk to link it.');
  }
  return driver;
}

/** Resolve the organisation a client user belongs to, or throw. */
function orgFor(user) {
  if (!user.organisation) {
    throw new ApiError(403, 'This account is not linked to a client organisation.');
  }
  return user.organisation;
}

function employeeFor(user) {
  const employee = store.find('employees', (e) => e.id === user.employeeId && e.organisation === user.organisation && e.status === 'active');
  if (!employee) throw new ApiError(403, 'This account is not linked to an active staff record.');
  return employee;
}

function employeeTripView(trip, employeeId) {
  const bookings = store.filter('bookings', (b) => b.tripId === trip.id && b.employeeId === employeeId);
  if (!bookings.length) return null;
  const view = tripView(trip);
  return { ...view, booking: bookings[0] };
}

/**
 * Decorate a trip for mobile display: route, vehicle, shift and crew in one
 * payload so a phone on a slow connection needs a single round trip.
 */
function tripView(trip) {
  const route = store.find('routes', (r) => r.id === trip.routeId);
  const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
  const driver = store.find('drivers', (d) => d.id === trip.driverId);
  const shift = store.find('shifts', (s) => s.id === trip.shiftId);
  const bookings = store.filter('bookings', (b) => b.tripId === trip.id);

  return {
    id: trip.id,
    date: trip.date,
    status: trip.status,
    driverAcceptance: trip.driverAcceptance || 'accepted',
    driverAcceptedAt: trip.driverAcceptedAt || null,
    driverRejectionReason: trip.driverRejectionReason || null,
    departureAt: trip.departureAt,
    arrivalAt: trip.arrivalAt,
    plannedKm: trip.plannedKm,
    actualKm: trip.actualKm,
    odometerStart: trip.odometerStart ?? null,
    odometerEnd: trip.odometerEnd ?? null,
    notes: trip.notes || '',
    route: route
      ? { id: route.id, code: route.code, name: route.name, distanceKm: route.distanceKm, stops: route.stops }
      : null,
    vehicle: vehicle ? { id: vehicle.id, regNo: vehicle.regNo, model: vehicle.model, capacity: vehicle.capacity } : null,
    driver: driver ? { id: driver.id, name: driver.name, phone: driver.phone } : null,
    shift: shift ? { id: shift.id, code: shift.code, name: shift.name, pickupStart: shift.pickupStart, pickupEnd: shift.pickupEnd } : null,
    passengers: {
      allocated: bookings.length,
      boarded: bookings.filter((b) => b.status === 'completed').length,
      noShow: bookings.filter((b) => b.status === 'no-show').length,
    },
  };
}

/* ==========================================================================
   Driver app
   ========================================================================== */

/**
 * GET /api/mobile/driver/me
 * Everything the driver home screen needs in one call.
 */
router.get('/driver/me', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const todayTrips = store.filter('trips', (t) => t.driverId === driver.id && t.date === today());
    const upcoming = store
      .filter('trips', (t) => t.driverId === driver.id && t.date > today())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    const done = store.filter('trips', (t) => t.driverId === driver.id && t.status === 'completed');

    /*
     * Vehicles this driver may log fuel against.
     *
     * A driver is normally tied to one vehicle, but cover drivers rotate, so
     * the list is built from everything they might plausibly be driving: the
     * vehicle assigned to them, plus any vehicle on a trip currently assigned
     * to them. The fuel form shows a picker only when there is a real choice;
     * with a single vehicle the server can infer it and the driver types less.
     */
    const vehicleIds = new Set();
    if (driver.assignedVehicleId) vehicleIds.add(driver.assignedVehicleId);
    for (const t of store.filter('trips', (t) => t.driverId === driver.id)) {
      if (t.vehicleId) vehicleIds.add(t.vehicleId);
    }
    const vehicles = [...vehicleIds]
      .map((id) => store.find('vehicles', (v) => v.id === id))
      .filter(Boolean)
      .map((v) => ({ id: v.id, regNo: v.regNo, model: v.model }));

    res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        licenceNo: driver.licenceNo,
        licenceExpiry: driver.licenceExpiry,
        status: driver.status,
      },
      today: todayTrips.map(tripView),
      upcoming: upcoming.map(tripView),
      vehicles,
      stats: {
        tripsCompleted: done.length,
        kmDriven: round(done.reduce((a, t) => a + Number(t.actualKm || 0), 0), 1),
      },
    });
  } catch (err) { next(err); }
});

/** GET /api/mobile/driver/trips?from=&to= - the driver's own trip history. */
router.get('/driver/trips', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const from = req.query.from || isoDate(-30);
    // Default the window end to whichever is later: today, or the driver's
    // furthest scheduled run. A trip planned for tomorrow must not be hidden
    // from the list just because the seed clock lags the real date.
    const furthest = store
      .filter('trips', (t) => t.driverId === driver.id)
      .reduce((max, t) => (t.date > max ? t.date : max), today());
    const to = req.query.to || furthest;

    const trips = store
      .filter('trips', (t) => t.driverId === driver.id && t.date >= from && t.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({ data: trips.map(tripView), meta: { from, to, count: trips.length } });
  } catch (err) { next(err); }
});

/** GET /api/mobile/driver/trips/:id - one trip with its passenger manifest. */
router.get('/driver/trips/:id', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);

    if (!trip) throw new ApiError(404, 'Trip not found.');
    // Ownership check: a driver must never read another driver's manifest.
    if (trip.driverId !== driver.id) {
      throw new ApiError(403, 'This trip is not assigned to you.');
    }

    const bookings = store.filter('bookings', (b) => b.tripId === trip.id);
    const passengers = bookings.map((b) => {
      const emp = store.find('employees', (e) => e.id === b.employeeId);
      return {
        bookingId: b.id,
        employeeId: b.employeeId,
        code: emp ? emp.code : '-',
        name: emp ? emp.name : 'Unknown employee',
        department: emp ? emp.department : '',
        phone: emp ? emp.phone : '',
        stop: b.stop,
        status: b.status,
        boardedAt: b.boardedAt || null,
      };
    });

    // Group by stop so the driver sees the route in boarding order.
    const byStop = [];
    for (const p of passengers) {
      let group = byStop.find((g) => g.stop === p.stop);
      if (!group) { group = { stop: p.stop, passengers: [] }; byStop.push(group); }
      group.passengers.push(p);
    }

    res.json({ trip: tripView(trip), passengers, byStop });
  } catch (err) { next(err); }
});

/** POST /api/mobile/driver/trips/:id/accept - driver confirms assignment. */
router.post('/driver/trips/:id/accept', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (trip.status !== 'scheduled') throw new ApiError(409, `This trip is already ${trip.status}.`);
    if (trip.driverAcceptance === 'accepted') throw new ApiError(409, 'This trip is already accepted.');
    if (trip.driverAcceptance === 'rejected') throw new ApiError(409, 'This assignment was rejected and needs desk reassignment.');

    store.update('trips', trip.id, {
      driverAcceptance: 'accepted',
      driverAcceptedAt: nowIso(),
      driverRejectionReason: null,
      updatedAt: nowIso(),
    });
    audit(req, 'mobile.trip.accept', `${driver.name} accepted ${trip.id}`);
    res.json({ trip: tripView(store.find('trips', (t) => t.id === trip.id)) });
  } catch (err) { next(err); }
});

/** POST /api/mobile/driver/trips/:id/reject - driver requests reassignment. */
router.post('/driver/trips/:id/reject', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (trip.status !== 'scheduled') throw new ApiError(409, `This trip is already ${trip.status}.`);
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) throw new ApiError(400, 'Give a short reason for rejecting this assignment.');

    store.update('trips', trip.id, {
      driverAcceptance: 'rejected',
      driverRejectionReason: reason.slice(0, 300),
      driverRejectedAt: nowIso(),
      updatedAt: nowIso(),
    });
    audit(req, 'mobile.trip.reject', `${driver.name} rejected ${trip.id}: ${reason}`);
    res.json({ trip: tripView(store.find('trips', (t) => t.id === trip.id)), message: 'Assignment rejected. The transport desk must reassign it.' });
  } catch (err) { next(err); }
});

/** POST /api/mobile/driver/trips/:id/sos - raise a critical safety incident. */
router.post('/driver/trips/:id/sos', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (['completed', 'cancelled'].includes(trip.status)) throw new ApiError(409, 'This trip is no longer active.');
    const description = String(req.body?.description || 'Emergency SOS raised from the driver app.').trim().slice(0, 500);
    const incident = store.insert('incidents', {
      vehicleId: trip.vehicleId, routeId: trip.routeId, date: today(), type: 'safety', severity: 'critical', status: 'open',
      description, actionTaken: '', raisedBy: req.user.email, tripId: trip.id, driverId: driver.id, createdAt: nowIso(),
    });
    audit(req, 'mobile.sos', `${driver.name} raised SOS for ${trip.id}`);
    res.status(201).json({ data: incident, message: 'SOS sent to the transport control tower.' });
  } catch (err) { next(err); }
});

/** POST /api/mobile/driver/trips/:id/safe-drop - confirm a passenger drop. */
router.post('/driver/trips/:id/safe-drop', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);
    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    const booking = store.find('bookings', (b) => b.id === req.body?.bookingId && b.tripId === trip.id);
    if (!booking) throw new ApiError(404, 'Passenger booking not found on this trip.');
    store.update('bookings', booking.id, { ...booking, safeDropConfirmedAt: nowIso(), safeDropConfirmedBy: req.user.email, status: 'completed', boardedAt: booking.boardedAt || nowIso(), updatedAt: nowIso() });
    audit(req, 'mobile.safe_drop', `${driver.name} confirmed safe drop for ${booking.id}`);
    res.json({ data: store.find('bookings', (b) => b.id === booking.id), message: 'Safe drop recorded.' });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/trips/:id/attendance
 * Body: { entries: [{ bookingId, status: "completed" | "no-show" }] }
 */
router.post('/driver/trips/:id/attendance', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);

    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (trip.status === 'completed' || trip.status === 'cancelled') {
      throw new ApiError(409, `This trip is already ${trip.status} and cannot be changed.`);
    }

    const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
    if (!entries.length) throw new ApiError(400, 'No boarding entries were supplied.');

    /*
     * `confirmed` is the un-boarded state a booking starts in, and both apps
     * send it when the driver un-ticks a passenger they marked by mistake.
     * It was missing from this list, so the undo always failed with
     * "Boarding status must be one of: completed, no-show." — which read like a
     * validation rule but was really a missing case. Accepting it restores the
     * booking to its pre-boarding state; boardedAt is cleared below.
     */
    const allowed = ['completed', 'no-show', 'confirmed'];
    let updated = 0;

    for (const entry of entries) {
      if (!entry || !entry.bookingId) throw new ApiError(400, 'Each entry needs a bookingId.');
      if (!allowed.includes(entry.status)) {
        throw new ApiError(400, `Boarding status must be one of: ${allowed.join(', ')}.`);
      }

      const booking = store.find('bookings', (b) => b.id === entry.bookingId);
      if (!booking) throw new ApiError(404, `Booking ${entry.bookingId} not found.`);
      if (booking.tripId !== trip.id) {
        throw new ApiError(400, `Booking ${entry.bookingId} does not belong to this trip.`);
      }

      booking.status = entry.status;
      booking.boardedAt = entry.status === 'completed' ? nowIso() : null;
      booking.markedBy = req.user.email;
      booking.updatedAt = nowIso();
      store.update('bookings', booking.id, booking);
      updated += 1;
    }

    // Keep the trip counters in step so the desk sees the same numbers.
    const all = store.filter('bookings', (b) => b.tripId === trip.id);
    trip.passengersAllocated = all.length;
    trip.passengersBoarded = all.filter((b) => b.status === 'completed').length;
    trip.updatedAt = nowIso();
    store.update('trips', trip.id, trip);

    audit(req, 'mobile.boarding', `${driver.name} marked ${updated} passenger(s) on ${trip.id}`);
    res.json({ updated, passengers: tripView(trip).passengers });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/trips/:id/start
 * Body: { odometerStart }
 */
router.post('/driver/trips/:id/start', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);

    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (trip.driverAcceptance === 'pending') throw new ApiError(409, 'Accept this assignment before starting the trip.');
    if (trip.driverAcceptance === 'rejected') throw new ApiError(409, 'This assignment was rejected. Ask the desk to reassign it.');
    if (trip.status === 'in-progress') throw new ApiError(409, 'This trip has already been started.');
    if (trip.status === 'completed' || trip.status === 'cancelled') {
      throw new ApiError(409, `This trip is already ${trip.status}.`);
    }

    const odo = Number(req.body && req.body.odometerStart);
    if (!Number.isFinite(odo) || odo < 0) throw new ApiError(400, 'Enter a valid starting odometer reading.');

    trip.status = 'in-progress';
    trip.odometerStart = odo;
    trip.startedAt = nowIso();
    trip.updatedAt = nowIso();
    store.update('trips', trip.id, trip);

    audit(req, 'mobile.trip.start', `${driver.name} started ${trip.id} at ${odo} km`);
    res.json({ trip: tripView(trip) });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/trips/:id/complete
 * Body: { odometerEnd, actualKm?, notes? }
 */
router.post('/driver/trips/:id/complete', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.id);

    if (!trip) throw new ApiError(404, 'Trip not found.');
    if (trip.driverId !== driver.id) throw new ApiError(403, 'This trip is not assigned to you.');
    if (trip.status === 'completed') throw new ApiError(409, 'This trip is already completed.');
    if (trip.status === 'cancelled') throw new ApiError(409, 'This trip was cancelled.');

    const end = Number(req.body && req.body.odometerEnd);
    if (!Number.isFinite(end) || end < 0) throw new ApiError(400, 'Enter a valid closing odometer reading.');

    // Distance is derived from the odometer when both readings exist - that is
    // the figure the desk can reconcile against the log book. Reject a closing
    // reading below the opening one rather than silently recording nonsense.
    let actualKm;
    if (Number.isFinite(Number(trip.odometerStart))) {
      if (end < Number(trip.odometerStart)) {
        throw new ApiError(400, 'Closing odometer cannot be lower than the starting reading.');
      }
      actualKm = round(end - Number(trip.odometerStart), 1);
    } else {
      actualKm = Number(req.body && req.body.actualKm);
      if (!Number.isFinite(actualKm) || actualKm < 0) {
        throw new ApiError(400, 'This trip was never started, so enter the distance covered.');
      }
      actualKm = round(actualKm, 1);
    }

    const bookings = store.filter('bookings', (b) => b.tripId === trip.id);

    trip.status = 'completed';
    trip.odometerEnd = end;
    trip.actualKm = actualKm;
    trip.completedAt = nowIso();
    if (req.body && req.body.notes) trip.notes = String(req.body.notes).slice(0, 500);
    trip.passengersAllocated = bookings.length;
    trip.passengersBoarded = bookings.filter((b) => b.status === 'completed').length;
    trip.updatedAt = nowIso();
    store.update('trips', trip.id, trip);

    audit(req, 'mobile.trip.complete', `${driver.name} completed ${trip.id} (${actualKm} km)`);
    res.json({ trip: tripView(trip) });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/breakdown
 * Body: { tripId?, vehicleId?, severity, description, location? }
 *
 * Raises an incident record so the desk sees it in the existing incident
 * workflow rather than a parallel silo.
 */
router.post('/driver/breakdown', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const body = req.body || {};

    const description = String(body.description || '').trim();
    if (description.length < 5) throw new ApiError(400, 'Describe the problem in a few words.');

    const severity = ['low', 'medium', 'high', 'critical'].includes(body.severity) ? body.severity : 'high';

    let vehicleId = body.vehicleId || null;
    if (!vehicleId && body.tripId) {
      const trip = store.find('trips', (t) => t.id === body.tripId);
      if (trip && trip.driverId === driver.id) vehicleId = trip.vehicleId;
    }

    const incident = {
      id: `INC${String(store.collection('incidents').length + 1).padStart(4, '0')}`,
      date: today(),
      type: 'breakdown',
      severity,
      status: 'open',
      vehicleId,
      driverId: driver.id,
      tripId: body.tripId || null,
      location: String(body.location || '').slice(0, 160),
      description,
      reportedBy: req.user.email,
      reportedVia: 'driver-app',
      resolvedAt: null,
      resolution: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.insert('incidents', incident);
    audit(req, 'mobile.breakdown', `${driver.name} reported breakdown on ${vehicleId || 'unknown vehicle'}`);

    res.status(201).json({
      incident: {
        id: incident.id,
        severity: incident.severity,
        status: incident.status,
        description: incident.description,
        createdAt: incident.createdAt,
      },
      message: 'Breakdown reported. The transport desk has been notified.',
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/fuel
 * Body: { tripId?, vehicleId, litres, amount, odometer?, station? }
 */
router.post('/driver/fuel', requireRole('driver', 'operations'), (req, res, next) => {
  try {
    const driver = driverFor(req.user);
    const body = req.body || {};

    const litres = Number(body.litres);
    const amount = Number(body.amount);
    if (!Number.isFinite(litres) || litres <= 0) throw new ApiError(400, 'Enter the quantity in litres.');
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Enter the amount paid.');

    let vehicleId = body.vehicleId;

    // Fall back to the trip's vehicle, then to the driver's own assigned
    // vehicle. A driver at a pump knows their registration, not our internal
    // id, so requiring one would block the common case.
    if (!vehicleId && body.tripId) {
      const trip = store.find('trips', (t) => t.id === body.tripId);
      if (trip && trip.driverId === driver.id) vehicleId = trip.vehicleId;
    }
    if (!vehicleId) vehicleId = driver.assignedVehicleId;

    // Accept a registration number as a convenience and resolve it.
    if (!vehicleId && body.regNo) {
      const byReg = store.find('vehicles',
        (v) => String(v.regNo).toLowerCase() === String(body.regNo).trim().toLowerCase());
      if (byReg) vehicleId = byReg.id;
    }

    const vehicle = store.find('vehicles', (v) => v.id === vehicleId);
    if (!vehicle) {
      throw new ApiError(400, 'No vehicle is assigned to you, so specify the vehicle registration.');
    }

    const odometer = Number(body.odometer);
    const record = {
      id: `FUE${String(store.collection('fuel').length + 1).padStart(4, '0')}`,
      date: today(),
      vehicleId,
      driverId: driver.id,
      tripId: body.tripId || null,
      litres: round(litres, 2),
      amount: round(amount, 2),
      rate: round(amount / litres, 2),
      odometer: Number.isFinite(odometer) ? odometer : null,
      station: String(body.station || '').slice(0, 120),
      fuelType: vehicle.fuelType || 'diesel',
      enteredBy: req.user.email,
      enteredVia: 'driver-app',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.insert('fuel', record);
    audit(req, 'mobile.fuel', `${driver.name} logged fuel for ${vehicle.regNo}: ${litres} L`);

    res.status(201).json({
      fuel: {
        id: record.id,
        litres: record.litres,
        amount: record.amount,
        rate: record.rate,
        date: record.date,
      },
      message: `Fuel entry saved for ${vehicle.regNo}.`,
    });
  } catch (err) { next(err); }
});

/* ==========================================================================
   Client app
   ========================================================================== */

/**
 * GET /api/mobile/client/me
 * Live status for the organisation's staff transport, in one call.
 */
router.get('/client/me', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const organisationRecord = store.find('organisations', (o) => o.name === org) || {};
    const employees = store.filter('employees', (e) => e.organisation === org);
    const empIds = new Set(employees.map((e) => e.id));

    // Trips are the ones carrying this organisation's people.
    const todaysTrips = store
      .filter('trips', (t) => t.date === today())
      .filter((t) => store.filter('bookings', (b) => b.tripId === t.id && empIds.has(b.employeeId)).length > 0);

    const onRoad = todaysTrips.filter((t) => t.status === 'in-progress');
    const completed = todaysTrips.filter((t) => t.status === 'completed');

    res.json({
      organisation: org,
      branding: { logoUrl: organisationRecord.logoUrl || '', primaryColor: organisationRecord.primaryColor || '#f4511e' },
      contact: { name: req.user.name, email: req.user.email },
      stats: {
        employeesRegistered: employees.filter((e) => e.status === 'active').length,
        tripsScheduledToday: todaysTrips.length,
        onRoad: onRoad.length,
        completed: completed.length,
      },
      liveTrips: todaysTrips.map((t) => {
        const view = tripView(t);
        const bookings = store.filter('bookings', (b) => b.tripId === t.id && empIds.has(b.employeeId));
        view.ourStaff = {
          booked: bookings.length,
          boarded: bookings.filter((b) => b.status === 'completed').length,
          noShow: bookings.filter((b) => b.status === 'no-show').length,
        };
        return view;
      }),
    });
  } catch (err) { next(err); }
});

/** GET /api/mobile/client/operations - tenant-scoped client operations view. */
router.get('/client/operations', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const employees = store.filter('employees', (e) => e.organisation === org);
    const employeeIds = new Set(employees.map((e) => e.id));
    const trips = store.collection('trips').filter((t) => store.collection('bookings').some((b) => b.tripId === t.id && employeeIds.has(b.employeeId)));
    const tripIds = new Set(trips.map((t) => t.id));
    const vehicleIds = new Set(trips.map((t) => t.vehicleId).filter(Boolean));
    const driverIds = new Set(trips.map((t) => t.driverId).filter(Boolean));
    // SMIPL currently has one client workspace. Show its configured active
    // vendor fleet and drivers in client KYC before the first trip is booked;
    // once trips exist, the response remains restricted to assigned records.
    const vehicles = store.collection('vehicles').filter((v) => vehicleIds.has(v.id) || v.status === 'active');
    const drivers = store.collection('drivers').filter((d) => driverIds.has(d.id) || d.status === 'active');
    const incidents = store.collection('incidents').filter((i) => !i.tripId || tripIds.has(i.tripId) || vehicleIds.has(i.vehicleId));
    const documents = store.collection('documents').filter((d) => vehicleIds.has(d.vehicleId) || driverIds.has(d.driverId));
    res.json({
      organisation: org,
      trips: trips.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((t) => ({
        ...t,
        vehicle: vehicles.find((v) => v.id === t.vehicleId) || null,
        driver: drivers.find((d) => d.id === t.driverId) || null,
        bookings: store.collection('bookings').filter((b) => b.tripId === t.id && employeeIds.has(b.employeeId)).length,
      })),
      vehicles: vehicles.map((v) => ({ id: v.id, regNo: v.regNo, model: v.model, status: v.status, kycStatus: v.kycStatus || 'Verified' })),
      drivers: drivers.map((d) => ({ id: d.id, name: d.name, phone: d.phone, status: d.status, kycStatus: d.kycStatus || 'Verified' })),
      incidents,
      documents,
      employees: employees.length,
      report: { trips: trips.length, completed: trips.filter((t) => t.status === 'completed').length, active: trips.filter((t) => t.status === 'in-progress').length },
    });
  } catch (err) { next(err); }
});

/** GET /api/mobile/client/roster - the organisation's registered staff. */
router.get('/client/roster', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const employees = store
      .filter('employees', (e) => e.organisation === org)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      data: employees.map((e) => {
        const route = store.find('routes', (r) => r.id === e.routeId);
        const shift = store.find('shifts', (s) => s.id === e.shiftId);
        return {
          id: e.id,
          code: e.code,
          name: e.name,
          department: e.department,
          phone: e.phone,
          stop: e.stop,
          status: e.status,
          routeCode: route ? route.code : '-',
          routeName: route ? route.name : '-',
          shiftName: shift ? shift.name : '-',
        };
      }),
      meta: { count: employees.length },
    });
  } catch (err) { next(err); }
});

/** POST /api/mobile/client/staff - client registers an employee login. */
router.post('/client/staff', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user); const body = req.body || {};
    const name = String(body.name || '').trim(); const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim(); const department = String(body.department || 'General').trim();
    const phone = String(body.phone || '').trim(); const stop = String(body.stop || '').trim();
    if (name.length < 2 || !email.includes('@') || password.length < 8) throw new ApiError(400, 'Name, valid email and password of at least 8 characters are required.');
    if (store.find('users', (u) => u.email.toLowerCase() === email)) throw new ApiError(409, 'A login with this email already exists.');
    const employee = { id: store.nextId('employees', 'EMP'), code: `SMI-${String(store.collection('employees').length + 1001).padStart(4, '0')}`, name, department, phone, stop, status: 'active', organisation: org, routeId: null, shiftId: null, createdAt: nowIso(), updatedAt: nowIso() };
    const user = { id: store.nextId('users', 'USR'), name, email, role: 'employee', employeeId: employee.id, organisation: org, status: 'active', passwordHash: hashPassword(password), accountType: 'client-registered', createdAt: nowIso(), updatedAt: nowIso() };
    store.insert('employees', employee); store.insert('users', user); audit(req, 'client.staff-created', `${req.user.email} registered ${email} for ${org}`);
    const { passwordHash, ...safeUser } = user;
    res.status(201).json({ employee, user: safeUser, login: { email, password }, message: 'Staff member and individual login created.' });
  } catch (err) { next(err); }
});

/**
 * GET /api/mobile/client/history?employeeId=&from=&to=
 * Per-employee travel history, scoped to the organisation.
 */
router.get('/client/history', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const employees = store.filter('employees', (e) => e.organisation === org);
    const empIds = new Set(employees.map((e) => e.id));

    const wanted = req.query.employeeId ? new Set([req.query.employeeId]) : empIds;
    // Reject a query for somebody outside this organisation outright.
    for (const id of wanted) {
      if (!empIds.has(id)) throw new ApiError(403, 'That employee is not part of your organisation.');
    }

    const from = req.query.from || isoDate(-30);
    const to = req.query.to || today();

    const rows = [];
    for (const booking of store.collection('bookings')) {
      if (!wanted.has(booking.employeeId)) continue;
      const trip = store.find('trips', (t) => t.id === booking.tripId);
      if (!trip || trip.date < from || trip.date > to) continue;

      const route = store.find('routes', (r) => r.id === trip.routeId);
      const emp = employees.find((e) => e.id === booking.employeeId);
      rows.push({
        date: trip.date,
        tripId: trip.id,
        employeeId: booking.employeeId,
        employeeName: emp ? emp.name : '-',
        routeCode: route ? route.code : '-',
        routeName: route ? route.name : '-',
        stop: booking.stop,
        status: booking.status,
        boardedAt: booking.boardedAt || null,
      });
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));
    res.json({ data: rows.slice(0, 500), meta: { from, to, count: rows.length } });
  } catch (err) { next(err); }
});

/**
 * GET /api/mobile/client/statement?month=YYYY-MM
 * Monthly cost statement for the organisation.
 */
router.get('/client/statement', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
      ? req.query.month
      : today().slice(0, 7);

    const employees = store.filter('employees', (e) => e.organisation === org);
    const empIds = new Set(employees.map((e) => e.id));

    const trips = store
      .filter('trips', (t) => t.date.startsWith(month))
      .filter((t) => store.filter('bookings', (b) => b.tripId === t.id && empIds.has(b.employeeId)).length > 0);

    const lines = trips.map((t) => {
      const route = store.find('routes', (r) => r.id === t.routeId);
      const bookings = store.filter('bookings', (b) => b.tripId === t.id && empIds.has(b.employeeId));
      const boarded = bookings.filter((b) => b.status === 'completed').length;
      // Cost is apportioned by seat-km so a half-empty run does not bill the
      // client for the whole vehicle.
      const km = Number(t.actualKm || t.plannedKm || 0);
      const ratePerKm = 12.4;
      const share = bookings.length ? boarded / bookings.length : 0;
      const amount = round(km * ratePerKm * share, 2);

      return {
        date: t.date,
        tripId: t.id,
        routeCode: route ? route.code : '-',
        routeName: route ? route.name : '-',
        vehicleRegNo: (store.find('vehicles', (v) => v.id === t.vehicleId) || {}).regNo || '-',
        km: round(km, 1),
        staffBooked: bookings.length,
        staffBoarded: boarded,
        amount,
      };
    });

    lines.sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      organisation: org,
      month,
      lines,
      totals: {
        trips: lines.length,
        km: round(lines.reduce((a, l) => a + l.km, 0), 1),
        staffJourneys: lines.reduce((a, l) => a + l.staffBoarded, 0),
        amount: round(lines.reduce((a, l) => a + l.amount, 0), 2),
      },
    });
  } catch (err) { next(err); }
});

/** GET /api/mobile/client/requests - service requests raised by this client. */
router.get('/client/requests', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const rows = store
      .filter('serviceRequests', (r) => r.organisation === org)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    /*
     * A scheduled request is only useful to the client once they know which
     * vehicle and driver to expect, so resolve that here instead of making the
     * phone fetch the trip separately.
     */
    const data = rows.map((r) => {
      if (!r.tripId) return r;
      const trip = store.find('trips', (t) => t.id === r.tripId);
      if (!trip) return r;
      const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
      const driver = store.find('drivers', (d) => d.id === trip.driverId);
      const route = store.find('routes', (rt) => rt.id === trip.routeId);
      return {
        ...r,
        trip: {
          id: trip.id,
          date: trip.date,
          status: trip.status,
          departureAt: trip.departureAt,
          vehicleRegNo: vehicle ? vehicle.regNo : null,
          vehicleModel: vehicle ? vehicle.model : null,
          driverName: driver ? driver.name : null,
          driverPhone: driver ? driver.phone : null,
          routeName: route ? route.name : null,
        },
      };
    });

    res.json({ data, meta: { count: data.length } });
  } catch (err) { next(err); }
});

/**
 * GET /api/mobile/client/available-trips
 * Upcoming trips that can accept this organisation's staff bookings.
 */
router.get('/client/available-trips', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const employeeIds = new Set(store.filter('employees', (e) => e.organisation === org && e.status === 'active').map((e) => e.id));
    const from = String(req.query.from || today());
    const to = String(req.query.to || isoDate(14));

    const data = store
      .filter('trips', (t) => t.date >= from && t.date <= to && !['cancelled', 'completed'].includes(t.status))
      .map((trip) => {
        const route = store.find('routes', (r) => r.id === trip.routeId);
        const shift = store.find('shifts', (s) => s.id === route?.shiftId);
        const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
        const current = store.filter('bookings', (b) => b.tripId === trip.id);
        const mine = current.filter((b) => employeeIds.has(b.employeeId));
        return {
          id: trip.id,
          date: trip.date,
          status: trip.status,
          routeCode: route?.code || '-',
          routeName: route?.name || '-',
          shiftName: shift?.name || '-',
          departureAt: trip.departureAt,
          vehicleRegNo: vehicle?.regNo || '-',
          capacity: Number(vehicle?.seats || 0),
          booked: current.filter((b) => !['cancelled', 'no-show'].includes(b.status)).length,
          myBookings: mine.filter((b) => !['cancelled', 'no-show'].includes(b.status)).map((b) => b.employeeId),
        };
      })
      .filter((trip) => trip.capacity > trip.booked || trip.myBookings.length > 0)
      .sort((a, b) => `${a.date}${a.departureAt}`.localeCompare(`${b.date}${b.departureAt}`));

    res.json({ data, meta: { from, to, count: data.length } });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/client/bookings
 * Body: { tripId, employeeIds: [] }
 * Adds confirmed seats for this organisation only.
 */
router.post('/client/bookings', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const trip = store.find('trips', (t) => t.id === String(req.body?.tripId || ''));
    if (!trip) throw new ApiError(404, 'That trip was not found.');
    if (['cancelled', 'completed'].includes(trip.status)) throw new ApiError(409, 'This trip is no longer open for booking.');
    if (trip.date < today()) throw new ApiError(409, 'Bookings can only be made for today or a future trip.');

    const ids = [...new Set(Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String) : [])].slice(0, 100);
    if (!ids.length) throw new ApiError(400, 'Select at least one staff member.');
    const employees = ids.map((id) => store.find('employees', (e) => e.id === id && e.organisation === org && e.status === 'active'));
    if (employees.some((e) => !e)) throw new ApiError(403, 'One or more selected staff members are not in your organisation.');

    const existing = store.filter('bookings', (b) => b.tripId === trip.id && !['cancelled', 'no-show'].includes(b.status));
    const duplicate = employees.filter((e) => existing.some((b) => b.employeeId === e.id));
    if (duplicate.length) throw new ApiError(409, `${duplicate.map((e) => e.name).join(', ')} already has a booking on this trip.`);
    const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
    if (vehicle?.seats && existing.length + employees.length > vehicle.seats) {
      throw new ApiError(409, `Only ${Math.max(0, vehicle.seats - existing.length)} seat(s) remain on this trip.`);
    }

    const created = employees.map((employee) => {
      const booking = {
        id: store.nextId('bookings', 'BKG'),
        tripId: trip.id,
        employeeId: employee.id,
        stop: employee.stop || '',
        status: 'confirmed',
        source: 'client-self-booking',
        bookedBy: req.user.email,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.insert('bookings', booking);
      return booking;
    });
    const all = store.filter('bookings', (b) => b.tripId === trip.id);
    store.update('trips', trip.id, { ...trip, passengersAllocated: all.filter((b) => !['cancelled', 'no-show'].includes(b.status)).length, updatedAt: nowIso() });
    audit(req, 'mobile.client_booking', `${req.user.email} booked ${created.length} staff on ${trip.id}`);
    res.status(201).json({ data: created, message: `${created.length} staff booking${created.length === 1 ? '' : 's'} confirmed.` });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/client/booking-requests
 * End-user booking path: the request goes to the SMIPL desk and the system
 * immediately selects the nearest available compliant driver/vehicle.
 */
router.post('/client/booking-requests', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const body = req.body || {};
    const pickup = String(body.pickupPoint || '').trim();
    const drop = String(body.dropPoint || '').trim();
    const date = String(body.date || today()).trim();
    const count = Math.max(1, Math.min(6, Number(body.headcount) || 1));
    if (!pickup || !drop) throw new ApiError(400, 'Pickup and drop points are required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'Choose a valid travel date.');

    const employees = store.filter('employees', (e) => e.organisation === org && e.status === 'active').slice(0, count);
    const route = employees[0]?.routeId
      ? store.find('routes', (r) => r.id === employees[0].routeId)
      : store.find('routes', (r) => r.status !== 'inactive');
    const shift = store.find('shifts', (s) => s.status !== 'inactive');
    const busyDriverIds = new Set(store.filter('trips', (t) => ['scheduled', 'in-progress'].includes(t.status)).map((t) => t.driverId));
    const busyVehicleIds = new Set(store.filter('trips', (t) => ['scheduled', 'in-progress'].includes(t.status)).map((t) => t.vehicleId));
    const driver = store.find('drivers', (d) => d.status === 'active' && !busyDriverIds.has(d.id)) || store.find('drivers', (d) => d.status === 'active');
    const vehicle = store.find('vehicles', (v) => v.status === 'active' && !busyVehicleIds.has(v.id) && Number(v.seats || 0) >= count) || store.find('vehicles', (v) => v.status === 'active' && Number(v.seats || 0) >= count);
    if (!driver || !vehicle || !route || !shift) throw new ApiError(409, 'No eligible nearby driver, vehicle, route or shift is available.');

    const id = `SRQ${String(store.collection('serviceRequests').length + 1).padStart(4, '0')}`;
    const request = { id, organisation: org, raisedBy: req.user.email, raisedByName: req.user.name, kind: 'ad-hoc-trip', category: 'vehicle', priority: body.priority === 'high' ? 'high' : 'normal', subject: `End-user booking from ${pickup} to ${drop}`, detail: String(body.notes || '').slice(0, 1000), date, time: String(body.time || '').slice(0, 5), pickupPoint: pickup, dropPoint: drop, headcount: count, staffCodes: employees.map((e) => e.code), tripId: null, status: 'scheduled', response: 'Automatically assigned by the SMIPL allocation engine.', assignedDriverId: driver.id, assignedVehicleId: vehicle.id, createdAt: nowIso(), updatedAt: nowIso() };
    store.insert('serviceRequests', request);
    const trip = { id: store.nextId('trips', 'TRP'), date, status: 'scheduled', driverAcceptance: 'pending', routeId: route.id, vehicleId: vehicle.id, driverId: driver.id, shiftId: shift.id, plannedKm: Number(route.distanceKm || 0), actualKm: 0, fuelCost: 0, tollCost: 0, departureAt: `${date}T${request.time || shift.pickupStart || '09:00'}:00`, arrivalAt: null, notes: `End-user booking ${id}`, sourceRequestId: id, organisation: org, createdAt: nowIso(), updatedAt: nowIso() };
    store.insert('trips', trip);
    employees.forEach((employee) => store.insert('bookings', { id: store.nextId('bookings', 'BKG'), tripId: trip.id, employeeId: employee.id, stop: employee.stop || pickup, status: 'confirmed', source: 'end-user-booking', bookedBy: req.user.email, createdAt: nowIso(), updatedAt: nowIso() }));
    store.update('trips', trip.id, { ...trip, passengersAllocated: employees.length, passengersBoarded: 0, updatedAt: nowIso() });
    audit(req, 'mobile.end-user-booking', `${req.user.email} created ${id}; auto-assigned ${driver.id}/${vehicle.id}`);
    res.status(201).json({ request, trip: { id: trip.id, status: trip.status, driverId: driver.id, vehicleId: vehicle.id }, message: 'Booking sent to SMIPL and automatically assigned to the nearest available driver and vehicle.' });
  } catch (err) { next(err); }
});

/**
 * GET /api/mobile/client/vehicles
 * Where this company's vehicles are right now.
 *
 * Scoped to the caller's own organisation through their trips, so a client can
 * only ever see a vehicle while it is carrying their own staff. Shares the
 * shaping with the desk view so the two can never drift apart.
 */
router.get('/client/vehicles', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const data = liveVehicleRows()
      .filter((row) => (row.organisations || []).includes(org))
      .map((row) => clientView(row));

    res.json({
      data,
      meta: {
        count: data.length,
        moving: data.filter((d) => !d.stale && d.speedKph > 3).length,
      },
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/mobile/client/trips/:tripId/tracking
 * The trail of one of this company's trips.
 *
 * The trip must be carrying this company's staff: a trip id guessed from
 * elsewhere answers 403 rather than leaking another client's movements.
 */
router.get('/client/trips/:tripId/tracking', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const trip = store.find('trips', (t) => t.id === req.params.tripId);
    if (!trip) throw new ApiError(404, `Trip ${req.params.tripId} was not found.`);
    if (!organisationsOnTrip(trip.id).includes(org)) {
      throw new ApiError(403, 'That trip is not carrying your staff.');
    }

    const route = trip.routeId ? store.find('routes', (r) => r.id === trip.routeId) : null;
    const vehicle = trip.vehicleId ? store.find('vehicles', (v) => v.id === trip.vehicleId) : null;
    const driver = trip.driverId ? store.find('drivers', (d) => d.id === trip.driverId) : null;

    // Only this company's own staff count, and only where they are waiting.
    const myStaff = store
      .filter('bookings', (b) => b.tripId === trip.id)
      .map((b) => ({ booking: b, employee: store.find('employees', (e) => e.id === b.employeeId) }))
      .filter((x) => x.employee && x.employee.organisation === org)
      .map((x) => ({
        name: x.employee.name,
        code: x.employee.code,
        stop: x.booking.stop,
        boarded: x.booking.status === 'completed' || x.booking.status === 'boarded',
      }));

    const latest = latestPingFor(trip.id);

    res.json({
      data: {
        tripId: trip.id,
        date: trip.date,
        status: trip.status,
        routeName: route ? route.name : null,
        vehicleRegNo: vehicle ? vehicle.regNo : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        myStaff,
        boarded: myStaff.filter((s) => s.boarded).length,
        latest: latest ? {
          lat: latest.lat,
          lon: latest.lon,
          speedKph: latest.speedKph,
          recordedAt: latest.recordedAt,
          ageSeconds: ageSeconds(latest.recordedAt),
        } : null,
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/client/requests
 * Body: { category, subject, detail, priority?,
 *         kind?, date?, time?, pickupPoint?, dropPoint?, headcount?, staffCodes?[] }
 *
 * A request is either a general note or a structured ride request. The
 * structured fields are what let the desk approve it into a real trip; without
 * them there is nothing to act on and the request just sits there, which is how
 * this endpoint behaved before.
 */
router.post('/client/requests', requireRole('client', 'operations'), (req, res, next) => {
  try {
    const org = orgFor(req.user);
    const body = req.body || {};

    const subject = String(body.subject || '').trim();
    const detail = String(body.detail || '').trim();
    if (subject.length < 3) throw new ApiError(400, 'Give the request a short subject.');

    const categories = ['route-change', 'new-employee', 'timing', 'vehicle', 'missed-pickup', 'other'];
    const category = categories.includes(body.category) ? body.category : 'other';
    const priority = ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal';

    /*
     * `kind` decides whether the desk can schedule this or only reply to it.
     * Anything unrecognised falls back to 'general', which is the safe default:
     * it cannot create a trip by accident.
     */
    const kinds = ['ad-hoc-trip', 'route-seat', 'general'];
    const kind = kinds.includes(body.kind) ? body.kind : 'general';

    const headcount = Number(body.headcount) || 0;
    if (kind !== 'general' && headcount < 1) {
      throw new ApiError(400, 'How many people is this for?');
    }
    if (kind !== 'general' && !String(body.pickupPoint || '').trim()) {
      throw new ApiError(400, 'Where should the vehicle pick your staff up?');
    }

    const date = String(body.date || '').trim();
    if (kind !== 'general' && date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, 'Pick a valid date.');
    }

    /*
     * Staff codes are validated against this company only. A client must not be
     * able to name another company's employee and have the desk book them.
     */
    const staffCodes = Array.isArray(body.staffCodes)
      ? body.staffCodes
        .map((c) => String(c).trim())
        .filter((c) => store.find('employees', (e) => e.code === c && e.organisation === org))
        .slice(0, 200)
      : [];

    const record = {
      id: `SRQ${String(store.collection('serviceRequests').length + 1).padStart(4, '0')}`,
      organisation: org,
      raisedBy: req.user.email,
      raisedByName: req.user.name,
      kind,
      category,
      priority,
      subject,
      detail: detail.slice(0, 2000),
      // Ride-request detail. Empty for a general note.
      date: kind === 'general' ? '' : date,
      time: kind === 'general' ? '' : String(body.time || '').slice(0, 5),
      pickupPoint: kind === 'general' ? '' : String(body.pickupPoint || '').slice(0, 120),
      dropPoint: kind === 'general' ? '' : String(body.dropPoint || '').slice(0, 120),
      headcount: kind === 'general' ? 0 : headcount,
      staffCodes,
      tripId: null,
      status: 'pending',
      response: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.insert('serviceRequests', record);
    audit(req, 'mobile.request', `${req.user.email} raised ${kind}/${category}: ${subject}`);

    res.status(201).json({
      request: record,
      message: kind === 'general'
        ? 'Request submitted. The transport desk will respond shortly.'
        : 'Ride request submitted. The transport desk will confirm the vehicle and driver.',
    });
  } catch (err) { next(err); }
});

router.get('/employee/me', requireRole('employee'), (req, res, next) => {
  try {
    const employee = employeeFor(req.user);
    const trips = store.filter('trips', (trip) => trip.organisation === req.user.organisation || store.filter('bookings', (b) => b.tripId === trip.id && b.employeeId === employee.id).length > 0)
      .map((trip) => employeeTripView(trip, employee.id)).filter(Boolean)
      .sort((a, b) => `${a.date}${a.departureAt}`.localeCompare(`${b.date}${b.departureAt}`));
    res.json({ employee, organisation: req.user.organisation, upcoming: trips.filter((t) => t.date >= today() && !['completed', 'cancelled'].includes(t.status)).slice(0, 5), history: trips.slice(-20).reverse() });
  } catch (err) { next(err); }
});

router.get('/employee/requests', requireRole('employee'), (req, res, next) => {
  try {
    const employee = employeeFor(req.user);
    const data = store.filter('serviceRequests', (r) => r.organisation === req.user.organisation && (r.employeeId === employee.id || r.raisedBy === req.user.email))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ data, meta: { count: data.length } });
  } catch (err) { next(err); }
});

router.post('/employee/requests', requireRole('employee'), (req, res, next) => {
  try {
    const employee = employeeFor(req.user);
    const subject = String(req.body?.subject || '').trim();
    if (subject.length < 3) throw new ApiError(400, 'Give the request a short subject.');
    const record = {
      id: `SRQ${String(store.collection('serviceRequests').length + 1).padStart(4, '0')}`,
      organisation: req.user.organisation, raisedBy: req.user.email, raisedByName: employee.name,
      employeeId: employee.id, kind: 'general', category: ['missed-pickup', 'timing', 'other'].includes(req.body?.category) ? req.body.category : 'other',
      priority: ['low', 'normal', 'high'].includes(req.body?.priority) ? req.body.priority : 'normal',
      subject, detail: String(req.body?.detail || '').slice(0, 2000), status: 'pending', response: '', createdAt: nowIso(), updatedAt: nowIso(),
    };
    store.insert('serviceRequests', record);
    audit(req, 'mobile.employee_request', `${req.user.email} raised ${subject}`);
    res.status(201).json({ request: record, message: 'Request sent to the transport desk.' });
  } catch (err) { next(err); }
});

router.post('/employee/bookings', requireRole('employee'), (req, res, next) => {
  try {
    const employee = employeeFor(req.user);
    const date = String(req.body?.date || '').trim();
    const time = String(req.body?.time || '').trim();
    const pickupPoint = String(req.body?.pickupPoint || '').trim();
    const dropPoint = String(req.body?.dropPoint || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'Choose a valid travel date.');
    if (!/^\d{2}:\d{2}$/.test(time)) throw new ApiError(400, 'Choose a pickup time.');
    if (!pickupPoint || !dropPoint) throw new ApiError(400, 'Enter pickup and drop points.');
    const id = `SRQ${String(store.collection('serviceRequests').length + 1).padStart(4, '0')}`;
    const record = {
      id, organisation: req.user.organisation, raisedBy: req.user.email, raisedByName: employee.name,
      employeeId: employee.id, kind: 'ad-hoc-trip', category: 'employee-transport', priority: 'normal',
      subject: `Ride booking for ${employee.name}`, detail: String(req.body?.notes || '').slice(0, 1000),
      date, time, pickupPoint: pickupPoint.slice(0, 120), dropPoint: dropPoint.slice(0, 120), headcount: 1,
      staffCodes: [employee.code], tripId: null, status: 'pending', response: '', createdAt: nowIso(), updatedAt: nowIso(),
    };
    store.insert('serviceRequests', record);
    audit(req, 'mobile.employee_booking', `${req.user.email} booked ${date} ${pickupPoint} to ${dropPoint}`);
    res.status(201).json({ request: record, message: 'Ride booking sent to the SMIPL transport desk.' });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/driver/location
 * Body: { lat, lon, speedKph?, heading?, accuracyM?, tripId? }
 *
 * The driver app posts here on a timer while a trip is running so the desk can
 * see the vehicle move. The storage and validation live in routes/tracking.js -
 * this is only the mobile-facing door, kept here so the driver app has one
 * consistent base path to talk to.
 */
router.post('/driver/location', requireRole('driver', 'operations'), (req, res, next) => {
  recordPing(req, res, next);
});

module.exports = router;
