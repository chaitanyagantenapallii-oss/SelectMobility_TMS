'use strict';

/* ==========================================================================
   Driver app
   ==========================================================================

   The four screens a driver actually needs, in the order they need them:

     Today    - what am I driving, and who is on it
     Board    - tick people off at each stop
     History  - what I drove, and what I logged
     Log      - breakdowns and fuel
     Me       - my details, licence expiry, sign out

   Everything that writes goes to the server and is confirmed before the UI
   accepts it. Nothing is queued optimistically: a driver who believes they
   boarded a passenger when the server never heard is worse off than one who
   gets an honest error and taps again.
   ========================================================================== */

(() => {
  const view = $('#view');
  const title = $('#bar-title');
  const sub = $('#bar-sub');

  /** The most recent /driver/me payload. Null until the first load resolves. */
  let home = null;
  /** Which tab is showing, so a failed refresh can restore the right screen. */
  let tab = (location.hash || '#today').slice(1);
  if (!['today', 'history', 'log', 'me'].includes(tab)) tab = 'today';

  /* --- Boot -------------------------------------------------------------- */

  async function boot() {
    if (!(await Mobile.requireRole('driver', '/login.html'))) return;

    Mobile.watchConnectivity();
    Mobile.registerWorker();

    $('#btn-signout').addEventListener('click', () => Mobile.signOut());
    $('#btn-refresh').addEventListener('click', () => refresh(true));

    $$('.tabbar button').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab;
        history.replaceState(null, '', `#${tab}`);
        setTabs();
        render();
      });
    });

    await refresh(false);
  }

  function setTabs() {
    $$('.tabbar button').forEach((b) => {
      b.setAttribute('aria-current', String(b.dataset.tab === tab));
    });
  }

  /**
   * Load the driver's home payload.
   *
   * On failure we fall back to the last snapshot so the driver still sees
   * their manifest, clearly marked as old, instead of a blank screen. The work
   * of boarding still requires the network - the snapshot is for reading only.
   */
  async function refresh(announce) {
    try {
      home = await Api.get('/mobile/driver/me');
      Mobile.saveSnapshot('driver_home', home);
      document.body.classList.remove('offline');
    } catch (err) {
      if (err.status === 401) return;

      const snap = Mobile.readSnapshot('driver_home');
      if (snap) {
        home = snap.data;
        Mobile.toast(`Offline \u2014 showing data from ${Mobile.snapshotAge(snap)}`, 'err');
      } else {
        view.innerHTML = Mobile.empty('&#128246;', 'Cannot reach the office', err.message);
        return;
      }
    }

    if (announce) Mobile.toast('Refreshed', 'ok');
    render();
  }

  /* --- Router ------------------------------------------------------------ */

  function render() {
    setTabs();
    if (!home) return;

    const { driver } = home;
    sub.textContent = `${driver.name} \u00B7 ${driver.id}`;

    if (tab === 'today') return renderToday();
    if (tab === 'history') return renderHistory();
    if (tab === 'log') return renderLog();
    return renderMe();
  }

  /* --- Today ------------------------------------------------------------- */

  function renderToday() {
    title.textContent = "Today's trip";

    const live = home.today || [];
    const upcoming = home.upcoming || [];

    if (!live.length && !upcoming.length) {
      view.innerHTML = Mobile.empty(
        '\u{1F5D3}',
        'No trips assigned',
        'Nothing is scheduled for you yet. The office assigns trips from the desk.'
      );
      return;
    }

    const parts = [];

    if (live.length) {
      parts.push(`<h2 style="margin:4px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim)">On now</h2>`);
      parts.push(live.map(tripCard).join(''));
    }

    if (upcoming.length) {
      parts.push(`<h2 style="margin:16px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim)">Coming up</h2>`);
      parts.push(upcoming.map(tripCard).join(''));
    }

    view.innerHTML = parts.join('');
    $$('.trip', view).forEach((el) => {
      el.addEventListener('click', () => openTrip(el.dataset.id));
    });
  }

  function tripCard(trip) {
    const p = trip.passengers || { allocated: 0, boarded: 0, noShow: 0 };
    const outstanding = Math.max(0, p.allocated - p.boarded - p.noShow);
    return `<button class="trip" data-id="${trip.id}">
      <div class="top">
        <span class="route">${escapeHtml(trip.route.name)}</span>
        ${Mobile.badgeFor(trip.status)}
      </div>
      <div class="meta">
        ${escapeHtml(trip.shift.pickupStart)}\u2013${escapeHtml(trip.shift.pickupEnd)}
        &middot; ${escapeHtml(trip.vehicle.regNo)}
        &middot; ${Fmt.dateShort(trip.date)}
      </div>
      <div class="meta" style="margin-top:6px">
        <strong>${p.boarded}</strong> of ${p.allocated} boarded${outstanding ? ` \u00B7 ${outstanding} still to go` : ''}
      </div>
      ${Mobile.progress(p.allocated, p.boarded)}
    </button>`;
  }

  /* --- Trip detail ------------------------------------------------------- */

  async function openTrip(tripId) {
    title.textContent = 'Manifest';
    view.innerHTML = Mobile.skeleton(4);
    history.replaceState(null, '', `#trip-${tripId}`);

    let data;
    try {
      data = await Api.get(`/mobile/driver/trips/${tripId}`);
      Mobile.saveSnapshot(`trip_${tripId}`, data);
    } catch (err) {
      const snap = Mobile.readSnapshot(`trip_${tripId}`);
      if (!snap) {
        view.innerHTML = Mobile.empty('\u26A0', 'Could not open this trip', err.message);
        return;
      }
      data = snap.data;
      Mobile.toast(`Offline \u2014 manifest from ${Mobile.snapshotAge(snap)}`, 'err');
    }

    renderTrip(data, tripId);
  }

  function renderTrip(data, tripId) {
    const t = data.trip;
    const pax = data.passengers || [];
    const p = t.passengers || { allocated: 0, boarded: 0, noShow: 0 };

    title.textContent = t.route.code;

    // Group by stop in the route's own order, because that is the order the
    // driver physically reaches them.
    const order = t.route.stops || [];
    const groups = new Map();
    for (const person of pax) {
      const key = person.stop || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(person);
    }
    const stops = [...groups.keys()].sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const open = t.status === 'scheduled';
    const running = t.status === 'in-progress';
    const acceptancePending = open && t.driverAcceptance === 'pending';

    const head = `<div class="card">
      <div class="row between" style="margin-bottom:8px">
        <h2 style="margin:0">${escapeHtml(t.route.name)}</h2>
        ${Mobile.badgeFor(t.status)}
      </div>
      <div class="kv"><span class="k">Date</span><span class="v">${Fmt.date(t.date)} &middot; ${Fmt.weekday(t.date)}</span></div>
      <div class="kv"><span class="k">Shift</span><span class="v">${escapeHtml(t.shift.name)} (${escapeHtml(t.shift.pickupStart)}\u2013${escapeHtml(t.shift.pickupEnd)})</span></div>
      <div class="kv"><span class="k">Vehicle</span><span class="v">${escapeHtml(t.vehicle.regNo)}<br><span class="tiny">${escapeHtml(t.vehicle.model)}</span></span></div>
      <div class="kv"><span class="k">On board</span><span class="v">${p.boarded} / ${p.allocated}${p.noShow ? ` \u00B7 ${p.noShow} no-show` : ''}</span></div>
      ${acceptancePending ? '<div class="kv"><span class="k">Assignment</span><span class="v">Awaiting your acceptance</span></div>' : ''}
      ${t.odometerStart ? `<div class="kv"><span class="k">Odometer at start</span><span class="v">${Fmt.num(t.odometerStart)} km</span></div>` : ''}
      ${t.actualKm ? `<div class="kv"><span class="k">Distance run</span><span class="v">${Fmt.num(t.actualKm, 1)} km</span></div>` : ''}
    </div>`;

    // Actions the driver needs right now, at the top where a thumb lands.
    let actions = '';
    if (acceptancePending) {
      actions = '<div class="row" style="gap:8px"><button class="btn primary" id="act-accept">Accept assignment</button><button class="btn" id="act-reject">Request reassignment</button></div>';
    } else if (open) {
      actions = `<button class="btn primary" id="act-start">Start this trip</button>`;
    } else if (running) {
      actions = `<div class="row" style="gap:8px"><button class="btn ok" id="act-finish">Close out trip</button><button class="btn danger" id="act-sos">SOS / Emergency</button></div>`;
    }

    let manifest = '';
    if (!pax.length) {
      manifest = `<div class="card">${Mobile.empty('\u{1F464}', 'Nobody booked on this trip', 'No staff are allocated to this route yet.')}</div>`;
    } else {
      for (const stop of stops) {
        const people = groups.get(stop);
        const done = people.filter((x) => x.status === 'completed' || x.status === 'boarded').length;
        manifest += `<div class="card">
          <div class="stop-head">
            <span class="name">${escapeHtml(stop)}</span>
            <span class="n">${done}/${people.length}</span>
          </div>
          ${people.map((person) => paxRow(person, tripId, !open && !running)).join('')}
        </div>`;
      }
    }

    view.innerHTML = head + actions + manifest;

    const startBtn = $('#act-start', view);
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        // The server rejects a start with no odometer reading, and a brand-new
        // trip has none recorded. Asking for it here is what makes this button
        // able to succeed at all — it used to post `{}` and always fail with
        // "Enter a valid starting odometer reading."
        const answer = window.prompt('Odometer reading now (km):', '');
        if (answer === null) return; // cancelled
        const odo = Number(answer);
        if (!odo || odo <= 0) {
          Mobile.toast('Enter the odometer reading.', 'err');
          return;
        }
        Mobile.withBusy(startBtn, 'Starting', async () => {
          try {
            await Api.post(`/mobile/driver/trips/${tripId}/start`, { odometerStart: odo });
            Mobile.toast('Trip started', 'ok');
            await refresh(false);
            await openTrip(tripId);
          } catch (err) {
            Mobile.toast(err.message, 'err');
          }
        });
      });
    }

    const acceptBtn = $('#act-accept', view);
    if (acceptBtn) acceptBtn.addEventListener('click', () => Mobile.withBusy(acceptBtn, 'Accepting', async () => {
      try { await Api.post(`/mobile/driver/trips/${tripId}/accept`, {}); Mobile.toast('Trip accepted', 'ok'); await refresh(false); await openTrip(tripId); }
      catch (err) { Mobile.toast(err.message, 'err'); }
    }));

    const rejectBtn = $('#act-reject', view);
    if (rejectBtn) rejectBtn.addEventListener('click', async () => {
      const reason = window.prompt('Why do you need this trip reassigned?', 'Vehicle or availability issue');
      if (reason === null) return;
      try { await Api.post(`/mobile/driver/trips/${tripId}/reject`, { reason }); Mobile.toast('Reassignment requested', 'ok'); await refresh(false); await openTrip(tripId); }
      catch (err) { Mobile.toast(err.message, 'err'); }
    });

    const finishBtn = $('#act-finish', view);
    if (finishBtn) finishBtn.addEventListener('click', () => closeOut(t, tripId));

    const sosBtn = $('#act-sos', view);
    if (sosBtn) sosBtn.addEventListener('click', async () => {
      const description = window.prompt('Briefly describe the emergency:', 'Emergency assistance required');
      if (description === null) return;
      await Mobile.withBusy(sosBtn, 'Sending', async () => {
        try {
          await Api.post(`/mobile/driver/trips/${tripId}/sos`, { description });
          Mobile.toast('SOS sent to the control tower', 'ok');
        } catch (err) { Mobile.toast(err.message, 'err'); }
      });
    });

    $$('.pax .tick', view).forEach((btn) => {
      btn.addEventListener('click', () => toggleBoarding(btn, tripId));
    });
    $$('.pax .safe-drop', view).forEach((btn) => {
      btn.addEventListener('click', () => confirmSafeDrop(btn, tripId));
    });
  }

  function paxRow(person, tripId, locked) {
    const on = person.status === 'completed' || person.status === 'boarded';
    const off = person.status === 'no-show';
    return `<div class="pax ${on ? 'done' : ''} ${off ? 'noshow' : ''}">
      <div class="who">
        <div class="nm">${escapeHtml(person.name)}</div>
        <div class="mt">${escapeHtml(person.code)} &middot; ${escapeHtml(person.department)}${person.phone ? ` &middot; <a href="tel:${escapeHtml(person.phone.replace(/\s/g, ''))}" style="color:var(--brand)">call</a>` : ''}</div>
      </div>
      <button class="tick ${on ? 'on' : ''}"
        data-booking="${person.bookingId}"
        data-on="${on ? '1' : '0'}"
        ${locked ? 'disabled' : ''}
        aria-label="${on ? 'Undo boarding for' : 'Board'} ${escapeHtml(person.name)}">${on ? '&#10003;' : '&#9744;'}</button>
      ${on && !locked ? `<button class="btn sm safe-drop" data-booking="${person.bookingId}" title="Confirm safe drop">Safe drop</button>` : ''}
    </div>`;
  }

  async function confirmSafeDrop(btn, tripId) {
    if (!window.confirm('Confirm that this passenger reached the safe drop point?')) return;
    await Mobile.withBusy(btn, 'Saving', async () => {
      try {
        await Api.post(`/mobile/driver/trips/${tripId}/safe-drop`, { bookingId: btn.dataset.booking });
        btn.textContent = 'Safe drop recorded';
        btn.disabled = true;
        Mobile.toast('Safe drop recorded', 'ok');
      } catch (err) { Mobile.toast(err.message, 'err'); }
    });
  }

  /**
   * Toggle a passenger between boarded and not boarded.
   *
   * The button is disabled for the duration rather than merely debounced:
   * a phone in a moving bus produces accidental double taps, and a duplicate
   * boarding call would corrupt the manifest count.
   */
  async function toggleBoarding(btn, tripId) {
    const wasOn = btn.dataset.on === '1';
    // The endpoint takes a batch, because a driver at a stop ticks several
    // people in quick succession. One tap is simply a batch of one.
    // `confirmed` is the un-boarded state, so un-ticking restores it. The
    // server must accept it — it did not, which made every undo fail.
    const next = wasOn ? 'confirmed' : 'completed';

    btn.disabled = true;
    try {
      await Api.post(`/mobile/driver/trips/${tripId}/attendance`, {
        entries: [{ bookingId: btn.dataset.booking, status: next }],
      });
      const on = next === 'completed';
      btn.dataset.on = on ? '1' : '0';
      btn.classList.toggle('on', on);
      btn.innerHTML = on ? '&#10003;' : '&#9744;';
      btn.closest('.pax').classList.toggle('done', on);
      // Refresh counts in the background; the tap itself already succeeded.
      refresh(false);
    } catch (err) {
      Mobile.toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /** Closing a trip needs the odometer, so ask for it before posting. */
  function closeOut(trip, tripId) {
    const body = `
      <div class="field">
        <label for="odo">Odometer reading now (km)</label>
        <input id="odo" type="number" inputmode="decimal" step="0.1"
               value="${trip.odometerStart ? '' : ''}" placeholder="e.g. ${trip.odometerStart ? Number(trip.odometerStart) + 42 : 41234}">
        <div class="err" id="odo-err"></div>
      </div>
      <p class="tiny">Started at ${trip.odometerStart ? `${Fmt.num(trip.odometerStart)} km` : 'an unrecorded reading'}. The distance is worked out from the difference.</p>
      <div class="field" style="margin-top:14px">
        <label for="notes">Anything to report? (optional)</label>
        <textarea id="notes" placeholder="Traffic, a diversion, a passenger issue...">${escapeHtml(trip.notes || '')}</textarea>
      </div>`;

    const modal = openModal({
      title: 'Close out trip',
      body,
      footer: `<button class="btn" data-close-x>Cancel</button>
               <button class="btn ok" id="confirm-close">Close trip</button>`,
    });

    $('#confirm-close', modal.el).addEventListener('click', async (e) => {
      const odo = Number($('#odo', modal.el).value);
      const errEl = $('#odo-err', modal.el);

      if (!odo) {
        errEl.textContent = 'Enter the odometer reading.';
        $('#odo', modal.el).focus();
        return;
      }
      // Catch the common mis-entry of a digit dropped or added, which would
      // otherwise be recorded as a real distance.
      if (trip.odometerStart && odo < Number(trip.odometerStart)) {
        errEl.textContent = `This is below the starting reading of ${Fmt.num(trip.odometerStart)} km.`;
        return;
      }
      errEl.textContent = '';

      const btn = e.currentTarget;
      await Mobile.withBusy(btn, 'Closing', async () => {
        try {
          await Api.post(`/mobile/driver/trips/${tripId}/complete`, {
            odometerEnd: odo,
            notes: $('#notes', modal.el).value.trim(),
          });
          modal.close();
          Mobile.toast('Trip closed', 'ok');
          await refresh(false);
          await openTrip(tripId);
        } catch (err) {
          errEl.textContent = err.message;
        }
      });
    });
  }

  /* --- History ----------------------------------------------------------- */

  async function renderHistory() {
    title.textContent = 'My history';
    view.innerHTML = Mobile.skeleton(4);

    let rows;
    try {
      const res = await Api.get('/mobile/driver/trips');
      // List endpoints use the standard { data, meta } envelope.
      rows = res.data || [];
      Mobile.saveSnapshot('driver_history', rows);
    } catch (err) {
      const snap = Mobile.readSnapshot('driver_history');
      if (!snap) {
        view.innerHTML = Mobile.empty('\u26A0', 'Could not load history', err.message);
        return;
      }
      rows = snap.data;
    }

    if (!rows.length) {
      view.innerHTML = Mobile.empty('\u{1F5D3}', 'Nothing driven yet', 'Completed trips will appear here.');
      return;
    }

    const done = rows.filter((r) => r.status === 'completed');
    const km = done.reduce((a, r) => a + (Number(r.actualKm) || 0), 0);

    view.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Trips</div><div class="v">${rows.length}</div></div>
        <div class="stat"><div class="k">Completed</div><div class="v">${done.length}</div></div>
        <div class="stat"><div class="k">Distance</div><div class="v">${Fmt.num(km, 0)}<small> km</small></div></div>
        <div class="stat"><div class="k">Open</div><div class="v">${rows.length - done.length}</div></div>
      </div>
      ${rows.map(tripCard).join('')}`;

    $$('.trip', view).forEach((el) => el.addEventListener('click', () => openTrip(el.dataset.id)));
  }

  /* --- Log (breakdown + fuel) -------------------------------------------- */

  function renderLog() {
    title.textContent = 'Log something';

    const vehicles = home.vehicles || [];
    const assignedTrips = [...(home.today || []), ...(home.upcoming || [])]
      .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
    const tripOptions = assignedTrips
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.route.name)} · ${Fmt.dateShort(t.date)} · ${escapeHtml(t.vehicle.regNo)}</option>`)
      .join('');
    const vehicleOptions = vehicles
      .map((v) => `<option value="${v.id}">${escapeHtml(v.regNo)} &middot; ${escapeHtml(v.model)}</option>`)
      .join('');

    view.innerHTML = `
      <div class="card">
        <h2>Report a breakdown</h2>
        <p class="muted" style="margin-top:0">Tell the office now so a replacement can be arranged.</p>
        ${assignedTrips.length ? `<div class="field">
          <label for="bd-trip">Affected trip</label>
          <select id="bd-trip"><option value="">Not on a trip</option>${tripOptions}</select>
        </div>` : ''}
        <div class="field">
          <label for="bd-sev">How serious is it?</label>
          <select id="bd-sev">
            <option value="high">Vehicle cannot move &mdash; passengers stranded</option>
            <option value="medium" selected>Can continue but needs attention</option>
            <option value="low">Minor, not affecting the trip</option>
          </select>
        </div>
        <div class="field">
          <label for="bd-desc">What happened?</label>
          <textarea id="bd-desc" placeholder="e.g. Rear tyre punctured near Wakad Chowk"></textarea>
          <div class="err" id="bd-err"></div>
        </div>
        <button class="btn danger" id="bd-send">Report breakdown</button>
      </div>

      <div class="card">
        <h2>Log fuel</h2>
        <p class="muted" style="margin-top:0">Record a fill so the office can reconcile it against distance run.</p>
        ${vehicles.length > 1 ? `<div class="field">
          <label for="fu-veh">Vehicle</label>
          <select id="fu-veh">${vehicleOptions}</select>
        </div>` : ''}
        <div class="grid-2">
          <div class="field">
            <label for="fu-litres">Litres</label>
            <input id="fu-litres" type="number" inputmode="decimal" step="0.01" placeholder="40">
          </div>
          <div class="field">
            <label for="fu-cost">Total cost (&#8377;)</label>
            <input id="fu-cost" type="number" inputmode="decimal" step="0.01" placeholder="3600">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="fu-odo">Odometer (km)</label>
            <input id="fu-odo" type="number" inputmode="decimal" step="1" placeholder="41234">
          </div>
          <div class="field">
            <label for="fu-date">Date</label>
            <input id="fu-date" type="date" value="${todayIso()}">
          </div>
        </div>
        <div class="field">
          <label for="fu-station">Where did you fill up? (optional)</label>
          <input id="fu-station" placeholder="e.g. HP pump, Hinjewadi Phase 1" autocomplete="off">
        </div>
        <p class="tiny" id="fu-hint"></p>
        <button class="btn primary" id="fu-send" style="margin-top:10px">Save fuel entry</button>
      </div>`;

    const hint = $('#fu-hint', view);
    if (!vehicles.length) {
      hint.textContent = 'No vehicle is assigned to you, so a registration will be needed. Ask the office to link one.';
    } else if (vehicles.length === 1) {
      hint.textContent = `Goes against ${vehicles[0].regNo}, the vehicle assigned to you.`;
    } else {
      hint.textContent = 'Choose the vehicle you filled.';
    }

    $('#bd-send', view).addEventListener('click', (e) => sendBreakdown(e.currentTarget));
    $('#fu-send', view).addEventListener('click', (e) => sendFuel(e.currentTarget));
  }

  async function sendBreakdown(btn) {
    const desc = $('#bd-desc', view).value.trim();
    const errEl = $('#bd-err', view);

    if (desc.length < 8) {
      errEl.textContent = 'Describe the problem in a few words so the office can act on it.';
      $('#bd-desc', view).focus();
      return;
    }
    errEl.textContent = '';

    await Mobile.withBusy(btn, 'Reporting', async () => {
      try {
        await Api.post('/mobile/driver/breakdown', {
          severity: $('#bd-sev', view).value,
          description: desc,
          tripId: $('#bd-trip', view)?.value || undefined,
        });
        $('#bd-desc', view).value = '';
        Mobile.toast('Reported \u2014 the office has been told', 'ok');
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  async function sendFuel(btn) {
    const litres = Number($('#fu-litres', view).value);
    const cost = Number($('#fu-cost', view).value);
    const odo = Number($('#fu-odo', view).value) || undefined;
    const vehEl = $('#fu-veh', view);

    if (!litres || litres <= 0) {
      Mobile.toast('Enter how many litres you put in.', 'err');
      $('#fu-litres', view).focus();
      return;
    }
    if (!cost || cost <= 0) {
      Mobile.toast('Enter the total cost.', 'err');
      $('#fu-cost', view).focus();
      return;
    }

    const payload = {
      litres,
      // The API field is `amount`, not `cost`. Sending `cost` made every fuel
      // entry fail with "Enter the amount paid." even though the amount had
      // been typed in — the value was silently dropped by the server.
      amount: cost,
      odometer: odo,
      date: $('#fu-date', view).value || todayIso(),
      station: $('#fu-station', view).value.trim() || undefined,
    };
    // The server can infer the vehicle when the driver only has one. Only send
    // an id when a choice was actually offered.
    if (vehEl) payload.vehicleId = vehEl.value;

    await Mobile.withBusy(btn, 'Saving', async () => {
      try {
        await Api.post('/mobile/driver/fuel', payload);
        $('#fu-litres', view).value = '';
        $('#fu-cost', view).value = '';
        $('#fu-odo', view).value = '';
        $('#fu-station', view).value = '';
        Mobile.toast('Fuel entry saved', 'ok');
      } catch (err) {
        Mobile.toast(err.message, 'err');
      }
    });
  }

  /* --- Me ---------------------------------------------------------------- */

  function renderMe() {
    title.textContent = 'My details';
    const d = home.driver;

    const expiry = d.licenceExpiry ? new Date(`${d.licenceExpiry}T00:00:00`) : null;
    const daysToExpiry = expiry ? Math.round((expiry.getTime() - Date.now()) / 86400000) : null;
    const licenceTone = daysToExpiry === null ? '' : daysToExpiry < 0 ? 'danger' : daysToExpiry < 45 ? 'warn' : 'ok';

    view.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(d.name)}</h2>
        <div class="kv"><span class="k">Driver ID</span><span class="v">${escapeHtml(d.id)}</span></div>
        <div class="kv"><span class="k">Phone</span><span class="v"><a href="tel:${escapeHtml(d.phone.replace(/\s/g, ''))}" style="color:var(--brand)">${escapeHtml(d.phone)}</a></span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${escapeHtml(d.status)}</span></div>
      </div>

      <div class="card">
        <h2>Licence</h2>
        <div class="kv"><span class="k">Number</span><span class="v">${escapeHtml(d.licenceNo)}</span></div>
        <div class="kv">
          <span class="k">Expires</span>
          <span class="v">${d.licenceExpiry ? Fmt.date(d.licenceExpiry) : '-'} ${licenceTone ? Mobile.badgeFor(licenceTone === 'danger' ? 'expired' : licenceTone === 'warn' ? 'scheduled' : 'active') : ''}</span>
        </div>
        ${daysToExpiry !== null && daysToExpiry < 45
          ? `<p class="tiny" style="color:${daysToExpiry < 0 ? 'var(--danger)' : 'var(--warn)'};margin-bottom:0">
               ${daysToExpiry < 0 ? `Expired ${Math.abs(daysToExpiry)} days ago` : `${daysToExpiry} days left`} \u2014 tell the office so it can be renewed.
             </p>`
          : ''}
      </div>

      <div class="card">
        <h2>Today at a glance</h2>
        <div class="kv"><span class="k">Trips on the board</span><span class="v">${(home.today || []).length + (home.upcoming || []).length}</span></div>
        <div class="kv"><span class="k">Vehicles you may use</span><span class="v">${(home.vehicles || []).length || 'none assigned'}</span></div>
      </div>

      <button class="btn" id="signout2" style="margin-bottom:10px">Sign out</button>
      <p class="tiny" style="text-align:center">
        Add this app to your home screen for offline access to your manifest.
      </p>`;

    $('#signout2', view).addEventListener('click', () => Mobile.signOut());
  }

  /* --- Start ------------------------------------------------------------- */

  boot().catch((err) => {
    view.innerHTML = Mobile.empty('\u26A0', 'Something went wrong', err.message);
  });
})();
