'use strict';

/* ==========================================================================
   Vendors, maintenance, fuel, expenses, documents and incidents
   ========================================================================== */

/* --------------------------------------------------------------------------
   Vendors
   -------------------------------------------------------------------------- */

const VendorsPage = {
  async render(container) {
    const { data } = await Api.get('/vendors');
    container.innerHTML = `
      ${Api.canWrite ? '<div class="toolbar"><div class="spacer"></div><button class="btn primary" id="vn-new">+ Add Vendor</button></div>' : ''}
      <div class="grid cols-2" style="margin-bottom:18px">
        ${data.map((v) => `
          <div class="card" style="margin-bottom:0">
            <div class="card-head">
              <h3>${escapeHtml(v.name)}</h3>
              <div class="spacer"></div>
              ${statusPill(v.status)}
            </div>
            <div class="card-body">
              <div class="grid cols-2" style="gap:0 14px">
                <div class="kv">
                  <dt>Contact</dt><dd>${escapeHtml(v.contact)}</dd>
                  <dt>Phone</dt><dd class="mono">${escapeHtml(v.phone)}</dd>
                  <dt>GSTIN</dt><dd class="mono" style="font-size:11.5px">${escapeHtml(v.gstin || '-')}</dd>
                  <dt>Contract till</dt><dd>${Fmt.date(v.contractTill)}</dd>
                </div>
                <div class="kv">
                  <dt>Vehicles</dt><dd>${v.vehicleCount}</dd>
                  <dt>Drivers</dt><dd>${v.driverCount}</dd>
                  <dt>Trips serviced</dt><dd>${Fmt.num(v.tripsServiced)}</dd>
                  <dt>Billed to date</dt><dd>${Fmt.money(v.billedToDate)}</dd>
                </div>
              </div>
              <div class="divider"></div>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="text-muted" style="font-size:12px">Rating</span>
                <div class="bar-track" style="flex:1"><div class="bar-fill ${v.rating >= 4.5 ? 'ok' : v.rating >= 4 ? 'warn' : 'danger'}" style="width:${(v.rating / 5) * 100}%"></div></div>
                <span class="strong" style="font-size:12.5px">${Number(v.rating).toFixed(1)} / 5</span>
              </div>
              ${v.vehicles.length ? `<div style="margin-top:12px"><span class="text-muted" style="font-size:12px">Fleet: </span>${v.vehicles.map((x) => `<span class="pill muted" style="margin:2px">${escapeHtml(x.regNo)}</span>`).join('')}</div>` : ''}
              ${Api.canWrite ? `<div style="margin-top:14px;display:flex;gap:8px">
                <button class="btn sm" onclick="VendorsPage.openForm('${v.id}')">Edit</button>
                <button class="btn sm danger" onclick="VendorsPage.remove('${v.id}')">Delete</button>
              </div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    `;
    const nb = document.getElementById('vn-new');
    if (nb) nb.addEventListener('click', () => this.openForm());
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit vendor ${id}` : 'Add a transport vendor',
      body: `
        <div class="form-grid">
          <div class="field span-2">
            <label>Vendor name <span class="req">*</span></label>
            <input type="text" id="vf2-name" placeholder="Sai Travels">
          </div>
          <div class="field">
            <label>Contact person <span class="req">*</span></label>
            <input type="text" id="vf2-contact" placeholder="Mahesh Patil">
          </div>
          <div class="field">
            <label>Phone <span class="req">*</span></label>
            <input type="text" id="vf2-phone" placeholder="+91 98220 41122">
          </div>
          <div class="field">
            <label>GSTIN</label>
            <input type="text" id="vf2-gst" placeholder="27AABCS1429P1ZQ">
          </div>
          <div class="field">
            <label>Rating (0-5)</label>
            <input type="number" id="vf2-rating" min="0" max="5" step="0.1" value="4">
          </div>
          <div class="field">
            <label>Contract valid till</label>
            <input type="date" id="vf2-till">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="vf2-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </div>
        </div>
        <div class="field error" id="vf2-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="vf2-save">${editing ? 'Save vendor' : 'Add vendor'}</button>`,
    });

    if (editing) {
      Api.get(`/vendors/${id}`).then(({ data: v }) => {
        document.getElementById('vf2-name', modal.el).value = v.name;
        document.getElementById('vf2-contact', modal.el).value = v.contact;
        document.getElementById('vf2-phone', modal.el).value = v.phone;
        document.getElementById('vf2-gst', modal.el).value = v.gstin || '';
        document.getElementById('vf2-rating', modal.el).value = v.rating;
        document.getElementById('vf2-till', modal.el).value = v.contractTill || '';
        document.getElementById('vf2-status', modal.el).value = v.status;
      });
    }

    document.getElementById('vf2-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('vf2-error', modal.el);
      const payload = {
        name: document.getElementById('vf2-name', modal.el).value.trim(),
        contact: document.getElementById('vf2-contact', modal.el).value.trim(),
        phone: document.getElementById('vf2-phone', modal.el).value.trim(),
        gstin: document.getElementById('vf2-gst', modal.el).value.trim(),
        rating: Number(document.getElementById('vf2-rating', modal.el).value || 0),
        contractTill: document.getElementById('vf2-till', modal.el).value || null,
        status: document.getElementById('vf2-status', modal.el).value,
      };
      try {
        if (editing) await Api.put(`/vendors/${id}`, payload);
        else await Api.post('/vendors', payload);
        Toast.ok(editing ? 'Vendor updated.' : 'Vendor added.');
        modal.close();
        App.route();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog('Delete this vendor? Vehicles and drivers linked to it will need reassignment.', {
      title: 'Delete vendor', confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await Api.del(`/vendors/${id}`);
      Toast.ok('Vendor deleted.');
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Maintenance
   -------------------------------------------------------------------------- */

const MaintenancePage = {
  state: { search: '', status: 'all', type: 'all' },
  vehicles: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const vehicles = await Api.get('/vehicles');
    this.vehicles = vehicles.data;

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="mt-search" placeholder="Search job, workshop..." value="${escapeHtml(this.state.search)}"></div>
        <select id="mt-status">
          <option value="all">All statuses</option>
          ${['scheduled', 'in-progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <select id="mt-type">
          <option value="all">All job types</option>
          ${['scheduled-service', 'repair', 'tyre', 'breakdown', 'inspection', 'bodywork'].map((t) => `<option value="${t}" ${this.state.type === t ? 'selected' : ''}>${Fmt.titleCase(t)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/maintenance.csv?from=${todayIso(-180)}&to=${todayIso(30)}', 'maintenance.csv').then(()=>Toast.ok('Maintenance log exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="mt-new">+ Log Job</button>' : ''}
      </div>
      <div class="grid cols-4" style="margin-bottom:18px" id="mt-stats"></div>
      <div class="card">
        <div class="card-head"><h3>Workshop Job Register</h3><span class="desc" id="mt-count"></span></div>
        <div class="card-body tight" id="mt-table"></div>
      </div>
    `;

    document.getElementById('mt-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('mt-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    document.getElementById('mt-type').addEventListener('change', (e) => { this.state.type = e.target.value; this.load(); });
    const nb = document.getElementById('mt-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.type !== 'all') params.set('type', this.state.type);

    const { data } = await Api.get(`/maintenance?${params}`);
    const all = data;
    const spent = all.filter((m) => m.status === 'completed').reduce((a, m) => a + Number(m.cost || 0), 0);
    const open = all.filter((m) => m.status !== 'completed' && m.status !== 'cancelled');

    document.getElementById('mt-stats').innerHTML = `
      <div class="stat"><div class="label">Jobs Logged</div><div class="value">${all.length}</div></div>
      <div class="stat warn"><div class="label">Open Jobs</div><div class="value">${open.length}</div><div class="foot">${open.filter((m) => m.overdue).length} overdue</div></div>
      <div class="stat info"><div class="label">Spend (filtered)</div><div class="value" style="font-size:21px">${Fmt.compactMoney(spent)}</div></div>
      <div class="stat ok"><div class="label">Avg Job Cost</div><div class="value" style="font-size:21px">${Fmt.compactMoney(all.length ? spent / Math.max(1, all.filter((m) => m.status === 'completed').length) : 0)}</div></div>
    `;
    document.getElementById('mt-count').textContent = `${all.length} jobs`;

    document.getElementById('mt-table').innerHTML = renderTable({
      rows: all,
      emptyTitle: 'No maintenance jobs found',
      columns: [
        { key: 'date', label: 'Date', render: (r) => `${Fmt.date(r.date)}${r.overdue ? ' <span class="pill danger">overdue</span>' : ''}` },
        { key: 'id', label: 'Job', cls: 'mono' },
        { key: 'vehicleRegNo', label: 'Vehicle', render: (r) => `<span class="mono strong">${escapeHtml(r.vehicleRegNo)}</span><div class="muted">${escapeHtml(r.vehicleModel || '')}</div>` },
        { key: 'type', label: 'Type', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.type))}</span>` },
        { key: 'description', label: 'Job Description' },
        { key: 'workshop', label: 'Workshop' },
        { key: 'odometer', label: 'Odometer', align: 'right', render: (r) => r.odometer ? `${Fmt.num(r.odometer)} km` : '-' },
        { key: 'cost', label: 'Cost', align: 'right', render: (r) => Fmt.money(r.cost) },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => {
        if (!Api.canWrite) return '';
        const btns = [`<button class="btn sm" onclick="MaintenancePage.openForm('${r.id}')" title="Edit job">&#9998;</button>`];
        if (r.status !== 'completed') btns.push(`<button class="btn sm success" onclick="MaintenancePage.complete('${r.id}')" title="Mark completed">&#10003;</button>`);
        btns.push(`<button class="btn sm danger" onclick="MaintenancePage.remove('${r.id}')" title="Delete">&#128465;</button>`);
        return btns.join('');
      },
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit maintenance job ${id}` : 'Log a workshop job',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Vehicle <span class="req">*</span></label>
            <select id="mf-veh">${this.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Job type <span class="req">*</span></label>
            <select id="mf-type">
              ${['scheduled-service', 'repair', 'tyre', 'breakdown', 'inspection', 'bodywork'].map((t) => `<option value="${t}">${Fmt.titleCase(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Date <span class="req">*</span></label>
            <input type="date" id="mf-date" value="${todayIso()}">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="mf-status">
              ${['scheduled', 'in-progress', 'completed', 'cancelled'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field span-2">
            <label>Description <span class="req">*</span></label>
            <input type="text" id="mf-desc" placeholder="Full service, oil and filter change">
          </div>
          <div class="field">
            <label>Workshop / vendor</label>
            <input type="text" id="mf-shop" placeholder="Tata Authorised - Wakad">
          </div>
          <div class="field">
            <label>Cost (\u20B9)</label>
            <input type="number" id="mf-cost" min="0" step="1" value="0">
          </div>
          <div class="field">
            <label>Odometer at service (km)</label>
            <input type="number" id="mf-odo" min="0" step="1" placeholder="Optional">
          </div>
        </div>
        <div class="field error" id="mf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="mf-save">${editing ? 'Save job' : 'Log job'}</button>`,
    });

    if (editing) {
      Api.get(`/maintenance/${id}`).then(({ data: m }) => {
        document.getElementById('mf-veh', modal.el).value = m.vehicleId;
        document.getElementById('mf-type', modal.el).value = m.type;
        document.getElementById('mf-date', modal.el).value = m.date;
        document.getElementById('mf-status', modal.el).value = m.status;
        document.getElementById('mf-desc', modal.el).value = m.description;
        document.getElementById('mf-shop', modal.el).value = m.workshop || '';
        document.getElementById('mf-cost', modal.el).value = m.cost || 0;
        document.getElementById('mf-odo', modal.el).value = m.odometer || '';
      });
    }

    document.getElementById('mf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('mf-error', modal.el);
      const odo = document.getElementById('mf-odo', modal.el).value;
      const payload = {
        vehicleId: document.getElementById('mf-veh', modal.el).value,
        type: document.getElementById('mf-type', modal.el).value,
        date: document.getElementById('mf-date', modal.el).value,
        status: document.getElementById('mf-status', modal.el).value,
        description: document.getElementById('mf-desc', modal.el).value.trim(),
        workshop: document.getElementById('mf-shop', modal.el).value.trim(),
        cost: Number(document.getElementById('mf-cost', modal.el).value || 0),
        odometer: odo ? Number(odo) : null,
      };
      try {
        if (editing) await Api.put(`/maintenance/${id}`, payload);
        else await Api.post('/maintenance', payload);
        Toast.ok(editing ? 'Job updated.' : 'Workshop job logged.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async complete(id) {
    const modal = openModal({
      title: `Close job ${id}`,
      body: `
        <p class="text-muted" style="font-size:13px">Enter the final invoice amount to close this job.</p>
        <div class="field">
          <label>Final cost (\u20B9) <span class="req">*</span></label>
          <input type="number" id="mc-cost" min="0" step="1" required>
        </div>
        <div class="field error" id="mc-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn success" id="mc-save">Mark completed</button>`,
    });

    Api.get(`/maintenance/${id}`).then(({ data: m }) => {
      document.getElementById('mc-cost', modal.el).value = m.cost || 0;
    });

    document.getElementById('mc-save', modal.el).addEventListener('click', async () => {
      const cost = Number(document.getElementById('mc-cost', modal.el).value);
      if (!cost && cost !== 0) return;
      try {
        await Api.put(`/maintenance/${id}`, { status: 'completed', cost });
        Toast.ok(`Job ${id} closed.`);
        modal.close();
        this.load();
      } catch (err) {
        Toast.error(err.message);
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Delete maintenance job ${id}?`, { title: 'Delete job', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/maintenance/${id}`);
      Toast.ok('Job deleted.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Fuel & energy
   -------------------------------------------------------------------------- */

const FuelPage = {
  state: { search: '', vehicleId: 'all', paymentMode: 'all', from: '', to: '' },
  vehicles: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const vehicles = await Api.get('/vehicles');
    this.vehicles = vehicles.data;

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="fl-search" placeholder="Search station..." value="${escapeHtml(this.state.search)}"></div>
        <select id="fl-veh">
          <option value="all">All vehicles</option>
          ${this.vehicles.map((v) => `<option value="${v.id}" ${this.state.vehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.regNo)}</option>`).join('')}
        </select>
        <select id="fl-mode">
          <option value="all">All payment modes</option>
          ${['fuel-card', 'cash', 'credit', 'vendor'].map((m) => `<option value="${m}" ${this.state.paymentMode === m ? 'selected' : ''}>${Fmt.titleCase(m)}</option>`).join('')}
        </select>
        <input type="date" id="fl-from" value="${escapeHtml(this.state.from)}" style="padding:8px 11px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:13px">
        <input type="date" id="fl-to" value="${escapeHtml(this.state.to)}" style="padding:8px 11px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:13px">
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/fuel.csv?from=${todayIso(-90)}&to=${todayIso()}', 'fuel-register.csv').then(()=>Toast.ok('Fuel register exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="fl-new">+ Record Fill</button>' : ''}
      </div>
      <div class="grid cols-4" style="margin-bottom:18px" id="fl-stats"></div>
      <div class="card">
        <div class="card-head"><h3>Fuel &amp; Charging Register</h3><span class="desc" id="fl-count"></span></div>
        <div class="card-body tight" id="fl-table"></div>
      </div>
    `;

    document.getElementById('fl-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('fl-veh').addEventListener('change', (e) => { this.state.vehicleId = e.target.value; this.load(); });
    document.getElementById('fl-mode').addEventListener('change', (e) => { this.state.paymentMode = e.target.value; this.load(); });
    document.getElementById('fl-from').addEventListener('change', (e) => { this.state.from = e.target.value; this.load(); });
    document.getElementById('fl-to').addEventListener('change', (e) => { this.state.to = e.target.value; this.load(); });
    const nb = document.getElementById('fl-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.vehicleId !== 'all') params.set('vehicleId', this.state.vehicleId);
    if (this.state.paymentMode !== 'all') params.set('paymentMode', this.state.paymentMode);
    if (this.state.from) params.set('from', this.state.from);
    if (this.state.to) params.set('to', this.state.to);

    const { data } = await Api.get(`/fuel?${params}`);
    const litres = data.reduce((a, f) => a + Number(f.litres || 0), 0);
    const spend = data.reduce((a, f) => a + Number(f.amount || 0), 0);

    document.getElementById('fl-stats').innerHTML = `
      <div class="stat"><div class="label">Transactions</div><div class="value">${data.length}</div></div>
      <div class="stat info"><div class="label">Total Volume</div><div class="value">${Fmt.num(litres, 1)}<small> L/kg</small></div></div>
      <div class="stat warn"><div class="label">Total Spend</div><div class="value" style="font-size:21px">${Fmt.compactMoney(spend)}</div></div>
      <div class="stat ok"><div class="label">Avg Rate</div><div class="value">${litres ? '\u20B9' + (spend / litres).toFixed(2) : '-'}</div><div class="foot">per litre / kg</div></div>
    `;
    document.getElementById('fl-count').textContent = `${data.length} transactions`;

    document.getElementById('fl-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No fuel records',
      columns: [
        { key: 'date', label: 'Date', render: (r) => Fmt.date(r.date) },
        { key: 'vehicleRegNo', label: 'Vehicle', render: (r) => `<span class="mono strong">${escapeHtml(r.vehicleRegNo)}</span><div class="muted">${escapeHtml(Fmt.titleCase(r.fuelType))}</div>` },
        { key: 'litres', label: 'Quantity', align: 'right', render: (r) => `${Fmt.num(r.litres, 1)} ${r.fuelType === 'electric' ? 'kWh' : 'L'}` },
        { key: 'rate', label: 'Rate', align: 'right', render: (r) => `\u20B9${Fmt.num(r.rate, 2)}` },
        { key: 'amount', label: 'Amount', align: 'right', render: (r) => `<span class="strong">${Fmt.money(r.amount)}</span>` },
        { key: 'odometer', label: 'Odometer', align: 'right', render: (r) => r.odometer ? `${Fmt.num(r.odometer)} km` : '-' },
        { key: 'station', label: 'Station' },
        { key: 'paymentMode', label: 'Payment', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.paymentMode))}</span>` },
      ],
      rowActions: Api.canWrite
        ? (r) => `<button class="btn sm" onclick="FuelPage.openForm('${r.id}')">&#9998;</button>
                   <button class="btn sm danger" onclick="FuelPage.remove('${r.id}')">&#128465;</button>`
        : null,
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit fuel entry ${id}` : 'Record a fuel / charging fill',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Vehicle <span class="req">*</span></label>
            <select id="ff-veh">${this.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(Fmt.titleCase(v.fuelType))}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Date <span class="req">*</span></label>
            <input type="date" id="ff-date" value="${todayIso()}">
          </div>
          <div class="field">
            <label>Quantity (litres / kWh) <span class="req">*</span></label>
            <input type="number" id="ff-litres" min="0" step="0.1" value="0">
          </div>
          <div class="field">
            <label>Rate per unit (\u20B9) <span class="req">*</span></label>
            <input type="number" id="ff-rate" min="0" step="0.01" value="89.70">
          </div>
          <div class="field">
            <label>Amount (\u20B9) <span class="hint">auto-calculated</span></label>
            <input type="number" id="ff-amount" min="0" step="0.01" readonly>
          </div>
          <div class="field">
            <label>Odometer (km)</label>
            <input type="number" id="ff-odo" min="0" step="1" placeholder="Optional">
          </div>
          <div class="field">
            <label>Station / pump</label>
            <input type="text" id="ff-station" placeholder="HP Petrol Pump, Wakad">
          </div>
          <div class="field">
            <label>Payment mode</label>
            <select id="ff-mode">
              ${['fuel-card', 'cash', 'credit', 'vendor'].map((m) => `<option value="${m}">${Fmt.titleCase(m)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field error" id="ff-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="ff-save">${editing ? 'Save entry' : 'Record fill'}</button>`,
    });

    const litresEl = document.getElementById('ff-litres', modal.el);
    const rateEl = document.getElementById('ff-rate', modal.el);
    const amountEl = document.getElementById('ff-amount', modal.el);
    const recalc = () => { amountEl.value = (Number(litresEl.value || 0) * Number(rateEl.value || 0)).toFixed(2); };
    litresEl.addEventListener('input', recalc);
    rateEl.addEventListener('input', recalc);

    if (editing) {
      Api.get(`/fuel/${id}`).then(({ data: f }) => {
        document.getElementById('ff-veh', modal.el).value = f.vehicleId;
        document.getElementById('ff-date', modal.el).value = f.date;
        litresEl.value = f.litres;
        rateEl.value = f.rate;
        amountEl.value = f.amount;
        document.getElementById('ff-odo', modal.el).value = f.odometer || '';
        document.getElementById('ff-station', modal.el).value = f.station || '';
        document.getElementById('ff-mode', modal.el).value = f.paymentMode;
      });
    } else {
      recalc();
    }

    document.getElementById('ff-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('ff-error', modal.el);
      const odo = document.getElementById('ff-odo', modal.el).value;
      const payload = {
        vehicleId: document.getElementById('ff-veh', modal.el).value,
        date: document.getElementById('ff-date', modal.el).value,
        litres: Number(litresEl.value || 0),
        rate: Number(rateEl.value || 0),
        amount: Number(amountEl.value || 0),
        odometer: odo ? Number(odo) : null,
        station: document.getElementById('ff-station', modal.el).value.trim(),
        paymentMode: document.getElementById('ff-mode', modal.el).value,
      };
      try {
        if (editing) await Api.put(`/fuel/${id}`, payload);
        else await Api.post('/fuel', payload);
        Toast.ok(editing ? 'Fuel entry updated.' : 'Fuel fill recorded.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Delete fuel entry ${id}?`, { title: 'Delete entry', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/fuel/${id}`);
      Toast.ok('Fuel entry deleted.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Expenses
   -------------------------------------------------------------------------- */

const ExpensesPage = {
  state: { search: '', category: 'all', month: 'all', status: 'all' },
  summary: null,

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const summary = await Api.get('/expenses/summary');
    this.summary = summary.data;

    container.innerHTML = `
      <div class="grid cols-4" style="margin-bottom:18px" id="ex-stats"></div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h3>Monthly Operating Cost</h3><span class="desc">Split by paid and pending</span></div>
          <div class="card-body">
            <div class="chart" id="ex-chart"></div>
            <div class="chart-legend">
              <span><i style="background:#15803d"></i> Paid</span>
              <span><i style="background:#f59e0b"></i> Pending</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Cost by Category</h3><span class="desc">Across all recorded months</span></div>
          <div class="card-body" id="ex-cat"></div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search"><input type="text" id="ex-search" placeholder="Search description..." value="${escapeHtml(this.state.search)}"></div>
        <select id="ex-month">
          <option value="all">All months</option>
          ${this.summary.months.map((m) => `<option value="${m.month}" ${this.state.month === m.month ? 'selected' : ''}>${escapeHtml(m.month)}</option>`).join('')}
        </select>
        <select id="ex-cat-sel">
          <option value="all">All categories</option>
          ${this.summary.byCategory.map((c) => `<option value="${c.category}" ${this.state.category === c.category ? 'selected' : ''}>${Fmt.titleCase(c.category)}</option>`).join('')}
        </select>
        <select id="ex-status">
          <option value="all">All statuses</option>
          ${['pending', 'approved', 'paid', 'rejected'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/expenses.csv', 'expenses.csv').then(()=>Toast.ok('Expense ledger exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="ex-new">+ Add Expense</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Expense Ledger</h3><span class="desc" id="ex-count"></span></div>
        <div class="card-body tight" id="ex-table"></div>
      </div>
    `;

    document.getElementById('ex-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('ex-month').addEventListener('change', (e) => { this.state.month = e.target.value; this.load(); });
    document.getElementById('ex-cat-sel').addEventListener('change', (e) => { this.state.category = e.target.value; this.load(); });
    document.getElementById('ex-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    const nb = document.getElementById('ex-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    this.renderCharts();
    await this.load();
  },

  renderCharts() {
    const s = this.summary;
    document.getElementById('ex-stats').innerHTML = `
      <div class="stat"><div class="label">Grand Total</div><div class="value" style="font-size:21px">${Fmt.compactMoney(s.grandTotal)}</div><div class="foot">${s.months.length} months recorded</div></div>
      <div class="stat info"><div class="label">Monthly Average</div><div class="value" style="font-size:21px">${Fmt.compactMoney(s.averageMonthly)}</div></div>
      <div class="stat warn"><div class="label">Pending Approval</div><div class="value" style="font-size:21px">${Fmt.compactMoney(s.months.reduce((a, m) => a + m.pending, 0))}</div></div>
      <div class="stat ok"><div class="label">Largest Category</div><div class="value" style="font-size:19px">${s.byCategory[0] ? escapeHtml(Fmt.titleCase(s.byCategory[0].category)) : '-'}</div><div class="foot">${s.byCategory[0] ? Fmt.compactMoney(s.byCategory[0].total) : ''}</div></div>
    `;

    document.getElementById('ex-chart').innerHTML = Chart.bars(
      s.months.map((m) => ({ label: m.month, values: [m.paid, m.pending] })),
      { series: ['Paid', 'Pending'], colors: ['#15803d', '#f59e0b'], height: 215 },
    );

    const colors = { 'driver-salary': '#1a80c4', 'vendor-hire': '#7c3aed', fuel: '#f59e0b', maintenance: '#b91c1c', toll: '#0891b2', insurance: '#15803d', misc: '#64748b' };
    document.getElementById('ex-cat').innerHTML = Chart.donut(
      s.byCategory.map((c) => ({ label: Fmt.titleCase(c.category), value: c.total, color: colors[c.category] || '#94a3b8' })),
      { centre: Fmt.compactMoney(s.grandTotal) },
    );
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.category !== 'all') params.set('category', this.state.category);
    if (this.state.month !== 'all') params.set('month', this.state.month);
    if (this.state.status !== 'all') params.set('status', this.state.status);

    const { data } = await Api.get(`/expenses?${params}`);
    const total = data.reduce((a, e) => a + Number(e.amount || 0), 0);
    document.getElementById('ex-count').textContent = `${data.length} entries \u00B7 ${Fmt.money(total)}`;

    document.getElementById('ex-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No expense entries',
      columns: [
        { key: 'month', label: 'Month', cls: 'mono' },
        { key: 'category', label: 'Category', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.category))}</span>` },
        { key: 'description', label: 'Description' },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'amount', label: 'Amount', align: 'right', render: (r) => `<span class="strong">${Fmt.money(r.amount)}</span>` },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
        { key: 'approvedBy', label: 'Approved By', render: (r) => r.approvedBy ? `<span class="mono" style="font-size:11.5px">${escapeHtml(r.approvedBy)}</span>` : '<span class="muted">-</span>' },
      ],
      rowActions: Api.canWrite
        ? (r) => {
            const btns = [`<button class="btn sm" onclick="ExpensesPage.openForm('${r.id}')" title="Edit">&#9998;</button>`];
            if (r.status === 'pending') btns.push(`<button class="btn sm success" onclick="ExpensesPage.approve('${r.id}')" title="Mark paid">&#10003;</button>`);
            btns.push(`<button class="btn sm danger" onclick="ExpensesPage.remove('${r.id}')" title="Delete">&#128465;</button>`);
            return btns.join('');
          }
        : null,
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit expense ${id}` : 'Add an expense entry',
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Month <span class="req">*</span></label>
            <input type="month" id="xf-month" value="${todayIso().slice(0, 7)}">
          </div>
          <div class="field">
            <label>Category <span class="req">*</span></label>
            <select id="xf-cat">
              ${['driver-salary', 'vendor-hire', 'fuel', 'maintenance', 'toll', 'insurance', 'misc'].map((c) => `<option value="${c}">${Fmt.titleCase(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field span-2">
            <label>Description</label>
            <input type="text" id="xf-desc" placeholder="Monthly vendor hire charges">
          </div>
          <div class="field">
            <label>Amount (\u20B9) <span class="req">*</span></label>
            <input type="number" id="xf-amt" min="0" step="0.01" value="0">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="xf-status">
              ${['pending', 'approved', 'paid', 'rejected'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field error" id="xf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="xf-save">${editing ? 'Save entry' : 'Add entry'}</button>`,
    });

    if (editing) {
      Api.get(`/expenses/${id}`).then(({ data: e }) => {
        document.getElementById('xf-month', modal.el).value = e.month;
        document.getElementById('xf-cat', modal.el).value = e.category;
        document.getElementById('xf-desc', modal.el).value = e.description || '';
        document.getElementById('xf-amt', modal.el).value = e.amount;
        document.getElementById('xf-status', modal.el).value = e.status;
      });
    }

    document.getElementById('xf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('xf-error', modal.el);
      const payload = {
        month: document.getElementById('xf-month', modal.el).value,
        category: document.getElementById('xf-cat', modal.el).value,
        description: document.getElementById('xf-desc', modal.el).value.trim(),
        amount: Number(document.getElementById('xf-amt', modal.el).value || 0),
        status: document.getElementById('xf-status', modal.el).value,
      };
      try {
        if (editing) await Api.put(`/expenses/${id}`, payload);
        else await Api.post('/expenses', payload);
        Toast.ok(editing ? 'Expense updated.' : 'Expense added.');
        modal.close();
        App.route();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async approve(id) {
    try {
      await Api.post(`/expenses/${id}/approve`, { status: 'paid' });
      Toast.ok(`Expense ${id} marked paid.`);
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async remove(id) {
    const ok = await confirmDialog(`Delete expense ${id}?`, { title: 'Delete expense', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/expenses/${id}`);
      Toast.ok('Expense deleted.');
      App.route();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Compliance documents
   -------------------------------------------------------------------------- */

const DocumentsPage = {
  state: { search: '', type: 'all', vehicleId: 'all', window: 45 },
  vehicles: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const vehicles = await Api.get('/vehicles');
    this.vehicles = vehicles.data;

    container.innerHTML = `
      <div class="card" style="border-left:3px solid var(--danger-600)">
        <div class="card-head">
          <h3>Compliance Radar</h3>
          <span class="desc">Documents already expired or expiring soon</span>
          <div class="spacer"></div>
          <select id="dc-window" style="padding:6px 10px">
            ${[15, 30, 45, 90, 180].map((w) => `<option value="${w}" ${this.state.window === w ? 'selected' : ''}>Next ${w} days</option>`).join('')}
          </select>
        </div>
        <div class="card-body tight" id="dc-alerts"></div>
      </div>

      <div class="toolbar">
        <div class="search"><input type="text" id="dc-search" placeholder="Search document number, issuer..." value="${escapeHtml(this.state.search)}"></div>
        <select id="dc-type">
          <option value="all">All document types</option>
          ${['insurance', 'permit', 'puc', 'fitness', 'road-tax', 'contract'].map((t) => `<option value="${t}" ${this.state.type === t ? 'selected' : ''}>${Fmt.titleCase(t)}</option>`).join('')}
        </select>
        <select id="dc-veh">
          <option value="all">All vehicles</option>
          ${this.vehicles.map((v) => `<option value="${v.id}" ${this.state.vehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.regNo)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/compliance.csv', 'compliance.csv').then(()=>Toast.ok('Compliance register exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="dc-new">+ Add Document</button>' : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>Document Register</h3><span class="desc" id="dc-count"></span></div>
        <div class="card-body tight" id="dc-table"></div>
      </div>
    `;

    document.getElementById('dc-window').addEventListener('change', (e) => { this.state.window = Number(e.target.value); this.loadAlerts(); });
    document.getElementById('dc-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('dc-type').addEventListener('change', (e) => { this.state.type = e.target.value; this.load(); });
    document.getElementById('dc-veh').addEventListener('change', (e) => { this.state.vehicleId = e.target.value; this.load(); });
    const nb = document.getElementById('dc-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await Promise.all([this.loadAlerts(), this.load()]);
  },

  async loadAlerts() {
    const { data, meta } = await Api.get(`/documents/alerts?window=${this.state.window}`);
    const el = document.getElementById('dc-alerts');
    if (!data.length) {
      el.innerHTML = '<div class="empty" style="padding:28px"><div class="ico">&#9989;</div><h4>No alerts in this window</h4><p>Every tracked document is valid beyond the selected period.</p></div>';
      return;
    }
    el.innerHTML = data.map((a) => {
      const tone = a.severity === 'expired' ? 'danger' : a.severity === 'critical' ? 'warn' : 'muted';
      const text = a.daysLeft < 0 ? `expired ${Math.abs(a.daysLeft)} days ago` : `${a.daysLeft} days left`;
      return `<div class="alert-row">
        <span class="pill ${tone}">${escapeHtml(a.severity)}</span>
        <span class="mono strong" style="font-size:12.5px">${escapeHtml(a.vehicleRegNo)}</span>
        <span>${escapeHtml(a.title)} <span class="muted mono" style="font-size:11.5px">${escapeHtml(a.number)}</span></span>
        <span class="when ${token(tone)}">${Fmt.date(a.expiryDate)} \u00B7 ${text}</span>
      </div>`;
    }).join('');
    void meta;
    function token(t) { return t === 'danger' ? 'text-danger' : t === 'warn' ? 'text-warn' : 'text-muted'; }
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.type !== 'all') params.set('type', this.state.type);
    if (this.state.vehicleId !== 'all') params.set('vehicleId', this.state.vehicleId);

    const { data } = await Api.get(`/documents?${params}`);
    const expired = data.filter((d) => d.status === 'expired').length;
    const expiring = data.filter((d) => d.status === 'expiring').length;
    document.getElementById('dc-count').textContent = `${data.length} documents \u00B7 ${expired} expired \u00B7 ${expiring} expiring`;

    document.getElementById('dc-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No documents on file',
      columns: [
        { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono strong' },
        { key: 'title', label: 'Document' },
        { key: 'type', label: 'Type', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.type))}</span>` },
        { key: 'number', label: 'Number', cls: 'mono' },
        { key: 'issuedBy', label: 'Issued By' },
        { key: 'issueDate', label: 'Issued', render: (r) => Fmt.date(r.issueDate) },
        { key: 'expiryDate', label: 'Expires', render: (r) => `<span class="strong">${Fmt.date(r.expiryDate)}</span><div class="muted">${r.daysLeft < 0 ? Math.abs(r.daysLeft) + 'd overdue' : r.daysLeft + 'd left'}</div>` },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: Api.canWrite
        ? (r) => `<button class="btn sm" onclick="DocumentsPage.openForm('${r.id}')" title="Edit">&#9998;</button>
                   <button class="btn sm danger" onclick="DocumentsPage.remove('${r.id}')" title="Delete">&#128465;</button>`
        : null,
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit document ${id}` : 'Add a compliance document',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Vehicle <span class="req">*</span></label>
            <select id="df3-veh">${this.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Document type <span class="req">*</span></label>
            <select id="df3-type">
              ${[['insurance', 'Comprehensive Insurance'], ['permit', 'State Transport Permit'], ['puc', 'Pollution Under Control'], ['fitness', 'Fitness Certificate'], ['road-tax', 'Road Tax Receipt'], ['contract', 'Vendor Contract']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="field span-2">
            <label>Document title <span class="req">*</span></label>
            <input type="text" id="df3-title" placeholder="Comprehensive Insurance">
          </div>
          <div class="field">
            <label>Document number</label>
            <input type="text" id="df3-num" placeholder="INS-AB4521">
          </div>
          <div class="field">
            <label>Issued by</label>
            <input type="text" id="df3-issuer" placeholder="ICICI Lombard">
          </div>
          <div class="field">
            <label>Issue date</label>
            <input type="date" id="df3-issued">
          </div>
          <div class="field">
            <label>Expiry date <span class="req">*</span></label>
            <input type="date" id="df3-expiry">
          </div>
          <div class="field span-2">
            <label>File reference <span class="hint">path or document vault reference</span></label>
            <input type="text" id="df3-file" placeholder="vault/MH-12-AB-4521/insurance.pdf">
          </div>
        </div>
        <div class="field error" id="df3-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="df3-save">${editing ? 'Save document' : 'Add document'}</button>`,
    });

    if (editing) {
      Api.get(`/documents/${id}`).then(({ data: d }) => {
        document.getElementById('df3-veh', modal.el).value = d.vehicleId;
        document.getElementById('df3-type', modal.el).value = d.type;
        document.getElementById('df3-title', modal.el).value = d.title;
        document.getElementById('df3-num', modal.el).value = d.number || '';
        document.getElementById('df3-issuer', modal.el).value = d.issuedBy || '';
        document.getElementById('df3-issued', modal.el).value = d.issueDate || '';
        document.getElementById('df3-expiry', modal.el).value = d.expiryDate || '';
        document.getElementById('df3-file', modal.el).value = d.fileRef || '';
      });
    }

    document.getElementById('df3-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('df3-error', modal.el);
      const payload = {
        vehicleId: document.getElementById('df3-veh', modal.el).value,
        type: document.getElementById('df3-type', modal.el).value,
        title: document.getElementById('df3-title', modal.el).value.trim(),
        number: document.getElementById('df3-num', modal.el).value.trim(),
        issuedBy: document.getElementById('df3-issuer', modal.el).value.trim(),
        issueDate: document.getElementById('df3-issued', modal.el).value || null,
        expiryDate: document.getElementById('df3-expiry', modal.el).value,
        fileRef: document.getElementById('df3-file', modal.el).value.trim(),
      };
      try {
        if (editing) await Api.put(`/documents/${id}`, payload);
        else await Api.post('/documents', payload);
        Toast.ok(editing ? 'Document updated.' : 'Document added to register.');
        modal.close();
        this.load();
        this.loadAlerts();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Delete document ${id} from the register?`, { title: 'Delete document', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/documents/${id}`);
      Toast.ok('Document deleted.');
      this.load();
      this.loadAlerts();
      App.loadAlertCounts();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

/* --------------------------------------------------------------------------
   Incidents & safety
   -------------------------------------------------------------------------- */

const IncidentsPage = {
  state: { search: '', type: 'all', severity: 'all', status: 'all' },
  vehicles: [],
  routes: [],

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const [vehicles, routes] = await Promise.all([Api.get('/vehicles'), Api.get('/routes')]);
    this.vehicles = vehicles.data;
    this.routes = routes.data;

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="in-search" placeholder="Search incident description..." value="${escapeHtml(this.state.search)}"></div>
        <select id="in-type">
          <option value="all">All types</option>
          ${['breakdown', 'accident', 'delay', 'complaint', 'safety', 'other'].map((t) => `<option value="${t}" ${this.state.type === t ? 'selected' : ''}>${Fmt.titleCase(t)}</option>`).join('')}
        </select>
        <select id="in-sev">
          <option value="all">All severities</option>
          ${['low', 'medium', 'high', 'critical'].map((s) => `<option value="${s}" ${this.state.severity === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <select id="in-status">
          <option value="all">All statuses</option>
          ${['open', 'under-review', 'closed'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/incidents.csv?from=${todayIso(-180)}&to=${todayIso()}', 'incidents.csv').then(()=>Toast.ok('Incident register exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="in-new">+ Report Incident</button>' : ''}
      </div>
      <div class="grid cols-4" style="margin-bottom:18px" id="in-stats"></div>
      <div class="card">
        <div class="card-head"><h3>Incident Register</h3><span class="desc" id="in-count"></span></div>
        <div class="card-body tight" id="in-table"></div>
      </div>
    `;

    document.getElementById('in-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('in-type').addEventListener('change', (e) => { this.state.type = e.target.value; this.load(); });
    document.getElementById('in-sev').addEventListener('change', (e) => { this.state.severity = e.target.value; this.load(); });
    document.getElementById('in-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    const nb = document.getElementById('in-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.type !== 'all') params.set('type', this.state.type);
    if (this.state.severity !== 'all') params.set('severity', this.state.severity);
    if (this.state.status !== 'all') params.set('status', this.state.status);

    const { data } = await Api.get(`/incidents?${params}`);

    document.getElementById('in-stats').innerHTML = `
      <div class="stat"><div class="label">Total Logged</div><div class="value">${data.length}</div></div>
      <div class="stat danger"><div class="label">Open</div><div class="value">${data.filter((i) => i.status === 'open').length}</div></div>
      <div class="stat warn"><div class="label">High / Critical</div><div class="value">${data.filter((i) => ['high', 'critical'].includes(i.severity)).length}</div></div>
      <div class="stat ok"><div class="label">Closed</div><div class="value">${data.filter((i) => i.status === 'closed').length}</div></div>
    `;
    document.getElementById('in-count').textContent = `${data.length} incidents`;

    document.getElementById('in-table').innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No incidents recorded',
      emptyText: 'The fleet has a clean safety record in this period.',
      columns: [
        { key: 'date', label: 'Date', render: (r) => Fmt.date(r.date) },
        { key: 'id', label: 'Ref', cls: 'mono' },
        { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono strong' },
        { key: 'routeName', label: 'Route', cls: 'mono' },
        { key: 'type', label: 'Type', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.type))}</span>` },
        { key: 'severity', label: 'Severity', render: (r) => severityPill(r.severity) },
        { key: 'description', label: 'Description' },
        { key: 'actionTaken', label: 'Action Taken', render: (r) => escapeHtml(r.actionTaken || 'Pending') },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: Api.canWrite
        ? (r) => {
            const btns = [`<button class="btn sm" onclick="IncidentsPage.openForm('${r.id}')" title="Edit">&#9998;</button>`];
            if (r.status !== 'closed') btns.push(`<button class="btn sm success" onclick="IncidentsPage.resolve('${r.id}')" title="Resolve">&#10003;</button>`);
            btns.push(`<button class="btn sm danger" onclick="IncidentsPage.remove('${r.id}')" title="Delete">&#128465;</button>`);
            return btns.join('');
          }
        : null,
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit incident ${id}` : 'Report an incident',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Date <span class="req">*</span></label>
            <input type="date" id="if-date" value="${todayIso()}">
          </div>
          <div class="field">
            <label>Vehicle <span class="req">*</span></label>
            <select id="if-veh">${this.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Route</label>
            <select id="if-route"><option value="">-- not route specific --</option>
              ${this.routes.map((r) => `<option value="${r.id}">${escapeHtml(r.code)} - ${escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Incident type <span class="req">*</span></label>
            <select id="if-type">
              ${['breakdown', 'accident', 'delay', 'complaint', 'safety', 'other'].map((t) => `<option value="${t}">${Fmt.titleCase(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Severity</label>
            <select id="if-sev">
              ${['low', 'medium', 'high', 'critical'].map((s) => `<option value="${s}"${s === 'low' ? '' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select id="if-status">
              ${['open', 'under-review', 'closed'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field span-2">
            <label>What happened? <span class="req">*</span></label>
            <textarea id="if-desc" rows="3" placeholder="Describe the incident, location and immediate impact"></textarea>
          </div>
          <div class="field span-2">
            <label>Action taken</label>
            <textarea id="if-action" rows="2" placeholder="Corrective action, escalation or follow-up"></textarea>
          </div>
        </div>
        <div class="field error" id="if-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="if-save">${editing ? 'Save incident' : 'Report incident'}</button>`,
    });

    if (editing) {
      Api.get(`/incidents/${id}`).then(({ data: i }) => {
        document.getElementById('if-date', modal.el).value = i.date;
        document.getElementById('if-veh', modal.el).value = i.vehicleId;
        document.getElementById('if-route', modal.el).value = i.routeId || '';
        document.getElementById('if-type', modal.el).value = i.type;
        document.getElementById('if-sev', modal.el).value = i.severity;
        document.getElementById('if-status', modal.el).value = i.status;
        document.getElementById('if-desc', modal.el).value = i.description;
        document.getElementById('if-action', modal.el).value = i.actionTaken || '';
      });
    }

    document.getElementById('if-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('if-error', modal.el);
      const payload = {
        date: document.getElementById('if-date', modal.el).value,
        vehicleId: document.getElementById('if-veh', modal.el).value,
        routeId: document.getElementById('if-route', modal.el).value || null,
        type: document.getElementById('if-type', modal.el).value,
        severity: document.getElementById('if-sev', modal.el).value,
        status: document.getElementById('if-status', modal.el).value,
        description: document.getElementById('if-desc', modal.el).value.trim(),
        actionTaken: document.getElementById('if-action', modal.el).value.trim(),
      };
      try {
        if (editing) await Api.put(`/incidents/${id}`, payload);
        else await Api.post('/incidents', payload);
        Toast.ok(editing ? 'Incident updated.' : 'Incident reported.');
        modal.close();
        this.load();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  resolve(id) {
    const modal = openModal({
      title: `Resolve incident ${id}`,
      body: `
        <div class="field">
          <label>Resolution / action taken <span class="req">*</span></label>
          <textarea id="ir-action" rows="4" placeholder="What was done to close this out?"></textarea>
        </div>
        <div class="field">
          <label>Close as</label>
          <select id="ir-status">
            <option value="closed">Closed - resolved</option>
            <option value="under-review">Under review</option>
          </select>
        </div>
        <div class="field error" id="ir-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn success" id="ir-save">Save resolution</button>`,
    });

    document.getElementById('ir-save', modal.el).addEventListener('click', async () => {
      const action = document.getElementById('ir-action', modal.el).value.trim();
      const errBox = document.getElementById('ir-error', modal.el);
      if (!action) { errBox.textContent = 'A resolution note is required.'; errBox.style.display = 'block'; return; }
      try {
        await Api.post(`/incidents/${id}/resolve`, {
          actionTaken: action,
          status: document.getElementById('ir-status', modal.el).value,
        });
        Toast.ok(`Incident ${id} updated.`);
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
    const ok = await confirmDialog(`Delete incident ${id}?`, { title: 'Delete incident', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/incidents/${id}`);
      Toast.ok('Incident deleted.');
      this.load();
      App.loadAlertCounts();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
