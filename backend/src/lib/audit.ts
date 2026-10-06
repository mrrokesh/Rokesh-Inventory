import { enqueueEvent } from './webhooks.js';

/**
 * Record an audit log entry and queue a webhook event `<entity>.<action>`.
 * `db` may be a pool or a transaction client (events then only go out if the transaction commits).
 */
export async function audit(db: any, req: any, action: any, entityType?: any, entityId?: any, summary?: any) {
  await db.query(
    `INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.orgId, req.user?.id ?? null, action, entityType, entityId ?? null, summary ?? null],
  );
  await enqueueEvent(db, req.orgId, `${entityType}.${action}`, { entity_type: entityType, entity_id: entityId ?? null, action, summary: summary ?? null });
}
