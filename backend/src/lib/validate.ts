import { badRequest } from './errors.js';

/** Small helpers to read and validate request bodies. */
type StrOpts = { field?: string; required?: boolean; max?: number };
type NumOpts = { field?: string; required?: boolean; min?: number; max?: number; def?: any };
type DateOpts = { field?: string; required?: boolean };
type OneOfOpts = { field?: string; def?: any };
type IdOpts = { field?: string; required?: boolean };
type EmailOpts = { field?: string; required?: boolean };

export function str(v: any, { field, required = false, max = 500 }: StrOpts = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return s;
}

export function num(v: any, { field, required = false, min, max, def = null }: NumOpts = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  if (min !== undefined && n < min) throw badRequest(`${field} must be at least ${min}`);
  if (max !== undefined && n > max) throw badRequest(`${field} must be at most ${max}`);
  return n;
}

export function int(v: any, opts: NumOpts = {}) {
  const n = num(v, opts);
  if (n !== null && !Number.isInteger(n)) throw badRequest(`${opts.field} must be a whole number`);
  return n;
}

export function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function date(v: any, { field, required = false }: DateOpts = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw badRequest(`${field} must be a valid date`);
  return s;
}

export function oneOf(v: any, values: any[], { field, def }: OneOfOpts = {}) {
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw badRequest(`${field} is required`);
  }
  if (!values.includes(v)) throw badRequest(`${field} must be one of: ${values.join(', ')}`);
  return v;
}

export function id(v: any, { field, required = false }: IdOpts = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} is invalid`);
  return n;
}

export function email(v: any, { field = 'Email', required = false }: EmailOpts = {}) {
  const s = str(v, { field, required, max: 254 });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`${field} is not a valid email address`);
  return s ? s.toLowerCase() : null;
}

export function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export const today = () => new Date().toISOString().slice(0, 10);

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** Pagination + sorting from query string. allowedSort maps public key -> SQL expression. */
export function listParams(q: any, allowedSort: Record<string, string>, defaultSort?: string) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(q.per_page, 10) || 25));
  const sortKey = allowedSort[q.sort] ? q.sort : defaultSort;
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  return {
    page, perPage, offset: (page - 1) * perPage,
    orderBy: `${allowedSort[sortKey]} ${dir} NULLS LAST`,
    search: q.search ? String(q.search).trim() : '',
  };
}
