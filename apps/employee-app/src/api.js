import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_ORIGIN = 'https://select-mobility-tms.onrender.com';
const TOKEN_KEY = 'smi_employee_token';
const USER_KEY = 'smi_employee_user';
let token = '';
let user = null;

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}

export async function restoreSession() {
  try {
    const [t, u] = await Promise.all([AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
    token = t || ''; user = u ? JSON.parse(u) : null;
  } catch { token = ''; user = null; }
  return Boolean(token && user && user.role === 'employee');
}

export async function clearSession() {
  token = ''; user = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(`${DEFAULT_ORIGIN}/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError('Cannot reach PeoplePilot. Check the phone connection.'); }
  const raw = await res.text();
  let payload = null; try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: raw }; }
  if (res.status === 401) { await clearSession(); throw new ApiError(payload?.message || 'Your session has expired.', 401); }
  if (!res.ok) throw new ApiError(payload?.message || `Request failed (${res.status})`, res.status);
  return payload;
}

export const api = {
  login: async (email, password) => {
    const result = await request('POST', '/auth/login', { email, password });
    if (result.user?.role !== 'employee') throw new ApiError('This app is only for employee accounts.');
    token = result.token; user = result.user;
    await AsyncStorage.multiSet([[TOKEN_KEY, token], [USER_KEY, JSON.stringify(user)]]);
    return result;
  },
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
};

export const employeeApi = {
  me: () => api.get('/mobile/employee/me'),
  requests: () => api.get('/mobile/employee/requests'),
  createRequest: (body) => api.post('/mobile/employee/requests', body),
  bookRide: (body) => api.post('/mobile/employee/bookings', body),
};
