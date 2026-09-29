'use strict';

/**
 * Restart the local dev server cleanly.
 *
 * Written because `pkill -f "node start.js"` silently fails to match the process
 * on this Windows/Git-Bash setup, so an old server keeps holding the port and
 * every "restart" leaves the previous build serving requests. That produced
 * test results that looked like real bugs but were just stale code. Killing by
 * port is the only reliable method here.
 *
 * Usage:  node tools/restart-local.js [port] [--fresh]
 *   --fresh  delete the database file first, so the seed is regenerated
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || 4180);
const fresh = process.argv.includes('--fresh');

const root = path.join(__dirname, '..');
const serverDir = path.join(root, 'server');
const dbFile = path.join(serverDir, 'data', 'tms.db');
const logFile = path.join(require('os').tmpdir(), `smi-local-${port}.log`);

/** Kill whatever is listening on the port. Windows-only tooling; fails soft. */
function freePort() {
  const ps = [
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    'if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } }',
  ].join('; ');
  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'ignore' });
  } catch (_) { /* nothing listening, or already gone */ }
}

freePort();

if (fresh && fs.existsSync(dbFile)) {
  fs.rmSync(dbFile);
  console.log(`Removed ${dbFile}`);
}

const out = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, ['start.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(port) },
  detached: true,
  stdio: ['ignore', out, out],
});
child.unref();

console.log(`Starting server on ${port} (pid ${child.pid}), log: ${logFile}`);

// Poll the health endpoint rather than sleeping a fixed amount.
const url = `http://127.0.0.1:${port}/api/health`;
const deadline = Date.now() + 20000;
(function wait() {
  try {
    const body = execSync(`curl -s ${url}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (body && body.includes('"status":"ok"')) {
      const parsed = JSON.parse(body);
      console.log(`Ready. ${JSON.stringify(parsed.records)}`);
      process.exit(0);
    }
  } catch (_) { /* not up yet */ }
  if (Date.now() > deadline) {
    console.error('Server did not become healthy in time. Check the log above.');
    process.exit(1);
  }
  setTimeout(wait, 500);
})();
