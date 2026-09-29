'use strict';

/* D1 REST mirror for the existing Node/Express deployment. */
const fs = require('fs');
const path = require('path');
const TABLE = 'tms_state';

function readConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) return null;
  return { url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, apiToken };
}
const isEnabled = () => readConfig() !== null;

async function query(sql, params = []) {
  const cfg = readConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.success) throw new Error(payload?.errors?.[0]?.message || `D1 query failed with HTTP ${res.status}`);
  return payload.result?.[0] || {};
}

async function ensureTable() {
  await query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`);
}

async function restore(filePath) {
  if (!isEnabled()) return 'disabled';
  try {
    await ensureTable();
    const result = await query(`SELECT payload FROM ${TABLE} WHERE id = ?1`, ['primary']);
    const text = result.results?.[0]?.payload;
    if (!text) return 'absent';
    JSON.parse(text);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.d1-restore-tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
    return 'restored';
  } catch (err) {
    console.error(`[d1] Restore error: ${err.message}`);
    return 'error';
  }
}

function createUploader(filePath, { debounceMs = 4000 } = {}) {
  if (!isEnabled()) return { schedule: () => {}, flush: async () => {}, enabled: false };
  let timer = null;
  let inFlight = null;
  let pending = false;
  async function upload() {
    if (inFlight) { pending = true; return inFlight; }
    inFlight = (async () => {
      try {
        await ensureTable();
        await query(`INSERT INTO ${TABLE} (id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`, ['primary', fs.readFileSync(filePath, 'utf8'), new Date().toISOString()]);
      } catch (err) { console.error(`[d1] Upload error: ${err.message}`); }
      finally { inFlight = null; if (pending) { pending = false; schedule(); } }
    })();
    return inFlight;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; upload(); }, debounceMs);
    if (timer.unref) timer.unref();
  }
  return { schedule, flush: upload, enabled: true };
}

module.exports = { isEnabled, restore, createUploader, readConfig };
