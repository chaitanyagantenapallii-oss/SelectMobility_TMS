'use strict';

/* ==========================================================================
   Fleet vehicles
   ========================================================================== */

const VehiclesPage = {
  state: { search: '', status: 'all', type: 'all', vendorId: 'all' },
  vendors: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const vendors = await Api.get('/vendors');
    this.vendors = vendors.data;

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="v-search" placeholder="Search registration, model..." value="${escapeHtml(this.state.search)}"></div>
        <select id="v-status">
          <option value="all">All statuses</option>
          ${['active', 'idle', 'maintenance', 'breakdown', 'retired'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <select id="v-type">
          <option value="all">All types</option>
          ${['bus', 'van', 'car', 'tempo', 'ev-bus'].map((t) => `<option value="${t}" ${this.state.type === t ? 'selected' : ''}>${Fmt.titleCase(t)}</option>`).join('')}
        </select>
        <select id="v-vendor">
          <option value="all">All vendors</option>
          ${this.vendors.map((v) => `<option value="${v.id}" ${this.state.vendorId === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/vehicle-cost.csv?from=${todayIso(-60)}&to=${todayIso()}', 'vehicle-cost.csv').then(()=>Toast.ok('Vehicle cost report exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="v-new">+ Add Vehicle</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Fleet Register</h3><span class="desc" id="v-count"></span></div>
        <div class="card-body tight" id="v-table"></div>
      </div>
    `;

    document.getElementById('v-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('v-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    document.getElementById('v-type').addEventListener('change', (e) => { this.state.type = e.target.value; this.load(); });
    document.getElementById('v-vendor').addEventListener('change', (e) => { this.state.vendorId = e.target.value; this.load(); });
    const nb = document.getElementById('v-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.type !== 'all') params.set('type', this.state.type);
    if (this.state.vendorId !== 'all') params.set('vendorId', this.state.vendorId);

    const { data } = await Api.get(`/vehicles?${params}`);
    document.getElementById('v-count').textContent = `${data.length} vehicles in fleet`;

    document.getElementById('v-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No vehicles found',
      emptyText: 'Adjust the filters or add a vehicle to the fleet.',
      columns: [
        { key: 'regNo', label: 'Registration', render: (r) => `<span class="mono strong">${escapeHtml(r.regNo)}</span>
            ${r.ownership === 'contract' ? '<div class="muted">contracted</div>' : '<div class="muted">owned</div>'}` },
        { key: 'model', label: 'Model' },
        { key: 'type', label: 'Type', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.type))}</span>` },
        { key: 'seats', label: 'Seats', align: 'right' },
        { key: 'vendorName', label: 'Vendor' },
        {
          key: 'assignedDriver',
          label: 'Driver',
          render: (r) => r.assignedDriver
            ? `${escapeHtml(r.assignedDriver.name)}<div class="muted">${escapeHtml(r.assignedDriver.phone)}</div>`
            : '<span class="muted">Unassigned</span>',
        },
        { key: 'odometer', label: 'Odometer', align: 'right', render: (r) => `${Fmt.num(r.odometer)} km` },
        {
          key: 'nextDue',
          label: 'Next Compliance',
          render: (r) => {
            if (!r.nextDue) return '<span class="muted">-</span>';
            const d = r.nextDue.daysLeft;
            const tone = d < 0 ? 'danger' : d <= 30 ? 'warn' : 'ok';
            return `<span class="pill ${tone}">${escapeHtml(Fmt.titleCase(r.nextDue.field.replace('Expiry', '')))}</span>
              <div class="muted">${Fmt.date(r.nextDue.date)} (${d}d)</div>`;
          },
        },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `
        <button class="btn sm" onclick="VehiclesPage.detail('${r.id}')" title="View details">&#128065;</button>
        ${Api.canWrite ? `<button class="btn sm" onclick="VehiclesPage.openForm('${r.id}')" title="Edit">&#9998;</button>
        <button class="btn sm danger" onclick="VehiclesPage.remove('${r.id}')" title="Delete">&#128465;</button>` : ''}`,
    });
  },

  async detail(id) {
    const { data: v } = await Api.get(`/vehicles/${id}`);
    const compliance = ['insuranceExpiry', 'permitExpiry', 'pucExpiry', 'fitnessExpiry'];
    const labels = { insuranceExpiry: 'Insurance', permitExpiry: 'Permit', pucExpiry: 'PUC', fitnessExpiry: 'Fitness' };

    openModal({
      title: `${v.regNo} \u00B7 ${v.model}`,
      wide: true,
      body: `
        <div class="grid cols-2">
          <div>
            <div class="section-title">Vehicle</div>
            <div class="kv">
              <dt>Registration</dt><dd class="mono">${escapeHtml(v.regNo)}</dd>
              <dt>Model</dt><dd>${escapeHtml(v.model)}</dd>
              <dt>Type</dt><dd>${escapeHtml(Fmt.titleCase(v.type))}</dd>
              <dt>Capacity</dt><dd>${v.seats} seats</dd>
              <dt>Fuel</dt><dd>${escapeHtml(Fmt.titleCase(v.fuelType))}</dd>
              <dt>Ownership</dt><dd>${escapeHtml(Fmt.titleCase(v.ownership))}</dd>
              <dt>Vendor</dt><dd>${escapeHtml(v.vendorName)}</dd>
              <dt>Odometer</dt><dd>${Fmt.num(v.odometer)} km</dd>
              <dt>Status</dt><dd>${statusPill(v.status)}</dd>
            </div>
          </div>
          <div>
            <div class="section-title">Assignment</div>
            <div class="kv">
              <dt>Driver</dt><dd>${v.assignedDriver ? escapeHtml(v.assignedDriver.name) : 'Unassigned'}</dd>
              <dt>Phone</dt><dd>${v.assignedDriver ? escapeHtml(v.assignedDriver.phone) : '-'}</dd>
              <dt>Last service</dt><dd>${Fmt.date(v.lastServiceAt)}</dd>
              <dt>Next service</dt><dd>${v.nextServiceKm ? Fmt.num(v.nextServiceKm) + ' km' : '-'}</dd>
            </div>
            <div class="section-title">Running summary (all time)</div>
            <div class="kv">
              <dt>Trips logged</dt><dd>${v.stats.tripsLogged}</dd>
              <dt>Distance</dt><dd>${Fmt.num(v.stats.kmLogged, 1)} km</dd>
              <dt>Fuel spend</dt><dd>${Fmt.money(v.stats.fuelSpend)}</dd>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-title">Statutory compliance</div>
        ${renderTable({
          rows: compliance.map((field) => ({
            document: labels[field],
            expiry: v[field],
            days: v[field] ? Math.round((new Date(v[field]) - new Date()) / 86400000) : null,
          })),
          columns: [
            { key: 'document', label: 'Document' },
            { key: 'expiry', label: 'Expiry date', render: (r) => Fmt.date(r.expiry) },
            {
              key: 'days',
              label: 'Status',
              render: (r) => {
                if (r.days === null) return '<span class="muted">Not on file</span>';
                const tone = r.days < 0 ? 'danger' : r.days <= 30 ? 'warn' : 'ok';
                const text = r.days < 0 ? `Expired ${Math.abs(r.days)} days ago` : `${r.days} days remaining`;
                return `<span class="pill ${tone}">${text}</span>`;
              },
            },
          ],
        })}
      `,
      footer: '<button class="btn" data-close>Close</button>',
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit vehicle ${id}` : 'Add a vehicle to the fleet',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Registration number <span class="req">*</span></label>
            <input type="text" id="vf-reg" placeholder="MH-12-AB-1234">
          </div>
          <div class="field">
            <label>Model <span class="req">*</span></label>
            <input type="text" id="vf-model" placeholder="Tata Starbus 40">
          </div>
          <div class="field">
            <label>Type <span class="req">*</span></label>
            <select id="vf-type">
              ${['bus', 'van', 'car', 'tempo', 'ev-bus'].map((t) => `<option value="${t}">${Fmt.titleCase(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Seat capacity <span class="req">*</span></label>
            <input type="number" id="vf-seats" min="4" max="80" value="32">
          </div>
          <div class="field">
            <label>Fuel type</label>
            <select id="vf-fuel">
              <option value="diesel">Diesel</option><option value="cng">CNG</option>
              <option value="electric">Electric</option><option value="petrol">Petrol</option>
            </select>
          </div>
          <div class="field">
            <label>Ownership</label>
            <select id="vf-own"><option value="owned">Owned</option><option value="contract">Contracted</option></select>
          </div>
          <div class="field">
            <label>Vendor</label>
            <select id="vf-vendor"><option value="">-- none (own fleet) --</option>
              ${this.vendors.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="vf-status">
              ${['active', 'idle', 'maintenance', 'breakdown', 'retired'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Odometer (km)</label>
            <input type="number" id="vf-odo" min="0" step="1" value="0">
          </div>
          <div class="field">
            <label>Next service at (km)</label>
            <input type="number" id="vf-next" min="0" step="1" placeholder="Optional">
          </div>
          <div class="field">
            <label>Insurance expiry</label><input type="date" id="vf-ins">
          </div>
          <div class="field">
            <label>Permit expiry</label><input type="date" id="vf-perm">
          </div>
          <div class="field">
            <label>PUC expiry</label><input type="date" id="vf-puc">
          </div>
          <div class="field">
            <label>Fitness expiry</label><input type="date" id="vf-fit">
          </div>
        </div>
        <div class="field error" id="vf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="vf-save">${editing ? 'Save vehicle' : 'Add vehicle'}</button>`,
    });

    if (editing) {
      Api.get(`/vehicles/${id}`).then(({ data: v }) => {
        document.getElementById('vf-reg', modal.el).value = v.regNo;
        document.getElementById('vf-model', modal.el).value = v.model;
        document.getElementById('vf-type', modal.el).value = v.type;
        document.getElementById('vf-seats', modal.el).value = v.seats;
        document.getElementById('vf-fuel', modal.el).value = v.fuelType;
        document.getElementById('vf-own', modal.el).value = v.ownership;
        document.getElementById('vf-vendor', modal.el).value = v.vendorId || '';
        document.getElementById('vf-status', modal.el).value = v.status;
        document.getElementById('vf-odo', modal.el).value = v.odometer;
        document.getElementById('vf-next', modal.el).value = v.nextServiceKm || '';
        document.getElementById('vf-ins', modal.el).value = v.insuranceExpiry || '';
        document.getElementById('vf-perm', modal.el).value = v.permitExpiry || '';
        document.getElementById('vf-puc', modal.el).value = v.pucExpiry || '';
        document.getElementById('vf-fit', modal.el).value = v.fitnessExpiry || '';
      });
    }

    document.getElementById('vf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('vf-error', modal.el);
      errBox.style.display = 'none';
      const next = document.getElementById('vf-next', modal.el).value;
      const payload = {
        regNo: document.getElementById('vf-reg', modal.el).value.trim(),
        model: document.getElementById('vf-model', modal.el).value.trim(),
        type: document.getElementById('vf-type', modal.el).value,
        seats: Number(document.getElementById('vf-seats', modal.el).value || 0),
        fuelType: document.getElementById('vf-fuel', modal.el).value,
        ownership: document.getElementById('vf-own', modal.el).value,
        vendorId: document.getElementById('vf-vendor', modal.el).value || null,
        status: document.getElementById('vf-status', modal.el).value,
        odometer: Number(document.getElementById('vf-odo', modal.el).value || 0),
        nextServiceKm: next ? Number(next) : null,
        insuranceExpiry: document.getElementById('vf-ins', modal.el).value || null,
        permitExpiry: document.getElementById('vf-perm', modal.el).value || null,
        pucExpiry: document.getElementById('vf-puc', modal.el).value || null,
        fitnessExpiry: document.getElementById('vf-fit', modal.el).value || null,
      };

      try {
        if (editing) await Api.put(`/vehicles/${id}`, payload);
        else await Api.post('/vehicles', payload);
        Toast.ok(editing ? 'Vehicle updated.' : 'Vehicle added to fleet.');
        modal.close();
        this.load();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Remove vehicle ${id} from the fleet register?`, { title: 'Delete vehicle', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/vehicles/${id}`);
      Toast.ok('Vehicle removed.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* ==========================================================================
   Drivers
   ========================================================================== */

const DriversPage = {
  state: { search: '', status: 'all', vendorId: 'all' },
  lookups: { vendors: [], vehicles: [] },

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const [vendors, vehicles] = await Promise.all([Api.get('/vendors'), Api.get('/vehicles')]);
    this.lookups = { vendors: vendors.data, vehicles: vehicles.data };

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="d-search" placeholder="Search name, phone, licence..." value="${escapeHtml(this.state.search)}"></div>
        <select id="d-status">
          <option value="all">All statuses</option>
          ${['active', 'on-leave', 'suspended', 'exited'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <select id="d-vendor">
          <option value="all">All vendors</option>
          ${this.lookups.vendors.map((v) => `<option value="${v.id}" ${this.state.vendorId === v.id ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/drivers.csv?from=${todayIso(-60)}&to=${todayIso()}', 'drivers.csv').then(()=>Toast.ok('Driver scorecard exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="d-new">+ Add Driver</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Driver Register</h3><span class="desc" id="d-count"></span></div>
        <div class="card-body tight" id="d-table"></div>
      </div>
    `;

    document.getElementById('d-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('d-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    document.getElementById('d-vendor').addEventListener('change', (e) => { this.state.vendorId = e.target.value; this.load(); });
    const nb = document.getElementById('d-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.vendorId !== 'all') params.set('vendorId', this.state.vendorId);

    const { data } = await Api.get(`/drivers?${params}`);
    document.getElementById('d-count').textContent = `${data.length} drivers on roster`;

    document.getElementById('d-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No drivers found',
      columns: [
        {
          key: 'name',
          label: 'Driver',
          render: (r) => `<div style="display:flex;align-items:center;gap:9px">
            <div class="avatar" style="width:28px;height:28px;border-radius:50%;background:var(--brand-700);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700">${Fmt.initials(r.name)}</div>
            <div><div class="strong">${escapeHtml(r.name)}</div><div class="muted">${escapeHtml(r.phone)}</div></div></div>`,
        },
        { key: 'licenceNo', label: 'Licence', render: (r) => `<span class="mono">${escapeHtml(r.licenceNo)}</span>
            ${r.licenceAlert !== 'ok' ? `<span class="pill ${r.licenceAlert === 'expired' ? 'danger' : 'warn'}">${r.licenceAlert}</span>` : ''}
            <div class="muted">${r.licenceDaysLeft === null ? '-' : r.licenceDaysLeft + ' days left'}</div>` },
        { key: 'badge', label: 'Badge', cls: 'mono' },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'vehicleRegNo', label: 'Assigned Vehicle', cls: 'mono' },
        { key: 'experience', label: 'Exp.', align: 'right', render: (r) => `${r.experience} yrs` },
        { key: 'stats', label: 'KM Driven', align: 'right', render: (r) => Fmt.num(r.stats.kmDriven, 1) },
        { key: 'stats', label: 'On-time', align: 'right', render: (r) => r.stats.onTimeRate === null ? '-' : Fmt.pct(r.stats.onTimeRate) },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `
        <button class="btn sm" onclick="DriversPage.detail('${r.id}')" title="View scorecard">&#128065;</button>
        ${Api.canWrite ? `<button class="btn sm" onclick="DriversPage.openForm('${r.id}')" title="Edit">&#9998;</button>
        <button class="btn sm danger" onclick="DriversPage.remove('${r.id}')" title="Delete">&#128465;</button>` : ''}`,
    });
  },

  async detail(id) {
    const { data: d } = await Api.get(`/drivers/${id}`);
    const trips = await Api.get(`/trips?driverId=${id}&pageSize=12`);
    openModal({
      title: `${d.name} \u00B7 Driver scorecard`,
      wide: true,
      body: `
        <div class="grid cols-4" style="margin-bottom:16px">
          <div class="stat"><div class="label">Trips</div><div class="value">${d.stats.totalTrips}</div></div>
          <div class="stat ok"><div class="label">Completed</div><div class="value">${d.stats.completedTrips}</div></div>
          <div class="stat"><div class="label">KM Driven</div><div class="value" style="font-size:20px">${Fmt.num(d.stats.kmDriven, 0)}</div></div>
          <div class="stat ${d.licenceAlert === 'ok' ? 'ok' : 'warn'}"><div class="label">Licence</div><div class="value" style="font-size:17px">${d.licenceDaysLeft === null ? '-' : d.licenceDaysLeft + 'd'}</div></div>
        </div>
        <div class="grid cols-2">
          <div>
            <div class="section-title">Profile</div>
            <div class="kv">
              <dt>Phone</dt><dd>${escapeHtml(d.phone)}</dd>
              <dt>Licence no.</dt><dd class="mono">${escapeHtml(d.licenceNo)}</dd>
              <dt>Licence expiry</dt><dd>${Fmt.date(d.licenceExpiry)}</dd>
              <dt>Badge</dt><dd class="mono">${escapeHtml(d.badge)}</dd>
              <dt>Vendor</dt><dd>${escapeHtml(d.vendorName)}</dd>
              <dt>Assigned vehicle</dt><dd class="mono">${escapeHtml(d.vehicleRegNo)}</dd>
              <dt>Experience</dt><dd>${d.experience} years</dd>
              <dt>Status</dt><dd>${statusPill(d.status)}</dd>
            </div>
          </div>
          <div>
            <div class="section-title">On-time performance</div>
            ${d.stats.onTimeRate === null ? '<p class="text-muted">No completed trips in the period.</p>'
              : Chart.hbars([{ label: 'Trips within 5% of planned distance', value: d.stats.onTimeRate, display: Fmt.pct(d.stats.onTimeRate), tone: d.stats.onTimeRate >= 90 ? 'ok' : d.stats.onTimeRate >= 75 ? 'warn' : 'danger' }], { max: 100 })}
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-title">Recent trips</div>
        ${renderTable({
          rows: trips.data,
          columns: [
            { key: 'date', label: 'Date', render: (r) => Fmt.date(r.date) },
            { key: 'routeName', label: 'Route' },
            { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono' },
            { key: 'actualKm', label: 'KM', align: 'right', render: (r) => Fmt.num(r.actualKm, 1) },
            { key: 'passengersBoarded', label: 'Boarded', align: 'right' },
            { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
          ],
          emptyTitle: 'No trips recorded',
        })}
      `,
      footer: '<button class="btn" data-close>Close</button>',
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit driver ${id}` : 'Add a driver',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Full name <span class="req">*</span></label>
            <input type="text" id="df-name" placeholder="Ramesh Sawant">
          </div>
          <div class="field">
            <label>Mobile number <span class="req">*</span></label>
            <input type="text" id="df-phone" placeholder="+91 98230 11221">
          </div>
          <div class="field">
            <label>Licence number <span class="req">*</span></label>
            <input type="text" id="df-lic" placeholder="MH1220140001234">
          </div>
          <div class="field">
            <label>Licence expiry</label>
            <input type="date" id="df-licexp">
          </div>
          <div class="field">
            <label>Badge number</label>
            <input type="text" id="df-badge" placeholder="Badge-PNQ-0000">
          </div>
          <div class="field">
            <label>Experience (years)</label>
            <input type="number" id="df-exp" min="0" max="60" value="0">
          </div>
          <div class="field">
            <label>Vendor</label>
            <select id="df-vendor"><option value="">-- own fleet --</option>
              ${this.lookups.vendors.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Assigned vehicle</label>
            <select id="df-veh"><option value="">-- unassigned --</option>
              ${this.lookups.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="df-status">
              ${['active', 'on-leave', 'suspended', 'exited'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Address</label>
            <input type="text" id="df-addr" placeholder="Pune, Maharashtra">
          </div>
        </div>
        <div class="field error" id="df-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="df-save">${editing ? 'Save driver' : 'Add driver'}</button>`,
    });

    if (editing) {
      Api.get(`/drivers/${id}`).then(({ data: d }) => {
        document.getElementById('df-name', modal.el).value = d.name;
        document.getElementById('df-phone', modal.el).value = d.phone;
        document.getElementById('df-lic', modal.el).value = d.licenceNo;
        document.getElementById('df-licexp', modal.el).value = d.licenceExpiry || '';
        document.getElementById('df-badge', modal.el).value = d.badge || '';
        document.getElementById('df-exp', modal.el).value = d.experience || 0;
        document.getElementById('df-vendor', modal.el).value = d.vendorId || '';
        document.getElementById('df-veh', modal.el).value = d.assignedVehicleId || '';
        document.getElementById('df-status', modal.el).value = d.status;
        document.getElementById('df-addr', modal.el).value = d.address || '';
      });
    }

    document.getElementById('df-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('df-error', modal.el);
      errBox.style.display = 'none';
      const payload = {
        name: document.getElementById('df-name', modal.el).value.trim(),
        phone: document.getElementById('df-phone', modal.el).value.trim(),
        licenceNo: document.getElementById('df-lic', modal.el).value.trim(),
        licenceExpiry: document.getElementById('df-licexp', modal.el).value || null,
        badge: document.getElementById('df-badge', modal.el).value.trim(),
        experience: Number(document.getElementById('df-exp', modal.el).value || 0),
        vendorId: document.getElementById('df-vendor', modal.el).value || null,
        assignedVehicleId: document.getElementById('df-veh', modal.el).value || null,
        status: document.getElementById('df-status', modal.el).value,
        address: document.getElementById('df-addr', modal.el).value.trim(),
      };

      try {
        if (editing) await Api.put(`/drivers/${id}`, payload);
        else await Api.post('/drivers', payload);
        Toast.ok(editing ? 'Driver updated.' : 'Driver added to roster.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Remove driver ${id} from the roster?`, { title: 'Delete driver', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/drivers/${id}`);
      Toast.ok('Driver removed.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
