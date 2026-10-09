import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { tx, query } from '../db.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { str, email } from '../lib/validate.js';
import { setupOrganization } from '../lib/orgSetup.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { orgAccessMessage } from '../lib/plans.js';

const r = Router();

function password(v) {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 8) throw badRequest('Password must be at least 8 characters');
  if (p.length > 200) throw badRequest('Password is too long');
  return p;
}

// Simple in-memory throttle for failed logins: 10 failures per email per 15 minutes.
const failures = new Map();
function checkThrottle(key) {
  const f = failures.get(key);
  if (f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
  }
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}

async function sessionPayload(userId, extra: Record<string, unknown> = {}) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.org_id, r.id AS role_id, r.name AS role_name, r.is_admin, r.permissions,
            o.name AS org_name, o.currency, o.logo_path, o.gst_registered, o.date_format, o.state AS org_state, o.portal_slug,
            o.status AS org_status, o.trial_ends_at, o.plan_id, o.subscription_status, o.paid_until,
            p.code AS plan_code, p.name AS plan_name, p.max_users, p.max_warehouses, p.max_items, p.modules AS plan_modules,
            p.price_monthly AS plan_price_monthly,
            (o.smtp IS NOT NULL) AS email_configured,
            COALESCE((SELECT array_agg(provider) FROM integrations WHERE org_id = o.id AND enabled), '{}') AS integrations
       FROM users u JOIN roles r ON r.id = u.role_id JOIN organizations o ON o.id = u.org_id
       LEFT JOIN plans p ON p.id = o.plan_id
      WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) return null;
  return { ...rows[0], ...extra };
}

r.get('/signup-status', (_req, res) => {
  res.json({
    mode: config.signupMode,
    open: config.signupMode === 'open',
  });
});

r.post('/signup', async (req, res) => {
  if (config.signupMode !== 'open') {
    throw new HttpError(403, 'Public signup is disabled. Contact us to get an account.');
  }
  const b = req.body || {};
  const orgName = str(b.organization_name, { field: 'Organization name', required: true, max: 200 });
  const name = str(b.name, { field: 'Your name', required: true, max: 120 });
  const mail = email(b.email, { required: true });
  const pass = password(b.password);
  const hash = await bcrypt.hash(pass, 12);
  const trialEnds = new Date(Date.now() + config.trialDays * 86400000);
  const userId = await tx(async (client) => {
    const exists = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [mail]);
    if (exists.rows.length) throw badRequest('An account with this email already exists. Sign in instead.');
    const { rows: [starter] } = await client.query("SELECT id FROM plans WHERE code = 'starter' AND is_active LIMIT 1");
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (name, legal_name, email, country, state, currency, timezone, status, plan_id, trial_ends_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6, 'trial', $7, $8) RETURNING id`,
      [orgName, mail, str(b.country, { field: 'Country' }) || 'India', str(b.state, { field: 'State' }),
        str(b.currency, { field: 'Currency', max: 3 }) || 'INR', str(b.timezone, { field: 'Time zone' }) || 'Asia/Kolkata',
        starter?.id || null, trialEnds],
    );
    const adminRoleId = await setupOrganization(client, org.id, { address: { state: b.state || '', country: b.country || 'India' } });
    const { rows: [user] } = await client.query(
      'INSERT INTO users (org_id, role_id, name, email, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [org.id, adminRoleId, name, mail, hash],
    );
    await audit(client, { orgId: org.id, user: { id: user.id } }, 'create', 'organization', org.id, `Organization ${orgName} created`);
    return user.id;
  });
  const session = await sessionPayload(userId);
  res.status(201).json({ token: signToken(session), user: session });
});

r.post('/login', async (req, res) => {
  const mail = email(req.body?.email, { required: true });
  const pass = typeof req.body?.password === 'string' ? req.body.password : '';
  checkThrottle(mail);
  const { rows } = await query(
    `SELECT u.id, u.org_id, u.password_hash, u.status, o.status AS org_status, o.trial_ends_at
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE lower(u.email) = $1`,
    [mail],
  );
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(pass, user.password_hash))) {
    recordFailure(mail);
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (user.status !== 'active') throw new HttpError(403, 'Your account is inactive. Contact your administrator.');
  const blocked = orgAccessMessage({ status: user.org_status, trial_ends_at: user.trial_ends_at });
  if (blocked) throw new HttpError(403, blocked);
  failures.delete(mail);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const session = await sessionPayload(user.id);
  res.json({ token: signToken(session), user: session });
});

// Invitation acceptance: invited users set their password with the token from the invite link.
r.get('/invite/:token', async (req, res) => {
  const { rows } = await query(
    `SELECT u.name, u.email, o.name AS org_name, (u.status = 'active') AS is_reset FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.invite_token = $1 AND u.status IN ('invited', 'active')`,
    [req.params.token],
  );
  if (!rows[0]) throw new HttpError(404, 'This invitation link is invalid or has already been used');
  res.json(rows[0]);
});

r.post('/invite/:token', async (req, res) => {
  const pass = password(req.body?.password);
  const name = str(req.body?.name, { field: 'Name', max: 120 });
  const hash = await bcrypt.hash(pass, 12);
  const { rows: [pending] } = await query(
    `SELECT u.id, o.status AS org_status, o.trial_ends_at
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.invite_token = $1 AND u.status IN ('invited', 'active')`,
    [req.params.token],
  );
  if (!pending) throw new HttpError(404, 'This invitation link is invalid or has already been used');
  const blocked = orgAccessMessage({ status: pending.org_status, trial_ends_at: pending.trial_ends_at });
  if (blocked) throw new HttpError(403, blocked);
  const { rows } = await query(
    `UPDATE users SET password_hash = $2, status = 'active', invite_token = NULL, name = COALESCE($3, name), last_login_at = now()
      WHERE invite_token = $1 AND status IN ('invited', 'active') RETURNING id`,
    [req.params.token, hash, name],
  );
  if (!rows[0]) throw new HttpError(404, 'This invitation link is invalid or has already been used');
  const session = await sessionPayload(rows[0].id);
  res.json({ token: signToken(session), user: session });
});

r.get('/me', authenticate, async (req, res) => {
  res.json(await sessionPayload(req.user.id, {
    impersonating: req.impersonating || null,
  }));
});

r.get('/public-info', (_req, res) => {
  res.json({
    app_name: 'Rokesh Inventory',
    support_email: config.supportEmail,
    signup_open: config.signupMode === 'open',
  });
});

r.put('/me', authenticate, async (req, res) => {
  const name = str(req.body?.name, { field: 'Name', required: true, max: 120 });
  await query('UPDATE users SET name = $2 WHERE id = $1', [req.user.id, name]);
  res.json(await sessionPayload(req.user.id));
});

// Dashboard widget layout (per user).
const WIDGET_SIZES = ['small', 'medium', 'large'];
r.get('/me/dashboard', authenticate, async (req, res) => {
  const { rows } = await query('SELECT dashboard_layout FROM users WHERE id = $1', [req.user.id]);
  res.json({ layout: rows[0]?.dashboard_layout || null });
});

r.put('/me/dashboard', authenticate, async (req, res) => {
  const input = req.body?.layout;
  if (input !== null && !Array.isArray(input)) throw badRequest('Layout must be a list of widgets');
  const layout = input === null ? null : input.slice(0, 40).map((w) => {
    const id = str(w?.id, { field: 'Widget', required: true, max: 40 });
    if (!/^[a-z_]+$/.test(id)) throw badRequest('Invalid widget');
    return { id, size: WIDGET_SIZES.includes(w.size) ? w.size : 'medium' };
  });
  await query('UPDATE users SET dashboard_layout = $2 WHERE id = $1', [req.user.id, layout === null ? null : JSON.stringify(layout)]);
  res.json({ layout });
});

r.post('/change-password', authenticate, async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body?.current_password || ''), rows[0].password_hash || ''))) {
    throw badRequest('Current password is incorrect');
  }
  const hash = await bcrypt.hash(password(req.body?.new_password), 12);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hash]);
  res.json({ ok: true });
});

export default r;
