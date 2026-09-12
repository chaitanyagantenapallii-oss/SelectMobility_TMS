'use strict';

/** Small shared helpers used across route handlers. */

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Parse a comma separated query value into a clean array. */
function csv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function paginate(rows, query) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(query.pageSize || rows.length || 1)));
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** Case-insensitive substring match over a set of fields. */
function matchesSearch(record, term, fields) {
  if (!term) return true;
  const needle = String(term).toLowerCase();
  return fields.some((f) => String(record[f] ?? '').toLowerCase().includes(needle));
}

/** Round to n decimals without floating point noise. */
function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sum(rows, selector) {
  return rows.reduce((acc, row) => acc + (Number(selector(row)) || 0), 0);
}

module.exports = { ApiError, nowIso, today, daysBetween, csv, paginate, matchesSearch, round, sum };
