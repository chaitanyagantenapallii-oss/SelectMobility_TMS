/**
 * Functional test of the driver and client apps.
 *
 * Boots the real pages in jsdom against a LIVE server, signs in through the
 * real login endpoint, and drives the real render path for every tab.
 *
 * This exists because a syntax check says nothing about whether a screen
 * paints. The mistakes worth catching here are the ones that produce a blank
 * page and a silent console: a container id that does not exist, a helper
 * called before it is defined, a payload field named differently from the one
 * the API returns.
 *
 * Usage: node tools/pwa-test.js [projectRoot] [origin]
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.argv[2] || '.';
const ORIGIN = process.argv[3] || 'http://127.0.0.1:4000';

const passes = [];
const fails = [];

function check(ok, label, detail = '') {
  if (ok) {
    passes.push(label);
    console.log(`  [PASS] ${label}${detail ? ' - ' + detail : ''}`);
  } else {
    fails.push(label);
    console.log(`  [FAIL] ${label}${detail ? ' - ' + detail : ''}`);
  }
}

/**
 * Load a page into a window with its scripts evaluated in order.
 *
 * Scripts are read from disk rather than fetched so a failure is a real
 * failure, not a network hiccup; the API calls the app then makes are real.
 */
function makeWindow(page, { token, user } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'client', page), 'utf8');
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const runtimeErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // jsdom refuses to navigate at all. The apps route every redirect through
    // Mobile.navigate so they can be observed below; anything that still ends
    // up here is a navigation we did not intend, so it is flagged.
    if (String(e.message).includes('Not implemented: navigation')) {
      runtimeErrors.push('unexpected raw navigation (use Mobile.navigate)');
      return;
    }
    if (!String(e.message).includes('Not implemented')) runtimeErrors.push(String(e.message));
  });
  vc.on('error', (...a) => runtimeErrors.push(a.join(' ')));

  const dom = new JSDOM(stripped, {
    url: `${ORIGIN}/${page}`,
    runScripts: 'dangerously',
    virtualConsole: vc,
    pretendToBeVisual: true,
  });
  const w = dom.window;

  // jsdom implements neither navigation nor a service worker. Stub them so the
  // app's attempts to use them are observable instead of throwing.
  const navigations = [];
  w.scrollTo = () => {};
  w.matchMedia =
    w.matchMedia ||
    (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.URL.createObjectURL = () => 'blob:stub';
  w.URL.revokeObjectURL = () => {};
  w.navigator.serviceWorker = undefined;
  Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });

  // api.js reads its token from localStorage at load time, so it must be in
  // place before the scripts run.
  if (token) {
    w.localStorage.setItem('smi_tms_token', token);
    w.localStorage.setItem('smi_tms_user', JSON.stringify(user || {}));
  }

  // Real fetch against the live server; jsdom ships none.
  w.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return fetch(url.startsWith('http') ? url : ORIGIN + url, init);
  };

  /*
   * Capture navigations.
   *
   * jsdom refuses to navigate and does not report the destination, so a
   * redirect cannot be observed by watching the window. Instead the apps route
   * every redirect through Mobile.navigate, and this replaces that one
   * function so the destination can be asserted.
   *
   * This must happen after mobile.js has evaluated but before the page's own
   * script runs, because boot() calls requireRole immediately.
   */
  const navs = [];

  const tags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  for (const [, attrs, body] of tags) {
    const srcMatch = attrs.match(/\bsrc="([^"]+)"/i);
    const name = srcMatch ? srcMatch[1] : '(inline)';
    const el = w.document.createElement('script');
    el.textContent = srcMatch
      ? fs.readFileSync(path.join(ROOT, 'client', srcMatch[1].replace(/^\//, '')), 'utf8')
      : body;
    try {
      w.document.body.appendChild(el);
    } catch (e) {
      runtimeErrors.push(`${name}: ${e.message}`);
    }

    // Install the navigation recorder the moment mobile.js has defined it and
    // before the page script boots, otherwise the very first redirect (which
    // boot() performs) would be missed.
    if (name.endsWith('mobile.js') && w.Mobile && w.Mobile._setNavigateForTest) {
      w.Mobile._setNavigateForTest((p) => navs.push(String(p)));
    }
  }

  // `history.replaceState` is called by the app's own tab router, so it is
  // left alone; only genuine navigations are collected.
  return { w, runtimeErrors, navigations: { get all() { return navs; } } };
}

/** Poll until `predicate` returns true or the budget runs out. */
async function settle(fn, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 90));
    if (await fn()) return true;
  }
  return false;
}

async function login(email, password) {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.json();
}

/* -------------------------------------------------------------------------- */

(async () => {
  console.log('\n=== DRIVER AND CLIENT APP TEST (live server, real DOM) ===\n');

  // --- Assets resolve as themselves, not as the SPA fallback ----------------
  console.log('Assets');
  const assets = [
    ['/driver.html', 'text/html'],
    ['/client.html', 'text/html'],
    ['/css/mobile.css', 'text/css'],
    ['/js/mobile.js', 'javascript'],
    ['/js/driver-app.js', 'javascript'],
    ['/js/client-app.js', 'javascript'],
    ['/sw.js', 'javascript'],
    ['/manifest-driver.webmanifest', 'manifest+json'],
    ['/manifest-client.webmanifest', 'manifest+json'],
    ['/icons/icon-192.png', 'image/png'],
    ['/icons/icon-512.png', 'image/png'],
  ];
  for (const [p, expected] of assets) {
    const res = await fetch(ORIGIN + p);
    const type = res.headers.get('content-type') || '';
    // A wrong content-type here usually means the file is missing and the SPA
    // fallback answered with index.html instead, which is a silent trap.
    check(res.status === 200 && type.includes(expected), `${p} serves as ${expected}`, `${res.status} ${type}`);
  }

  const mf = await (await fetch(`${ORIGIN}/manifest-driver.webmanifest`)).json();
  check(mf.start_url === '/driver.html', 'driver manifest opens the driver app');
  check((mf.icons || []).length >= 2, 'driver manifest declares icons', `${(mf.icons || []).length}`);
  check((mf.icons || []).some((i) => i.purpose === 'maskable'), 'driver manifest has a maskable icon');

  const cf = await (await fetch(`${ORIGIN}/manifest-client.webmanifest`)).json();
  check(cf.start_url === '/client.html', 'client manifest opens the client app');

  // --- Sign in -------------------------------------------------------------
  console.log('\nAuthentication');
  const driver = await login('driver@selectmobility.in', 'Driver@2026');
  check(Boolean(driver.token), 'driver signs in', driver.user && driver.user.role);
  const client = await login('client@selectmobility.in', 'Client@2026');
  check(Boolean(client.token), 'client signs in', client.user && client.user.role);

  /*
   * --- Establish the open-trip fixture before any page loads ----------------
   *
   * Find a trip that is genuinely open, or raise one.
   *
   * The seed data has every one of today's trips already completed, so relying
   * on the fixtures to supply an open trip would make the boarding section skip
   * itself and quietly prove nothing. A test that silently skips its real
   * assertions is worse than no test, so we create the precondition we need
   * through the same desk endpoint the office uses.
   *
   * This runs *before* the driver page is loaded, and that ordering is the
   * whole point. The page paints its Today tab once, at boot. Raising the trip
   * afterwards leaves the page showing what it legitimately fetched a moment
   * earlier - correct behaviour, not a bug - but it made this suite fail its
   * first run against a cold database and pass on every rerun, because the
   * reruns found the trip the previous run had left behind. Setting the
   * fixture up here removes that dependency on test history.
   */
  const findOpenTrip = async () => {
    const res = await fetch(`${ORIGIN}/api/mobile/driver/me`, {
      headers: { Authorization: `Bearer ${driver.token}` },
    });
    const body = await res.json();
    return [...(body.today || []), ...(body.upcoming || [])].find(
      (t) => t.status === 'scheduled' || t.status === 'in-progress'
    );
  };

  let openTrip = await findOpenTrip();

  if (!openTrip) {
    const admin = await login('admin@selectmobility.in', 'Select@2026');
    const auth = { Authorization: `Bearer ${admin.token}` };

    // Take the driver identity from the mobile API itself, not from the desk's
    // driver list. The desk list is sorted independently, so its first row is
    // usually a different driver - and a trip assigned to somebody else is
    // invisible to this driver, which made the trip look like it had not been
    // created at all.
    const who = await (await fetch(`${ORIGIN}/api/mobile/driver/me`, {
      headers: { Authorization: `Bearer ${driver.token}` },
    })).json();

    const routes = await (await fetch(`${ORIGIN}/api/routes?limit=50`, { headers: auth })).json();
    const allRoutes = routes.data || [];
    // The route must belong to the driver's own shift, otherwise the desk
    // rejects the pairing as inconsistent.
    const driverTrips = await (await fetch(`${ORIGIN}/api/mobile/driver/trips`, {
      headers: { Authorization: `Bearer ${driver.token}` },
    })).json();
    const knownShiftId = (driverTrips.data || [])[0]?.shift?.id;
    const route = allRoutes.find((r) => r.shiftId === knownShiftId) || allRoutes[0];

    if (who.driver && route) {
      const created = await fetch(`${ORIGIN}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          routeId: route.id,
          shiftId: route.shiftId,
          vehicleId: (who.vehicles || [])[0]?.id || route.vehicleId || undefined,
          driverId: who.driver.id,
          status: 'scheduled',
          plannedKm: (route.distanceKm || 30) * 2,
        }),
      });
      const body = await created.json().catch(() => ({}));
      check(created.ok, 'an open trip can be raised for the test',
        created.ok ? (body.data || body).id : `status ${created.status}: ${body.message || ''}`);
      openTrip = await findOpenTrip();
    }
  }

  // =========================================================================
  // DRIVER APP
  // =========================================================================
  console.log('\nDriver app');
  const { w: D, runtimeErrors: driverErrs, navigations: driverNavs } = makeWindow('driver.html', {
    token: driver.token,
    user: driver.user,
  });

  check(driverErrs.length === 0, 'driver app loads without script errors', driverErrs.join('; ').slice(0, 180));

  const driverView = D.document.getElementById('view');
  check(Boolean(driverView), 'driver app has a #view mount point');

  const painted = await settle(() => {
    const el = D.document.getElementById('view');
    return el && el.innerHTML.length > 400 && !el.innerHTML.includes('skeleton');
  });
  check(painted, 'driver home screen paints');

  const homeHtml = D.document.getElementById('view').innerHTML;
  check(D.document.getElementById('bar-sub').textContent.includes('Ramesh'), 'driver name appears in the header',
    D.document.getElementById('bar-sub').textContent);
  check(!homeHtml.includes('Cannot reach the office'), 'driver home is not an error panel');

  // Tab bar wiring
  const tabs = Array.from(D.document.querySelectorAll('.tabbar button')).map((b) => b.dataset.tab);
  check(tabs.length === 4, 'driver app has four tabs', tabs.join(', '));

  for (const tab of ['history', 'log', 'me']) {
    const btn = D.document.querySelector(`.tabbar button[data-tab="${tab}"]`);
    btn.dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
    const ok = await settle(() => {
      const el = D.document.getElementById('view');
      return el && el.innerHTML.length > 300 && !el.innerHTML.includes('skeleton');
    }, 14000);
    const html = D.document.getElementById('view').innerHTML;
    check(ok && !html.includes('Something went wrong'), `driver tab renders: ${tab}`, `${html.length} bytes`);
  }

  // The log tab must expose both write paths the user asked for.
  D.document.querySelector('.tabbar button[data-tab="log"]').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await settle(() => D.document.getElementById('bd-desc'));
  check(Boolean(D.document.getElementById('bd-desc')), 'breakdown form is present');
  check(Boolean(D.document.getElementById('fu-litres')), 'fuel form is present');
  check(Boolean(D.document.getElementById('bd-sev')), 'breakdown severity is selectable');

  // Empty-submission guard: a breakdown with no description must be refused
  // client-side rather than posted as an empty report.
  const before = D.document.getElementById('bd-err').textContent;
  D.document.getElementById('bd-send').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const after = D.document.getElementById('bd-err').textContent;
  check(!before && Boolean(after), 'empty breakdown is refused before sending', after);

  // --- Real write: board a passenger ---------------------------------------
  console.log('\nDriver write path');

  // openTrip was established before this page was loaded - see the fixture
  // block above the driver app section for why the ordering matters.
  if (!openTrip) {
    check(false, 'a driver has an open trip to work with', 'none found and none could be created');
  } else {
    check(true, 'a driver has an open trip to work with', `${openTrip.id} ${openTrip.status}`);

    /*
     * Open the manifest the way a driver does: go back to the Today tab and
     * tap the trip card. Calling an internal function would not work - the
     * page's controllers live inside an IIFE and are deliberately not global -
     * and clicking is the better test anyway, because it proves the card is
     * reachable and wired to the right trip.
     */
    D.document.querySelector('.tabbar button[data-tab="today"]').dispatchEvent(
      new D.MouseEvent('click', { bubbles: true })
    );
    await settle(() => D.document.querySelector('.trip'));

    const card = Array.from(D.document.querySelectorAll('.trip')).find(
      (el) => el.dataset.id === openTrip.id
    );
    check(Boolean(card), 'the open trip appears as a card on the Today tab',
      `${D.document.querySelectorAll('.trip').length} cards shown`);

    if (card) card.dispatchEvent(new D.MouseEvent('click', { bubbles: true }));

    const manifestReady = await settle(() => {
      const el = D.document.getElementById('view');
      return el && el.innerHTML.includes('class="pax');
    }, 14000);

    check(manifestReady, 'manifest opens with passengers listed');
    check(D.document.querySelectorAll('.pax').length > 0, 'manifest rows render',
      `${D.document.querySelectorAll('.pax').length} passengers`);

    const tick = D.document.querySelector('.pax .tick:not([disabled])');
    if (tick) {
      const bookingId = tick.dataset.booking;
      tick.dispatchEvent(new D.MouseEvent('click', { bubbles: true }));

      const boarded = await settle(async () => {
        const res = await fetch(`${ORIGIN}/api/mobile/driver/trips/${openTrip.id}`, {
          headers: { Authorization: `Bearer ${driver.token}` },
        });
        const data = await res.json();
        const p = (data.passengers || []).find((x) => x.bookingId === bookingId);
        // "completed" is the API's word for present; "boarded" only ever
        // appeared in the app's own wording before this was corrected.
        return p && (p.status === 'completed' || p.status === 'boarded');
      }, 9000);

      check(boarded, 'tapping a passenger writes boarding to the server', bookingId);

      // Undo, so re-running the test does not accumulate state.
      await fetch(`${ORIGIN}/api/mobile/driver/trips/${openTrip.id}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driver.token}` },
        body: JSON.stringify({ entries: [{ bookingId, status: 'confirmed' }] }),
      });
    } else {
      check(false, 'a passenger can be tapped to board', 'no enabled tick found');
    }
  }

  // --- Role separation on the pages themselves -----------------------------
  console.log('\nRole separation (pages)');
  const asClient = makeWindow('driver.html', { token: client.token, user: client.user });
  await new Promise((r) => setTimeout(r, 700));
  check(
    asClient.navigations.all.some((u) => u.includes('client.html')),
    'a client account on the driver page is redirected to the client app',
    asClient.navigations.all.join(',') || 'no redirect'
  );

  const asDriver = makeWindow('client.html', { token: driver.token, user: driver.user });
  await new Promise((r) => setTimeout(r, 700));
  check(
    asDriver.navigations.all.some((u) => u.includes('driver.html')),
    'a driver account on the client page is redirected to the driver app',
    asDriver.navigations.all.join(',') || 'no redirect'
  );

  const nobody = makeWindow('driver.html', {});
  await new Promise((r) => setTimeout(r, 700));
  check(
    nobody.navigations.all.some((u) => u.includes('login.html')),
    'a signed-out visitor is sent to the sign-in page',
    nobody.navigations.all.join(',') || 'no redirect'
  );

  // =========================================================================
  // CLIENT APP
  // =========================================================================
  console.log('\nClient app');
  const { w: C, runtimeErrors: clientErrs } = makeWindow('client.html', {
    token: client.token,
    user: client.user,
  });

  check(clientErrs.length === 0, 'client app loads without script errors', clientErrs.join('; ').slice(0, 180));
  check(Boolean(C.document.getElementById('view')), 'client app has a #view mount point');

  const cPainted = await settle(() => {
    const el = C.document.getElementById('view');
    return el && el.innerHTML.length > 300 && !el.innerHTML.includes('skeleton');
  });
  check(cPainted, 'client overview paints');
  check(
    C.document.getElementById('bar-sub').textContent.includes('Bharat Forge'),
    'client sees their own organisation',
    C.document.getElementById('bar-sub').textContent
  );

  const overview = C.document.getElementById('view').innerHTML;
  check(overview.includes('My staff'), 'client overview shows their staff count');

  const cTabs = Array.from(C.document.querySelectorAll('.tabbar button')).map((b) => b.dataset.tab);
  check(cTabs.length === 5, 'client app has five tabs', cTabs.join(', '));

  for (const tab of ['roster', 'history', 'statement', 'requests']) {
    C.document.querySelector(`.tabbar button[data-tab="${tab}"]`).dispatchEvent(
      new C.MouseEvent('click', { bubbles: true })
    );
    const ok = await settle(() => {
      const el = C.document.getElementById('view');
      return el && el.innerHTML.length > 300 && !el.innerHTML.includes('skeleton');
    }, 14000);
    const html = C.document.getElementById('view').innerHTML;
    check(ok && !html.includes('Something went wrong'), `client tab renders: ${tab}`, `${html.length} bytes`);
  }

  // Statement substance: it must show money and the seat-km rule.
  C.document.querySelector('.tabbar button[data-tab="statement"]').dispatchEvent(
    new C.MouseEvent('click', { bubbles: true })
  );
  await settle(() => C.document.getElementById('view').innerHTML.includes('Amount due'), 14000);
  const stmtHtml = C.document.getElementById('view').innerHTML;
  check(stmtHtml.includes('Amount due'), 'statement shows an amount due');
  check(stmtHtml.includes('seat-kilometres'), 'statement explains the seat-km basis');
  check(stmtHtml.includes('<table'), 'statement renders an itemised table');
  check(Boolean(C.document.getElementById('dl')), 'statement can be downloaded');

  // Roster must show the client's own staff only.
  C.document.querySelector('.tabbar button[data-tab="roster"]').dispatchEvent(
    new C.MouseEvent('click', { bubbles: true })
  );
  await settle(() => C.document.getElementById('view').innerHTML.includes('staff across'), 14000);
  const rosterHtml = C.document.getElementById('view').innerHTML;
  const rosterApi = await (await fetch(`${ORIGIN}/api/mobile/client/roster`, {
    headers: { Authorization: `Bearer ${client.token}` },
  })).json();
  const rosterRows = rosterApi.data || [];
  check(rosterRows.length > 0, 'roster returns the organisation\'s staff', `${rosterRows.length} people`);
  check(rosterHtml.includes(String(rosterRows[0] && rosterRows[0].name).slice(0, 8)),
    'roster renders a real staff member from the API');

  // Cross-check against the desk's own view of the same organisation. The
  // client token must not be able to see staff belonging to another one.
  const allStaff = await (await fetch(`${ORIGIN}/api/employees?limit=500`, {
    headers: { Authorization: `Bearer ${client.token}` },
  })).json().catch(() => ({}));
  check(
    !allStaff.data || allStaff.data.length === 0 || (allStaff.data || []).every((e) => e.organisation === 'Bharat Forge Ltd'),
    'the client token cannot list staff outside its organisation',
    `${(allStaff.data || []).length} rows`
  );

  // --- Raise a request for real -------------------------------------------
  console.log('\nClient write path');
  C.document.querySelector('.tabbar button[data-tab="requests"]').dispatchEvent(
    new C.MouseEvent('click', { bubbles: true })
  );
  await settle(() => C.document.getElementById('rq-title'), 14000);

  // A too-short summary must be refused before it reaches the server.
  C.document.getElementById('rq-title').value = 'x';
  C.document.getElementById('rq-send').dispatchEvent(new C.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  check(Boolean(C.document.getElementById('rq-err').textContent),
    'a one-letter request summary is refused', C.document.getElementById('rq-err').textContent);

  const marker = `test request ${Date.now()}`;
  C.document.getElementById('rq-title').value = marker;
  C.document.getElementById('rq-send').dispatchEvent(new C.MouseEvent('click', { bubbles: true }));

  const created = await settle(async () => {
    const res = await fetch(`${ORIGIN}/api/mobile/client/requests`, {
      headers: { Authorization: `Bearer ${client.token}` },
    });
    const data = await res.json();
    // The record field is `subject`, not `title` - the API and the form label
    // differ deliberately, so assert on what the API actually returns.
    return (data.data || []).some((r) => r.subject === marker);
  }, 9000);
  check(created, 'raising a request reaches the server', marker);

  // --- Client cannot reach driver data ------------------------------------
  console.log('\nScoping');
  const crossRes = await fetch(`${ORIGIN}/api/mobile/driver/me`, {
    headers: { Authorization: `Bearer ${client.token}` },
  });
  check(crossRes.status === 403, 'a client token is refused on driver endpoints', `status ${crossRes.status}`);

  const wrongOrg = await fetch(`${ORIGIN}/api/mobile/client/history?employeeId=EMP0001`, {
    headers: { Authorization: `Bearer ${client.token}` },
  });
  const wrongBody = await wrongOrg.json().catch(() => ({}));
  // EMP0001 may or may not belong to this client; either a 403 or a 200 that
  // genuinely contains them is correct. What is never correct is a 500.
  check(
    wrongOrg.status === 200 || wrongOrg.status === 403,
    'a cross-organisation staff lookup is refused or scoped, never a crash',
    `status ${wrongOrg.status} ${wrongBody.message || ''}`
  );

  // --- Summary -------------------------------------------------------------
  console.log(`\n=== RESULT: ${passes.length} passed, ${fails.length} failed ===`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('\nTest suite crashed:', err);
  process.exit(1);
});
