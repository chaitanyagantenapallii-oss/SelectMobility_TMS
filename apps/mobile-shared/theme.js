/**
 * Shared theme and formatting helpers for the mobile apps.
 *
 * The palette matches client/css/mobile.css so the installed app and the
 * browser version do not look like two different products. The numbers in
 * particular are duplicated deliberately: a rupee figure that reads "Rs 1,234"
 * in one place and "INR 1234" in another looks like a bug to a client.
 */

export const colors = {
  bg: '#f4f6fa',
  surface: '#ffffff',
  surface2: '#eef1f7',
  border: '#d8dee9',
  text: '#131a26',
  textDim: '#5a6577',
  brand: '#1b4ed8',
  brandDark: '#143a9e',
  brandSoft: '#e7edfd',
  ok: '#12784a',
  okSoft: '#e2f5ea',
  warn: '#9a6200',
  warnSoft: '#fdf1da',
  danger: '#b42318',
  dangerSoft: '#fdeceb',
};

export const spacing = { xs: 4, sm: 8, md: 14, lg: 20, xl: 28 };

/** Driver screens are used standing up with one hand; client screens are not. */
export const TAP_TARGET = 56;

/* --- Formatting ---------------------------------------------------------- */

export function money(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '-';
  const symbol = currency === 'INR' ? '\u20B9' : '';
  return (
    symbol +
    Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  );
}

export function compactMoney(value) {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (Math.abs(n) >= 10000000) return `\u20B9${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `\u20B9${(n / 100000).toFixed(2)} L`;
  if (Math.abs(n) >= 1000) return `\u20B9${(n / 1000).toFixed(1)}K`;
  return `\u20B9${n.toFixed(0)}`;
}

export function num(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function date(value) {
  if (!value) return '-';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateShort(value) {
  if (!value) return '-';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Status values come from the API; the label is what a person should read. */
export function statusLabel(status) {
  if (!status) return '-';
  return String(status).replace(/-/g, ' ');
}

/** Map an API status onto this theme's colour bucket. */
export function statusColor(status) {
  const map = {
    completed: colors.ok,
    confirmed: colors.brandDark,
    boarded: colors.ok,
    scheduled: colors.warn,
    'in-progress': colors.warn,
    active: colors.ok,
    open: colors.warn,
    acknowledged: colors.warn,
    'no-show': colors.danger,
    cancelled: colors.danger,
    breakdown: colors.danger,
    expired: colors.danger,
    resolved: colors.ok,
    closed: colors.ok,
  };
  return map[status] || colors.textDim;
}
