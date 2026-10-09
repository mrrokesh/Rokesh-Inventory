import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, bool, oneOf, listParams } from '../lib/validate.js';

const r = Router();

/** Inbox for the signed-in user: published announcements + unread flag. */
r.get('/inbox', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.title, a.body, a.pinned, a.published_at, a.created_at,
            u.name AS created_by_name,
            (ar.user_id IS NOT NULL) AS read
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $2
      WHERE a.org_id = $1 AND a.status = 'published'
      ORDER BY a.pinned DESC, a.published_at DESC NULLS LAST, a.id DESC
      LIMIT 50`,
    [req.orgId, req.user.id],
  );
  const unread = rows.filter((x) => !x.read).length;
  res.json({ data: rows, unread });
});

r.post('/read-all', async (req, res) => {
  await query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     SELECT a.id, $2 FROM announcements a
      WHERE a.org_id = $1 AND a.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $2
        )`,
    [req.orgId, req.user.id],
  );
  res.json({ ok: true });
});

r.post('/:id/read', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query(
    `SELECT id FROM announcements WHERE org_id = $1 AND id = $2 AND status = 'published'`,
    [req.orgId, id],
  );
  if (!rows[0]) throw notFound('Announcement');
  await query(
    `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, req.user.id],
  );
  res.json({ ok: true });
});

/** Admin / settings list (all statuses). */
r.get('/', can('settings', 'view'), async (req, res) => {
  const p = listParams(req.query, { title: 'a.title', created: 'a.created_at', status: 'a.status' }, 'created');
  const params = [req.orgId];
  const where = ['a.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`a.status = $${params.length}`); }
  if (p.search) {
    params.push(`%${p.search}%`);
    where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
  }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(
      `SELECT a.*, u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by
        WHERE ${w} ORDER BY ${p.orderBy}, a.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM announcements a WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

r.get('/:id', can('settings', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.name AS created_by_name FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.org_id = $1 AND a.id = $2`,
    [req.orgId, Number(req.params.id)],
  );
  if (!rows[0]) throw notFound('Announcement');
  res.json(rows[0]);
});

function parse(b) {
  const title = str(b.title, { field: 'Title', required: true, max: 200 });
  const body = str(b.body, { field: 'Body', max: 8000 }) || '';
  const status = oneOf(b.status, ['draft', 'published', 'archived'], { field: 'Status', def: 'published' });
  const pinned = bool(b.pinned);
  return { title, body, status, pinned };
}

r.post('/', can('settings', 'edit'), async (req, res) => {
  const { assertModule } = await import('../lib/plans.js');
  await assertModule(req.orgId, 'announcements');
  const a = parse(req.body || {});
  const result = await tx(async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO announcements (org_id, title, body, status, pinned, created_by, published_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $4 = 'published' THEN now() ELSE NULL END)
       RETURNING *`,
      [req.orgId, a.title, a.body, a.status, a.pinned, req.user.id],
    );
    await audit(client, req, 'create', 'announcement', row.id, `Announcement "${a.title}" created`);
    return row;
  });
  res.status(201).json(result);
});

r.put('/:id', can('settings', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM announcements WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Announcement');
    const a = parse({ ...cur, ...req.body });
    if (!a.title) throw badRequest('Title is required');
    const publishNow = a.status === 'published' && cur.status !== 'published';
    const { rows: [row] } = await client.query(
      `UPDATE announcements SET title=$3, body=$4, status=$5, pinned=$6, updated_at=now(),
             published_at = CASE
               WHEN $5 = 'published' AND ($7 OR published_at IS NULL) THEN COALESCE(published_at, now())
               WHEN $5 <> 'published' THEN published_at
               ELSE published_at END
       WHERE org_id=$1 AND id=$2 RETURNING *`,
      [req.orgId, cur.id, a.title, a.body, a.status, a.pinned, publishNow],
    );
    await audit(client, req, 'update', 'announcement', cur.id, `Announcement "${a.title}" updated`);
    return row;
  });
  res.json(result);
});

r.delete('/:id', can('settings', 'edit'), async (req, res) => {
  await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM announcements WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Announcement');
    await client.query('DELETE FROM announcements WHERE id = $1', [cur.id]);
    await audit(client, req, 'delete', 'announcement', cur.id, `Announcement "${cur.title}" deleted`);
  });
  res.status(204).end();
});

export default r;
