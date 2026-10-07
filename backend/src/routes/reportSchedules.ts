// Favourite reports and reports emailed on a schedule (daily / weekly / monthly).
import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { appUrl, emailLayout, esc, logEmail, sendMail } from '../lib/mailer.js';

// Loaded lazily: reports.ts mounts this router, so a static import back would be circular.
const reports = () => import('./reports.js');

export const reportExtrasRouter = Router();
const r = reportExtrasRouter;

// ------------------------------------------------------------------ favourites (per user)
r.get('/favourites', can('reports', 'view'), async (req, res) => {
  const { rows } = await query('SELECT report_key FROM report_favourites WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
  res.json(rows.map((x) => x.report_key));
});

r.put('/favourites/:key', can('reports', 'view'), async (req, res) => {
  if (!(await (await reports()).reportExists(req.params.key, req.orgId))) throw notFound('Report');
  await query('INSERT INTO report_favourites (user_id, report_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, req.params.key]);
  res.status(204).end();
});

r.delete('/favourites/:key', can('reports', 'view'), async (req, res) => {
  await query('DELETE FROM report_favourites WHERE user_id = $1 AND report_key = $2', [req.user.id, req.params.key]);
  res.status(204).end();
});

// ------------------------------------------------------------------ schedules
const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'this_year', 'last_30_days', 'last_12_months'];
const FREQ = ['daily', 'weekly', 'monthly'];

/** Next run time (timestamptz) after now, at `hour` o'clock in the organization's time zone. */
export async function nextRunAt(orgId, s) {
  const { rows: [o] } = await query("SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz, to_char(now() AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS local FROM organizations WHERE id = $1", [orgId]);
  const localNow = new Date(`${o.local}Z`); // wall-clock time, handled as if UTC
  for (let d = 0; d < 70; d++) {
    const c = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + d, s.hour, 0, 0));
    if (c <= localNow) continue;
    if (s.frequency === 'weekly' && c.getUTCDay() !== Number(s.weekday)) continue;
    if (s.frequency === 'monthly' && c.getUTCDate() !== Number(s.day_of_month)) continue;
    const wall = c.toISOString().slice(0, 19).replace('T', ' ');
    const { rows: [x] } = await query('SELECT ($1::timestamp AT TIME ZONE $2) AS at', [wall, o.tz]);
    return x.at;
  }
  throw badRequest('Could not work out when this schedule should run');
}

async function parseSchedule(orgId, b) {
  const report_key = String(b.report_key || '');
  if (!(await (await reports()).reportExists(report_key, orgId))) throw badRequest('Choose a report');
  const frequency = FREQ.includes(b.frequency) ? b.frequency : null;
  if (!frequency) throw badRequest('Choose how often to send it');
  const period = PERIODS.includes(b.period) ? b.period : 'this_month';
  const hour = Math.trunc(Number(b.hour));
  if (!(hour >= 0 && hour <= 23)) throw badRequest('Choose the time to send it');
  const weekday = frequency === 'weekly' ? Math.trunc(Number(b.weekday)) : null;
  if (frequency === 'weekly' && !(weekday >= 0 && weekday <= 6)) throw badRequest('Choose the day of the week');
  const day_of_month = frequency === 'monthly' ? Math.trunc(Number(b.day_of_month)) : null;
  if (frequency === 'monthly' && !(day_of_month >= 1 && day_of_month <= 28)) throw badRequest('Choose a day of the month between 1 and 28');
  const recipients = [...new Set(String(b.recipients || '').split(/[,;\s]+/).filter(Boolean))];
  if (!recipients.length) throw badRequest('Add at least one email address');
  for (const e of recipients) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest(`“${e}” is not a valid email address`);
  if (recipients.length > 20) throw badRequest('Up to 20 recipients');
  let warehouse_id = b.warehouse_id ? Number(b.warehouse_id) : null;
  if (warehouse_id) {
    const { rows } = await query('SELECT 1 FROM warehouses WHERE org_id = $1 AND id = $2', [orgId, warehouse_id]);
    if (!rows.length) warehouse_id = null;
  }
  return { report_key, frequency, period, hour, weekday, day_of_month, recipients: recipients.join(', '), warehouse_id, is_active: b.is_active === undefined ? true : !!b.is_active };
}

r.get('/schedules', can('reports', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.name AS created_by_name FROM report_schedules s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.org_id = $1 ${req.query.report_key ? 'AND s.report_key = $2' : ''} ORDER BY s.created_at`,
    req.query.report_key ? [req.orgId, String(req.query.report_key)] : [req.orgId],
  );
  res.json(rows);
});

const COLS = ['report_key', 'frequency', 'period', 'hour', 'weekday', 'day_of_month', 'recipients', 'warehouse_id', 'is_active'];

r.post('/schedules', can('reports', 'export'), async (req, res) => {
  const v = await parseSchedule(req.orgId, req.body || {});
  const next = await nextRunAt(req.orgId, v);
  const { rows: [row] } = await query(
    `INSERT INTO report_schedules (org_id, created_by, next_run_at, ${COLS.join(', ')}) VALUES ($1, $2, $3, ${COLS.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING *`,
    [req.orgId, req.user.id, next, ...COLS.map((k) => v[k])],
  );
  await audit({ query }, req, 'create', 'report_schedule', row.id, `Scheduled report “${row.report_key}” (${row.frequency}) to ${row.recipients}`);
  res.status(201).json(row);
});

r.put('/schedules/:id', can('reports', 'export'), async (req, res) => {
  const v = await parseSchedule(req.orgId, req.body || {});
  const next = await nextRunAt(req.orgId, v);
  const { rows: [row] } = await query(
    `UPDATE report_schedules SET next_run_at = $3, ${COLS.map((k, i) => `${k} = $${i + 4}`).join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`,
    [req.orgId, Number(req.params.id), next, ...COLS.map((k) => v[k])],
  );
  if (!row) throw notFound('Schedule');
  res.json(row);
});

r.delete('/schedules/:id', can('reports', 'export'), async (req, res) => {
  const { rows: [row] } = await query('DELETE FROM report_schedules WHERE org_id = $1 AND id = $2 RETURNING report_key', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Schedule');
  await audit({ query }, req, 'delete', 'report_schedule', Number(req.params.id), `Scheduled report “${row.report_key}” removed`);
  res.status(204).end();
});

/** Send a schedule now (also used by the "Send now" button). */
r.post('/schedules/:id/send', can('reports', 'export'), async (req, res) => {
  const { rows: [s] } = await query('SELECT * FROM report_schedules WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!s) throw notFound('Schedule');
  await deliver(s, false);
  const { rows: [after] } = await query('SELECT * FROM report_schedules WHERE id = $1', [s.id]);
  if (after.last_status === 'failed') throw badRequest(after.last_error || 'Sending failed');
  res.json(after);
});

// ------------------------------------------------------------------ rendering & delivery
const fmtCell = (c, v) => {
  if (v === null || v === undefined) return '';
  if (c.type === 'money') return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
  if (c.type === 'number') return String(Math.round(Number(v) * 1000) / 1000);
  if (c.type === 'percent') return `${Number(v).toFixed(2)}%`;
  if (c.type === 'date') return String(v instanceof Date ? v.toISOString() : v).slice(0, 10).split('-').reverse().join('/');
  if (c.type === 'datetime') return new Date(v).toLocaleString('en-IN');
  if (c.type === 'label' || c.type === 'status') return String(v).replace(/_/g, ' ');
  return String(v);
};
const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function reportCsv(rep) {
  const lines = [rep.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rep.rows) lines.push(rep.columns.map((c) => csvCell(fmtCell({ ...c, type: c.type === 'money' ? 'plain' : c.type }, row[c.key]))).join(','));
  if (rep.totals) lines.push(rep.columns.map((c, i) => (i === 0 ? 'Total' : rep.totals[c.key] !== undefined ? String(rep.totals[c.key]) : '')).join(','));
  return `﻿${lines.join('\r\n')}`;
}

export function reportHtml(rep, maxRows = 100) {
  const num = (c) => ['money', 'number', 'percent'].includes(c.type);
  const td = (c, v, extra = '') => `<td style="padding:6px 8px;border-bottom:1px solid #eee;${num(c) ? 'text-align:right;' : ''}${extra}">${esc(fmtCell(c, v))}</td>`;
  const head = rep.columns.map((c) => `<th style="padding:6px 8px;background:#f4f5f8;text-align:${num(c) ? 'right' : 'left'};font-size:12px">${esc(c.label)}</th>`).join('');
  const body = rep.rows.slice(0, maxRows).map((row) => `<tr>${rep.columns.map((c) => td(c, row[c.key])).join('')}</tr>`).join('');
  const total = rep.totals && rep.rows.length
    ? `<tr>${rep.columns.map((c, i) => (i === 0 ? '<td style="padding:6px 8px;font-weight:700">Total</td>' : rep.totals[c.key] !== undefined ? td(c, rep.totals[c.key], 'font-weight:700;') : '<td></td>')).join('')}</tr>` : '';
  const more = rep.rows.length > maxRows ? `<p style="color:#5a6276;font-size:12px">Showing the first ${maxRows} of ${rep.rows.length} rows — the attached file has them all.</p>` : '';
  const empty = rep.rows.length ? '' : '<p style="color:#5a6276">No data for this period.</p>';
  return `<div style="overflow-x:auto"><table role="presentation" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%"><tr>${head}</tr>${body}${total}</table></div>${more}${empty}`;
}

async function deliver(s, reschedule = true) {
  const recipients = s.recipients.split(/[,;\s]+/).filter(Boolean);
  let status = 'sent';
  let error = null;
  let subject = `Scheduled report ${s.report_key}`;
  try {
    const { runReport } = await reports();
    const rep = await runReport(s.org_id, s.report_key, { period: s.period, warehouse_id: s.warehouse_id });
    const { rows: [org] } = await query('SELECT name, email FROM organizations WHERE id = $1', [s.org_id]);
    const range = rep.dated ? `${rep.from.split('-').reverse().join('/')} – ${rep.to.split('-').reverse().join('/')}` : 'as of today';
    subject = `${rep.title} (${range}) – ${org.name}`;
    const html = emailLayout({
      orgName: org.name, title: rep.title, intro: `${rep.description || ''}\nPeriod: ${range}. ${rep.rows.length} row${rep.rows.length === 1 ? '' : 's'}.`,
      bodyHtml: reportHtml(rep), button: { label: 'Open the report', url: `${appUrl()}/reports/${s.report_key}?period=${s.period}` },
    });
    await sendMail(s.org_id, {
      to: recipients, subject, html, replyTo: org.email || undefined,
      attachments: [{ filename: `${s.report_key}-${rep.from}-${rep.to}.csv`, content: reportCsv(rep), contentType: 'text/csv; charset=utf-8' }],
    });
    await logEmail(s.org_id, { entityType: 'report', entityId: s.id, to: recipients, subject, status: 'sent' });
  } catch (err) {
    status = 'failed';
    error = err.message;
    await logEmail(s.org_id, { entityType: 'report', entityId: s.id, to: recipients, subject, status: 'failed', error }).catch(() => {});
  }
  const next = reschedule ? await nextRunAt(s.org_id, s) : s.next_run_at;
  await query('UPDATE report_schedules SET last_run_at = now(), last_status = $2, last_error = $3, next_run_at = $4 WHERE id = $1', [s.id, status, error, next]);
}

export function startReportScheduler() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await query("SELECT s.* FROM report_schedules s JOIN organizations o ON o.id = s.org_id WHERE s.is_active AND s.next_run_at <= now() AND o.status IN ('trial', 'active') ORDER BY s.next_run_at LIMIT 20");
      for (const s of rows) await deliver(s).catch((err) => console.error('Scheduled report error:', err.message));
    } catch (err) {
      console.error('Report scheduler error:', err.message);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 5 * 60 * 1000).unref();
  setTimeout(tick, 30000).unref();
}
