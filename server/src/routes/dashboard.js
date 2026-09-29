'use strict';

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const { today, daysBetween, round, sum } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate);
// Dashboard, billing, and commercial data belong to the SMIPL operations desk.
// Client accounts use the organisation-scoped /api/mobile/client endpoints.
router.use(requireRole('operations', 'viewer'));

router.get('/billing', (_req, res) => {
  const invoices = store.collection('invoices');
  const vehicles = store.collection('vehicles').filter((v) => v.status !== 'inactive');
  const current = invoices.find((i) => i.organisation === 'Bharat Forge Ltd' && i.period === today().slice(0, 7)) || invoices.find((i) => i.organisation === 'Bharat Forge Ltd');
  res.json({ data: { vendorRate: 48000, clientRate: 60000, extraVendorTrip: 600, extraClientTrip: 900, operatingDays: 22, includedTripsPerVehicle: 66, activeVehicles: vehicles.length, clientBase: vehicles.length * 60000, vendorBase: vehicles.length * 48000, grossContribution: vehicles.length * 12000, gstRate: 18, invoices, current } });
});

router.get('/commercials', (_req, res) => res.json({ data: store.collection('commercials') }));
router.post('/commercials', (req, res) => {
  const b = req.body || {};
  const type = b.type === 'vendor' ? 'vendor' : 'client';
  const monthlyRate = Number(b.monthlyRate || 0);
  const vendorCost = Number(b.vendorCost || 0);
  if (!b.name || !b.organisation) return res.status(400).json({ error: 'Name and organisation are required.' });
  if (type === 'client' && !monthlyRate) return res.status(400).json({ error: 'Client monthly rate is required.' });
  if (type === 'vendor' && !vendorCost) return res.status(400).json({ error: 'Vendor monthly payable rate is required.' });
  const id = `COM${String(store.collection('commercials').length + 1).padStart(4, '0')}`;
  const record = { id, name: String(b.name), type, organisation: String(b.organisation), vehicleType: String(b.vehicleType || 'sedan'), operatingDays: Number(b.operatingDays || 22), includedTripsPerDay: Number(b.includedTripsPerDay || 3), monthlyRate, extraTripRate: Number(b.extraTripRate || 0), vendorCost, vendorExtraTripRate: Number(b.vendorExtraTripRate || 0), gstRate: Number(b.gstRate || 18), status: String(b.status || 'active'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.insert('commercials', record);
  res.status(201).json({ data: record });
});

/** GET /api/dashboard/overview - headline KPIs plus the day's operations board. */
router.get('/overview', (_req, res) => {
  const now = today();
  const vehicles = store.collection('vehicles');
  const drivers = store.collection('drivers');
  const employees = store.collection('employees');
  const trips = store.collection('trips');

  const todaysTrips = trips.filter((t) => t.date === now);
  const completedToday = todaysTrips.filter((t) => t.status === 'completed').length;

  const activeVehicles = vehicles.filter((v) => v.status === 'active').length;
  const activeEmployees = employees.filter((e) => e.status === 'active').length;

  // Attendance for the current operational day.
  const todayAttendance = store.collection('attendance').filter((a) => a.date === now);
  const boarded = todayAttendance.filter((a) => a.boarded).length;
  const attendanceRate = todayAttendance.length ? round((boarded / todayAttendance.length) * 100, 1) : null;

  // Compliance radar.
  const alerts = store.collection('documents')
    .map((doc) => {
      const vehicle = store.find('vehicles', (v) => v.id === doc.vehicleId);
      return { ...doc, vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown', daysLeft: daysBetween(now, doc.expiryDate) };
    })
    .filter((d) => d.daysLeft <= 45)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Fleet utilisation over the last 14 days.
  const utilisationSeries = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dayTrips = trips.filter((t) => t.date === date);
    const completed = dayTrips.filter((t) => t.status === 'completed');
    utilisationSeries.push({
      date,
      trips: dayTrips.length,
      completed: completed.length,
      cancelled: dayTrips.filter((t) => t.status === 'cancelled').length,
      km: round(sum(completed, (t) => t.actualKm), 1),
      passengers: sum(completed, (t) => t.passengersBoarded),
      utilisationPct: vehicles.length ? round((dayTrips.length / vehicles.length) * 100, 1) : 0,
    });
  }

  // Route wise pick-up load for today.
  const routeLoad = store.collection('routes').map((route) => {
    const rTrips = todaysTrips.filter((t) => t.routeId === route.id);
    const capacity = rTrips.reduce((acc, t) => {
      const v = store.find('vehicles', (x) => x.id === t.vehicleId);
      return acc + (v ? v.seats : 0);
    }, 0);
    const allocated = rTrips.reduce((acc, t) => acc + (t.passengersAllocated || 0), 0);
    return {
      routeId: route.id,
      code: route.code,
      name: route.name,
      trips: rTrips.length,
      capacity,
      allocated,
      fillPct: capacity ? round((allocated / capacity) * 100, 1) : 0,
      employees: employees.filter((e) => e.routeId === route.id && e.status === 'active').length,
    };
  });

  const monthPrefix = now.slice(0, 7);
  const monthExpenses = store.collection('expenses').filter((e) => e.month === monthPrefix);
  const monthFuel = store.collection('fuel').filter((f) => String(f.date || '').startsWith(monthPrefix));
  const monthMaint = store.collection('maintenance').filter((m) => String(m.date || '').startsWith(monthPrefix));

  // A single actionable queue connects the modules into one operating rhythm.
  // It is intentionally ordered by urgency rather than by record type.
  const workflowQueue = [];
  store.collection('serviceRequests').filter((r) => r.status === 'pending').slice(0, 8).forEach((r) => workflowQueue.push({
    id: r.id, type: 'request', priority: r.priority || 'normal', title: r.subject || 'Client transport request',
    detail: `${r.organisation || 'Client'} · awaiting desk decision`, action: 'requests', actionLabel: 'Review request',
  }));
  trips.filter((t) => t.driverAcceptance === 'pending' && t.status !== 'cancelled' && t.status !== 'completed').slice(0, 8).forEach((t) => {
    const route = store.find('routes', (r) => r.id === t.routeId);
    const driver = store.find('drivers', (d) => d.id === t.driverId);
    workflowQueue.push({ id: t.id, type: 'acceptance', priority: 'high', title: `${t.id} needs driver acceptance`, detail: `${route ? route.code : 'Route'} · ${driver ? driver.name : 'Unassigned'}`, action: 'trips', actionLabel: 'Open trip' });
  });
  trips.filter((t) => t.status === 'in-progress').slice(0, 8).forEach((t) => {
    const vehicle = store.find('vehicles', (v) => v.id === t.vehicleId);
    workflowQueue.push({ id: t.id, type: 'running', priority: 'normal', title: `${t.id} is in progress`, detail: `${vehicle ? vehicle.regNo : 'Vehicle'} · monitor live movement`, action: 'tracking', actionLabel: 'Track vehicle' });
  });
  store.collection('incidents').filter((i) => i.status !== 'closed').slice(0, 6).forEach((i) => workflowQueue.push({
    id: i.id, type: 'incident', priority: i.severity === 'high' ? 'high' : 'normal', title: i.description || 'Open incident', detail: `${i.vehicleId || 'Fleet'} · ${i.status}`, action: 'incidents', actionLabel: 'Open incident',
  }));
  workflowQueue.sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1));

  res.json({
    data: {
      generatedAt: new Date().toISOString(),
      kpis: {
        totalVehicles: vehicles.length,
        activeVehicles,
        vehiclesInMaintenance: vehicles.filter((v) => v.status === 'maintenance' || v.status === 'breakdown').length,
        totalDrivers: drivers.length,
        activeDrivers: drivers.filter((d) => d.status === 'active').length,
        totalEmployees: employees.length,
        activeEmployees,
        tripsToday: todaysTrips.length,
        completedToday,
        attendanceRate,
        complianceAlerts: alerts.filter((a) => a.daysLeft <= 30).length,
        openIncidents: store.collection('incidents').filter((i) => i.status !== 'closed').length,
        monthToDateCost: round(sum(monthExpenses, (e) => e.amount), 2),
        monthFuelCost: round(sum(monthFuel, (f) => f.amount), 2),
        monthMaintenanceCost: round(sum(monthMaint, (m) => m.cost), 2),
        fleetAvailabilityPct: vehicles.length ? round((activeVehicles / vehicles.length) * 100, 1) : 0,
      },
      todayBoard: todaysTrips
        .slice()
        .sort((a, b) => String(a.departureAt).localeCompare(String(b.departureAt)))
        .map((trip) => {
          const route = store.find('routes', (r) => r.id === trip.routeId);
          const vehicle = store.find('vehicles', (v) => v.id === trip.vehicleId);
          const driver = store.find('drivers', (d) => d.id === trip.driverId);
          const shift = store.find('shifts', (s) => s.id === trip.shiftId);
          return {
            id: trip.id,
            departureAt: trip.departureAt,
            arrivalAt: trip.arrivalAt,
            status: trip.status,
            shift: shift ? shift.code : '-',
            route: route ? `${route.code} ${route.name}` : '-',
            vehicle: vehicle ? vehicle.regNo : '-',
            driver: driver ? driver.name : '-',
            allocated: trip.passengersAllocated || 0,
            boarded: trip.passengersBoarded || 0,
            seats: vehicle ? vehicle.seats : 0,
          };
        }),
      utilisationSeries,
      routeLoad,
      complianceAlerts: alerts.slice(0, 12),
      recentIncidents: store.collection('incidents')
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 6)
        .map((i) => {
          const vehicle = store.find('vehicles', (v) => v.id === i.vehicleId);
          return { ...i, vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown' };
        }),
      upcomingMaintenance: store.collection('maintenance')
        .filter((m) => m.status !== 'completed' && m.status !== 'cancelled')
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(0, 6)
        .map((m) => {
          const vehicle = store.find('vehicles', (v) => v.id === m.vehicleId);
          return { ...m, vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown' };
        }),
      workflowQueue: workflowQueue.slice(0, 12),
    },
  });
});

/** GET /api/dashboard/vehicle-utilisation - per vehicle running summary (30 days). */
router.get('/vehicle-utilisation', (req, res) => {
  const days = Number(req.query.days || 30);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromIso = from.toISOString().slice(0, 10);

  const data = store.collection('vehicles').map((vehicle) => {
    const trips = store.filter('trips', (t) => t.vehicleId === vehicle.id && t.date >= fromIso);
    const completed = trips.filter((t) => t.status === 'completed');
    const fuel = store.filter('fuel', (f) => f.vehicleId === vehicle.id && f.date >= fromIso);
    const litres = sum(fuel, (f) => f.litres);
    const km = sum(completed, (t) => t.actualKm);
    return {
      vehicleId: vehicle.id,
      regNo: vehicle.regNo,
      model: vehicle.model,
      status: vehicle.status,
      seats: vehicle.seats,
      trips: trips.length,
      km: round(km, 1),
      litres: round(litres, 1),
      kmPerLitre: litres > 0 ? round(km / litres, 2) : null,
      fuelSpend: round(sum(fuel, (f) => f.amount), 2),
      passengers: sum(completed, (t) => t.passengersBoarded),
      costPerKm: km > 0 ? round(sum(fuel, (f) => f.amount) / km, 2) : null,
    };
  }).sort((a, b) => b.km - a.km);

  res.json({ data, meta: { windowDays: days, from: fromIso } });
});

module.exports = router;
