'use strict';

/* ==========================================================================
   Client companies - the corporate customers the shuttle service is billed to
   ========================================================================== */

/*
 * A company is the scoping unit for the Client app: every employee carries an
 * `organisation`, the mobile roster filters on it, and a client login without
 * one sees nothing at all. So this page is where a new customer is onboarded -
 * create the company, then add their staff from the Employees page.
 */
const CompaniesPage = {
  state: { search: '', status: 'all' },

  async render(container) {
    container.innerHTML = '<div class="spinner"></div>';

    container.innerHTML = `
      <div class="toolbar">
        <div class="search"><input type="text" id="c-search" placeholder="Search company, code, city, GSTIN..." value="${escapeHtml(this.state.search)}"></div>
        <select id="c-status">
          <option value="all">All statuses</option>
          ${['active', 'onboarding', 'suspended'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${Fmt.titleCase(s)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        ${Api.canWrite ? '<button class="btn primary" id="c-new">+ Add Company</button>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Client Companies</h3><span class="desc" id="c-count"></span></div>
        <div class="card-body tight" id="c-table"></div>
      </div>
    `;

    document.getElementById('c-search').addEventListener('input', debounce((e) => { this.state.search = e.target.value; this.load(); }));
    document.getElementById('c-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
    const nb = document.getElementById('c-new');
    if (nb) nb.addEventListener('click', () => this.openForm());

    await this.load();
  },

  async load() {
    const params = new URLSearchParams();
    if (this.state.search) params.set('search', this.state.search);
    if (this.state.status !== 'all') params.set('status', this.state.status);

    const { data } = await Api.get(`/organisations?${params}`);

    // Bail out if the user navigated away while the fetch was in flight.
    const countEl = currentEl('c-count');
    const tableEl = currentEl('c-table');
    if (!countEl || !tableEl) return;

    countEl.textContent = `${data.length} compan${data.length === 1 ? 'y' : 'ies'} registered`;

    tableEl.innerHTML = renderTable({
      rows: data,
      emptyTitle: 'No companies yet',
      emptyText: 'Add the first corporate customer, then put their staff on the roster.',
      columns: [
        { key: 'name', label: 'Company', cls: 'strong' },
        { key: 'code', label: 'Code', cls: 'mono' },
        { key: 'city', label: 'Location' },
        { key: 'contactName', label: 'Contact', render: (r) => `${escapeHtml(r.contactName || '-')}<div class="muted">${escapeHtml(r.contactPhone || '')}</div>` },
        {
          key: 'activeEmployeeCount',
          label: 'Staff',
          align: 'right',
          render: (r) => `${r.activeEmployeeCount}<div class="muted">${r.employeeCount} total</div>`,
        },
        { key: 'tripsServed', label: 'Trips', align: 'right' },
        {
          key: 'userCount',
          label: 'Logins',
          align: 'right',
          render: (r) => (r.userCount
            ? `${r.userCount}`
            : '<span class="pill warn">none</span>'),
        },
        { key: 'contractTill', label: 'Contract till', render: (r) => (r.contractTill ? Fmt.date(r.contractTill) : '-') },
        { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
      ],
      rowActions: (r) => `
        <button class="btn sm" onclick="CompaniesPage.detail('${r.id}')" title="View">&#128065;</button>
        ${Api.canWrite ? `<button class="btn sm" onclick="CompaniesPage.openForm('${r.id}')" title="Edit">&#9998;</button>
        <button class="btn sm danger" onclick="CompaniesPage.remove('${r.id}')" title="Delete">&#128465;</button>` : ''}`,
    });
  },

  async detail(id) {
    const { data: c } = await Api.get(`/organisations/${id}`);

    openModal({
      title: `${c.name}${c.code ? ` \u00B7 ${c.code}` : ''}`,
      wide: true,
      body: `
        <div class="grid cols-4" style="margin-bottom:16px">
          <div class="stat"><div class="label">Active staff</div><div class="value">${c.activeEmployeeCount}</div><div class="foot">${c.employeeCount} on the roster</div></div>
          <div class="stat"><div class="label">Trips served</div><div class="value">${c.tripsServed}</div><div class="foot">${c.boardedCount} boardings</div></div>
          <div class="stat ${c.userCount ? 'ok' : 'warn'}"><div class="label">Client logins</div><div class="value">${c.userCount}</div><div class="foot">${c.userCount ? 'Can sign in' : 'No access yet'}</div></div>
          <div class="stat"><div class="label">Rate per trip</div><div class="value" style="font-size:19px">${c.ratePerTrip ? Fmt.money(c.ratePerTrip) : '-'}</div><div class="foot">${escapeHtml(c.billingCycle || 'monthly')}</div></div>
        </div>

        <div class="grid cols-2">
          <div>
            <div class="section-title">Account details</div>
            <div class="kv">
              <dt>Primary contact</dt><dd>${escapeHtml(c.contactName || '-')}</dd>
              <dt>Role</dt><dd>${escapeHtml(c.contactRole || '-')}</dd>
              <dt>Email</dt><dd>${escapeHtml(c.contactEmail || '-')}</dd>
              <dt>Phone</dt><dd class="mono">${escapeHtml(c.contactPhone || '-')}</dd>
            </div>
          </div>
          <div>
            <div class="section-title">Billing</div>
            <div class="kv">
              <dt>Address</dt><dd>${escapeHtml(c.address || '-')}</dd>
              <dt>City</dt><dd>${escapeHtml(c.city || '-')}</dd>
              <dt>GSTIN</dt><dd class="mono" style="font-size:11.5px">${escapeHtml(c.gstin || '-')}</dd>
              <dt>Contract till</dt><dd>${c.contractTill ? Fmt.date(c.contractTill) : '-'}</dd>
            </div>
          </div>
        </div>

        ${c.notes ? `<div class="divider"></div><div class="section-title">Notes</div><div class="muted" style="font-size:12.5px">${escapeHtml(c.notes)}</div>` : ''}

        <div class="divider"></div>
        <div class="section-title">Client logins (${c.users.length})</div>
        ${c.users.length ? `
          <div class="kv">
            ${c.users.map((u) => `<dt>${escapeHtml(u.name)}</dt><dd class="mono" style="font-size:11.5px">${escapeHtml(u.email)} ${statusPill(u.status)}</dd>`).join('')}
          </div>` : `
          <div class="hint" style="margin-bottom:12px">
            Nobody from ${escapeHtml(c.name)} can sign into the Client app yet.
            Create one under <strong>Users &amp; Audit</strong> with the client role and this company.
          </div>`}

        <div class="section-title" style="margin-top:16px">Boarding stops served (${c.stops.length})</div>
        <div>${c.stops.length ? c.stops.map((s) => `<span class="pill muted" style="margin:2px">${escapeHtml(s)}</span>`).join('') : '<span class="muted">No staff on the roster yet.</span>'}</div>

        <div class="divider"></div>
        <div class="section-title">Staff on this contract (${c.employees.length})</div>
        ${renderTable({
          rows: c.employees,
          columns: [
            { key: 'code', label: 'Code', cls: 'mono' },
            { key: 'name', label: 'Employee', cls: 'strong' },
            { key: 'department', label: 'Department' },
            { key: 'stop', label: 'Boarding stop' },
            { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
          ],
          emptyTitle: 'No staff on this contract yet',
          emptyText: 'Add them from the Employees page and pick this company.',
        })}
      `,
      footer: '<button class="btn" data-close>Close</button>',
    });
  },

  openForm(id) {
    const editing = Boolean(id);
    const modal = openModal({
      title: editing ? `Edit company ${id}` : 'Add a client company',
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Company name <span class="req">*</span></label>
            <input type="text" id="cf-name" placeholder="Bharat Forge Ltd">
          </div>
          <div class="field">
            <label>Short code</label>
            <input type="text" id="cf-code" placeholder="BFL">
          </div>
          <div class="field">
            <label>Industry</label>
            <input type="text" id="cf-industry" placeholder="Forging &amp; Auto Components">
          </div>
          <div class="field">
            <label>Status</label>
            <select id="cf-status">
              ${['active', 'onboarding', 'suspended'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Primary contact</label>
            <input type="text" id="cf-contact" placeholder="Kavita Rao">
          </div>
          <div class="field">
            <label>Contact role</label>
            <input type="text" id="cf-role" placeholder="Facilities Manager">
          </div>
          <div class="field">
            <label>Contact phone</label>
            <input type="text" id="cf-phone" placeholder="+91 98000 00000">
          </div>
          <div class="field">
            <label>Contact email</label>
            <input type="email" id="cf-email" placeholder="name@company.example">
          </div>
          <div class="field">
            <label>Address</label>
            <input type="text" id="cf-address" placeholder="Mundhwa, Pune - 411036">
          </div>
          <div class="field">
            <label>City</label>
            <input type="text" id="cf-city" placeholder="Pune, Maharashtra, India">
          </div>
          <div class="field">
            <label>GSTIN</label>
            <input type="text" id="cf-gstin" placeholder="27AAACB1234C1Z5">
          </div>
          <div class="field">
            <label>Contract till</label>
            <input type="date" id="cf-contract">
          </div>
          <div class="field">
            <label>Rate per trip (Rs)</label>
            <input type="number" id="cf-rate" placeholder="1850" min="0" step="10">
          </div>
          <div class="field">
            <label>Billing cycle</label>
            <select id="cf-cycle">
              ${['monthly', 'fortnightly', 'per-trip'].map((s) => `<option value="${s}">${Fmt.titleCase(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Notes</label>
            <textarea id="cf-notes" placeholder="Shift pattern, boarding points, anything the desk should remember"></textarea>
          </div>
        </div>
        <div class="field error" id="cf-error" style="display:none"></div>`,
      footer: `<button class="btn" data-close>Cancel</button>
               <button class="btn primary" id="cf-save">${editing ? 'Save company' : 'Add company'}</button>`,
    });

    if (editing) {
      Api.get(`/organisations/${id}`).then(({ data: c }) => {
        const set = (elId, value) => { const el = document.getElementById(elId, modal.el); if (el) el.value = value == null ? '' : value; };
        set('cf-name', c.name);
        set('cf-code', c.code);
        set('cf-industry', c.industry);
        set('cf-status', c.status);
        set('cf-contact', c.contactName);
        set('cf-role', c.contactRole);
        set('cf-phone', c.contactPhone);
        set('cf-email', c.contactEmail);
        set('cf-address', c.address);
        set('cf-city', c.city);
        set('cf-gstin', c.gstin);
        set('cf-contract', (c.contractTill || '').slice(0, 10));
        set('cf-rate', c.ratePerTrip);
        set('cf-cycle', c.billingCycle || 'monthly');
        set('cf-notes', c.notes);
      });
    }

    document.getElementById('cf-save', modal.el).addEventListener('click', async () => {
      const errBox = document.getElementById('cf-error', modal.el);
      errBox.style.display = 'none';

      const read = (elId) => {
        const el = document.getElementById(elId, modal.el);
        return el ? el.value.trim() : '';
      };
      const payload = {
        name: read('cf-name'),
        code: read('cf-code'),
        industry: read('cf-industry'),
        status: read('cf-status'),
        contactName: read('cf-contact'),
        contactRole: read('cf-role'),
        contactPhone: read('cf-phone'),
        contactEmail: read('cf-email'),
        address: read('cf-address'),
        city: read('cf-city'),
        gstin: read('cf-gstin'),
        contractTill: read('cf-contract'),
        ratePerTrip: Number(read('cf-rate')) || 0,
        billingCycle: read('cf-cycle'),
        notes: read('cf-notes'),
      };

      if (!payload.name) {
        errBox.textContent = 'Give the company a name.';
        errBox.style.display = 'block';
        return;
      }

      try {
        if (editing) {
          const res = await Api.put(`/organisations/${id}`, payload);
          // A rename moves the staff with it, so say so rather than leaving the
          // user to wonder why the Employees page just changed.
          if (res.data && res.data.renamedFrom) {
            Toast.ok(`Renamed from "${res.data.renamedFrom}". ${res.data.linkedMoved || 0} linked record(s) moved with it.`);
          } else {
            Toast.ok('Company updated.');
          }
        } else {
          await Api.post('/organisations', payload);
          Toast.ok('Company added. Now add their staff from the Employees page.');
        }
        modal.close();
        this.load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    });
  },

  async remove(id) {
    const ok = await confirmDialog(
      `Delete company ${id}? This is refused if any staff or logins are still attached.`,
      { title: 'Delete company', confirmLabel: 'Delete' },
    );
    if (!ok) return;
    try {
      await Api.del(`/organisations/${id}`);
      Toast.ok('Company removed.');
      this.load();
    } catch (err) {
      // The guard message names the blocker, so surface it as-is.
      Toast.error(err.message);
    }
  },
};
