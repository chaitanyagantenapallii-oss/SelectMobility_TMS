'use strict';

/* ==========================================================================
   Manifests & boarding - passenger lists, stop sequence, digital boarding
   ========================================================================== */

const ManifestsPage = {
  tripId: null,
  manifest: null,
  draft: {},

  async render(container, args) {
    this.tripId = args && args[0] ? args[0] : null;
    this.draft = {};

    if (!this.tripId) return this.renderPicker(container);
    return this.renderManifest(container);
  },

  /* -- Trip picker ------------------------------------------------------- */

  async renderPicker(container) {
    const todayRes = await Api.get(`/trips?date=${todayIso()}&pageSize=200`);
    const recentRes = await Api.get(`/trips?from=${todayIso(-3)}&to=${todayIso()}&pageSize=200`);

    const running = todayRes.data.filter((t) => t.status === 'in-progress' || t.status === 'scheduled');

    container.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Select a run to manage its manifest</h3>
          <span class="desc">${running.length} runs today awaiting boarding</span>
        </div>
        <div class="card-body tight" id="m-pending"></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Recent Runs</h3>
          <span class="desc">Last 4 days</span>
        </div>
        <div class="card-body tight" id="m-recent"></div>
      </div>
    `;

    const columns = [
      { key: 'departureAt', label: 'Departure', render: (r) => `<span class="mono">${Fmt.time(r.departureAt)}</span>` },
      { key: 'date', label: 'Date', render: (r) => Fmt.date(r.date) },
      { key: 'routeName', label: 'Route', render: (r) => `<span class="strong">${escapeHtml(r.routeName)}</span>` },
      { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono' },
      { key: 'driverName', label: 'Driver' },
      {
        key: 'passengersBoarded',
        label: 'Boarded',
        align: 'right',
        render: (r) => `${r.passengersBoarded}/${r.passengersAllocated}`,
      },
      { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
    ];

    const actions = (r) => `<button class="btn sm primary" onclick="App.go('manifests','${r.id}')">Open manifest</button>`;

    document.getElementById('m-pending').innerHTML = renderTable({
      rows: running,
      columns,
      rowActions: actions,
      emptyTitle: 'No runs pending boarding',
      emptyText: 'All of today\u2019s departures have been closed out.',
    });

    document.getElementById('m-recent').innerHTML = renderTable({
      rows: recentRes.data.slice(0, 24),
      columns,
      rowActions: actions,
      emptyTitle: 'No recent runs',
    });
  },

  /* -- Manifest ---------------------------------------------------------- */

  async renderManifest(container) {
    const { data } = await Api.get(`/trips/${this.tripId}/manifest`);
    this.manifest = data;
    const s = data.summary;

    container.innerHTML = `
      <div class="toolbar">
        <button class="btn" onclick="App.go('manifests')">&larr; All runs</button>
        <div class="spacer"></div>
        <button class="btn" onclick="window.print()">&#128424; Print manifest</button>
        ${Api.canWrite ? '<button class="btn primary" id="m-save" disabled>Save boarding (0)</button>' : ''}
      </div>

      <div class="grid cols-4" style="margin-bottom:18px">
        <div class="stat"><div class="label">&#128101; Allocated</div><div class="value">${s.total}</div><div class="foot">Employees on this run</div></div>
        <div class="stat ok"><div class="label">&#9989; Boarded</div><div class="value">${s.boarded}</div><div class="foot">Marked present</div></div>
        <div class="stat danger"><div class="label">&#128683; Absent</div><div class="value">${s.absent}</div><div class="foot">Marked no-show</div></div>
        <div class="stat warn"><div class="label">&#128186; Seats Left</div><div class="value">${s.seatsAvailable === null ? '-' : s.seatsAvailable}</div><div class="foot">Vehicle capacity ${data.vehicle ? data.vehicle.seats : '-'}</div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>${escapeHtml(data.route ? data.route.code + ' \u00B7 ' + data.route.name : 'Route not found')}</h3>
          <span class="desc">
            Trip ${escapeHtml(data.trip.id)} \u00B7 ${Fmt.date(data.trip.date)} \u00B7
            Departs ${Fmt.time(data.trip.departureAt)} ${statusPill(data.trip.status)}
          </span>
        </div>
        <div class="card-body">
          <div class="grid cols-3">
            <div>
              <div class="section-title">Vehicle</div>
              <div class="kv">
                <dt>Registration</dt><dd class="mono">${escapeHtml(data.vehicle ? data.vehicle.regNo : '-')}</dd>
                <dt>Model</dt><dd>${escapeHtml(data.vehicle ? data.vehicle.model : '-')}</dd>
                <dt>Capacity</dt><dd>${data.vehicle ? data.vehicle.seats : '-'} seats</dd>
              </div>
            </div>
            <div>
              <div class="section-title">Driver</div>
              <div class="kv">
                <dt>Name</dt><dd>${escapeHtml(data.driver ? data.driver.name : '-')}</dd>
                <dt>Phone</dt><dd>${escapeHtml(data.driver ? data.driver.phone : '-')}</dd>
                <dt>Route length</dt><dd>${data.route ? data.route.distanceKm + ' km' : '-'}</dd>
              </div>
            </div>
            <div>
              <div class="section-title">Boarding progress</div>
              <div style="margin-top:6px">
                <div class="bar-track" style="height:10px">
                  <div class="bar-fill ok" style="width:${s.total ? (s.boarded / s.total) * 100 : 0}%"></div>
                </div>
                <div class="text-muted" style="font-size:12px; margin-top:6px">
                  ${s.boarded} of ${s.total} boarded \u00B7 ${s.total ? Fmt.pct((s.boarded / s.total) * 100) : '0%'} complete
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Stop Sequence &amp; Passenger List</h3>
          <span class="desc">Tick employees as they board. Changes are saved together.</span>
          <div class="spacer"></div>
          ${Api.canWrite ? `<button class="btn sm" id="m-all">Mark all boarded</button>
          <button class="btn sm" id="m-none">Clear all</button>` : ''}
        </div>
        <div class="card-body" id="m-stops"></div>
      </div>

      ${data.unlisted.length ? `
      <div class="card">
        <div class="card-head"><h3>Passengers Without a Listed Stop</h3></div>
        <div class="card-body" id="m-unlisted"></div>
      </div>` : ''}
    `;

    this.renderStops();
    if (data.unlisted.length) this.renderUnlisted(data.unlisted);

    if (Api.canWrite) {
      document.getElementById('m-save').addEventListener('click', () => this.save());
      const all = document.getElementById('m-all');
      const none = document.getElementById('m-none');
      if (all) all.addEventListener('click', () => {
        this.manifest.stops.forEach((st) => st.passengers.forEach((p) => { this.draft[p.bookingId] = true; }));
        this.manifest.unlisted.forEach((p) => { this.draft[p.bookingId] = true; });
        this.renderStops();
        if (this.manifest.unlisted.length) this.renderUnlisted(this.manifest.unlisted);
      });
      if (none) none.addEventListener('click', () => {
        this.manifest.stops.forEach((st) => st.passengers.forEach((p) => { this.draft[p.bookingId] = false; }));
        this.manifest.unlisted.forEach((p) => { this.draft[p.bookingId] = false; });
        this.renderStops();
        if (this.manifest.unlisted.length) this.renderUnlisted(this.manifest.unlisted);
      });
    }
  },

  passengerRow(p) {
    const current = this.draft[p.bookingId] !== undefined ? this.draft[p.bookingId] : p.boarded;
    const marker = current === true ? 'ok' : current === false ? 'danger' : 'muted';
    const label = current === true ? 'Boarded' : current === false ? 'Absent' : 'Pending';
    const checkbox = Api.canWrite
      ? `<input type="checkbox" data-booking="${p.bookingId}" ${current === true ? 'checked' : ''}>`
      : '';
    return `<div class="checkbox-row">
      ${checkbox}
      <span class="mono" style="font-size:11.5px;color:var(--ink-500)">${escapeHtml(p.code || p.employeeId)}</span>
      <span class="strong">${escapeHtml(p.name)}</span>
      <span class="text-muted" style="font-size:12px">${escapeHtml(p.department || '')}</span>
      <span class="stop">${escapeHtml(p.stop || '-')}</span>
      <span class="pill ${marker}">${label}</span>
    </div>`;
  },

  renderStops() {
    const el = document.getElementById('m-stops');
    el.innerHTML = this.manifest.stops.map((st, i) => `
      <div style="margin-bottom:18px">
        <div class="stop-row" style="margin-bottom:8px">
          <span class="seq">${i + 1}</span>
          <span class="strong">${escapeHtml(st.stop)}</span>
          <span class="count">${st.passengers.length} employee${st.passengers.length === 1 ? '' : 's'}</span>
        </div>
        ${st.passengers.length
          ? `<div class="checkbox-list">${st.passengers.map((p) => this.passengerRow(p)).join('')}</div>`
          : '<div class="text-muted" style="font-size:12.5px;padding:6px 12px">No employees board at this stop.</div>'}
      </div>`).join('');

    this.bindCheckboxes(el);
    this.updateSaveButton();
  },

  renderUnlisted(passengers) {
    const el = document.getElementById('m-unlisted');
    el.innerHTML = `<div class="checkbox-list">${passengers.map((p) => this.passengerRow(p)).join('')}</div>`;
    this.bindCheckboxes(el);
  },

  bindCheckboxes(root) {
    $$('input[data-booking]', root).forEach((cb) => {
      cb.addEventListener('change', () => {
        this.draft[cb.dataset.booking] = cb.checked;
        const row = cb.closest('.checkbox-row');
        const pill = row.querySelector('.pill');
        pill.className = `pill ${cb.checked ? 'ok' : 'danger'}`;
        pill.textContent = cb.checked ? 'Boarded' : 'Absent';
        this.updateSaveButton();
      });
    });
  },

  updateSaveButton() {
    const btn = document.getElementById('m-save');
    if (!btn) return;
    const count = Object.keys(this.draft).length;
    btn.disabled = count === 0;
    btn.textContent = `Save boarding (${count})`;
  },

  async save() {
    const entries = Object.entries(this.draft).map(([bookingId, boarded]) => ({ bookingId, boarded }));
    if (!entries.length) return;
    try {
      const res = await Api.post(`/trips/${this.tripId}/attendance`, { entries });
      Toast.ok(`Boarding saved. ${res.boarded} employees now marked present.`);
      this.draft = {};
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
