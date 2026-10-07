import { query } from '../db.js';
import { badRequest } from './errors.js';

export type PlanLimitKind = 'users' | 'warehouses' | 'items';

const COUNT_SQL: Record<PlanLimitKind, string> = {
  users: `SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1 AND status IN ('active','invited')`,
  warehouses: `SELECT COUNT(*)::int AS n FROM warehouses WHERE org_id = $1 AND status = 'active'`,
  items: `SELECT COUNT(*)::int AS n FROM items WHERE org_id = $1 AND status = 'active'`,
};

const LIMIT_COL: Record<PlanLimitKind, string> = {
  users: 'max_users',
  warehouses: 'max_warehouses',
  items: 'max_items',
};

export async function orgPlan(orgId) {
  const { rows } = await query(
    `SELECT o.status, o.trial_ends_at, o.plan_id,
            p.code AS plan_code, p.name AS plan_name, p.max_users, p.max_warehouses, p.max_items, p.modules
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
      WHERE o.id = $1`,
    [orgId],
  );
  return rows[0] || null;
}

export async function usageCounts(orgId) {
  const [u, w, i] = await Promise.all([
    query(COUNT_SQL.users, [orgId]),
    query(COUNT_SQL.warehouses, [orgId]),
    query(COUNT_SQL.items, [orgId]),
  ]);
  return {
    users: u.rows[0].n,
    warehouses: w.rows[0].n,
    items: i.rows[0].n,
  };
}

/** Throws if the org is over (or at) the plan limit for creating one more of `kind`. */
export async function assertWithinLimit(orgId, kind: PlanLimitKind) {
  const plan = await orgPlan(orgId);
  if (!plan) return;
  const col = LIMIT_COL[kind];
  const max = plan[col];
  if (max == null) return;
  const { rows: [c] } = await query(COUNT_SQL[kind], [orgId]);
  if (c.n >= max) {
    const label = kind === 'users' ? 'users' : kind === 'warehouses' ? 'warehouses' : 'items';
    throw badRequest(
      `Your ${plan.plan_name || 'current'} plan allows up to ${max} ${label}. Contact support to upgrade.`,
    );
  }
}

export function orgAccessMessage(org) {
  if (!org) return 'Organization not found';
  if (org.status === 'suspended') return 'This organization is suspended. Contact support.';
  if (org.status === 'cancelled') return 'This organization has been cancelled.';
  if (org.status === 'trial' && org.trial_ends_at && new Date(org.trial_ends_at) < new Date()) {
    return 'Your trial has ended. Contact support to activate your account.';
  }
  return null;
}

export function isOrgAccessible(org) {
  return !orgAccessMessage(org);
}
