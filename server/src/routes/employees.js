'use strict';

const { createResource, validators } = require('./resource');
const { store } = require('../db/schema');
const { ApiError } = require('../utils/helpers');

const router = createResource({
  collection: 'employees',
  // Staff-only. The driver and client apps read through /api/mobile, which
  // scopes every row to the caller; these collections carry other
  // organisations' staff and the company's cost base.
  readRole: ['admin', 'operations', 'viewer'],
  prefix: 'EMP',
  sortField: 'name',
  searchFields: ['name', 'code', 'email', 'phone', 'department', 'stop', 'organisation'],
  filterFields: ['status', 'department', 'routeId', 'shiftId', 'gender', 'organisation'],
  defaults: { status: 'active', gender: 'male' },
  validate: validators.combine(
    validators.required(['name', 'code', 'phone']),
    validators.unique('code', 'Employee code'),
    validators.oneOf('status', ['active', 'inactive', 'on-leave'], 'Status'),
    (payload) => {
      if (payload.routeId && !store.find('routes', (r) => r.id === payload.routeId)) {
        throw new ApiError(400, `Route ${payload.routeId} does not exist.`);
      }

      /*
       * The company matters more than it looks.
       *
       * `employee.organisation` is the only thing that makes a person visible in
       * the Client app: /api/mobile/client/roster filters on it, and a client
       * login with no company is refused outright. An employee saved without one
       * is therefore added to the roster, appears in the desk, and is invisible
       * to the very customer whose staff they are - which reads as the Client app
       * being broken rather than a missing field. It was optional until now, and
       * every employee created from the desk silently landed in that state.
       *
       * Required from here on. Existing rows keep whatever they have, so this
       * does not invalidate the seeded data.
       */
      if (!payload.organisation) {
        throw new ApiError(
          400,
          'Choose the company this employee belongs to. Without one they will not appear in the Client app.',
          { fields: ['organisation'] },
        );
      }
      if (!store.find('organisations', (o) => o.name === payload.organisation)) {
        throw new ApiError(
          400,
          `No company named "${payload.organisation}" exists. Create it under Companies first.`,
          { fields: ['organisation'] },
        );
      }
    },
  ),
  decorate: (record) => {
    const route = record.routeId ? store.find('routes', (r) => r.id === record.routeId) : null;
    const shift = record.shiftId ? store.find('shifts', (s) => s.id === record.shiftId) : null;
    const company = record.organisation
      ? store.find('organisations', (o) => o.name === record.organisation)
      : null;
    const bookings = store.filter('bookings', (b) => b.employeeId === record.id);
    const attended = store.filter('attendance', (a) => a.employeeId === record.id);
    const boarded = attended.filter((a) => a.boarded).length;
    const noShows = attended.filter((a) => !a.boarded).length;

    return {
      ...record,
      routeName: route ? `${route.code} - ${route.name}` : 'Unassigned',
      shiftName: shift ? shift.name : 'Unassigned',
      companyId: company ? company.id : null,
      // Surfaced so the desk can see at a glance who is not attached to a client.
      unassignedCompany: !record.organisation,
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
