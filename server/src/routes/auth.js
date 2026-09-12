'use strict';

const express = require('express');
const config = require('../config');
const { store } = require('../db/schema');
const { verifyPassword, createToken } = require('../utils/password');
const { authenticate, audit } = require('../middleware/auth');
const { ApiError } = require('../utils/helpers');

const router = express.Router();

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new ApiError(400, 'Email and password are required.');

  const user = store.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  if (user.status !== 'active') throw new ApiError(403, 'This account has been disabled.');

  const token = createToken(user);
  audit({ user }, 'auth.login', `${user.email} signed in`);
  res.json({
    token,
    expiresInHours: config.sessionHours,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    company: config.company,
  });
});

/** GET /api/auth/me */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user, company: config.company });
});

/** POST /api/auth/logout */
router.post('/logout', authenticate, (req, res) => {
  audit(req, 'auth.logout', `${req.user.email} signed out`);
  res.json({ ok: true });
});

/** POST /api/auth/change-password */
router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw new ApiError(400, 'Current and new password are required.');
  if (String(newPassword).length < 8) throw new ApiError(400, 'New password must be at least 8 characters.');

  const user = store.find('users', (u) => u.id === req.user.id);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    throw new ApiError(401, 'Current password is incorrect.');
  }

  const { hashPassword } = require('../utils/password');
  store.update('users', user.id, { passwordHash: hashPassword(newPassword) });
  audit(req, 'auth.password-changed', `${user.email} changed password`);
  res.json({ ok: true, message: 'Password updated successfully.' });
});

module.exports = router;
