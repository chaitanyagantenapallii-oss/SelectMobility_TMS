'use strict';

/**
 * Verifies the Cloudflare R2 backup settings used by server/src/db/remote-backup.js.
 *
 * The check writes a tiny JSON object, reads it back, and deletes it. It uses
 * the same AWS Signature V4 style as the application backup code, without
 * adding a large SDK dependency.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

const required = [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing Cloudflare R2 setting(s): ${missing.join(', ')}`);
  console.error('Copy .env.cloudflare.example into .env and fill in the real R2 values.');
  process.exit(1);
}

const cfg = {
  endpoint: process.env.BACKUP_S3_ENDPOINT.replace(/\/+$/, ''),
  bucket: process.env.BACKUP_S3_BUCKET,
  accessKey: process.env.BACKUP_S3_ACCESS_KEY_ID,
  secretKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
  region: process.env.BACKUP_S3_REGION || 'auto',
};

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function signRequest(method, objectKey, body) {
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
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
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
      ...(body ? { 'Content-Length': String(body.length), 'Content-Type': 'application/json' } : {}),
    },
  };
}

async function request(method, objectKey, body = null) {
  const signed = signRequest(method, objectKey, body);
  return fetch(signed.url, { method, headers: signed.headers, body });
}

(async () => {
  const key = `.connection-check-${Date.now()}.json`;
  const body = Buffer.from(JSON.stringify({
    app: 'select-mobility-tms',
    check: 'cloudflare-r2',
    at: new Date().toISOString(),
  }, null, 2));

  console.log('\n=== CLOUDFLARE R2 CONNECTION CHECK ===\n');
  console.log(`Bucket : ${cfg.bucket}`);
  console.log(`Endpoint: ${cfg.endpoint}`);

  const put = await request('PUT', key, body);
  if (!put.ok) {
    console.error(`Write failed: HTTP ${put.status} ${await put.text().catch(() => '')}`);
    process.exit(1);
  }
  console.log('Write  : OK');

  const get = await request('GET', key);
  const text = await get.text();
  if (!get.ok || text !== body.toString('utf8')) {
    console.error(`Read failed: HTTP ${get.status}`);
    process.exit(1);
  }
  console.log('Read   : OK');

  const del = await request('DELETE', key);
  if (!del.ok && del.status !== 204) {
    console.error(`Delete failed: HTTP ${del.status} ${await del.text().catch(() => '')}`);
    process.exit(1);
  }
  console.log('Delete : OK');
  console.log('\nCloudflare R2 is connected and ready for TMS backups.\n');
})().catch((err) => {
  console.error(`Cloudflare R2 check failed: ${err.message}`);
  process.exit(1);
});
