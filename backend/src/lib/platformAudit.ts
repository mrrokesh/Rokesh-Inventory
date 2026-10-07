import { query } from '../db.js';

export async function platformAudit(adminId, action, entityType, entityId, detail, meta = {}) {
  await query(
    `INSERT INTO platform_audit_log (admin_id, action, entity_type, entity_id, detail, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId || null, action, entityType || null, entityId || null, detail || null, JSON.stringify(meta || {})],
  );
}
