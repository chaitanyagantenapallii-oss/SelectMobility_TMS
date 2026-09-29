'use strict';

/**
 * Live vehicle tracking.
 *
 * Drivers post their position from the phone; the desk watches the fleet move.
 * The full pipeline lives here - capture, store, read back - because a tracker
 * that only half works is worse than none: a stale pin reads as a bus that is
 * still on the road.
 *
 * Storage shape
 * -------------
 * Two collections are involved:
 *
 *   vehicleLocations  Every ping, appended. Kept short (see PRUNE) because a
 *                     bus pinging every 30 s across eight vehicles produces
 *                     ~2,800 rows a day.
 *   trackingState     One row per vehicle: its latest ping, denormalised. This
 *                     is what the map reads, so the tracking view never has to
 *                     scan the history table.
 *
 * Why a separate latest-state row rather than "last ping wins" on read
 * ---------------------------------------------------------------------
 * The list view needs the newest ping per vehicle. Expressing that as a scan
 * means sorting the whole history on every refresh, which is fine for a demo
 * and wrong for a fleet. The state row is written on every ping, so the view is
 * a single pass over a handful of rows.
 *
 * Freshness
 * ---------
 * A ping is only trusted for FRESH_MS. Beyond that the vehicle is reported as
 * stale and the map dims it, because a driver who closed the app an hour ago is
 * not "5 minutes from the plant" - the phone simply stopped talking.
 */

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, nowIso } = require('../utils/helpers');
const config = require('../config');

const router = express.Router();

/** A ping older than this is shown as stale rather than as a live position. */
const FRESH_MS = 5 * 60 * 1000;

/** Keep the ping history bounded; the latest-state row is never pruned. */
const PRUNE_KEEP = 5000;

/** Plausible bounds. A phone that reports 0,0 or 999 lat means a bad fix. */
const BOUNDS = { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };

/** Great-circle distance in km, used for speed sanity and trip progress. */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Let a ping through only if it looks like a real position.
 *
 * A cold GPS fix returns 0,0 - the "null island" off West Africa - and phones
 * do this far more often than one would hope, especially indoors. Accepting it
 * would drop every bus in the fleet onto the same point in the Atlantic.
 */
function validatePing(body) {
  const lat = Number(body.lat);
  const lon = Number(body.lon ?? body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ApiError(400, 'Send the position as numeric lat and lon.');
  }
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lon < BOUNDS.lonMin || lon > BOUNDS.lonMax) {
    throw new ApiError(400, 'Those coordinates are outside the valid range.');
  }
  if (lat === 0 && lon === 0) {
    throw new ApiError(400, 'That looks like an empty GPS fix. Wait for a real position.');
  }
  return { lat, lon };
}

/**
 * JioThings adapter boundary. JioThings account payloads vary by product, so
 * this accepts the common device/IMEI + position shape and normalises it into
 * the same tracking state used by the Driver app.
 */
router.post('/integrations/gps/jiothings', (req, res) => {
  const supplied = String(req.headers['x-gps-ingest-key'] || req.headers['x-api-key'] || '');
  if (!config.gps.ingestKey || supplied !== config.gps.ingestKey) throw new ApiError(401, 'GPS integration key is missing or invalid.');
  const body = req.body || {};
  const data = body.data || body.location || body.position || body;
  const deviceId = String(data.deviceId || data.device_id || data.imei || data.IMEI || body.deviceId || '').trim();
  if (!deviceId) throw new ApiError(400, 'GPS payload must include deviceId or IMEI.');
  const vehicle = store.find('vehicles', (v) => String(v.gpsDeviceId || '').toLowerCase() === deviceId.toLowerCase());
  if (!vehicle) throw new ApiError(404, `No vehicle is mapped to GPS device ${deviceId}.`);
  const position = data.location || data.position || data;
  const { lat, lon } = validatePing({ lat: position.lat ?? position.latitude, lon: position.lon ?? position.lng ?? position.longitude });
  const recordedAt = data.timestamp || data.recordedAt || data.recorded_at || nowIso();
  const stateKey = `GPS:${vehicle.id}`;
  const state = { stateKey, vehicleId: vehicle.id, vehicleRegNo: vehicle.regNo, driverName: 'JioThings GPS', tripId: null, lat, lon, speedKph: Number(data.speedKph ?? data.speed ?? 0) || 0, speedSource: 'jiothings', heading: Number.isFinite(Number(data.heading)) ? Number(data.heading) : null, accuracyM: Number(data.accuracyM ?? data.accuracy) || null, recordedAt, updatedAt: nowIso() };
  const previous = store.find('trackingState', (s) => s.stateKey === stateKey);
  if (previous) store.update('trackingState', previous.id, state);
  else store.insert('trackingState', { id: stateKey.replace(':', ''), ...state });
  store.insert('vehicleLocations', { id: store.nextId('vehicleLocations', 'LOC'), ...state });
  res.status(202).json({ accepted: true, vehicleId: vehicle.id, vehicleRegNo: vehicle.regNo, recordedAt });
});

/** Create a vehicle record for a controlled real-phone GPS test. */
router.post('/test-vehicle', authenticate, requireRole('admin', 'operations'), (req, res) => {
  const regNo = String(req.body?.regNo || '').trim().toUpperCase();
  if (regNo.length < 4) throw new ApiError(400, 'Enter a vehicle registration or test name.');
  if (store.find('vehicles', (v) => v.regNo.toUpperCase() === regNo)) throw new ApiError(409, 'That vehicle already exists.');
  const vehicle = {
    id: store.nextId('vehicles', 'VEH'), regNo, model: 'Personal test car', type: 'car', seats: 4,
    vendorId: null, fuelType: 'petrol', odometer: 0, status: 'active', ownership: 'owned',
    testVehicle: true, createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.insert('vehicles', vehicle);
  audit(req, 'tracking.test-vehicle-created', `Created ${regNo} for phone GPS testing`);
  res.status(201).json({ data: vehicle });
});

/** Admin/operations phone test position, kept separate from driver-auth GPS. */
router.post('/test-position', authenticate, requireRole('admin', 'operations'), (req, res) => {
  const vehicleId = String(req.body?.vehicleId || '');
  const vehicle = store.find('vehicles', (v) => v.id === vehicleId && v.testVehicle);
  if (!vehicle) throw new ApiError(404, 'Choose a test vehicle first.');
  const { lat, lon } = validatePing(req.body || {});
  const recordedAt = nowIso();
  const previous = store.find('trackingState', (s) => s.stateKey === `TEST:${vehicleId}`);
  const state = { stateKey: `TEST:${vehicleId}`, vehicleId, vehicleRegNo: vehicle.regNo, driverName: 'Phone GPS test', tripId: null, lat, lon, speedKph: Number(req.body.speedKph) || 0, speedSource: 'phone-test', heading: Number.isFinite(Number(req.body.heading)) ? Number(req.body.heading) : null, accuracyM: Number(req.body.accuracyM) || null, recordedAt, updatedAt: recordedAt };
  if (previous) store.update('trackingState', previous.id, state);
  else store.insert('trackingState', { id: `TEST${vehicleId}`, ...state });
  store.insert('vehicleLocations', { id: store.nextId('vehicleLocations', 'LOC'), ...state });
  res.status(201).json({ data: { vehicleId, lat, lon, recordedAt } });
});

/** Seconds since a timestamp, or null if it is unparseable. */
function ageSeconds(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

/**
 * Milliseconds since an ISO timestamp.
 *
 * Speed derivation needs this instead of `ageSeconds`: rounding to whole
 * seconds turns a real half-second gap into 0 and makes the rate unknowable.
 */
function elapsedMs(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Date.now() - t);
}

/**
 * Shape one latest-state row for the live views.
 *
 * Shared by the desk endpoint and the client app so the two can never disagree
 * about what "moving" or "stale" means.
 */
function shapeStateRow(s) {
  const age = ageSeconds(s.recordedAt);
  const trip = s.tripId ? store.find('trips', (t) => t.id === s.tripId) : null;
  const vehicleRecord = s.vehicleId ? store.find('vehicles', (v) => v.id === s.vehicleId) : null;
  const route = trip && trip.routeId ? store.find('routes', (r) => r.id === trip.routeId) : null;
  const driver = s.driverId ? store.find('drivers', (d) => d.id === s.driverId) : null;
  const routeStops = route && Array.isArray(route.stopPoints) ? route.stopPoints : [];
  const nearestStopKm = routeStops.length && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))
    ? Math.min(...routeStops.map((p) => haversineKm({ lat: Number(s.lat), lon: Number(s.lon) }, { lat: Number(p.lat), lon: Number(p.lon) })))
    : null;
  return {
    ...s,
    ageSeconds: age,
    stale: age === null || age * 1000 > FRESH_MS,
    tripStatus: trip ? trip.status : s.tripStatus,
    organisations: trip ? organisationsOnTrip(trip.id) : [],
    routeName: route ? route.name : null,
    routeCode: route ? route.code : null,
    routePoints: routeStops.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), name: p.name })),
    testVehicle: !!(vehicleRecord && vehicleRecord.testVehicle),
    driverPhone: driver ? driver.phone : null,
    // Progress along the running trip, which is what the desk actually wants
    // to know: not where the bus is, but whether it is on track.
    boarded: trip ? trip.passengersBoarded : null,
    allocated: trip ? trip.passengersAllocated : null,
    freshSeconds: Math.round(FRESH_MS / 1000),
    nearestStopKm: nearestStopKm === null ? null : Math.round(nearestStopKm * 10) / 10,
    roaming: nearestStopKm !== null && nearestStopKm > 5,
  };
}

/**
 * Which client companies have staff on a trip.
 *
 * A trip carries no organisation of its own: one corridor is shared by several
 * companies' employees, each with their own boarding stop. The link is the
 * booking, so that is what this walks. Returning a list rather than a single
 * name is what lets a client see a shared bus at all.
 */
function organisationsOnTrip(tripId) {
  const seen = new Set();
  store.filter('bookings', (b) => b.tripId === tripId).forEach((b) => {
    const emp = store.find('employees', (e) => e.id === b.employeeId);
    if (emp && emp.organisation) seen.add(emp.organisation);
  });
  return [...seen];
}

/** Every vehicle's latest position, newest first. */
function liveVehicleRows() {
  const rows = store
    .collection('trackingState')
    .map(shapeStateRow)
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
  const known = new Set(rows.map((r) => r.vehicleId));
  store.collection('vehicles').filter((v) => v.testVehicle && !known.has(v.id)).forEach((v) => rows.push({
    stateKey: `TEST:${v.id}`, vehicleId: v.id, vehicleRegNo: v.regNo, driverName: 'Phone GPS test',
    lat: null, lon: null, speedKph: 0, speedSource: 'awaiting-gps', recordedAt: null,
    ageSeconds: null, stale: true, testVehicle: true, roaming: false, routePoints: [],
    freshSeconds: Math.round(FRESH_MS / 1000), organisations: [], boarded: null, allocated: null,
  }));
  return rows;
}

/** Read-only movement simulation used only by demo accounts. */
function demoVehicleRows() {
  const routes = store.collection('routes').filter((r) => r.stopPoints && r.stopPoints.length > 1);
  const vehicles = store.collection('vehicles').filter((v) => v.status !== 'maintenance');
  const drivers = store.collection('drivers');
  const now = Date.now();
  const simulated = routes.slice(0, Math.min(5, vehicles.length)).map((route, i) => {
    const points = route.stopPoints;
    const phase = ((now / 1000 / (70 + i * 18)) + i * 0.23) % (points.length - 1);
    const from = Math.floor(phase);
    const ratio = phase - from;
    const a = points[from];
    const b = points[Math.min(from + 1, points.length - 1)];
    const vehicle = vehicles[i];
    const driver = drivers[i];
    return {
      stateKey: `DEMO:${vehicle.id}`, vehicleId: vehicle.id, vehicleRegNo: vehicle.regNo,
      driverId: driver ? driver.id : null, driverName: driver ? driver.name : 'Demo driver',
      tripId: `DEMO-${route.code}`, tripStatus: 'in-progress', routeName: route.name, routeCode: route.code,
      routePoints: points.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), name: p.name })),
      lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * ratio,
      lon: Number(a.lon) + (Number(b.lon) - Number(a.lon)) * ratio,
      speedKph: 22 + ((i * 9) % 25), speedSource: 'demo', heading: null, accuracyM: 18,
      recordedAt: new Date(now - i * 22000).toISOString(), updatedAt: new Date(now).toISOString(),
      ageSeconds: i * 22, stale: false, organisations: [], boarded: 8 + i * 3, allocated: 18 + i * 3,
      freshSeconds: 300, nearestStopKm: null, roaming: i === 4, demo: true,
    };
  });
  return [...simulated, ...liveVehicleRows().filter((r) => r.testVehicle)];
}

/** GET /api/tracking - concise top-level tracking summary. */
router.get('/', authenticate, requireRole('admin', 'operations', 'viewer', 'client'), (req, res) => {
  let data = req.user.demo ? demoVehicleRows() : liveVehicleRows();
  if (req.user.role === 'client') {
    if (!req.user.organisation) throw new ApiError(403, 'This account is not linked to a client organisation.');
    data = data.filter((s) => (s.organisations || []).includes(req.user.organisation));
  }
  res.json({
    data,
    meta: {
      total: data.length,
      live: data.filter((d) => !d.stale).length,
      stale: data.filter((d) => d.stale).length,
      moving: data.filter((d) => !d.stale && d.speedKph > 3).length,
    },
  });
});

/** The most recent fix for one trip, or null if it has never reported. */
function latestPingFor(tripId) {
  return store
    .filter('vehicleLocations', (p) => p.tripId === tripId)
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null;
}

/** What the client app is allowed to see: company, position, and nothing more. */
function clientView(row) {
  return {
    tripId: row.tripId,
    status: row.tripStatus,
    routeName: row.routeName,
    routeCode: row.routeCode,
    vehicleRegNo: row.vehicleRegNo,
    driverName: row.driverName,
    lat: row.lat,
    lon: row.lon,
    speedKph: row.speedKph,
    heading: row.heading,
    stale: row.stale,
    recordedAt: row.recordedAt,
    ageSeconds: row.ageSeconds,
  };
}

/* ==========================================================================
   Driver-facing write path (mounted under /api/mobile via the export below)
   ========================================================================== */

/**
 * Record one position.
 *
 * Called by the driver app on a timer while a trip is running. Deliberately
 * forgiving about everything except the coordinates themselves: a dropped
 * accuracy figure or a missing heading should never cost the desk the ping.
 */
function recordPing(req, res, next) {
  try {
    const driver = store.find('drivers', (d) => d.userId === req.user.id)
      || store.find('drivers', (d) => d.id === req.user.driverId);
    if (!driver) throw new ApiError(403, 'No driver record is linked to this account.');

    const { lat, lon } = validatePing(req.body || {});
    const body = req.body || {};

    // Resolve the trip: explicitly if given, otherwise the driver's open run.
    let trip = null;
    if (body.tripId) {
      trip = store.find('trips', (t) => t.id === body.tripId && t.driverId === driver.id);
      if (!trip) throw new ApiError(404, 'That trip is not assigned to you.');
    } else {
      trip = store.find('trips', (t) => t.driverId === driver.id && t.status === 'in-progress');
    }

    /*
     * Which vehicle this position belongs to.
     *
     * Order matters: the vehicle on the running trip beats the driver's
     * standing assignment, because a relief driver may be covering a different
     * bus today. The standing assignment field is `assignedVehicleId` - there
     * is no `vehicleId` on a driver, and reading the wrong key here silently
     * produced pings with no vehicle at all.
     */
    const vehicleId = (trip && trip.vehicleId)
      || driver.assignedVehicleId
      || body.vehicleId
      || null;
    const vehicle = vehicleId ? store.find('vehicles', (v) => v.id === vehicleId) : null;

    /*
     * Speed is derived when the phone does not supply it, from the distance and
     * time since this vehicle's last ping. A phone that omits speed would
     * otherwise show 0 km/h while clearly moving, which reads as a fault.
     *
     * Keyed on the vehicle where we have one, and on the driver otherwise, so a
     * driver with no assigned vehicle still updates a single state row rather
     * than accumulating a new one per ping.
     */
    const stateKey = vehicleId ? `VEH:${vehicleId}` : `DRV:${driver.id}`;
    const previous = store.find('trackingState', (s) => s.stateKey === stateKey);

    let speedKph = Number(body.speedKph ?? body.speed);
    let speedSource = Number.isFinite(speedKph) ? 'reported' : null;

    if (!speedSource && previous && previous.lat !== undefined) {
      const km = haversineKm({ lat: previous.lat, lon: previous.lon }, { lat, lon });
      // Measure in milliseconds: phones ping continuously, so whole-second
      // granularity would round a genuine interval down to 0 and lose the fix.
      const ms = elapsedMs(previous.recordedAt);
      if (ms !== null && ms >= 1000) {
        speedKph = Math.round((km / (ms / 3600000)) * 10) / 10;
        speedSource = 'derived';
      } else if (Number.isFinite(previous.speedKph)) {
        // Too soon to tell: the vehicle has not had time to change speed, so
        // carry the last known figure. Falling back to 0 would show a moving
        // bus as stopped, which reads on the desk as a fault.
        speedKph = previous.speedKph;
        speedSource = 'carried';
      }
    }

    if (!Number.isFinite(speedKph)) {
      speedKph = 0;
      speedSource = 'unknown';
    }
    // A derived figure can be absurd if a ping was buffered offline; cap it so
    // the desk never sees 900 km/h for a city bus.
    speedKph = Math.max(0, Math.min(120, speedKph));

    const ping = {
      id: store.nextId('vehicleLocations', 'LOC'),
      vehicleId,
      vehicleRegNo: vehicle ? vehicle.regNo : null,
      driverId: driver.id,
      driverName: driver.name,
      tripId: trip ? trip.id : null,
      lat,
      lon,
      speedKph,
      speedSource,
      heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : null,
      accuracyM: Number.isFinite(Number(body.accuracyM ?? body.accuracy))
        ? Number(body.accuracyM ?? body.accuracy)
        : null,
      recordedAt: nowIso(),
    };
    store.insert('vehicleLocations', ping);

    // Latest-state row, so the desk view is a single cheap pass.
    const state = {
      stateKey,
      vehicleId,
      vehicleRegNo: ping.vehicleRegNo,
      driverId: driver.id,
      driverName: driver.name,
      tripId: ping.tripId,
      tripStatus: trip ? trip.status : null,
      lat,
      lon,
      speedKph,
      speedSource,
      heading: ping.heading,
      accuracyM: ping.accuracyM,
      recordedAt: ping.recordedAt,
      updatedAt: nowIso(),
    };
    if (previous) store.update('trackingState', previous.id, state);
    // One row per vehicle (or per unassigned driver). The id is derived from
    // the key rather than generated, so a retry after a crash replaces the row
    // instead of creating a second one for the same vehicle.
    else store.insert('trackingState', { id: stateKey.replace(':', ''), ...state });

    pruneHistory();

    res.status(201).json({
      // Echoing the accepted position lets the app show the driver that
      // tracking is genuinely working rather than silently hoping.
      ping: { id: ping.id, lat: ping.lat, lon: ping.lon, speedKph: ping.speedKph, at: ping.recordedAt },
      tripId: ping.tripId,
      message: 'Position recorded.',
    });
  } catch (err) { next(err); }
}

/** Trim the oldest pings so the file cannot grow without bound. */
function pruneHistory() {
  const all = store.collection('vehicleLocations');
  if (all.length <= PRUNE_KEEP) return;
  const cutoff = all.length - PRUNE_KEEP;
  // Collection order is insertion order, so the first N are the oldest.
  for (let i = 0; i < cutoff; i += 1) {
    store.remove('vehicleLocations', all[i].id);
  }
}

/* ==========================================================================
   Desk-facing read path
   ========================================================================== */

/**
 * GET /api/tracking/live
 * One row per vehicle that has ever reported, newest first.
 *
 * `role` on the caller decides the scope: a client sees only their own
 * company's vehicles, which is the same rule the rest of /api/mobile uses.
 */
router.get('/live', authenticate, requireRole('admin', 'operations', 'viewer', 'client'), (req, res) => {
  let data = req.user.demo ? demoVehicleRows() : liveVehicleRows();

  // A client account is scoped to its own company's trips.
  if (req.user.role === 'client') {
    if (!req.user.organisation) throw new ApiError(403, 'This account is not linked to a client organisation.');
    data = data.filter((s) => (s.organisations || []).includes(req.user.organisation));
  }

  const moving = data.filter((d) => !d.stale && d.speedKph > 3).length;
  res.json({
    data,
    meta: {
      total: data.length,
      live: data.filter((d) => !d.stale).length,
      stale: data.filter((d) => d.stale).length,
      moving,
    },
  });
});

/** GET /api/tracking/:vehicleId/history?limit= */
router.get('/:vehicleId/history', authenticate, requireRole('admin', 'operations', 'viewer'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = store
    .filter('vehicleLocations', (p) => p.vehicleId === req.params.vehicleId)
    .slice(-limit)
    .reverse();
  res.json({ data: rows, meta: { count: rows.length, vehicleId: req.params.vehicleId } });
});

/**
 * GET /api/tracking/trip/:tripId
 * The breadcrumb trail for one run. This is what draws the route on the map and
 * what the desk uses after the fact to answer "where did that bus actually go?".
 */
router.get('/trip/:tripId', authenticate, requireRole('admin', 'operations', 'viewer', 'client'), (req, res) => {
  const trip = store.find('trips', (t) => t.id === req.params.tripId);
  if (!trip) throw new ApiError(404, `Trip ${req.params.tripId} was not found.`);

  if (req.user.role === 'client' && trip.organisation !== req.user.organisation) {
    throw new ApiError(403, 'That trip belongs to another client.');
  }

  const points = store
    .filter('vehicleLocations', (p) => p.tripId === trip.id)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));

  // Total distance covered, summed between consecutive fixes.
  let distanceKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    distanceKm += haversineKm(points[i - 1], points[i]);
  }

  /*
   * Trips store ids, not names. Resolve them here rather than sending the desk
   * bare ids it would have to look up itself - the modal has no other source
   * for "which bus was this".
   */
  const route = trip.routeId ? store.find('routes', (r) => r.id === trip.routeId) : null;
  const vehicle = trip.vehicleId ? store.find('vehicles', (v) => v.id === trip.vehicleId) : null;
  const driver = trip.driverId ? store.find('drivers', (d) => d.id === trip.driverId) : null;

  res.json({
    data: {
      tripId: trip.id,
      status: trip.status,
      date: trip.date,
      routeName: route ? route.name : (trip.routeName || null),
      routeCode: route ? route.code : null,
      vehicleRegNo: vehicle ? vehicle.regNo : (trip.vehicleRegNo || null),
      driverName: driver ? driver.name : (trip.driverName || null),
      driverPhone: driver ? driver.phone : null,
      points,
      distanceKm: Math.round(distanceKm * 100) / 100,
      firstAt: points.length ? points[0].recordedAt : null,
      lastAt: points.length ? points[points.length - 1].recordedAt : null,
    },
  });
});

/** POST /api/tracking/ingest - the mobile route calls this via mobile.js. */
router.post('/ingest', authenticate, requireRole('driver', 'operations'), recordPing);

/*
 * The shaping helpers are exported because the client app reads positions
 * through /api/mobile rather than /api/tracking - those endpoints already
 * scope by organisation, and duplicating the shaping there would let the two
 * views drift apart.
 */
module.exports = {
  router,
  recordPing,
  FRESH_MS,
  ageSeconds,
  liveVehicleRows,
  clientView,
  latestPingFor,
  organisationsOnTrip,
};
