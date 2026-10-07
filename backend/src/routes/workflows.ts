import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { listParams } from '../lib/validate.js';
import { WF_ACTIONS, WF_EVENTS, WF_MODULES, WF_OPS, executeRule, loadRecord, matches, moduleFields, parseRule, processDateRules } from '../lib/workflows.js';

// A saved date rule is checked straight away, so records already due today don't wait for the next pass.
const checkDateRule = (row) => { if (row.trigger_type === 'date' && row.is_active) processDateRules(row.id).catch((err) => console.error('Workflow date rule error:', err.message)); };

// Workflow rules live under Settings, so they use the settings permission.
const r = Router();

r.get('/meta', can('settings', 'view'), async (req, res) => {
  const modules = {};
  for (const [k, m] of Object.entries(WF_MODULES)) {
    const f = await moduleFields({ query }, req.orgId, k);
    modules[k] = { label: m.label, events: m.events, contact: m.kind === 'doc' ? m.contact : m.kind === 'contact' ? 'self' : null, document: m.kind === 'doc', ...f };
  }
  const { rows: users } = await query("SELECT id, name, email FROM users WHERE org_id = $1 AND status = 'active' ORDER BY name", [req.orgId]);
  res.json({ modules, events: WF_EVENTS, ops: WF_OPS, actions: WF_ACTIONS, users });
});

r.get('/', can('settings', 'view'), async (req, res) => {
  const params: any[] = [req.orgId];
  let where = 'org_id = $1';
  if (req.query.module) { params.push(String(req.query.module)); where += ` AND module = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM workflow_rules WHERE ${where} ORDER BY module, name`, params);
  res.json(rows);
});

r.get('/logs', can('settings', 'view'), async (req, res) => {
  const p = listParams(req.query, { created: 'created_at' }, 'created');
  const params: any[] = [req.orgId];
  const where = ['org_id = $1'];
  if (req.query.rule_id) { params.push(Number(req.query.rule_id)); where.push(`rule_id = $${params.length}`); }
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT * FROM workflow_logs WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM workflow_logs WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

r.get('/:id', can('settings', 'view'), async (req, res) => {
  const { rows: [row] } = await query('SELECT * FROM workflow_rules WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Workflow rule');
  res.json(row);
});

const COLS = ['name', 'description', 'module', 'trigger_type', 'events', 'date_field', 'offset_days', 'match', 'conditions', 'actions', 'is_active'];
const values = (v) => COLS.map((k) => (k === 'conditions' || k === 'actions' ? JSON.stringify(v[k]) : v[k]));

r.post('/', can('settings', 'edit'), async (req, res) => {
  const v = await parseRule({ query }, req.orgId, req.body || {});
  const { rows: [row] } = await query(
    `INSERT INTO workflow_rules (org_id, created_by, ${COLS.join(', ')}) VALUES ($1, $2, ${COLS.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
    [req.orgId, req.user.id, ...values(v)],
  );
  await audit({ query }, req, 'create', 'workflow_rule', row.id, `Workflow rule “${row.name}” created`);
  checkDateRule(row);
  res.status(201).json(row);
});

r.put('/:id', can('settings', 'edit'), async (req, res) => {
  const v = await parseRule({ query }, req.orgId, req.body || {});
  const { rows: [row] } = await query(
    `UPDATE workflow_rules SET ${COLS.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE org_id = $1 AND id = $2 RETURNING *`,
    [req.orgId, Number(req.params.id), ...values(v)],
  );
  if (!row) throw notFound('Workflow rule');
  await audit({ query }, req, 'update', 'workflow_rule', row.id, `Workflow rule “${row.name}” updated`);
  checkDateRule(row);
  res.json(row);
});

r.post('/:id/toggle', can('settings', 'edit'), async (req, res) => {
  const { rows: [row] } = await query('UPDATE workflow_rules SET is_active = NOT is_active, updated_at = now() WHERE org_id = $1 AND id = $2 RETURNING *', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Workflow rule');
  await audit({ query }, req, 'update', 'workflow_rule', row.id, `Workflow rule “${row.name}” ${row.is_active ? 'activated' : 'deactivated'}`);
  checkDateRule(row);
  res.json(row);
});

r.delete('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [row] } = await query('DELETE FROM workflow_rules WHERE org_id = $1 AND id = $2 RETURNING name', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Workflow rule');
  await audit({ query }, req, 'delete', 'workflow_rule', Number(req.params.id), `Workflow rule “${row.name}” deleted`);
  res.status(204).end();
});

/** Run a rule now against one record (its actions really run). `check_only` just reports whether conditions match. */
r.post('/:id/run', can('settings', 'edit'), async (req, res) => {
  const { rows: [rule] } = await query('SELECT * FROM workflow_rules WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!rule) throw notFound('Workflow rule');
  const entityId = Number(req.body?.entity_id);
  if (!entityId) throw badRequest('Choose a record to run the rule on');
  const rec = await loadRecord({ query }, req.orgId, rule.module, entityId);
  if (!rec) throw notFound('Record');
  const { fields } = await moduleFields({ query }, req.orgId, rule.module);
  const ok = matches(rule, rec, fields);
  if (req.body?.check_only || !ok) return res.json({ matched: ok, ran: false });
  const log = await executeRule(req.orgId, rule, rule.module, rec, 'manual', fields);
  res.json({ matched: true, ran: true, log });
});

export default r;
