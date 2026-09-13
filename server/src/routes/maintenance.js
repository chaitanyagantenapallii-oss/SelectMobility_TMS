'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { today, daysBetween } = require('../utils/helpers');

const router = createResource({
  collection: 'maintenance',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'MNT',
  sortField: 'date',
  searchFields: ['description', 'workshop', 'type', 'status'],
  filterFields: ['vehicleId', 'type', 'status'],
  defaults: { status: 'scheduled', cost: 0, type: 'scheduled-service', date: today() },
  validate: validators.combine(
    validators.required(['vehicleId', 'description', 'date']),
    validators.oneOf('type', ['scheduled-service', 'repair', 'tyre', 'breakdown', 'inspection', 'bodywork'], 'Maintenance type'),
    validators.oneOf('status', ['scheduled', 'in-progress', 'completed', 'cancelled'], 'Status'),
    validators.inRange('cost', 0, 10000000, 'Cost'),
    (payload) => {
      if (!store.find('vehicles', (v) => v.id === payload.vehicleId)) {
        throw new (require('../utils/helpers').ApiError)(400, `Vehicle ${payload.vehicleId} does not exist.`);
      }
    },
  ),
  decorate: (record) => {
    const vehicle = store.find('vehicles', (v) => v.id === record.vehicleId);
    return {
      ...record,
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown',
      vehicleModel: vehicle ? vehicle.model : '-',
      daysOpen: record.status === 'completed' ? 0 : daysBetween(record.date, today()),
      overdue: record.status === 'scheduled' && daysBetween(today(), record.date) < 0,
    };
  },
});

module.exports = router;
