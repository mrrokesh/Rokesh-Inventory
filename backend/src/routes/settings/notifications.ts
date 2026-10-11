import { Router } from 'express';
import { query } from '../../db.js';
import { listParams } from '../../lib/validate.js';

const r = Router();

r.get('/', async (req, res) => {
  const p = listParams(req.query, { created: 'n.created_at' }, 'created');
  const where = ['n.org_id = $1', 'n.user_id = $2'];
  const params = [req.orgId, req.user.id];
  const tab = String(req.query.tab || 'all');
  if (tab === 'mentions') where.push(`n.kind = 'mention'`);
  if (req.query.unread === '1') where.push('n.read_at IS NULL');
  const w = where.join(' AND ');
  const [{ rows }, { rows: [cnt] }, { rows: [unread] }] = await Promise.all([
    query(
      `SELECT n.id, n.kind, n.title, n.body, n.link, n.entity_type, n.entity_id, n.read_at, n.created_at
         FROM notifications n WHERE ${w} ORDER BY ${p.orderBy}, n.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM notifications n WHERE ${w}`, params),
    query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [req.orgId, req.user.id],
    ),
  ]);
  res.json({ data: rows, total: cnt.n, unread: unread.n, page: p.page, per_page: p.perPage });
});

r.post('/read-all', async (req, res) => {
  await query(
    `UPDATE notifications SET read_at = now() WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [req.orgId, req.user.id],
  );
  res.json({ ok: true });
});

r.post('/:id/read', async (req, res) => {
  await query(
    `UPDATE notifications SET read_at = now() WHERE org_id = $1 AND user_id = $2 AND id = $3 AND read_at IS NULL`,
    [req.orgId, req.user.id, Number(req.params.id)],
  );
  res.json({ ok: true });
});

export default r;
