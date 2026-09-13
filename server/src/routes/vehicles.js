'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { daysBetween, today, round } = require('../utils/helpers');

const router = createResource({
  collection: 'vehicles',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'VEH',
  sortField: 'regNo',
  searchFields: ['regNo', 'model', 'type', 'status'],
  filterFields: ['status', 'type', 'vendorId', 'fuelType', 'ownership'],
  defaults: {
    type: 'bus',
    seats: 32,
    fuelType: 'diesel',
    status: 'active',
    ownership: 'owned',
    odometer: 0,
    vendorId: null,
    lastServiceAt: null,
    nextServiceKm: null,
  },
  validate: validators.combine(
    validators.required(['regNo', 'model', 'type']),
    validators.unique('regNo', 'Registration number'),
    validators.inRange('seats', 4, 80, 'Seat capacity'),
    validators.inRange('odometer', 0, 2000000, 'Odometer'),
    validators.oneOf('status', ['active', 'idle', 'maintenance', 'breakdown', 'retired'], 'Status'),
    validators.oneOf('type', ['bus', 'van', 'car', 'tempo', 'ev-bus'], 'Vehicle type'),
  ),
  decorate: (record) => {
    const vendor = record.vendorId ? store.find('vendors', (v) => v.id === record.vendorId) : null;
    const driver = store.find('drivers', (d) => d.assignedVehicleId === record.id);
    const compliance = ['insuranceExpiry', 'permitExpiry', 'pucExpiry', 'fitnessExpiry'];
    const due = compliance
      .map((field) => ({ field, date: record[field] }))
      .filter((c) => c.date)
      .map((c) => ({ ...c, daysLeft: daysBetween(today(), c.date) }))
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const trips = store.filter('trips', (t) => t.vehicleId === record.id);
    const km = trips.reduce((acc, t) => acc + (Number(t.actualKm) || 0), 0);
    const fuelSpend = store
      .filter('fuel', (f) => f.vehicleId === record.id)
      .reduce((acc, f) => acc + (Number(f.amount) || 0), 0);

    return {
      ...record,
      vendorName: vendor ? vendor.name : 'Own Fleet',
      assignedDriver: driver ? { id: driver.id, name: driver.name, phone: driver.phone } : null,
      compliance,
      nextDue: due[0] || null,
      stats: {
        tripsLogged: trips.length,
        kmLogged: round(km, 1),
        fuelSpend: round(fuelSpend, 2),
        kmPerLitre: record.odometer && fuelSpend ? null : null,
      },
    };
  },
});

module.exports = router;
