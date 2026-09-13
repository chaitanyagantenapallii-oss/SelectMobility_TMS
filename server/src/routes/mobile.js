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

    const allowed = ['completed', 'no-show'];
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

    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) { next(err); }
});

/**
 * POST /api/mobile/client/requests
 * Body: { category, subject, detail, priority? }
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

    const record = {
      id: `SRQ${String(store.collection('serviceRequests').length + 1).padStart(4, '0')}`,
      organisation: org,
      raisedBy: req.user.email,
      raisedByName: req.user.name,
      category,
      priority,
      subject,
      detail: detail.slice(0, 2000),
      status: 'open',
      response: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    store.insert('serviceRequests', record);
    audit(req, 'mobile.request', `${req.user.email} raised ${category}: ${subject}`);

    res.status(201).json({ request: record, message: 'Request submitted. The transport desk will respond shortly.' });
  } catch (err) { next(err); }
});

module.exports = router;
