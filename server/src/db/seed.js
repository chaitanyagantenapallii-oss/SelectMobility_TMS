'use strict';

/** Command line database seeder: `npm run seed` or `npm run reset`. */

const { initStore, seedIfEmpty, getStore } = require('./schema');
const config = require('../config');

(async () => {
  // initStore() also restores from remote storage when configured, so a reset
  // on an ephemeral host starts from the correct baseline.
  await initStore();

  const force = process.argv.includes('--force');
  const created = seedIfEmpty(force);

  if (!created) {
    console.log('[seed] Database already contains data. Use "npm run reset" to overwrite.');
    return;
  }

  const store = getStore();
  console.log(`[seed] Database ${force ? 'reset and re-seeded' : 'seeded'}: ${config.databaseFile}`);
  for (const key of ['users', 'vehicles', 'drivers', 'employees', 'routes', 'trips', 'bookings', 'attendance', 'maintenance', 'fuel', 'documents', 'incidents', 'expenses']) {
    console.log(`  ${key.padEnd(14)} ${store.collection(key).length} records`);
  }

  await store.flushRemote();
})().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
