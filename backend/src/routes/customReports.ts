// Custom report builder API. Saved reports appear in the report list as "custom_<id>" and run
// through runReport(), so period, tag filters, export, favourites and schedules all work for them.
import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { OPS, SOURCES, parseDefinition, runDefinition, sourceFields } from '../lib/reportBuilder.js';
import { periodRange } from './dashboard.js';

export const customReportsRouter = Router();
const r = customReportsRouter;

/** A saved report the user may open: their own, or shared with the organization. */
export async function visibleCustomReport(orgId, id, user?) {
  const { rows: [row] } = await query(
    `SELECT cr.*, u.name AS created_by_name FROM custom_reports cr LEFT JOIN users u ON u.id = cr.created_by WHERE cr.org_id = $1 AND cr.id = $2`,
    [orgId, id],
  );
  if (!row) return null;
  if (user && !row.shared && row.created_by !== user.id && !user.is_admin) return null;
  return row;
}

export async function listCustomReports(orgId, user) {
  const { rows } = await query(
    `SELECT cr.id, cr.name, cr.description, cr.source, cr.shared, cr.created_by, u.name AS created_by_name
       FROM custom_reports cr LEFT JOIN users u ON u.id = cr.created_by
      WHERE cr.org_id = $1 AND (cr.shared OR cr.created_by = $2 OR $3) ORDER BY cr.name`,
    [orgId, user?.id || 0, !!user?.is_admin],
  );
  return rows;
}

r.get('/builder/sources', can('reports', 'view'), async (req, res) => {
  const out = [];
  for (const [key, s] of Object.entries(SOURCES)) {
    out.push({ key, label: s.label, group: s.group, dated: s.dated !== false, tagged: !!s.tagAlias, fields: (await sourceFields(req.orgId, key)).map(({ key: k, label, type, sum }) => ({ key: k, label, type, sum })) });
  }
  res.json({ sources: out, ops: OPS });
});

/** Try a definition without saving it. */
r.post('/builder/preview', can('reports', 'view'), async (req, res) => {
  const b = req.body || {};
  if (!SOURCES[b.source]) throw badRequest('Choose what the report is about');
  const { rows: [o] } = await query('SELECT fiscal_year_start FROM organizations WHERE id = $1', [req.orgId]);
  let { from, to } = periodRange(b.period || 'this_year', o.fiscal_year_start);
  if (b.from) from = String(b.from).slice(0, 10);
  if (b.to) to = String(b.to).slice(0, 10);
  const result = await runDefinition(req.orgId, b.source, b.definition || {}, { from, to });
  res.json({ ...result, rows: result.rows.slice(0, 200), row_count: result.rows.length, from, to, dated: SOURCES[b.source].dated !== false });
});

r.get('/custom', can('reports', 'view'), async (req, res) => res.json(await listCustomReports(req.orgId, req.user)));

r.get('/custom/:id', can('reports', 'view'), async (req, res) => {
  const row = await visibleCustomReport(req.orgId, Number(req.params.id), req.user);
  if (!row) throw notFound('Report');
  res.json(row);
});

async function parseSaved(req) {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw badRequest('Give the report a name');
  if (!SOURCES[b.source]) throw badRequest('Choose what the report is about');
  const definition = parseDefinition(b.definition || {}, await sourceFields(req.orgId, b.source));
  return { name, description: String(b.description || '').trim().slice(0, 500) || null, source: b.source, definition: JSON.stringify(definition), shared: !!b.shared };
}

async function editable(req) {
  const row = await visibleCustomReport(req.orgId, Number(req.params.id), req.user);
  if (!row) throw notFound('Report');
  if (row.created_by !== req.user.id && !req.user.is_admin) throw badRequest('Only the person who made this report (or an administrator) can change it');
  return row;
}

r.post('/custom', can('reports', 'view'), async (req, res) => {
  const v = await parseSaved(req);
  const { rows: [row] } = await query(
    'INSERT INTO custom_reports (org_id, created_by, name, description, source, definition, shared) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.orgId, req.user.id, v.name, v.description, v.source, v.definition, v.shared],
  );
  await audit({ query }, req, 'create', 'custom_report', row.id, `Custom report “${row.name}” created${row.shared ? ' and shared' : ''}`);
  res.status(201).json(row);
});

r.put('/custom/:id', can('reports', 'view'), async (req, res) => {
  const cur = await editable(req);
  const v = await parseSaved(req);
  const { rows: [row] } = await query(
    'UPDATE custom_reports SET name = $2, description = $3, source = $4, definition = $5, shared = $6, updated_at = now() WHERE id = $1 RETURNING *',
    [cur.id, v.name, v.description, v.source, v.definition, v.shared],
  );
  await audit({ query }, req, 'update', 'custom_report', row.id, `Custom report “${row.name}” updated`);
  res.json(row);
});

r.delete('/custom/:id', can('reports', 'view'), async (req, res) => {
  const cur = await editable(req);
  await query('DELETE FROM custom_reports WHERE id = $1', [cur.id]);
  await query("DELETE FROM report_favourites WHERE report_key = $1", [`custom_${cur.id}`]);
  await query("DELETE FROM report_schedules WHERE org_id = $1 AND report_key = $2", [req.orgId, `custom_${cur.id}`]);
  await audit({ query }, req, 'delete', 'custom_report', cur.id, `Custom report “${cur.name}” deleted`);
  res.status(204).end();
});

export { runDefinition };
