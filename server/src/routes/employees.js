'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');

const router = createResource({
  collection: 'employees',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'EMP',
  sortField: 'name',
  searchFields: ['name', 'code', 'email', 'phone', 'department', 'stop'],
  filterFields: ['status', 'department', 'routeId', 'shiftId', 'gender'],
  defaults: { status: 'active', gender: 'male' },
  validate: validators.combine(
    validators.required(['name', 'code', 'phone']),
    validators.unique('code', 'Employee code'),
    validators.oneOf('status', ['active', 'inactive', 'on-leave'], 'Status'),
    (payload) => {
      if (payload.routeId && !store.find('routes', (r) => r.id === payload.routeId)) {
        throw new (require('../utils/helpers').ApiError)(400, `Route ${payload.routeId} does not exist.`);
      }
    },
  ),
  decorate: (record) => {
    const route = record.routeId ? store.find('routes', (r) => r.id === record.routeId) : null;
    const shift = record.shiftId ? store.find('shifts', (s) => s.id === record.shiftId) : null;
    const bookings = store.filter('bookings', (b) => b.employeeId === record.id);
    const attended = store.filter('attendance', (a) => a.employeeId === record.id);
    const boarded = attended.filter((a) => a.boarded).length;
    const noShows = attended.filter((a) => !a.boarded).length;

    return {
      ...record,
      routeName: route ? `${route.code} - ${route.name}` : 'Unassigned',
      shiftName: shift ? shift.name : 'Unassigned',
      stats: {
        bookings: bookings.length,
        boarded,
        noShows,
        attendanceRate: attended.length ? Math.round((boarded / attended.length) * 1000) / 10 : null,
      },
    };
  },
});

module.exports = router;
