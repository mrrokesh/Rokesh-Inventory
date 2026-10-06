let currency = 'INR';
export const setCurrency = (c) => { currency = c || 'INR'; };

const moneyFmt = new Map();
export function money(v: any, { symbol = true }: { symbol?: boolean } = {}) {
  const n = Number(v) || 0;
  const key = `${currency}-${symbol}`;
  if (!moneyFmt.has(key)) {
    moneyFmt.set(key, symbol
      ? new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return moneyFmt.get(key).format(n);
}

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const qty = (v) => qtyFmt.format(Number(v) || 0);

export function date(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!d) return s;
  return `${d}/${m}/${y}`;
}

export function dateTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const label = (s) => (s ? String(s).replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

export function fileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function addressLines(a) {
  if (!a) return [];
  return [a.attention, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(', '), a.country, a.phone && `Phone: ${a.phone}`].filter(Boolean);
}

export const PAYMENT_MODES = [
  ['cash', 'Cash'], ['bank_transfer', 'Bank Transfer'], ['upi', 'UPI'], ['cheque', 'Cheque'],
  ['card', 'Card'], ['online_gateway', 'Online Gateway'], ['other', 'Other'],
];
export const modeLabel = (m) => PAYMENT_MODES.find((x) => x[0] === m)?.[1] || label(m);

export const PAYMENT_TERMS = [
  [0, 'Due on Receipt'], [7, 'Net 7'], [15, 'Net 15'], [30, 'Net 30'], [45, 'Net 45'], [60, 'Net 60'], [90, 'Net 90'],
];

export const INDIAN_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Convert rows to CSV and trigger a download. columns: [{key,label}] — used for import templates. */
export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))];
  triggerDownload(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), filename);
}

function excelValue(v: unknown) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const n = Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v.trim())) return n;
  return String(v);
}

/** Excel .xlsx (Office Open XML) download — current Excel workbook format. */
export async function downloadXlsx(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const mod = await import('exceljs');
  const ExcelJS = (mod as { default?: typeof import('exceljs') }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rokesh Inventory';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Export', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(42, Math.max(12, String(c.label).length + 4)),
  }));
  for (const r of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, excelValue(r[c.key])])));
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.commit();
  const buf = await wb.xlsx.writeBuffer();
  const name = String(filename).replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    name,
  );
}

/** Minimal RFC-4180 CSV parser → array of objects keyed by header (lower_snake_case). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}
