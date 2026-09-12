'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { today, round } = require('../utils/helpers');

const router = createResource({
  collection: 'fuel',
  prefix: 'FUL',
  sortField: 'date',
  searchFields: ['station', 'paymentMode'],
  filterFields: ['vehicleId', 'paymentMode', 'date'],
  defaults: { date: today(), litres: 0, rate: 0, paymentMode: 'fuel-card' },
  validate: validators.combine(
    validators.required(['vehicleId', 'litres', 'rate', 'date']),
    validators.inRange('litres', 0, 1000, 'Litres'),
    validators.inRange('rate', 0, 500, 'Rate per litre'),
    validators.oneOf('paymentMode', ['fuel-card', 'cash', 'credit', 'vendor'], 'Payment mode'),
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
      amount: record.amount !== undefined ? record.amount : round(Number(record.litres) * Number(record.rate), 2),
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown',
      fuelType: vehicle ? vehicle.fuelType : '-',
    };
  },
});

module.exports = router;
