'use strict';

/**
 * CLI entry point.
 *
 * Kept separate from src/index.js so that requiring the app (in tests, or when
 * embedding it in another process) does not open a listening socket. This file
 * is the only place that actually starts the HTTP server.
 */

const { boot } = require('./src/index');

boot().catch((err) => {
  console.error('[server] Fatal error during start-up:', err);
  process.exit(1);
});
