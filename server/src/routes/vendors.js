'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { round } = require('../utils/helpers');

const router = createResource({
  collection: 'vendors',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'VEN',
  sortField: 'name',
  searchFields: ['name', 'contact', 'phone', 'gstin'],
  filterFields: ['status'],
  defaults: { status: 'active', rating: 4 },
  validate: validators.combine(
    validators.required(['name', 'contact', 'phone']),
    validators.unique('name', 'Vendor name'),
    validators.inRange('rating', 0, 5, 'Rating'),
  ),
  decorate: (record) => {
    const vehicles = store.filter('vehicles', (v) => v.vendorId === record.id);
    const drivers = store.filter('drivers', (d) => d.vendorId === record.id);
    const trips = store.filter('trips', (t) => vehicles.some((v) => v.id === t.vehicleId));
    const expenses = store.filter('expenses', (e) => e.vendorId === record.id);
    return {
      ...record,
      vehicleCount: vehicles.length,
      driverCount: drivers.length,
      tripsServiced: trips.length,
      billedToDate: round(expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0), 2),
      vehicles: vehicles.map((v) => ({ id: v.id, regNo: v.regNo })),
    };
  },
});

module.exports = router;
