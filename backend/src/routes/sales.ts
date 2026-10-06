import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, int, id, date, bool, obj, oneOf, today, addDays, listParams, round2, round3 } from '../lib/validate.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { stockIn, stockOut, reverseSource, commit, ctxOf } from '../lib/stock.js';
import { fetchDoc, refreshPayable, refreshCredit } from '../lib/documents.js';
import { trackingFor } from '../lib/tracking.js';
import { createDocRouter } from './docRouter.js';

const EPS = 0.0005;

// ------------------------------------------------------------------ shared helpers
const SO_CFG = { table: 'sales_orders', linesTable: 'sales_order_lines', label: 'Sales Order' };
const INV_CFG = { table: 'invoices', linesTable: 'invoice_lines', label: 'Invoice' };
const CN_CFG = { table: 'credit_notes', linesTable: 'credit_note_lines', label: 'Credit Note' };

/** Close a sales order once everything is shipped and invoiced (and reopen if that changes). */
export async function refreshSalesOrder(client, soId) {
  const { rows: [so] } = await client.query('SELECT status FROM sales_orders WHERE id = $1', [soId]);
  if (!so || !['confirmed', 'closed'].includes(so.status)) return;
  const { rows: [a] } = await client.query(
    `SELECT BOOL_AND(CASE WHEN i.item_type = 'goods' THEN l.qty_shipped + ${EPS} >= l.quantity ELSE TRUE END) AS shipped,
            BOOL_AND(l.qty_invoiced + ${EPS} >= l.quantity) AS invoiced
       FROM sales_order_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.doc_id = $1`,
    [soId],
  );
  const status = a.shipped && a.invoiced ? 'closed' : 'confirmed';
  if (status !== so.status) await client.query('UPDATE sales_orders SET status = $2, updated_at = now() WHERE id = $1', [soId, status]);
}

function addressHeader(b, contact) {
  return {
    billing_address: Object.keys(obj(b.billing_address)).length ? obj(b.billing_address) : contact.billing_address,
    shipping_address: Object.keys(obj(b.shipping_address)).length ? obj(b.shipping_address) : contact.shipping_address,
  };
}

// ================================================================== sales orders
const soStatusSelect = `
  (SELECT CASE WHEN COUNT(*) = 0 THEN NULL WHEN SUM(l.qty_shipped) = 0 THEN 'pending'
               WHEN SUM(l.qty_shipped) + ${EPS} < SUM(l.quantity) THEN 'partially_shipped' ELSE 'shipped' END
     FROM sales_order_lines l JOIN items i ON i.id = l.item_id AND i.item_type = 'goods' WHERE l.doc_id = d.id) AS shipment_status,
  (SELECT CASE WHEN COUNT(*) = 0 THEN NULL WHEN SUM(l.qty_packed) = 0 THEN 'pending'
               WHEN SUM(l.qty_packed) + ${EPS} < SUM(l.quantity) THEN 'partially_packed' ELSE 'packed' END
     FROM sales_order_lines l JOIN items i ON i.id = l.item_id AND i.item_type = 'goods' WHERE l.doc_id = d.id) AS package_status,
  (SELECT CASE WHEN SUM(l.qty_invoiced) = 0 THEN 'not_invoiced'
               WHEN SUM(l.qty_invoiced) + ${EPS} < SUM(l.quantity) THEN 'partially_invoiced' ELSE 'invoiced' END
     FROM sales_order_lines l WHERE l.doc_id = d.id) AS invoice_status`;

export const salesOrders = createDocRouter({
  ...SO_CFG, entity: 'sales_order', module: 'sales_orders', numberType: 'sales_order', contactType: 'customer',
  listExtraSelect: soStatusSelect,
  header: (b, contact) => ({
    expected_shipment_date: date(b.expected_shipment_date, { field: 'Expected shipment date' }),
    payment_terms: int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: contact.payment_terms }),
    delivery_method: str(b.delivery_method, { field: 'Delivery method', max: 100 }),
    salesperson: str(b.salesperson, { field: 'Salesperson', max: 100 }),
    ...addressHeader(b, contact),
  }),
  enrich: async (db, req, doc) => {
    const [{ rows: packages }, { rows: shipments }, { rows: invoices }, { rows: returns }, { rows: [st] }] = await Promise.all([
      db.query('SELECT id, number, package_date, status FROM packages WHERE sales_order_id = $1 ORDER BY id', [doc.id]),
      db.query('SELECT id, number, ship_date, carrier, tracking_number, status, package_id FROM shipments WHERE sales_order_id = $1 ORDER BY id', [doc.id]),
      db.query('SELECT id, number, doc_date, due_date, status, total, balance FROM invoices WHERE sales_order_id = $1 ORDER BY id', [doc.id]),
      db.query('SELECT id, number, return_date, status FROM sales_returns WHERE sales_order_id = $1 ORDER BY id', [doc.id]),
      db.query(`SELECT ${soStatusSelect} FROM sales_orders d WHERE d.id = $1`, [doc.id]),
    ]);
    Object.assign(doc, { packages, shipments, invoices, sales_returns: returns, ...st });
  },
});

salesOrders.post('/:id/confirm', can('sales_orders', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const so = await fetchDoc(client, SO_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (so.status !== 'draft') throw conflict('Only draft sales orders can be confirmed');
    for (const l of so.lines) {
      if (l.item_id && l.track_inventory) await commit(client, ctxOf(req), l.item_id, so.warehouse_id, l.quantity);
    }
    await client.query("UPDATE sales_orders SET status = 'confirmed', updated_at = now() WHERE id = $1", [so.id]);
    await audit(client, req, 'approve', 'sales_order', so.id, `Sales order ${so.number} confirmed`);
    return fetchDoc(client, SO_CFG, req.orgId, so.id);
  });
  res.json(doc);
});

salesOrders.post('/:id/void', can('sales_orders', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const so = await fetchDoc(client, SO_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (so.status !== 'confirmed') throw conflict('Only confirmed sales orders can be voided');
    if (so.lines.some((l) => l.qty_packed > 0 || l.qty_invoiced > 0)) {
      throw conflict('This sales order has packages or invoices. Delete them before voiding.');
    }
    const { rows: inv } = await client.query("SELECT 1 FROM invoices WHERE sales_order_id = $1 AND status <> 'void' LIMIT 1", [so.id]);
    if (inv.length) throw conflict('Delete or void the invoices of this sales order first');
    for (const l of so.lines) {
      if (l.item_id && l.track_inventory) await commit(client, ctxOf(req), l.item_id, so.warehouse_id, -(l.quantity - l.qty_shipped));
    }
    await client.query("UPDATE sales_orders SET status = 'void', updated_at = now() WHERE id = $1", [so.id]);
    await audit(client, req, 'void', 'sales_order', so.id, `Sales order ${so.number} voided`);
    return fetchDoc(client, SO_CFG, req.orgId, so.id);
  });
  res.json(doc);
});

// ================================================================== packages
export const packages = Router();

packages.get('/', can('packages', 'view'), async (req, res) => {
  const p = listParams(req.query, { number: 'd.number', date: 'd.package_date', created: 'd.created_at', contact: 'c.display_name' }, 'created');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`d.status = $${params.length}`); }
  if (req.query.sales_order_id) { params.push(Number(req.query.sales_order_id)); where.push(`d.sales_order_id = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`(d.number ILIKE $${params.length} OR so.number ILIKE $${params.length} OR c.display_name ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const joins = 'JOIN sales_orders so ON so.id = d.sales_order_id JOIN contacts c ON c.id = d.contact_id LEFT JOIN shipments sh ON sh.package_id = d.id';
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(`SELECT d.*, so.number AS sales_order_number, c.display_name AS contact_name, sh.id AS shipment_id, sh.number AS shipment_number,
                  sh.carrier, sh.tracking_number, sh.ship_date, sh.status AS shipment_status,
                  (SELECT SUM(quantity) FROM package_lines WHERE package_id = d.id) AS total_quantity
             FROM packages d ${joins} WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM packages d ${joins} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

packages.get('/next-number', can('packages', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'package') });
});

export async function fetchPackage(db: any, orgId: any, pkgId: any, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, so.number AS sales_order_number, so.warehouse_id, so.shipping_address, c.display_name AS contact_name,
            w.name AS warehouse_name
       FROM packages d JOIN sales_orders so ON so.id = d.sales_order_id JOIN contacts c ON c.id = d.contact_id
       JOIN warehouses w ON w.id = so.warehouse_id
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, pkgId],
  );
  if (!rows[0]) throw notFound('Package');
  const [{ rows: lines }, { rows: [shipment] }] = await Promise.all([
    db.query(
      `SELECT pl.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.track_inventory, i.tracking AS item_tracking, sol.quantity AS ordered
         FROM package_lines pl JOIN items i ON i.id = pl.item_id JOIN sales_order_lines sol ON sol.id = pl.so_line_id
        WHERE pl.package_id = $1 ORDER BY sol.position`,
      [pkgId],
    ),
    db.query('SELECT * FROM shipments WHERE package_id = $1', [pkgId]),
  ]);
  const shipped = shipment ? await trackingFor(db, orgId, 'shipment', shipment.id) : {};
  for (const l of lines) l.units = shipped[l.item_id] || (l.tracking?.serials || l.tracking?.batches?.map((b) => `${b.batch_no} × ${b.quantity}`) || []);
  return { ...rows[0], lines, shipment: shipment || null };
}

packages.get('/:id', can('packages', 'view'), async (req, res) => {
  res.json(await fetchPackage({ query }, req.orgId, Number(req.params.id)));
});

packages.post('/', can('packages', 'create'), async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (client) => {
    const so = await fetchDoc(client, SO_CFG, req.orgId, id(b.sales_order_id, { field: 'Sales order', required: true }), { lock: true });
    if (so.status !== 'confirmed') throw conflict('Packages can only be created for confirmed sales orders');
    if (!Array.isArray(b.lines)) throw badRequest('Add items to the package');
    const lines = [];
    for (const l of b.lines) {
      const qty = round3(num(l.quantity, { field: 'Quantity', min: 0, def: 0 }));
      if (!qty) continue;
      const sol = so.lines.find((x) => x.id === Number(l.so_line_id));
      if (!sol) throw badRequest('Package line does not belong to this sales order');
      if (!sol.item_id || sol.item_type !== 'goods') throw badRequest(`${sol.description || 'This line'} is not a physical item and cannot be packed`);
      if (qty > sol.quantity - sol.qty_packed + EPS) throw badRequest(`Only ${round3(sol.quantity - sol.qty_packed)} of ${sol.item_name} is left to pack`);
      lines.push({ sol, qty, tracking: l.tracking || null });
    }
    if (!lines.length) throw badRequest('Enter a quantity to pack for at least one item');
    const number = await takeNumber(client, req.orgId, 'package', b.number);
    const { rows: [pkg] } = await client.query(
      `INSERT INTO packages (org_id, number, sales_order_id, contact_id, package_date, length_cm, width_cm, height_cm, weight_kg, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [req.orgId, number, so.id, so.contact_id, date(b.package_date, { field: 'Package date' }) || today(),
        num(b.length_cm, { field: 'Length', min: 0 }), num(b.width_cm, { field: 'Width', min: 0 }), num(b.height_cm, { field: 'Height', min: 0 }),
        num(b.weight_kg, { field: 'Weight', min: 0 }), str(b.notes, { field: 'Notes', max: 2000 }), req.user.id],
    );
    for (const { sol, qty, tracking } of lines) {
      await client.query('INSERT INTO package_lines (package_id, so_line_id, item_id, quantity, tracking) VALUES ($1,$2,$3,$4,$5)', [pkg.id, sol.id, sol.item_id, qty, tracking ? JSON.stringify(tracking) : null]);
      await client.query('UPDATE sales_order_lines SET qty_packed = qty_packed + $2 WHERE id = $1', [sol.id, qty]);
    }
    await audit(client, req, 'create', 'package', pkg.id, `Package ${number} created for ${so.number}`);
    return fetchPackage(client, req.orgId, pkg.id);
  });
  res.status(201).json(result);
});

packages.delete('/:id', can('packages', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const pkg = await fetchPackage(client, req.orgId, Number(req.params.id), true);
    if (pkg.shipment) throw conflict('Delete the shipment of this package first');
    for (const l of pkg.lines) await client.query('UPDATE sales_order_lines SET qty_packed = qty_packed - $2 WHERE id = $1', [l.so_line_id, l.quantity]);
    await client.query('DELETE FROM packages WHERE id = $1', [pkg.id]);
    await audit(client, req, 'delete', 'package', pkg.id, `Package ${pkg.number} deleted`);
  });
  res.status(204).end();
});

// Ship a package: creates the shipment and removes stock.
packages.post('/:id/ship', can('packages', 'create'), async (req, res) => {
  const result = await tx(async (client) => {
    await shipPackage(client, req, Number(req.params.id), req.body || {});
    return fetchPackage(client, req.orgId, Number(req.params.id));
  });
  res.status(201).json(result);
});

/** Create the shipment for a package and take the stock out. `extra` may hold provider, external_id, label_url. */
export async function shipPackage(client: any, req: any, pkgId: any, b: any, extra: any = {}) {
  {
    const pkg = await fetchPackage(client, req.orgId, pkgId, true);
    if (pkg.shipment) throw conflict('This package has already been shipped');
    const shipDate = date(b.ship_date, { field: 'Shipment date' }) || today();
    if (shipDate < pkg.package_date) throw badRequest('Shipment date cannot be before the package date');
    const delivered = bool(b.delivered);
    const number = await takeNumber(client, req.orgId, 'shipment', b.number);
    const { rows: [sh] } = await client.query(
      `INSERT INTO shipments (org_id, number, package_id, sales_order_id, contact_id, ship_date, carrier, service_type, tracking_number,
                              shipping_cost, estimated_delivery, delivered_date, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [req.orgId, number, pkg.id, pkg.sales_order_id, pkg.contact_id, shipDate, str(b.carrier, { field: 'Carrier', max: 100 }),
        str(b.service_type, { field: 'Service', max: 100 }), str(b.tracking_number, { field: 'Tracking number', max: 100 }),
        num(b.shipping_cost, { field: 'Shipping cost', min: 0, def: 0 }), date(b.estimated_delivery, { field: 'Estimated delivery' }),
        delivered ? (date(b.delivered_date, { field: 'Delivered date' }) || shipDate) : null,
        delivered ? 'delivered' : 'shipped', str(b.notes, { field: 'Notes', max: 2000 }), req.user?.id ?? null],
    );
    const ctx = ctxOf(req);
    for (const l of pkg.lines) {
      if (l.track_inventory) {
        await stockOut(client, ctx, {
          itemId: l.item_id, warehouseId: pkg.warehouse_id, qty: l.quantity, date: shipDate, tracking: l.tracking,
          sourceType: 'shipment', sourceId: sh.id, sourceNumber: number, note: `Shipped to ${pkg.contact_name} (${pkg.sales_order_number})`,
        });
        await commit(client, ctx, l.item_id, pkg.warehouse_id, -l.quantity);
      }
      await client.query('UPDATE sales_order_lines SET qty_shipped = qty_shipped + $2 WHERE id = $1', [l.so_line_id, l.quantity]);
    }
    await client.query('UPDATE packages SET status = $2 WHERE id = $1', [pkg.id, delivered ? 'delivered' : 'shipped']);
    await refreshSalesOrder(client, pkg.sales_order_id);
    if (extra.provider) {
      await client.query('UPDATE shipments SET provider = $2, external_id = $3, label_url = $4 WHERE id = $1', [sh.id, extra.provider, extra.external_id || null, extra.label_url || null]);
    }
    await audit(client, req, 'create', 'shipment', sh.id, `Shipment ${number} created for package ${pkg.number}`);
    return { id: sh.id, number };
  }
}

// ================================================================== shipments
export const shipments = Router();

shipments.get('/', can('packages', 'view'), async (req, res) => {
  const p = listParams(req.query, { number: 'd.number', date: 'd.ship_date', created: 'd.created_at', status: 'd.status' }, 'created');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`d.status = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`(d.number ILIKE $${params.length} OR d.tracking_number ILIKE $${params.length} OR c.display_name ILIKE $${params.length} OR so.number ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const joins = 'JOIN contacts c ON c.id = d.contact_id JOIN sales_orders so ON so.id = d.sales_order_id JOIN packages pk ON pk.id = d.package_id';
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(`SELECT d.*, c.display_name AS contact_name, so.number AS sales_order_number, pk.number AS package_number
             FROM shipments d ${joins} WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM shipments d ${joins} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

shipments.get('/:id', can('packages', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, c.display_name AS contact_name, so.number AS sales_order_number, pk.number AS package_number,
            sc.tracking_url
       FROM shipments d JOIN contacts c ON c.id = d.contact_id JOIN sales_orders so ON so.id = d.sales_order_id
       JOIN packages pk ON pk.id = d.package_id
       LEFT JOIN shipping_carriers sc ON sc.org_id = d.org_id AND sc.name = d.carrier
      WHERE d.org_id = $1 AND d.id = $2`,
    [req.orgId, Number(req.params.id)],
  );
  if (!rows[0]) throw notFound('Shipment');
  const pkg = await fetchPackage({ query }, req.orgId, rows[0].package_id);
  res.json({ ...rows[0], lines: pkg.lines, shipping_address: pkg.shipping_address });
});

shipments.put('/:id', can('packages', 'edit'), async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (client) => {
    const { rows: [sh] } = await client.query('SELECT * FROM shipments WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(req.params.id)]);
    if (!sh) throw notFound('Shipment');
    const status = oneOf(b.status, ['shipped', 'in_transit', 'delivered', 'returned', 'failed'], { field: 'Status', def: sh.status });
    const deliveredDate = status === 'delivered' ? (date(b.delivered_date, { field: 'Delivered date' }) || sh.delivered_date || today()) : null;
    const { rows: [updated] } = await client.query(
      `UPDATE shipments SET carrier = $2, service_type = $3, tracking_number = $4, shipping_cost = $5, estimated_delivery = $6,
              status = $7, delivered_date = $8, notes = $9 WHERE id = $1 RETURNING *`,
      [sh.id, str(b.carrier, { field: 'Carrier', max: 100 }), str(b.service_type, { field: 'Service', max: 100 }),
        str(b.tracking_number, { field: 'Tracking number', max: 100 }), num(b.shipping_cost, { field: 'Shipping cost', min: 0, def: 0 }),
        date(b.estimated_delivery, { field: 'Estimated delivery' }), status, deliveredDate, str(b.notes, { field: 'Notes', max: 2000 })],
    );
    await client.query('UPDATE packages SET status = $2 WHERE id = $1', [sh.package_id, status === 'delivered' ? 'delivered' : 'shipped']);
    if (status !== sh.status) await audit(client, req, 'update', 'shipment', sh.id, `Shipment ${sh.number} marked ${status.replace('_', ' ')}`);
    return updated;
  });
  res.json(result);
});

shipments.delete('/:id', can('packages', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const { rows: [sh] } = await client.query('SELECT * FROM shipments WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(req.params.id)]);
    if (!sh) throw notFound('Shipment');
    const pkg = await fetchPackage(client, req.orgId, sh.package_id, true);
    const { rows: ret } = await client.query('SELECT 1 FROM sales_returns WHERE sales_order_id = $1 LIMIT 1', [sh.sales_order_id]);
    if (ret.length) throw conflict('This sales order has sales returns. Delete them before deleting shipments.');
    await reverseSource(client, ctxOf(req), 'shipment', sh.id);
    const { rows: [so] } = await client.query('SELECT status FROM sales_orders WHERE id = $1', [sh.sales_order_id]);
    for (const l of pkg.lines) {
      if (l.track_inventory && so.status !== 'void') await commit(client, ctxOf(req), l.item_id, pkg.warehouse_id, l.quantity);
      await client.query('UPDATE sales_order_lines SET qty_shipped = qty_shipped - $2 WHERE id = $1', [l.so_line_id, l.quantity]);
    }
    await client.query('DELETE FROM shipments WHERE id = $1', [sh.id]);
    await client.query("UPDATE packages SET status = 'not_shipped' WHERE id = $1", [sh.package_id]);
    await refreshSalesOrder(client, sh.sales_order_id);
    await audit(client, req, 'delete', 'shipment', sh.id, `Shipment ${sh.number} deleted and stock restored`);
  });
  res.status(204).end();
});

// ================================================================== invoices
export const invoices = createDocRouter({
  ...INV_CFG, entity: 'invoice', module: 'invoices', numberType: 'invoice', contactType: 'customer',
  hasBalance: true, lineExtra: ['so_line_id', 'tracking'], filterCols: ['sales_order_id', 'delivery_challan_id'],
  listExtraSelect: `CASE WHEN d.status IN ('sent','partially_paid') AND d.due_date < CURRENT_DATE THEN 'overdue' ELSE d.status END AS display_status`,
  header: (b, contact) => {
    const docDate = date(b.doc_date, { field: 'Invoice date' }) || today();
    const terms = int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: contact.payment_terms });
    return {
      sales_order_id: id(b.sales_order_id, { field: 'Sales order' }),
      delivery_challan_id: id(b.delivery_challan_id, { field: 'Delivery challan' }),
      payment_terms: terms,
      due_date: date(b.due_date, { field: 'Due date' }) || addDays(docDate, terms),
      salesperson: str(b.salesperson, { field: 'Salesperson', max: 100 }),
      ...addressHeader(b, contact),
    };
  },
  validate: async (client, req, { header, lines }) => {
    if (header.due_date < header.doc_date) throw badRequest('Due date cannot be before the invoice date');
    if (header.sales_order_id) {
      const so = await fetchDoc(client, SO_CFG, req.orgId, header.sales_order_id);
      if (so.contact_id !== header.contact_id) throw badRequest('The sales order belongs to a different customer');
      if (!['confirmed', 'closed'].includes(so.status)) throw badRequest('The sales order must be confirmed before invoicing');
      header.warehouse_id = so.warehouse_id;
      for (const l of lines) {
        if (l.so_line_id && !so.lines.some((s) => s.id === Number(l.so_line_id))) throw badRequest('Invoice line does not belong to the sales order');
      }
    } else {
      for (const l of lines) l.so_line_id = null;
    }
    if (header.delivery_challan_id) {
      if (header.sales_order_id) throw badRequest('An invoice can be linked to a sales order or a delivery challan, not both');
      const { rows: [dc] } = await client.query('SELECT contact_id, status, warehouse_id FROM delivery_challans WHERE org_id = $1 AND id = $2', [req.orgId, header.delivery_challan_id]);
      if (!dc || dc.contact_id !== header.contact_id) throw badRequest('The delivery challan belongs to a different customer');
      if (!['open', 'delivered'].includes(dc.status)) throw badRequest('Only open or delivered challans can be invoiced');
      header.warehouse_id = dc.warehouse_id;
    }
  },
  enrich: async (db, req, doc) => {
    const [{ rows: payments }, { rows: credits }, { rows: [so] }] = await Promise.all([
      db.query(`SELECT a.id, a.amount, p.id AS payment_id, p.number, p.payment_date, p.mode, p.reference
                  FROM payment_received_allocations a JOIN payments_received p ON p.id = a.payment_id WHERE a.invoice_id = $1 ORDER BY p.payment_date`, [doc.id]),
      db.query(`SELECT a.id, a.amount, a.applied_date, cn.id AS credit_note_id, cn.number
                  FROM credit_applications a JOIN credit_notes cn ON cn.id = a.credit_note_id WHERE a.invoice_id = $1 ORDER BY a.id`, [doc.id]),
      db.query('SELECT id, number FROM sales_orders WHERE id = $1', [doc.sales_order_id]),
    ]);
    doc.payments = payments;
    doc.credits = credits;
    doc.sales_order_number = so?.number || null;
    doc.display_status = ['sent', 'partially_paid'].includes(doc.status) && doc.due_date < today() ? 'overdue' : doc.status;
    const [{ rows: [dc] }, units] = await Promise.all([
      db.query('SELECT number FROM delivery_challans WHERE id = $1', [doc.delivery_challan_id]),
      trackingFor(db, req.orgId, 'invoice', doc.id),
    ]);
    doc.delivery_challan_number = dc?.number || null;
    for (const l of doc.lines) l.units = units[l.item_id] || [];
  },
});

invoices.post('/:id/send', can('invoices', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const inv = await fetchDoc(client, INV_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (inv.status !== 'draft') throw conflict('Only draft invoices can be marked as sent');
    const ctx = ctxOf(req);
    if (inv.sales_order_id) {
      for (const l of inv.lines) {
        if (!l.so_line_id) continue;
        const { rows: [sol] } = await client.query('SELECT quantity, qty_invoiced FROM sales_order_lines WHERE id = $1 FOR UPDATE', [l.so_line_id]);
        if (l.quantity > sol.quantity - sol.qty_invoiced + EPS) {
          throw conflict(`${l.item_name || l.description}: only ${round3(sol.quantity - sol.qty_invoiced)} left to invoice on the sales order`);
        }
        await client.query('UPDATE sales_order_lines SET qty_invoiced = qty_invoiced + $2 WHERE id = $1', [l.so_line_id, l.quantity]);
      }
    } else if (inv.delivery_challan_id) {
      // Goods already left stock with the delivery challan.
      await client.query(`UPDATE delivery_challans SET status = 'invoiced', invoice_id = $2, updated_at = now() WHERE id = $1`, [inv.delivery_challan_id, inv.id]);
    } else {
      // Direct invoice (no sales order): goods leave stock when the invoice is issued.
      for (const l of inv.lines) {
        if (l.item_id && l.track_inventory) {
          await stockOut(client, ctx, {
            itemId: l.item_id, warehouseId: inv.warehouse_id, qty: l.quantity, date: inv.doc_date, tracking: l.tracking,
            sourceType: 'invoice', sourceId: inv.id, sourceNumber: inv.number, note: `Invoiced to ${inv.contact_name}`,
          });
        }
      }
    }
    await client.query("UPDATE invoices SET status = 'sent', balance = total, updated_at = now() WHERE id = $1", [inv.id]);
    await refreshPayable(client, 'invoice', inv.id);
    if (inv.sales_order_id) await refreshSalesOrder(client, inv.sales_order_id);
    await audit(client, req, 'approve', 'invoice', inv.id, `Invoice ${inv.number} marked as sent`);
    return fetchDoc(client, INV_CFG, req.orgId, inv.id);
  });
  res.json(doc);
});

invoices.post('/:id/void', can('invoices', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const inv = await fetchDoc(client, INV_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (['draft', 'void'].includes(inv.status)) throw conflict('Only issued invoices can be voided');
    if (inv.amount_paid > 0 || inv.credits_applied > 0) throw conflict('Remove the payments and credits applied to this invoice first');
    await reverseSource(client, ctxOf(req), 'invoice', inv.id);
    for (const l of inv.lines) {
      if (l.so_line_id) await client.query('UPDATE sales_order_lines SET qty_invoiced = qty_invoiced - $2 WHERE id = $1', [l.so_line_id, l.quantity]);
    }
    await client.query("UPDATE invoices SET status = 'void', balance = 0, updated_at = now() WHERE id = $1", [inv.id]);
    if (inv.delivery_challan_id) await client.query(`UPDATE delivery_challans SET status = 'delivered', invoice_id = NULL WHERE id = $1 AND invoice_id = $2`, [inv.delivery_challan_id, inv.id]);
    if (inv.sales_order_id) await refreshSalesOrder(client, inv.sales_order_id);
    await audit(client, req, 'void', 'invoice', inv.id, `Invoice ${inv.number} voided`);
    return fetchDoc(client, INV_CFG, req.orgId, inv.id);
  });
  res.json(doc);
});

// ================================================================== sales returns
/** Serial numbers / batches that were shipped on a sales order and can come back (used when none are specified). */
async function shippedUnits(client, orgId, soId, itemId, qty) {
  const { rows: [it] } = await client.query('SELECT tracking FROM items WHERE id = $1', [itemId]);
  if (!it || it.tracking === 'none') return null;
  const { rows } = await client.query(
    `SELECT s.serial, s.status, b.batch_no, b.mfg_date, b.expiry_date, -e.quantity AS quantity
       FROM tracking_entries e JOIN shipments sh ON sh.id = e.source_id
       LEFT JOIN serial_numbers s ON s.id = e.serial_id LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.org_id = $1 AND e.source_type = 'shipment' AND sh.sales_order_id = $2 AND e.item_id = $3 AND e.quantity < 0
      ORDER BY e.id`,
    [orgId, soId, itemId],
  );
  if (it.tracking === 'serial') return { serials: rows.filter((r) => r.status === 'out').slice(0, Math.round(qty)).map((r) => r.serial) };
  let left = Number(qty);
  const batches = [];
  for (const r of rows) {
    if (left <= 0) break;
    const q = Math.min(left, Number(r.quantity));
    batches.push({ batch_no: r.batch_no, quantity: q, mfg_date: r.mfg_date, expiry_date: r.expiry_date });
    left -= q;
  }
  return { batches };
}

export const salesReturns = Router();

salesReturns.get('/', can('sales_returns', 'view'), async (req, res) => {
  const p = listParams(req.query, { number: 'd.number', date: 'd.return_date', created: 'd.created_at' }, 'created');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`d.status = $${params.length}`); }
  if (req.query.sales_order_id) { params.push(Number(req.query.sales_order_id)); where.push(`d.sales_order_id = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`(d.number ILIKE $${params.length} OR so.number ILIKE $${params.length} OR c.display_name ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const joins = 'JOIN sales_orders so ON so.id = d.sales_order_id JOIN contacts c ON c.id = d.contact_id';
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(`SELECT d.*, so.number AS sales_order_number, c.display_name AS contact_name,
                  (SELECT SUM(quantity) FROM sales_return_lines WHERE sales_return_id = d.id) AS total_quantity
             FROM sales_returns d ${joins} WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM sales_returns d ${joins} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

async function fetchReturn(db, orgId, rId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, so.number AS sales_order_number, c.display_name AS contact_name, w.name AS warehouse_name
       FROM sales_returns d JOIN sales_orders so ON so.id = d.sales_order_id JOIN contacts c ON c.id = d.contact_id
       JOIN warehouses w ON w.id = d.warehouse_id WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, rId],
  );
  if (!rows[0]) throw notFound('Sales return');
  const [{ rows: lines }, { rows: creditNotes }] = await Promise.all([
    db.query(
      `SELECT rl.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.track_inventory, sol.rate, sol.tax_id, sol.discount_percent
         FROM sales_return_lines rl JOIN items i ON i.id = rl.item_id JOIN sales_order_lines sol ON sol.id = rl.so_line_id
        WHERE rl.sales_return_id = $1 ORDER BY sol.position`,
      [rId],
    ),
    db.query("SELECT id, number, status, total FROM credit_notes WHERE sales_return_id = $1 AND status <> 'void'", [rId]),
  ]);
  return { ...rows[0], lines, credit_notes: creditNotes };
}

salesReturns.get('/next-number', can('sales_returns', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'sales_return') });
});

salesReturns.get('/:id', can('sales_returns', 'view'), async (req, res) => {
  res.json(await fetchReturn({ query }, req.orgId, Number(req.params.id)));
});

salesReturns.post('/', can('sales_returns', 'create'), async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (client) => {
    const so = await fetchDoc(client, SO_CFG, req.orgId, id(b.sales_order_id, { field: 'Sales order', required: true }), { lock: true });
    if (!['confirmed', 'closed'].includes(so.status)) throw conflict('Returns can only be created for confirmed sales orders');
    const lines = [];
    for (const l of Array.isArray(b.lines) ? b.lines : []) {
      const qty = round3(num(l.quantity, { field: 'Quantity', min: 0, def: 0 }));
      if (!qty) continue;
      const sol = so.lines.find((x) => x.id === Number(l.so_line_id));
      if (!sol || !sol.item_id) throw badRequest('Return line does not belong to this sales order');
      const returnable = sol.qty_shipped - sol.qty_returned;
      if (qty > returnable + EPS) throw badRequest(`Only ${round3(returnable)} of ${sol.item_name} has been shipped and not yet returned`);
      lines.push({ sol, qty, restock: bool(l.restock, true), tracking: l.tracking || null });
    }
    if (!lines.length) throw badRequest('Enter a return quantity for at least one shipped item');
    const whId = id(b.warehouse_id, { field: 'Warehouse' }) || so.warehouse_id;
    const number = await takeNumber(client, req.orgId, 'sales_return', b.number);
    const { rows: [ret] } = await client.query(
      `INSERT INTO sales_returns (org_id, number, sales_order_id, contact_id, return_date, warehouse_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.orgId, number, so.id, so.contact_id, date(b.return_date, { field: 'Return date' }) || today(), whId,
        str(b.reason, { field: 'Reason', max: 500 }), req.user.id],
    );
    for (const { sol, qty, restock, tracking } of lines) {
      await client.query('INSERT INTO sales_return_lines (sales_return_id, so_line_id, item_id, quantity, restock, tracking) VALUES ($1,$2,$3,$4,$5,$6)', [ret.id, sol.id, sol.item_id, qty, restock, tracking ? JSON.stringify(tracking) : null]);
      await client.query('UPDATE sales_order_lines SET qty_returned = qty_returned + $2 WHERE id = $1', [sol.id, qty]);
    }
    await audit(client, req, 'create', 'sales_return', ret.id, `Sales return ${number} created for ${so.number}`);
    return fetchReturn(client, req.orgId, ret.id);
  });
  res.status(201).json(result);
});

// Receive returned goods back into stock (at the cost they were shipped at).
salesReturns.post('/:id/receive', can('sales_returns', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const ret = await fetchReturn(client, req.orgId, Number(req.params.id), true);
    if (ret.status !== 'approved') throw conflict('This return has already been received');
    const receivedDate = date(req.body?.received_date, { field: 'Received date' }) || today();
    for (const l of ret.lines) {
      if (!l.restock || !l.track_inventory) continue;
      const { rows: [c] } = await client.query(
        `SELECT SUM(-m.value) AS v, SUM(-m.quantity) AS q FROM stock_movements m JOIN shipments s ON s.id = m.source_id
          WHERE m.source_type = 'shipment' AND s.sales_order_id = $1 AND m.item_id = $2`,
        [ret.sales_order_id, l.item_id],
      );
      const { rows: [it] } = await client.query('SELECT cost_price FROM items WHERE id = $1', [l.item_id]);
      const unitCost = Number(c.q) > 0 ? Number(c.v) / Number(c.q) : Number(it.cost_price);
      const tracking = l.tracking || await shippedUnits(client, req.orgId, ret.sales_order_id, l.item_id, l.quantity);
      await stockIn(client, ctxOf(req), {
        itemId: l.item_id, warehouseId: ret.warehouse_id, qty: l.quantity, unitCost, date: receivedDate, tracking,
        sourceType: 'sales_return', sourceId: ret.id, sourceNumber: ret.number, note: `Returned by ${ret.contact_name}`,
      });
    }
    const newStatus = ret.credit_notes.length ? 'credited' : 'received';
    await client.query('UPDATE sales_returns SET status = $2, received_date = $3 WHERE id = $1', [ret.id, newStatus, receivedDate]);
    await audit(client, req, 'update', 'sales_return', ret.id, `Sales return ${ret.number} received`);
    return fetchReturn(client, req.orgId, ret.id);
  });
  res.json(result);
});

salesReturns.delete('/:id', can('sales_returns', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const ret = await fetchReturn(client, req.orgId, Number(req.params.id), true);
    if (ret.credit_notes.length) throw conflict('Void or delete the credit note created for this return first');
    await reverseSource(client, ctxOf(req), 'sales_return', ret.id);
    for (const l of ret.lines) await client.query('UPDATE sales_order_lines SET qty_returned = qty_returned - $2 WHERE id = $1', [l.so_line_id, l.quantity]);
    await client.query('DELETE FROM sales_returns WHERE id = $1', [ret.id]);
    await audit(client, req, 'delete', 'sales_return', ret.id, `Sales return ${ret.number} deleted`);
  });
  res.status(204).end();
});

// ================================================================== credit notes
export const creditNotes = createDocRouter({
  ...CN_CFG, entity: 'credit_note', module: 'sales_returns', numberType: 'credit_note', contactType: 'customer',
  hasCreditBalance: true, filterCols: ['invoice_id', 'sales_return_id'],
  header: (b) => ({
    invoice_id: id(b.invoice_id, { field: 'Invoice' }),
    sales_return_id: id(b.sales_return_id, { field: 'Sales return' }),
  }),
  validate: async (client, req, { header }) => {
    if (header.invoice_id) {
      const { rows } = await client.query('SELECT contact_id FROM invoices WHERE org_id = $1 AND id = $2', [req.orgId, header.invoice_id]);
      if (!rows[0] || rows[0].contact_id !== header.contact_id) throw badRequest('The invoice belongs to a different customer');
    }
    if (header.sales_return_id) {
      const { rows } = await client.query('SELECT contact_id FROM sales_returns WHERE org_id = $1 AND id = $2', [req.orgId, header.sales_return_id]);
      if (!rows[0] || rows[0].contact_id !== header.contact_id) throw badRequest('The sales return belongs to a different customer');
    }
  },
  enrich: async (db, req, doc) => {
    const [{ rows: apps }, { rows: refunds }, { rows: [links] }] = await Promise.all([
      db.query(`SELECT a.*, i.number AS invoice_number FROM credit_applications a JOIN invoices i ON i.id = a.invoice_id WHERE a.credit_note_id = $1 ORDER BY a.id`, [doc.id]),
      db.query('SELECT * FROM credit_refunds WHERE credit_note_id = $1 ORDER BY refund_date', [doc.id]),
      db.query(`SELECT (SELECT number FROM invoices WHERE id = $1) AS invoice_number, (SELECT number FROM sales_returns WHERE id = $2) AS sales_return_number`,
        [doc.invoice_id, doc.sales_return_id]),
    ]);
    Object.assign(doc, { applications: apps, refunds, ...links });
  },
});

creditNotes.post('/:id/open', can('sales_returns', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (cn.status !== 'draft') throw conflict('Only draft credit notes can be opened');
    await client.query("UPDATE credit_notes SET status = 'open', balance = total, updated_at = now() WHERE id = $1", [cn.id]);
    if (cn.sales_return_id) await client.query("UPDATE sales_returns SET status = 'credited' WHERE id = $1 AND status = 'received'", [cn.sales_return_id]);
    await refreshCredit(client, 'credit_note', cn.id);
    await audit(client, req, 'approve', 'credit_note', cn.id, `Credit note ${cn.number} opened`);
    return fetchDoc(client, CN_CFG, req.orgId, cn.id);
  });
  res.json(doc);
});

creditNotes.post('/:id/apply', can('sales_returns', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (cn.status !== 'open') throw conflict('Only open credit notes can be applied');
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    let total = 0;
    for (const a of allocations) {
      const amount = round2(num(a.amount, { field: 'Amount', min: 0, def: 0 }));
      if (!amount) continue;
      const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(a.invoice_id)]);
      if (!inv || inv.contact_id !== cn.contact_id) throw badRequest('Invoice not found for this customer');
      if (!['sent', 'partially_paid'].includes(inv.status)) throw badRequest(`Invoice ${inv.number} is not open`);
      if (amount > inv.balance + 0.004) throw badRequest(`Amount exceeds the balance of invoice ${inv.number}`);
      await client.query('INSERT INTO credit_applications (credit_note_id, invoice_id, amount, applied_date) VALUES ($1,$2,$3,$4)', [cn.id, inv.id, amount, today()]);
      await refreshPayable(client, 'invoice', inv.id);
      total += amount;
    }
    if (!total) throw badRequest('Enter an amount to apply');
    if (total > cn.balance + 0.004) throw badRequest('Total exceeds the credit available');
    await refreshCredit(client, 'credit_note', cn.id);
    await audit(client, req, 'update', 'credit_note', cn.id, `Credit note ${cn.number}: ${total} applied to invoices`);
    return fetchDoc(client, CN_CFG, req.orgId, cn.id);
  });
  res.json(doc);
});

creditNotes.delete('/:id/applications/:appId', can('sales_returns', 'edit'), async (req, res) => {
  await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    const { rows: [app] } = await client.query('DELETE FROM credit_applications WHERE id = $1 AND credit_note_id = $2 RETURNING invoice_id', [Number(req.params.appId), cn.id]);
    if (!app) throw notFound('Credit application');
    await refreshPayable(client, 'invoice', app.invoice_id);
    await refreshCredit(client, 'credit_note', cn.id);
    await audit(client, req, 'update', 'credit_note', cn.id, `Credit application removed from ${cn.number}`);
  });
  res.status(204).end();
});

creditNotes.post('/:id/refund', can('sales_returns', 'edit'), async (req, res) => {
  const b = req.body || {};
  const doc = await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (cn.status !== 'open') throw conflict('Only open credit notes can be refunded');
    const amount = round2(num(b.amount, { field: 'Amount', required: true, min: 0.01 }));
    if (amount > cn.balance + 0.004) throw badRequest('Refund exceeds the credit available');
    await client.query('INSERT INTO credit_refunds (credit_note_id, refund_date, amount, mode, reference) VALUES ($1,$2,$3,$4,$5)',
      [cn.id, date(b.refund_date, { field: 'Refund date' }) || today(), amount, str(b.mode, { field: 'Mode', max: 30 }) || 'cash', str(b.reference, { field: 'Reference', max: 100 })]);
    await refreshCredit(client, 'credit_note', cn.id);
    await audit(client, req, 'update', 'credit_note', cn.id, `Refund of ${amount} recorded on ${cn.number}`);
    return fetchDoc(client, CN_CFG, req.orgId, cn.id);
  });
  res.json(doc);
});

creditNotes.delete('/:id/refunds/:refundId', can('sales_returns', 'edit'), async (req, res) => {
  await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    const { rowCount } = await client.query('DELETE FROM credit_refunds WHERE id = $1 AND credit_note_id = $2', [Number(req.params.refundId), cn.id]);
    if (!rowCount) throw notFound('Refund');
    await refreshCredit(client, 'credit_note', cn.id);
  });
  res.status(204).end();
});

creditNotes.post('/:id/void', can('sales_returns', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const cn = await fetchDoc(client, CN_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (!['open', 'closed'].includes(cn.status)) throw conflict('Only open credit notes can be voided');
    const { rows } = await client.query(
      'SELECT 1 FROM credit_applications WHERE credit_note_id = $1 UNION ALL SELECT 1 FROM credit_refunds WHERE credit_note_id = $1 LIMIT 1', [cn.id]);
    if (rows.length) throw conflict('Remove the applied credits and refunds first');
    await client.query("UPDATE credit_notes SET status = 'void', balance = 0, updated_at = now() WHERE id = $1", [cn.id]);
    if (cn.sales_return_id) await client.query("UPDATE sales_returns SET status = CASE WHEN received_date IS NULL THEN 'approved' ELSE 'received' END WHERE id = $1", [cn.sales_return_id]);
    await audit(client, req, 'void', 'credit_note', cn.id, `Credit note ${cn.number} voided`);
    return fetchDoc(client, CN_CFG, req.orgId, cn.id);
  });
  res.json(doc);
});
