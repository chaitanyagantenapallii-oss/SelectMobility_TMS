'use strict';

/* ==========================================================================
   API client + shared UI helpers for Select Mobility TMS
   ========================================================================== */

const Api = (() => {
  const TOKEN_KEY = 'smi_tms_token';
  const USER_KEY = 'smi_tms_user';

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let user = (() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  })();

  async function request(method, path, body, options = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (res.status === 401 && !options.skipAuthRedirect) {
      clearToken();
      if (!location.pathname.endsWith('login.html') && location.pathname !== '/') {
        location.href = '/login.html';
      }
      throw new Error('Your session has expired. Please sign in again.');
    }

    if (options.raw) {
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      return res.text();
    }

    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    }

    if (!res.ok) {
      const err = new Error((payload && payload.message) || `Request failed (${res.status})`);
      err.status = res.status;
      err.details = payload && payload.details;
      throw err;
    }
    return payload;
  }

  return {
    get get() { return (p) => request('GET', p); },
    get token() { return token; },
    get user() { return user; },
    get isAdmin() { return user && user.role === 'admin'; },
    get canWrite() { return user && (user.role === 'admin' || user.role === 'operations'); },

    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    raw: (p) => request('GET', p, undefined, { raw: true }),

    setSession(t, u) {
      token = t;
      user = u;
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    },
    clearToken() {
      token = '';
      user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },

    /** Download a report or export as a file. */
    async download(path, filename) {
      const text = await request('GET', path, undefined, { raw: true });
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || path.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    },
  };
})();

/* --------------------------------------------------------------------------
   Formatting helpers
   -------------------------------------------------------------------------- */

const Fmt = {
  money(value, currency = 'INR') {
    if (value === null || value === undefined || value === '') return '-';
    const symbol = currency === 'INR' ? '\u20B9' : '';
    return symbol + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },
  compactMoney(value) {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (Math.abs(n) >= 10000000) return `\u20B9${(n / 10000000).toFixed(2)} Cr`;
    if (Math.abs(n) >= 100000) return `\u20B9${(n / 100000).toFixed(2)} L`;
    if (Math.abs(n) >= 1000) return `\u20B9${(n / 1000).toFixed(1)}K`;
    return `\u20B9${n.toFixed(0)}`;
  },
  num(value, decimals = 0) {
    if (value === null || value === undefined || value === '') return '-';
    return Number(value).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  },
  pct(value) {
    if (value === null || value === undefined) return '-';
    return `${Number(value).toFixed(1)}%`;
  },
  date(value) {
    if (!value) return '-';
    const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  dateShort(value) {
    if (!value) return '-';
    const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  },
  time(value) {
    if (!value) return '-';
    const match = String(value).match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : String(value);
  },
  weekday(value) {
    if (!value) return '';
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
  },
  relative(value) {
    if (!value) return '-';
    const diff = Math.round((new Date(value).getTime() - Date.now()) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
  },
  titleCase(value) {
    if (!value) return '-';
    return String(value).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  },
  initials(name) {
    if (!name) return '?';
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  },
};

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a status pill with a semantic colour bucket. */
function statusPill(status) {
  const map = {
    active: 'ok', completed: 'ok', valid: 'ok', paid: 'ok', confirmed: 'info',
    idle: 'muted', inactive: 'muted', closed: 'muted', exited: 'muted', retired: 'muted',
    scheduled: 'warn', 'in-progress': 'warn', maintenance: 'warn', pending: 'warn',
    expiring: 'warn', 'under-review': 'warn', 'on-leave': 'info', approved: 'info',
    breakdown: 'danger', cancelled: 'danger', expired: 'danger', suspended: 'danger',
    rejected: 'danger', 'no-show': 'danger', open: 'danger',
  };
  const cls = map[status] || 'muted';
  return `<span class="pill ${cls}">${escapeHtml(String(status || '-').replace(/-/g, ' '))}</span>`;
}

function severityPill(severity) {
  const cls = { critical: 'danger', high: 'danger', medium: 'warn', low: 'muted' }[severity] || 'muted';
  return `<span class="pill ${cls}">${escapeHtml(severity)}</span>`;
}

/** Toast notifications. */
const Toast = {
  push(message, type = '', ms = 3600) {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const icons = { ok: '\u2705', error: '\u26D4', warn: '\u26A0\uFE0F', '': '\u2139\uFE0F' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || icons['']}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(110%)';
      setTimeout(() => el.remove(), 220);
    }, ms);
  },
  ok: (m) => Toast.push(m, 'ok'),
  error: (m) => Toast.push(m, 'error', 5200),
  warn: (m) => Toast.push(m, 'warn'),
  info: (m) => Toast.push(m),
};

/** Modal dialog. Returns a controller with a close() method. */
function openModal({ title, body, footer, wide = false, onMount }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${escapeHtml(title || '')}</h3>
        <div class="spacer"></div>
        <button class="icon-btn" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body || ''}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);

  const controller = { el: backdrop, close, body: $('.modal-body', backdrop), foot: $('.modal-foot', backdrop) };
  if (onMount) onMount(controller);
  const firstInput = $('input, select, textarea', backdrop);
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  return controller;
}

function confirmDialog(message, { title = 'Please confirm', confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      body: `<p style="margin:0">${escapeHtml(message)}</p>`,
      footer: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>`,
    });
    $('[data-cancel]', modal.el).addEventListener('click', () => { modal.close(); resolve(false); });
    $('[data-confirm]', modal.el).addEventListener('click', () => { modal.close(); resolve(true); });
    modal.el.addEventListener('click', (e) => { if (e.target === modal.el) resolve(false); });
  });
}

/* --------------------------------------------------------------------------
   Lightweight inline SVG charts (no external chart library)
   -------------------------------------------------------------------------- */

const Chart = {
  /**
   * Grouped bar chart.
   * @param {Array<{label:string, values:number[], sub?:string}>} points
   */
  bars(points, { series = [], colors = ['#1a80c4', '#15803d', '#f59e0b'], height = 220, yLabel = '' } = {}) {
    if (!points.length) return '<div class="empty"><p>No data for this period.</p></div>';

    const W = 720;
    const H = height;
    const pad = { t: 14, r: 12, b: 34, l: 46 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    const maxRaw = Math.max(...points.flatMap((p) => p.values), 1);
    const magnitude = 10 ** Math.floor(Math.log10(maxRaw));
    const max = Math.ceil(maxRaw / magnitude) * magnitude;

    const groupW = plotW / points.length;
    const barW = Math.min(20, (groupW * 0.62) / Math.max(1, series.length || 1));

    const ticks = 4;
    let grid = '';
    for (let i = 0; i <= ticks; i++) {
      const value = (max / ticks) * i;
      const y = pad.t + plotH - (value / max) * plotH;
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#94a3b8">${this._fmtTick(value)}</text>`;
    }

    let bars = '';
    points.forEach((point, pi) => {
      const groupX = pad.l + groupW * pi + groupW / 2;
      const count = point.values.length;
      point.values.forEach((value, si) => {
        const h = max ? (value / max) * plotH : 0;
        const x = groupX - (count * barW) / 2 + si * barW;
        const y = pad.t + plotH - h;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${colors[si % colors.length]}"><title>${escapeHtml(point.label)}${series[si] ? ' \u00B7 ' + escapeHtml(series[si]) : ''}: ${Fmt.num(value, value % 1 ? 1 : 0)}</title></rect>`;
      });

      const showEvery = Math.ceil(points.length / 14);
      if (pi % showEvery === 0) {
        bars += `<text x="${groupX.toFixed(1)}" y="${H - 18}" text-anchor="middle" font-size="9.5" fill="#64748b">${escapeHtml(point.label)}</text>`;
        if (point.sub) {
          bars += `<text x="${groupX.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="8.5" fill="#94a3b8">${escapeHtml(point.sub)}</text>`;
        }
      }
    });

    const axis = `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#cbd5e1" stroke-width="1"/>`;
    const yTitle = yLabel ? `<text x="${pad.l - 8}" y="${pad.t - 3}" text-anchor="end" font-size="9" fill="#94a3b8">${escapeHtml(yLabel)}</text>` : '';

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${grid}${bars}${axis}${yTitle}</svg>`;
  },

  /** Horizontal bar list for rankings. */
  hbars(rows, { color = '#1a80c4', max: forcedMax } = {}) {
    if (!rows.length) return '<div class="empty"><p>No data.</p></div>';
    const max = forcedMax || Math.max(...rows.map((r) => r.value), 1);
    return `<div style="display:grid;gap:11px">${rows.map((r) => {
      const pct = Math.round((r.value / max) * 100);
      const cls = r.tone || '';
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
          <span>${escapeHtml(r.label)}</span>
          <span class="text-muted nowrap">${escapeHtml(r.display || Fmt.num(r.value, 0))}</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%; background:${r.tone ? '' : color}"></div></div>
      </div>`;
    }).join('')}</div>`;
  },

  /** Smooth-ish line + area chart. */
  line(points, { color = '#1a80c4', fill = 'rgba(26,128,196,.14)', height = 200, label = '' } = {}) {
    if (!points.length) return '<div class="empty"><p>No data for this period.</p></div>';
    const W = 720;
    const H = height;
    const pad = { t: 14, r: 12, b: 30, l: 46 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const max = Math.max(...points.map((p) => p.value), 1) * 1.1;

    const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
    const coords = points.map((p, i) => [
      pad.l + stepX * i,
      pad.t + plotH - (p.value / max) * plotH,
    ]);

    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
    const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${pad.t + plotH} L${coords[0][0].toFixed(1)},${pad.t + plotH} Z`;

    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const value = (max / 4) * i;
      const y = pad.t + plotH - (value / max) * plotH;
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#e2e8f0"/>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#94a3b8">${this._fmtTick(value)}</text>`;
    }

    let labels = '';
    const showEvery = Math.ceil(points.length / 12);
    points.forEach((p, i) => {
      if (i % showEvery !== 0) return;
      labels += `<text x="${coords[i][0].toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="9.5" fill="#64748b">${escapeHtml(p.label)}</text>`;
    });

    const dots = coords.map((c, i) =>
      `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="2"><title>${escapeHtml(points[i].label)}: ${Fmt.num(points[i].value, points[i].value % 1 ? 1 : 0)}</title></circle>`
    ).join('');

    const title = label ? `<text x="${pad.l - 8}" y="${pad.t - 3}" text-anchor="end" font-size="9" fill="#94a3b8">${escapeHtml(label)}</text>` : '';

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}
      <path d="${area}" fill="${fill}"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
      ${dots}${labels}${title}</svg>`;
  },

  /** Donut chart with a centre figure. */
  donut(slices, { size = 168, thickness = 24, centre = '' } = {}) {
    const total = slices.reduce((a, s) => a + s.value, 0);
    if (!total) return '<div class="empty"><p>No data.</p></div>';

    const r = (size - thickness) / 2;
    const c = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    let arcs = '';

    for (const slice of slices) {
      const portion = slice.value / total;
      const dash = portion * circumference;
      arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${slice.color}" stroke-width="${thickness}"
        stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})"><title>${escapeHtml(slice.label)}: ${Fmt.num(slice.value, 0)} (${(portion * 100).toFixed(1)}%)</title></circle>`;
      offset += dash;
    }

    return `<div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${thickness}"/>
        ${arcs}
        <text x="${c}" y="${c + 2}" text-anchor="middle" font-size="19" font-weight="700" fill="#0f172a">${escapeHtml(centre)}</text>
      </svg>
      <div style="display:grid;gap:7px">
        ${slices.map((s) => `<div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
          <i style="width:11px;height:11px;border-radius:3px;background:${s.color};display:inline-block"></i>
          <span>${escapeHtml(s.label)}</span>
          <strong style="margin-left:auto">${Fmt.num(s.value, 0)}</strong>
        </div>`).join('')}
      </div>
    </div>`;
  },

  _fmtTick(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
    return value % 1 ? value.toFixed(1) : String(value);
  },
};

/* --------------------------------------------------------------------------
   Shared table renderer
   -------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {Array} opts.rows
 * @param {Array<{key:string,label:string,align?:string,render?:Function,cls?:string}>} opts.columns
 * @param {Function} [opts.rowActions] (row) => html string of action buttons
 */
function renderTable({ rows, columns, rowActions, emptyTitle = 'Nothing here yet', emptyText = 'No records match the current filters.' }) {
  if (!rows.length) {
    return `<div class="empty"><div class="ico">&#128193;</div><h4>${escapeHtml(emptyTitle)}</h4><p>${escapeHtml(emptyText)}</p></div>`;
  }

  const head = columns.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((c) => {
      const value = c.render ? c.render(row) : escapeHtml(row[c.key] ?? '-');
      const align = c.align === 'right' ? 'num' : '';
      return `<td class="${align} ${c.cls || ''}">${c.render ? value : escapeHtml(value)}</td>`;
    }).join('');
    const actions = rowActions ? `<td><div class="actions">${rowActions(row)}</div></td>` : '';
    return `<tr>${cells}${actions}</tr>`;
  }).join('');

  return `<div class="table-wrap"><table class="data">
    <thead><tr>${head}${rowActions ? '<th style="text-align:right">Actions</th>' : ''}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

/* --------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */

function debounce(fn, wait = 320) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Persist table view state (search/filters) across page loads. */
const ViewState = {
  key(page, name) { return `smi_tms_view_${page}_${name}`; },
  save(page, state) { try { sessionStorage.setItem(this.key(page, 'state'), JSON.stringify(state)); } catch { /* ignore */ } },
  load(page) { try { return JSON.parse(sessionStorage.getItem(this.key(page, 'state')) || 'null'); } catch { return null; } },
  clear(page) { sessionStorage.removeItem(this.key(page, 'state')); },
};

function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const BRAND_COLORS = ['#1a80c4', '#15803d', '#f59e0b', '#b91c1c', '#7c3aed', '#0891b2', '#64748b', '#db2777'];
