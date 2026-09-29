/**
 * Shared API client for the Select Mobility mobile apps.
 *
 * This is the React Native counterpart of client/js/api.js. It is a separate
 * file rather than an import of the web one because React Native has no
 * localStorage and no `fetch` default to a same-origin base URL, so the two
 * cannot literally share code - but they share the same contract and the same
 * field names, which is what actually matters.
 *
 * Scope note: nothing here decides what a user may see. The server enforces
 * that on every request. This file only carries the token.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Set this to your deployed origin before building. */
export const DEFAULT_ORIGIN = 'https://tms.cdsinfo.in';

const TOKEN_KEY = 'smi_tms_token';
const USER_KEY = 'smi_tms_user';
const ORIGIN_KEY = 'smi_tms_origin';

let token = '';
let user = null;
let origin = DEFAULT_ORIGIN;

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Restore a saved session. Call once at startup, before rendering, so the
 * first screen knows whether to show the login form or the app.
 */
export async function restoreSession() {
  try {
    const [t, u, o] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY),
      AsyncStorage.getItem(USER_KEY),
      AsyncStorage.getItem(ORIGIN_KEY),
    ]);
    token = t || '';
    user = u ? JSON.parse(u) : null;
    origin = o || DEFAULT_ORIGIN;
  } catch {
    token = '';
    user = null;
  }
  return Boolean(token && user);
}

export async function saveSession(nextToken, nextUser) {
  token = nextToken;
  user = nextUser;
  await AsyncStorage.multiSet([
    [TOKEN_KEY, nextToken],
    [USER_KEY, JSON.stringify(nextUser)],
    [ORIGIN_KEY, origin],
  ]);
}

export async function clearSession() {
  token = '';
  user = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

export function getToken() {
  return token;
}

export function getUser() {
  return user;
}

export function setOrigin(next) {
  origin = String(next || '').replace(/\/+$/, '') || DEFAULT_ORIGIN;
  AsyncStorage.setItem(ORIGIN_KEY, origin).catch(() => {});
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // A network failure is the common case on a driver's phone, so give it a
    // message that says what to do rather than the platform's wording.
    throw new ApiError('Cannot reach the office. Check your connection.', 0);
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (res.status === 401) {
    await clearSession();
    throw new ApiError((payload && payload.message) || 'Your session has expired.', 401);
  }

  if (!res.ok) {
    throw new ApiError(
      (payload && payload.message) || `Request failed (${res.status})`,
      res.status,
      payload && payload.details
    );
  }

  return payload;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),

  login: async (email, password) => {
    const res = await request('POST', '/auth/login', { email, password });
    await saveSession(res.token, res.user);
    return res;
  },
};

/* --- Driver endpoints ---------------------------------------------------- */

export const driverApi = {
  me: () => api.get('/mobile/driver/me'),
  trips: (params = '') => api.get(`/mobile/driver/trips${params}`),
  trip: (id) => api.get(`/mobile/driver/trips/${id}`),
  /**
   * Mark attendance. The endpoint accepts a batch because a driver ticks
   * several people at one stop; a single tap is a batch of one.
   * @param {string} id trip id
   * @param {Array<{bookingId:string, status:'completed'|'no-show'|'confirmed'}>} entries
   */
  attendance: (id, entries) => api.post(`/mobile/driver/trips/${id}/attendance`, { entries }),
  start: (id, odometerStart) => api.post(`/mobile/driver/trips/${id}/start`, { odometerStart }),
  complete: (id, payload) => api.post(`/mobile/driver/trips/${id}/complete`, payload),
  breakdown: (payload) => api.post('/mobile/driver/breakdown', payload),
  /**
   * Log fuel. `vehicleId` is optional: the server falls back to the trip's
   * vehicle, then the driver's assigned vehicle, then a registration lookup.
   * A driver at a pump knows their registration, not our internal id.
   */
  fuel: (payload) => api.post('/mobile/driver/fuel', payload),
};

/* --- Client endpoints ---------------------------------------------------- */

export const clientApi = {
  me: () => api.get('/mobile/client/me'),
  /** Answers with { data, meta }, not a bare array. */
  roster: () => api.get('/mobile/client/roster'),
  /** Answers with { data, meta }. Optional employeeId scopes to one person. */
  history: (employeeId) =>
    api.get(`/mobile/client/history${employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ''}`),
  /** Answers with { organisation, month, lines, totals }. */
  statement: () => api.get('/mobile/client/statement'),
  /** Answers with { data, meta }. */
  requests: () => api.get('/mobile/client/requests'),
  availableTrips: () => api.get('/mobile/client/available-trips'),
  bookings: (tripId, employeeIds) => api.post('/mobile/client/bookings', { tripId, employeeIds }),
  /**
   * Raise a request. The record field is `subject`; the form label says
   * "summary" because that reads better to a user.
   */
  raiseRequest: (payload) => api.post('/mobile/client/requests', payload),
  /**
   * Where the company's vehicles are right now.
   *
   * Scoped server-side to this account's own organisation, so it can never
   * return another client's vehicles. Answers with { data, meta }.
   */
  livePositions: () => api.get('/mobile/client/vehicles'),
  /**
   * The route one of this company's vehicles actually took.
   *
   * Includes the assigned driver's name and phone, which is what a client
   * chasing a delayed pickup actually needs.
   */
  tripTrail: (tripId) => api.get(`/mobile/client/trips/${tripId}/tracking`),
};
