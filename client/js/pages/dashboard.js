'use strict';

/* ==========================================================================
   Dashboard - operational overview
   ========================================================================== */

const DashboardPage = {
  async render(container) {
    const [{ data }, tracking] = await Promise.all([
      Api.get('/dashboard/overview'),
      Api.get('/tracking'),
    ]);
    const k = data.kpis;

    container.innerHTML = `
      <div class="grid cols-4" style="margin-bottom:18px">
        ${this.statCard('Fleet Availability', `${Fmt.pct(k.fleetAvailabilityPct)}`, `${k.activeVehicles} of ${k.totalVehicles} vehicles running`, 'ok', '&#128666;', 'vehicles')}
        ${this.statCard('Trips Today', `${k.tripsToday}`, `${k.completedToday} completed \u00B7 ${k.tripsToday - k.completedToday} in progress`, 'info', '&#128652;', 'trips')}
        ${this.statCard('Employee Boarding', k.attendanceRate === null ? 'n/a' : Fmt.pct(k.attendanceRate), `${k.activeEmployees} active staff on ${data.routeLoad.length} routes`, 'ok', '&#128101;', 'employees')}
        ${this.statCard('Open Incidents', `${k.openIncidents}`, `${k.complianceAlerts} compliance alerts due`, k.openIncidents ? 'danger' : 'ok', '&#128680;', 'incidents')}
      </div>

      <div class="grid cols-4" style="margin-bottom:18px">
        ${this.statCard('Vehicles in Workshop', `${k.vehiclesInMaintenance}`, 'Undergoing service or repair', k.vehiclesInMaintenance ? 'warn' : 'ok', '&#128295;', 'maintenance')}
        ${this.statCard('Drivers Available', `${k.activeDrivers}/${k.totalDrivers}`, 'Active roster strength', 'info', '&#128100;', 'drivers')}
        ${this.statCard('Month Fuel Spend', Fmt.compactMoney(k.monthFuelCost), 'Diesel, CNG and charging', 'info', '&#9981;', 'fuel')}
        ${this.statCard('Month Cost to Date', Fmt.compactMoney(k.monthToDateCost), `Maintenance ${Fmt.compactMoney(k.monthMaintenanceCost)}`, 'warn', '&#128176;', 'expenses')}
      </div>

      <div class="card etms-flow-card" style="margin-bottom:18px">
        <div class="card-head">
          <div><h3>ETMS control flow</h3><span class="desc">Demand moves from the client request to verified billing.</span></div>
          <a class="btn sm ghost" href="#requests">Review demand &rarr;</a>
        </div>
        <div class="etms-flow">
          ${[
            ['1', 'Demand', `${(data.workflowQueue || []).filter((x) => x.type === 'request').length} pending`, 'requests'],
            ['2', 'Validate', 'Policy and shift check', 'requests'],
            ['3', 'Plan', `${data.routeLoad.length} active routes`, 'routes'],
            ['4', 'Allocate', `${k.activeVehicles} vehicles available`, 'vehicles'],
            ['5', 'Dispatch', `${k.activeDrivers} drivers active`, 'drivers'],
            ['6', 'Track', `${tracking.meta.live} live signals`, 'tracking'],
            ['7', 'Verify', `${k.tripsToday} trips today`, 'manifests'],
            ['8', 'Bill & audit', `${Fmt.compactMoney(k.monthToDateCost)} month to date`, 'reports'],
          ].map((s, i) => `<a class="etms-stage" href="/${App.tenantSlug || 'smipl'}/${s[3]}" aria-label="Open ${escapeHtml(s[1])}"><span class="etms-stage-no">${s[0]}</span><strong>${escapeHtml(s[1])}</strong><small>${escapeHtml(s[2])}</small><em>Open module &rarr;</em>${i < 7 ? '<span class="etms-arrow">&rarr;</span>' : ''}</a>`).join('')}
        </div>
      </div>

      <div class="card workflow-card">
        <div class="card-head">
          <div><h3>Operations workflow</h3><span class="desc">The next handoff across requests, trips, drivers and incidents</span></div>
          <span class="workflow-count" id="workflow-count"></span>
        </div>
        <div class="workflow-list" id="workflow-list"></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Today's Operations Board</h3>
          <span class="desc">${Fmt.date(new Date().toISOString().slice(0, 10))} \u00B7 ${Fmt.weekday(new Date().toISOString().slice(0, 10))}</span>
          <div class="spacer"></div>
          <a class="btn sm ghost" href="#manifests">Open manifests &rarr;</a>
        </div>
        <div class="card-body tight" id="today-board"></div>
      </div>

      <div class="card control-tower-card">
        <div class="card-head">
          <h3>Control Tower · Vehicle Movement</h3>
          <span class="desc">Live routing, roaming and signal health</span>
          <div class="spacer"></div>
          <a class="btn sm ghost" href="#tracking">Open live tracking &rarr;</a>
        </div>
        <div class="tower-summary">
          <span><strong>${tracking.meta.moving}</strong> moving</span>
          <span><strong>${tracking.meta.live}</strong> reporting</span>
          <span class="${tracking.data.filter((r) => r.roaming).length ? 'tower-danger' : ''}"><strong>${tracking.data.filter((r) => r.roaming).length}</strong> roaming</span>
          <span class="${tracking.meta.stale ? 'tower-warn' : ''}"><strong>${tracking.meta.stale}</strong> stale signals</span>
        </div>
        <div class="card-body tight" id="tower-board"></div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head">
            <h3>14-Day Trip Volume</h3>
            <span class="desc">Completed vs cancelled runs</span>
          </div>
          <div class="card-body">
            <div class="chart" id="chart-trips"></div>
            <div class="chart-legend">
              <span><i style="background:#1a80c4"></i> Completed</span>
              <span><i style="background:#b91c1c"></i> Cancelled</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Distance Operated</h3>
            <span class="desc">Kilometres logged per day</span>
          </div>
          <div class="card-body">
            <div class="chart" id="chart-km"></div>
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head">
            <h3>Route Load Today</h3>
            <span class="desc">Allocated seats against capacity</span>
          </div>
          <div class="card-body" id="route-load"></div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Fleet Status Mix</h3>
            <span class="desc">Vehicle availability</span>
          </div>
          <div class="card-body" id="fleet-mix"></div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head">
            <h3>Compliance Alerts</h3>
            <span class="desc">Documents expiring within 45 days</span>
            <div class="spacer"></div>
            <a class="btn sm ghost" href="#documents">Manage &rarr;</a>
          </div>
          <div class="card-body tight" id="compliance"></div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Recent Incidents</h3>
            <div class="spacer"></div>
            <a class="btn sm ghost" href="#incidents">View all &rarr;</a>
          </div>
          <div class="card-body tight" id="incidents"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Upcoming Workshop Jobs</h3>
          <div class="spacer"></div>
          <a class="btn sm ghost" href="#maintenance">Maintenance register &rarr;</a>
        </div>
        <div class="card-body tight" id="workshop"></div>
      </div>
    `;

    this.renderTodayBoard(data.todayBoard);
    this.renderControlTower(tracking.data);
    this.renderWorkflow(data.workflowQueue || []);
    this.renderCharts(data.utilisationSeries);
    this.renderRouteLoad(data.routeLoad);
    this.renderFleetMix(k);
    this.renderCompliance(data.complianceAlerts);
    this.renderIncidents(data.recentIncidents);
    this.renderWorkshop(data.upcomingMaintenance);
  },

  renderControlTower(rows) {
    const el = currentEl('tower-board');
    if (!el) return;
    el.innerHTML = renderTable({
      rows: rows.slice(0, 8),
      emptyTitle: 'No vehicle signals yet',
      emptyText: 'Vehicle positions will appear when a driver or GPS device reports a fix.',
      columns: [
        { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono' },
        { key: 'routeCode', label: 'Route', render: (r) => r.routeCode ? `<span class="strong">${escapeHtml(r.routeCode)}</span> · ${escapeHtml(r.routeName || '')}` : '<span class="muted">Unassigned</span>' },
        { key: 'driverName', label: 'Driver', render: (r) => escapeHtml(r.driverName || '—') },
        { key: 'speedKph', label: 'Speed', render: (r) => `${Fmt.num(r.speedKph || 0, 1)} km/h` },
        { key: 'roaming', label: 'Movement', render: (r) => r.roaming ? '<span class="pill danger">Roaming</span>' : r.stale ? '<span class="pill warn">Stale</span>' : '<span class="pill ok">On corridor</span>' },
        { key: 'recordedAt', label: 'Last signal', render: (r) => r.recordedAt ? Fmt.time(r.recordedAt) : '—' },
      ],
    });
  },

  renderWorkflow(rows) {
    const el = currentEl('workflow-list');
    const count = currentEl('workflow-count');
    if (!el) return;
    if (count) count.textContent = rows.length ? `${rows.length} open handoff${rows.length === 1 ? '' : 's'}` : 'No pending handoffs';
    el.innerHTML = rows.length ? rows.map((r) => `<div class="workflow-row ${r.priority === 'high' ? 'urgent' : ''}">
      <span class="workflow-dot ${escapeHtml(r.type)}"></span><div class="workflow-main"><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.detail)}</span></div>
      <a class="btn sm ghost" href="#${escapeHtml(r.action)}">${escapeHtml(r.actionLabel)} &rarr;</a>
    </div>`).join('') : '<div class="workflow-clear"><span>&#10003;</span><div><strong>Operations are clear</strong><small>No request, acceptance, active trip or incident is waiting for a handoff.</small></div></div>';
  },

  statCard(label, value, foot, tone, icon, page) {
    return `<button type="button" class="stat ${tone}" data-kpi-page="${escapeHtml(page)}" aria-label="Open ${escapeHtml(label)}">
      <div class="label"><span>${icon}</span>${escapeHtml(label)}</div>
      <div class="value">${value}</div>
      <div class="foot">${foot}</div>
    </button>`;
  },

  renderTodayBoard(rows) {
    const el = document.getElementById('today-board');
    el.innerHTML = renderTable({
      rows,
      emptyTitle: 'No trips scheduled today',
      emptyText: 'Create a trip from the Trip Logs page to populate the operations board.',
      columns: [
        { key: 'departureAt', label: 'Departure', render: (r) => `<span class="mono">${Fmt.time(r.departureAt)}</span>` },
        { key: 'shift', label: 'Shift', render: (r) => `<span class="pill muted">${escapeHtml(r.shift)}</span>` },
        { key: 'route', label: 'Route', render: (r) => `<span class="strong">${escapeHtml(r.route)}</span>` },
        { key: 'vehicle', label: 'Vehicle', cls: 'mono' },
        { key: 'driver', label: 'Driver' },
        {
          key: 'boarded',
          label: 'Boarded',
          render: (r) => `${r.boarded}<span class="muted">/${r.allocated || r.seats}</span>
            <div class="bar-track" style="margin-top:4px;width:74px">
              <div class="bar-fill ${r.allocated >= r.seats ? 'warn' : 'ok'}" style="width:${r.seats ? Math.min(100, (r.allocated / r.seats) * 100) : 0}%"></div>
            </div>`,
        },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `<button class="btn sm" onclick="App.go('manifests','${r.id}')">Manifest</button>`,
    });
  },

  renderCharts(series) {
    // Bail out if the user navigated away while the overview fetch was in flight.
    const tripsEl = currentEl('chart-trips');
    const kmEl = currentEl('chart-km');
    if (!tripsEl || !kmEl) return;

    tripsEl.innerHTML = Chart.bars(
      series.map((s) => ({ label: Fmt.dateShort(s.date), sub: Fmt.weekday(s.date), values: [s.completed, s.cancelled] })),
      { series: ['Completed', 'Cancelled'], colors: ['#1a80c4', '#b91c1c'], height: 215 },
    );

    kmEl.innerHTML = Chart.line(
      series.map((s) => ({ label: Fmt.dateShort(s.date), value: s.km })),
      { color: '#15803d', fill: 'rgba(21,128,61,.13)', height: 215, label: 'km' },
    );
  },

  renderRouteLoad(rows) {
    const el = currentEl('route-load');
    if (!el) return;
    el.innerHTML = Chart.hbars(
      rows.map((r) => ({
        label: `${r.code} \u00B7 ${r.name}`,
        value: r.fillPct,
        display: `${r.allocated}/${r.capacity} seats \u00B7 ${Fmt.pct(r.fillPct)}`,
        tone: r.fillPct > 92 ? 'warn' : 'ok',
      })),
      { max: 100 },
    );
  },

  renderFleetMix(k) {
    const active = k.activeVehicles;
    const workshop = k.vehiclesInMaintenance;
    const other = Math.max(0, k.totalVehicles - active - workshop);
    const el = currentEl('fleet-mix');
    if (!el) return;
    el.innerHTML = Chart.donut(
      [
        { label: 'Available', value: active, color: '#15803d' },
        { label: 'In workshop', value: workshop, color: '#f59e0b' },
        { label: 'Idle / other', value: other, color: '#94a3b8' },
      ],
      { centre: `${active}/${k.totalVehicles}` },
    );
  },

  renderCompliance(alerts) {
    const el = document.getElementById('compliance');
    if (!alerts.length) {
      el.innerHTML = '<div class="empty"><div class="ico">&#9989;</div><h4>All clear</h4><p>No documents expiring in the next 45 days.</p></div>';
      return;
    }
    el.innerHTML = alerts.map((a) => {
      const tone = a.daysLeft < 0 ? 'danger' : a.daysLeft <= 15 ? 'warn' : 'muted';
      const text = a.daysLeft < 0 ? `expired ${Math.abs(a.daysLeft)}d ago` : `${a.daysLeft} days left`;
      return `<div class="alert-row">
        <span class="pill ${tone}">${escapeHtml(a.type)}</span>
        <span><strong>${escapeHtml(a.vehicleRegNo)}</strong> <span class="muted">${escapeHtml(a.title)}</span></span>
        <span class="when ${a.daysLeft < 15 ? 'text-danger' : 'text-muted'}">${text}</span>
      </div>`;
    }).join('');
  },

  renderIncidents(rows) {
    const el = document.getElementById('incidents');
    if (!rows.length) {
      el.innerHTML = '<div class="empty"><div class="ico">&#128994;</div><h4>No incidents logged</h4><p>The fleet has had a clean run.</p></div>';
      return;
    }
    el.innerHTML = `<div class="card-body" style="padding:14px 17px"><div class="timeline">${rows.map((i) => `
      <div class="timeline-item ${i.severity === 'high' || i.severity === 'critical' ? 'danger' : i.severity === 'medium' ? 'warn' : ''}">
        <div class="when">${Fmt.date(i.date)} \u00B7 ${escapeHtml(i.vehicleRegNo)} \u00B7 ${escapeHtml(Fmt.titleCase(i.type))}</div>
        <div class="what">${escapeHtml(i.description)}</div>
        <div style="margin-top:5px">${severityPill(i.severity)} ${statusPill(i.status)}</div>
      </div>`).join('')}</div></div>`;
  },

  renderWorkshop(rows) {
    const el = document.getElementById('workshop');
    el.innerHTML = renderTable({
      rows,
      emptyTitle: 'No pending workshop jobs',
      columns: [
        { key: 'date', label: 'Scheduled', render: (r) => `${Fmt.date(r.date)}${r.overdue ? ' <span class="pill danger">overdue</span>' : ''}` },
        { key: 'vehicleRegNo', label: 'Vehicle', cls: 'mono' },
        { key: 'type', label: 'Type', render: (r) => `<span class="pill muted">${escapeHtml(Fmt.titleCase(r.type))}</span>` },
        { key: 'description', label: 'Job' },
        { key: 'workshop', label: 'Workshop' },
        { key: 'cost', label: 'Est. Cost', align: 'right', render: (r) => Fmt.money(r.cost) },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
    });
  },
};
