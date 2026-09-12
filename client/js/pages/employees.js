'use strict';

/* ==========================================================================
   Employees availing staff transport
   ========================================================================== */

const EmployeesPage = {
  state: { search: '', status: 'all', routeId: 'all', department: 'all' },
  lookups: { routes: [], shifts: [] },

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const [routes, shifts] = await Promise.all([Api.get('/routes'), Api.get('/shifts')]);
    this.lookups = { routes: routes.data, shifts: shifts.data };

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="e-search" placeholder="Search name, code, phone, stop..." value="${escapeHtml(this.state.search)}"></div>
        <select id="e-route">
          <option value="all">All routes</option>
          ${this.lookups.routes.map((r) => `<option value="${r.id}" ${this.state.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.code)} - ${escapeHtml(r.name)}</option>`).join('')}
        </select>
        <select id="e-dept">
          <option value="all">All departments</option>
          ${[...new Set(this.lookups.routes.map((r) => r.id))].length ? '' : ''}
        </select>
        <select id="e-status">
          <option value="all">All statuses</option>
          ${['active', 'inactive', 'on-leave'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn" onclick="Api.download('/reports/attendance.csv?from=${todayIso(-30)}&to=${todayIso()}', 'attendance.csv').then(()=>Toast.ok('Attendance register exported.'))">&#11123; Export</button>
        ${Api.canWrite ? '<button class="btn primary" id="e-new">+ Add Employee</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Employee Transport Register</h3><span class="desc" id="e-count"></span></div>
        <div class="card-body tight" id="e-table"></div>
      </div>
    `;

    document.getElementById('e-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('e-route').addEventListener('change', (e) => { this.state.routeId = e.target.value; this.load(); });
    document.getElementById('e-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    const nb = document.getElementById('e-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.routeId !== 'all') params.set('routeId', this.state.routeId);
    if (this.state.status !== 'all') params.set('status', this.state.status);

    const { data } = await Api.get(`/employees?${params}`);

    // Bail out if the user navigated away while the fetch was in flight.
    const countEl = currentEl('e-count');
    const tableEl = currentEl('e-table');
    if (!countEl || !tableEl) return;

    countEl.textContent = `${data.length} employees registered`;

    const deptSelect = document.getElementById('e-dept');
    const departments = [...new Set(data.map((e) => e.department))].sort();
    if (deptSelect.options.length <= 1) {
      deptSelect.innerHTML = '<option value="all">All departments</option>' +
        departments.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      deptSelect.addEventListener('change', (e) => { this.state.department = e.target.value; this.load(); });
    }

    const rows = this.state.department === 'all' ? data : data.filter((e) => e.department === this.state.department);

    tableEl.innerHTML = renderTable({
      rows,
      emptyTitle: 'No employees found',
      columns: [
        { key: 'code', label: 'Code', cls: 'mono' },
        { key: 'name', label: 'Employee', cls: 'strong' },
        { key: 'department', label: 'Department' },
        { key: 'phone', label: 'Phone', cls: 'mono' },
        { key: 'routeName', label: 'Route' },
        { key: 'shiftName', label: 'Shift' },
        { key: 'stop', label: 'Boarding Stop' },
        {
          key: 'stats',
          label: 'Attendance',
          align: 'right',
          render: (r) => r.stats.attendanceRate === null
            ? '<span class="muted">no data</span>'
            : `${Fmt.pct(r.stats.attendanceRate)}<div class="muted">${r.stats.boarded} boarded \u00B7 ${r.stats.noShows} absent</div>`,
        },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `
        <button class="btn sm" onclick="EmployeesPage.detail('${r.id}')" title="View">&#128065;</button>
        ${Api.canWrite ? `<button class="btn sm" onclick="EmployeesPage.openForm('${r.id}')" title="Edit">&#9998;</button>
        <button class="btn sm danger" onclick="EmployeesPage.remove('${r.id}')" title="Delete">&#128465;</button>` : ''}`,
    });
  },

  async detail(id) {
    const { data: e } = await Api.get(`/employees/${id}`);
    const bookings = await Api.get(`/trips?pageSize=200`);
    const attendance = await Api.get(`/reports/attendance.json?from=${todayIso(-30)}&to=${todayIso()}`);
    const own = attendance.data.filter((a) => a.employeeCode === e.code);

    openModal({
      title: `${e.name} \u00B7 ${e.code}`,
      wide: true,
      body: `
        <div class="grid cols-4" style="margin-bottom:16px">
          <div class="stat"><div class="label">Bookings</div><div class="value">${e.stats.bookings}</div></div>
          <div class="stat ok"><div class="label">Boarded</div><div class="value">${e.stats.boarded}</div></div>
          <div class="stat danger"><div class="label">No-shows</div><div class="value">${e.stats.noShows}</div></div>
          <div class="stat ${e.stats.attendanceRate >= 90 ? 'ok' : 'warn'}"><div class="label">Attendance</div><div class="value" style="font-size:19px">${e.stats.attendanceRate === null ? '-' : Fmt.pct(e.stats.attendanceRate)}</div></div>
        </div>
        <div class="grid cols-2">
          <div>
            <div class="section-title">Profile</div>
            <div class="kv">
              <dt>Employee code</dt><dd class="mono">${escapeHtml(e.code)}</dd>
              <dt>Department</dt><dd>${escapeHtml(e.department)}</dd>
              <dt>Email</dt><dd>${escapeHtml(e.email)}</dd>
              <dt>Phone</dt><dd>${escapeHtml(e.phone)}</dd>
              <dt>Emergency</dt><dd>${escapeHtml(e.emergencyContact || '-')}</dd>
            </div>
          </div>
          <div>
            <div class="section-title">Transport allocation</div>
            <div class="kv">
              <dt>Route</dt><dd>${escapeHtml(e.routeName)}</dd>
              <dt>Shift</dt><dd>${escapeHtml(e.shiftName)}</dd>
              <dt>Boarding stop</dt><dd>${escapeHtml(e.stop || '-')}</dd>
              <dt>Status</dt><dd>${statusPill(e.status)}</dd>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-title">Last 30 days boarding history</div>
        ${renderTable({
          rows: own.slice(-25).reverse(),
          columns: [
            { key: 'date', label: 'Date', render: (r) => Fmt.date(r.date) },
            { key: 'tripId', label: 'Trip', cls: 'mono' },
            { key: 'route', label: 'Route' },
            { key: 'boardTime', label: 'Board time', cls: 'mono' },
            {
              key: 'boarded',
              label: 'Result',
              render: (r) => `<span class="pill ${r.boarded === 'Yes' ? 'ok' : 'danger'}">${r.boarded === 'Yes' ? 'Boarded' : 'No-show'}</span>`,
            },
          ],
          emptyTitle: 'No boarding history',
        })}
      `,
      footer: '<button class="btn" data-close>Close</button>',
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit employee ${id}` : 'Add an employee',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Employee code <span class="req">*</span></label>
            <input type="text" id="ef-code" placeholder="SMI-1042">
          </div>
          <div class="field">
            <label>Full name <span class="req">*</span></label>
            <input type="text" id="ef-name" placeholder="Aarav Deshmukh">
          </div>
          <div class="field">
            <label>Mobile number <span class="req">*</span></label>
            <input type="text" id="ef-phone" placeholder="+91 98000 00000">
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" id="ef-email" placeholder="name@selectmobility.in">
          </div>
          <div class="field">
            <label>Department</label>
            <input type="text" id="ef-dept" placeholder="Production" list="dept-list">
            <datalist id="dept-list">
              ${['Production', 'Quality Assurance', 'Logistics', 'IT Services', 'Finance', 'Human Resources', 'Maintenance'].map((d) => `<option value="${d}">`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label>Gender</label>
            <select id="ef-gender"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
          </div>
          <div class="field">
            <label>Route <span class="req">*</span></label>
            <select id="ef-route">
              <option value="">-- select route --</option>
              ${this.lookups.routes.map((r) => `<option value="${r.id}" data-stops="${escapeHtml((r.stops || []).join('|'))}">${escapeHtml(r.code)} - ${escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Shift <span class="req">*</span></label>
            <select id="ef-shift">
              ${this.lookups.shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Boarding stop</label>
            <select id="ef-stop"><option value="">-- select a route first --</option></select>
          </div>
          <div class="field">
            <label>Emergency contact</label>
            <input type="text" id="ef-emg" placeholder="+91 97000 00000">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="ef-status">
              ${['active', 'inactive', 'on-leave'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field error" id="ef-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="ef-save">${editing ? 'Save employee' : 'Add employee'}</button>`,
    });

    const routeSel = document.getElementById('ef-route', modal.el);
    const stopSel = document.getElementById('ef-stop', modal.el);
    const shiftSel = document.getElementById('ef-shift', modal.el);

    const syncStops = () => {
      const opt = routeSel.selectedOptions[0];
      const stops = opt && opt.dataset.stops ? opt.dataset.stops.split('|').filter(Boolean) : [];
      stopSel.innerHTML = stops.length
        ? stops.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')
        : '<option value="">-- no stops on this route --</option>';
    };

    // Picking a route also selects that route's default shift.
    routeSel.addEventListener('change', () => {
      const route = this.lookups.routes.find((r) => r.id === routeSel.value);
      if (route && route.shiftId) shiftSel.value = route.shiftId;
      syncStops();
    });

    if (editing) {
      Api.get(`/employees/${id}`).then(({ data: e }) => {
        document.getElementById('ef-code', modal.el).value = e.code;
        document.getElementById('ef-name', modal.el).value = e.name;
        document.getElementById('ef-phone', modal.el).value = e.phone;
        document.getElementById('ef-email', modal.el).value = e.email || '';
        document.getElementById('ef-dept', modal.el).value = e.department || '';
        document.getElementById('ef-gender', modal.el).value = e.gender || 'male';
        document.getElementById('ef-status', modal.el).value = e.status;
        document.getElementById('ef-emg', modal.el).value = e.emergencyContact || '';
        routeSel.value = e.routeId || '';
        shiftSel.value = e.shiftId || '';
        syncStops();
        stopSel.value = e.stop || '';
      });
    }

    document.getElementById('ef-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('ef-error', modal.el);
      errBox.style.display = 'none';
      const payload = {
        code: document.getElementById('ef-code', modal.el).value.trim(),
        name: document.getElementById('ef-name', modal.el).value.trim(),
        phone: document.getElementById('ef-phone', modal.el).value.trim(),
        email: document.getElementById('ef-email', modal.el).value.trim(),
        department: document.getElementById('ef-dept', modal.el).value.trim(),
        gender: document.getElementById('ef-gender', modal.el).value,
        routeId: routeSel.value,
        shiftId: shiftSel.value,
        stop: stopSel.value,
        emergencyContact: document.getElementById('ef-emg', modal.el).value.trim(),
        status: document.getElementById('ef-status', modal.el).value,
      };

      try {
        if (editing) await Api.put(`/employees/${id}`, payload);
        else await Api.post('/employees', payload);
        Toast.ok(editing ? 'Employee updated.' : 'Employee added to transport roster.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(`Remove employee ${id} from the transport roster?`, { title: 'Delete employee', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await Api.del(`/employees/${id}`);
      Toast.ok('Employee removed.');
      this.load();
    } catch (err) {
      Toast.error(err.message);
    }
  },
};
