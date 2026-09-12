'use strict';

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { daysBetween, today } = require('../utils/helpers');

const base = createResource({
  collection: 'documents',
  prefix: 'DOC',
  sortField: 'expiryDate',
  searchFields: ['title', 'number', 'issuedBy', 'type'],
  filterFields: ['vehicleId', 'type', 'status'],
  defaults: { status: 'valid', type: 'insurance' },
  validate: validators.combine(
    validators.required(['vehicleId', 'type', 'expiryDate']),
    validators.oneOf('type', ['insurance', 'permit', 'puc', 'fitness', 'road-tax', 'contract'], 'Document type'),
  ),
  decorate: (record) => {
    const vehicle = store.find('vehicles', (v) => v.id === record.vehicleId);
    const daysLeft = record.expiryDate ? daysBetween(today(), record.expiryDate) : null;
    let status = 'valid';
    if (daysLeft !== null) {
      if (daysLeft < 0) status = 'expired';
      else if (daysLeft <= 30) status = 'expiring';
    }
    return { ...record, status, vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown', daysLeft };
  },
});

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/documents/alerts
 * Compliance radar: everything expired or expiring inside the alert window.
 */
router.get('/alerts', (req, res) => {
  const windowDays = Number(req.query.window || 45);
  const rows = store.collection('documents').map((doc) => {
    const vehicle = store.find('vehicles', (v) => v.id === doc.vehicleId);
    const daysLeft = daysBetween(today(), doc.expiryDate);
    return {
      id: doc.id,
      type: doc.type,
      title: doc.title,
      number: doc.number,
      vehicleId: doc.vehicleId,
      vehicleRegNo: vehicle ? vehicle.regNo : 'Unknown',
      expiryDate: doc.expiryDate,
      daysLeft,
      severity: daysLeft < 0 ? 'expired' : daysLeft <= 15 ? 'critical' : 'warning',
    };
  })
    .filter((d) => d.daysLeft <= windowDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  res.json({
    data: rows,
    meta: {
      window: windowDays,
      expired: rows.filter((r) => r.severity === 'expired').length,
      critical: rows.filter((r) => r.severity === 'critical').length,
      warning: rows.filter((r) => r.severity === 'warning').length,
    },
  });
});

router.use('/', base);

module.exports = router;
