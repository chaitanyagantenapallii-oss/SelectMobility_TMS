'use strict';

/* ==========================================================================
   Application shell: sidebar navigation, topbar, hash router
   ========================================================================== */

const NAV = [
  {
    label: 'Operations',
    items: [
      { id: 'dashboard', icon: '\u{1F4CA}', label: 'Dashboard' },
      { id: 'trips', icon: '\u{1F68C}', label: 'Trip Logs' },
      { id: 'manifests', icon: '\u{1F4CB}', label: 'Manifests & Boarding' },
      { id: 'routes', icon: '\u{1F5FA}', label: 'Routes & Stops' },
      { id: 'shifts', icon: '\u{23F0}', label: 'Shift Timings' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { id: 'vehicles', icon: '\u{1F699}', label: 'Fleet Vehicles' },
      { id: 'drivers', icon: '\u{1F464}', label: 'Drivers' },
      { id: 'employees', icon: '\u{1F465}', label: 'Employees' },
      { id: 'vendors', icon: '\u{1F3E2}', label: 'Vendors' },
    ],
  },
  {
    label: 'Cost & Care',
    items: [
      { id: 'maintenance', icon: '\u{1F527}', label: 'Maintenance' },
      { id: 'fuel', icon: '\u{26FD}', label: 'Fuel & Energy' },
      { id: 'expenses', icon: '\u{1F4B0}', label: 'Expenses' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { id: 'documents', icon: '\u{1F4C4}', label: 'Documents' },
      { id: 'incidents', icon: '\u{1F6A8}', label: 'Incidents' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { id: 'reports', icon: '\u{1F4C8}', label: 'Reports & Exports' },
      { id: 'users', icon: '\u{1F510}', label: 'Users & Audit', adminOnly: true },
    ],
  },
];

const PAGES = {
  dashboard: { title: 'Operations Dashboard', sub: 'Fleet health, shift coverage and today at a glance' },
  trips: { title: 'Trip Logs', sub: 'Every vehicle run, with variance and occupancy' },
  manifests: { title: 'Manifests & Boarding', sub: 'Passenger lists and digital boarding' },
  routes: { title: 'Routes & Stops', sub: 'Route corridors, stop sequence and rosters' },
  shifts: { title: 'Shift Timings', sub: 'Pickup and drop windows per shift' },
  vehicles: { title: 'Fleet Vehicles', sub: 'Buses, vans and electric vehicles' },
  drivers: { title: 'Drivers', sub: 'Licences, badges and performance' },
  employees: { title: 'Employees', sub: 'Staff availing transport, by route and stop' },
  vendors: { title: 'Transport Vendors', sub: 'Contracted suppliers and their fleets' },
  maintenance: { title: 'Maintenance', sub: 'Services, repairs and workshop jobs' },
  fuel: { title: 'Fuel & Energy', sub: 'Diesel, CNG and electric charging transactions' },
  expenses: { title: 'Operating Expenses', sub: 'Cost ledger by category and month' },
  documents: { title: 'Compliance Documents', sub: 'Insurance, permits, PUC and fitness' },
  incidents: { title: 'Incidents & Safety', sub: 'Breakdowns, accidents and escalations' },
  reports: { title: 'Reports & Exports', sub: 'Eleven operational reports with CSV download' },
  users: { title: 'Users & Audit Trail', sub: 'Operator accounts and system activity' },
};

const App = {
  current: null,
  alerts: { compliance: 0, incidents: 0 },

  pages: {
    dashboard: () => DashboardPage,
    trips: () => TripsPage,
    manifests: () => ManifestsPage,
    routes: () => RoutesPage,
    shifts: () => ShiftsPage,
    vehicles: () => VehiclesPage,
    drivers: () => DriversPage,
    employees: () => EmployeesPage,
    vendors: () => VendorsPage,
    maintenance: () => MaintenancePage,
    fuel: () => FuelPage,
    expenses: () => ExpensesPage,
    documents: () => DocumentsPage,
    incidents: () => IncidentsPage,
    reports: () => ReportsPage,
    users: () => UsersPage,
  },

  async init() {
    if (!Api.token) return;

    try {
      const me = await Api.get('/auth/me');
      Api.setSession(Api.token, me.user);
      this.user = me.user;
    } catch {
      Api.clearToken();
      location.href = '/login.html';
      return;
    }

    this.buildNav();
    this.bindShell();
    document.getElementById('app').classList.add('ready');

    window.addEventListener('hashchange', () => this.route());
    this.route();
    this.loadAlertCounts();
    // Refresh alert badges periodically without disturbing the current view.
    setInterval(() => this.loadAlertCounts(), 180000);
  },

  buildNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = NAV.map((group) => {
      const items = group.items
        .filter((item) => !item.adminOnly || Api.isAdmin)
        .map((item) => `
          <button class="nav-item" data-page="${item.id}">
            <span class="ico">${item.icon}</span>
            <span>${escapeHtml(item.label)}</span>
            <span class="badge" data-badge="${item.id}" style="display:none">0</span>
          </button>`)
        .join('');
      if (!items) return '';
      return `<div class="nav-group"><div class="label">${escapeHtml(group.label)}</div>${items}</div>`;
    }).join('');

    $$('.nav-item', nav).forEach((btn) => {
      btn.addEventListener('click', () => {
        location.hash = btn.dataset.page;
        document.getElementById('sidebar').classList.remove('open');
      });
    });

    const u = this.user || {};
    document.getElementById('user-name').textContent = u.name || 'User';
    document.getElementById('user-role').textContent = u.role || '';
    document.getElementById('user-avatar').textContent = Fmt.initials(u.name);
  },

  bindShell() {
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    document.getElementById('user-chip').addEventListener('click', () => {
      const u = this.user || {};
      const modal = openModal({
        title: 'Account',
        body: `
          <div class="kv">
            <dt>Name</dt><dd>${escapeHtml(u.name)}</dd>
            <dt>Email</dt><dd>${escapeHtml(u.email)}</dd>
            <dt>Role</dt><dd style="text-transform:capitalize">${escapeHtml(u.role)}</dd>
            <dt>Session</dt><dd class="text-muted">Bearer token, expires after ${escapeHtml(String(12))} hours</dd>
          </div>
          <div class="divider"></div>
          <div class="section-title">Change password</div>
          <div class="field">
            <label for="cur-pass">Current password</label>
            <input type="password" id="cur-pass" autocomplete="current-password">
          </div>
          <div class="field">
            <label for="new-pass">New password <span class="hint">(minimum 8 characters)</span></label>
            <input type="password" id="new-pass" autocomplete="new-password">
          </div>
          <div class="field error" id="pw-error" style="display:none"></div>`,
        footer: `<button class="btn" data-close>Close</button>
                 <button class="btn primary" id="pw-save">Update password</button>`,
      });

      document.getElementById('pw-save', modal.el).addEventListener('click', async () => {
        const errBox = document.getElementById('pw-error', modal.el);
        errBox.style.display = 'none';
        try {
          await Api.post('/auth/change-password', {
            currentPassword: document.getElementById('cur-pass', modal.el).value,
            newPassword: document.getElementById('new-pass', modal.el).value,
          });
          Toast.ok('Password updated successfully.');
          modal.close();
        } catch (err) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        }
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      const ok = await confirmDialog('Sign out of the transport desk?', { title: 'Sign out', confirmLabel: 'Sign out', danger: false });
      if (!ok) return;
      try { await Api.post('/auth/logout'); } catch { /* best effort */ }
      Api.clearToken();
      location.href = '/login.html';
    });

    document.getElementById('alerts-btn').addEventListener('click', () => {
      location.hash = 'documents';
      setTimeout(() => Toast.info('Compliance items needing attention are highlighted at the top.'), 420);
    });

    document.getElementById('print-btn').addEventListener('click', () => window.print());
  },

  async loadAlertCounts() {
    try {
      const [docs, incidents] = await Promise.all([
        Api.get('/documents/alerts?window=30'),
        Api.get('/incidents?status=open'),
      ]);
      this.alerts.compliance = docs.data.length;
      this.alerts.incidents = incidents.data.length;

      const total = this.alerts.compliance + this.alerts.incidents;
      const btn = document.getElementById('alerts-btn');
      let badge = btn.querySelector('.dot');
      if (total > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'dot';
          btn.appendChild(badge);
        }
        badge.textContent = total > 99 ? '99+' : String(total);
        btn.title = `${this.alerts.compliance} compliance alerts, ${this.alerts.incidents} open incidents`;
      } else if (badge) {
        badge.remove();
      }

      const docBadge = document.querySelector('[data-badge="documents"]');
      if (docBadge) {
        docBadge.style.display = this.alerts.compliance ? '' : 'none';
        docBadge.textContent = this.alerts.compliance;
      }
      const incBadge = document.querySelector('[data-badge="incidents"]');
      if (incBadge) {
        incBadge.style.display = this.alerts.incidents ? '' : 'none';
        incBadge.textContent = this.alerts.incidents;
      }
    } catch { /* badges are non-critical */ }
  },

  route() {
    const hash = (location.hash || '#dashboard').replace('#', '') || 'dashboard';
    const [pageId, ...args] = hash.split('/');
    const page = PAGES[pageId] ? pageId : 'dashboard';

    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.page === page));

    const meta = PAGES[page];
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-sub').textContent = meta.sub;

    const container = document.getElementById('content');
    container.innerHTML = '<div class="spinner"></div>';

    const factory = this.pages[page];
    const controller = factory();
    this.current = controller;
    window.scrollTo({ top: 0 });

    Promise.resolve(controller.render(container, args)).catch((err) => {
      container.innerHTML = `
        <div class="card"><div class="empty">
          <div class="ico">&#9888;&#65039;</div>
          <h4>Could not load this page</h4>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn primary" onclick="App.route()">Retry</button>
        </div></div>`;
    });
  },

  /** Navigate programmatically. */
  go(page, arg) {
    location.hash = arg ? `${page}/${arg}` : page;
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
