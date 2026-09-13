'use strict';

/* ==========================================================================
   Client app
   ==========================================================================

   The view a client organisation's transport contact gets: their own staff,
   their own trips, their own bill, and a way to raise a request.

   Everything here is scoped by the server to one organisation. This page
   never filters as a security measure; it filters for readability. If the
   server ever returned another organisation's rows, the mistake would be
   visible, not hidden.
   ========================================================================== */

(() => {
  const view = $('#view');
  const title = $('#bar-title');
  const sub = $('#bar-sub');

  let me = null;
  let tab = (location.hash || '#overview').slice(1);
  if (!['overview', 'roster', 'history', 'statement', 'requests'].includes(tab)) tab = 'overview';

  /* --- Boot -------------------------------------------------------------- */

  async function boot() {
    if (!(await Mobile.requireRole('client', '/login.html'))) return;

    Mobile.watchConnectivity();
    Mobile.registerWorker();

    $('#btn-signout').addEventListener('click', () => Mobile.signOut());
    $('#btn-refresh').addEventListener('click', () => refresh(true));

    $$('.tabbar button').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab;
        history.replaceState(null, '', `#${tab}`);
        render();
      });
    });

    await refresh(false);
  }

  async function refresh(announce) {
    try {
      me = await Api.get('/mobile/client/me');
      Mobile.saveSnapshot('client_me', me);
      document.body.classList.remove('offline');
    } catch (err) {
      if (err.status === 401) return;
      const snap = Mobile.readSnapshot('client_me');
      if (snap) {
        me = snap.data;
        Mobile.toast(`Offline \u2014 showing data from ${Mobile.snapshotAge(snap)}`, 'err');
      } else {
        view.innerHTML = Mobile.empty('\u{1F4F6}', 'Cannot reach the office', err.message);
        return;
      }
    }

    if (announce) Mobile.toast('Refreshed', 'ok');
    render();
  }

  function render() {
    $$('.tabbar button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === tab)));
    if (!me) return;

    sub.textContent = me.organisation;

    if (tab === 'overview') return renderOverview();
    if (tab === 'roster') return renderRoster();
    if (tab === 'history') return renderHistory();
    if (tab === 'statement') return renderStatement();
    return renderRequests();
  }

  /* --- Overview ---------------------------------------------------------- */

  function renderOverview() {
    title.textContent = 'Live status';
    const s = me.stats || {};
    const trips = me.liveTrips || [];

    view.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">On the road</div><div class="v">${s.onRoad ?? 0}</div></div>
        <div class="stat"><div class="k">Done today</div><div class="v">${s.completed ?? 0}</div></div>
        <div class="stat"><div class="k">Scheduled</div><div class="v">${s.tripsScheduledToday ?? 0}</div></div>
        <div class="stat"><div class="k">My staff</div><div class="v">${s.employeesRegistered ?? 0}</div></div>
      </div>

      <h2 style="margin:4px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim)">
        Today's vehicles
      </h2>
      ${trips.length ? trips.map(tripCard).join('') : Mobile.empty('\u{1F68C}', 'No vehicles out yet', 'Trips for today will appear here as they start.')}`;

    $$('.trip', view).forEach((el) =>
      el.addEventListener('click', () => showTripDetail(el.dataset.id))
    );
  }

  function tripCard(trip) {
    const p = trip.passengers || { allocated: 0, boarded: 0 };
    return `<button class="trip" data-id="${trip.id}">
      <div class="top">
        <span class="route">${escapeHtml(trip.route.code)} &middot; ${escapeHtml(trip.route.name)}</span>
        ${Mobile.badgeFor(trip.status)}
      </div>
      <div class="meta">
        ${escapeHtml(trip.vehicle.regNo)} &middot; ${escapeHtml(trip.driver.name)}
        &middot; from ${escapeHtml(trip.shift.pickupStart)}
      </div>
      <div class="meta" style="margin-top:6px">
        <strong>${p.boarded}</strong> of ${p.allocated} of my staff on board
      </div>
      ${Mobile.progress(p.allocated, p.boarded)}
    </button>`;
  }

  /** Reuse the driver manifest view's shape, but read-only. */
  async function showTripDetail(tripId) {
    title.textContent = 'Trip detail';
    view.innerHTML = Mobile.skeleton(4);

    try {
      const data = await Api.get(`/mobile/driver/trips/${tripId}`);
      const t = data.trip;
      const pax = data.passengers || [];

      view.innerHTML = `
        <button class="btn sm" id="back" style="margin-bottom:12px">&larr; Back</button>
        <div class="card">
          <div class="row between" style="margin-bottom:8px">
            <h2 style="margin:0">${escapeHtml(t.route.name)}</h2>
            ${Mobile.badgeFor(t.status)}
          </div>
          <div class="kv"><span class="k">Date</span><span class="v">${Fmt.date(t.date)}</span></div>
          <div class="kv"><span class="k">Vehicle</span><span class="v">${escapeHtml(t.vehicle.regNo)}</span></div>
          <div class="kv"><span class="k">Driver</span><span class="v">${escapeHtml(t.driver.name)}</span></div>
          <div class="kv"><span class="k">On board</span><span class="v">${t.passengers.boarded} / ${t.passengers.allocated}</span></div>
        </div>
        <div class="card">
          <h2>My staff on this trip <span class="count">${pax.length}</span></h2>
          ${pax.length
            ? pax.map((p) => `<div class="pax ${p.status === 'boarded' || p.status === 'completed' ? 'done' : ''}">
                <div class="who">
                  <div class="nm">${escapeHtml(p.name)}</div>
                  <div class="mt">${escapeHtml(p.code)} &middot; ${escapeHtml(p.stop || 'no stop')}</div>
                </div>
                <span class="badge ${p.status === 'boarded' || p.status === 'completed' ? 'ok' : ''}">
                  ${escapeHtml(p.status === 'completed' ? 'boarded' : p.status)}
                </span>
              </div>`).join('')
            : '<p class="muted">None of your staff are on this route.</p>'}
        </div>`;

      $('#back', view).addEventListener('click', () => render());
    } catch (err) {
      view.innerHTML = Mobile.empty('\u26A0', 'Could not open this trip', err.message);
    }
  }

  /* --- Roster ------------------------------------------------------------ */

  async function renderRoster() {
    title.textContent = 'My staff';
    view.innerHTML = Mobile.skeleton(5);

    let rows;
    try {
      const res = await Api.get('/mobile/client/roster');
      // The list endpoints answer with the usual { data, meta } envelope.
      rows = res.data || [];
      Mobile.saveSnapshot('client_roster', rows);
    } catch (err) {
      const snap = Mobile.readSnapshot('client_roster');
      if (!snap) {
        view.innerHTML = Mobile.empty('\u26A0', 'Could not load your staff', err.message);
        return;
      }
      rows = snap.data;
    }

    if (!rows.length) {
      view.innerHTML = Mobile.empty('\u{1F465}', 'No staff registered', 'Your employees will appear here once the office adds them.');
      return;
    }

    // Group by the route each person travels on, which is how the client
    // thinks about their staff: who is on which bus.
    const byRoute = new Map();
    for (const e of rows) {
      const key = e.routeCode && e.routeCode !== '-'
        ? `${e.routeCode} \u00B7 ${e.routeName}`
        : 'Not on a route';
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key).push(e);
    }

    view.innerHTML = `
      <div class="card flat" style="padding:12px 14px">
        <div class="row between">
          <span class="muted">${rows.length} staff across ${byRoute.size} route${byRoute.size === 1 ? '' : 's'}</span>
          <span class="muted">${rows.filter((e) => e.status === 'active').length} active</span>
        </div>
      </div>
      ${[...byRoute.entries()].map(([route, people]) => `
        <div class="card">
          <h2>${escapeHtml(route)} <span class="count">${people.length}</span></h2>
          ${people.map((e) => `
            <div class="pax" style="cursor:pointer" data-emp="${e.id}">
              <div class="who">
                <div class="nm">${escapeHtml(e.name)}</div>
                <div class="mt">${escapeHtml(e.code)} &middot; ${escapeHtml(e.department)} &middot; ${escapeHtml(e.stop || 'no stop')}</div>
              </div>
              ${Mobile.badgeFor(e.status)}
            </div>`).join('')}
        </div>`).join('')}`;

    $$('[data-emp]', view).forEach((el) =>
      el.addEventListener('click', () => showEmployee(el.dataset.emp))
    );
  }

  /* --- Employee history -------------------------------------------------- */

  async function showEmployee(employeeId) {
    title.textContent = 'Travel history';
    view.innerHTML = Mobile.skeleton(4);

    try {
      const res = await Api.get(`/mobile/client/history?employeeId=${encodeURIComponent(employeeId)}`);
      const rows = res.data || [];
      // The history rows carry the employee's own name, so the header can be
      // taken from the first row rather than a second round trip.
      const emp = rows[0] || {};

      const present = rows.filter((r) => r.boardedAt).length;
      const rate = rows.length ? Math.round((present / rows.length) * 100) : 0;

      view.innerHTML = `
        <button class="btn sm" id="back" style="margin-bottom:12px">&larr; Back</button>
        <div class="card">
          <h2>${escapeHtml(emp.employeeName || 'Staff member')}</h2>
          <div class="kv"><span class="k">Code</span><span class="v">${escapeHtml(emp.employeeId || '-')}</span></div>
          <div class="kv"><span class="k">Usual pickup</span><span class="v">${escapeHtml(emp.stop || '-')}</span></div>
          <div class="kv"><span class="k">Trips recorded</span><span class="v">${rows.length}</span></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">Trips</div><div class="v">${rows.length}</div></div>
          <div class="stat"><div class="k">Carried</div><div class="v">${present}</div></div>
          <div class="stat"><div class="k">Used the bus</div><div class="v">${rate}<small>%</small></div></div>
          <div class="stat"><div class="k">No-shows</div><div class="v">${rows.filter((r) => r.status === 'no-show').length}</div></div>
        </div>
        <div class="card">
          <h2>Recent trips</h2>
          ${rows.length ? rows.map((r) => `
            <div class="row between" style="padding:9px 0;border-bottom:1px dashed var(--border)">
              <div>
                <div style="font-weight:600">${Fmt.date(r.date)}</div>
                <div class="tiny">${escapeHtml(r.routeCode)} &middot; ${escapeHtml(r.stop || 'no stop')}</div>
              </div>
              ${Mobile.badgeFor(r.boardedAt ? 'boarded' : r.status)}
            </div>`).join('') : '<p class="muted">No trips recorded yet.</p>'}
        </div>`;

      $('#back', view).addEventListener('click', () => renderRoster());
    } catch (err) {
      view.innerHTML = Mobile.empty('\u26A0', 'Could not load history', err.message);
    }
  }

  /* --- History (whole organisation) -------------------------------------- */

  async function renderHistory() {
    title.textContent = 'Trip history';
    view.innerHTML = Mobile.skeleton(5);

    let rows;
    try {
      const res = await Api.get('/mobile/client/history');
      rows = res.data || [];
      Mobile.saveSnapshot('client_history', rows);
    } catch (err) {
      const snap = Mobile.readSnapshot('client_history');
      if (!snap) {
        view.innerHTML = Mobile.empty('\u26A0', 'Could not load history', err.message);
        return;
      }
      rows = snap.data;
    }

    if (!rows.length) {
      view.innerHTML = Mobile.empty('\u{1F5D3}', 'No trips yet', 'Trips carrying your staff will be listed here.');
      return;
    }

    const carried = rows.filter((r) => r.boardedAt).length;
    const routes = new Set(rows.map((r) => r.routeCode)).size;

    view.innerHTML = `
      <div class="card flat" style="padding:12px 14px">
        <div class="row between">
          <span class="muted">${rows.length} staff journeys</span>
          <span class="muted">${routes} route${routes === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${rows.map((r) => `
        <div class="card" style="padding:13px 14px">
          <div class="row between" style="margin-bottom:4px">
            <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.employeeName || 'Staff member')}</strong>
            ${Mobile.badgeFor(r.boardedAt ? 'boarded' : r.status)}
          </div>
          <div class="tiny">${Fmt.date(r.date)} &middot; ${escapeHtml(r.routeCode)} \u00B7 ${escapeHtml(r.routeName || '')}</div>
          <div class="tiny" style="margin-top:4px">${escapeHtml(r.stop || 'no stop')}</div>
        </div>`).join('')}`;
  }

  /* --- Statement --------------------------------------------------------- */

  async function renderStatement() {
    title.textContent = 'Statement';
    view.innerHTML = Mobile.skeleton(5);

    let data;
    try {
      data = await Api.get('/mobile/client/statement');
      Mobile.saveSnapshot('client_statement', data);
    } catch (err) {
      const snap = Mobile.readSnapshot('client_statement');
      if (!snap) {
        view.innerHTML = Mobile.empty('\u26A0', 'Could not load the statement', err.message);
        return;
      }
      data = snap.data;
    }

    const lines = data.lines || [];
    const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
    const km = lines.reduce((a, l) => a + (Number(l.km) || 0), 0);
    const seatKm = lines.reduce((a, l) => a + (Number(l.km) || 0) * (Number(l.staffBoarded) || 0), 0);

    view.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Amount due</div><div class="v">${Fmt.compactMoney(total)}</div></div>
        <div class="stat"><div class="k">Trips billed</div><div class="v">${lines.filter((l) => l.amount > 0).length}</div></div>
        <div class="stat"><div class="k">Distance</div><div class="v">${Fmt.num(km, 0)}<small> km</small></div></div>
        <div class="stat"><div class="k">Staff carried</div><div class="v">${lines.reduce((a, l) => a + (l.staffBoarded || 0), 0)}</div></div>
      </div>

      <div class="card">
        <div class="row between" style="margin-bottom:4px">
          <h2 style="margin:0">${escapeHtml(data.month || '')}</h2>
          <span class="muted">${Fmt.money(total)}</span>
        </div>
        <p class="tiny" style="margin:6px 0 0">
          Charged on seat-kilometres: a run that carried nobody is not billed for distance.
        </p>
      </div>

      ${lines.length ? `
        <div class="card">
          <div class="tablewrap">
            <table>
              <thead><tr>
                <th>Date</th><th>Route</th><th>Vehicle</th>
                <th class="num">Km</th><th class="num">Staff</th><th class="num">Amount</th>
              </tr></thead>
              <tbody>
                ${lines.map((l) => `<tr>
                  <td>${Fmt.dateShort(l.date)}</td>
                  <td>${escapeHtml(l.routeCode)}</td>
                  <td>${escapeHtml(l.vehicleRegNo || '-')}</td>
                  <td class="num">${Fmt.num(l.km, 1)}</td>
                  <td class="num">${l.staffBoarded}/${l.staffBooked}</td>
                  <td class="num">${l.amount ? Fmt.money(l.amount) : '\u2014'}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot><tr>
                <td colspan="3">Total</td>
                <td class="num">${Fmt.num(km, 1)}</td>
                <td class="num">${seatKm}</td>
                <td class="num">${Fmt.money(total)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>` : Mobile.empty('\u{1F4C4}', 'Nothing billed this month', 'Trips carrying your staff will be itemised here.')}

      <button class="btn" id="dl">Download as CSV</button>`;

    $('#dl', view).addEventListener('click', async (e) => {
      await Mobile.withBusy(e.currentTarget, 'Preparing', async () => {
        try {
          const rows = [
            ['Date', 'Trip ID', 'Route', 'Vehicle', 'Km', 'Staff booked', 'Staff boarded', 'Amount'],
            ...lines.map((l) => [l.date, l.tripId, l.routeCode, l.vehicleRegNo || '', l.km, l.staffBooked, l.staffBoarded, l.amount]),
            [],
            ['', '', '', '', km, '', seatKm, total],
          ];
          const csv = rows.map((r) => r.map((c) => {
            const v = c === null || c === undefined ? '' : String(c);
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          }).join(',')).join('\n');

          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `SMI-${(data.organisation || 'statement').replace(/\W+/g, '-')}-${data.month || ''}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          Mobile.toast('Statement downloaded', 'ok');
        } catch (err) {
          Mobile.toast(err.message, 'err');
        }
      });
    });
  }

  /* --- Requests ---------------------------------------------------------- */

  async function renderRequests() {
    title.textContent = 'Requests';
    view.innerHTML = Mobile.skeleton(3);

    let rows = [];
    try {
      const res = await Api.get('/mobile/client/requests');
      rows = res.data || [];
      Mobile.saveSnapshot('client_requests', rows);
    } catch (err) {
      const snap = Mobile.readSnapshot('client_requests');
      rows = snap ? snap.data : [];
    }

    view.innerHTML = `
      <div class="card">
        <h2>Raise a request</h2>
        <p class="muted" style="margin-top:0">Ask for a new pickup point, a shift change, or an extra vehicle.</p>
        <div class="grid-2">
          <div class="field">
            <label for="rq-kind">What do you need?</label>
            <select id="rq-kind">
              <option value="route-change">Add or change a pickup point</option>
              <option value="timing">Change a shift timing</option>
              <option value="vehicle">Extra vehicle on a route</option>
              <option value="new-employee">Add a staff member</option>
              <option value="missed-pickup">A pickup was missed</option>
              <option value="other">Something else</option>
            </select>
          </div>
          <div class="field">
            <label for="rq-priority">How urgent?</label>
            <select id="rq-priority">
              <option value="normal" selected>Normal</option>
              <option value="high">Urgent</option>
              <option value="low">Whenever convenient</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="rq-title">Short summary</label>
          <input id="rq-title" maxlength="80" placeholder="e.g. Extra pickup at Blue Ridge Gate">
          <div class="err" id="rq-err"></div>
        </div>
        <div class="field">
          <label for="rq-detail">Details (optional)</label>
          <textarea id="rq-detail" placeholder="Anything the office should know"></textarea>
        </div>
        <button class="btn primary" id="rq-send">Send request</button>
      </div>

      <div class="card">
        <h2>Previous requests <span class="count">${rows.length}</span></h2>
        ${rows.length ? rows.map((r) => `
          <div style="padding:10px 0;border-bottom:1px dashed var(--border)">
            <div class="row between" style="gap:8px">
              <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.subject)}</strong>
              ${Mobile.badgeFor(r.status)}
            </div>
            <div class="tiny" style="margin-top:3px">
              ${escapeHtml(String(r.category || '').replace(/-/g, ' '))}
              ${r.priority && r.priority !== 'normal' ? ` &middot; ${escapeHtml(r.priority)}` : ''}
              &middot; raised ${Fmt.date(r.createdAt)}
            </div>
            ${r.detail ? `<div class="tiny" style="margin-top:4px">${escapeHtml(r.detail)}</div>` : ''}
            ${r.response ? `<div class="tiny" style="margin-top:5px;color:var(--ok)">Office: ${escapeHtml(r.response)}</div>` : ''}
          </div>`).join('') : '<p class="muted">Nothing raised yet.</p>'}
      </div>`;

    $('#rq-send', view).addEventListener('click', (e) => sendRequest(e.currentTarget));
  }

  async function sendRequest(btn) {
    const titleEl = $('#rq-title', view);
    const errEl = $('#rq-err', view);
    const value = titleEl.value.trim();

    // The server requires three characters; checking here just saves a round
    // trip on a bad connection.
    if (value.length < 3) {
      errEl.textContent = 'Give the request a summary the office will understand.';
      titleEl.focus();
      return;
    }
    errEl.textContent = '';

    await Mobile.withBusy(btn, 'Sending', async () => {
      try {
        await Api.post('/mobile/client/requests', {
          category: $('#rq-kind', view).value,
          priority: $('#rq-priority', view).value,
          subject: value,
          detail: $('#rq-detail', view).value.trim(),
        });
        Mobile.toast('Request sent', 'ok');
        await renderRequests();
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  /* --- Start ------------------------------------------------------------- */

  boot().catch((err) => {
    view.innerHTML = Mobile.empty('\u26A0', 'Something went wrong', err.message);
  });
})();
