'use strict';

/**
 * Standalone end-to-end API smoke test for Select Mobility TMS.
 * Run the server first, then: node tools/smoke-test.js
 */

const http = require('http');

const PORT = Number(process.env.TEST_PORT || process.env.PORT || 4000);
const BASE = { host: '127.0.0.1', port: PORT };
let TOKEN = '';

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        ...BASE,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(raw); } catch { parsed = raw.slice(0, 200); }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      },
    );
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

function line(label, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ' - ' + detail : ''}`);
  return ok;
}

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (label, ok, detail) => { if (line(label, ok, detail)) pass += 1; else fail += 1; };

  console.log('\n=== SELECT MOBILITY TMS - END TO END SMOKE TEST ===\n');

  console.log('Health & auth');
  const health = await req('GET', '/api/health');
  check('GET /api/health', health.status === 200 && health.body.status === 'ok', `vehicles=${health.body.records?.vehicles}`);

  const badLogin = await req('POST', '/api/auth/login', { email: 'admin@selectmobility.in', password: 'wrong-password' });
  check('rejects bad credentials', badLogin.status === 401);

  const unauth = await req('GET', '/api/vehicles');
  check('blocks unauthenticated API access', unauth.status === 401);

  const login = await req('POST', '/api/auth/login', { email: 'admin@selectmobility.in', password: 'Select@2026' });
  check('admin sign in', login.status === 200 && Boolean(login.body.token), `role=${login.body.user?.role}`);
  TOKEN = login.body.token;

  const me = await req('GET', '/api/auth/me');
  check('GET /api/auth/me', me.status === 200 && me.body.user?.email === 'admin@selectmobility.in');

  console.log('\nCollections');
  for (const ep of ['vehicles', 'drivers', 'employees', 'routes', 'shifts', 'trips', 'maintenance', 'fuel', 'documents', 'vendors', 'expenses', 'users']) {
    const r = await req('GET', `/api/${ep}`);
    check(`GET /api/${ep}`, r.status === 200 && Array.isArray(r.body.data), `${r.body.data?.length} rows`);
  }

  /**
   * Regression guard: every collection the frontend fetches must exist as a
   * route. A missing route returns 404, which the page renders as an error
   * panel - several pages were silently broken this way because the old suite
   * only exercised collections it already knew about.
   */
  console.log('\nFrontend / backend contract');
  {
    const fs = require('fs');
    const path = require('path');
    const pagesDir = path.join(__dirname, '..', 'client', 'js', 'pages');
    const sources = [
      fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'api.js'), 'utf8'),
      ...fs.readdirSync(pagesDir).map((f) => fs.readFileSync(path.join(pagesDir, f), 'utf8')),
    ].join('\n');

    // Collect the first path segment of every Api.get('/foo...') call.
    const called = new Set();
    for (const m of sources.matchAll(/Api\.(?:get|post|put|del)\(\s*[`'"]\/([a-z-]+)/gi)) {
      called.add(m[1]);
    }
    // Endpoints that are intentionally not collection resources.
    const nonCollection = new Set(['auth', 'health', 'dashboard', 'reports', 'search']);

    for (const ep of [...called].filter((e) => !nonCollection.has(e)).sort()) {
      const r = await req('GET', `/api/${ep}`);
      // A 404 means the frontend calls an endpoint that does not exist.
      // A 2xx or 401/403 means the route exists (guarded or open), which is
      // fine here. A transport error (status 0) must NOT pass - that would
      // make this guard silently useless.
      const missing = r.status === 404;
      const broken = r.status === 0;
      check(
        `frontend endpoint exists: GET /api/${ep}`,
        !missing && !broken,
        r.status === 0 ? 'no response from server' : `status ${r.status}`,
      );
    }
  }

  console.log('\nEnriched / computed views');
  const veh = await req('GET', '/api/vehicles?pageSize=3');
  const v0 = veh.body.data?.[0];
  check('vehicle enrichment', Boolean(v0?.vendorName && v0?.stats), `${v0?.regNo} vendor=${v0?.vendorName} nextDue=${v0?.nextDue?.daysLeft}d`);

  const tripsPaged = await req('GET', '/api/trips?pageSize=3&page=1');
  const tripId = tripsPaged.body.data?.[0]?.id;
  check('trip pagination metadata', Boolean(tripsPaged.body.meta?.total && tripsPaged.body.meta?.totalPages), JSON.stringify(tripsPaged.body.meta));

  /*
   * A trip that is guaranteed to have a manifest, for the attendance check
   * further down.
   *
   * Taking "the first trip" and hoping it has passengers made that check fail
   * for reasons that had nothing to do with attendance - it depended on the
   * order the fixtures happened to come back in. Trips raised from the desk
   * now auto-book the route's employees, so a trip is only a valid sample if
   * one of them exists; we pick one deliberately rather than by luck.
   */
  const pagedTrips = await req('GET', '/api/trips?pageSize=50');
  const tripWithManifest = (pagedTrips.body.data || []).find(
    (t) => Number(t.passengersAllocated || 0) > 0
  );
  const manifestTripId = tripWithManifest ? tripWithManifest.id : tripId;

  const filtered = await req('GET', '/api/trips?status=completed');
  check('trip status filter', filtered.status === 200 && filtered.body.data.every((t) => t.status === 'completed'), `${filtered.body.data.length} completed`);

  const searched = await req('GET', '/api/employees?search=deshmukh');
  check('employee search', searched.status === 200, `${searched.body.data.length} matches`);

  const man = await req('GET', `/api/trips/${tripId}/manifest`);
  check('trip manifest', man.status === 200 && Array.isArray(man.body.data?.stops), `route=${man.body.data?.route?.code} total=${man.body.data?.summary?.total}`);

  const roster = await req('GET', '/api/routes/RTE0001/roster');
  check('route roster grouped by stop', roster.status === 200 && Array.isArray(roster.body.data?.stops), `${roster.body.data?.totalEmployees} employees across ${roster.body.data?.stops?.length} stops`);

  const alerts = await req('GET', '/api/documents/alerts?window=500');
  check('compliance alert radar', alerts.status === 200 && Array.isArray(alerts.body.data), `${alerts.body.data?.length} documents tracked, expired=${alerts.body.meta?.expired}`);

  const expSum = await req('GET', '/api/expenses/summary');
  check('expense monthly rollup', expSum.status === 200 && expSum.body.data?.months?.length > 0, `grand=${expSum.body.data?.grandTotal}`);

  const util = await req('GET', '/api/dashboard/vehicle-utilisation?days=30');
  check('vehicle utilisation', util.status === 200 && util.body.data?.length > 0, `top=${util.body.data?.[0]?.regNo} ${util.body.data?.[0]?.km}km @ ${util.body.data?.[0]?.kmPerLitre} km/l`);

  const dash = await req('GET', '/api/dashboard/overview');
  const k = dash.body.data?.kpis;
  check('dashboard overview', dash.status === 200 && Boolean(k), `fleet=${k?.totalVehicles} active=${k?.activeVehicles} tripsToday=${k?.tripsToday} mtdCost=${k?.monthToDateCost}`);
  check('dashboard trend series', dash.body.data?.utilisationSeries?.length === 14);
  check('dashboard route load', dash.body.data?.routeLoad?.length > 0, `${dash.body.data?.routeLoad?.length} routes`);

  console.log('\nReports');
  const cat = await req('GET', '/api/reports');
  check('report catalogue', cat.status === 200 && cat.body.data?.length >= 10, `${cat.body.data?.length} reports`);
  for (const rep of cat.body.data || []) {
    const j = await req('GET', `/api/reports/${rep.key}.json?from=2026-08-01&to=2026-12-31`);
    check(`report ${rep.key}`, j.status === 200 && Boolean(j.body.meta), `${j.body.meta?.rowCount} rows`);
  }

  console.log('\nCSV export');
  const csv = await req('GET', '/api/reports/trips.csv?from=2026-08-01&to=2026-12-31');
  const isCsv = typeof csv.body === 'string' && csv.body.includes(',');
  check('trips.csv download', csv.status === 200 && isCsv, `${String(csv.body).split('\r\n').length - 2} data rows, type=${csv.headers['content-type']}`);
  check('content-disposition set', String(csv.headers['content-disposition'] || '').includes('.csv'), csv.headers['content-disposition']);

  console.log('\nWrite operations & validation');
  const created = await req('POST', '/api/vehicles', { regNo: 'mh-12-zz-9999', model: 'Validation Test Bus', type: 'bus', seats: 30, odometer: 1000 });
  check('create vehicle (normalises regNo)', created.status === 201 && created.body.data?.regNo === 'MH-12-ZZ-9999', created.body.data?.id);
  const newId = created.body.data?.id;

  const dup = await req('POST', '/api/vehicles', { regNo: 'MH-12-ZZ-9999', model: 'Duplicate', type: 'bus' });
  check('rejects duplicate registration', dup.status === 409, dup.body.message?.slice(0, 60));

  const invalid = await req('POST', '/api/vehicles', { regNo: 'MH-12-YY-1111', model: 'Bad Seats', type: 'bus', seats: 999 });
  check('rejects out-of-range seat count', invalid.status === 400, invalid.body.message);

  const missing = await req('POST', '/api/vehicles', { model: 'No Reg No' });
  check('rejects missing required fields', missing.status === 400, missing.body.message);

  const badFk = await req('POST', '/api/trips', { date: '2026-09-13', routeId: 'RTE9999', vehicleId: 'VEH0001', driverId: 'DRV0001', shiftId: 'SHF0001' });
  check('rejects unknown foreign key', badFk.status === 400, badFk.body.message);

  const updated = await req('PUT', `/api/vehicles/${newId}`, { status: 'maintenance' });
  check('update vehicle', updated.status === 200 && updated.body.data?.status === 'maintenance');

  const notFound = await req('GET', '/api/vehicles/VEH9999');
  check('404 for unknown record', notFound.status === 404);

  const deleted = await req('DELETE', `/api/vehicles/${newId}`);
  check('delete vehicle', deleted.status === 200 && deleted.body.ok === true);

  console.log('\nTrip operations');
  const manifest2 = await req('GET', `/api/trips/${manifestTripId}/manifest`);
  const pax = (manifest2.body.data?.stops || []).flatMap((s) => s.passengers)[0];
  if (pax) {
    const att = await req('POST', `/api/trips/${manifestTripId}/attendance`, { entries: [{ bookingId: pax.bookingId, boarded: true }] });
    check('mark attendance', att.status === 200 && att.body.ok === true, `updated=${att.body.updated} boarded=${att.body.boarded}`);
  } else {
    check('mark attendance', false, `no passengers on trip ${manifestTripId} (allocated=${tripWithManifest?.passengersAllocated})`);
  }

  const comp = await req('POST', `/api/trips/${tripId}/complete`, { actualKm: 42.5, fuelCost: 520, tollCost: 60 });
  check('complete trip', comp.status === 200 && comp.body.data?.status === 'completed', `actualKm=${comp.body.data?.actualKm}`);

  console.log('\nRole based access control');
  const opsLogin = await req('POST', '/api/auth/login', { email: 'ops@selectmobility.in', password: 'Ops@2026' });
  check('operations user signs in', opsLogin.status === 200);
  const adminToken = TOKEN;
  TOKEN = opsLogin.body.token;
  const opsUsers = await req('GET', '/api/users');
  check('operations role blocked from user admin', opsUsers.status === 403, opsUsers.body.message);
  const opsCreate = await req('POST', '/api/drivers', { name: 'Temp Driver', phone: '+91 90000 00000', licenceNo: 'TESTLIC9999' });
  check('operations role may manage fleet records', opsCreate.status === 201, opsCreate.body.data?.id);
  if (opsCreate.body.data?.id) await req('DELETE', `/api/drivers/${opsCreate.body.data.id}`);
  TOKEN = adminToken;

  console.log('\nStatic client hosting');
  const page = await req('GET', '/');
  check('serves client index.html', page.status === 200 && String(page.body).includes('<html'), `type=${page.headers['content-type']}`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
