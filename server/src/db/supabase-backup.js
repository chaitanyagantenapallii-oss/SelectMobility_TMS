'use strict';

const fs = require('fs');
const path = require('path');
const TABLE = 'tms_state';

function readConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: `${url.replace(/\/$/, '')}/rest/v1/${TABLE}`, key };
}

const isEnabled = () => readConfig() !== null;

async function request(url, options = {}) {
  const cfg = readConfig();
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const body = await res.text();
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}

async function restore(filePath) {
  if (!isEnabled()) return 'disabled';
  try {
    const cfg = readConfig();
    const rows = await request(`${cfg.url}?id=eq.primary&select=payload`);
    const payload = rows?.[0]?.payload;
    if (!payload) return 'absent';
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    JSON.parse(text);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.supabase-restore-tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
    return 'restored';
  } catch (err) {
    console.error(`[supabase] Restore error: ${err.message}`);
    return 'error';
  }
}

function createUploader(filePath, { debounceMs = 0 } = {}) {
  if (!isEnabled()) return { schedule: () => {}, flush: async () => {}, enabled: false };
  let timer = null;
  let inFlight = null;
  let pending = false;
  async function upload() {
    if (inFlight) { pending = true; return inFlight; }
    inFlight = (async () => {
      try {
        const cfg = readConfig();
        await request(cfg.url, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ id: 'primary', payload: JSON.parse(fs.readFileSync(filePath, 'utf8')), updated_at: new Date().toISOString() }),
        });
      } catch (err) { console.error(`[supabase] Upload error: ${err.message}`); }
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
