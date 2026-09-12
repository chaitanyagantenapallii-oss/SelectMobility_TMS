'use strict';

const express = require('express');
const { store } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { today, daysBetween, round, sum } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate);

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
