'use strict';

/**
 * Reporting engine.
 *
 * Every report exports in two shapes:
 *   GET /api/reports/<name>.json  - structured payload for the UI / integrations
 *   GET /api/reports/<name>.csv   - the same rows flattened for Excel
 *
 * Add a new report by registering one entry in REPORT_DEFINITIONS.
 */

const express = require('express');
const { store } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { today, daysBetween, round, sum, ApiError } = require('../utils/helpers');
const config = require('../config');

/** Turn an array of flat objects into RFC 4180 CSV text. */
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function resolveRange(query) {
  const to = query.to || today();
  const from = query.from || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();
  return { from, to };
}

const REPORT_DEFINITIONS = {
  /** Daily trip sheet - the operations register. */
  trips: {
    title: 'Daily Trip Register',
    columns: ['Date', 'Trip ID', 'Shift', 'Route', 'Vehicle', 'Driver', 'Planned KM', 'Actual KM', 'Fuel Cost', 'Allocated', 'Boarded', 'Status'],
    build: ({ from, to }) =>
      store.collection('trips')
        .filter((t) => t.date >= from && t.date <= to)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.departureAt).localeCompare(String(b.departureAt)))
        .map((t) => {
          const route = store.find('routes', (r) => r.id === t.routeId);
          const vehicle = store.find('vehicles', (v) => v.id === t.vehicleId);
          const driver = store.find('drivers', (d) => d.id === t.driverId);
          const shift = store.find('shifts', (s) => s.id === t.shiftId);
          return {
            date: t.date,
            tripId: t.id,
            shift: shift ? shift.code : '-',
            route: route ? `${route.code} - ${route.name}` : '-',
            vehicle: vehicle ? vehicle.regNo : '-',
            driver: driver ? driver.name : '-',
            plannedKm: t.plannedKm,
            actualKm: t.actualKm,
            fuelCost: t.fuelCost,
            allocated: t.passengersAllocated,
            boarded: t.passengersBoarded,
            status: t.status,
          };
        }),
  },

  /** Employee wise boarding compliance. */
  attendance: {
    title: 'Employee Attendance Register',
    columns: ['Date', 'Employee Code', 'Employee', 'Department', 'Route', 'Stop', 'Trip ID', 'Boarded', 'Board Time', 'Marked By'],
    build: ({ from, to }) =>
      store.collection('attendance')
        .filter((a) => a.date >= from && a.date <= to)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.employeeId).localeCompare(String(b.employeeId)))
        .map((a) => {
          const emp = store.find('employees', (e) => e.id === a.employeeId) || {};
          const trip = store.find('trips', (t) => t.id === a.tripId);
          const route = trip ? store.find('routes', (r) => r.id === trip.routeId) : null;
          return {
            date: a.date,
            employeeCode: emp.code || '-',
            employee: emp.name || '-',
            department: emp.department || '-',
            route: route ? route.code : '-',
            stop: a.boardStop || '-',
            tripId: a.tripId,
            boarded: a.boarded ? 'Yes' : 'No',
            boardTime: a.boardedAt ? String(a.boardedAt).slice(11, 16) : '-',
            markedBy: a.markedBy || '-',
          };
        }),
  },

  /** Cost control report per vehicle. */
  'vehicle-cost': {
    title: 'Vehicle Cost & Efficiency',
    columns: ['Registration', 'Model', 'Type', 'Status', 'Odometer', 'Trips (period)', 'KM (period)', 'Litres', 'KM/L', 'Fuel Spend', 'Maintenance', 'Cost per KM'],
    build: ({ from, to }) =>
      store.collection('vehicles').map((v) => {
        const trips = store.filter('trips', (t) => t.vehicleId === v.id && t.date >= from && t.date <= to && t.status === 'completed');
        const fuel = store.filter('fuel', (f) => f.vehicleId === v.id && f.date >= from && f.date <= to);
        const maint = store.filter('maintenance', (m) => m.vehicleId === v.id && m.date >= from && m.date <= to);
        const km = sum(trips, (t) => t.actualKm);
        const litres = sum(fuel, (f) => f.litres);
        const fuelSpend = sum(fuel, (f) => f.amount);
        const maintSpend = sum(maint, (m) => m.cost);
        return {
          regNo: v.regNo,
          model: v.model,
          type: v.type,
          status: v.status,
          odometer: v.odometer,
          trips: trips.length,
          km: round(km, 1),
          litres: round(litres, 1),
          kmPerLitre: litres > 0 ? round(km / litres, 2) : null,
          fuelSpend: round(fuelSpend, 2),
          maintenanceSpend: round(maintSpend, 2),
          costPerKm: km > 0 ? round((fuelSpend + maintSpend) / km, 2) : null,
        };
      }),
  },

  /** Maintenance history and spend. */
  maintenance: {
    title: 'Maintenance & Repair Log',
    columns: ['Date', 'Job ID', 'Vehicle', 'Type', 'Description', 'Workshop', 'Cost', 'Odometer', 'Status'],
    build: ({ from, to }) =>
      store.collection('maintenance')
        .filter((m) => m.date >= from && m.date <= to)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((m) => {
          const vehicle = store.find('vehicles', (v) => v.id === m.vehicleId);
          return {
            date: m.date,
            jobId: m.id,
            vehicle: vehicle ? vehicle.regNo : '-',
            type: m.type,
            description: m.description,
            workshop: m.workshop || '-',
            cost: m.cost,
            odometer: m.odometer,
            status: m.status,
          };
        }),
  },

  /** Fuel and energy consumption. */
  fuel: {
    title: 'Fuel Consumption Register',
    columns: ['Date', 'Vehicle', 'Fuel Type', 'Litres', 'Rate', 'Amount', 'Odometer', 'Station', 'Payment Mode'],
    build: ({ from, to }) =>
      store.collection('fuel')
        .filter((f) => f.date >= from && f.date <= to)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((f) => {
          const vehicle = store.find('vehicles', (v) => v.id === f.vehicleId);
          return {
            date: f.date,
            vehicle: vehicle ? vehicle.regNo : '-',
            fuelType: vehicle ? vehicle.fuelType : '-',
            litres: f.litres,
            rate: f.rate,
            amount: f.amount,
            odometer: f.odometer,
            station: f.station || '-',
            paymentMode: f.paymentMode,
          };
        }),
  },

  /** Driver performance scorecard. */
  drivers: {
    title: 'Driver Performance Scorecard',
    columns: ['Driver', 'Phone', 'Licence', 'Licence Expiry', 'Vendor', 'Vehicle', 'Trips', 'Completed', 'KM Driven', 'On-time %', 'Status'],
    build: ({ from, to }) =>
      store.collection('drivers').map((d) => {
        const trips = store.filter('trips', (t) => t.driverId === d.id && t.date >= from && t.date <= to);
        const completed = trips.filter((t) => t.status === 'completed');
        const vendor = d.vendorId ? store.find('vendors', (v) => v.id === d.vendorId) : null;
        const vehicle = d.assignedVehicleId ? store.find('vehicles', (v) => v.id === d.assignedVehicleId) : null;
        const onTime = completed.filter((t) => Number(t.actualKm) <= Number(t.plannedKm) * 1.05).length;
        return {
          name: d.name,
          phone: d.phone,
          licence: d.licenceNo,
          licenceExpiry: d.licenceExpiry,
          vendor: vendor ? vendor.name : 'Own Fleet',
          vehicle: vehicle ? vehicle.regNo : 'Unassigned',
          trips: trips.length,
          completed: completed.length,
          km: round(sum(completed, (t) => t.actualKm), 1),
          onTimePct: completed.length ? round((onTime / completed.length) * 100, 1) : null,
          status: d.status,
        };
      }),
  },

  /** Route wise load and cost. */
  routes: {
    title: 'Route Performance Summary',
    columns: ['Code', 'Route', 'Shift', 'Stops', 'Distance KM', 'Employees', 'Trips', 'Passengers', 'Fuel Cost', 'Avg Load %'],
    build: ({ from, to }) =>
      store.collection('routes').map((route) => {
        const trips = store.filter('trips', (t) => t.routeId === route.id && t.date >= from && t.date <= to);
        const completed = trips.filter((t) => t.status === 'completed');
        const shift = store.find('shifts', (s) => s.id === route.shiftId);
        const capacity = sum(completed, (t) => {
          const v = store.find('vehicles', (x) => x.id === t.vehicleId);
          return v ? v.seats : 0;
        });
        const passengers = sum(completed, (t) => t.passengersBoarded);
        return {
          code: route.code,
          name: route.name,
          shift: shift ? shift.code : '-',
          stops: (route.stops || []).length,
          distanceKm: route.distanceKm,
          employees: store.filter('employees', (e) => e.routeId === route.id && e.status === 'active').length,
          trips: trips.length,
          passengers,
          fuelCost: round(sum(completed, (t) => t.fuelCost), 2),
          avgLoadPct: capacity ? round((passengers / capacity) * 100, 1) : 0,
        };
      }),
  },

  /** Compliance document register. */
  compliance: {
    title: 'Statutory Compliance Register',
    columns: ['Vehicle', 'Document', 'Number', 'Issued By', 'Issue Date', 'Expiry Date', 'Days Left', 'Status'],
    build: () =>
      store.collection('documents').map((doc) => {
        const vehicle = store.find('vehicles', (v) => v.id === doc.vehicleId);
        const daysLeft = daysBetween(today(), doc.expiryDate);
        return {
          vehicle: vehicle ? vehicle.regNo : '-',
          document: doc.title,
          number: doc.number,
          issuedBy: doc.issuedBy,
          issueDate: doc.issueDate,
          expiryDate: doc.expiryDate,
          daysLeft,
          status: daysLeft < 0 ? 'EXPIRED' : daysLeft <= 30 ? 'EXPIRING' : 'Valid',
        };
      }).sort((a, b) => a.daysLeft - b.daysLeft),
  },

  /** Monthly operating cost ledger. */
  expenses: {
    title: 'Operating Cost Ledger',
    columns: ['Month', 'Category', 'Description', 'Vendor', 'Amount', 'Status', 'Approved By'],
    build: () =>
      store.collection('expenses')
        .sort((a, b) => String(a.month).localeCompare(String(b.month)) || String(a.category).localeCompare(String(b.category)))
        .map((e) => {
          const vendor = e.vendorId ? store.find('vendors', (v) => v.id === e.vendorId) : null;
          return {
            month: e.month,
            category: e.category,
            description: e.description,
            vendor: vendor ? vendor.name : '-',
            amount: e.amount,
            status: e.status,
            approvedBy: e.approvedBy || '-',
          };
        }),
  },

  /** Incident / safety register. */
  incidents: {
    title: 'Incident & Safety Register',
    columns: ['Date', 'Incident ID', 'Vehicle', 'Route', 'Type', 'Severity', 'Description', 'Action Taken', 'Status'],
    build: ({ from, to }) =>
      store.collection('incidents')
        .filter((i) => i.date >= from && i.date <= to)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((i) => {
          const vehicle = store.find('vehicles', (v) => v.id === i.vehicleId);
          const route = i.routeId ? store.find('routes', (r) => r.id === i.routeId) : null;
          return {
            date: i.date,
            incidentId: i.id,
            vehicle: vehicle ? vehicle.regNo : '-',
            route: route ? route.code : '-',
            type: i.type,
            severity: i.severity,
            description: i.description,
            actionTaken: i.actionTaken || '-',
            status: i.status,
          };
        }),
  },

  /** Consolidated management summary - one row per KPI. */
  summary: {
    title: 'Management Summary',
    columns: ['Metric', 'Value'],
    build: ({ from, to }) => {
      const trips = store.filter('trips', (t) => t.date >= from && t.date <= to);
      const completed = trips.filter((t) => t.status === 'completed');
      const attendance = store.filter('attendance', (a) => a.date >= from && a.date <= to);
      const fuel = store.filter('fuel', (f) => f.date >= from && f.date <= to);
      const maint = store.filter('maintenance', (m) => m.date >= from && m.date <= to);
      const km = sum(completed, (t) => t.actualKm);
      const passengers = sum(completed, (t) => t.passengersBoarded);
      const boarded = attendance.filter((a) => a.boarded).length;
      const fuelSpend = sum(fuel, (f) => f.amount);
      const maintSpend = sum(maint, (m) => m.cost);

      return [
        { metric: 'Reporting period', value: `${from} to ${to}` },
        { metric: 'Company', value: config.company.name },
        { metric: 'Fleet size', value: store.collection('vehicles').length },
        { metric: 'Active drivers', value: store.collection('drivers').filter((d) => d.status === 'active').length },
        { metric: 'Employees served', value: store.collection('employees').filter((e) => e.status === 'active').length },
        { metric: 'Routes operated', value: store.collection('routes').filter((r) => r.status === 'active').length },
        { metric: 'Total trips', value: trips.length },
        { metric: 'Trips completed', value: completed.length },
        { metric: 'Trips cancelled', value: trips.filter((t) => t.status === 'cancelled').length },
        { metric: 'Trip completion rate %', value: trips.length ? round((completed.length / trips.length) * 100, 1) : 0 },
        { metric: 'Distance operated (km)', value: round(km, 1) },
        { metric: 'Passenger boardings', value: passengers },
        { metric: 'Employee attendance rate %', value: attendance.length ? round((boarded / attendance.length) * 100, 1) : 0 },
        { metric: 'Average trip length (km)', value: completed.length ? round(km / completed.length, 1) : 0 },
        { metric: 'Fuel spend (INR)', value: round(fuelSpend, 2) },
        { metric: 'Maintenance spend (INR)', value: round(maintSpend, 2) },
        { metric: 'Total direct cost (INR)', value: round(fuelSpend + maintSpend, 2) },
        { metric: 'Cost per km (INR)', value: km > 0 ? round((fuelSpend + maintSpend) / km, 2) : 0 },
        { metric: 'Cost per passenger (INR)', value: passengers > 0 ? round((fuelSpend + maintSpend) / passengers, 2) : 0 },
        { metric: 'Compliance documents expiring (30 days)', value: store.collection('documents').filter((d) => { const dl = daysBetween(today(), d.expiryDate); return dl >= 0 && dl <= 30; }).length },
        { metric: 'Compliance documents expired', value: store.collection('documents').filter((d) => daysBetween(today(), d.expiryDate) < 0).length },
        { metric: 'Open incidents', value: store.collection('incidents').filter((i) => i.status !== 'closed').length },
      ];
    },
  },
};

const router = express.Router();
router.use(authenticate);

/** GET /api/reports - catalogue of available reports. */
router.get('/', (_req, res) => {
  res.json({
    data: Object.entries(REPORT_DEFINITIONS).map(([key, def]) => ({
      key,
      title: def.title,
      columns: def.columns,
      json: `/api/reports/${key}.json`,
      csv: `/api/reports/${key}.csv`,
    })),
  });
});

function handle(key) {
  return (req, res) => {
    const def = REPORT_DEFINITIONS[key];
    if (!def) throw new ApiError(404, `Unknown report "${key}".`);
    const range = resolveRange(req.query);
    const rows = def.build(range);

    if (req.path.endsWith('.csv')) {
      const csv = toCsv(rows);
      const filename = `${key}-${range.from}-to-${range.to}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    const numeric = rows.length && rows.every((r) => Object.values(r).every((v) => v === null || typeof v !== 'object'));
    return res.json({
      data: rows,
      meta: {
        key,
        title: def.title,
        columns: def.columns,
        range,
        rowCount: rows.length,
        generatedAt: new Date().toISOString(),
        company: config.company,
        totals: numeric ? buildTotals(rows) : null,
      },
    });
  };
}

function buildTotals(rows) {
  const totals = {};
  for (const key of Object.keys(rows[0])) {
    const values = rows.map((r) => r[key]);
    if (values.every((v) => typeof v === 'number')) {
      totals[key] = round(values.reduce((a, v) => a + v, 0), 2);
    }
  }
  return totals;
}

for (const key of Object.keys(REPORT_DEFINITIONS)) {
  router.get(`/${key}.json`, handle(key));
  router.get(`/${key}.csv`, handle(key));
}

/** POST /api/reports/email - placeholder hook for scheduled distribution. */
router.post('/email', (_req, res) => {
  res.status(501).json({
    error: true,
    status: 501,
    message: 'Email distribution is not configured. Set up an SMTP relay and enable it in settings.',
  });
});

module.exports = router;
module.exports.REPORT_DEFINITIONS = REPORT_DEFINITIONS;
module.exports.toCsv = toCsv;
