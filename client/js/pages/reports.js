'use strict';

/* ==========================================================================
   Reports & exports - browse, preview and download every report
   ========================================================================== */

const ReportsPage = {
  range: { from: todayIso(-29), to: todayIso() },
  current: null,
  catalogue: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const { data } = await Api.get('/reports');
    this.catalogue = data;

    container.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Reporting Period</h3>
          <span class="desc">Applies to every report below</span>
          <div class="spacer"></div>
          <input type="date" id="rp-from" value="${this.range.from}">
          <span class="text-muted">&rarr;</span>
          <input type="date" id="rp-to" value="${this.range.to}">
          <button class="btn" id="rp-30">Last 30 days</button>
          <button class="btn" id="rp-month">This month</button>
          <button class="btn" id="rp-apply">Apply</button>
        </div>
      </div>

      <div class="grid cols-3" id="rp-grid" style="margin-bottom:18px"></div>

      <div class="card" id="rp-viewer" style="display:none">
        <div class="card-head">
          <h3 id="rp-title">Report</h3>
          <span class="desc" id="rp-meta"></span>
          <div class="spacer"></div>
          <button class="btn" id="rp-csv">&#11123; Download CSV</button>
          <button class="btn" id="rp-print">&#128424; Print</button>
          <button class="btn ghost" id="rp-close">&times; Close</button>
        </div>
        <div class="card-body" id="rp-totals"></div>
        <div class="card-body tight" id="rp-table"></div>
      </div>
    `;

    document.getElementById('rp-from').addEventListener('change', (e) => { this.range.from = e.target.value; });
    document.getElementById('rp-to').addEventListener('change', (e) => { this.range.to = e.target.value; });
    document.getElementById('rp-apply').addEventListener('click', () => {
      if (this.current) this.open(this.current.key);
      Toast.info('Period applied.');
    });
    document.getElementById('rp-30').addEventListener('click', () => {
      this.range = { from: todayIso(-29), to: todayIso() };
      this.render(container);
    });
    document.getElementById('rp-month').addEventListener('click', () => {
      const now = new Date();
      this.range = { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), to: todayIso() };
      this.render(container);
    });
    document.getElementById('rp-close').addEventListener('click', () => {
      document.getElementById('rp-viewer').style.display = 'none';
      this.current = null;
    });
    document.getElementById('rp-csv').addEventListener('click', () => {
      if (!this.current) return;
      const params = new URLSearchParams(this.range);
      Api.download(`/reports/${this.current.key}.csv?${params}`, `${this.current.key}-${this.range.from}-to-${this.range.to}.csv`)
        .then(() => Toast.ok(`${this.current.title} exported to CSV.`))
        .catch((err) => Toast.error(err.message));
    });
    document.getElementById('rp-print').addEventListener('click', () => window.print());

    this.renderCards();
  },

  renderCards() {
    const icons = {
      summary: '\u{1F4CB}', trips: '\u{1F68C}', attendance: '\u{1F465}', 'vehicle-cost': '\u{1F4B0}',
      maintenance: '\u{1F527}', fuel: '\u{26FD}', drivers: '\u{1F464}', routes: '\u{1F5FA}',
      compliance: '\u{1F4C4}', expenses: '\u{1F4B5}', incidents: '\u{1F6A8}',
    };
    document.getElementById('rp-grid').innerHTML = this.catalogue.map((r) => `
      <div class="card" style="margin-bottom:0; cursor:pointer" onclick="ReportsPage.open('${r.key}')">
        <div class="card-body">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--brand-100);display:grid;place-items:center;font-size:19px;flex-shrink:0">${icons[r.key] || '\u{1F4C8}'}</div>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:13.5px">${escapeHtml(r.title)}</div>
              <div class="text-muted" style="font-size:11.5px;margin-top:3px">${r.columns.length} columns</div>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:6px">
            <button class="btn sm" onclick="event.stopPropagation(); ReportsPage.open('${r.key}')">Preview</button>
            <button class="btn sm ghost" onclick="event.stopPropagation(); ReportsPage.download('${r.key}','${escapeHtml(r.title)}')">CSV</button>
          </div>
        </div>
      </div>`).join('');
  },

  open(key) {
    const report = this.catalogue.find((r) => r.key === key);
    if (!report) return;
    this.current = report;

    const viewer = document.getElementById('rp-viewer');
    viewer.style.display = 'block';
    document.getElementById('rp-title').textContent = report.title;
    document.getElementById('rp-meta').textContent = 'Loading...';
    document.getElementById('rp-table').innerHTML = '<div class="spinner"></div>';
    document.getElementById('rp-totals').innerHTML = '';
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const params = new URLSearchParams(this.range);
    Api.get(`/reports/${key}.json?${params}`).then(({ data, meta }) => {
      /**
       * The report fetch above can take several seconds on a wide date range.
       * If the user switched pages in the meantime, the viewer elements below
       * belong to a page that is no longer on screen - writing to them would
       * throw or corrupt the new view, so drop the result instead.
       */
      const metaEl = currentEl('rp-meta');
      const tableEl = currentEl('rp-table');
      const totalsEl = currentEl('rp-totals');
      if (!metaEl || !tableEl || !totalsEl) return;

      metaEl.textContent =
        `${meta.rowCount} rows \u00B7 ${Fmt.date(meta.range.from)} to ${Fmt.date(meta.range.to)} \u00B7 generated ${Fmt.time(meta.generatedAt)}`;

      const columns = meta.columns.map((label) => {
        const first = data[0] || {};
        const key = Object.keys(first).find((k) => this.labelToKey(k) === label) || this.labelToKey(label);
        return {
          key,
          label,
          align: typeof first[key] === 'number' ? 'right' : 'left',
          render: (row) => {
            const v = row[key];
            if (v === null || v === undefined) return '<span class="muted">-</span>';
            if (typeof v === 'number') return Fmt.num(v, Number.isInteger(v) ? 0 : 2);
            return escapeHtml(v);
          },
        };
      });

      tableEl.innerHTML = renderTable({
        rows: data.slice(0, 500),
        columns,
        emptyTitle: 'No data in this period',
        emptyText: 'Widen the reporting period and try again.',
      });

      const totals = meta.totals || {};
      const numericKeys = Object.keys(totals);
      totalsEl.innerHTML = numericKeys.length
        ? `<div class="section-title">Column totals</div>
           <div class="grid cols-4">
             ${numericKeys.slice(0, 8).map((k) => `<div class="stat" style="padding:11px 13px">
               <div class="label" style="margin-bottom:4px;font-size:10px">${escapeHtml(this.keyToLabel(k, meta.columns))}</div>
               <div class="value" style="font-size:17px">${Fmt.num(totals[k], Number.isInteger(totals[k]) ? 0 : 2)}</div>
             </div>`).join('')}
           </div>`
        : '';
    }).catch((err) => {
      const tableEl = currentEl('rp-table');
      if (!tableEl) return;
      tableEl.innerHTML = `<div class="empty"><div class="ico">&#9888;&#65039;</div><h4>Report failed</h4><p>${escapeHtml(err.message)}</p></div>`;
    });
  },

  /** "Vehicle Reg No" -> "vehicleRegNo" style matching for report columns. */
  labelToKey(label) {
    const words = String(label).replace(/[()%]/g, '').trim().split(/\s+/);
    return words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('')
      .replace(/\./g, '');
  },

  keyToLabel(key, columns) {
    return columns.find((c) => this.labelToKey(c) === key) || key;
  },

  download(key, title) {
    const params = new URLSearchParams(this.range);
    Api.download(`/reports/${key}.csv?${params}`, `${key}-${this.range.from}-to-${this.range.to}.csv`)
      .then(() => Toast.ok(`${title} exported to CSV.`))
      .catch((err) => Toast.error(err.message));
  },
};

/* ==========================================================================
   Users & audit trail (administrators only)
   ========================================================================== */

const UsersPage = {
  async render(container) {
    if (!Api.isAdmin) {
      container.innerHTML = `<div class="card"><div class="empty">
        <div class="ico">&#128274;</div><h4>Administrator access required</h4>
        <p>Your role does not permit managing user accounts.</p></div></div>`;
      return;
    }

    const [users, audit] = await Promise.all([Api.get('/users'), Api.get('/users/audit-log')]);

    container.innerHTML = `
      <div class="toolbar">
        <span class="text-muted" style="font-size:13px">${users.data.length} operator accounts</span>
        <div class="spacer"></div>
        <button class="btn primary" id="u-new">+ Add User</button>
      </div>

      <div class="card">
        <div class="card-head"><h3>Operator Accounts</h3><span class="desc">Roles control what each user can change</span></div>
        <div class="card-body tight">
          ${renderTable({
            rows: users.data,
            columns: [
              { key: 'name', label: 'Name', cls: 'strong' },
              { key: 'email', label: 'Email', cls: 'mono' },
              { key: 'role', label: 'Role', render: (r) => `<span class="pill ${r.role === 'admin' ? 'danger' : r.role === 'operations' ? 'info' : 'muted'}">${escapeHtml(r.role)}</span>` },
              { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
              { key: 'createdAt', label: 'Created', render: (r) => Fmt.date(r.createdAt) },
            ],
            rowActions: (r) => `
              <button class="btn sm" onclick="UsersPage.openForm('${r.id}')" title="Edit">&#9998;</button>
              <button class="btn sm danger" onclick="UsersPage.remove('${r.id}','${escapeHtml(r.email)}')" title="Delete">&#128465;</button>`,
          })}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Audit Trail</h3>
          <span class="desc">Most recent 300 system events</span>
        </div>
        <div class="card-body tight">
          ${renderTable({
            rows: audit.data.slice(0, 60),
            columns: [
              { key: 'at', label: 'When', render: (r) => `${Fmt.date(r.at)} <span class="muted">${Fmt.time(r.at)}</span>` },
              { key: 'actor', label: 'Actor', cls: 'mono' },
              { key: 'action', label: 'Action', cls: 'mono' },
              { key: 'detail', label: 'Detail' },
            ],
            emptyTitle: 'No activity recorded yet',
          })}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Role Permissions</h3></div>
        <div class="card-body tight">
          ${renderTable({
            rows: [
              { role: 'admin', view: 'Full', edit: 'Full', users: 'Manage accounts, roles and passwords', audit: 'Yes' },
              { role: 'operations', view: 'Full', edit: 'Records, trips, boarding, expenses', users: 'No access', audit: 'Yes' },
              { role: 'viewer', view: 'Full', edit: 'Read only', users: 'No access', audit: 'Yes' },
            ],
            columns: [
              { key: 'role', label: 'Role', render: (r) => `<span class="pill ${r.role === 'admin' ? 'danger' : r.role === 'operations' ? 'info' : 'muted'}">${escapeHtml(r.role)}</span>` },
              { key: 'view', label: 'View' },
              { key: 'edit', label: 'Edit' },
              { key: 'users', label: 'User Management' },
              { key: 'audit', label: 'Audit Access' },
            ],
          })}
        </div>
      </div>
    `;

    document.getElementById('u-new').addEventListener('click', () => this.openForm());
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit user ${id}` : 'Add an operator account',
      body: `
        <div class="form-grid">
          <div class="field span-2">
            <label>Full name <span class="req">*</span></label>
            <input type="text" id="uf-name" placeholder="Rohit Kulkarni">
          </div>
          <div class="field span-2">
            <label>Email address <span class="req">*</span></label>
            <input type="email" id="uf-email" placeholder="name@selectmobility.in">
          </div>
          <div class="field">
            <label>Role <span class="req">*</span></label>
            <select id="uf-role">
              <option value="viewer">Viewer (read only)</option>
              <option value="operations">Operations</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="uf-status"><option value="active">Active</option><option value="disabled">Disabled</option></select>
          </div>
          <div class="field span-2">
            <label>${editing ? 'New password <span class="hint">(leave blank to keep current)</span>' : 'Password <span class="req">*</span>'}</label>
            <input type="password" id="uf-pass" autocomplete="new-password" placeholder="Minimum 8 characters">
          </div>
        </div>
        <div class="field error" id="uf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="uf-save">${editing ? 'Save user' : 'Create user'}</button>`,
    });

    if (editing) {
      document.getElementById('uf-status', modal.el).innerHTML = '<option value="active">Active</option><option value="inactive">Inactive</option>';
      Api.get('/users').then(({ data }) => {
        const u = data.find((x) => x.id === id);
        if (!u) return;
        document.getElementById('uf-name', modal.el).value = u.name;
        document.getElementById('uf-email', modal.el).value = u.email;
        document.getElementById('uf-role', modal.el).value = u.role;
        document.getElementById('uf-status', modal.el).value = u.status;
      });
    }

    document.getElementById('uf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('uf-error', modal.el);
      errBox.style.display = 'none';
      const pass = document.getElementById('uf-pass', modal.el).value;
      const payload = {
        name: document.getElementById('uf-name', modal.el).value.trim(),
        email: document.getElementById('uf-email', modal.el).value.trim(),
        role: document.getElementById('uf-role', modal.el).value,
        status: document.getElementById('uf-status', modal.el).value,
      };
      if (pass) payload.password = pass;

      try {
        if (editing) await Api.put(`/users/${id}`, payload);
        else await Api.post('/users', payload);
        Toast.ok(editing ? 'User updated.' : 'Operator account created.');
        modal.close();
        App.route();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id, email) {
    const ok = await confirmDialog(`Delete the account for ${email}? They will lose access immediately.`, {
      title: 'Delete user', confirmLabel: 'Delete account',
    });
    if (!ok) return;
    try {
      await Api.del(`/users/${id}`);
      Toast.ok('User account deleted.');
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
