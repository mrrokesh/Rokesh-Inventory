import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, id, bool, obj, oneOf, date, today, listParams, round3 } from '../lib/validate.js';
import { imageUpload, removePublic } from '../lib/upload.js';
import { stockIn, ctxOf, loadItems } from '../lib/stock.js';
import { getWarehouse } from '../lib/documents.js';

const r = Router();

const STOCK_SELECT = `
  COALESCE(s.on_hand, 0) AS stock_on_hand,
  COALESCE(s.committed, 0) AS committed_stock,
  COALESCE(s.on_hand, 0) - COALESCE(s.committed, 0) AS available_stock`;
const STOCK_JOIN = `LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(committed) AS committed
                                FROM stock_levels WHERE org_id = $1 GROUP BY item_id) s ON s.item_id = i.id`;

r.get('/', can('items', 'view'), async (req, res) => {
  const p = listParams(req.query, {
    name: 'i.name', sku: 'i.sku', rate: 'i.selling_price', cost: 'i.cost_price', stock: 'COALESCE(s.on_hand,0)',
    created: 'i.created_at', reorder: 'i.reorder_level',
  }, 'name');
  if (!req.query.sort) p.orderBy = 'i.name ASC';
  const params = [req.orgId];
  const where = ['i.org_id = $1'];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  const q = req.query;
  if (q.status) add('i.status = ?', q.status);
  if (q.item_type) add('i.item_type = ?', q.item_type);
  if (q.group_id) add('i.group_id = ?', Number(q.group_id));
  if (q.category) add('i.category = ?', q.category);
  if (q.composite === 'true') where.push('i.is_composite');
  if (q.composite === 'false') where.push('NOT i.is_composite');
  if (q.tracked === 'true') where.push('i.track_inventory');
  if (q.stock === 'low') where.push('i.track_inventory AND i.reorder_level > 0 AND COALESCE(s.on_hand,0) - COALESCE(s.committed,0) <= i.reorder_level');
  if (q.stock === 'out') where.push('i.track_inventory AND COALESCE(s.on_hand,0) <= 0');
  if (p.search) add('(i.name ILIKE ? OR i.sku ILIKE ? OR i.barcode ILIKE ? OR i.category ILIKE ? OR i.brand ILIKE ?)', `%${p.search}%`);
  const w = where.join(' AND ');
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(
      `SELECT i.*, ${STOCK_SELECT}, g.name AS group_name, st.rate AS sales_tax_rate, pt.rate AS purchase_tax_rate
         FROM items i ${STOCK_JOIN}
         LEFT JOIN item_groups g ON g.id = i.group_id
         LEFT JOIN taxes st ON st.id = i.sales_tax_id
         LEFT JOIN taxes pt ON pt.id = i.purchase_tax_id
        WHERE ${w} ORDER BY ${p.orderBy}, i.id LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM items i ${STOCK_JOIN} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

r.get('/meta/lookups', can('items', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT array_remove(array_agg(DISTINCT category), NULL) AS categories,
            array_remove(array_agg(DISTINCT brand), NULL) AS brands,
            array_remove(array_agg(DISTINCT manufacturer), NULL) AS manufacturers
       FROM items WHERE org_id = $1`,
    [req.orgId],
  );
  res.json(rows[0]);
});

r.get('/:id', can('items', 'view'), async (req, res) => {
  const itemId = Number(req.params.id);
  const { rows } = await query(
    `SELECT i.*, ${STOCK_SELECT}, g.name AS group_name, v.display_name AS preferred_vendor_name,
            st.name AS sales_tax_name, pt.name AS purchase_tax_name,
            (SELECT COALESCE(SUM(qty_remaining * unit_cost), 0) FROM stock_lots WHERE item_id = i.id) AS stock_value
       FROM items i ${STOCK_JOIN}
       LEFT JOIN item_groups g ON g.id = i.group_id
       LEFT JOIN contacts v ON v.id = i.preferred_vendor_id
       LEFT JOIN taxes st ON st.id = i.sales_tax_id
       LEFT JOIN taxes pt ON pt.id = i.purchase_tax_id
      WHERE i.org_id = $1 AND i.id = $2`,
    [req.orgId, itemId],
  );
  if (!rows[0]) throw notFound('Item');
  const item = rows[0];
  const [{ rows: warehouses }, { rows: components }, { rows: usedIn }, { rows: pending }] = await Promise.all([
    query(
      `SELECT w.id AS warehouse_id, w.name AS warehouse_name, COALESCE(sl.on_hand,0) AS on_hand, COALESCE(sl.committed,0) AS committed,
              COALESCE(sl.on_hand,0) - COALESCE(sl.committed,0) AS available
         FROM warehouses w LEFT JOIN stock_levels sl ON sl.warehouse_id = w.id AND sl.item_id = $2
        WHERE w.org_id = $1 AND (w.status = 'active' OR sl.on_hand <> 0) ORDER BY w.is_primary DESC, w.name`,
      [req.orgId, itemId],
    ),
    query(
      `SELECT cc.component_item_id AS item_id, cc.quantity, i.name, i.sku, i.unit, i.cost_price, i.selling_price, i.track_inventory
         FROM composite_components cc JOIN items i ON i.id = cc.component_item_id
        WHERE cc.composite_item_id = $1 ORDER BY i.name`,
      [itemId],
    ),
    query(
      `SELECT i.id, i.name, i.sku, cc.quantity FROM composite_components cc JOIN items i ON i.id = cc.composite_item_id
        WHERE cc.component_item_id = $1 ORDER BY i.name`,
      [itemId],
    ),
    query(
      `SELECT
         (SELECT COALESCE(SUM(l.quantity - l.qty_received),0) FROM purchase_order_lines l JOIN purchase_orders d ON d.id = l.doc_id
           WHERE l.item_id = $1 AND d.status = 'issued') AS qty_to_receive,
         (SELECT COALESCE(SUM(l.quantity - l.qty_shipped),0) FROM sales_order_lines l JOIN sales_orders d ON d.id = l.doc_id
           WHERE l.item_id = $1 AND d.status = 'confirmed') AS qty_to_ship`,
      [itemId],
    ),
  ]);
  res.json({ ...item, warehouses, components, used_in: usedIn, ...pending[0] });
});

// Serial numbers / batches in stock (optionally for one warehouse) – used by pickers and the item page.
r.get('/:id/tracking', can('items', 'view'), async (req, res) => {
  const itemId = Number(req.params.id);
  const { rows: [item] } = await query('SELECT id, tracking FROM items WHERE org_id = $1 AND id = $2', [req.orgId, itemId]);
  if (!item) throw notFound('Item');
  const wh = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;
  if (item.tracking === 'serial') {
    const status = req.query.status === 'out' ? 'out' : 'in_stock';
    const { rows } = await query(
      `SELECT s.id, s.serial, s.status, s.warehouse_id, w.name AS warehouse_name, s.created_at
         FROM serial_numbers s LEFT JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.org_id = $1 AND s.item_id = $2 AND s.status = $3 ${wh ? 'AND s.warehouse_id = $4' : ''}
        ORDER BY s.created_at, s.id LIMIT 2000`,
      wh ? [req.orgId, itemId, status, wh] : [req.orgId, itemId, status],
    );
    return res.json({ tracking: 'serial', serials: rows });
  }
  if (item.tracking === 'batch') {
    const { rows } = await query(
      `SELECT b.id, b.batch_no, b.mfg_date, b.expiry_date, b.quantity, b.warehouse_id, w.name AS warehouse_name
         FROM batches b JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.org_id = $1 AND b.item_id = $2 AND b.quantity > 0 ${wh ? 'AND b.warehouse_id = $3' : ''}
        ORDER BY b.expiry_date NULLS LAST, b.created_at`,
      wh ? [req.orgId, itemId, wh] : [req.orgId, itemId],
    );
    return res.json({ tracking: 'batch', batches: rows });
  }
  res.json({ tracking: 'none' });
});

// Where has a serial number been? (history of one unit)
r.get('/:id/serials/:serial/history', can('items', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT e.source_type, e.source_id, e.quantity, e.created_at, w.name AS warehouse_name, m.source_number
       FROM serial_numbers s JOIN tracking_entries e ON e.serial_id = s.id JOIN warehouses w ON w.id = e.warehouse_id
       LEFT JOIN LATERAL (SELECT source_number FROM stock_movements sm
                           WHERE sm.source_type = e.source_type AND sm.source_id = e.source_id AND sm.item_id = e.item_id LIMIT 1) m ON TRUE
      WHERE s.org_id = $1 AND s.item_id = $2 AND s.serial = $3 ORDER BY e.id`,
    [req.orgId, Number(req.params.id), req.params.serial],
  );
  res.json(rows);
});

r.get('/:id/movements', can('items', 'view'), async (req, res) => {
  const p = listParams(req.query, { date: 'm.movement_date' }, 'date');
  const params = [req.orgId, Number(req.params.id)];
  let where = 'm.org_id = $1 AND m.item_id = $2';
  if (req.query.warehouse_id) { params.push(Number(req.query.warehouse_id)); where += ` AND m.warehouse_id = $${params.length}`; }
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(
      `SELECT m.*, w.name AS warehouse_name, u.name AS user_name FROM stock_movements m
         JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN users u ON u.id = m.created_by
        WHERE ${where} ORDER BY ${p.orderBy}, m.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM stock_movements m WHERE ${where}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
});

export async function parseItem(b: any, req: any, existing?: any) {
  const itemType = oneOf(b.item_type, ['goods', 'service'], { field: 'Type', def: 'goods' });
  const isComposite = existing ? existing.is_composite : bool(b.is_composite);
  let track = itemType === 'goods' ? bool(b.track_inventory, true) : false;
  if (isComposite) {
    if (itemType !== 'goods') throw badRequest('Composite items must be goods');
    track = true;
  }
  for (const key of ['sales_tax_id', 'purchase_tax_id']) {
    const t = id(b[key], { field: 'Tax' });
    if (t) {
      const { rows } = await query('SELECT 1 FROM taxes WHERE org_id = $1 AND id = $2', [req.orgId, t]);
      if (!rows[0]) throw badRequest('Select a valid tax');
    }
  }
  const vendorId = id(b.preferred_vendor_id, { field: 'Preferred vendor' });
  if (vendorId) {
    const { rows } = await query("SELECT 1 FROM contacts WHERE org_id = $1 AND id = $2 AND contact_type = 'vendor'", [req.orgId, vendorId]);
    if (!rows[0]) throw badRequest('Select a valid preferred vendor');
  }
  const tracking = track && !isComposite ? oneOf(b.tracking, ['none', 'serial', 'batch'], { field: 'Tracking', def: 'none' }) : 'none';
  return {
    tracking,
    name: str(b.name, { field: 'Name', required: true, max: 250 }),
    sku: str(b.sku, { field: 'SKU', max: 100 }),
    barcode: str(b.barcode, { field: 'Barcode', max: 100 }),
    item_type: itemType,
    track_inventory: track,
    unit: str(b.unit, { field: 'Unit', max: 30 }),
    category: str(b.category, { field: 'Category', max: 100 }),
    brand: str(b.brand, { field: 'Brand', max: 100 }),
    manufacturer: str(b.manufacturer, { field: 'Manufacturer', max: 100 }),
    description: str(b.description, { field: 'Description', max: 5000 }),
    hsn_sac: str(b.hsn_sac, { field: 'HSN/SAC', max: 20 }),
    selling_price: num(b.selling_price, { field: 'Selling price', min: 0, def: 0 }),
    cost_price: num(b.cost_price, { field: 'Cost price', min: 0, def: 0 }),
    sales_description: str(b.sales_description, { field: 'Sales description', max: 2000 }),
    purchase_description: str(b.purchase_description, { field: 'Purchase description', max: 2000 }),
    sales_tax_id: id(b.sales_tax_id, { field: 'Sales tax' }),
    purchase_tax_id: id(b.purchase_tax_id, { field: 'Purchase tax' }),
    preferred_vendor_id: vendorId,
    reorder_level: num(b.reorder_level, { field: 'Reorder point', min: 0, def: 0 }),
    returnable: bool(b.returnable, true),
    length_cm: num(b.length_cm, { field: 'Length', min: 0 }),
    width_cm: num(b.width_cm, { field: 'Width', min: 0 }),
    height_cm: num(b.height_cm, { field: 'Height', min: 0 }),
    weight_kg: num(b.weight_kg, { field: 'Weight', min: 0 }),
    attributes: JSON.stringify(obj(b.attributes)),
    status: oneOf(b.status, ['active', 'inactive'], { field: 'Status', def: 'active' }),
  };
}

async function saveComponents(client, req, itemId, components) {
  if (!Array.isArray(components) || components.length === 0) throw badRequest('A composite item needs at least one component');
  const parsed = components.map((c, i) => ({
    item_id: id(c.item_id, { field: `Component ${i + 1}`, required: true }),
    quantity: round3(num(c.quantity, { field: `Component ${i + 1} quantity`, required: true, min: 0.001 })),
  }));
  if (new Set(parsed.map((c) => c.item_id)).size !== parsed.length) throw badRequest('Each component can be added only once');
  const items = await loadItems(client, req.orgId, parsed.map((c) => c.item_id));
  for (const c of parsed) {
    if (c.item_id === itemId) throw badRequest('An item cannot be a component of itself');
    if (items.get(c.item_id).is_composite) throw badRequest(`${items.get(c.item_id).name} is itself a composite item`);
  }
  await client.query('DELETE FROM composite_components WHERE composite_item_id = $1', [itemId]);
  for (const c of parsed) {
    await client.query(
      'INSERT INTO composite_components (composite_item_id, component_item_id, quantity) VALUES ($1, $2, $3)',
      [itemId, c.item_id, c.quantity],
    );
  }
}

/** Opening stock: [{ warehouse_id, quantity, unit_cost }] */
async function addOpeningStock(client, req, item, rows, asOf) {
  for (const [i, o] of (Array.isArray(rows) ? rows : []).entries()) {
    const qty = num(o.quantity, { field: `Opening stock row ${i + 1}`, min: 0, def: 0 });
    if (!qty) continue;
    const wh = await getWarehouse(client, req.orgId, id(o.warehouse_id, { field: 'Warehouse' }));
    const cost = num(o.unit_cost, { field: 'Opening stock rate', min: 0, def: item.cost_price });
    await stockIn(client, ctxOf(req), {
      itemId: item.id, warehouseId: wh.id, qty, unitCost: cost, date: asOf,
      sourceType: 'opening_stock', sourceId: item.id, sourceNumber: 'Opening Stock', note: 'Opening stock', tracking: o.tracking,
    });
  }
}

export async function insertItem(client: any, req: any, v: any, extra: any = {}) {
  const cols = { ...v, ...extra };
  const keys = Object.keys(cols);
  const { rows } = await client.query(
    `INSERT INTO items (org_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [req.orgId, ...keys.map((k) => cols[k])],
  );
  return rows[0];
}

r.post('/', can('items', 'create'), async (req, res) => {
  const { assertWithinLimit } = await import('../lib/plans.js');
  await assertWithinLimit(req.orgId, 'items');
  const b = req.body || {};
  const v = await parseItem(b, req);
  const isComposite = bool(b.is_composite);
  if (isComposite && Array.isArray(b.opening_stock) && b.opening_stock.some((o) => Number(o.quantity) > 0)) {
    throw badRequest('Composite items get stock by assembling them from components (Inventory → Assemblies)');
  }
  const item = await tx(async (client) => {
    const created = await insertItem(client, req, v, { is_composite: isComposite });
    if (isComposite) await saveComponents(client, req, created.id, b.components);
    if (created.track_inventory && !isComposite) {
      await addOpeningStock(client, req, created, b.opening_stock, date(b.opening_stock_date, { field: 'Opening stock date' }) || today());
    }
    await audit(client, req, 'create', 'item', created.id, `Item ${created.name} created`);
    return created;
  });
  res.status(201).json(item);
});

r.put('/:id', can('items', 'edit'), async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await tx(async (client) => {
    const { rows: [cur] } = await client.query('SELECT * FROM items WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, itemId]);
    if (!cur) throw notFound('Item');
    const v = await parseItem(req.body || {}, req, cur);
    if (v.track_inventory !== cur.track_inventory || v.item_type !== cur.item_type || v.tracking !== cur.tracking) {
      const { rows } = await client.query('SELECT 1 FROM stock_movements WHERE item_id = $1 LIMIT 1', [itemId]);
      const used = await isItemUsed(client, itemId);
      if (rows.length || used) throw conflict('Item type, inventory tracking and serial/batch tracking cannot be changed after the item has transactions');
    }
    const keys = Object.keys(v);
    const { rows } = await client.query(
      `UPDATE items SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE org_id = $1 AND id = $2 RETURNING *`,
      [req.orgId, itemId, ...keys.map((k) => v[k])],
    );
    if (cur.is_composite && req.body.components) await saveComponents(client, req, itemId, req.body.components);
    await audit(client, req, 'update', 'item', itemId, `Item ${rows[0].name} updated`);
    return rows[0];
  });
  res.json(item);
});

async function isItemUsed(client, itemId) {
  const tables = ['sales_order_lines', 'invoice_lines', 'credit_note_lines', 'purchase_order_lines', 'bill_lines', 'vendor_credit_lines', 'inventory_adjustment_lines', 'transfer_order_lines', 'composite_components'];
  for (const t of tables) {
    const col = t === 'composite_components' ? 'component_item_id' : 'item_id';
    const { rows } = await client.query(`SELECT 1 FROM ${t} WHERE ${col} = $1 LIMIT 1`, [itemId]);
    if (rows.length) return true;
  }
  const { rows } = await client.query('SELECT 1 FROM assemblies WHERE composite_item_id = $1 LIMIT 1', [itemId]);
  return rows.length > 0;
}

r.post('/:id/status', can('items', 'edit'), async (req, res) => {
  const status = oneOf(req.body?.status, ['active', 'inactive'], { field: 'Status' });
  const { rows } = await query('UPDATE items SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2 RETURNING id, name, status', [req.orgId, Number(req.params.id), status]);
  if (!rows[0]) throw notFound('Item');
  await audit({ query }, req, 'update', 'item', rows[0].id, `Item ${rows[0].name} marked ${status}`);
  res.json(rows[0]);
});

r.post('/:id/opening-stock', can('items', 'edit'), async (req, res) => {
  const itemId = Number(req.params.id);
  await tx(async (client) => {
    const { rows: [item] } = await client.query('SELECT * FROM items WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, itemId]);
    if (!item) throw notFound('Item');
    if (!item.track_inventory || item.is_composite) throw badRequest('Opening stock applies only to tracked, non-composite items');
    const { rows } = await client.query("SELECT 1 FROM stock_movements WHERE item_id = $1 AND source_type <> 'opening_stock' LIMIT 1", [itemId]);
    if (rows.length) throw conflict('This item already has stock transactions. Use an inventory adjustment instead.');
    await addOpeningStock(client, req, item, req.body?.opening_stock, date(req.body?.opening_stock_date, { field: 'Date' }) || today());
    await audit(client, req, 'update', 'item', itemId, `Opening stock added for ${item.name}`);
  });
  res.json({ ok: true });
});

r.post('/:id/image', can('items', 'edit'), imageUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload');
  const { rows: [cur] } = await query('SELECT image_path FROM items WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!cur) { removePublic(req.file.filename); throw notFound('Item'); }
  const p = `/uploads/public/${req.file.filename}`;
  await query('UPDATE items SET image_path = $3 WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id), p]);
  removePublic(cur.image_path);
  res.json({ image_path: p });
});

r.delete('/:id/image', can('items', 'edit'), async (req, res) => {
  const { rows: [cur] } = await query('SELECT image_path FROM items WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!cur) throw notFound('Item');
  await query('UPDATE items SET image_path = NULL WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  removePublic(cur.image_path);
  res.status(204).end();
});

r.delete('/:id', can('items', 'delete'), async (req, res) => {
  const itemId = Number(req.params.id);
  await tx(async (client) => {
    const { rows: [item] } = await client.query('SELECT * FROM items WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, itemId]);
    if (!item) throw notFound('Item');
    if (await isItemUsed(client, itemId)) throw conflict('This item is used in transactions and cannot be deleted. Mark it inactive instead.');
    const { rows } = await client.query("SELECT 1 FROM stock_movements WHERE item_id = $1 AND source_type <> 'opening_stock' LIMIT 1", [itemId]);
    if (rows.length) throw conflict('This item has stock transactions and cannot be deleted. Mark it inactive instead.');
    await client.query('DELETE FROM items WHERE id = $1', [itemId]);
    await client.query("DELETE FROM documents WHERE org_id = $1 AND entity_type = 'item' AND entity_id = $2", [req.orgId, itemId]);
    removePublic(item.image_path);
    await audit(client, req, 'delete', 'item', itemId, `Item ${item.name} deleted`);
  });
  res.status(204).end();
});

// Bulk import. Each row: name, sku, item_type, unit, selling_price, cost_price, ..., opening_stock, opening_stock_rate, warehouse
r.post('/import', can('items', 'import'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) throw badRequest('No rows to import');
  if (rows.length > 5000) throw badRequest('Import at most 5000 rows at a time');
  const errors = [];
  let imported = 0;
  await tx(async (client) => {
    const { rows: whs } = await client.query("SELECT id, name, is_primary FROM warehouses WHERE org_id = $1 AND status = 'active'", [req.orgId]);
    const { rows: taxes } = await client.query('SELECT id, name, rate FROM taxes WHERE org_id = $1', [req.orgId]);
    const primary = whs.find((w) => w.is_primary) || whs[0];
    for (const [i, raw] of rows.entries()) {
      await client.query('SAVEPOINT row_sp');
      try {
        const findTax = (v) => (v ? taxes.find((t) => t.name.toLowerCase() === String(v).toLowerCase() || Number(t.rate) === Number(v))?.id ?? null : null);
        const b = {
          ...raw,
          item_type: (raw.item_type || 'goods').toLowerCase(),
          track_inventory: raw.track_inventory === undefined || raw.track_inventory === '' ? true : bool(String(raw.track_inventory).toLowerCase() === 'yes' ? true : raw.track_inventory),
          returnable: raw.returnable === undefined || raw.returnable === '' ? true : ['yes', 'true', '1'].includes(String(raw.returnable).toLowerCase()),
          sales_tax_id: findTax(raw.sales_tax),
          purchase_tax_id: findTax(raw.purchase_tax),
        };
        const v = await parseItem(b, req);
        const item = await insertItem(client, req, v, { is_composite: false });
        const openQty = Number(raw.opening_stock || 0);
        if (openQty > 0 && item.track_inventory) {
          const wh = raw.warehouse ? whs.find((w) => w.name.toLowerCase() === String(raw.warehouse).toLowerCase()) : primary;
          if (!wh) throw badRequest(`Warehouse "${raw.warehouse}" not found`);
          await stockIn(client, ctxOf(req), {
            itemId: item.id, warehouseId: wh.id, qty: openQty, unitCost: Number(raw.opening_stock_rate || item.cost_price) || 0,
            date: today(), sourceType: 'opening_stock', sourceId: item.id, sourceNumber: 'Opening Stock', note: 'Opening stock (import)',
          });
        }
        await client.query('RELEASE SAVEPOINT row_sp');
        imported += 1;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT row_sp');
        errors.push({ row: i + 2, error: err.code === '23505' ? 'SKU already exists' : err.message });
      }
    }
    await audit(client, req, 'import', 'item', null, `${imported} items imported`);
  });
  res.json({ imported, errors });
});

export default r;
