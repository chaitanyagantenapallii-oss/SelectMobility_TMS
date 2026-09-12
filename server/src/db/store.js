'use strict';

/**
 * A dependency-free JSON file store.
 *
 * The application uses a single JSON document as its database. This keeps the
 * project fully portable - there is no native module to compile and no database
 * server to install, which matters for on-premise fleet offices.
 *
 * Writes are atomic (write to temp file, then rename) and serialised through a
 * promise chain so concurrent HTTP requests cannot corrupt the file.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath, defaults, options = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this._queue = Promise.resolve();
    /**
     * Optional remote mirror, used on hosts with ephemeral disks.
     * Attached by initStore() immediately after construction.
     */
    this.remote = options.remote || null;

    /**
     * Data is loaded lazily on first access rather than in the constructor.
     *
     * Reason: on cloud hosts an async restore from remote storage must finish
     * BEFORE the file is read, otherwise we would load an empty ephemeral disk
     * and then immediately overwrite the good remote copy with it.
     * Deferring the read lets `initStore()` await the restore first, while
     * still allowing route modules to import the store synchronously.
     */
    this._data = null;
    this._loading = false;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  /** Lazily read the file the first time data is needed. */
  _ensureLoaded() {
    if (this._data !== null) return;
    if (this._loading) {
      throw new Error('Store data accessed re-entrantly during load.');
    }
    this._loading = true;
    try {
      this._load();
    } finally {
      this._loading = false;
    }
  }

  get data() {
    this._ensureLoaded();
    return this._data;
  }

  set data(value) {
    this._data = value;
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this._data = raw.trim() ? JSON.parse(raw) : structuredClone(this.defaults);
      } catch (err) {
        // Corrupt file - keep a copy for forensics rather than silently losing data.
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.filePath, backup);
        console.error(`[store] Database was unreadable. Backup saved to ${backup}`);
        this._data = structuredClone(this.defaults);
      }
    } else {
      this._data = structuredClone(this.defaults);
      this._writeNow();
    }

    // Ensure every expected collection exists (forward-compatible migrations).
    // Internal `__seq_*` counters are preserved: they are written by nextId()
    // and must survive a reload, otherwise ids would restart and collide.
    for (const key of Object.keys(this.defaults)) {
      if (!(key in this._data) && !key.startsWith('__seq_')) {
        this._data[key] = structuredClone(this.defaults[key]);
      }
    }
  }

  _writeNow() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /** Persist the current in-memory state. Serialised, atomic. */
  save() {
    this._queue = this._queue.then(() => this._writeNow()).catch((err) => {
      console.error('[store] Failed to persist database:', err.message);
    });

    // Mirror to remote storage when configured. Debounced inside the uploader,
    // and deliberately not awaited so request latency is unaffected.
    if (this.remote && this.remote.enabled) {
      this._queue.then(() => this.remote.schedule());
    }

    return this._queue;
  }

  /** Force a synchronous-style flush of the remote mirror (used on shutdown). */
  async flushRemote() {
    if (this.remote && this.remote.enabled) {
      await this._queue;
      await this.remote.flush();
    }
  }

  /** Table-like accessor helpers. */
  collection(name) {
    if (!this.data[name]) this.data[name] = [];
    return this.data[name];
  }

  all(name) {
    return this.collection(name);
  }

  find(name, predicate) {
    return this.collection(name).find(predicate) || null;
  }

  filter(name, predicate) {
    return this.collection(name).filter(predicate);
  }

  insert(name, record) {
    this.collection(name).push(record);
    this.save();
    return record;
  }

  insertMany(name, records) {
    this.collection(name).push(...records);
    this.save();
    return records;
  }

  update(name, id, patch) {
    const list = this.collection(name);
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
    this.save();
    return list[idx];
  }

  remove(name, id) {
    const list = this.collection(name);
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Allocate the next sequential id for a collection.
   *
   * The counter (`__seq_<collection>`) is persisted alongside the records.
   * We also take the highest numeric suffix currently present in the data as a
   * floor, so a database written by an older build - or one restored from
   * remote storage - can never hand out an id that is already in use.
   */
  nextId(name, prefix) {
    const list = this.collection(name);
    const key = `__seq_${name}`;

    let highest = 0;
    if (prefix) {
      const re = new RegExp(`^${prefix}(\\d+)$`);
      for (const row of list) {
        const m = re.exec(String(row.id || ''));
        if (m) highest = Math.max(highest, Number(m[1]));
      }
    }

    const next = Math.max(Number(this.data[key]) || 0, highest) + 1;
    this.data[key] = next;
    // Persist the counter immediately: if the process dies before the next
    // save, a reset counter would re-issue ids that are already in the file.
    this.save();

    return prefix ? `${prefix}${String(next).padStart(4, '0')}` : next;
  }
}

module.exports = { JsonStore };
