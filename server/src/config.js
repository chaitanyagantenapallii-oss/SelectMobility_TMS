'use strict';

/**
 * Minimal configuration loader.
 * Reads .env (if present) and exposes typed config values.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  databaseFile: path.join(ROOT, process.env.DATABASE_FILE || 'server/data/tms.db'),
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@selectmobility.in',
    password: process.env.ADMIN_PASSWORD || 'Select@2026',
    name: process.env.ADMIN_NAME || 'Fleet Administrator',
  },
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  company: {
    name: process.env.COMPANY_NAME || 'Select Mobility India Private Limited',
    city: process.env.COMPANY_CITY || 'Pune, Maharashtra, India',
  },
  clientDir: path.join(ROOT, 'client'),
};

module.exports = config;
