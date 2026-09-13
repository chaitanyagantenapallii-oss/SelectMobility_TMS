'use strict';

const express = require('express');
const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, round, today } = require('../utils/helpers');

const CATEGORIES = ['driver-salary', 'vendor-hire', 'fuel', 'maintenance', 'toll', 'insurance', 'misc'];

const base = createResource({
  collection: 'expenses',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'EXP',
  sortField: 'month',
  searchFields: ['description', 'category', 'month'],
  filterFields: ['category', 'month', 'status', 'vendorId'],
  defaults: { month: today().slice(0, 7), amount: 0, status: 'pending' },
  validate: validators.combine(
    validators.required(['month', 'category', 'amount']),
    validators.oneOf('category', CATEGORIES, 'Expense category'),
    validators.oneOf('status', ['pending', 'approved', 'paid', 'rejected'], 'Status'),
    validators.inRange('amount', 0, 100000000, 'Amount'),
  ),
  decorate: (record) => {
    const vendor = record.vendorId ? store.find('vendors', (v) => v.id === record.vendorId) : null;
    return { ...record, vendorName: vendor ? vendor.name : '-' };
  },
});

const router = express.Router();
router.use(authenticate);

/** GET /api/expenses/summary - monthly rollup by category. */
router.get('/summary', (req, res) => {
  const rows = store.collection('expenses');
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const byMonth = months.map((month) => {
    const entries = rows.filter((r) => r.month === month);
    const categories = {};
    for (const cat of CATEGORIES) {
      categories[cat] = round(entries.filter((e) => e.category === cat).reduce((a, e) => a + Number(e.amount || 0), 0), 2);
    }
    return {
      month,
      total: round(entries.reduce((a, e) => a + Number(e.amount || 0), 0), 2),
      paid: round(entries.filter((e) => e.status === 'paid').reduce((a, e) => a + Number(e.amount || 0), 0), 2),
      pending: round(entries.filter((e) => e.status === 'pending').reduce((a, e) => a + Number(e.amount || 0), 0), 2),
      categories,
    };
  });

  const grandTotal = round(byMonth.reduce((a, m) => a + m.total, 0), 2);
  const byCategory = CATEGORIES.map((cat) => ({
    category: cat,
    total: round(rows.filter((r) => r.category === cat).reduce((a, e) => a + Number(e.amount || 0), 0), 2),
  })).sort((a, b) => b.total - a.total);

  res.json({
    data: {
      months: byMonth,
      byCategory,
      grandTotal,
      costPerTrip: null,
      averageMonthly: byMonth.length ? round(grandTotal / byMonth.length, 2) : 0,
    },
  });
});

/** POST /api/expenses/:id/approve */
router.post('/:id/approve', requireRole('operations'), (req, res) => {
  const expense = store.find('expenses', (e) => e.id === req.params.id);
  if (!expense) throw new ApiError(404, `Expense ${req.params.id} was not found.`);
  const status = req.body?.status || 'approved';
  if (!['approved', 'paid', 'rejected'].includes(status)) throw new ApiError(400, 'Status must be approved, paid or rejected.');

  const updated = store.update('expenses', expense.id, { status, approvedBy: req.user.email });
  audit(req, 'expenses.approve', `Expense ${expense.id} marked ${status}`);
  res.json({ data: updated });
});

router.use('/', base);

module.exports = router;
