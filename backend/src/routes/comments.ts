// Comments on records. Customers can comment from the portal; staff can reply or add internal notes.
import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { str, bool } from '../lib/validate.js';

const r = Router();
const TYPES = ['estimate', 'sales_order', 'invoice', 'credit_note', 'delivery_challan', 'purchase_order', 'bill', 'vendor_credit', 'customer', 'vendor', 'item'];

r.get('/', async (req, res) => {
  const type = String(req.query.entity_type || '');
  if (!TYPES.includes(type)) throw badRequest('Unknown record type');
  const { rows } = await query(
    `SELECT c.id, c.body, c.is_internal, c.created_at, c.user_id, u.name AS user_name, ct.display_name AS contact_name
       FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.org_id = $1 AND c.entity_type = $2 AND c.entity_id = $3 ORDER BY c.created_at`,
    [req.orgId, type, Number(req.query.entity_id)],
  );
  res.json(rows);
});

r.post('/', async (req, res) => {
  const b = req.body || {};
  if (!TYPES.includes(b.entity_type)) throw badRequest('Unknown record type');
  const body = str(b.body, { field: 'Comment', required: true, max: 2000 });
  const internal = bool(b.is_internal);
  const { rows: [c] } = await query(
    'INSERT INTO comments (org_id, entity_type, entity_id, user_id, body, is_internal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.orgId, b.entity_type, Number(b.entity_id), req.user.id, body, internal],
  );
  await audit({ query }, req, 'comment', b.entity_type, Number(b.entity_id), `${internal ? 'Internal note' : 'Comment'}: "${body.slice(0, 80)}"`);
  res.status(201).json({ id: c.id });
});

r.delete('/:id', async (req, res) => {
  const { rows: [c] } = await query('SELECT user_id FROM comments WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!c) throw notFound('Comment');
  if (c.user_id !== req.user.id && !req.user.is_admin) throw forbidden('You can only delete your own comments');
  await query('DELETE FROM comments WHERE id = $1', [Number(req.params.id)]);
  res.status(204).end();
});

export default r;
