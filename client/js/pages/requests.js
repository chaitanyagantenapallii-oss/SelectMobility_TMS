'use strict';

/* ==========================================================================
   Client requests - ride requests and notes raised from the Client app
   ========================================================================== */

/*
 * This is the other half of the phone's "Raise a request". Nothing used to read
 * these rows, so a request died the moment it was sent. Here the desk can see
 * what came in, answer it, and - for a ride request - turn it into a real trip
 * with a vehicle and driver, which the client then sees confirmed in their app.
 */
const RequestsPage = {
  state: { status: 'pending', organisation: 'all', kind: 'all', search: '' },
  lookups: { organisations: [], routes: [], vehicles: [], drivers: [], shifts: [] },

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';

    const [orgs, routes, vehicles, drivers, shifts] = await Promise.all([
      Api.get('/organisations'),
      Api.get('/routes'),
      Api.get('/vehicles'),
      Api.get('/drivers'),
      Api.get('/shifts'),
    ]);
    // Only usable crew and vehicles should be assignable.
    this.lookups = {
      organisations: orgs.data,
      routes: routes.data,
      vehicles: vehicles.data.filter((v) => v.status === 'active'),
      drivers: drivers.data.filter((d) => d.status === 'active'),
      shifts: shifts.data.filter((s) => s.status !== 'inactive'),
    };

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="rq-search" placeholder="Search subject, client, request id..." value="${escapeHtml(this.state.search)}"></div>
        <select id="rq-status">
          <option value="all">All statuses</option>
          ${[
            { k: 'pending', l: 'Waiting on us' },
            { k: 'scheduled', l: 'Scheduled' },
            { k: 'declined', l: 'Declined' },
          ].map((s) => `<option value="${s.k}" ${this.state.status === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}
        </select>
        <select id="rq-kind">
          <option value="all">All kinds</option>
          ${[
            { k: 'ad-hoc-trip', l: 'Extra vehicle' },
            { k: 'route-seat', l: 'Extra seats' },
            { k: 'general', l: 'Notes' },
          ].map((s) => `<option value="${s.k}" ${this.state.kind === s.k ? 'selected' : ''}>${s.l}</option>`).join('')}
        </select>
        <select id="rq-org">
          <option value="all">All clients</option>
          ${this.lookups.organisations.map((o) => `<option value="${escapeHtml(o.name)}" ${this.state.organisation === o.name ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
      </div>

      <div class="grid cols-4" style="margin-bottom:18px" id="rq-stats"></div>

      <div class="card">
        <div class="card-head">
          <h3>Requests</h3>
          <span class="desc" id="rq-count"></span>
        </div>
        <div class="card-body tight" id="rq-table"></div>
      </div>
    `;

    document.getElementById('rq-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('rq-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    document.getElementById('rq-kind').addEventListener('change', (e) => { this.state.kind = e.target.value; this.load(); });
    document.getElementById('rq-org').addEventListener('change', (e) => { this.state.organisation = e.target.value; this.load(); });

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.status !== 'all') params.set('status', this.state.status);
    if (this.state.kind !== 'all') params.set('kind', this.state.kind);
    if (this.state.organisation !== 'all') params.set('organisation', this.state.organisation);
    if (this.state.search) params.set('search', this.state.search);

    const { data, meta } = await Api.get(`/trip-requests?${params}`);

    const statsEl = currentEl('rq-stats');
    const tableEl = currentEl('rq-table');
    const countEl = currentEl('rq-count');
    if (!statsEl || !tableEl || !countEl) return;

    // The stats reflect everything, not the current filter, so the desk can see
    // the backlog even while looking at one client.
    const all = await Api.get('/trip-requests');
    const m = all.meta;
    statsEl.innerHTML = `
      <div class="stat warn"><div class="label">Waiting on us</div><div class="value">${m.pending}</div><div class="foot">Needs a decision</div></div>
      <div class="stat ok"><div class="label">Scheduled</div><div class="value">${m.scheduled}</div><div class="foot">Turned into trips</div></div>
      <div class="stat danger"><div class="label">Declined</div><div class="value">${m.declined}</div><div class="foot">Client notified</div></div>
      <div class="stat"><div class="label">All time</div><div class="value">${m.total}</div><div class="foot">Every request raised</div></div>
    `;

    countEl.textContent = `${data.length} request${data.length === 1 ? '' : 's'} shown`;

    tableEl.innerHTML = renderTable({
      rows: data,
      emptyTitle: 'Nothing here',
      emptyText: this.state.status === 'pending'
        ? 'No client is waiting on a reply right now.'
        : 'No requests match these filters.',
      columns: [
        { key: 'id', label: 'Ref', cls: 'mono' },
        { key: 'organisation', label: 'Client', cls: 'strong' },
        {
          key: 'kind',
          label: 'Kind',
          render: (r) => {
            const labels = { 'ad-hoc-trip': 'Extra vehicle', 'route-seat': 'Extra seats', general: 'Note' };
            return `<span class="pill ${r.kind === 'general' ? 'muted' : 'warn'}">${labels[r.kind] || 'Note'}</span>`;
          },
        },
        {
          key: 'subject',
          label: 'Request',
          render: (r) => `${escapeHtml(r.subject)}${r.detail ? `<div class="muted" style="font-size:11.5px">${escapeHtml(String(r.detail).slice(0, 90))}</div>` : ''}`,
        },
        {
          key: 'when',
          label: 'Needed',
          render: (r) => (r.date
            ? `${Fmt.date(r.date)}${r.time ? `<div class="muted">${escapeHtml(r.time)}</div>` : ''}`
            : '<span class="muted">-</span>'),
        },
        {
          key: 'headcount',
          label: 'People',
          align: 'right',
          render: (r) => (r.headcount ? String(r.headcount) : '<span class="muted">-</span>'),
        },
        {
          key: 'pickupPoint',
          label: 'Pickup',
          render: (r) => (r.pickupPoint ? escapeHtml(r.pickupPoint) : '<span class="muted">-</span>'),
        },
        { key: 'createdAt', label: 'Raised', render: (r) => Fmt.date(r.createdAt) },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => {
        const buttons = [`<button class="btn sm" onclick="RequestsPage.detail('${r.id}')" title="Open">&#128065;</button>`];
        if (Api.canWrite && r.status === 'pending' && r.kind && r.kind !== 'general') {
          buttons.push(`<button class="btn sm primary" onclick="RequestsPage.approveForm('${r.id}')" title="Allocate vehicle and driver">&#10003;</button>`);
        }
        if (Api.canWrite && r.status === 'pending') {
          buttons.push(`<button class="btn sm danger" onclick="RequestsPage.decline('${r.id}')" title="Decline">&#10007;</button>`);
        }
        return buttons.join('');
      },
    });
  },

  async detail(id) {
    const { data: r } = await Api.get(`/trip-requests/${id}`);

    openModal({
      title: `${r.id} \u00B7 ${r.subject}`,
      wide: true,
      body: `
        <div class="grid cols-3" style="margin-bottom:16px">
          <div class="stat"><div class="label">Client</div><div class="value" style="font-size:15px">${escapeHtml(r.organisation)}</div><div class="foot">${escapeHtml(r.raisedByName || '')}</div></div>
          <div class="stat"><div class="label">Kind</div><div class="value" style="font-size:15px">${r.kind === 'ad-hoc-trip' ? 'Extra vehicle' : r.kind === 'route-seat' ? 'Extra seats' : 'Note'}</div><div class="foot">${escapeHtml(r.category || '')}</div></div>
          <div class="stat ${r.status === 'pending' ? 'warn' : r.status === 'declined' ? 'danger' : 'ok'}"><div class="label">Status</div><div class="value" style="font-size:15px">${statusPill(r.status)}</div><div class="foot">${r.decidedAt ? `Decided ${Fmt.date(r.decidedAt)}` : 'Awaiting decision'}</div></div>
        </div>

        <div class="grid cols-2">
          <div>
            <div class="section-title">What they asked for</div>
            <div class="kv">
              <dt>Raised by</dt><dd>${escapeHtml(r.raisedByName || '-')} &lt;${escapeHtml(r.raisedBy || '-')}&gt;</dd>
              <dt>Priority</dt><dd>${escapeHtml(r.priority || 'normal')}</dd>
              ${r.kind !== 'general' ? `
              <dt>Date needed</dt><dd>${r.date ? Fmt.date(r.date) : '-'}</dd>
              <dt>Time</dt><dd class="mono">${escapeHtml(r.time || '-')}</dd>
              <dt>Pick up from</dt><dd>${escapeHtml(r.pickupPoint || '-')}</dd>
              <dt>Drop at</dt><dd>${escapeHtml(r.dropPoint || '-')}</dd>
              <dt>People</dt><dd>${r.headcount || '-'}</dd>` : ''}
            </div>
          </div>
          <div>
            <div class="section-title">Outcome</div>
            <div class="kv">
              <dt>Trip</dt><dd class="mono">${r.tripRef ? escapeHtml(r.tripRef) : '-'}</dd>
              <dt>Route</dt><dd>${escapeHtml(r.routeName || '-')}</dd>
              <dt>Vehicle</dt><dd class="mono">${escapeHtml(r.vehicleRegNo || '-')}</dd>
              <dt>Driver</dt><dd>${escapeHtml(r.driverName || '-')}${r.driverPhone ? ` \u00B7 ${escapeHtml(r.driverPhone)}` : ''}</dd>
              <dt>Decided by</dt><dd>${escapeHtml(r.decidedBy || '-')}</dd>
            </div>
          </div>
        </div>

        ${r.detail ? `<div class="divider"></div><div class="section-title">Their notes</div><div class="muted" style="font-size:12.5px">${escapeHtml(r.detail)}</div>` : ''}

        ${r.response ? `<div class="divider"></div><div class="section-title">Our answer</div><div class="muted" style="font-size:12.5px">${escapeHtml(r.response)}</div>` : ''}

        ${r.staff && r.staff.length ? `
          <div class="divider"></div>
          <div class="section-title">Staff named on the request (${r.staff.length})</div>
          <div>${r.staff.map((s) => `<span class="pill muted" style="margin:2px">${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)} \u00B7 ${escapeHtml(s.stop || '')}</span>`).join('')}</div>
        ` : ''}
        ${r.unknownStaffCodes && r.unknownStaffCodes.length ? `
          <div class="hint" style="margin-top:8px">Ignored ${r.unknownStaffCodes.length} code(s) not on this client's roster: ${escapeHtml(r.unknownStaffCodes.join(', '))}</div>
        ` : ''}
      `,
      footer: `
        <button class="btn" data-close>Close</button>
        ${Api.canWrite && r.status === 'pending' && r.kind !== 'general' ? `<button class="btn primary" id="rq-do-approve">Allocate vehicle &amp; driver</button>` : ''}
        ${Api.canWrite && r.status === 'pending' ? `<button class="btn" id="rq-do-reply">Reply only</button>` : ''}
      `,
    });

    // openModal hands back a controller with a real close(), so the next dialog
    // can be opened directly instead of simulating a click on the close button.
    const approveBtn = document.getElementById('rq-do-approve', modal.el);
    const replyBtn = document.getElementById('rq-do-reply', modal.el);
    if (approveBtn) {
      approveBtn.addEventListener('click', () => { modal.close(); this.approveForm(id); });
    }
    if (replyBtn) {
      replyBtn.addEventListener('click', () => { modal.close(); this.replyForm(id); });
    }
  },

  /** Approve a ride request: pick the crew, and the trip is created for us. */
  async approveForm(id) {
    const { data: r } = await Api.get(`/trip-requests/${id}`);

    const suggestedRoute = this.lookups.routes.find((x) => x.name === r.routeName) || this.lookups.routes[0];

    const modal = openModal({
      title: `Approve ${r.id}`,
      wide: true,
      body: `
        <div class="hint" style="margin-bottom:14px">
          ${escapeHtml(r.organisation)} asked for ${r.headcount || '?'} seat(s)
          ${r.pickupPoint ? ` from ${escapeHtml(r.pickupPoint)}` : ''}
          ${r.dropPoint ? ` to ${escapeHtml(r.dropPoint)}` : ''}
          ${r.date ? ` on ${Fmt.date(r.date)}` : ''}.
          Approving creates a real trip and books the named staff onto it.
        </div>

        <div class="form-grid">
          <div class="field">
            <label>Route <span class="req">*</span></label>
            <select id="ap-route">
              ${this.lookups.routes.map((x) => `<option value="${x.id}" ${suggestedRoute && x.id === suggestedRoute.id ? 'selected' : ''}>${escapeHtml(x.code)} - ${escapeHtml(x.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Vehicle <span class="req">*</span></label>
            <select id="ap-vehicle">
              ${this.lookups.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} \u00B7 ${escapeHtml(v.model)} \u00B7 ${v.seats} seats</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Driver <span class="req">*</span></label>
            <select id="ap-driver">
              ${this.lookups.drivers.map((d) => `<option value="${d.id}">${escapeHtml(d.name)} \u00B7 ${escapeHtml(d.phone || '')}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Shift <span class="req">*</span></label>
            <select id="ap-shift">
              ${this.lookups.shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.code)} \u00B7 ${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Date</label>
            <input type="date" id="ap-date" value="${escapeHtml(r.date || todayIso())}">
          </div>
          <div class="field">
            <label>Departure time</label>
            <input type="time" id="ap-time" value="${escapeHtml(r.time || '')}">
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Note for the client (optional)</label>
            <input type="text" id="ap-note" placeholder="Shown on their request in the Client app">
          </div>
        </div>
        <div class="field error" id="ap-error" style="display:none"></div>`,
      footer: `<button class="btn" id="ap-auto">Auto-assign best match</button>
               <button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="ap-save">Approve &amp; create trip</button>`,
    });

    document.getElementById('ap-auto', modal.el).addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      button.textContent = 'Finding best match...';
      try {
        const { data } = await Api.get(`/trip-requests/${id}/recommendation`);
        if (data.route) document.getElementById('ap-route', modal.el).value = data.route.id;
        if (data.vehicle) document.getElementById('ap-vehicle', modal.el).value = data.vehicle.id;
        if (data.driver) document.getElementById('ap-driver', modal.el).value = data.driver.id;
        if (data.shift) document.getElementById('ap-shift', modal.el).value = data.shift.id;
        Toast.ok(data.confidence === 'recommended' ? 'Best available vehicle and driver selected.' : 'Partial match found. Review the assignment.');
      } catch (err) {
        const error = document.getElementById('ap-error', modal.el);
        error.textContent = err.message;
        error.style.display = 'block';
      } finally {
        button.disabled = false;
        button.textContent = 'Auto-assign best match';
      }
    });

    document.getElementById('ap-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('ap-error', modal.el);
      errBox.style.display = 'none';
      const val = (elId) => {
        const el = document.getElementById(elId, modal.el);
        return el ? el.value : '';
      };

      const trip = {
        routeId: val('ap-route'),
        vehicleId: val('ap-vehicle'),
        driverId: val('ap-driver'),
        shiftId: val('ap-shift'),
        date: val('ap-date'),
      };
      // Only send a departure time if one was chosen; the server otherwise
      // derives it from the shift's pickup window.
      const time = val('ap-time');
      if (time) trip.departureAt = `${trip.date}T${time}:00`;

      try {
        const res = await Api.post(`/trip-requests/${id}/approve`, {
          trip,
          response: val('ap-note').trim() || undefined,
        });
        Toast.ok(res.message || 'Request approved.');
        modal.close();
        this.load();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  /** Answer without scheduling - used for notes and for "we're on it". */
  replyForm(id) {
    const modal = openModal({
      title: `Reply to ${id}`,
      body: `
        <div class="field">
          <label>Your reply</label>
          <textarea id="rp-text" placeholder="What the client will read in their app"></textarea>
        </div>
        <div class="field error" id="rp-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="rp-save">Send reply</button>`,
    });

    document.getElementById('rp-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('rp-error', modal.el);
      errBox.style.display = 'none';
      const response = document.getElementById('rp-text', modal.el).value.trim();
      if (!response) { errBox.textContent = 'Type a reply first.'; errBox.style.display = 'block'; return; }
      try {
        await Api.post(`/trip-requests/${id}/reply`, { response });
        Toast.ok('Reply sent.');
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async decline(id) {
    const modal = openModal({
      title: `Decline ${id}`,
      body: `
        <div class="field">
          <label>Reason <span class="req">*</span></label>
          <textarea id="dc-text" placeholder="e.g. No vehicle available on that date"></textarea>
          <div class="hint">The client sees this on their request, so say what you can - and what to do next.</div>
        </div>
        <div class="field error" id="dc-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn danger" id="dc-save">Decline request</button>`,
    });

    document.getElementById('dc-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('dc-error', modal.el);
      errBox.style.display = 'none';
      const reason = document.getElementById('dc-text', modal.el).value.trim();
      if (reason.length < 5) { errBox.textContent = 'Give a short reason (at least 5 characters).'; errBox.style.display = 'block'; return; }
      try {
        await Api.post(`/trip-requests/${id}/decline`, { reason });
        Toast.ok('Request declined and the client notified.');
        modal.close();
        this.load();
        App.loadAlertCounts();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },
};
