/** In-app inbox notifications (All / Mentions). */
export async function notify(db, { orgId, userId, kind = 'event', title, body = null, link = null, entityType = null, entityId = null }) {
  if (!userId) return;
  await db.query(
    `INSERT INTO notifications (org_id, user_id, kind, title, body, link, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgId, userId, kind, title, body, link, entityType, entityId],
  );
}

export async function notifyOrg(db, orgId, payload, { exceptUserId = null } = {}) {
  const { rows } = await db.query(
    `SELECT id FROM users WHERE org_id = $1 AND status = 'active'${exceptUserId ? ' AND id <> $2' : ''}`,
    exceptUserId ? [orgId, exceptUserId] : [orgId],
  );
  for (const u of rows) {
    await notify(db, { orgId, userId: u.id, ...payload });
  }
}

export async function notifyMentions(db, { orgId, fromUserId, fromName, body, entityType, entityId, link }) {
  const { rows: users } = await db.query(
    `SELECT id, name FROM users WHERE org_id = $1 AND status = 'active' AND id <> $2`,
    [orgId, fromUserId],
  );
  const mentioned = new Set();
  const text = String(body || '');
  for (const u of users.sort((a, b) => String(b.name).length - String(a.name).length)) {
    const name = String(u.name || '').trim();
    if (!name || mentioned.has(u.id)) continue;
    const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) mentioned.add(u.id);
  }
  for (const userId of mentioned) {
    await notify(db, {
      orgId, userId, kind: 'mention',
      title: `${fromName} mentioned you`,
      body: text.slice(0, 280),
      link, entityType, entityId,
    });
  }
}
