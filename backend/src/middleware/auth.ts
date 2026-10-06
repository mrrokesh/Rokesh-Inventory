import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { hasPermission } from '../lib/permissions.js';

export function signToken(user: any) {
  return jwt.sign(
    { sub: user.id, org: user.org_id },
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
  if (payload.typ === 'portal') return next(new HttpError(401, 'Please sign in'));
  const { rows } = await query(
    `SELECT u.id, u.org_id, u.name, u.email, u.status, r.id AS role_id, r.name AS role_name,
            r.is_admin, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.org_id = $2`,
    [payload.sub, payload.org],
  );
  const user = rows[0];
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Your account is not active'));
  req.user = user;
  req.orgId = user.org_id;
  next();
}

/** API keys (for integrations): act with the permissions of the user who owns the key. */
async function apiKeyAuth(token: string, req: Request, next: NextFunction) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT k.id AS key_id, u.id, u.org_id, u.name, u.email, u.status, r.id AS role_id, r.name AS role_name, r.is_admin, r.permissions
       FROM api_keys k JOIN users u ON u.id = k.user_id JOIN roles r ON r.id = u.role_id WHERE k.key_hash = $1`,
    [hash],
  );
  const user = rows[0];
  if (!user || user.status !== 'active') return next(new HttpError(401, 'Invalid API key'));
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
