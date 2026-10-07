import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, tx } from '../db.js';
import { authenticatePlatform, signPlatformToken } from '../middleware/auth.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { str, email, oneOf, int, id, listParams } from '../lib/validate.js';
import { setupOrganization } from '../lib/orgSetup.js';
import { platformAudit } from '../lib/platformAudit.js';
import { usageCounts } from '../lib/plans.js';
import { appUrl } from '../lib/mailer.js';
import { config } from '../config.js';

const r = Router();

function password(v) {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 8) throw badRequest('Password must be at least 8 characters');
  if (p.length > 200) throw badRequest('Password is too long');
  return p;
}

// ------------------------------------------------------------------ auth (public)
r.post('/auth/login', async (req, res) => {
  const mail = email(req.body?.email, { required: true });
  const pass = typeof req.body?.password === 'string' ? req.body.password : '';
  const { rows } = await query(
    'SELECT id, name, email, password_hash, status FROM platform_admins WHERE lower(email) = $1',
    [mail],
  );
  const admin = rows[0];
  if (!admin || !(await bcrypt.compare(pass, admin.password_hash))) {
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (admin.status !== 'active') throw new HttpError(403, 'Your platform account is inactive');
  await query('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [admin.id]);
  await platformAudit(admin.id, 'login', 'platform_admin', admin.id, 'Platform admin signed in');
  res.json({
    token: signPlatformToken(admin),
    admin: { id: admin.id, name: admin.name, email: admin.email },
  });
});

r.use(authenticatePlatform);

r.get('/auth/me', async (req, res) => {
  res.json({ id: req.platformAdmin.id, name: req.platformAdmin.name, email: req.platformAdmin.email });
});

// ------------------------------------------------------------------ plans
r.get('/plans', async (_req, res) => {
  const { rows } = await query('SELECT * FROM plans ORDER BY sort_order, id');
  res.json({ data: rows });
});

r.post('/plans', async (req, res) => {
  const b = req.body || {};
  const code = str(b.code, { field: 'Code', required: true, max: 40 }).toLowerCase().replace(/\s+/g, '_');
  const name = str(b.name, { field: 'Name', required: true, max: 120 });
  const { rows: [row] } = await query(
    `INSERT INTO plans (code, name, description, max_users, max_warehouses, max_items, modules, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      code, name,
      str(b.description, { field: 'Description', max: 500 }) || null,
      b.max_users == null || b.max_users === '' ? null : int(b.max_users, { field: 'Max users', min: 1 }),
      b.max_warehouses == null || b.max_warehouses === '' ? null : int(b.max_warehouses, { field: 'Max warehouses', min: 1 }),
      b.max_items == null || b.max_items === '' ? null : int(b.max_items, { field: 'Max items', min: 1 }),
      JSON.stringify(b.modules || {}),
      int(b.sort_order, { field: 'Sort', def: 0 }),
      b.is_active !== false,
    ],
  );
  await platformAudit(req.platformAdmin.id, 'create', 'plan', row.id, `Plan ${row.name} created`);
  res.status(201).json(row);
});

r.put('/plans/:id', async (req, res) => {
  const planId = Number(req.params.id);
  const { rows: [cur] } = await query('SELECT * FROM plans WHERE id = $1', [planId]);
  if (!cur) throw notFound('Plan');
  const b = { ...cur, ...req.body };
  const { rows: [row] } = await query(
    `UPDATE plans SET name=$2, description=$3, max_users=$4, max_warehouses=$5, max_items=$6,
            modules=$7, sort_order=$8, is_active=$9 WHERE id=$1 RETURNING *`,
    [
      planId,
      str(b.name, { field: 'Name', required: true, max: 120 }),
      str(b.description, { field: 'Description', max: 500 }) || null,
      b.max_users == null || b.max_users === '' ? null : int(b.max_users, { field: 'Max users', min: 1 }),
      b.max_warehouses == null || b.max_warehouses === '' ? null : int(b.max_warehouses, { field: 'Max warehouses', min: 1 }),
      b.max_items == null || b.max_items === '' ? null : int(b.max_items, { field: 'Max items', min: 1 }),
      JSON.stringify(b.modules || cur.modules || {}),
      int(b.sort_order, { field: 'Sort', def: cur.sort_order }),
      b.is_active !== false,
    ],
  );
  await platformAudit(req.platformAdmin.id, 'update', 'plan', planId, `Plan ${row.name} updated`);
  res.json(row);
});

// ------------------------------------------------------------------ organizations
async function orgDetail(orgId) {
  const { rows } = await query(
    `SELECT o.*, p.code AS plan_code, p.name AS plan_name, p.max_users, p.max_warehouses, p.max_items,
            (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) AS user_count,
            (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.status = 'active') AS active_users,
            (SELECT MAX(u.last_login_at) FROM users u WHERE u.org_id = o.id) AS last_login_at
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
      WHERE o.id = $1`,
    [orgId],
  );
  if (!rows[0]) return null;
  const usage = await usageCounts(orgId);
  const { rows: users } = await query(
    `SELECT u.id, u.name, u.email, u.status, r.name AS role_name, r.is_admin, u.last_login_at, u.created_at,
            CASE WHEN u.status = 'invited' THEN u.invite_token END AS invite_token
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.org_id = $1 ORDER BY r.is_admin DESC, u.name`,
    [orgId],
  );
  return { ...rows[0], usage, users };
}

r.get('/orgs', async (req, res) => {
  const p = listParams(req.query, { name: 'o.name', created: 'o.created_at', status: 'o.status' }, 'created');
  const params = [];
  const where = ['TRUE'];
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`o.status = $${params.length}`);
  }
  if (p.search) {
    params.push(`%${p.search}%`);
    where.push(`(o.name ILIKE $${params.length} OR o.email ILIKE $${params.length})`);
  }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(
      `SELECT o.id, o.name, o.email, o.status, o.plan_id, o.trial_ends_at, o.created_at, o.platform_notes,
              p.code AS plan_code, p.name AS plan_name,
              (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) AS user_count,
              (SELECT MAX(u.last_login_at) FROM users u WHERE u.org_id = o.id) AS last_login_at
         FROM organizations o LEFT JOIN plans p ON p.id = o.plan_id
        WHERE ${w}
        ORDER BY ${p.orderBy}, o.id DESC
        LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM organizations o WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

r.get('/orgs/:id', async (req, res) => {
  const org = await orgDetail(Number(req.params.id));
  if (!org) throw notFound('Organization');
  res.json(org);
});

r.post('/orgs', async (req, res) => {
  const b = req.body || {};
  const orgName = str(b.organization_name || b.name, { field: 'Organization name', required: true, max: 200 });
  const adminName = str(b.admin_name, { field: 'Admin name', required: true, max: 120 });
  const adminEmail = email(b.admin_email, { required: true });
  const status = oneOf(b.status, ['trial', 'active', 'suspended', 'cancelled'], { field: 'Status', def: 'active' });
  let planId = b.plan_id != null && b.plan_id !== '' ? id(b.plan_id, { field: 'Plan' }) : null;
  if (!planId) {
    const { rows: [def] } = await query("SELECT id FROM plans WHERE code = 'starter' AND is_active LIMIT 1");
    planId = def?.id || null;
  } else {
    const { rows: [pl] } = await query('SELECT id FROM plans WHERE id = $1 AND is_active', [planId]);
    if (!pl) throw badRequest('Select a valid plan');
  }
  const exists = await query('SELECT 1 FROM users WHERE lower(email) = $1', [adminEmail]);
  if (exists.rows.length) throw conflict('A user with this email already exists');

  const trialEnds = status === 'trial'
    ? (b.trial_ends_at ? new Date(b.trial_ends_at) : new Date(Date.now() + config.trialDays * 86400000))
    : null;

  const result = await tx(async (client) => {
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, legal_name, email, country, state, currency, timezone, status, plan_id, trial_ends_at, platform_notes)
       VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        orgName, adminEmail,
        str(b.country, { field: 'Country' }) || 'India',
        str(b.state, { field: 'State' }) || '',
        str(b.currency, { field: 'Currency', max: 3 }) || 'INR',
        str(b.timezone, { field: 'Time zone' }) || 'Asia/Kolkata',
        status, planId, trialEnds,
        str(b.platform_notes, { field: 'Notes', max: 2000 }) || null,
      ],
    );
    const adminRoleId = await setupOrganization(client, org.id, {
      address: { state: b.state || '', country: b.country || 'India' },
    });
    const token = crypto.randomBytes(24).toString('hex');
    const { rows: [user] } = await client.query(
      `INSERT INTO users (org_id, role_id, name, email, status, invite_token)
       VALUES ($1, $2, $3, $4, 'invited', $5) RETURNING id, name, email, status, invite_token`,
      [org.id, adminRoleId, adminName, adminEmail, token],
    );
    return { org, user, invite_token: token };
  });

  await platformAudit(
    req.platformAdmin.id, 'create', 'organization', result.org.id,
    `Organization "${orgName}" created; admin invited ${adminEmail}`,
  );

  res.status(201).json({
    ...result.org,
    admin: result.user,
    invite_url: `${appUrl()}/invite/${result.invite_token}`,
  });
});

r.put('/orgs/:id', async (req, res) => {
  const orgId = Number(req.params.id);
  const { rows: [cur] } = await query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  if (!cur) throw notFound('Organization');
  const b = req.body || {};
  const status = b.status != null
    ? oneOf(b.status, ['trial', 'active', 'suspended', 'cancelled'], { field: 'Status' })
    : cur.status;
  let planId = cur.plan_id;
  if (b.plan_id !== undefined) {
    if (b.plan_id === null || b.plan_id === '') planId = null;
    else {
      planId = id(b.plan_id, { field: 'Plan' });
      const { rows: [pl] } = await query('SELECT id FROM plans WHERE id = $1', [planId]);
      if (!pl) throw badRequest('Select a valid plan');
    }
  }
  let trialEnds = cur.trial_ends_at;
  if (b.trial_ends_at !== undefined) {
    trialEnds = b.trial_ends_at ? new Date(b.trial_ends_at) : null;
  } else if (status === 'trial' && !trialEnds) {
    trialEnds = new Date(Date.now() + config.trialDays * 86400000);
  } else if (status === 'active') {
    trialEnds = cur.trial_ends_at;
  }
  const notes = b.platform_notes !== undefined
    ? (str(b.platform_notes, { field: 'Notes', max: 2000 }) || null)
    : cur.platform_notes;
  const name = b.name != null ? str(b.name, { field: 'Name', required: true, max: 200 }) : cur.name;

  const { rows: [row] } = await query(
    `UPDATE organizations SET name=$2, status=$3, plan_id=$4, trial_ends_at=$5, platform_notes=$6
      WHERE id=$1 RETURNING *`,
    [orgId, name, status, planId, trialEnds, notes],
  );
  await platformAudit(
    req.platformAdmin.id, 'update', 'organization', orgId,
    `Organization "${row.name}" updated (status=${status})`,
    { status, plan_id: planId },
  );
  res.json(await orgDetail(orgId));
});

r.post('/orgs/:id/invite-admin', async (req, res) => {
  const orgId = Number(req.params.id);
  const { rows: [org] } = await query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  if (!org) throw notFound('Organization');

  const b = req.body || {};
  const mail = email(b.email, { required: !!(b.email || b.name) });
  let user;

  if (mail) {
    const exists = await query('SELECT id, org_id FROM users WHERE lower(email) = $1', [mail]);
    if (exists.rows[0] && Number(exists.rows[0].org_id) !== orgId) {
      throw conflict('A user with this email already exists in another organization');
    }
    if (exists.rows[0]) {
      const token = crypto.randomBytes(24).toString('hex');
      const { rows } = await query(
        `UPDATE users SET invite_token = $2, status = CASE WHEN status = 'inactive' THEN 'invited' ELSE status END
          WHERE id = $1 RETURNING id, name, email, status, invite_token`,
        [exists.rows[0].id, token],
      );
      user = rows[0];
    } else {
      const { rows: [adminRole] } = await query(
        'SELECT id FROM roles WHERE org_id = $1 AND is_admin LIMIT 1',
        [orgId],
      );
      if (!adminRole) throw badRequest('Organization has no admin role');
      const token = crypto.randomBytes(24).toString('hex');
      const { rows } = await query(
        `INSERT INTO users (org_id, role_id, name, email, status, invite_token)
         VALUES ($1, $2, $3, $4, 'invited', $5)
         RETURNING id, name, email, status, invite_token`,
        [orgId, adminRole.id, str(b.name, { field: 'Name', required: true, max: 120 }), mail, token],
      );
      user = rows[0];
    }
  } else {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.status FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.org_id = $1 AND r.is_admin
        ORDER BY u.created_at LIMIT 1`,
      [orgId],
    );
    if (!rows[0]) throw badRequest('No admin user found — provide email and name to invite one');
    const token = crypto.randomBytes(24).toString('hex');
    const { rows: updated } = await query(
      `UPDATE users SET invite_token = $2,
              status = CASE WHEN status = 'inactive' THEN 'invited' ELSE status END
        WHERE id = $1 RETURNING id, name, email, status, invite_token`,
      [rows[0].id, token],
    );
    user = updated[0];
  }

  await platformAudit(
    req.platformAdmin.id, 'invite', 'user', user.id,
    `Invite / reset link for ${user.email} on org ${org.name}`,
  );
  res.json({ ...user, invite_url: `${appUrl()}/invite/${user.invite_token}` });
});

// ------------------------------------------------------------------ platform admins
r.get('/admins', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, status, last_login_at, created_at FROM platform_admins ORDER BY name`,
  );
  res.json({ data: rows });
});

r.post('/admins', async (req, res) => {
  const b = req.body || {};
  const mail = email(b.email, { required: true });
  const name = str(b.name, { field: 'Name', required: true, max: 120 });
  const pass = password(b.password);
  const exists = await query('SELECT 1 FROM platform_admins WHERE lower(email) = $1', [mail]);
  if (exists.rows.length) throw conflict('A platform admin with this email already exists');
  const hash = await bcrypt.hash(pass, 12);
  const { rows: [row] } = await query(
    `INSERT INTO platform_admins (name, email, password_hash, status)
     VALUES ($1, $2, $3, 'active') RETURNING id, name, email, status, created_at`,
    [name, mail, hash],
  );
  await platformAudit(req.platformAdmin.id, 'create', 'platform_admin', row.id, `Platform admin ${mail} created`);
  res.status(201).json(row);
});

r.put('/admins/:id', async (req, res) => {
  const adminId = Number(req.params.id);
  const { rows: [cur] } = await query('SELECT * FROM platform_admins WHERE id = $1', [adminId]);
  if (!cur) throw notFound('Platform admin');
  const b = req.body || {};
  const status = oneOf(b.status, ['active', 'inactive'], { field: 'Status', def: cur.status });
  if (adminId === req.platformAdmin.id && status !== 'active') {
    throw badRequest('You cannot deactivate yourself');
  }
  const name = str(b.name ?? cur.name, { field: 'Name', required: true, max: 120 });
  let hash = cur.password_hash;
  if (b.password) hash = await bcrypt.hash(password(b.password), 12);
  const { rows: [row] } = await query(
    `UPDATE platform_admins SET name=$2, status=$3, password_hash=$4
      WHERE id=$1 RETURNING id, name, email, status, last_login_at, created_at`,
    [adminId, name, status, hash],
  );
  await platformAudit(req.platformAdmin.id, 'update', 'platform_admin', adminId, `Platform admin ${row.email} updated`);
  res.json(row);
});

// ------------------------------------------------------------------ audit
r.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await query(
    `SELECT a.*, pa.name AS admin_name, pa.email AS admin_email
       FROM platform_audit_log a
       LEFT JOIN platform_admins pa ON pa.id = a.admin_id
      ORDER BY a.created_at DESC LIMIT $1`,
    [limit],
  );
  res.json({ data: rows });
});

export default r;
