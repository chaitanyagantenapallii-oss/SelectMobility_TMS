'use strict';

/* ==========================================================================
   Trip logs - create, filter, edit and close out vehicle runs
   ========================================================================== */

const TripsPage = {
  state: { search: '', status: 'all', routeId: 'all', date: '', page: 1, pageSize: 25 },
  lookups: { routes: [], vehicles: [], drivers: [], shifts: [] },
  meta: null,

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';

    const [routes, vehicles, drivers, shifts] = await Promise.all([
      Api.get('/routes'), Api.get('/vehicles'), Api.get('/drivers'), Api.get('/shifts'),
    ]);
    this.lookups = {
      routes: routes.data,
      vehicles: vehicles.data,
      drivers: drivers.data,
      shifts: shifts.data,
    };

    const saved = ViewState.load('trips');
    if (saved) Object.assign(this.state, saved);

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="t-search" placeholder="Search trip ID, date, notes..." value="${escapeHtml(this.state.search)}"></div>
        <select id="t-status">
          <option value="all">All statuses</option>
          ${['scheduled', 'in-progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <select id="t-route">
          <option value="all">All routes</option>
          ${this.lookups.routes.map((r) => `<option value="${r.id}" ${this.state.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.code)} - ${escapeHtml(r.name)}</option>`).join('')}
        </select>
        <input type="date" id="t-date" value="${escapeHtml(this.state.date)}" style="padding:8px 11px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:13px">
        <button class="btn" id="t-clear">Clear</button>
        <div class="spacer"></div>
        <button class="btn" id="t-export">&#11123; Export CSV</button>
        ${Api.canWrite ? '<button class="btn primary" id="t-new">+ Log Trip</button>' : ''}
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Trip Register</h3>
          <span class="desc" id="t-count"></span>
        </div>
        <div class="card-body tight" id="t-table"></div>
        <div class="card-head" style="border-top:1px solid var(--line); border-bottom:none; justify-content:center">
          <div id="t-pager" style="display:flex;gap:8px;align-items:center"></div>
        </div>
      </div>
    `;

    document.getElementById('t-search').addEventListener('input', debounce((e) => {
      this.state.search = e.target.value;
      this.state.page = 1;
      this.load();
    }));
    document.getElementById('t-status').addEventListener('change', (e) => {
      this.state.status = e.target.value; this.state.page = 1; this.load();
    });
    document.getElementById('t-route').addEventListener('change', (e) => {
      this.state.routeId = e.target.value; this.state.page = 1; this.load();
    });
    document.getElementById('t-date').addEventListener('change', (e) => {
      this.state.date = e.target.value; this.state.page = 1; this.load();
    });
    document.getElementById('t-clear').addEventListener('click', () => {
      this.state = { search: '', status: 'all', routeId: 'all', date: '', page: 1, pageSize: 25 };
      ViewState.clear('trips');
      App.route();
    });
    document.getElementById('t-export').addEventListener('click', () => {
      const params = new URLSearchParams({ from: todayIso(-60), to: todayIso(1) });
      Api.download(`/reports/trips.csv?${params}`, 'trip-register.csv')
        .then(() => Toast.ok('Trip register exported.'))
        .catch((err) => Toast.error(err.message));
    });
    const newBtn = document.getElementById('t-new');
    if (newBtn) newBtn.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    ViewState.save('trips', this.state);
    const params = new URLSearchParams({
      page: this.state.page,
      pageSize: this.state.pageSize,
    });
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.routeId !== 'all') params.set('routeId', this.state.routeId);
    if (this.state.date) params.set('date', this.state.date);

    const res = await Api.get(`/trips?${params}`);
    this.meta = res.meta;

    const rows = res.data;
    document.getElementById('t-count').textContent = `${res.meta.total} trips in register`;

    document.getElementById('t-table').innerHTML = renderTable({
      rows,
      emptyTitle: 'No trips found',
      emptyText: 'Adjust the filters or log a new trip run.',
      columns: [
        { key: 'date', label: 'Date', render: (r) => `${Fmt.date(r.date)}<div class="muted">${Fmt.weekday(r.date)}</div>` },
        { key: 'id', label: 'Trip', cls: 'mono' },
        { key: 'shiftName', label: 'Shift', render: (r) => `<span class="pill muted">${escapeHtml(r.shiftName)}</span>` },
        { key: 'routeName', label: 'Route' },
        { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono' },
        { key: 'driverName', label: 'Driver' },
        {
          key: 'actualKm',
          label: 'Distance',
          align: 'right',
          render: (r) => `${Fmt.num(r.actualKm, 1)} km
            <div class="muted">${r.varianceKm > 0 ? '+' : ''}${Fmt.num(r.varianceKm, 1)} vs plan</div>`,
        },
        {
          key: 'passengersBoarded',
          label: 'Occupancy',
          align: 'right',
          render: (r) => `${r.passengersBoarded}/${r.passengersAllocated}
            <div class="muted">${r.occupancy === null ? '-' : Fmt.pct(r.occupancy)} of seats</div>`,
        },
        { key: 'fuelCost', label: 'Fuel', align: 'right', render: (r) => Fmt.money(r.fuelCost) },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => {
        const btns = [`<button class="btn sm" onclick="App.go('manifests','${r.id}')" title="Open manifest">&#128203;</button>`];
        if (Api.canWrite) {
          btns.push(`<button class="btn sm" onclick="TripsPage.openForm('${r.id}')" title="Edit trip">&#9998;</button>`);
          if (r.status !== 'completed' && r.status !== 'cancelled') {
            btns.push(`<button class="btn sm success" onclick="TripsPage.completeTrip('${r.id}')" title="Close out trip">&#10003;</button>`);
            btns.push(`<button class="btn sm danger" onclick="TripsPage.cancelTrip('${r.id}')" title="Cancel trip">&#10005;</button>`);
          }
          btns.push(`<button class="btn sm danger" onclick="TripsPage.remove('${r.id}')" title="Delete">&#128465;</button>`);
        }
        return btns.join('');
      },
    });

    this.renderPager();
  },

  renderPager() {
    const el = document.getElementById('t-pager');
    if (!this.meta || this.meta.totalPages <= 1) { el.innerHTML = ''; return; }
    const { page, totalPages } = this.meta;
    el.innerHTML = `
      <button class="btn sm" ${page <= 1 ? 'disabled' : ''} onclick="TripsPage.setPage(${page - 1})">&larr; Previous</button>
      <span class="text-muted" style="font-size:12.5px">Page ${page} of ${totalPages}</span>
      <button class="btn sm" ${page >= totalPages ? 'disabled' : ''} onclick="TripsPage.setPage(${page + 1})">Next &rarr;</button>`;
  },

  setPage(page) {
    this.state.page = page;
    this.load();
  },

  openForm(id) {
    const editing = id ? true : false;
    const trip = editing ? null : {};
    const l = this.lookups;

    const body = `
      <div class="form-grid">
        <div class="field">
          <label>Date <span class="req">*</span></label>
          <input type="date" id="f-date" value="${todayIso()}">
        </div>
        <div class="field">
          <label>Shift <span class="req">*</span></label>
          <select id="f-shift">${l.shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field span-2">
          <label>Route <span class="req">*</span></label>
          <select id="f-route">${l.routes.map((r) => `<option value="${r.id}">${escapeHtml(r.code)} - ${escapeHtml(r.name)} (${r.distanceKm} km)</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Vehicle <span class="req">*</span></label>
          <select id="f-vehicle">${l.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)} (${v.seats} seats)</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Driver <span class="req">*</span></label>
          <select id="f-driver">${l.drivers.map((d) => `<option value="${d.id}">${escapeHtml(d.name)} \u00B7 ${escapeHtml(d.phone)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Planned distance (km)</label>
          <input type="number" id="f-planned" min="0" step="0.1" value="0">
        </div>
        <div class="field">
          <label>Actual distance (km)</label>
          <input type="number" id="f-actual" min="0" step="0.1" value="0">
        </div>
        <div class="field">
          <label>Fuel cost (\u20B9)</label>
          <input type="number" id="f-fuel" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label>Toll cost (\u20B9)</label>
          <input type="number" id="f-toll" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label>Departure time</label>
          <input type="time" id="f-dep">
        </div>
        <div class="field">
          <label>Arrival time</label>
          <input type="time" id="f-arr">
        </div>
        <div class="field">
          <label>Status</label>
          <select id="f-status">
            ${['scheduled', 'in-progress', 'completed', 'cancelled'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
          </select>
        </div>
        <div class="field span-2">
          <label>Notes</label>
          <textarea id="f-notes" placeholder="Diversions, merged routes, passenger issues..."></textarea>
        </div>
      </div>
      <div class="field error" id="f-error" style="display:none"></div>`;

    const modal = openModal({
      title: editing ? `Edit trip ${id}` : 'Log a new trip run',
      body,
      wide: true,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="f-save">${editing ? 'Save changes' : 'Create trip'}</button>`,
    });

    // Auto-fill planned distance from the chosen route.
    const routeSel = document.getElementById('f-route', modal.el);
    const planField = document.getElementById('f-planned', modal.el);
    routeSel.addEventListener('change', () => {
      const route = l.routes.find((r) => r.id === routeSel.value);
      if (route && !editing) planField.value = (route.distanceKm * 2).toFixed(1);
    });
    routeSel.dispatchEvent(new Event('change'));

    if (editing) {
      Api.get(`/trips/${id}`).then(({ data: t }) => {
        document.getElementById('f-date', modal.el).value = t.date;
        document.getElementById('f-shift', modal.el).value = t.shiftId;
        document.getElementById('f-route', modal.el).value = t.routeId;
        document.getElementById('f-vehicle', modal.el).value = t.vehicleId;
        document.getElementById('f-driver', modal.el).value = t.driverId;
        document.getElementById('f-planned', modal.el).value = t.plannedKm;
        document.getElementById('f-actual', modal.el).value = t.actualKm;
        document.getElementById('f-fuel', modal.el).value = t.fuelCost;
        document.getElementById('f-toll', modal.el).value = t.tollCost;
        document.getElementById('f-status', modal.el).value = t.status;
        document.getElementById('f-notes', modal.el).value = t.notes || '';
        const dep = String(t.departureAt || '').match(/(\d{2}:\d{2})/);
        const arr = String(t.arrivalAt || '').match(/(\d{2}:\d{2})/);
        if (dep) document.getElementById('f-dep', modal.el).value = dep[1];
        if (arr) document.getElementById('f-arr', modal.el).value = arr[1];
      });
    }

    document.getElementById('f-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('f-error', modal.el);
      errBox.style.display = 'none';
      const date = document.getElementById('f-date', modal.el).value;
      const dep = document.getElementById('f-dep', modal.el).value;
      const arr = document.getElementById('f-arr', modal.el).value;

      const payload = {
        date,
        shiftId: document.getElementById('f-shift', modal.el).value,
        routeId: document.getElementById('f-route', modal.el).value,
        vehicleId: document.getElementById('f-vehicle', modal.el).value,
        driverId: document.getElementById('f-driver', modal.el).value,
        plannedKm: Number(document.getElementById('f-planned', modal.el).value || 0),
        actualKm: Number(document.getElementById('f-actual', modal.el).value || 0),
        fuelCost: Number(document.getElementById('f-fuel', modal.el).value || 0),
        tollCost: Number(document.getElementById('f-toll', modal.el).value || 0),
        status: document.getElementById('f-status', modal.el).value,
        notes: document.getElementById('f-notes', modal.el).value,
        departureAt: dep ? `${date} ${dep}:00` : `${date} 00:00:00`,
        arrivalAt: arr ? `${date} ${arr}:00` : `${date} 00:00:00`,
      };

      try {
        if (editing) await Api.put(`/trips/${id}`, payload);
        else await Api.post('/trips', payload);
        Toast.ok(editing ? 'Trip updated.' : 'Trip created.');
        modal.close();
        this.load();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  completeTrip(id) {
    const modal = openModal({
      title: `Close out trip ${id}`,
      body: `
        <p class="text-muted" style="font-size:13px">Enter the final readings for this run. The trip will be marked completed.</p>
        <div class="form-grid">
          <div class="field">
            <label>Actual distance (km) <span class="req">*</span></label>
            <input type="number" id="c-km" min="0" step="0.1" required>
          </div>
          <div class="field">
            <label>Fuel cost (\u20B9)</label>
            <input type="number" id="c-fuel" min="0" step="1" value="0">
          </div>
          <div class="field">
            <label>Toll cost (\u20B9)</label>
            <input type="number" id="c-toll" min="0" step="1" value="0">
          </div>
          <div class="field span-2">
            <label>Closing note</label>
            <textarea id="c-notes" placeholder="Any deviation, delay or observation from this run"></textarea>
          </div>
        </div>
        <div class="field error" id="c-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn success" id="c-save">Mark completed</button>`,
    });

    Api.get(`/trips/${id}`).then(({ data: t }) => {
      document.getElementById('c-km', modal.el).value = t.actualKm || t.plannedKm || 0;
      document.getElementById('c-fuel', modal.el).value = t.fuelCost || 0;
      document.getElementById('c-toll', modal.el).value = t.tollCost || 0;
      document.getElementById('c-notes', modal.el).value = t.notes || '';
    });

    document.getElementById('c-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('c-error', modal.el);
      const actualKm = Number(document.getElementById('c-km', modal.el).value);
      if (!actualKm) { errBox.textContent = 'Actual distance is required.'; errBox.style.display = 'block'; return; }
      try {
        await Api.post(`/trips/${id}/complete`, {
          actualKm,
          fuelCost: Number(document.getElementById('c-fuel', modal.el).value || 0),
          tollCost: Number(document.getElementById('c-toll', modal.el).value || 0),
          notes: document.getElementById('c-notes', modal.el).value,
        });
        Toast.ok(`Trip ${id} marked completed.`);
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  cancelTrip(id) {
    const modal = openModal({
      title: `Cancel trip ${id}`,
      body: `<div class="field">
          <label>Reason for cancellation <span class="req">*</span></label>
          <textarea id="x-reason" placeholder="Vehicle breakdown, insufficient bookings, driver unavailable..."></textarea>
          <div class="hint">All passenger bookings on this trip will be marked cancelled.</div>
        </div>
        <div class="field error" id="x-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Keep trip</button>
               <button class="btn danger" id="x-save">Cancel trip</button>`,
    });

    document.getElementById('x-save', modal.el).addEventListener('click', async () => {
      const reason = document.getElementById('x-reason', modal.el).value.trim();
      const errBox = document.getElementById('x-error', modal.el);
      if (!reason) { errBox.textContent = 'A reason is required.'; errBox.style.display = 'block'; return; }
      try {
        await Api.post(`/trips/${id}/cancel`, { reason });
        Toast.warn(`Trip ${id} cancelled.`);
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Permanently delete trip ${id}? This cannot be undone.`, {
      title: 'Delete trip', confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await Api.del(`/trips/${id}`);
      Toast.ok(`Trip ${id} deleted.`);
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
