'use strict';

/* ==========================================================================
   Dashboard - operational overview
   ========================================================================== */

const DashboardPage = {
  async render(container) {
    const { data } = await Api.get('/dashboard/overview');
    const k = data.kpis;

    container.innerHTML = `
      <div class="grid cols-4" style="margin-bottom:18px">
        ${this.statCard('Fleet Availability', `${Fmt.pct(k.fleetAvailabilityPct)}`, `${k.activeVehicles} of ${k.totalVehicles} vehicles running`, 'ok', '&#128666;')}
        ${this.statCard('Trips Today', `${k.tripsToday}`, `${k.completedToday} completed \u00B7 ${k.tripsToday - k.completedToday} in progress`, 'info', '&#128652;')}
        ${this.statCard('Employee Boarding', k.attendanceRate === null ? 'n/a' : Fmt.pct(k.attendanceRate), `${k.activeEmployees} active staff on ${data.routeLoad.length} routes`, 'ok', '&#128101;')}
        ${this.statCard('Open Incidents', `${k.openIncidents}`, `${k.complianceAlerts} compliance alerts due`, k.openIncidents ? 'danger' : 'ok', '&#128680;')}
      </div>

      <div class="grid cols-4" style="margin-bottom:18px">
        ${this.statCard('Vehicles in Workshop', `${k.vehiclesInMaintenance}`, 'Undergoing service or repair', k.vehiclesInMaintenance ? 'warn' : 'ok', '&#128295;')}
        ${this.statCard('Drivers Available', `${k.activeDrivers}/${k.totalDrivers}`, 'Active roster strength', 'info', '&#128100;')}
        ${this.statCard('Month Fuel Spend', Fmt.compactMoney(k.monthFuelCost), 'Diesel, CNG and charging', 'info', '&#9981;')}
        ${this.statCard('Month Cost to Date', Fmt.compactMoney(k.monthToDateCost), `Maintenance ${Fmt.compactMoney(k.monthMaintenanceCost)}`, 'warn', '&#128176;')}
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
    this.renderCharts(data.utilisationSeries);
    this.renderRouteLoad(data.routeLoad);
    this.renderFleetMix(k);
    this.renderCompliance(data.complianceAlerts);
    this.renderIncidents(data.recentIncidents);
    this.renderWorkshop(data.upcomingMaintenance);
  },

  statCard(label, value, foot, tone, icon) {
    return `<div class="stat ${tone}">
      <div class="label"><span>${icon}</span>${escapeHtml(label)}</div>
      <div class="value">${value}</div>
      <div class="foot">${foot}</div>
    </div>`;
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
    document.getElementById('chart-trips').innerHTML = Chart.bars(
      series.map((s) => ({ label: Fmt.dateShort(s.date), sub: Fmt.weekday(s.date), values: [s.completed, s.cancelled] })),
      { series: ['Completed', 'Cancelled'], colors: ['#1a80c4', '#b91c1c'], height: 215 },
    );

    document.getElementById('chart-km').innerHTML = Chart.line(
      series.map((s) => ({ label: Fmt.dateShort(s.date), value: s.km })),
      { color: '#15803d', fill: 'rgba(21,128,61,.13)', height: 215, label: 'km' },
    );
  },

  renderRouteLoad(rows) {
    document.getElementById('route-load').innerHTML = Chart.hbars(
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
    document.getElementById('fleet-mix').innerHTML = Chart.donut(
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
