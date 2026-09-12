'use strict';

/**
 * Optional remote persistence for the JSON data store.
 *
 * Why this exists
 * ---------------
 * Free/cheap cloud hosts (Render, Railway, Fly.io, Heroku-style platforms) give
 * you an EPHEMERAL filesystem: every restart, redeploy or scale event wipes the
 * container's disk. The local JSON file would therefore be lost constantly.
 *
 * When these environment variables are present, the store mirrors itself to an
 * S3-compatible bucket and restores from it on boot:
 *
 *   BACKUP_S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   BACKUP_S3_BUCKET            e.g. select-mobility-tms
 *   BACKUP_S3_ACCESS_KEY_ID
 *   BACKUP_S3_SECRET_ACCESS_KEY
 *   BACKUP_S3_REGION            optional, defaults to "auto" (R2)
 *   BACKUP_S3_KEY               optional, object name (default: tms.db)
 *
 * Compatible with Cloudflare R2 (free tier, 10 GB) and Backblaze B2 (free
 * tier, 10 GB). Both are S3-compatible, so one implementation covers both.
 *
 * If the variables are absent, every function here is a no-op and the store
 * behaves exactly as before - local file only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = process.env.BACKUP_S3_KEY || 'tms.db';

function readConfig() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const bucket = process.env.BACKUP_S3_BUCKET;
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKey || !secretKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKey,
    secretKey,
    region: process.env.BACKUP_S3_REGION || 'auto',
  };
}

const isEnabled = () => readConfig() !== null;

/* --------------------------------------------------------------------------
   Minimal AWS Signature V4 signing (no SDK dependency)
   -------------------------------------------------------------------------- */

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * Build the headers required to sign an S3 request.
 * @param {object} cfg      config from readConfig()
 * @param {string} method   'GET' | 'PUT'
 * @param {string} key      object key
 * @param {Buffer|null} body
 */
function signRequest(cfg, method, objectKey, body) {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(body || Buffer.alloc(0));

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    url: url.toString(),
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(body ? { 'Content-Length': String(body.length) } : {}),
    },
  };
}

/* --------------------------------------------------------------------------
   Public operations
   -------------------------------------------------------------------------- */

/**
 * Download the remote copy into filePath, if one exists.
 * Called once at boot, BEFORE the JsonStore reads the file.
 * @returns {Promise<'restored'|'absent'|'disabled'|'error'>}
 */
async function restore(filePath) {
  const cfg = readConfig();
  if (!cfg) return 'disabled';

  try {
    const { url, headers } = signRequest(cfg, 'GET', KEY, null);
    const res = await fetch(url, { method: 'GET', headers });

    if (res.status === 404) return 'absent';
    if (!res.ok) {
      console.error(`[backup] Restore failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return 'error';
    }

    const text = await res.text();
    if (!text.trim()) return 'absent';

    // Validate before overwriting the local file, so a bad remote copy
    // cannot destroy working local data.
    JSON.parse(text);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.restore-tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
    return 'restored';
  } catch (err) {
    console.error(`[backup] Restore error: ${err.message}`);
    return 'error';
  }
}

/**
 * Upload the local data file to remote storage.
 * Debounced and serialised so a burst of writes results in one upload.
 */
function createUploader(filePath, { debounceMs = 4000 } = {}) {
  const cfg = readConfig();
  if (!cfg) {
    return { schedule: () => {}, flush: async () => {}, enabled: false };
  }

  let timer = null;
  let inFlight = null;
  let pending = false;

  async function upload() {
    // Coalesce: if an upload is running, mark that another is needed.
    if (inFlight) {
      pending = true;
      return inFlight;
    }

    inFlight = (async () => {
      try {
        const body = fs.readFileSync(filePath);
        const { url, headers } = signRequest(cfg, 'PUT', KEY, body);
        const res = await fetch(url, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body,
        });
        if (!res.ok) {
          console.error(`[backup] Upload failed: HTTP ${res.status}`);
        }
      } catch (err) {
        console.error(`[backup] Upload error: ${err.message}`);
      } finally {
        inFlight = null;
        if (pending) {
          pending = false;
          schedule();
        }
      }
    })();

    return inFlight;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      upload();
    }, debounceMs);
    if (timer.unref) timer.unref();
  }

  return { schedule, flush: upload, enabled: true };
}

module.exports = { isEnabled, restore, createUploader, readConfig };
