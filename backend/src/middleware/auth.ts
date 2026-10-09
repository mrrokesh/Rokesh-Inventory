import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { hasPermission } from '../lib/permissions.js';

export function signToken(user: any, extra: Record<string, unknown> = {}) {
  return jwt.sign(
    { sub: user.id, org: user.org_id, ...extra },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] },
  );
}

/** Short-lived staff token for platform support impersonation. */
export function signImpersonationToken(user: any, platformAdmin: { id: number; email: string }) {
  return jwt.sign(
    {
      sub: user.id,
      org: user.org_id,
      typ: 'impersonation',
      platform_admin_id: platformAdmin.id,
      platform_admin_email: platformAdmin.email,
    },
    config.jwtSecret,
    { expiresIn: '2h' },
  );
}

export function signPlatformToken(admin: any) {
  return jwt.sign(
    { sub: admin.id, typ: 'platform' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] },
  );
}

/** Verifies the bearer token and loads the user + role on every request. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const token = typeof raw === 'string' ? raw : '';
  if (!token) return next(new HttpError(401, 'Please sign in'));
  if (token.startsWith('ik_')) return apiKeyAuth(token, req, next);
  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
  }
  if (payload.typ === 'portal' || payload.typ === 'platform') {
    return next(new HttpError(401, 'Please sign in'));
  }
  const impersonating = payload.typ === 'impersonation';
  const { rows } = await query(
    `SELECT u.id, u.org_id, u.name, u.email, u.status, r.id AS role_id, r.name AS role_name,
            r.is_admin, r.permissions,
            o.status AS org_status, o.trial_ends_at
       FROM users u JOIN roles r ON r.id = u.role_id
       JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1 AND u.org_id = $2`,
    [payload.sub, payload.org],
  );
  const user = rows[0];
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Your account is not active'));
  // Impersonation may enter suspended orgs for support; normal logins cannot.
  if (!impersonating) {
    const { orgAccessMessage } = await import('../lib/plans.js');
    const blocked = orgAccessMessage({ status: user.org_status, trial_ends_at: user.trial_ends_at });
    if (blocked) return next(new HttpError(403, blocked));
  }
  req.user = user;
  req.orgId = user.org_id;
  if (impersonating) {
    req.impersonating = {
      admin_id: payload.platform_admin_id,
      admin_email: payload.platform_admin_email,
    };
  }
  next();
}

/** Platform (super-admin) authentication — separate from client org users. */
export async function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new HttpError(401, 'Please sign in'));
  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
  }
  if (payload.typ !== 'platform') return next(new HttpError(401, 'Please sign in to the platform console'));
  const { rows } = await query(
    `SELECT id, name, email, status FROM platform_admins WHERE id = $1`,
    [payload.sub],
  );
  const admin = rows[0];
  if (!admin || admin.status !== 'active') return next(new HttpError(401, 'Your platform account is not active'));
  req.platformAdmin = admin;
  next();
}

/** API keys (for integrations): act with the permissions of the user who owns the key. */
async function apiKeyAuth(token: string, req: Request, next: NextFunction) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT k.id AS key_id, u.id, u.org_id, u.name, u.email, u.status, r.id AS role_id, r.name AS role_name, r.is_admin, r.permissions,
            o.status AS org_status, o.trial_ends_at
       FROM api_keys k JOIN users u ON u.id = k.user_id JOIN roles r ON r.id = u.role_id
       JOIN organizations o ON o.id = u.org_id
      WHERE k.key_hash = $1`,
    [hash],
  );
  const user = rows[0];
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Invalid API key'));
  const { orgAccessMessage } = await import('../lib/plans.js');
  const blocked = orgAccessMessage({ status: user.org_status, trial_ends_at: user.trial_ends_at });
  if (blocked) return next(new HttpError(403, blocked));
  query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [user.key_id]).catch(() => {});
  req.user = user;
  req.orgId = user.org_id;
  req.viaApiKey = true;
  next();
}

/** Route guard: requirePermission('items', 'create') */
export function can(module: string, action: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasPermission(req.user, module, action)) return next(forbidden());
    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user.is_admin) return next(forbidden('Only administrators can do this'));
  next();
}
