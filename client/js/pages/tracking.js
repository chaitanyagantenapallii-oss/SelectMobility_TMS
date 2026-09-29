'use strict';

/* ==========================================================================
   Live tracking - where every vehicle actually is, right now
   ========================================================================== */

/*
 * The driver app posts a position every few seconds while a trip is running.
 * This page is the receiving end: a list of vehicles with their coordinates,
 * speed and how long ago they last checked in, plus a map.
 *
 * The map is drawn on a plain <canvas> rather than a mapping SDK, so the page
 * is fully functional with no third-party script and nothing to authorise. If
 * a tile key is supplied (Settings > Map tiles) the basemap is loaded from the
 * provider; without one the canvas still shows the road network we hold
 * ourselves - routes and boarding stops - so the operator can see which stop a
 * bus is approaching. Everything except the photographic basemap works either
 * way.
 */

const TrackingPage = {
  state: {
    filter: 'live',        // live | all
    selectedVehicleId: null,
    viewMode: 'fleet',
    tripTrail: null,
    phoneWatchId: null,
    testVehicleId: null,
    leafletMap: null,
    leafletMarkers: [],
    leafletLoaded: null,
    timer: null,
    mapConfig: null,       // { provider, key, tileUrlTemplate }
    stops: [],             // boarding stops with coordinates, for the basemap-free view
  },

  async render(container) {
    this.state.selectedVehicleId = null;
    this.state.tripTrail = null;

    const [settings, stops] = await Promise.all([
      this.mapSettings(),
      this.loadStops(),
    ]);
    this.state.mapConfig = settings;
    this.state.stops = stops;

    container.innerHTML = `
      <div class="toolbar">
        <div class="tracking-view-toggle" role="group" aria-label="Tracking view">
          <button class="btn sm primary" id="tk-fleet-view">Fleet view</button>
          <button class="btn sm" id="tk-single-view">Single vehicle</button>
        </div>
        <select id="tk-vehicle-select" class="tracking-vehicle-select" aria-label="Vehicle to focus" hidden>
          <option value="">Select vehicle</option>
        </select>
        <select id="tk-filter">
          <option value="live" ${this.state.filter === 'live' ? 'selected' : ''}>Checked in recently</option>
          <option value="all" ${this.state.filter === 'all' ? 'selected' : ''}>All vehicles that have reported</option>
        </select>
        <div class="spacer"></div>
        <span class="muted" id="tk-updated" style="font-size:12px"></span>
        <button class="btn sm" id="tk-refresh">&#8635; Refresh</button>
        <button class="btn sm" id="tk-add-test">&#43; Add test car</button>
        <button class="btn sm primary" id="tk-phone-gps">&#128225; Start phone GPS</button>
        <button class="btn sm" id="tk-tiles">${settings.provider === 'osm' || settings.key ? '&#128506; Street map' : '&#128506; Add map key'}</button>
      </div>

      <div class="grid cols-4" style="margin-bottom:18px" id="tk-stats"></div>

      <div class="card tracking-map-card">
        <div class="card-head">
          <div><h3 id="tk-map-title">SMIPL operational map</h3><span class="desc">Our route corridors, stops and live vehicle positions</span></div>
          <span class="tracking-live-badge"><i></i> Live operations view</span>
        </div>
        <div class="card-body" style="padding:10px">
          <div class="map-workspace">
            <div class="map-tools" aria-label="Map controls">
              <button class="icon-btn" id="tk-map-fit" title="Fit fleet view">&#9634;</button>
              <button class="icon-btn" id="tk-map-plus" title="Zoom in">&#43;</button>
              <button class="icon-btn" id="tk-map-minus" title="Zoom out">&#8722;</button>
            </div>
            <div id="tk-map-wrap"></div>
          </div>
          <div id="tk-map-legend" class="muted" style="font-size:11.5px;margin-top:8px"></div>
        </div>
      </div>

      <div class="card tracking-vehicle-card">
        <div class="card-head">
          <div><h3>Fleet movement board</h3><span class="desc">Vehicle, assignment, speed and last signal</span></div>
          <span class="desc" id="tk-count"></span>
        </div>
        <div class="card-body tight" id="tk-table"></div>
      </div>
    `;

    document.getElementById('tk-filter').addEventListener('change', (e) => {
      this.state.filter = e.target.value;
      this.load();
    });
    document.getElementById('tk-fleet-view').addEventListener('click', () => this.setView('fleet'));
    document.getElementById('tk-single-view').addEventListener('click', () => this.setView('single'));
    document.getElementById('tk-vehicle-select').addEventListener('change', (e) => {
      this.state.selectedVehicleId = e.target.value || null;
      this.load();
    });
    document.getElementById('tk-refresh').addEventListener('click', () => this.load());
    document.getElementById('tk-add-test').addEventListener('click', () => this.addTestVehicle());
    document.getElementById('tk-phone-gps').addEventListener('click', () => this.togglePhoneGps());
    document.getElementById('tk-map-fit').addEventListener('click', () => { this.state.selectedVehicleId = null; this.state.viewMode = 'fleet'; this.load(); });
    document.getElementById('tk-map-plus').addEventListener('click', () => this.zoomMap(1.35));
    document.getElementById('tk-map-minus').addEventListener('click', () => this.zoomMap(0.74));
    document.getElementById('tk-tiles').addEventListener('click', () => this.tilesForm());

    await this.load();

    // Auto-refresh while the page is open, so the desk is genuinely live.
    // The shell calls destroy() when the operator navigates away.
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = setInterval(() => this.load({ quiet: true }), 15000);
  },

  /**
   * Stop polling.
   *
   * Called by the app shell on navigation. Without it the interval would keep
   * hitting /tracking/live forever, once per visit to this page.
   */
  destroy() {
    if (this.state.timer) clearInterval(this.state.timer);
    if (this.state.phoneWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(this.state.phoneWatchId);
    this.state.timer = null;
    this.state.phoneWatchId = null;
    if (this.state.leafletMap) { this.state.leafletMap.remove(); this.state.leafletMap = null; }
  },

  async addTestVehicle() {
    const regNo = window.prompt('Enter your car registration or test name:', 'TEST-CAR-01');
    if (!regNo) return;
    try {
      const { data } = await Api.post('/tracking/test-vehicle', { regNo });
      this.state.testVehicleId = data.id;
      Toast.ok(`${data.regNo} added. Start phone GPS to send live positions.`);
      await this.load();
    } catch (err) { Toast.error(err.message || 'Could not add test vehicle.'); }
  },

  async togglePhoneGps() {
    const button = currentEl('tk-phone-gps');
    if (this.state.phoneWatchId !== null) {
      navigator.geolocation.clearWatch(this.state.phoneWatchId);
      this.state.phoneWatchId = null;
      if (button) { button.textContent = '📡 Start phone GPS'; button.classList.add('primary'); }
      Toast.ok('Phone GPS test stopped.');
      return;
    }
    if (!navigator.geolocation) { Toast.error('This device does not provide GPS location.'); return; }
    if (!this.state.testVehicleId) {
      const { data } = await Api.get('/vehicles?search=Personal%20test%20car');
      const test = (data || []).find((v) => v.testVehicle);
      if (test) this.state.testVehicleId = test.id;
    }
    if (!this.state.testVehicleId) { Toast.error('Add a test car first.'); return; }
    if (button) { button.textContent = '■ Stop phone GPS'; button.classList.remove('primary'); }
    this.state.phoneWatchId = navigator.geolocation.watchPosition(async (position) => {
      try {
        await Api.post('/tracking/test-position', {
          vehicleId: this.state.testVehicleId,
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          speedKph: position.coords.speed ? position.coords.speed * 3.6 : 0,
          heading: position.coords.heading,
          accuracyM: position.coords.accuracy,
        });
        await this.load({ quiet: true });
      } catch (err) { Toast.error(err.message || 'Could not send phone position.'); }
    }, (error) => Toast.error(`GPS permission or signal problem: ${error.message}`), { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    Toast.ok('Phone GPS started. Keep this page open while driving.');
  },

  /** Tile provider settings, read from the server so every desk sees the same. */
  async mapSettings() {
    try {
      const { data } = await Api.get('/settings/map');
      return { provider: 'osm', ...(data || {}) };
    } catch (err) {
      return {};
    }
  },

  /**
   * Boarding stops that carry coordinates, flattened from the routes.
   *
   * Routes own their stops, so this is a read-only join - the map only needs
   * name and position to give the operator a sense of place without a basemap.
   */
  async loadStops() {
    try {
      const { data } = await Api.get('/routes');
      const out = [];
      data.forEach((r) => {
        (r.stopPoints || []).forEach((s) => {
          if (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))) {
            out.push({ name: s.name, lat: Number(s.lat), lon: Number(s.lon) });
          }
        });
      });
      return out;
    } catch (err) {
      return [];
    }
  },

  async load({ quiet = false } = {}) {
    const { data, meta } = await Api.get('/tracking/live');
    const reporting = this.state.filter === 'live' ? data.filter((d) => !d.stale || d.testVehicle) : data;
    const select = currentEl('tk-vehicle-select');
    if (select) {
      select.innerHTML = `<option value="">Select vehicle</option>${reporting.map((r) => `<option value="${escapeHtml(r.vehicleId || '')}" ${r.vehicleId === this.state.selectedVehicleId ? 'selected' : ''}>${escapeHtml(r.vehicleRegNo || r.vehicleId || 'Vehicle')}</option>`).join('')}`;
    }
    const rows = this.state.viewMode === 'single' && this.state.selectedVehicleId
      ? reporting.filter((d) => d.vehicleId === this.state.selectedVehicleId)
      : reporting;

    const statsEl = currentEl('tk-stats');
    const tableEl = currentEl('tk-table');
    const countEl = currentEl('tk-count');
    const updatedEl = currentEl('tk-updated');
    if (!tableEl) return;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat ok"><div class="label">Reporting</div><div class="value">${meta.live}</div><div class="foot">Seen in the last ${data[0] ? Math.round(data[0].freshSeconds / 60) : 5} minutes</div></div>
        <div class="stat warn"><div class="label">Moving</div><div class="value">${meta.moving}</div><div class="foot">Above walking pace</div></div>
        <div class="stat"><div class="label">Idle</div><div class="value">${Math.max(0, meta.live - meta.moving)}</div><div class="foot">Reporting but stopped</div></div>
        <div class="stat ${meta.stale ? 'danger' : ''}"><div class="label">Gone quiet</div><div class="value">${meta.stale}</div><div class="foot">No ping for over 5 min</div></div>
      `;
    }

    if (updatedEl) updatedEl.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour12: false })}`;

    countEl.textContent = rows.length
      ? `${rows.length} vehicle${rows.length === 1 ? '' : 's'}`
      : '';

    if (!rows.length) {
      tableEl.innerHTML = `<div class="empty"><h4>No vehicles reporting</h4><p>Positions appear here as soon as a driver starts a trip in the Driver app.</p></div>`;
      this.drawMap([]);
      return;
    }

    tableEl.innerHTML = renderTable({
      rows,
      emptyTitle: 'No vehicles reporting',
      columns: [
        {
          key: 'vehicleRegNo',
          label: 'Vehicle',
          cls: 'strong',
          render: (r) => `${escapeHtml(r.vehicleRegNo || r.vehicleId || '-')}
            <div class="muted" style="font-size:11.5px">${escapeHtml(r.driverName || 'no driver')}</div>`,
        },
        {
          key: 'speedKph',
          label: 'Speed',
          align: 'right',
          render: (r) => {
            const stopped = !r.speedKph || r.speedKph <= 3;
            // A carried figure is the last trustworthy reading, not a fresh
            // measurement; say so rather than presenting it as current.
            const hint = r.speedSource === 'carried' ? ' (last known)' : '';
            return `<span class="${stopped ? 'muted' : ''}">${stopped ? 'stopped' : `${r.speedKph} km/h`}</span><span class="muted" style="font-size:11px">${hint}</span>`;
          },
        },
        {
          key: 'heading',
          label: 'Direction',
          render: (r) => `<span class="direction-readout"><span class="direction-arrow">${this.directionArrow(r)}</span>${escapeHtml(this.directionLabel(r))}</span>`,
        },
        {
          key: 'lat',
          label: 'Position',
          cls: 'mono',
          render: (r) => (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))
            ? `${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}`
            : '<span class="pill warn">Awaiting GPS</span>'),
        },
        {
          key: 'tripId',
          label: 'Trip',
          cls: 'mono',
          render: (r) => (r.tripId
            ? `${escapeHtml(r.tripId)}
               <div class="muted" style="font-size:11.5px">${escapeHtml(r.routeCode || r.routeName || '')}</div>
               <div class="muted" style="font-size:11.5px">${r.boarded !== null && r.allocated !== null ? `${r.boarded} / ${r.allocated} aboard` : ''}</div>`
            : '<span class="muted">idle</span>'),
        },
        {
          key: 'recordedAt',
          label: 'Last seen',
          render: (r) => (r.testVehicle && !r.recordedAt
            ? '<span class="pill warn">Awaiting GPS</span>'
            : r.stale
            ? `<span class="pill danger">${this.ago(r.ageSeconds)}</span>`
            : `<span class="pill ok">${this.ago(r.ageSeconds)}</span>`),
        },
      ],
      rowActions: (r) => [
        `<button class="btn sm" onclick="TrackingPage.focus('${escapeHtml(r.vehicleId || '')}','${escapeHtml(r.tripId || '')}')" title="Show on map">&#128065;</button>`,
        r.tripId ? `<button class="btn sm" onclick="TrackingPage.trail('${escapeHtml(r.tripId)}')" title="Show the route it took">&#128205;</button>` : '',
      ].join(''),
    });

    // Keep whatever the operator was looking at, unless it has gone away.
    const keep = this.state.viewMode === 'single'
      ? rows.find((r) => r.vehicleId === this.state.selectedVehicleId)
      : null;
    // A personal test car may be hundreds of kilometres from the demo fleet.
    // Keep the Pune operating picture legible in Fleet view; Single vehicle
    // view deliberately zooms to the test car when it is selected.
    const mapRows = this.state.viewMode === 'fleet' && !keep
      ? rows.filter((r) => !r.testVehicle)
      : rows;
    this.drawMap(mapRows, { highlight: keep ? keep.vehicleId : null, trail: this.state.tripTrail });
    if (quiet) return;
  },

  zoomMap(factor) {
    this.state.mapZoom = Math.max(0.55, Math.min(3, (this.state.mapZoom || 1) * factor));
    this.load({ quiet: true });
  },

  setView(mode) {
    this.state.viewMode = mode;
    const single = currentEl('tk-vehicle-select');
    const fleetBtn = currentEl('tk-fleet-view');
    const singleBtn = currentEl('tk-single-view');
    if (single) single.hidden = mode !== 'single';
    if (fleetBtn) fleetBtn.classList.toggle('primary', mode === 'fleet');
    if (singleBtn) singleBtn.classList.toggle('primary', mode === 'single');
    if (mode === 'single' && !this.state.selectedVehicleId) {
      const first = currentEl('tk-vehicle-select')?.options[1];
      if (first) { this.state.selectedVehicleId = first.value; if (single) single.value = first.value; }
    }
    this.load();
  },

  /** "3 min ago" - the phrasing an operator actually reads. */
  ago(seconds) {
    if (seconds === null || seconds === undefined) return 'never';
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    return `${Math.floor(seconds / 3600)} h ago`;
  },

  directionLabel(row) {
    const heading = this.headingFor(row);
    if (heading === null || row.speedKph <= 3) return row.speedKph <= 3 ? 'Stopped' : 'Unknown';
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return labels[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
  },

  directionArrow(row) {
    const heading = this.headingFor(row);
    return heading === null || row.speedKph <= 3 ? '&#8226;' : '&#8593;';
  },

  headingFor(row) {
    if (Number.isFinite(Number(row.heading))) return Number(row.heading);
    const route = row.routePoints || [];
    if (route.length < 2 || !Number.isFinite(Number(row.lat))) return null;
    let best = null;
    route.slice(0, -1).forEach((a, i) => {
      const b = route[i + 1];
      const d = (Number(row.lat) - Number(a.lat)) ** 2 + (Number(row.lon) - Number(a.lon)) ** 2;
      if (!best || d < best.d) best = { d, a, b };
    });
    return best ? Math.atan2(Number(best.b.lon) - Number(best.a.lon), Number(best.b.lat) - Number(best.a.lat)) * 180 / Math.PI : null;
  },

  /** Click a row: show that vehicle on the map, and fetch its trail. */
  async focus(vehicleId, tripId) {
    this.state.selectedVehicleId = vehicleId;
    this.state.tripTrail = null;
    if (tripId) {
      try {
        const { data } = await Api.get(`/tracking/trip/${tripId}`);
        this.state.tripTrail = data;
      } catch (err) { /* trail is a bonus; the live dot is enough */ }
    }
    const { data } = await Api.get('/tracking/live');
    this.drawMap(data, { highlight: vehicleId, trail: this.state.tripTrail });
  },

  /** Open one trip's breadcrumb trail in a modal with its own map. */
  async trail(tripId) {
    const { data } = await Api.get(`/tracking/trip/${tripId}`);
    const rows = data.points.map((p, i) => ({
      '#': i + 1,
      at: new Date(p.recordedAt).toLocaleTimeString('en-IN', { hour12: false }),
      pos: `${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)}`,
      speed: p.speedKph ? `${p.speedKph} km/h` : 'stopped',
    }));

    openModal({
      title: `${tripId} \u00B7 ${data.routeName || 'route'} \u00B7 ${data.vehicleRegNo || ''}`,
      wide: true,
      body: `
        <div class="grid cols-4" style="margin-bottom:14px">
          <div class="stat"><div class="label">Status</div><div class="value" style="font-size:15px">${statusPill(data.status)}</div><div class="foot">${Fmt.date(data.date)}</div></div>
          <div class="stat"><div class="label">Driver</div><div class="value" style="font-size:15px">${escapeHtml(data.driverName || '-')}</div><div class="foot">${escapeHtml(data.vehicleRegNo || '')}</div></div>
          <div class="stat"><div class="label">Distance</div><div class="value">${data.distanceKm}</div><div class="foot">km by road</div></div>
          <div class="stat"><div class="label">Fixes</div><div class="value">${data.points.length}</div><div class="foot">${data.firstAt ? `from ${new Date(data.firstAt).toLocaleTimeString('en-IN', { hour12: false })}` : 'no data'}</div></div>
        </div>
        <div id="tk-trail-map" style="margin-bottom:14px"></div>
        ${data.points.length ? renderTable({ rows, columns: [
          { key: '#', label: '#', align: 'right' },
          { key: 'at', label: 'Time', cls: 'mono' },
          { key: 'pos', label: 'Position', cls: 'mono' },
          { key: 'speed', label: 'Speed', align: 'right' },
        ] }) : '<div class="empty"><p>No positions were recorded on this trip.</p></div>'}
      `,
    });

    // Draw after the modal is in the DOM, or the canvas has no size.
    setTimeout(() => this.drawMap([], { target: 'tk-trail-map', trail: data }), 40);
  },

  /* ------------------------------------------------------------------------
     The map
     ------------------------------------------------------------------------ */

  /**
   * Draw every vehicle (or one trip's trail) on a canvas.
   *
   * Mercator projection over a bounding box that fits the points with padding,
   * so it works identically for one bus or twenty and needs no SDK.
   */
  drawMap(rows, { target = 'tk-map-wrap', trail = null, highlight = null } = {}) {
    const wrap = currentEl(target);
    if (!wrap) return;

    if (!trail && target === 'tk-map-wrap') {
      this.ensureLeaflet().then(() => this.drawLeaflet(rows, { highlight })).catch(() => {});
    }

    const W = wrap.clientWidth || 520;
    const H = 390;

    const points = trail
      ? trail.points.map((p) => ({ lat: p.lat, lon: p.lon, speedKph: p.speedKph, at: p.recordedAt }))
      : (rows || []).filter((r) => Number.isFinite(Number(r.lat))).map((r) => ({ ...r }));

    if (!points.length) {
      // Keep the map workspace visible even before the first GPS fix arrives.
      // This avoids a layout jump and makes the empty tracking state obvious.
      wrap.innerHTML = '';
      const emptyMap = document.createElement('div');
      emptyMap.className = 'tracking-empty-map';
      emptyMap.innerHTML = '<div class="empty"><h4>Nothing to plot yet</h4><p>Start a trip in the Driver app and the position will appear here.</p></div>';
      const emptyCanvas = document.createElement('canvas');
      emptyCanvas.width = 1040;
      emptyCanvas.height = 640;
      emptyCanvas.style.width = '100%';
      emptyCanvas.style.height = '390px';
      emptyCanvas.style.borderRadius = '8px';
      emptyCanvas.style.border = '1px solid var(--border)';
      emptyCanvas.style.background = 'var(--surface-2)';
      emptyMap.prepend(emptyCanvas);
      wrap.appendChild(emptyMap);
      const legend = currentEl('tk-map-legend');
      if (legend) legend.textContent = '';
      return;
    }

    // Fit the points into the canvas with a margin.
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const pad = 0.12 / (this.state.mapZoom || 1);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);
    // A single point (or a stationary vehicle) has zero span; give it one.
    if (maxLat - minLat < 0.002) { minLat -= 0.001; maxLat += 0.001; }
    if (maxLon - minLon < 0.002) { minLon -= 0.001; maxLon += 0.001; }
    const latSpan = (maxLat - minLat) * (1 + pad * 2);
    const lonSpan = (maxLon - minLon) * (1 + pad * 2);
    minLat -= (latSpan - (maxLat - minLat)) / 2;
    maxLat += (latSpan - (maxLat - minLat)) / 2;
    minLon -= (lonSpan - (maxLon - minLon)) / 2;
    maxLon += (lonSpan - (maxLon - minLon)) / 2;

    const x = (lon) => ((lon - minLon) / (maxLon - minLon)) * W;
    const y = (lat) => H - ((lat - minLat) / (maxLat - minLat)) * H;

    // Boarding stops we hold ourselves, so the canvas is useful with no keys.
    const stops = (this.state.stops || []).filter((s) =>
      s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon);

    const canvas = document.createElement('canvas');
    canvas.width = W * 2;      // draw at 2x for a crisp line on retina screens
    canvas.height = H * 2;
    canvas.style.width = '100%';
    canvas.style.height = `${H}px`;
    canvas.style.borderRadius = '8px';
    canvas.style.border = '1px solid var(--border)';
    canvas.style.background = 'var(--surface-2)';

    const tiles = this.tileUrls({ minLat, maxLat, minLon, maxLon, W, H });
    const draw = () => {
      const ctx = canvas.getContext('2d');
      // A canvas context can be unavailable (very old browsers, or a headless
      // DOM). The list above the map already carries every figure, so degrade
      // to it rather than throwing and losing the whole page.
      if (!ctx) return;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = '#eef2f6';
      ctx.fillRect(0, 0, W, H);
      if (tiles.length) {
        tiles.forEach((t) => { try { ctx.drawImage(t.img, t.x, t.y, t.w, t.h); } catch (e) { /* tile not ready */ } });
      }

      // Stops.
      stops.forEach((s) => {
        ctx.beginPath();
        ctx.arc(x(s.lon), y(s.lat), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#94a3b8';
        ctx.fill();
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText(s.name, x(s.lon) + 5, y(s.lat) + 3);
      });

      const corridors = [...new Map(points.filter((p) => p.routePoints?.length)
        .map((p) => [JSON.stringify(p.routePoints), p.routePoints])).values()];
      corridors.forEach((corridor) => {
        ctx.beginPath();
        corridor.forEach((p, i) => (i ? ctx.lineTo(x(p.lon), y(p.lat)) : ctx.moveTo(x(p.lon), y(p.lat))));
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      if (trail) {
        // Breadcrumb trail with a start and end marker.
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(x(p.lon), y(p.lat)) : ctx.moveTo(x(p.lon), y(p.lat))));
        ctx.strokeStyle = '#1a80c4';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x(points[0].lon), y(points[0].lat), 5, 0, Math.PI * 2);
        ctx.fillStyle = '#15803d';
        ctx.fill();
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(x(last.lon), y(last.lat), 6, 0, Math.PI * 2);
        ctx.fillStyle = '#1a80c4';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // One dot per vehicle, labelled with its registration.
        points.forEach((p) => {
          const px = x(p.lon);
          const py = y(p.lat);
          const moving = p.speedKph > 3;
          const isFocus = highlight && p.vehicleId === highlight;
          if (isFocus) {
            // A ring around the selected vehicle, so the row/map pairing is obvious.
            ctx.beginPath();
            ctx.arc(px, py, 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#1a80c4';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.arc(px, py, isFocus ? 7 : 6, 0, Math.PI * 2);
          ctx.fillStyle = moving ? '#15803d' : '#f59e0b';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Direction arrow: GPS heading when available, otherwise the next
          // planned corridor segment in the demo/live route context.
          const route = p.routePoints || [];
          let segment = null;
          route.slice(0, -1).forEach((a, i) => {
            const b = route[i + 1];
            const d = (Number(p.lat) - Number(a.lat)) ** 2 + (Number(p.lon) - Number(a.lon)) ** 2;
            if (!segment || d < segment.d) segment = { d, a, b };
          });
          const heading = Number.isFinite(Number(p.heading)) ? Number(p.heading) : (segment ? Math.atan2(Number(segment.b.lon) - Number(segment.a.lon), Number(segment.b.lat) - Number(segment.a.lat)) * 180 / Math.PI : null);
          if (heading !== null && moving) {
            const angle = (90 - heading) * Math.PI / 180;
            ctx.save(); ctx.translate(px, py); ctx.rotate(angle);
            ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath();
            ctx.fillStyle = '#0f766e'; ctx.fill(); ctx.restore();
          }

          ctx.font = '600 10.5px system-ui, sans-serif';
          ctx.fillStyle = '#0f172a';
          ctx.fillText(p.vehicleRegNo || p.vehicleId || '', px + 10, py + 3.5);
        });
      }
    };

    let pending = tiles.length;
    if (!pending) {
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
      draw();
    } else {
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
      tiles.forEach((t) => {
        t.img.onload = () => { pending -= 1; if (pending <= 0) draw(); };
        t.img.onerror = () => { pending -= 1; if (pending <= 0) draw(); };
      });
      draw(); // draw what we have immediately, tiles fill in as they arrive
    }

    const legend = currentEl('tk-map-legend');
    if (legend) {
      const withKey = !!(this.state.mapConfig && this.state.mapConfig.key);
      const streetNote = ' Street layer: free OpenStreetMap Germany tiles.';
      legend.innerHTML = trail
        ? `Trail of ${points.length} fixes over ${trail.distanceKm} km. Green marker is the start, blue the latest position.`
        : `${points.length} vehicle${points.length === 1 ? '' : 's'} plotted. Green is moving, amber is stopped.${streetNote}`;
    }
  },

  ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (this.state.leafletLoaded) return this.state.leafletLoaded;
    this.state.leafletLoaded = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-smi-leaflet]')) {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; css.dataset.smiLeaflet = '1'; document.head.appendChild(css);
      }
      const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
      script.onload = () => resolve(window.L); script.onerror = () => reject(new Error('Street map library could not load.')); document.head.appendChild(script);
    });
    return this.state.leafletLoaded;
  },

  drawLeaflet(rows, { highlight = null } = {}) {
    const wrap = currentEl('tk-map-wrap');
    if (!wrap || !window.L) return;
    const points = (rows || []).filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)));
    if (!points.length) return;
    wrap.innerHTML = '';
    const mapEl = document.createElement('div');
    mapEl.className = 'leaflet-map';
    wrap.appendChild(mapEl);
    if (this.state.leafletMap) this.state.leafletMap.remove();
    const L = window.L;
    const map = L.map(mapEl, { zoomControl: false, attributionControl: true });
    this.state.leafletMap = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    // Free community street tiles; no API key or commercial account required.
    L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const bounds = [];
    const corridors = [...new Map(points.filter((p) => p.routePoints?.length).map((p) => [JSON.stringify(p.routePoints), p.routePoints])).values()];
    const routeColors = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#15803d', '#ca8a04', '#2563eb'];
    corridors.forEach((route, routeIndex) => {
      const points = route.map((p) => [Number(p.lat), Number(p.lon)]);
      points.forEach((p) => bounds.push(p));
      if (points.length < 2) return;
      const coords = points.map(([lat, lon]) => `${lon},${lat}`).join(';');
      fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`)
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          const geometry = data?.routes?.[0]?.geometry?.coordinates;
          if (!geometry?.length) return;
          const roadLine = geometry.map(([lon, lat]) => [lat, lon]);
          const color = routeColors[routeIndex % routeColors.length];
          L.polyline(roadLine, { color: '#fff', weight: 8, opacity: .92, lineCap: 'round', lineJoin: 'round' }).addTo(map);
          L.polyline(roadLine, { color, weight: 4, opacity: .95, dashArray: '2 10', lineCap: 'round', lineJoin: 'round' }).addTo(map);
        })
        .catch(() => {});
    });
    points.forEach((row) => {
      const pos = [Number(row.lat), Number(row.lon)]; bounds.push(pos);
      const active = row.speedKph > 3;
      const vehicleGlyph = '🚗';
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: 'smi-vehicle-marker',
          html: `<span class="smi-vehicle-pin ${active ? 'moving' : 'stopped'} ${highlight === row.vehicleId ? 'selected' : ''}" title="${escapeHtml(row.vehicleRegNo || 'Vehicle')}">${vehicleGlyph}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        zIndexOffset: highlight === row.vehicleId ? 1000 : 100,
      }).addTo(map);
      marker.bindTooltip(`<strong>${escapeHtml(row.vehicleRegNo || row.vehicleId || 'Vehicle')}</strong><br>${escapeHtml(row.routeCode || 'No route')} · ${active ? `${Fmt.num(row.speedKph, 0)} km/h` : 'Stopped'}`, { direction: 'top', offset: [0, -8] });
      if (highlight === row.vehicleId) marker.openTooltip();
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: this.state.viewMode === 'single' ? 15 : 12 });
    setTimeout(() => map.invalidateSize(), 60);
  },

  /**
   * Tile URLs for the current view, or [] when no key is configured.
   *
   * Kept deliberately provider-agnostic: the key and template come from
   * settings, so swapping OpenStreetMap for Mapbox or Google is a settings
   * change, not a code change.
   */
  tileUrls({ minLat, maxLat, minLon, maxLon, W, H }) {
    const cfg = this.state.mapConfig || {};
    const template = cfg.tileUrlTemplate || (cfg.provider === 'osm' ? 'https://tile.openstreetmap.de/{z}/{x}/{y}.png' : '');
    if (!template) return [];

    const z = 12;
    const n = 2 ** z;
    const lon2x = (lon) => ((lon + 180) / 360) * n;
    const lat2y = (lat) => {
      const r = (lat * Math.PI) / 180;
      return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    };

    const x0 = Math.floor(lon2x(minLon));
    const x1 = Math.floor(lon2x(maxLon));
    const y0 = Math.floor(lat2y(maxLat));
    const y1 = Math.floor(lat2y(minLat));
    const out = [];
    const tw = W / Math.max(1, x1 - x0 + 1);
    const th = H / Math.max(1, y1 - y0 + 1);
    for (let tx = x0; tx <= x1; tx += 1) {
      for (let ty = y0; ty <= y1; ty += 1) {
        const url = template
          .replace('{z}', z).replace('{x}', tx).replace('{y}', ty)
          .replace('{key}', cfg.key);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        out.push({ img, x: (tx - x0) * tw, y: (ty - y0) * th, w: tw + 1, h: th + 1 });
      }
    }
    return out;
  },

  /** Modal to set the basemap provider and key. */
  tilesForm() {
    const cfg = this.state.mapConfig || {};
    const modal = openModal({
      title: 'Map tiles',
      body: `
        <p class="hint" style="margin-top:0">
          The tracking map works without this - vehicles, routes and stops are drawn from our own
          data. Supplying a tile key only adds the street basemap underneath.
        </p>
        <div class="field">
          <label for="tk-provider">Provider</label>
          <select id="tk-provider">
            <option value="osm" ${cfg.provider === 'osm' ? 'selected' : ''}>OpenStreetMap</option>
            <option value="mapbox" ${cfg.provider === 'mapbox' ? 'selected' : ''}>Mapbox</option>
            <option value="google" ${cfg.provider === 'google' ? 'selected' : ''}>Google Maps</option>
            <option value="custom" ${cfg.provider === 'custom' ? 'selected' : ''}>Custom (own URL)</option>
          </select>
        </div>
        <div class="field">
          <label for="tk-key">API key</label>
          <input type="text" id="tk-key" placeholder="Paste the provider key" value="${escapeHtml(cfg.key || '')}">
          <div class="hint">Stored on the server and used only to fetch map images.</div>
        </div>
        <div class="field">
          <label for="tk-template">Tile URL template</label>
          <input type="text" id="tk-template" class="mono" placeholder="https://tile.example.com/{z}/{x}/{y}.png?key={key}" value="${escapeHtml(cfg.tileUrlTemplate || '')}">
          <div class="hint">Leave blank to use the selected provider's default template.</div>
        </div>
      `,
      footer: `
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="tk-save">Save</button>`,
    });

    const defaults = {
      osm: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      mapbox: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token={key}',
      google: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key={key}',
      custom: '',
    };

    const providerEl = document.getElementById('tk-provider', modal.el);
    const templateEl = document.getElementById('tk-template', modal.el);
    providerEl.addEventListener('change', () => {
      templateEl.value = defaults[providerEl.value] || '';
    });

    document.getElementById('tk-save', modal.el).addEventListener('click', async () => {
      const payload = {
        provider: providerEl.value,
        key: document.getElementById('tk-key', modal.el).value.trim(),
        tileUrlTemplate: templateEl.value.trim() || defaults[providerEl.value] || '',
      };
      try {
        await Api.post('/settings/map', payload);
        modal.close();
        Toast.ok(payload.key
          ? 'Map tiles switched on. Reloading the map.'
          : 'Map key cleared. The tracking map still works, without a basemap.');
        const settings = await this.mapSettings();
        this.state.mapConfig = settings;
        await this.load();
      } catch (err) {
        Toast.error(err.message || 'Could not save the map settings.');
      }
    });
  },
};
