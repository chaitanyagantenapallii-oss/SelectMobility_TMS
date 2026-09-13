'use strict';

/* ==========================================================================
   Shared runtime for the driver and client apps.
   ==========================================================================

   These two pages are the same application wearing different hats, so the
   plumbing lives here and each page supplies only its own screens.

   The design constraint throughout: a driver uses this standing at a kerb
   with one hand and possibly no signal. That rules out a framework, a build
   step, and anything that blocks rendering on a network call.
   ========================================================================== */

const Mobile = (() => {
  /** Where we stash the last good payloads for offline reading. */
  const SNAP_PREFIX = 'smi_snap_';

  /* --- Navigation -------------------------------------------------------- */

  /**
   * Send the browser to another page.
   *
   * Every redirect in the mobile apps goes through here for two reasons.
   *
   * It is the only place that knows how to leave a page, so a test can stand
   * in for it and assert *where* we would have gone. jsdom refuses to navigate
   * and does not report the destination, so a redirect is otherwise
   * unverifiable - and an unverifiable redirect is one that can silently break
   * and lock a user out of their own app.
   *
   * `replace` rather than `assign`, so a redirected page does not leave a
   * history entry the user can press Back into.
   */
  let go = (path) => {
    location.replace(path);
  };

  /** Test seam. Not used by the application. */
  function _setNavigateForTest(fn) {
    go = fn;
  }

  function navigate(path) {
    go(path);
  }

  /* --- Connectivity ------------------------------------------------------ */

  function watchConnectivity() {
    const sync = () => document.body.classList.toggle('offline', !navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  /* --- Offline snapshots ------------------------------------------------- */

  /*
   * The API itself is never cached (see sw.js). Instead each successful read
   * writes a small snapshot here, and the page renders from it when the
   * network is unreachable. That way the driver always sees *something* real,
   * clearly marked as possibly out of date, rather than an empty screen.
   */

  function saveSnapshot(key, data) {
    try {
      localStorage.setItem(
        SNAP_PREFIX + key,
        JSON.stringify({ at: Date.now(), data })
      );
    } catch {
      /* Quota or private mode. Offline reading degrades, nothing else breaks. */
    }
  }

  function readSnapshot(key) {
    try {
      const raw = localStorage.getItem(SNAP_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.data ? parsed : null;
    } catch {
      return null;
    }
  }

  function clearSnapshots() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(SNAP_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }

  function snapshotAge(snap) {
    if (!snap || !snap.at) return '';
    const mins = Math.round((Date.now() - snap.at) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.round(hrs / 24)} d ago`;
  }

  /* --- Toast ------------------------------------------------------------- */

  let toastTimer;
  function toast(message, type = '') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = type;
    }, type === 'err' ? 5200 : 3000);
  }

  /* --- Busy buttons ------------------------------------------------------ */

  /*
   * Double taps are the norm on a phone in the rain. Every action that writes
   * to the server goes through this so a second tap cannot post the same
   * boarding twice.
   */
  async function withBusy(btn, label, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy === '1') return undefined;
    const original = btn.innerHTML;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span><span>${escapeHtml(label || 'Working')}</span>`;
    try {
      return await fn();
    } finally {
      btn.dataset.busy = '';
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  /* --- Rendering helpers ------------------------------------------------- */

  function badgeFor(status) {
    const map = {
      completed: 'ok', confirmed: 'brand', scheduled: 'warn', 'in-progress': 'warn',
      active: 'ok', boarded: 'ok', 'no-show': 'danger', cancelled: 'danger',
      open: 'warn', closed: 'ok', breakdown: 'danger', resolved: 'ok',
      acknowledged: 'warn', 'in-review': 'warn',
    };
    return `<span class="badge ${map[status] || ''}">${escapeHtml(String(status || '-').replace(/-/g, ' '))}</span>`;
  }

  function empty(icon, title, text) {
    return `<div class="empty">
      <div class="big">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text || '')}</p>
    </div>`;
  }

  function skeleton(lines = 3) {
    return `<div class="card">${Array.from({ length: lines }, () => '<div class="skeleton"></div>').join('')}</div>`;
  }

  /** Progress bar for boarded / allocated. */
  function progress(allocated, boarded) {
    if (!allocated) return '';
    const pct = Math.min(100, Math.round((boarded / allocated) * 100));
    return `<div class="bar"><i style="width:${pct}%"></i></div>`;
  }

  /* --- Session ----------------------------------------------------------- */

  /**
   * Gate a page behind a signed-in session of the expected role.
   *
   * The role check here is a convenience, not a security boundary: the server
   * enforces scope on every request regardless of what this page believes. Its
   * only job is to avoid showing a driver a screen full of 403s.
   *
   * @returns {Promise<boolean>} true when the caller may render.
   */
  async function requireRole(expected, loginPath) {
    if (!Api.token || !Api.user) {
      navigate(loginPath);
      return false;
    }
    if (Api.user.role === 'admin') return true;
    if (Api.user.role !== expected) {
      // A client account that lands on the driver app, or the reverse.
      navigate(
        Api.user.role === 'driver'
          ? '/driver.html'
          : Api.user.role === 'client'
            ? '/client.html'
            : '/dashboard.html'
      );
      return false;
    }
    return true;
  }

  function signOut() {
    Api.clearToken();
    clearSnapshots();
    navigate('/login.html');
  }

  /* --- Service worker ---------------------------------------------------- */

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Registration must never delay first paint; the app works without it.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Offline support is a bonus, not a requirement. */
      });
    });
  }

  return {
    navigate,
    _setNavigateForTest,
    watchConnectivity,
    saveSnapshot,
    readSnapshot,
    clearSnapshots,
    snapshotAge,
    toast,
    withBusy,
    badgeFor,
    empty,
    skeleton,
    progress,
    requireRole,
    signOut,
    registerWorker,
  };
})();

/*
 * `const Mobile = ...` at the top level of a classic script creates a binding
 * in script scope, not a property on `window`. The module is already reachable
 * from every other page script by name, which is all the application needs -
 * but a test harness driving the page from outside has no way in.
 *
 * Exposing it explicitly is harmless (the app never reads window.Mobile) and it
 * is what lets the suite stand in for navigation and assert where a redirect
 * would have gone. A redirect that silently breaks locks a user out of their
 * own app, so it is worth being able to test.
 */
window.Mobile = Mobile;
