'use strict';

/* ==========================================================================
   Routes & stops, plus shift timings
   ========================================================================== */

const RoutesPage = {
  state: { search: '', status: 'all', shiftId: 'all' },
  lookups: { shifts: [] },

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const shifts = await Api.get('/shifts');
    this.lookups.shifts = shifts.data;

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="r-search" placeholder="Search route code or name..." value="${escapeHtml(this.state.search)}"></div>
        <select id="r-shift">
          <option value="all">All shifts</option>
          ${this.lookups.shifts.map((s) => `<option value="${s.id}" ${this.state.shiftId === s.id ? 'selected' : ''}>${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)}</option>`).join('')}
        </select>
        <select id="r-status">
          <option value="all">All statuses</option>
          <option value="active" ${this.state.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="suspended" ${this.state.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/routes.csv?from=${todayIso(-60)}&to=${todayIso()}', 'routes.csv').then(()=>Toast.ok('Routes exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="r-new">+ Add Route</button>' : ''}
      </div>
      <div class="grid cols-2" id="r-cards"></div>
      <div class="card">
        <div class="card-head"><h3>Route Register</h3><span class="desc" id="r-count"></span></div>
        <div class="card-body tight" id="r-table"></div>
      </div>
    `;

    document.getElementById('r-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('r-shift').addEventListener('change', (e) => { this.state.shiftId = e.target.value; this.load(); });
    document.getElementById('r-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    const nb = document.getElementById('r-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.shiftId !== 'all') params.set('shiftId', this.state.shiftId);

    const { data } = await Api.get(`/routes?${params}`);

    /**
     * The fetch above is asynchronous. If the user navigated to another page
     * while it was in flight, #r-count and #r-table belong to a page that is no
     * longer on screen - writing to them would either throw or corrupt the new
     * view. Bail out and leave the current page alone.
     */
    const countEl = document.getElementById('r-count');
    const tableEl = document.getElementById('r-table');
    if (!countEl || !tableEl) return;

    countEl.textContent = `${data.length} routes`;

    tableEl.innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No routes configured',
      columns: [
        { key: 'code', label: 'Code', cls: 'mono strong' },
        { key: 'name', label: 'Route Name' },
        { key: 'shiftCode', label: 'Shift', render: (r) => `<span class="pill muted">${escapeHtml(r.shiftCode)}</span>` },
        { key: 'stopCount', label: 'Stops', align: 'right' },
        { key: 'distanceKm', label: 'One-way KM', align: 'right', render: (r) => Fmt.num(r.distanceKm, 1) },
        { key: 'employeeCount', label: 'Employees', align: 'right' },
        { key: 'tripsLogged', label: 'Trips', align: 'right' },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `
        <button class="btn sm" onclick="RoutesPage.viewRoster('${r.id}')" title="View roster">&#128101;</button>
        ${Api.canWrite ? `<button class="btn sm" onclick="RoutesPage.openForm('${r.id}')" title="Edit route">&#9998;</button>` : ''}
        ${Api.canWrite ? `<button class="btn sm danger" onclick="RoutesPage.remove('${r.id}')" title="Delete">&#128465;</button>` : ''}`,
    });

    // Highlight the three busiest routes as cards.
    const top = data.slice().sort((a, b) => b.employeeCount - a.employeeCount).slice(0, 2);
    const cardsEl = currentEl('r-cards');
    if (!cardsEl) return;
    cardsEl.innerHTML = top.map((r) => `
      <div class="card" style="margin-bottom:0">
        <div class="card-head">
          <h3>${escapeHtml(r.code)} \u00B7 ${escapeHtml(r.name)}</h3>
          <div class="spacer"></div>
          ${statusPill(r.status)}
        </div>
        <div class="card-body">
          <div class="kv" style="margin-bottom:14px">
            <dt>Shift</dt><dd>${escapeHtml(r.shiftName)}</dd>
            <dt>Distance</dt><dd>${r.distanceKm} km one way</dd>
            <dt>Employees</dt><dd>${r.employeeCount} active</dd>
          </div>
          <div class="section-title">Stops</div>
          <div class="stop-list">
            ${(r.stops || []).map((s, i) => `<div class="stop-row"><span class="seq">${i + 1}</span><span>${escapeHtml(s)}</span></div>`).join('') || '<p class="text-muted">No stops defined.</p>'}
          </div>
        </div>
      </div>`).join('');
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit route ${id}` : 'Add a route',
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Route code <span class="req">*</span></label>
            <input type="text" id="rf-code" placeholder="R-06">
          </div>
          <div class="field">
            <label>Shift <span class="req">*</span></label>
            <select id="rf-shift">${this.lookups.shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)}</option>`).join('')}</select>
          </div>
          <div class="field span-2">
            <label>Route name <span class="req">*</span></label>
            <input type="text" id="rf-name" placeholder="Baner - Aundh Corridor">
          </div>
          <div class="field">
            <label>One-way distance (km)</label>
            <input type="number" id="rf-km" min="0" step="0.1" value="0">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="rf-status"><option value="active">Active</option><option value="suspended">Suspended</option></select>
          </div>
          <div class="field span-2">
            <label>Stops <span class="hint">(one per line, in pickup order)</span></label>
            <textarea id="rf-stops" rows="6" placeholder="Baner Road&#10;Aundh Gaon&#10;Parihar Chowk&#10;Plant Gate 1"></textarea>
          </div>
        </div>
        <div class="field error" id="rf-error" style="display:none"></div>`,
      wide: true,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="rf-save">${editing ? 'Save route' : 'Create route'}</button>`,
    });

    if (editing) {
      Api.get(`/routes/${id}`).then(({ data: r }) => {
        document.getElementById('rf-code', modal.el).value = r.code;
        document.getElementById('rf-shift', modal.el).value = r.shiftId;
        document.getElementById('rf-name', modal.el).value = r.name;
        document.getElementById('rf-km', modal.el).value = r.distanceKm;
        document.getElementById('rf-status', modal.el).value = r.status;
        document.getElementById('rf-stops', modal.el).value = (r.stops || []).join('\n');
      });
    }

    document.getElementById('rf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('rf-error', modal.el);
      errBox.style.display = 'none';
      const stops = document.getElementById('rf-stops', modal.el).value
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

      const payload = {
        code: document.getElementById('rf-code', modal.el).value.trim(),
        name: document.getElementById('rf-name', modal.el).value.trim(),
        shiftId: document.getElementById('rf-shift', modal.el).value,
        distanceKm: Number(document.getElementById('rf-km', modal.el).value || 0),
        status: document.getElementById('rf-status', modal.el).value,
        stops,
      };

      if (stops.length < 2) {
        errBox.textContent = 'A route needs at least two stops.';
        errBox.style.display = 'block';
        return;
      }

      try {
        if (editing) await Api.put(`/routes/${id}`, payload);
        else await Api.post('/routes', payload);
        Toast.ok(editing ? 'Route updated.' : 'Route created.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async viewRoster(id) {
    const { data } = await Api.get(`/routes/${id}/roster`);
    openModal({
      title: `Roster \u00B7 ${data.route.code}`,
      wide: true,
      body: `
        <p class="text-muted" style="font-size:13px">${escapeHtml(data.route.name)} \u00B7 ${data.route.distanceKm} km one way \u00B7 ${data.totalEmployees} active employees</p>
        <div class="divider"></div>
        ${data.stops.map((s, i) => `
          <div style="margin-bottom:16px">
            <div class="stop-row" style="margin-bottom:7px">
              <span class="seq">${i + 1}</span><span class="strong">${escapeHtml(s.stop)}</span>
              <span class="count">${s.employees.length}</span>
            </div>
            ${s.employees.length
              ? renderTable({
                  rows: s.employees,
                  columns: [
                    { key: 'code', label: 'Code', cls: 'mono' },
                    { key: 'name', label: 'Employee', cls: 'strong' },
                    { key: 'department', label: 'Department' },
                    { key: 'phone', label: 'Phone' },
                  ],
                })
              : '<p class="text-muted" style="font-size:12.5px;padding-left:8px">No employees at this stop.</p>'}
          </div>`).join('')}
        ${data.unassignedStop.length ? `
          <div class="section-title">Employees with an unlisted stop</div>
          ${renderTable({ rows: data.unassignedStop, columns: [{ key: 'code', label: 'Code', cls: 'mono' }, { key: 'name', label: 'Employee' }] })}` : ''}
      `,
      footer: '<button class="btn" data-close>Close</button>',
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Delete route ${id}? Employees assigned to it will need reassignment.`, {
      title: 'Delete route', confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await Api.del(`/routes/${id}`);
      Toast.ok('Route deleted.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Shift timings
   -------------------------------------------------------------------------- */

const ShiftsPage = {
  async render(container) {
    const { data } = await Api.get('/shifts');
    const routes = await Api.get('/routes');

    container.innerHTML = `
      ${Api.canWrite ? '<div class="toolbar"><div class="spacer"></div><button class="btn primary" id="s-new">+ Add Shift</button></div>' : ''}
      <div class="grid cols-3" style="margin-bottom:18px">
        ${data.map((s) => {
          const onShift = routes.data.filter((r) => r.shiftId === s.id);
          return `<div class="card" style="margin-bottom:0">
            <div class="card-head">
              <h3>${escapeHtml(s.code)}</h3>
              <div class="spacer"></div>
              ${statusPill(s.status)}
            </div>
            <div class="card-body">
              <div style="font-size:14px;font-weight:600;margin-bottom:12px">${escapeHtml(s.name)}</div>
              <div class="kv">
                <dt>Pickup window</dt><dd class="mono">${escapeHtml(s.pickupStart)} - ${escapeHtml(s.pickupEnd)}</dd>
                <dt>Drop window</dt><dd class="mono">${escapeHtml(s.dropStart)} - ${escapeHtml(s.dropEnd)}</dd>
                <dt>Routes</dt><dd>${onShift.length}</dd>
              </div>
              <div class="divider"></div>
              <div class="stop-list">
                ${onShift.map((r) => `<div class="stop-row"><span class="strong">${escapeHtml(r.code)}</span><span>${escapeHtml(r.name)}</span><span class="count">${r.employeeCount} staff</span></div>`).join('') || '<p class="text-muted" style="font-size:12.5px">No routes on this shift.</p>'}
              </div>
              ${Api.canWrite ? `<div style="margin-top:14px;display:flex;gap:8px">
                <button class="btn sm" onclick="ShiftsPage.openForm('${s.id}')">Edit</button>
                <button class="btn sm danger" onclick="ShiftsPage.remove('${s.id}')">Delete</button>
              </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-head"><h3>Shift Register</h3><span class="desc">${data.length} shifts configured</span></div>
        <div class="card-body tight">
          ${renderTable({
            rows: data,
            columns: [
              { key: 'code', label: 'Code', cls: 'mono strong' },
              { key: 'name', label: 'Shift Name' },
              { key: 'pickupStart', label: 'Pickup From', cls: 'mono' },
              { key: 'pickupEnd', label: 'Pickup To', cls: 'mono' },
              { key: 'dropStart', label: 'Drop From', cls: 'mono' },
              { key: 'dropEnd', label: 'Drop To', cls: 'mono' },
              { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
            ],
            rowActions: Api.canWrite
              ? (r) => `<button class="btn sm" onclick="ShiftsPage.openForm('${r.id}')">&#9998;</button>
                        <button class="btn sm danger" onclick="ShiftsPage.remove('${r.id}')">&#128465;</button>`
              : null,
          })}
        </div>
      </div>
    `;

    const nb = document.getElementById('s-new');
    if (nb) nb.addEventListener('click', () => this.openForm());
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit shift ${id}` : 'Add a shift',
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Shift code <span class="req">*</span></label>
            <input type="text" id="sf-code" placeholder="S4">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="sf-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </div>
          <div class="field span-2">
            <label>Shift name <span class="req">*</span></label>
            <input type="text" id="sf-name" placeholder="Shift 4 - Late Night">
          </div>
          <div class="field">
            <label>Pickup start</label><input type="time" id="sf-ps" value="06:45">
          </div>
          <div class="field">
            <label>Pickup end</label><input type="time" id="sf-pe" value="08:00">
          </div>
          <div class="field">
            <label>Drop start</label><input type="time" id="sf-ds" value="17:30">
          </div>
          <div class="field">
            <label>Drop end</label><input type="time" id="sf-de" value="18:45">
          </div>
        </div>
        <div class="field error" id="sf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="sf-save">${editing ? 'Save shift' : 'Create shift'}</button>`,
    });

    if (editing) {
      Api.get(`/shifts/${id}`).then(({ data: s }) => {
        document.getElementById('sf-code', modal.el).value = s.code;
        document.getElementById('sf-name', modal.el).value = s.name;
        document.getElementById('sf-status', modal.el).value = s.status;
        document.getElementById('sf-ps', modal.el).value = s.pickupStart;
        document.getElementById('sf-pe', modal.el).value = s.pickupEnd;
        document.getElementById('sf-ds', modal.el).value = s.dropStart;
        document.getElementById('sf-de', modal.el).value = s.dropEnd;
      });
    }

    document.getElementById('sf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('sf-error', modal.el);
      const payload = {
        code: document.getElementById('sf-code', modal.el).value.trim(),
        name: document.getElementById('sf-name', modal.el).value.trim(),
        status: document.getElementById('sf-status', modal.el).value,
        pickupStart: document.getElementById('sf-ps', modal.el).value,
        pickupEnd: document.getElementById('sf-pe', modal.el).value,
        dropStart: document.getElementById('sf-ds', modal.el).value,
        dropEnd: document.getElementById('sf-de', modal.el).value,
      };
      try {
        if (editing) await Api.put(`/shifts/${id}`, payload);
        else await Api.post('/shifts', payload);
        Toast.ok(editing ? 'Shift updated.' : 'Shift created.');
        modal.close();
        App.route();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog('Delete this shift? Routes and employees on it will need reassignment.', {
      title: 'Delete shift', confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await Api.del(`/shifts/${id}`);
      Toast.ok('Shift deleted.');
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
