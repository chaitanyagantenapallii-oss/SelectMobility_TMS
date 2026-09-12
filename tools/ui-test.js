/**
 * Functional smoke test of the rendered UI.
 *
 * Boots each page in jsdom against a LIVE server, stubs nothing about the app's
 * own code, and drives the real rendering path: sign in, then render every
 * navigation page and assert that meaningful DOM was produced.
 *
 * This catches the class of bug a console-only check misses - a page that loads
 * without errors but renders nothing because a fetch failed or a template threw.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.argv[2];
const ORIGIN = process.argv[3] || 'http://127.0.0.1:4000';

const fails = [];
const passes = [];

function check(ok, label, detail = '') {
  if (ok) {
    passes.push(label);
    console.log(`  [PASS] ${label}${detail ? ' - ' + detail : ''}`);
  } else {
    fails.push(label);
    console.log(`  [FAIL] ${label}${detail ? ' - ' + detail : ''}`);
  }
}

/** Build a window with all of dashboard.html's scripts evaluated. */
function makeWindow(opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'client', 'dashboard.html'), 'utf8');
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const vc = new VirtualConsole();
  const runtimeErrors = [];
  vc.on('jsdomError', (e) => {
    if (!String(e.message).includes('Not implemented')) runtimeErrors.push(String(e.message));
  });
  vc.on('error', (...a) => runtimeErrors.push(a.join(' ')));

  const dom = new JSDOM(stripped, { url: `${ORIGIN}/dashboard.html`, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;

  w.scrollTo = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.URL.createObjectURL = () => 'blob:stub';
  w.URL.revokeObjectURL = () => {};

  // Real fetch, resolved against the live server. jsdom ships no fetch.
  w.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const abs = url.startsWith('http') ? url : ORIGIN + url;
    return fetch(abs, init);
  };

  // api.js reads its token from localStorage at load time, so the token must be
  // present BEFORE the scripts are evaluated.
  if (opts.token) {
    w.localStorage.setItem('smi_tms_token', opts.token);
    w.localStorage.setItem('smi_tms_user', JSON.stringify(opts.user || {}));
  }

  const tags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  for (const [, attrs, body] of tags) {
    const srcMatch = attrs.match(/\bsrc="([^"]+)"/i);
    const el = w.document.createElement('script');
    el.textContent = srcMatch
      ? fs.readFileSync(path.join(ROOT, 'client', srcMatch[1].replace(/^\//, '')), 'utf8')
      : body;
    try {
      w.document.body.appendChild(el);
    } catch (e) {
      runtimeErrors.push(`script ${srcMatch ? srcMatch[1] : '(inline)'}: ${e.message}`);
    }
  }

  return { w, runtimeErrors };
}

(async () => {
  console.log('\n=== FUNCTIONAL UI TEST (live server, real DOM) ===\n');

  // --- Authenticate against the live API -----------------------------------
  console.log('Authentication');
  const login = await (await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@selectmobility.in', password: 'Select@2026' }),
  })).json();

  check(Boolean(login.token), 'live API issues a token');
  if (!login.token) {
    console.log('\nCannot continue without a token.');
    process.exit(1);
  }

  // Build the app window with the session already in place, so api.js picks it
  // up at load time exactly as it would after a real sign-in.
  const { w: W, runtimeErrors: loadErrors } = makeWindow({ token: login.token, user: login.user });

  console.log('\nScript loading');
  check(loadErrors.length === 0, 'no script errors during load', loadErrors.join('; ').slice(0, 160));

  const me = await W.eval('Api.get("/auth/me")').catch((e) => ({ error: e.message }));
  check(Boolean(me && me.user), 'authenticated session resolves', me && me.user ? me.user.role : me.error);

  // --- Render every navigation page ----------------------------------------
  console.log('\nPage rendering (every navigation entry)');

  // NAV is grouped: [{ label, items: [{ id, label }] }]. Flatten to leaf pages.
  const navJson = W.eval('JSON.stringify(NAV)');
  const pages = JSON.parse(navJson).flatMap((group) => group.items || []);

  const container = W.document.getElementById('content');
  check(Boolean(container), 'app shell has a #content mount point');

  let rendered = 0;
  for (const item of pages) {
    let err = null;
    const target = W.document.getElementById('content');
    if (target) target.innerHTML = '';

    try {
      // Drive the app's real router for this page.
      W.eval(`App.go(${JSON.stringify(item.id)})`);

      /**
       * Poll until the page settles rather than sleeping a fixed amount.
       *
       * A fixed delay is flaky: over the internet a page's fetches can take far
       * longer than on localhost, so a short sleep measures the loading spinner
       * (a ~27-byte element) and reports a false failure. We wait for real
       * content, or for the app's own error panel, whichever appears first.
       *
       * The budget is generous because some pages chain two sequential round
       * trips (ShiftsPage fetches /shifts then /routes before painting), and a
       * freshly started sandbox pays container-initialisation cost on the first
       * request. A real failure surfaces as the app's own error panel, which we
       * detect immediately - so a long wait only ever costs time, never
       * accuracy, and never turns a genuine error into a pass.
       */
      const deadline = Date.now() + 45000;
      let html = '';
      let settled = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        html = target ? target.innerHTML : '';
        const loading = html.includes('class="spinner"');
        const failed = html.includes('Could not load this page');
        if (failed) { settled = true; break; }
        if (!loading && html.length > 800) { settled = true; break; }
      }
      // Distinguish "page never painted" from a normal pass so the failure
      // message points at a timeout rather than an ambiguous short DOM.
      if (!settled) err = 'timed out waiting for page content';
    } catch (e) {
      err = `${e.name}: ${e.message}`;
    }

    const html = target ? target.innerHTML : '';
    // "Rendered" means real content, not an empty shell, a spinner, or the
    // app's error panel.
    const meaningful = html.length > 800 && !html.includes('Could not load this page');
    const ok = !err && meaningful;
    if (ok) rendered++;

    let detail;
    if (err) detail = err.slice(0, 140);
    else if (html.includes('Could not load this page')) {
      const m = html.match(/<p>([^<]+)<\/p>/);
      detail = 'page error panel: ' + (m ? m[1] : 'unknown');
    } else {
      detail = `${html.length} bytes of DOM`;
    }

    check(ok, `page renders: ${item.label} (${item.id})`, detail);
  }

  console.log(`\n=== RESULT: ${passes.length} passed, ${fails.length} failed ===`);
  console.log(`Pages rendered: ${rendered}/${pages.length}`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fails.length ? 1 : 0);
})();
