'use strict';

const config = require('../config');

/** Baseline security headers - no external dependency required. */
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
}

/** Tiny request logger - useful when this runs as a Windows service. */
function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      const ms = Date.now() - started;
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
}

/** Throw a 404 for unknown API paths. */
function notFound(req, _res, next) {
  const err = new Error(`No API route matches ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
}

/** Central error handler - always returns JSON for /api routes. */
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: true,
    status,
    message: err.message || 'Unexpected server error.',
    details: err.details || undefined,
    company: config.company.name,
  });
}

module.exports = { securityHeaders, requestLogger, notFound, errorHandler };
