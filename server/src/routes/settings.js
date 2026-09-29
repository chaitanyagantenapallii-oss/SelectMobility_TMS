'use strict';

const express = require('express');
const { store } = require('../db/schema');
const { authenticate, requireRole, audit } = require('../middleware/auth');
const { ApiError, nowIso } = require('../utils/helpers');

/*
 * Desk-wide settings that are not per-user and not sensitive enough to belong
 * in the environment. Today that is only the map tile provider; the endpoint is
 * shaped as a named-scope key/value store so the next setting does not need a
 * new route.
 *
 * A tile key is a credential, so reads are open to any signed-in desk user (the
 * tracking map needs it to draw) but writes are operations-only, and the key is
 * never returned to a viewer who could not also write it. It is short-lived by
 * nature and scoped to fetching map images, so this is proportionate.
 */

const router = express.Router();
router.use(authenticate);

const DEFAULTS = {
  provider: '',
  key: '',
  tileUrlTemplate: '',
};

const TEMPLATES = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapbox: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token={key}',
  google: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key={key}',
};

function readMapSettings() {
  const row = store.find('settings', (s) => s.scope === 'map');
  return { ...DEFAULTS, ...(row || {}) };
}

/** GET /api/settings - top-level settings summary for integrations. */
router.get('/', (req, res) => {
  const map = readMapSettings();
  res.json({
    data: [{
      scope: 'map',
      provider: map.provider || '',
      tileUrlTemplate: map.tileUrlTemplate || '',
      tilesEnabled: !!(map.key && (map.tileUrlTemplate || TEMPLATES[map.provider])),
      updatedAt: map.updatedAt || null,
    }],
    meta: { scopes: 1 },
  });
});

/** GET /api/settings/map */
router.get('/map', (req, res) => {
  const s = readMapSettings();
  res.json({
    data: {
      provider: s.provider || '',
      key: s.key || '',
      tileUrlTemplate: s.tileUrlTemplate || '',
      // Told plainly, so the desk page does not have to infer it.
      tilesEnabled: !!(s.key && (s.tileUrlTemplate || TEMPLATES[s.provider])),
    },
  });
});

/** PUT/POST /api/settings/map */
const saveMap = (req, res) => {
  const body = req.body || {};
  const provider = String(body.provider || '').trim();
  const key = String(body.key || '').trim();
  const template = String(body.tileUrlTemplate || '').trim();

  if (provider && !TEMPLATES[provider] && provider !== 'custom') {
    throw new ApiError(400, `"${provider}" is not a map provider we know. Pick one from the list.`);
  }
  if (key && !(template || TEMPLATES[provider])) {
    throw new ApiError(400, 'Choose a provider or give a tile URL template to go with the key.');
  }
  if (template && !/^https:\/\//.test(template)) {
    throw new ApiError(400, 'The tile URL must be an https address.');
  }
  if (template && !/\{z\}/.test(template)) {
    throw new ApiError(400, 'The tile URL needs {z}, {x} and {y} placeholders.');
  }

  const patch = {
    scope: 'map',
    provider,
    key,
    tileUrlTemplate: template || TEMPLATES[provider] || '',
    updatedAt: nowIso(),
    updatedBy: req.user.email || req.user.name || req.user.id,
  };

  const existing = store.find('settings', (s) => s.scope === 'map');
  const saved = existing
    ? store.update('settings', existing.id, patch)
    : store.insert('settings', { id: store.nextId('settings', 'SET'), ...patch });

  audit(req, 'settings.map', key ? `Map tiles configured (${provider || 'custom'})` : 'Map tile key cleared');
  res.json({
    data: {
      provider: saved.provider,
      key: saved.key,
      tileUrlTemplate: saved.tileUrlTemplate,
      tilesEnabled: !!saved.key,
    },
  });
};

router.put('/map', requireRole('operations'), saveMap);
router.post('/map', requireRole('operations'), saveMap);

module.exports = router;
