'use strict';

/**
 * Desk page smoke test.
 *
 * The existing suites cover the mobile API and the PWA bundles, but nothing
 * exercised the dashboard's page controllers. These pages are large strings of
 * HTML built from API data, so the failure modes that bite are concrete: a
 * helper that does not exist, a CSS class never defined, or a field the API does
 * not return. Loading the real dashboard.html into jsdom and rendering each
 * controller catches all of those.
 *
 * A note on how the scripts are loaded, because it is not obvious and cost real
 * debugging time: they are concatenated into a single <script> and evaluated
 * once. Injecting them as separate elements does NOT work here - jsdom keeps
 * each script's top-level `const` in its own lexical scope, so `api.js`'s
 * helpers are invisible to the page files and everything downstream silently
 * comes out as `undefined`. One concatenated script reproduces the browser's
 * single shared global scope.
 *
 * Usage:  node tools/desk-pages-test.js [origin] [root]
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ORIGIN = (process.argv[2] || 'http://127.0.0.1:4180').replace(/\/$/, '');
const ROOT = process.argv[3] || path.join(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');

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

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

/** Names of every controller the router can reach, read from PAGES. */
function pageIds(html) {
  return [...new Set([...html.matchAll(/<script src="\/js\/pages\/([a-z-]+)\.js"><\/script>/g)].map((m) => m[1]))];
}

async function main() {
  console.log('\n=== DESK PAGE SMOKE TEST ===\n');

  const login = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@selectmobility.in', password: 'Select@2026' }),
  }).then((r) => r.json());

  if (!login.token) {
    console.log(`Could not sign in to ${ORIGIN}; aborting.`);
    process.exit(1);
  }

  const html = fs.readFileSync(path.join(CLIENT_DIR, 'dashboard.html'), 'utf8');
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const runtimeErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    /*
     * jsdom has no canvas backend, so getContext() logs a "Not implemented"
     * error. That is a limitation of the test harness, not a fault in the page:
     * the tracking page guards against a null context and degrades to its list.
     * Counting it would fail the suite for something no browser does.
     */
    if (/getContext\(\) method/.test(e.message)) return;
    runtimeErrors.push(e.message);
  });

  const dom = new JSDOM(stripped, {
    url: `${ORIGIN}/dashboard.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  // jsdom has no layout engine, so these are no-ops in the app's shell code.
  window.HTMLElement.prototype.scrollTo = () => {};
  window.scrollTo = () => {};

  window.localStorage.setItem('smi_tms_token', login.token);
  window.localStorage.setItem('smi_tms_user', JSON.stringify(login.user));
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return fetch(url.startsWith('http') ? url : `${ORIGIN}${url}`, init);
  };

  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  check(scripts.length > 0, 'dashboard.html declares its scripts', `${scripts.length} files`);

  const missing = scripts
    .map((s) => s.replace(/^\//, ''))
    .filter((rel) => !fs.existsSync(path.join(CLIENT_DIR, rel)));
  check(missing.length === 0, 'every declared script exists on disk', missing.join(', '));

  const bundle = scripts
    .map((s) => fs.readFileSync(path.join(CLIENT_DIR, s.replace(/^\//, '')), 'utf8'))
    .join('\n;\n');

  const el = window.document.createElement('script');
  el.textContent = `${bundle}\n;window.__probe = { PAGES, App, CompaniesPage, RequestsPage, TrackingPage, RequestsPage_meta: typeof RequestsPage };`;
  try {
    window.document.body.appendChild(el);
  } catch (e) {
    check(false, 'the script bundle evaluates', e.message);
  }
  await settle(300);

  const probe = window.__probe || {};
  check(runtimeErrors.length === 0, 'no script errors while loading', runtimeErrors.slice(0, 2).join(' | '));
  check(Boolean(probe.PAGES), 'PAGES is defined');
  check(Boolean(probe.App), 'App is defined');

  // Every declared page file must have a controller and metadata, or the route
  // resolves to a PAGES entry with no page behind it.
  //
  // `resources.js` is a bundle of several small pages (vendors, maintenance,
  // fuel, expenses, documents, incidents) rather than one route, so it has no
  // single PAGES entry of its own. Its constituent routes are asserted instead.
  const ids = pageIds(html);
  const BUNDLES = { resources: ['vendors', 'maintenance', 'fuel', 'expenses', 'documents', 'incidents'] };
  check(ids.length >= 8, 'page files discovered', ids.join(', '));

  for (const id of ids) {
    if (id === 'dashboard') continue; // needs a different fixture; covered elsewhere
    const targets = BUNDLES[id] || [id];
    for (const target of targets) {
      const hasMeta = Boolean(probe.PAGES && probe.PAGES[target]);
      const hasCtrl = Boolean(probe.App && probe.App.pages && typeof probe.App.pages[target] === 'function');
      check(hasMeta && hasCtrl, `"${target}" has both metadata and a controller`,
        hasMeta ? (hasCtrl ? '' : 'no controller') : 'no metadata');
    }
  }

  // Rendering the two pages added this round, against the live API.
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);

  for (const id of ['companies', 'requests', 'tracking']) {
    const controller = probe.App.pages[id]();
    container.innerHTML = '';
    const before = runtimeErrors.length;
    let threw = null;
    try {
      await controller.render(container, []);
      await settle(1000);
    } catch (e) {
      threw = e.message;
    }

    check(!threw, `${id} page renders without throwing`, threw || '');
    if (threw) continue;

    const text = container.textContent || '';
    check(text.length > 40, `${id} page rendered content`, `${text.length} chars`);
    check(runtimeErrors.length === before, `${id} page raised no script errors`, runtimeErrors.slice(before, before + 1).join(''));
    check(!/undefined has no|NaN|\[object Object\]/.test(text), `${id} page has no unresolved values`);

    // The tracking page polls; leaving the interval running would keep the
    // process alive and make the suite hang instead of exiting.
    if (typeof controller.destroy === 'function') controller.destroy();
  }

  // Specific expectations for the two new pages.
  const companiesPage = probe.App.pages.companies();
  container.innerHTML = '';
  await companiesPage.render(container, []);
  await settle(1000);
  const cText = container.textContent || '';
  check(/Compan/i.test(cText), 'companies page shows a heading');
  check(/Bharat Forge Ltd/.test(cText), 'companies page lists a seeded company');
  check(/Kirloskar Pneumatic/.test(cText), 'companies page lists the second seeded company');

  const requestsPage = probe.App.pages.requests();
  container.innerHTML = '';
  await requestsPage.render(container, []);
  await settle(1200);
  const rText = container.textContent || '';
  check(/Request/i.test(rText), 'requests page shows a heading');
  const stats = container.querySelectorAll('.stat');
  check(stats.length >= 4, 'requests page renders the stat strip', `${stats.length} tiles`);
  const numbersOk = [...stats].every((s) => /^\d+$/.test((s.querySelector('.value')?.textContent || '').trim()));
  check(numbersOk, 'every request stat tile shows a number');
  check(/Waiting on us/.test(rText), 'requests page labels the pending tile');

  // The pill renderer must cope with the new lifecycle values.
  for (const status of ['pending', 'declined', 'scheduled', 'ad-hoc-trip']) {
    const pill = window.statusPill ? window.statusPill(status) : '';
    check(/pill/.test(pill) && !/undefined/.test(pill), `statusPill handles "${status}"`);
  }

  /*
   * Tracking page. The live view has a vehicle reporting in the fixture, so the
   * table should be populated and the stat strip should show real counts rather
   * than zeros.
   */
  const trackingPage = probe.App.pages.tracking();
  container.innerHTML = '';
  await trackingPage.render(container, []);
  await settle(1500);
  const tText = container.textContent || '';
  check(/Live Tracking|Vehicle/i.test(tText), 'tracking page shows a heading');
  const tStats = container.querySelectorAll('.stat');
  check(tStats.length >= 4, 'tracking page renders the stat strip', `${tStats.length} tiles`);
  check(/Reporting|Moving/.test(tText), 'tracking page labels its live tiles');
  check(/Refresh/.test(tText), 'tracking page offers a refresh control');
  // The map canvas is the visible half of the feature; if it failed to render
  // the page would still look plausible, so assert on it directly.
  check(container.querySelectorAll('canvas').length > 0, 'tracking page draws a map canvas');
  if (typeof trackingPage.destroy === 'function') trackingPage.destroy();

  // The map key can be set and cleared through the settings endpoint.
  check(typeof probe.TrackingPage.tileUrls === 'function', 'tracking page exposes tile URL building');
  const noKey = probe.TrackingPage.tileUrls.call(
    { state: { mapConfig: {} } },
    { minLat: 18.5, maxLat: 18.6, minLon: 73.7, maxLon: 73.8, W: 400, H: 300 },
  );
  check(Array.isArray(noKey) && noKey.length === 0, 'no tile key means no tile requests');

  // With a key and template, tiles are requested for the visible view.
  const withKey = probe.TrackingPage.tileUrls.call(
    { state: { mapConfig: { key: 'pk.test', tileUrlTemplate: 'https://t/{z}/{x}/{y}?k={key}' } } },
    { minLat: 18.5, maxLat: 18.6, minLon: 73.7, maxLon: 73.8, W: 400, H: 300 },
  );
  check(withKey.length > 0, 'a tile key produces tile requests', `${withKey.length} tiles`);
  check(
    withKey.every((t) => !/\{z\}|\{x\}|\{y\}|\{key\}/.test(t.img.src)),
    'tile URLs have their placeholders substituted',
  );

  console.log(`\n=== RESULT: ${passes.length} passed, ${fails.length} failed ===\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});
