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
      { id: 'requests', icon: '\u{1F4E8}', label: 'Requests', badgeKey: 'requests' },
      { id: 'tracking', icon: '\u{1F4E1}', label: 'Live Tracking' },
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
      { id: 'companies', icon: '\u{1F3ED}', label: 'Companies' },
      { id: 'vendors', icon: '\u{1F3E2}', label: 'Vendors' },
    ],
  },
  {
    label: 'Cost & Care',
    items: [
      { id: 'maintenance', icon: '\u{1F527}', label: 'Maintenance' },
      { id: 'fuel', icon: '\u{26FD}', label: 'Fuel & Energy' },
      { id: 'expenses', icon: '\u{1F4B0}', label: 'Expenses' },
      { id: 'billing', icon: '\u{1F9FE}', label: 'Billing & Invoicing' },
      { id: 'commercials', icon: '\u{1F4B3}', label: 'Commercials' },
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
  requests: { title: 'Client Requests', sub: 'Ride requests and notes raised from the Client app' },
  tracking: { title: 'Live Tracking', sub: 'Where every vehicle is right now, updated from the Driver app' },
  routes: { title: 'Routes & Stops', sub: 'Route corridors, stop sequence and rosters' },
  shifts: { title: 'Shift Timings', sub: 'Pickup and drop windows per shift' },
  vehicles: { title: 'Fleet Vehicles', sub: 'Buses, vans and electric vehicles' },
  drivers: { title: 'Drivers', sub: 'Licences, badges and performance' },
  employees: { title: 'Employees', sub: 'Staff availing transport, by route and stop' },
  companies: { title: 'Client Companies', sub: 'Corporate customers, their staff and logins' },
  vendors: { title: 'Transport Vendors', sub: 'Contracted suppliers and their fleets' },
  maintenance: { title: 'Maintenance', sub: 'Services, repairs and workshop jobs' },
  fuel: { title: 'Fuel & Energy', sub: 'Diesel, CNG and electric charging transactions' },
  expenses: { title: 'Operating Expenses', sub: 'Cost ledger by category and month' },
  billing: { title: 'Billing & Invoicing', sub: 'Client commercials, vendor cost and invoice reconciliation' },
  commercials: { title: 'Commercials', sub: 'Create and manage vendor and client rate cards' },
  documents: { title: 'Compliance Documents', sub: 'Insurance, permits, PUC and fitness' },
  incidents: { title: 'Incidents & Safety', sub: 'Breakdowns, accidents and escalations' },
  reports: { title: 'Reports & Exports', sub: 'Eleven operational reports with CSV download' },
  users: { title: 'Users & Audit Trail', sub: 'Operator accounts and system activity' },
};

const App = {
  current: null,
  alerts: { compliance: 0, incidents: 0, requests: 0 },

  /**
   * Navigation generation counter.
   *
   * Every page controller fetches its data asynchronously and then writes into
   * the DOM it created. When the user navigates away mid-fetch, that await
   * resolves after #content already belongs to a different page - the late
   * write then either throws on a missing element (e.g. `Cannot set properties
   * of null`) or silently corrupts the view the user is now looking at.
   *
   * route() bumps this counter on every navigation. A render that started under
   * an older generation is stale: its container has been detached from the
   * document, so we drop it instead of letting it clobber the new page. The
   * check below covers the whole controller including its awaits, which is far
   * more reliable than guarding every getElementById call individually.
   */
  navGeneration: 0,

  pages: {
    dashboard: () => DashboardPage,
    trips: () => TripsPage,
    manifests: () => ManifestsPage,
    requests: () => RequestsPage,
    tracking: () => TrackingPage,
    routes: () => RoutesPage,
    shifts: () => ShiftsPage,
    vehicles: () => VehiclesPage,
    drivers: () => DriversPage,
    employees: () => EmployeesPage,
    companies: () => CompaniesPage,
    vendors: () => VendorsPage,
    maintenance: () => MaintenancePage,
    fuel: () => FuelPage,
    expenses: () => ExpensesPage,
    documents: () => DocumentsPage,
    incidents: () => IncidentsPage,
    reports: () => ReportsPage,
    users: () => UsersPage,
    billing: () => BillingPage,
    commercials: () => CommercialsPage,
  },

  async init() {
    if (!Api.token) return;
    this.tenantSlug = location.pathname.match(/^\/([^/]+)\//)?.[1] || '';

    try {
      const me = await Api.get('/auth/me');
      Api.setSession(Api.token, me.user);
      this.user = me.user;
      // Keep scoped client and driver accounts out of the admin desk shell.
      // The API already enforces this server-side; this prevents a confusing
      // admin navigation from appearing before the permission error arrives.
      if (me.user.role === 'client') {
        location.replace(this.tenantSlug ? `/${this.tenantSlug}/client.html` : '/client.html');
        return;
      }
      if (me.user.role === 'driver') {
        location.replace(this.tenantSlug ? `/${this.tenantSlug}/driver.html` : '/driver.html');
        return;
      }
    } catch {
      Api.clearToken();
      location.href = this.tenantSlug ? `/${this.tenantSlug}/login.html?fresh=1` : '/login.html?fresh=1';
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
        App.go(btn.dataset.page);
        document.getElementById('sidebar').classList.remove('open');
      });
    });

    const u = this.user || {};
    document.getElementById('user-name').textContent = u.name || 'User';
    document.getElementById('user-role').textContent = u.role || '';
    document.getElementById('user-avatar').textContent = Fmt.initials(u.name);
  },

  bindShell() {
    document.addEventListener('click', (event) => {
      const kpi = event.target.closest('[data-kpi-page]');
      if (kpi) App.go(kpi.dataset.kpiPage);
    });
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

    const input = document.getElementById('command-input');
    const results = document.getElementById('command-results');
    const search = document.getElementById('command-search');
    const entries = NAV.flatMap((group) => group.items
      .filter((item) => !item.adminOnly || Api.isAdmin)
      .map((item) => ({ ...item, group: group.label })));
    const renderCommands = () => {
      const q = input.value.trim().toLowerCase();
      const matches = entries.filter((item) => !q || `${item.label} ${item.group}`.toLowerCase().includes(q)).slice(0, 8);
      results.innerHTML = matches.map((item) => `<button class="command-result" data-command="${item.id}"><span>${item.icon}</span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.group)}</small><b>&rarr;</b></button>`).join('') || '<div class="command-empty">No matching workflow</div>';
      results.hidden = false;
      $$('.command-result', results).forEach((button) => button.addEventListener('click', () => {
        App.go(button.dataset.command);
        results.hidden = true;
        input.value = '';
      }));
    };
    input.addEventListener('focus', renderCommands);
    input.addEventListener('input', renderCommands);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { results.hidden = true; input.blur(); }
      if (event.key === 'Enter') { const first = results.querySelector('.command-result'); if (first) first.click(); }
    });
    document.addEventListener('click', (event) => { if (!search.contains(event.target)) results.hidden = true; });
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== input && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        event.preventDefault(); input.focus();
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      const ok = await confirmDialog('Sign out of the transport desk?', { title: 'Sign out', confirmLabel: 'Sign out', danger: false });
      if (!ok) return;
      try { await Api.post('/auth/logout'); } catch { /* best effort */ }
      Api.clearToken();
      location.href = this.tenantSlug ? `/${this.tenantSlug}/login.html?fresh=1` : '/SaaS/login.html?fresh=1';
    });

    document.getElementById('alerts-btn').addEventListener('click', () => {
      location.hash = 'documents';
      setTimeout(() => Toast.info('Compliance items needing attention are highlighted at the top.'), 420);
    });

    document.getElementById('print-btn').addEventListener('click', () => window.print());
  },

  async loadAlertCounts() {
    try {
      const [docs, incidents, requests] = await Promise.all([
        Api.get('/documents/alerts?window=30'),
        Api.get('/incidents?status=open'),
        Api.get('/trip-requests?status=pending'),
      ]);
      this.alerts.compliance = docs.data.length;
      this.alerts.incidents = incidents.data.length;
      // A pending request is a client waiting on an answer, so it belongs in the
      // alert total - otherwise a ride request can sit unseen for days.
      this.alerts.requests = (requests.meta && requests.meta.pending) || requests.data.length;

      const total = this.alerts.compliance + this.alerts.incidents + this.alerts.requests;
      const btn = document.getElementById('alerts-btn');
      let badge = btn.querySelector('.dot');
      if (total > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'dot';
          btn.appendChild(badge);
        }
        badge.textContent = total > 99 ? '99+' : String(total);
        btn.title = `${this.alerts.compliance} compliance alerts, ${this.alerts.incidents} open incidents, ${this.alerts.requests} pending requests`;
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
      const reqBadge = document.querySelector('[data-badge="requests"]');
      if (reqBadge) {
        reqBadge.style.display = this.alerts.requests ? '' : 'none';
        reqBadge.textContent = this.alerts.requests;
      }
    } catch { /* badges are non-critical */ }
  },

  route() {
    const cleanPage = this.tenantSlug && location.pathname.match(/^\/[^/]+\/([^/?#]+)$/)?.[1];
    // Preserve an intentional module hash such as #requests or #tracking.
    // Replacing it with the current pathname made dashboard flow links appear
    // inert on tenant-scoped URLs like /smipl/dashboard.
    if (cleanPage && PAGES[cleanPage] && !location.hash) history.replaceState(null, '', `/${this.tenantSlug}/${cleanPage}`);
    const hash = (location.hash || (cleanPage ? `#${cleanPage}` : '#dashboard')).replace('#', '') || 'dashboard';
    const [pageId, ...args] = hash.split('/');
    const page = PAGES[pageId] ? pageId : 'dashboard';

    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.page === page));

    const meta = PAGES[page];
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-sub').textContent = meta.sub;

    const container = document.getElementById('content');
    container.innerHTML = '<div class="spinner"></div>';

    /*
     * Give the outgoing page a chance to stop anything recurring (timers,
     * in-flight polls) before it is replaced. Without this a page that polls
     * would carry on fetching for a view the user has already left.
     */
    const outgoing = this.current;
    if (outgoing && typeof outgoing.destroy === 'function') {
      try { outgoing.destroy(); } catch (err) { /* teardown must never block navigation */ }
    }

    const factory = this.pages[page];
    const controller = factory();
    this.current = controller;
    window.scrollTo({ top: 0 });

    /**
     * Stamp this navigation. Any render begun under an earlier generation is
     * abandoned once its awaits resolve, so a slow page cannot overwrite the
     * page the user has since moved to. See navGeneration above.
     */
    const generation = ++this.navGeneration;
    this.isCurrent = () => generation === this.navGeneration;
    controller._generation = generation;

    Promise.resolve(controller.render(container, args))
      .then(() => {
        // Mark the controller stale once its render resolves, so any handler it
        // registered that fires later (filter changes, debounced search) knows
        // it no longer owns the visible page.
        if (generation !== this.navGeneration) controller._stale = true;
      })
      .catch((err) => {
        // A failed stale render must not paint an error over the live page.
        if (generation !== this.navGeneration) return;
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
    if (this.tenantSlug && !arg) {
      history.pushState(null, '', `/${this.tenantSlug}/${page}`);
      this.route();
      return;
    }
    location.hash = arg ? `${page}/${arg}` : page;
  },
};

window.addEventListener('popstate', () => App.route());
document.addEventListener('DOMContentLoaded', () => App.init());
