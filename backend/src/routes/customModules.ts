// Custom modules (organization-defined record types), web tabs and web forms.
import crypto from 'node:crypto';
import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { listParams } from '../lib/validate.js';
import { CUSTOM_FIELD_TYPES, validateFieldValues } from '../lib/customFields.js';

export const LOOKUP_TYPES = ['customer', 'vendor', 'item'];
export const MODULE_FIELD_TYPES = [...CUSTOM_FIELD_TYPES, ...LOOKUP_TYPES];

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const keyify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// ------------------------------------------------------------------ module definitions
function parseFields(input) {
  const list = Array.isArray(input) ? input.slice(0, 50) : [];
  if (!list.length) throw badRequest('Add at least one field');
  const seen = new Set();
  return list.map((f, i) => {
    const label = String(f.label || '').trim().slice(0, 80);
    if (!label) throw badRequest(`Field ${i + 1}: enter a label`);
    const type = MODULE_FIELD_TYPES.includes(f.field_type) ? f.field_type : 'text';
    let key = keyify(f.field_key || label) || `field_${i + 1}`;
    for (let n = 2, base = key; seen.has(key); n++) key = `${base}_${n}`;
    seen.add(key);
    const options = type === 'dropdown'
      ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(/[\n,]+/)).map((o) => String(o).trim()).filter(Boolean))]
      : [];
    if (type === 'dropdown' && !options.length) throw badRequest(`${label}: add the dropdown choices`);
    return {
      field_key: key, label, field_type: type, options, required: !!f.required, show_in_list: f.show_in_list === undefined ? i < 4 : !!f.show_in_list,
      help_text: String(f.help_text || '').slice(0, 200) || null, default_value: f.default_value ? String(f.default_value).slice(0, 200) : null,
    };
  });
}

export const modulesRouter = Router();
const m = modulesRouter;

m.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT cm.*, (SELECT COUNT(*) FROM custom_records r WHERE r.module_id = cm.id)::int AS records
       FROM custom_modules cm WHERE cm.org_id = $1 ORDER BY cm.position, cm.name`,
    [req.orgId],
  );
  res.json({ modules: rows, field_types: MODULE_FIELD_TYPES });
});

async function parseModule(req, existing = null) {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw badRequest('Give the module a name, e.g. Service requests');
  const singular = String(b.singular || '').trim().slice(0, 60) || name.replace(/s$/i, '');
  const slug = existing?.slug || slugify(b.slug || name);
  if (!slug) throw badRequest('Choose a name with letters or numbers');
  const prefix = String(b.number_prefix || singular.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'REC').toUpperCase().slice(0, 8);
  return {
    name, singular, slug, description: String(b.description || '').slice(0, 500) || null, fields: JSON.stringify(parseFields(b.fields)),
    number_prefix: prefix, show_in_nav: b.show_in_nav !== false, position: Number(b.position) || 0,
  };
}

m.post('/', can('settings', 'edit'), async (req, res) => {
  const v = await parseModule(req);
  try {
    const keys = Object.keys(v);
    const { rows: [row] } = await query(`INSERT INTO custom_modules (org_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.orgId, ...keys.map((k) => v[k])]);
    await audit({ query }, req, 'create', 'custom_module', row.id, `Custom module “${row.name}” created`);
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') throw conflict('A module with this name already exists');
    throw err;
  }
});

m.put('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [cur] } = await query('SELECT * FROM custom_modules WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!cur) throw notFound('Module');
  const v = await parseModule(req, cur);
  const keys = Object.keys(v).filter((k) => k !== 'slug');
  const { rows: [row] } = await query(`UPDATE custom_modules SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`, [req.orgId, cur.id, ...keys.map((k) => v[k])]);
  await audit({ query }, req, 'update', 'custom_module', row.id, `Custom module “${row.name}” updated`);
  res.json(row);
});

m.delete('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [cur] } = await query('SELECT cm.*, (SELECT COUNT(*) FROM custom_records r WHERE r.module_id = cm.id)::int AS n FROM custom_modules cm WHERE cm.org_id = $1 AND cm.id = $2', [req.orgId, Number(req.params.id)]);
  if (!cur) throw notFound('Module');
  if (cur.n && req.query.confirm !== 'delete-records') throw conflict(`“${cur.name}” has ${cur.n} record(s). Delete them too?`);
  await query('DELETE FROM custom_modules WHERE id = $1', [cur.id]);
  await audit({ query }, req, 'delete', 'custom_module', cur.id, `Custom module “${cur.name}” deleted with ${cur.n} record(s)`);
  res.status(204).end();
});

// ------------------------------------------------------------------ records
async function moduleBySlug(orgId, slug) {
  const { rows: [row] } = await query('SELECT * FROM custom_modules WHERE org_id = $1 AND slug = $2', [orgId, slug]);
  if (!row) throw notFound('Module');
  return row;
}

/** Validate record data: regular field types via the custom-field rules, lookups must point at this org's records. */
export async function parseRecordData(db, orgId, mod, input, existing = {}) {
  const fields = mod.fields || [];
  const plain = fields.filter((f) => !LOOKUP_TYPES.includes(f.field_type));
  const out: any = validateFieldValues(plain, input, existing);
  for (const f of fields.filter((x) => LOOKUP_TYPES.includes(x.field_type))) {
    const raw = input && f.field_key in input ? input[f.field_key] : existing?.[f.field_key];
    if (raw === undefined || raw === null || raw === '') {
      if (f.required) throw badRequest(`${f.label} is required`);
      delete out[f.field_key];
      continue;
    }
    const id = Number(raw);
    const sql = f.field_type === 'item' ? 'SELECT 1 FROM items WHERE org_id = $1 AND id = $2' : 'SELECT 1 FROM contacts WHERE org_id = $1 AND id = $2 AND contact_type = $3';
    const { rows } = await db.query(sql, f.field_type === 'item' ? [orgId, id] : [orgId, id, f.field_type]);
    if (!rows.length) throw badRequest(`${f.label}: choose a valid ${f.field_type}`);
    out[f.field_key] = id;
  }
  return out;
}

/** Names for lookup fields, so lists and pages can show "Acme Retail" instead of an id. */
async function lookupNames(orgId, mod, rows) {
  const lookups = (mod.fields || []).filter((f) => LOOKUP_TYPES.includes(f.field_type));
  if (!lookups.length) return {};
  const ids = { contact: new Set(), item: new Set() };
  for (const r of rows) for (const f of lookups) if (r.data?.[f.field_key]) ids[f.field_type === 'item' ? 'item' : 'contact'].add(Number(r.data[f.field_key]));
  const names = { contact: {}, item: {} };
  if (ids.contact.size) for (const x of (await query('SELECT id, display_name FROM contacts WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, [...ids.contact]])).rows) names.contact[x.id] = x.display_name;
  if (ids.item.size) for (const x of (await query('SELECT id, name FROM items WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, [...ids.item]])).rows) names.item[x.id] = x.name;
  return names;
}

export const recordsRouter = Router();
const rr = recordsRouter;

rr.get('/:slug/records', can('custom_modules', 'view'), async (req, res) => {
  const mod = await moduleBySlug(req.orgId, req.params.slug);
  const p = listParams(req.query, { created: 'r.created_at', number: 'r.number', updated: 'r.updated_at' }, 'created');
  const params: any[] = [mod.id];
  let where = 'r.module_id = $1';
  if (p.search) { params.push(`%${p.search}%`); where += ` AND (r.number ILIKE $2 OR r.data::text ILIKE $2)`; }
  for (const f of mod.fields || []) {
    const v = req.query[`f_${f.field_key}`];
    if (v) { params.push(String(v)); where += ` AND r.data->>'${f.field_key}' = $${params.length}`; }
  }
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT r.*, u.name AS created_by_name FROM custom_records r LEFT JOIN users u ON u.id = r.created_by WHERE ${where} ORDER BY ${p.orderBy}, r.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM custom_records r WHERE ${where}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage, module: mod, names: await lookupNames(req.orgId, mod, rows) });
});

rr.get('/:slug/records/:id', can('custom_modules', 'view'), async (req, res) => {
  const mod = await moduleBySlug(req.orgId, req.params.slug);
  const { rows: [row] } = await query(
    `SELECT r.*, u.name AS created_by_name, v.name AS updated_by_name FROM custom_records r
       LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users v ON v.id = r.updated_by WHERE r.module_id = $1 AND r.id = $2`,
    [mod.id, Number(req.params.id)],
  );
  if (!row) throw notFound(mod.singular);
  res.json({ ...row, module: mod, names: await lookupNames(req.orgId, mod, [row]) });
});

/** Create a record (also used by web forms). */
export async function createRecord(client, orgId, mod, data, { userId = null, source = 'app' } = {}) {
  const { rows: [n] } = await client.query('UPDATE custom_modules SET next_number = next_number + 1 WHERE id = $1 RETURNING next_number - 1 AS num', [mod.id]);
  const number = `${mod.number_prefix}-${String(n.num).padStart(5, '0')}`;
  const { rows: [row] } = await client.query(
    'INSERT INTO custom_records (org_id, module_id, number, data, source, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *',
    [orgId, mod.id, number, JSON.stringify(data), source, userId],
  );
  return row;
}

rr.post('/:slug/records', can('custom_modules', 'create'), async (req, res) => {
  const mod = await moduleBySlug(req.orgId, req.params.slug);
  const row = await tx(async (client) => {
    const data = await parseRecordData(client, req.orgId, mod, req.body?.data || {});
    const created = await createRecord(client, req.orgId, mod, data, { userId: req.user.id });
    await audit(client, req, 'create', `cm_${mod.slug}`, created.id, `${mod.singular} ${created.number} created`);
    return created;
  });
  res.status(201).json(row);
});

rr.put('/:slug/records/:id', can('custom_modules', 'edit'), async (req, res) => {
  const mod = await moduleBySlug(req.orgId, req.params.slug);
  const { rows: [cur] } = await query('SELECT * FROM custom_records WHERE module_id = $1 AND id = $2', [mod.id, Number(req.params.id)]);
  if (!cur) throw notFound(mod.singular);
  const data = await parseRecordData({ query }, req.orgId, mod, req.body?.data || {}, cur.data);
  const { rows: [row] } = await query('UPDATE custom_records SET data = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *', [cur.id, JSON.stringify(data), req.user.id]);
  await audit({ query }, req, 'update', `cm_${mod.slug}`, row.id, `${mod.singular} ${row.number} updated`);
  res.json(row);
});

rr.delete('/:slug/records/:id', can('custom_modules', 'delete'), async (req, res) => {
  const mod = await moduleBySlug(req.orgId, req.params.slug);
  const { rows: [row] } = await query('DELETE FROM custom_records WHERE module_id = $1 AND id = $2 RETURNING number', [mod.id, Number(req.params.id)]);
  if (!row) throw notFound(mod.singular);
  await audit({ query }, req, 'delete', `cm_${mod.slug}`, Number(req.params.id), `${mod.singular} ${row.number} deleted`);
  res.status(204).end();
});

// ------------------------------------------------------------------ web tabs
export const webTabsRouter = Router();
const wt = webTabsRouter;

function parseTab(b) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw badRequest('Give the tab a name');
  const url = String(b.url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw badRequest('The web address must start with https://');
  return { name, url: url.slice(0, 1000), open_mode: b.open_mode === 'new_tab' ? 'new_tab' : 'embed', position: Number(b.position) || 0 };
}

wt.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM web_tabs WHERE org_id = $1 ORDER BY position, id', [req.orgId]);
  res.json(rows);
});
wt.post('/', can('settings', 'edit'), async (req, res) => {
  const v = parseTab(req.body || {});
  const { rows: [row] } = await query('INSERT INTO web_tabs (org_id, name, url, open_mode, position) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.orgId, v.name, v.url, v.open_mode, v.position]);
  await audit({ query }, req, 'create', 'web_tab', row.id, `Web tab “${row.name}” added`);
  res.status(201).json(row);
});
wt.put('/:id', can('settings', 'edit'), async (req, res) => {
  const v = parseTab(req.body || {});
  const { rows: [row] } = await query('UPDATE web_tabs SET name = $3, url = $4, open_mode = $5, position = $6 WHERE org_id = $1 AND id = $2 RETURNING *', [req.orgId, Number(req.params.id), v.name, v.url, v.open_mode, v.position]);
  if (!row) throw notFound('Web tab');
  res.json(row);
});
wt.delete('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [row] } = await query('DELETE FROM web_tabs WHERE org_id = $1 AND id = $2 RETURNING name', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Web tab');
  await audit({ query }, req, 'delete', 'web_tab', Number(req.params.id), `Web tab “${row.name}” removed`);
  res.status(204).end();
});

// ------------------------------------------------------------------ web forms (staff side)
export const CUSTOMER_FORM_FIELDS = [
  { key: 'display_name', label: 'Name', type: 'text', required: true },
  { key: 'company_name', label: 'Company name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'mobile', label: 'Mobile', type: 'phone' },
  { key: 'gstin', label: 'GSTIN', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'message', label: 'Message', type: 'textarea' },
];

/** Fields a form can collect for its target. */
export async function targetFields(orgId, target) {
  if (target === 'customer') {
    const { rows } = await query('SELECT field_key, label, field_type, options, required FROM custom_fields WHERE org_id = $1 AND entity = $2 AND is_active ORDER BY position, id', [orgId, 'customer']);
    return [...CUSTOMER_FORM_FIELDS, ...rows.map((d) => ({ key: `cf_${d.field_key}`, label: d.label, type: d.field_type, options: d.options, required: d.required }))];
  }
  const mm = /^module:(\d+)$/.exec(target || '');
  if (!mm) throw badRequest('Choose what the form creates');
  const { rows: [mod] } = await query('SELECT * FROM custom_modules WHERE org_id = $1 AND id = $2', [orgId, Number(mm[1])]);
  if (!mod) throw badRequest('That module no longer exists');
  return (mod.fields || []).filter((f) => !LOOKUP_TYPES.includes(f.field_type)).map((f) => ({ key: f.field_key, label: f.label, type: f.field_type, options: f.options, required: f.required }));
}

export const webFormsRouter = Router();
const wf = webFormsRouter;

async function parseForm(req) {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw badRequest('Give the form a name');
  const available = await targetFields(req.orgId, b.target);
  const byKey = new Map<string, any>(available.map((f) => [f.key, f]));
  const fields = (Array.isArray(b.fields) ? b.fields : []).filter((f) => byKey.has(f.key)).map((f) => ({
    key: f.key, label: String(f.label || byKey.get(f.key).label).slice(0, 80), required: !!f.required || !!byKey.get(f.key).required,
  }));
  for (const f of available.filter((x) => x.required)) if (!fields.some((x) => x.key === f.key)) fields.unshift({ key: f.key, label: f.label, required: true });
  if (!fields.length) throw badRequest('Choose at least one field for the form');
  const notify = String(b.notify_email || '').trim();
  if (notify && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notify)) throw badRequest('The notification email is not valid');
  return {
    name, target: b.target, title: String(b.title || '').slice(0, 120) || name, intro: String(b.intro || '').slice(0, 1000) || null,
    fields: JSON.stringify(fields), success_message: String(b.success_message || '').slice(0, 500) || 'Thank you! We have received your details and will get back to you soon.',
    notify_email: notify || null, enabled: b.enabled !== false,
  };
}

wf.get('/', can('settings', 'view'), async (req, res) => {
  const { rows } = await query('SELECT * FROM web_forms WHERE org_id = $1 ORDER BY id', [req.orgId]);
  res.json(rows);
});
wf.get('/fields', can('settings', 'view'), async (req, res) => res.json(await targetFields(req.orgId, String(req.query.target || ''))));
wf.post('/', can('settings', 'edit'), async (req, res) => {
  const v = await parseForm(req);
  const keys = Object.keys(v);
  const { rows: [row] } = await query(
    `INSERT INTO web_forms (org_id, token, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
    [req.orgId, crypto.randomBytes(12).toString('hex'), ...keys.map((k) => v[k])],
  );
  await audit({ query }, req, 'create', 'web_form', row.id, `Web form “${row.name}” created`);
  res.status(201).json(row);
});
wf.put('/:id', can('settings', 'edit'), async (req, res) => {
  const v = await parseForm(req);
  const keys = Object.keys(v);
  const { rows: [row] } = await query(`UPDATE web_forms SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`, [req.orgId, Number(req.params.id), ...keys.map((k) => v[k])]);
  if (!row) throw notFound('Web form');
  res.json(row);
});
wf.delete('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [row] } = await query('DELETE FROM web_forms WHERE org_id = $1 AND id = $2 RETURNING name', [req.orgId, Number(req.params.id)]);
  if (!row) throw notFound('Web form');
  await audit({ query }, req, 'delete', 'web_form', Number(req.params.id), `Web form “${row.name}” deleted`);
  res.status(204).end();
});
