import { Router } from 'express';
import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { can, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, int, bool, id, email, obj, oneOf, listParams } from '../lib/validate.js';
import { MODULES, sanitizePermissions } from '../lib/permissions.js';
import { imageUpload, removePublic } from '../lib/upload.js';
import { formatNumber } from '../lib/numbering.js';
import { emailLink } from './email.js';
import { appUrl } from '../lib/mailer.js';

const r = Router();

// ------------------------------------------------------------ organization profile
r.get('/organization', async (req, res) => {
  const { rows } = await query('SELECT * FROM organizations WHERE id = $1', [req.orgId]);
  res.json(rows[0]);
});

r.put('/organization', can('settings', 'edit'), async (req, res) => {
  const b = req.body || {};
  const gstRegistered = bool(b.gst_registered);
  const gstin = str(b.gstin, { field: 'GSTIN', max: 15 });
  if (gstRegistered && (!gstin || !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin.toUpperCase()))) {
    throw badRequest('Enter a valid 15-character GSTIN');
  }
  const values = {
    name: str(b.name, { field: 'Organization name', required: true, max: 200 }),
    legal_name: str(b.legal_name, { field: 'Legal name', max: 200 }),
    industry: str(b.industry, { field: 'Industry', max: 100 }),
    email: email(b.email),
    phone: str(b.phone, { field: 'Phone', max: 30 }),
    website: str(b.website, { field: 'Website', max: 200 }),
    address: JSON.stringify(obj(b.address)),
    country: str(b.country, { field: 'Country', max: 60 }) || 'India',
    state: str(b.state, { field: 'State', max: 60 }),
    currency: (str(b.currency, { field: 'Currency', max: 3 }) || 'INR').toUpperCase(),
    timezone: str(b.timezone, { field: 'Time zone', max: 60 }) || 'Asia/Kolkata',
    fiscal_year_start: int(b.fiscal_year_start, { field: 'Fiscal year', min: 1, max: 12, def: 4 }),
    date_format: str(b.date_format, { field: 'Date format', max: 20 }) || 'dd/MM/yyyy',
    gst_registered: gstRegistered,
    gstin: gstin ? gstin.toUpperCase() : null,
    pan: str(b.pan, { field: 'PAN', max: 10 }),
    allow_negative_stock: bool(b.allow_negative_stock),
  };
  const keys = Object.keys(values);
  const { rows } = await query(
    `UPDATE organizations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [req.orgId, ...keys.map((k) => values[k])],
  );
  await audit({ query }, req, 'update', 'organization', req.orgId, 'Organization profile updated');
  res.json(rows[0]);
});

r.post('/organization/logo', can('settings', 'edit'), imageUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload');
  const { rows: [old] } = await query('SELECT logo_path FROM organizations WHERE id = $1', [req.orgId]);
  const logoPath = `/uploads/public/${req.file.filename}`;
  await query('UPDATE organizations SET logo_path = $2 WHERE id = $1', [req.orgId, logoPath]);
  removePublic(old?.logo_path);
  res.json({ logo_path: logoPath });
});

r.delete('/organization/logo', can('settings', 'edit'), async (req, res) => {
  const { rows: [old] } = await query('SELECT logo_path FROM organizations WHERE id = $1', [req.orgId]);
  await query('UPDATE organizations SET logo_path = NULL WHERE id = $1', [req.orgId]);
  removePublic(old?.logo_path);
  res.status(204).end();
});

// ------------------------------------------------------------ simple lookup tables
function simpleCrud(path: any, table: any, label: any, parse: any, { orderBy = 'name', inUse }: any = {}) {
  r.get(`/${path}`, async (req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} WHERE org_id = $1 ORDER BY ${orderBy}`, [req.orgId]);
    res.json(rows);
  });
  r.post(`/${path}`, can('settings', 'edit'), async (req, res) => {
    const v = await parse(req.body || {}, req);
    const keys = Object.keys(v);
    const { rows } = await query(
      `INSERT INTO ${table} (org_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
      [req.orgId, ...keys.map((k) => v[k])],
    );
    await audit({ query }, req, 'create', table, rows[0].id, `${label} ${rows[0].name} created`);
    res.status(201).json(rows[0]);
  });
  r.put(`/${path}/:id`, can('settings', 'edit'), async (req, res) => {
    const v = await parse(req.body || {}, req, Number(req.params.id));
    const keys = Object.keys(v);
    const { rows } = await query(
      `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`,
      [req.orgId, Number(req.params.id), ...keys.map((k) => v[k])],
    );
    if (!rows[0]) throw notFound(label);
    await audit({ query }, req, 'update', table, rows[0].id, `${label} ${rows[0].name} updated`);
    res.json(rows[0]);
  });
  r.delete(`/${path}/:id`, can('settings', 'edit'), async (req, res) => {
    const recId = Number(req.params.id);
    if (inUse && (await inUse(req, recId))) throw conflict(`This ${label.toLowerCase()} is in use and cannot be deleted. Mark it inactive instead.`);
    const { rows } = await query(`DELETE FROM ${table} WHERE org_id = $1 AND id = $2 RETURNING name`, [req.orgId, recId]);
    if (!rows[0]) throw notFound(label);
    await audit({ query }, req, 'delete', table, recId, `${label} ${rows[0].name} deleted`);
    res.status(204).end();
  });
}

simpleCrud('taxes', 'taxes', 'Tax', (b) => ({
  name: str(b.name, { field: 'Tax name', required: true, max: 100 }),
  rate: num(b.rate, { field: 'Rate', required: true, min: 0, max: 100 }),
  kind: oneOf(b.kind, ['tax', 'tds', 'tcs'], { field: 'Type', def: 'tax' }),
  is_active: bool(b.is_active, true),
}), { orderBy: 'kind, rate' });

simpleCrud('units', 'units', 'Unit', (b) => ({ name: str(b.name, { field: 'Unit', required: true, max: 30 }) }), {
  inUse: async (req, unitId) => {
    const { rows } = await query(
      'SELECT 1 FROM items i JOIN units u ON u.name = i.unit AND u.org_id = i.org_id WHERE u.id = $1 AND i.org_id = $2 LIMIT 1',
      [unitId, req.orgId],
    );
    return rows.length > 0;
  },
});

simpleCrud('carriers', 'shipping_carriers', 'Carrier', (b) => ({
  name: str(b.name, { field: 'Carrier name', required: true, max: 100 }),
  tracking_url: str(b.tracking_url, { field: 'Tracking URL', max: 500 }),
  is_active: bool(b.is_active, true),
}));

// ------------------------------------------------------------ warehouses
const STOCK_TABLES = ['stock_movements', 'sales_orders', 'invoices', 'purchase_orders', 'bills', 'credit_notes', 'vendor_credits', 'inventory_adjustments', 'purchase_receives', 'sales_returns', 'assemblies'];

r.get('/warehouses', async (req, res) => {
  const { rows } = await query(
    `SELECT w.*, COALESCE(s.items, 0)::int AS item_count, COALESCE(s.value, 0) AS stock_value
       FROM warehouses w
       LEFT JOIN (SELECT warehouse_id, COUNT(DISTINCT item_id) FILTER (WHERE qty_remaining > 0) AS items,
                         SUM(qty_remaining * unit_cost) AS value
                    FROM stock_lots WHERE org_id = $1 GROUP BY warehouse_id) s ON s.warehouse_id = w.id
      WHERE w.org_id = $1 ORDER BY w.is_primary DESC, w.name`,
    [req.orgId],
  );
  res.json(rows);
});

function parseWarehouse(b) {
  return {
    name: str(b.name, { field: 'Warehouse name', required: true, max: 120 }),
    code: str(b.code, { field: 'Code', max: 20 }),
    address: JSON.stringify(obj(b.address)),
    contact_person: str(b.contact_person, { field: 'Contact person', max: 120 }),
    phone: str(b.phone, { field: 'Phone', max: 30 }),
    email: email(b.email),
    status: oneOf(b.status, ['active', 'inactive'], { field: 'Status', def: 'active' }),
  };
}

r.post('/warehouses', can('settings', 'edit'), async (req, res) => {
  const v = parseWarehouse(req.body || {});
  const keys = Object.keys(v);
  const { rows } = await query(
    `INSERT INTO warehouses (org_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [req.orgId, ...keys.map((k) => v[k])],
  );
  await audit({ query }, req, 'create', 'warehouse', rows[0].id, `Warehouse ${rows[0].name} created`);
  res.status(201).json(rows[0]);
});

r.put('/warehouses/:id', can('settings', 'edit'), async (req, res) => {
  const v = parseWarehouse(req.body || {});
  const whId = Number(req.params.id);
  const { rows: [cur] } = await query('SELECT * FROM warehouses WHERE org_id = $1 AND id = $2', [req.orgId, whId]);
  if (!cur) throw notFound('Warehouse');
  if (cur.is_primary && v.status === 'inactive') throw badRequest('The primary warehouse cannot be made inactive');
  const keys = Object.keys(v);
  const { rows } = await query(
    `UPDATE warehouses SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`,
    [req.orgId, whId, ...keys.map((k) => v[k])],
  );
  await audit({ query }, req, 'update', 'warehouse', whId, `Warehouse ${rows[0].name} updated`);
  res.json(rows[0]);
});

r.post('/warehouses/:id/primary', can('settings', 'edit'), async (req, res) => {
  const whId = Number(req.params.id);
  await tx(async (client) => {
    const { rows } = await client.query("SELECT name, status FROM warehouses WHERE org_id = $1 AND id = $2", [req.orgId, whId]);
    if (!rows[0]) throw notFound('Warehouse');
    if (rows[0].status !== 'active') throw badRequest('Activate the warehouse first');
    await client.query('UPDATE warehouses SET is_primary = (id = $2) WHERE org_id = $1', [req.orgId, whId]);
    await audit(client, req, 'update', 'warehouse', whId, `${rows[0].name} set as primary warehouse`);
  });
  res.json({ ok: true });
});

r.delete('/warehouses/:id', can('settings', 'edit'), async (req, res) => {
  const whId = Number(req.params.id);
  const { rows: [wh] } = await query('SELECT * FROM warehouses WHERE org_id = $1 AND id = $2', [req.orgId, whId]);
  if (!wh) throw notFound('Warehouse');
  if (wh.is_primary) throw conflict('The primary warehouse cannot be deleted');
  for (const t of STOCK_TABLES) {
    const { rows } = await query(`SELECT 1 FROM ${t} WHERE warehouse_id = $1 LIMIT 1`, [whId]);
    if (rows.length) throw conflict('This warehouse has transactions and cannot be deleted. Mark it inactive instead.');
  }
  await query('DELETE FROM stock_levels WHERE warehouse_id = $1', [whId]);
  await query('DELETE FROM warehouses WHERE id = $1', [whId]);
  await audit({ query }, req, 'delete', 'warehouse', whId, `Warehouse ${wh.name} deleted`);
  res.status(204).end();
});

// ------------------------------------------------------------ numbering
r.get('/numbering', async (req, res) => {
  const { rows } = await query('SELECT * FROM number_series WHERE org_id = $1 ORDER BY doc_type', [req.orgId]);
  res.json(rows.map((s) => ({ ...s, preview: formatNumber(s.prefix, s.next_number, s.padding) })));
});

r.put('/numbering/:docType', can('settings', 'edit'), async (req, res) => {
  const b = req.body || {};
  const prefix = str(b.prefix, { field: 'Prefix', max: 20 }) ?? '';
  const next = int(b.next_number, { field: 'Next number', required: true, min: 1 });
  const padding = int(b.padding, { field: 'Digits', min: 1, max: 10, def: 5 });
  const { rows } = await query(
    'UPDATE number_series SET prefix = $3, next_number = $4, padding = $5 WHERE org_id = $1 AND doc_type = $2 RETURNING *',
    [req.orgId, req.params.docType, prefix, next, padding],
  );
  if (!rows[0]) throw notFound('Number series');
  await audit({ query }, req, 'update', 'number_series', null, `Numbering for ${req.params.docType} changed to ${formatNumber(prefix, next, padding)}`);
  res.json({ ...rows[0], preview: formatNumber(prefix, next, padding) });
});

// ------------------------------------------------------------ roles
r.get('/permission-catalog', (_req, res) => res.json(MODULES));

r.get('/roles', can('users', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r WHERE r.org_id = $1 ORDER BY r.is_admin DESC, r.name`,
    [req.orgId],
  );
  res.json(rows);
});

r.post('/roles', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const { rows } = await query(
    'INSERT INTO roles (org_id, name, description, permissions) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.orgId, str(b.name, { field: 'Role name', required: true, max: 60 }), str(b.description, { field: 'Description', max: 300 }),
      JSON.stringify(sanitizePermissions(b.permissions))],
  );
  await audit({ query }, req, 'create', 'role', rows[0].id, `Role ${rows[0].name} created`);
  res.status(201).json(rows[0]);
});

r.put('/roles/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const roleId = Number(req.params.id);
  const { rows: [role] } = await query('SELECT * FROM roles WHERE org_id = $1 AND id = $2', [req.orgId, roleId]);
  if (!role) throw notFound('Role');
  if (role.is_admin) throw badRequest('The Admin role always has full access and cannot be changed');
  const { rows } = await query(
    'UPDATE roles SET name = $3, description = $4, permissions = $5 WHERE org_id = $1 AND id = $2 RETURNING *',
    [req.orgId, roleId, str(b.name, { field: 'Role name', required: true, max: 60 }), str(b.description, { field: 'Description', max: 300 }),
      JSON.stringify(sanitizePermissions(b.permissions))],
  );
  await audit({ query }, req, 'update', 'role', roleId, `Role ${rows[0].name} permissions updated`);
  res.json(rows[0]);
});

r.delete('/roles/:id', requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);
  const { rows: [role] } = await query('SELECT * FROM roles WHERE org_id = $1 AND id = $2', [req.orgId, roleId]);
  if (!role) throw notFound('Role');
  if (role.is_admin) throw badRequest('The Admin role cannot be deleted');
  const { rows } = await query('SELECT 1 FROM users WHERE role_id = $1 LIMIT 1', [roleId]);
  if (rows.length) throw conflict('Users are assigned to this role. Move them to another role first.');
  await query('DELETE FROM roles WHERE id = $1', [roleId]);
  await audit({ query }, req, 'delete', 'role', roleId, `Role ${role.name} deleted`);
  res.status(204).end();
});

// ------------------------------------------------------------ users
r.get('/users', can('users', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role_name, u.last_login_at, u.created_at,
            CASE WHEN u.status = 'invited' THEN u.invite_token END AS invite_token
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.org_id = $1 ORDER BY u.name`,
    [req.orgId],
  );
  res.json(rows);
});

async function checkRole(req, roleId) {
  const { rows } = await query('SELECT id FROM roles WHERE org_id = $1 AND id = $2', [req.orgId, roleId]);
  if (!rows[0]) throw badRequest('Select a valid role');
}

r.post('/users', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const roleId = id(b.role_id, { field: 'Role', required: true });
  await checkRole(req, roleId);
  const mail = email(b.email, { required: true });
  const exists = await query('SELECT 1 FROM users WHERE lower(email) = $1', [mail]);
  if (exists.rows.length) throw conflict('A user with this email already exists');
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await query(
    `INSERT INTO users (org_id, role_id, name, email, status, invite_token) VALUES ($1, $2, $3, $4, 'invited', $5)
     RETURNING id, name, email, status, role_id, invite_token`,
    [req.orgId, roleId, str(b.name, { field: 'Name', required: true, max: 120 }), mail, token],
  );
  await audit({ query }, req, 'create', 'user', rows[0].id, `User ${mail} invited`);
  const emailed = await emailLink(req, {
    to: mail, subject: 'You have been invited', title: `Join ${req.user.name}'s team`,
    intro: `You have been invited to the inventory app. Open the link below to choose your password.`,
    label: 'Accept invitation', url: `${appUrl()}/invite/${token}`,
  });
  res.status(201).json({ ...rows[0], emailed });
});

r.put('/users/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const userId = Number(req.params.id);
  const roleId = id(b.role_id, { field: 'Role', required: true });
  await checkRole(req, roleId);
  const status = oneOf(b.status, ['active', 'inactive', 'invited'], { field: 'Status', def: 'active' });
  const { rows: [cur] } = await query('SELECT * FROM users WHERE org_id = $1 AND id = $2', [req.orgId, userId]);
  if (!cur) throw notFound('User');
  if (userId === req.user.id && (status !== 'active' || roleId !== cur.role_id)) {
    throw badRequest('You cannot change your own role or deactivate yourself');
  }
  if (cur.status === 'invited' && status === 'active') throw badRequest('This user has not accepted the invitation yet');
  if (cur.status !== 'invited' && status === 'invited') throw badRequest('Invalid status');
  const { rows } = await query(
    'UPDATE users SET name = $3, role_id = $4, status = $5 WHERE org_id = $1 AND id = $2 RETURNING id, name, email, status, role_id',
    [req.orgId, userId, str(b.name, { field: 'Name', required: true, max: 120 }), roleId, status],
  );
  await audit({ query }, req, 'update', 'user', userId, `User ${cur.email} updated`);
  res.json(rows[0]);
});

r.post('/users/:id/reinvite', requireAdmin, async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await query(
    "UPDATE users SET invite_token = $3 WHERE org_id = $1 AND id = $2 AND status = 'invited' RETURNING invite_token",
    [req.orgId, Number(req.params.id), token],
  );
  if (!rows[0]) throw badRequest('Only pending invitations can be re-sent');
  res.json(rows[0]);
});

// Password reset for an existing user: creates a one-time link (same page as invitations).
r.post('/users/:id/reset-link', requireAdmin, async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await query(
    "UPDATE users SET invite_token = $3 WHERE org_id = $1 AND id = $2 AND status = 'active' RETURNING email",
    [req.orgId, Number(req.params.id), token],
  );
  if (!rows[0]) throw badRequest('Reset links can only be created for active users');
  await audit({ query }, req, 'update', 'user', Number(req.params.id), `Password reset link created for ${rows[0].email}`);
  const emailed = await emailLink(req, {
    to: rows[0].email, subject: 'Reset your password', title: 'Choose a new password',
    intro: 'Your administrator created a password reset link for you. It works once.', label: 'Choose a new password', url: `${appUrl()}/invite/${token}`,
  });
  res.json({ invite_token: token, emailed });
});

r.delete('/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) throw badRequest('You cannot delete yourself');
  const { rows } = await query('DELETE FROM users WHERE org_id = $1 AND id = $2 RETURNING email', [req.orgId, userId]);
  if (!rows[0]) throw notFound('User');
  await audit({ query }, req, 'delete', 'user', userId, `User ${rows[0].email} removed`);
  res.status(204).end();
});

// ------------------------------------------------------------ audit log
r.get('/audit-logs', can('reports', 'view'), async (req, res) => {
  const p = listParams(req.query, { date: 'a.created_at' }, 'date');
  const params = [req.orgId];
  const where = ['a.org_id = $1'];
  if (req.query.entity_type) { params.push(req.query.entity_type); where.push(`a.entity_type = $${params.length}`); }
  if (req.query.entity_id) { params.push(Number(req.query.entity_id)); where.push(`a.entity_id = $${params.length}`); }
  if (req.query.user_id) { params.push(Number(req.query.user_id)); where.push(`a.user_id = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`a.summary ILIKE $${params.length}`); }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
            WHERE ${w} ORDER BY ${p.orderBy}, a.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

export default r;
