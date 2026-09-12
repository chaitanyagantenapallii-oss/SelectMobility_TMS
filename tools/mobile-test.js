'use strict';

/**
 * Driver and Client mobile API tests.
 *
 * These cover the two things that must not break in a shipping mobile app:
 * the happy path a driver/client actually walks through, and the scoping rules
 * that stop one account reaching another's data. The scoping tests matter most:
 * the apps are installable, so their traffic is inspectable, and a client must
 * not be able to widen its own scope by editing a request.
 *
 * Usage: node tools/mobile-test.js [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:4000';

let passes = [];
let fails = [];

function check(ok, label, detail) {
  if (ok) { passes.push(label); console.log(`  [PASS] ${label}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` - ${detail}` : ''}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, body: json, raw: text };
  } catch (err) {
    return { status: 0, body: null, raw: err.message };
  }
}

async function signIn(email, password) {
  const r = await req('POST', '/api/auth/login', { body: { email, password } });
  return r.status === 200 && r.body ? r.body.token : null;
}

(async () => {
  console.log(`\n=== Mobile API tests against ${BASE} ===\n`);

  /* -- Sign-in ----------------------------------------------------------- */
  console.log('Sign-in');
  const adminToken = await signIn('admin@selectmobility.in', 'Select@2026');
  check(Boolean(adminToken), 'admin signs in');

  const driverToken = await signIn('driver@selectmobility.in', 'Driver@2026');
  check(Boolean(driverToken), 'driver signs in');

  const clientToken = await signIn('client@selectmobility.in', 'Client@2026');
  check(Boolean(clientToken), 'client signs in');

  const badLogin = await req('POST', '/api/auth/login', {
    body: { email: 'driver@selectmobility.in', password: 'wrong' },
  });
  check(badLogin.status === 401, 'driver wrong password is rejected', `status ${badLogin.status}`);

  /* -- Auth is required -------------------------------------------------- */
  console.log('\nAuthentication required');
  for (const p of ['/api/mobile/driver/me', '/api/mobile/client/me', '/api/mobile/client/roster']) {
    const r = await req('GET', p);
    check(r.status === 401, `unauthenticated ${p} is blocked`, `status ${r.status}`);
  }

  /* -- Driver app -------------------------------------------------------- */
  console.log('\nDriver app');
  const dme = await req('GET', '/api/mobile/driver/me', { token: driverToken });
  check(dme.status === 200, 'driver home loads', `status ${dme.status}`);
  check(dme.body && dme.body.driver && dme.body.driver.name, 'driver profile returned',
    dme.body && dme.body.driver ? dme.body.driver.name : 'no profile');
  check(dme.body && Array.isArray(dme.body.today), 'today trip list present');
  check(dme.body && dme.body.stats && typeof dme.body.stats.tripsCompleted === 'number',
    'driver stats computed', dme.body && dme.body.stats ? `${dme.body.stats.tripsCompleted} completed` : '');

  const dtrips = await req('GET', '/api/mobile/driver/trips', { token: driverToken });
  check(dtrips.status === 200 && Array.isArray(dtrips.body.data), 'driver trip history loads',
    dtrips.body ? `${dtrips.body.data.length} trips` : '');
  // Every trip returned must belong to this driver.
  const mishmash = dtrips.body && dtrips.body.data.some((t) => !t.route || !t.vehicle);
  check(!mishmash, 'every history trip is fully decorated');

  // A driver must not be able to read another driver's trip.
  const allTrips = await req('GET', '/api/trips?pageSize=200', { token: adminToken });
  const myDriverId = dme.body.driver.id;
  const foreign = (allTrips.body.data || []).find((t) => t.driverId !== myDriverId);
  if (foreign) {
    const peek = await req('GET', `/api/mobile/driver/trips/${foreign.id}`, { token: driverToken });
    check(peek.status === 403, "driver cannot read another driver's trip", `status ${peek.status}`);
  } else {
    check(false, "driver cannot read another driver's trip", 'no foreign trip available to test');
  }

  // Ownership on write paths too.
  const mine = (dtrips.body.data || []).find((t) => t.status === 'scheduled' || t.status === 'in-progress');
  if (foreign) {
    const w = await req('POST', `/api/mobile/driver/trips/${foreign.id}/start`, {
      token: driverToken, body: { odometerStart: 100 },
    });
    check(w.status === 403, "driver cannot start another driver's trip", `status ${w.status}`);
  }

  /* -- Boarding + close-out ---------------------------------------------- */
  console.log('\nBoarding and close-out');

  // A trip the driver can actually work on. Prefer whatever is already open,
  // then anything scheduled for today, then the next upcoming run - the seed
  // dataset marks most recent trips completed, so a fresh run may leave nothing
  // open. A test that silently skips its assertions is worse than no test.
  let openTrip = (dtrips.body.data || []).find((t) => t.status === 'in-progress')
    || (dtrips.body.data || []).find((t) => t.status === 'scheduled')
    || (dme.body.today || []).find((t) => t.status === 'in-progress' || t.status === 'scheduled')
    || (dme.body.upcoming || []).find((t) => t.status === 'scheduled');

  if (!openTrip) {
    const routes = await req('GET', '/api/routes', { token: adminToken });
    const route = (routes.body.data || [])[0];
    if (route) {
      const created = await req('POST', '/api/trips', {
        token: adminToken,
        body: {
          date: new Date().toISOString().slice(0, 10),
          shiftId: route.shiftId,
          routeId: route.id,
          vehicleId: dme.body.driver.assignedVehicleId || null,
          driverId: dme.body.driver.id,
          status: 'scheduled',
          plannedKm: route.distanceKm * 2,
        },
      });
      const newId = created.body && (created.body.data || created.body).id;
      if (newId) {
        // Look the trip up by id rather than re-reading the home payload: the
        // home response used above was captured before the trip existed.
        const fetched = await req('GET', `/api/mobile/driver/trips/${newId}`, { token: driverToken });
        if (fetched.status === 200) openTrip = fetched.body.trip;
      }
    }
  }

  check(Boolean(openTrip), 'an open trip is available to board',
    openTrip ? `${openTrip.id} (${openTrip.status}, ${openTrip.date})` : 'none found or created');

  if (openTrip) {
    const detail = await req('GET', `/api/mobile/driver/trips/${openTrip.id}`, { token: driverToken });
    check(detail.status === 200 && Array.isArray(detail.body.passengers),
      'trip manifest loads', detail.body ? `${detail.body.passengers.length} passengers` : '');

    /**
     * A trip created through the desk must arrive with its passengers already
     * booked in. If this is empty the driver app has nobody to board, which is
     * the whole point of the screen - so assert it rather than tolerate it.
     */
    check(detail.body && detail.body.passengers.length > 0,
      'a scheduled trip has passengers booked in',
      detail.body ? `${detail.body.passengers.length} passengers` : 'none');

    check(detail.body && Array.isArray(detail.body.byStop) && detail.body.byStop.length > 0,
      'manifest grouped by stop', detail.body ? `${detail.body.byStop.length} stops` : '');

    const pax = (detail.body.passengers || [])[0];
    if (pax) {
      const att = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/attendance`, {
        token: driverToken,
        body: { entries: [{ bookingId: pax.bookingId, status: 'completed' }] },
      });
      check(att.status === 200 && att.body.updated === 1, 'mark passenger boarded', `status ${att.status}`);
      check(att.body && att.body.passengers && att.body.passengers.boarded >= 1, 'boarded count increments',
        att.body ? `${att.body.passengers.boarded} boarded` : '');

      const noShow = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/attendance`, {
        token: driverToken,
        body: { entries: [{ bookingId: pax.bookingId, status: 'bogus-status' }] },
      });
      check(noShow.status === 400, 'invalid boarding status is rejected', `status ${noShow.status}`);
    }

    // Start the trip if it has not been started.
    if (openTrip.status === 'scheduled') {
      const started = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/start`, {
        token: driverToken, body: { odometerStart: 41000 },
      });
      check(started.status === 200 && started.body.trip.status === 'in-progress', 'start trip with odometer');

      const badOdo = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/complete`, {
        token: driverToken, body: { odometerEnd: 40000 },
      });
      check(badOdo.status === 400, 'closing odometer below opening is rejected', `status ${badOdo.status}`);

      const done = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/complete`, {
        token: driverToken, body: { odometerEnd: 41042 },
      });
      check(done.status === 200 && done.body.trip.status === 'completed', 'complete trip');
      check(done.body && done.body.trip.actualKm === 42, 'distance derived from odometer',
        done.body ? `${done.body.trip.actualKm} km` : '');

      const again = await req('POST', `/api/mobile/driver/trips/${openTrip.id}/complete`, {
        token: driverToken, body: { odometerEnd: 41099 },
      });
      check(again.status === 409, 'cannot complete the same trip twice', `status ${again.status}`);
    }
  } else {
    check(false, 'trip manifest loads', 'no open trip to test');
  }

  /* -- Breakdown and fuel ------------------------------------------------ */
  console.log('\nBreakdown and fuel');
  const bd = await req('POST', '/api/mobile/driver/breakdown', {
    token: driverToken,
    body: { severity: 'high', description: 'Rear tyre punctured near Hadapsar bypass', location: 'Hadapsar' },
  });
  check(bd.status === 201, 'breakdown reported', bd.body && bd.body.incident ? bd.body.incident.id : `status ${bd.status}`);

  const bdShort = await req('POST', '/api/mobile/driver/breakdown', {
    token: driverToken, body: { description: 'x' },
  });
  check(bdShort.status === 400, 'vague breakdown description is rejected', `status ${bdShort.status}`);

  const fuel = await req('POST', '/api/mobile/driver/fuel', {
    token: driverToken,
    body: { litres: 40, amount: 3600, odometer: 41042, station: 'HP Hadapsar' },
  });
  check(fuel.status === 201, 'fuel entry saved', fuel.body && fuel.body.fuel ? `${fuel.body.fuel.litres} L` : `status ${fuel.status}`);
  check(fuel.body && fuel.body.fuel && fuel.body.fuel.rate > 0, 'fuel rate computed',
    fuel.body && fuel.body.fuel ? `Rs ${fuel.body.fuel.rate}/L` : '');

  const badFuel = await req('POST', '/api/mobile/driver/fuel', {
    token: driverToken, body: { litres: 0, amount: 3600 },
  });
  check(badFuel.status === 400, 'zero fuel quantity is rejected', `status ${badFuel.status}`);

  // The incident raised from the app must be visible to the desk.
  const incidents = await req('GET', '/api/incidents?pageSize=200', { token: adminToken });
  const found = (incidents.body.data || []).some((i) => i.id === (bd.body && bd.body.incident ? bd.body.incident.id : ''));
  check(found, 'breakdown appears in the desk incident queue');

  /* -- Client scoping ---------------------------------------------------- */
  console.log('\nClient app and scoping');
  const cme = await req('GET', '/api/mobile/client/me', { token: clientToken });
  check(cme.status === 200, 'client home loads', `status ${cme.status}`);
  check(cme.body && cme.body.organisation === 'Bharat Forge Ltd', 'client scoped to own organisation',
    cme.body ? cme.body.organisation : '');
  check(cme.body && cme.body.stats && cme.body.stats.employeesRegistered > 0, 'client sees its own staff count',
    cme.body && cme.body.stats ? `${cme.body.stats.employeesRegistered} active` : '');

  const roster = await req('GET', '/api/mobile/client/roster', { token: clientToken });
  check(roster.status === 200 && roster.body.data.length > 0, 'client roster loads',
    roster.body ? `${roster.body.data.length} staff` : '');
  const leaked = (roster.body.data || []).some((e) => e.organisation && e.organisation !== 'Bharat Forge Ltd');
  check(!leaked, 'roster contains only own-organisation staff');

  // The roster must not expose the other client's people.
  const allEmp = await req('GET', '/api/employees?pageSize=500', { token: adminToken });
  const otherOrg = (allEmp.body.data || []).find((e) => e.organisation && e.organisation !== 'Bharat Forge Ltd');
  if (otherOrg) {
    const rosterIds = new Set((roster.body.data || []).map((e) => e.id));
    check(!rosterIds.has(otherOrg.id), "other organisation's employee is absent from roster",
      `${otherOrg.organisation} / ${otherOrg.code}`);
  }

  const stmt = await req('GET', '/api/mobile/client/statement', { token: clientToken });
  check(stmt.status === 200 && stmt.body.lines, 'monthly statement generated',
    stmt.body && stmt.body.totals ? `${stmt.body.totals.trips} trips, ${stmt.body.totals.staffJourneys} journeys` : '');
  check(stmt.body && stmt.body.totals && typeof stmt.body.totals.amount === 'number',
    'statement totals computed', stmt.body && stmt.body.totals ? `Rs ${stmt.body.totals.amount}` : '');

  const hist = await req('GET', '/api/mobile/client/history', { token: clientToken });
  check(hist.status === 200 && Array.isArray(hist.body.data), 'travel history loads',
    hist.body ? `${hist.body.data.length} rows` : '');

  // A client must not be able to read another organisation's employee history.
  if (otherOrg) {
    const peek = await req('GET', `/api/mobile/client/history?employeeId=${otherOrg.id}`, { token: clientToken });
    check(peek.status === 403, "client cannot read another organisation's employee history",
      `status ${peek.status}`);
  }

  const sreq = await req('POST', '/api/mobile/client/requests', {
    token: clientToken,
    body: { category: 'timing', subject: 'Shift 1 pickup 10 minutes late', detail: 'The Hadapsar pickup has slipped to 07:15 for three days.', priority: 'high' },
  });
  check(sreq.status === 201, 'service request raised', sreq.body && sreq.body.request ? sreq.body.request.id : `status ${sreq.status}`);

  const list = await req('GET', '/api/mobile/client/requests', { token: clientToken });
  check(list.status === 200 && list.body.data.length >= 2, 'client sees its own requests',
    list.body ? `${list.body.data.length} requests` : '');
  const foreignReq = (list.body.data || []).some((r) => r.organisation !== 'Bharat Forge Ltd');
  check(!foreignReq, 'requests are scoped to own organisation');

  /* -- Role separation --------------------------------------------------- */
  console.log('\nRole separation');
  const driverToClient = await req('GET', '/api/mobile/client/me', { token: driverToken });
  check(driverToClient.status === 403, 'driver cannot access client endpoints', `status ${driverToClient.status}`);

  const clientToDriver = await req('GET', '/api/mobile/driver/me', { token: clientToken });
  check(clientToDriver.status === 403, 'client cannot access driver endpoints', `status ${clientToDriver.status}`);

  const clientWrite = await req('POST', '/api/vehicles', {
    token: clientToken, body: { regNo: 'MH99XX0001', model: 'Test' },
  });
  check(clientWrite.status === 403, 'client cannot write desk resources', `status ${clientWrite.status}`);

  const driverWrite = await req('POST', '/api/employees', {
    token: driverToken, body: { name: 'Injected', routeId: 'RTE0001' },
  });
  check(driverWrite.status === 403, 'driver cannot create employees', `status ${driverWrite.status}`);

  console.log(`\n=== RESULT: ${passes.length} passed, ${fails.length} failed ===\n`);
  if (fails.length) {
    console.log('FAILURES:');
    fails.forEach((f) => console.log(`  - ${f}`));
    console.log('');
    process.exitCode = 1;
  }
})();
