/**
 * Browser-debug harness.
 *
 * Loads the real HTML pages and executes every referenced <script> in a jsdom
 * environment, capturing any console error, uncaught exception, or failed
 * resource fetch. This is the closest equivalent to opening the app in a
 * browser and reading the DevTools console.
 *
 * IMPORTANT: scripts are injected as real <script> elements rather than run
 * through window.eval(). Each top-level eval() call gets its OWN lexical scope,
 * so a `const`/`let` declared in one file is invisible to the next - which
 * would report false "X is not defined" errors that never occur in a browser,
 * where all classic scripts share one global script scope.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.argv[2];
const BASE = process.argv[3] || 'http://127.0.0.1:4000';

const errors = [];
const warnings = [];

function log(ok, msg) {
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${msg}`);
  if (!ok) errors.push(msg);
}

async function loadPage(file) {
  const filePath = path.join(ROOT, 'client', file);
  const html = fs.readFileSync(filePath, 'utf8');

  /**
   * Remove EVERY <script> from the document before handing it to jsdom, then
   * re-inject them ourselves in document order.
   *
   * If inline scripts were left in place, jsdom would execute them natively
   * *and* we would inject them again - running each twice. A duplicated
   * `const form = ...` then throws "Identifier 'form' has already been
   * declared", which looks like a real bug but is purely an artefact.
   * Removing them all first guarantees each script runs exactly once.
   */
  const scriptTag = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  const stripped = html.replace(scriptTag, '');

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    const msg = String(e.message);
    if (msg.includes('Could not load') || msg.includes('Not implemented: navigation')) {
      warnings.push(`${file}: ${msg.slice(0, 110)}`);
    } else {
      errors.push(`${file}: jsdomError - ${msg}`);
    }
  });
  virtualConsole.on('error', (...args) => errors.push(`${file}: console.error - ${args.join(' ')}`));
  virtualConsole.on('warn', (...args) => warnings.push(`${file}: console.warn - ${args.join(' ')}`));

  const dom = new JSDOM(stripped, {
    url: `${BASE}/${file}`,
    runScripts: 'dangerously',
    virtualConsole,
    pretendToBeVisual: true,
  });

  const { window } = dom;

  // Minimal browser surface the app expects but jsdom lacks.
  window.fetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};

  // Replay every script tag in original document order.
  const tags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  const results = [];

  for (const [, attrs, body] of tags) {
    const srcMatch = attrs.match(/\bsrc="([^"]+)"/i);

    if (srcMatch) {
      const src = srcMatch[1];
      const onDisk = path.join(ROOT, 'client', src.replace(/^\//, ''));
      if (!fs.existsSync(onDisk)) {
        results.push({ src, ok: false, err: 'referenced file does not exist on disk' });
        continue;
      }
      const el = window.document.createElement('script');
      el.textContent = fs.readFileSync(onDisk, 'utf8');
      try {
        window.document.body.appendChild(el);
        results.push({ src, ok: true });
      } catch (e) {
        results.push({ src, ok: false, err: `${e.name}: ${e.message}` });
      }
    } else if (body.trim()) {
      const el = window.document.createElement('script');
      el.textContent = body;
      try {
        window.document.body.appendChild(el);
        results.push({ src: '(inline)', ok: true });
      } catch (e) {
        results.push({ src: '(inline)', ok: false, err: `${e.name}: ${e.message}` });
      }
    }
  }

  return { dom, window, results };
}

(async () => {
  console.log('\n=== BROWSER DEBUG: script execution in a real DOM ===\n');

  for (const page of ['index.html', 'login.html', 'dashboard.html']) {
    console.log(`-- ${page} --`);
    const { window, results } = await loadPage(page);

    for (const r of results) {
      log(r.ok, `${page} :: ${r.src}${r.ok ? '' : ' -> ' + r.err}`);
    }

    // Confirm the globals the app relies on actually exist after all scripts run.
    // `const`/`let` at top level live in the shared script scope, not on window,
    // so evaluate the identifier directly rather than testing `window[name]`.
    const expected = {
      'dashboard.html': ['Api', 'Fmt', 'Toast', 'Chart', 'openModal', 'confirmDialog', 'renderTable', 'todayIso', 'PAGES', 'NAV', 'App',
        'DashboardPage', 'TripsPage', 'ManifestsPage', 'RoutesPage', 'VehiclesPage',
        'EmployeesPage', 'ReportsPage', 'DriversPage', 'ShiftsPage', 'UsersPage'],
      'login.html': ['Api'],
      'index.html': [],
    }[page] || [];

    for (const name of expected) {
      let kind = 'missing';
      try {
        kind = window.eval(`typeof ${name}`);
      } catch {
        kind = 'missing';
      }
      log(kind !== 'missing' && kind !== 'undefined', `${page} defines global: ${name} (${kind})`);
    }
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`errors:   ${errors.length}`);
  console.log(`warnings: ${warnings.length}`);
  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach((e) => console.log('  - ' + e));
  }
  if (warnings.length) {
    console.log('\nWARNINGS:');
    warnings.slice(0, 15).forEach((w) => console.log('  - ' + w));
  }
  console.log(`\nRESULT: ${errors.length === 0 ? 'CLEAN - no runtime errors' : errors.length + ' runtime problem(s)'}`);
  process.exit(errors.length ? 1 : 0);
})();
