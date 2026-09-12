'use strict';

/**
 * Select Mobility India Pvt. Ltd. - Transport Management System
 * HTTP server entry point.
 */

const path = require('path');
const express = require('express');

const config = require('./config');
const schema = require('./db/schema');
const { store, initStore, seedIfEmpty } = schema;
const { isEnabled: remoteBackupEnabled } = require('./db/remote-backup');
const { securityHeaders, requestLogger, notFound, errorHandler } = require('./middleware/common');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const vehicleRoutes = require('./routes/vehicles');
const driverRoutes = require('./routes/drivers');
const employeeRoutes = require('./routes/employees');
const routeRoutes = require('./routes/routes');
const tripRoutes = require('./routes/trips');
const maintenanceRoutes = require('./routes/maintenance');
const fuelRoutes = require('./routes/fuel');
const documentRoutes = require('./routes/documents');
const incidentRoutes = require('./routes/incidents');
const vendorRoutes = require('./routes/vendors');
const expenseRoutes = require('./routes/expenses');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(requestLogger);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- API -------------------------------------------------------------------
const api = express.Router();
api.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    company: config.company.name,
    version: require('../../package.json').version,
    records: {
      vehicles: store.collection('vehicles').length,
      drivers: store.collection('drivers').length,
      employees: store.collection('employees').length,
      trips: store.collection('trips').length,
    },
    serverTime: new Date().toISOString(),
  });
});

api.use('/auth', authRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/vehicles', vehicleRoutes);
api.use('/drivers', driverRoutes);
api.use('/employees', employeeRoutes);
api.use('/routes', routeRoutes);
api.use('/trips', tripRoutes);
api.use('/maintenance', maintenanceRoutes);
api.use('/fuel', fuelRoutes);
api.use('/documents', documentRoutes);
api.use('/incidents', incidentRoutes);
api.use('/vendors', vendorRoutes);
api.use('/expenses', expenseRoutes);
api.use('/reports', reportRoutes);
api.use('/users', userRoutes);

app.use('/api', api);
app.use('/api', notFound);

// --- Static client ---------------------------------------------------------
app.use(express.static(config.clientDir, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(config.clientDir, 'index.html'));
});

app.use(errorHandler);

/**
 * Boot sequence.
 *
 * The store must be initialised (which may restore from remote storage) BEFORE
 * seeding, and before the first request is served. Everything else is already
 * wired up above, so we only need to await this and then listen.
 */
async function boot() {
  try {
    await initStore();
  } catch (err) {
    console.error('[db] Fatal: could not initialise the data store:', err.message);
    process.exit(1);
  }

  const seeded = seedIfEmpty();
  if (seeded) {
    console.log(`[db] Initialised database at ${config.databaseFile} with demo fleet data.`);
    if (remoteBackupEnabled()) {
      console.log('[db] Remote persistence is enabled - pushing the seeded dataset.');
    }
  }

  const server = app.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const url = `http://${shown}:${config.port}`;
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════════╗');
    console.log('  ║   SELECT MOBILITY INDIA PVT. LTD. - TRANSPORT MANAGEMENT     ║');
    console.log('  ╚══════════════════════════════════════════════════════════════╝');
    console.log(`   Server running        : ${url}`);
    console.log(`   Health check          : ${url}/api/health`);
    console.log(`   Database file         : ${config.databaseFile}`);
    console.log(`   Data persistence      : ${remoteBackupEnabled() ? 'local file + remote mirror' : 'local file only'}`);
    console.log(`   Sign in               : ${config.admin.email} / ${config.admin.password}`);
    console.log('   Press Ctrl+C to stop.');
    console.log('');
  });

  function shutdown(signal) {
    console.log(`\n[server] ${signal} received - shutting down.`);
    server.close(() => {
      Promise.resolve()
        .then(() => store.save())
        .then(() => store.flushRemote())
        .then(() => process.exit(0));
    });
    // Safety net if close() hangs on an open keep-alive connection.
    setTimeout(() => process.exit(0), 8000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

/**
 * Exported for tests and for programmatic embedding.
 *
 * `boot` is exposed as a function rather than being invoked here, so that
 * requiring this module does not open a listening socket as a side effect.
 * The CLI entry (`npm start`) calls it via server/start.js.
 */
module.exports = { app, boot };
