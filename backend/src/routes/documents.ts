import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, listParams } from '../lib/validate.js';
import { documentUpload, privateDir } from '../lib/upload.js';

const r = Router();

// Entity types that documents can be attached to, with the table that holds them.
const ENTITIES = {
  item: 'items', customer: 'contacts', vendor: 'contacts', sales_order: 'sales_orders', invoice: 'invoices',
  package: 'packages', shipment: 'shipments', credit_note: 'credit_notes', sales_return: 'sales_returns',
  purchase_order: 'purchase_orders', purchase_receive: 'purchase_receives', bill: 'bills', vendor_credit: 'vendor_credits',
  payments_received: 'payments_received', payments_made: 'payments_made', inventory_adjustment: 'inventory_adjustments',
  transfer_order: 'transfer_orders',
};

r.get('/', can('documents', 'view'), async (req, res) => {
  const p = listParams(req.query, { name: 'd.file_name', date: 'd.created_at', size: 'd.size_bytes' }, 'date');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.entity_type) { params.push(req.query.entity_type); where.push(`d.entity_type = $${params.length}`); }
  if (req.query.entity_id) { params.push(Number(req.query.entity_id)); where.push(`d.entity_id = $${params.length}`); }
  if (req.query.category) { params.push(req.query.category); where.push(`d.category = $${params.length}`); }
  if (req.query.unattached === 'true') where.push('d.entity_type IS NULL');
  if (p.search) { params.push(`%${p.search}%`); where.push(`(d.file_name ILIKE $${params.length} OR d.category ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }, { rows: cats }] = await Promise.all([
    query(`SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
            WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM documents d WHERE ${w}`, params),
    query('SELECT DISTINCT category FROM documents WHERE org_id = $1 AND category IS NOT NULL ORDER BY category', [req.orgId]),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage, categories: cats.map((x) => x.category) });
});

r.post('/', can('documents', 'create'), documentUpload.array('files', 10), async (req, res) => {
  const files: any[] = (req.files as any) || [];
  if (!files.length) throw badRequest('Choose at least one file');
  const entityType = req.body.entity_type || null;
  const entityId = req.body.entity_id ? Number(req.body.entity_id) : null;
  try {
    if (entityType) {
      const table = ENTITIES[entityType];
      if (!table || !entityId) throw badRequest('Invalid record to attach to');
      const { rows } = await query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [req.orgId, entityId]);
      if (!rows[0]) throw badRequest('The record to attach to was not found');
    }
    const category = str(req.body.category, { field: 'Category', max: 100 });
    const saved = [];
    for (const f of files) {
      const { rows } = await query(
        `INSERT INTO documents (org_id, file_name, stored_name, mime_type, size_bytes, category, entity_type, entity_id, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.orgId, f.originalname.slice(0, 250), f.filename, f.mimetype, f.size, category, entityType, entityId, req.user.id],
      );
      saved.push(rows[0]);
    }
    await audit({ query }, req, 'create', 'document', null, `${saved.length} document(s) uploaded${entityType ? ` to ${entityType} #${entityId}` : ''}`);
    res.status(201).json(saved);
  } catch (err) {
    for (const f of files) fs.promises.unlink(f.path).catch(() => {});
    throw err;
  }
});

r.put('/:id', can('documents', 'create'), async (req, res) => {
  const { rows } = await query(
    'UPDATE documents SET category = $3, file_name = COALESCE($4, file_name) WHERE org_id = $1 AND id = $2 RETURNING *',
    [req.orgId, Number(req.params.id), str(req.body?.category, { field: 'Category', max: 100 }), str(req.body?.file_name, { field: 'File name', max: 250 })],
  );
  if (!rows[0]) throw notFound('Document');
  res.json(rows[0]);
});

r.get('/:id/download', can('documents', 'view'), async (req, res) => {
  const { rows } = await query('SELECT * FROM documents WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  const doc = rows[0];
  if (!doc) throw notFound('Document');
  const file = path.join(privateDir, path.basename(doc.stored_name));
  if (!fs.existsSync(file)) throw notFound('File');
  const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
});

r.delete('/:id', can('documents', 'delete'), async (req, res) => {
  const { rows } = await query('DELETE FROM documents WHERE org_id = $1 AND id = $2 RETURNING *', [req.orgId, Number(req.params.id)]);
  if (!rows[0]) throw notFound('Document');
  fs.promises.unlink(path.join(privateDir, path.basename(rows[0].stored_name))).catch(() => {});
  await audit({ query }, req, 'delete', 'document', rows[0].id, `Document ${rows[0].file_name} deleted`);
  res.status(204).end();
});

export default r;
