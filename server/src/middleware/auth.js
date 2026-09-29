'use strict';

const { verifyToken } = require('../utils/password');
const { store } = require('../db/schema');
const { ApiError } = require('../utils/helpers');

/** Attach req.user when a valid Bearer token is supplied. */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Authentication required.'));

  const payload = verifyToken(token);
  if (!payload) return next(new ApiError(401, 'Session expired or invalid. Please sign in again.'));

  const user = store.find('users', (u) => u.id === payload.sub);
  if (!user || user.status !== 'active') return next(new ApiError(401, 'Account is not active.'));

  // `organisation` scopes a client account to their own staff; `driverId` links
  // a driver account to their roster record. Both must be carried through here
  // because the mobile routes authorise on them and cannot re-derive them.
  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organisation: user.organisation || null,
    driverId: user.driverId || null,
    employeeId: user.employeeId || null,
    accountType: user.accountType || 'live',
    demo: user.accountType === 'demo',
  };
  return next();
}

/**
 * Role gate. `admin` may do anything; `operations` may manage day-to-day
 * records but not user accounts; `viewer` is read-only. `driver` and `client`
 * are scoped mobile roles - they are never granted write access to desk
 * resources, only to their own trips / their own organisation.
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required.'));
    if (req.user.role === 'admin') return next();
    if (roles.includes(req.user.role)) return next();
    return next(new ApiError(403, `Role "${req.user.role}" is not permitted to perform this action.`));
  };
}

/** Records an entry in the audit trail (best-effort, never blocks the request). */
function audit(req, action, detail) {
  try {
    const entry = {
      id: `AUD${String(store.collection('auditLog').length + 1).padStart(5, '0')}`,
      actor: req.user ? req.user.email : 'anonymous',
      action,
      detail,
      at: new Date().toISOString(),
    };
    store.insert('auditLog', entry);
  } catch (err) {
    console.error('[audit] failed to record entry:', err.message);
  }
}

module.exports = { authenticate, requireRole, audit };
