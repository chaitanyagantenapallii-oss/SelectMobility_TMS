'use strict';

/**
 * Frontend asset verifier.
 * Confirms every page and static asset the browser needs is served correctly
 * and that no script or stylesheet reference is broken.
 */

const http = require('http');

const PORT = Number(process.env.TEST_PORT || process.env.PORT || 4000);
const BASE = { host: '127.0.0.1', port: PORT };

function fetchPath(path) {
  return new Promise((resolve) => {
    const r = http.request({ ...BASE, method: 'GET', path }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: raw }));
    });
    r.on('error', (e) => resolve({ status: 0, body: e.message, type: '' }));
    r.end();
  });
}

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (label, ok, detail) => {
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' - ' + detail : ''}`);
    if (ok) pass += 1; else fail += 1;
  };

  console.log('\n=== FRONTEND ASSET VERIFICATION ===\n');

  const pages = ['/', '/login.html', '/dashboard.html'];
  for (const p of pages) {
    const res = await fetchPath(p);
    check(`page ${p}`, res.status === 200 && res.body.includes('<html'), `${res.type}, ${res.body.length} bytes`);
  }

  // Verify the login page contains the sign-in form and the redirect logic.
  const login = await fetchPath('/login.html');
  check('login form present', login.body.includes('id="login-form"') && login.body.includes('id="password"'));
  check('login loads the API client', login.body.includes('/js/api.js'));
  check('login loads its own stylesheet', login.body.includes('/css/login.css'));
  check('login loads its own controller', login.body.includes('/js/login.js'));
  // The efficiency affordances: password reveal, remembered email, caps-lock hint.
  check('login offers password reveal',
    login.body.includes('id="pw-toggle"'));
  check('login offers remember-me',
    login.body.includes('id="remember"'));
  check('login warns on Caps Lock',
    login.body.includes('id="caps-warn"'));
  check('login fields are labelled',
    (login.body.match(/<label[^>]*for="(email|password)"/g) || []).length === 2);

  // Both login assets must actually resolve, and the stylesheet must carry the
  // rules rather than silently 404-ing into the SPA fallback page.
  const loginCss = await fetchPath('/css/login.css');
  check('login.css serves as stylesheet',
    loginCss.status === 200 && !loginCss.body.trim().startsWith('<!DOCTYPE'),
    loginCss.body.trim().startsWith('<!DOCTYPE') ? 'served HTML fallback instead' : `${loginCss.body.length} bytes`);
  check('login.css defines the login shell', loginCss.body.includes('.login-shell'));
  check('login.css respects reduced motion', loginCss.body.includes('prefers-reduced-motion'));

  const loginJs = await fetchPath('/js/login.js');
  check('login.js serves as script',
    loginJs.status === 200 && !loginJs.body.trim().startsWith('<!DOCTYPE'),
    loginJs.body.trim().startsWith('<!DOCTYPE') ? 'served HTML fallback instead' : `${loginJs.body.length} bytes`);
  check('login.js validates before submitting', loginJs.body.includes('validateEmail') && loginJs.body.includes('EMAIL_RE'));

  // Legacy login rules must not linger in app.css now that login.css owns them,
  // otherwise two competing breakpoints fight over the same class names.
  const appCssBody = (await fetchPath('/css/app.css')).body;
  check('app.css no longer styles the login screen',
    !appCssBody.includes('.login-brand') && !appCssBody.includes('.login-shell'));

  // Verify the dashboard shell and that every referenced script actually resolves.
  const dash = await fetchPath('/dashboard.html');
  check('sidebar navigation shell', dash.body.includes('id="nav"') && dash.body.includes('id="content"'));

  const scriptRefs = [...dash.body.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  check('dashboard references assets', scriptRefs.length >= 10, `${scriptRefs.length} assets referenced`);

  for (const ref of scriptRefs) {
    const res = await fetchPath(ref);
    const isJs = ref.endsWith('.js');
    check(
      `asset ${ref}`,
      res.status === 200 && res.body.length > 100 && (!isJs || res.type.includes('javascript')),
      `${res.status}, ${res.body.length} bytes`,
    );
  }

  // Every page controller must be reachable from the router.
  const appJs = await fetchPath('/js/app.js');
  const expected = ['dashboard', 'trips', 'manifests', 'routes', 'shifts', 'vehicles',
    'drivers', 'employees', 'vendors', 'maintenance', 'fuel', 'expenses',
    'documents', 'incidents', 'reports', 'users'];
  const missing = expected.filter((name) => !appJs.body.includes(`${name}:`));
  check('router covers all pages', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${expected.length} routes`);

  // Each page module must expose the global object referenced by the router.
  const modules = {
    '/js/pages/dashboard.js': 'DashboardPage',
    '/js/pages/trips.js': 'TripsPage',
    '/js/pages/manifests.js': 'ManifestsPage',
    '/js/pages/routes.js': 'RoutesPage',
    '/js/pages/vehicles.js': 'VehiclesPage',
    '/js/pages/employees.js': 'EmployeesPage',
    '/js/pages/resources.js': 'IncidentsPage',
    '/js/pages/reports.js': 'ReportsPage',
  };
  for (const [path, symbol] of Object.entries(modules)) {
    const res = await fetchPath(path);
    check(`module ${path.replace('/js/pages/', '')} exports ${symbol}`, res.body.includes(`const ${symbol}`));
  }

  // ShiftsPage and DriversPage both live inside routes.js / vehicles.js.
  const routesJs = await fetchPath('/js/pages/routes.js');
  check('ShiftsPage defined in routes.js', routesJs.body.includes('const ShiftsPage'));
  const vehiclesJs = await fetchPath('/js/pages/vehicles.js');
  check('DriversPage defined in vehicles.js', vehiclesJs.body.includes('const DriversPage'));
  const resourcesJs = await fetchPath('/js/pages/resources.js');
  for (const sym of ['VendorsPage', 'MaintenancePage', 'FuelPage', 'ExpensesPage', 'DocumentsPage']) {
    check(`${sym} defined in resources.js`, resourcesJs.body.includes(`const ${sym}`));
  }

  // The CSS must define the brand palette and responsive breakpoints.
  const css = await fetchPath('/css/app.css');
  check('stylesheet served', css.status === 200 && css.type.includes('css'), `${css.body.length} bytes`);
  check('brand variables defined', css.body.includes('--brand-700') && css.body.includes('--sidebar-w'));
  check('responsive rules present', css.body.includes('@media (max-width: 900px)') && css.body.includes('@media print'));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
