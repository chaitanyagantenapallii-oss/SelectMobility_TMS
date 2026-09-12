'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { daysBetween, today, round } = require('../utils/helpers');

const router = createResource({
  collection: 'drivers',
  prefix: 'DRV',
  sortField: 'name',
  searchFields: ['name', 'phone', 'licenceNo', 'badge', 'status'],
  filterFields: ['status', 'vendorId', 'assignedVehicleId'],
  defaults: {
    status: 'active',
    vendorId: null,
    assignedVehicleId: null,
    experience: 0,
  },
  validate: validators.combine(
    validators.required(['name', 'phone', 'licenceNo']),
    validators.unique('licenceNo', 'Licence number'),
    validators.inRange('experience', 0, 60, 'Experience (years)'),
    validators.oneOf('status', ['active', 'on-leave', 'suspended', 'exited'], 'Status'),
  ),
  decorate: (record) => {
    const vehicle = record.assignedVehicleId ? store.find('vehicles', (v) => v.id === record.assignedVehicleId) : null;
    const vendor = record.vendorId ? store.find('vendors', (v) => v.id === record.vendorId) : null;
    const trips = store.filter('trips', (t) => t.driverId === record.id);
    const completed = trips.filter((t) => t.status === 'completed');
    const licenceDaysLeft = record.licenceExpiry ? daysBetween(today(), record.licenceExpiry) : null;

    return {
      ...record,
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unassigned',
      vendorName: vendor ? vendor.name : 'Own Fleet',
      licenceDaysLeft,
      licenceAlert: licenceDaysLeft !== null && licenceDaysLeft <= 30
        ? (licenceDaysLeft < 0 ? 'expired' : 'expiring')
        : 'ok',
      stats: {
        totalTrips: trips.length,
        completedTrips: completed.length,
        kmDriven: round(completed.reduce((acc, t) => acc + (Number(t.actualKm) || 0), 0), 1),
        onTimeRate: completed.length
          ? round((completed.filter((t) => Number(t.actualKm) <= Number(t.plannedKm) * 1.05).length / completed.length) * 100, 1)
          : null,
      },
    };
  },
});

module.exports = router;
