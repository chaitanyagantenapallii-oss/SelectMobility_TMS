// Start the Expo dev server for the SMI Driver app.
//
// Why this wrapper exists: the Expo CLI spawns `git` during startup, and the
// sandbox this runs in blocks that, which kills the CLI before Metro ever
// listens. Spawning the CLI ourselves with CI=1 (no watch mode, no git checks)
// and EXPO_OFFLINE=1 (no online dependency validation) skips that code path
// entirely. The LAN IP is resolved at runtime because it changes between
// networks - a hardcoded address is a silent failure waiting to happen.

const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const CLI = 'node_modules\\@expo\\cli\\build\\bin\\cli';
const PORT = 8081;
const CWD = __dirname;

/** First non-internal IPv4 address on an up interface. */
function lanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const ip = lanAddress();
console.log(`[expo] starting on exp://${ip}:${PORT}`);

const child = spawn(NODE, [CLI, 'start', '--lan', '--port', String(PORT)], {
  cwd: CWD,
  env: { ...process.env, CI: '1', EXPO_OFFLINE: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => process.stdout.write(`[expo:out] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[expo:err] ${d}`));

child.on('exit', (code) => {
  console.log(`[expo] exited with code ${code}`);
  process.exit(code || 0);
});

// Probe the port once Metro has had time to boot, so a silent failure to
// listen is reported rather than left for the phone to discover.
setTimeout(() => {
  http
    .get(`http://127.0.0.1:${PORT}`, (res) => {
      console.log(`[check] port ${PORT} responded HTTP ${res.statusCode}`);
    })
    .on('error', (e) => {
      console.log(`[check] port ${PORT} not responding: ${e.message}`);
    });
}, 20000);
