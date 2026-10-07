import { Router } from 'express';
import { query, tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, id, date, oneOf, listParams } from '../lib/validate.js';

const r = Router();

r.get('/', async (req, res) => {
  const p = listParams(req.query, {
    title: 't.title', due: 't.due_date', created: 't.created_at', status: 't.status', priority: 't.priority',
  }, 'created');
  const params = [req.orgId];
  const where = ['t.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`t.status = $${params.length}`); }
  if (req.query.assignee_id === 'me') { params.push(req.user.id); where.push(`t.assignee_id = $${params.length}`); }
  else if (req.query.assignee_id) { params.push(Number(req.query.assignee_id)); where.push(`t.assignee_id = $${params.length}`); }
  if (req.query.related_type) { params.push(req.query.related_type); where.push(`t.related_type = $${params.length}`); }
  if (req.query.related_id) { params.push(Number(req.query.related_id)); where.push(`t.related_id = $${params.length}`); }
  if (p.search) {
    params.push(`%${p.search}%`);
    where.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length} OR t.related_number ILIKE $${params.length})`);
  }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(
      `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
         FROM tasks t
         LEFT JOIN users a ON a.id = t.assignee_id
         LEFT JOIN users u ON u.id = t.created_by
        WHERE ${w} ORDER BY ${p.orderBy}, t.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM tasks t WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

r.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
       FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.created_by
      WHERE t.org_id = $1 AND t.id = $2`,
    [req.orgId, Number(req.params.id)],
  );
  if (!rows[0]) throw notFound('Task');
  res.json(rows[0]);
});

function parseTask(b) {
  const title = str(b.title, { field: 'Title', required: true, max: 200 });
  return {
    title,
    description: str(b.description, { field: 'Description', max: 4000 }),
    priority: oneOf(b.priority, ['low', 'normal', 'high'], { field: 'Priority', def: 'normal' }),
    due_date: date(b.due_date, { field: 'Due date' }),
    assignee_id: id(b.assignee_id, { field: 'Assignee' }),
    related_type: str(b.related_type, { field: 'Related type', max: 60 }),
    related_id: id(b.related_id, { field: 'Related id' }),
    related_number: str(b.related_number, { field: 'Related number', max: 60 }),
  };
}

r.post('/', async (req, res) => {
  const t = parseTask(req.body || {});
  if (!t.title) throw badRequest('Title is required');
  const result = await tx(async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO tasks (org_id, title, description, priority, due_date, assignee_id, related_type, related_id, related_number, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.orgId, t.title, t.description, t.priority, t.due_date, t.assignee_id, t.related_type, t.related_id, t.related_number, req.user.id],
    );
    await audit(client, req, 'create', 'task', row.id, `Task "${t.title}" created`);
    const { rows } = await client.query(
      `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [row.id],
    );
    return rows[0];
  });
  res.status(201).json(result);
});

r.put('/:id', async (req, res) => {
  const result = await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM tasks WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Task');
    if (cur.status === 'cancelled') throw conflict('Cancelled tasks cannot be edited');
    const t = parseTask({ ...cur, ...req.body });
    await client.query(
      `UPDATE tasks SET title=$3, description=$4, priority=$5, due_date=$6, assignee_id=$7,
             related_type=$8, related_id=$9, related_number=$10 WHERE org_id=$1 AND id=$2`,
      [req.orgId, cur.id, t.title, t.description, t.priority, t.due_date, t.assignee_id, t.related_type, t.related_id, t.related_number],
    );
    await audit(client, req, 'update', 'task', cur.id, `Task "${t.title}" updated`);
    const { rows } = await client.query(
      `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [cur.id],
    );
    return rows[0];
  });
  res.json(result);
});

r.post('/:id/complete', async (req, res) => {
  const result = await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM tasks WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Task');
    if (cur.status !== 'open') throw conflict('Only open tasks can be completed');
    await client.query("UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = $1", [cur.id]);
    await audit(client, req, 'approve', 'task', cur.id, `Task "${cur.title}" completed`);
    const { rows } = await client.query(
      `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [cur.id],
    );
    return rows[0];
  });
  res.json(result);
});

r.post('/:id/reopen', async (req, res) => {
  const result = await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM tasks WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Task');
    await client.query("UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = $1", [cur.id]);
    await audit(client, req, 'update', 'task', cur.id, `Task "${cur.title}" reopened`);
    const { rows } = await client.query(
      `SELECT t.*, a.name AS assignee_name, u.name AS created_by_name
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [cur.id],
    );
    return rows[0];
  });
  res.json(result);
});

r.delete('/:id', async (req, res) => {
  await tx(async (client) => {
    const { rows: [cur] } = await client.query(
      'SELECT * FROM tasks WHERE org_id = $1 AND id = $2 FOR UPDATE',
      [req.orgId, Number(req.params.id)],
    );
    if (!cur) throw notFound('Task');
    await client.query('DELETE FROM tasks WHERE id = $1', [cur.id]);
    await audit(client, req, 'delete', 'task', cur.id, `Task "${cur.title}" deleted`);
  });
  res.status(204).end();
});

export default r;
