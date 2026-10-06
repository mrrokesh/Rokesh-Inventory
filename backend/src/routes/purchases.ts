import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, int, id, date, bool, today, addDays, listParams, round2, round3 } from '../lib/validate.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { stockIn, stockOut, reverseSource, ctxOf } from '../lib/stock.js';
import { fetchDoc, refreshPayable, refreshCredit } from '../lib/documents.js';
import { trackingFor } from '../lib/tracking.js';
import { createDocRouter } from './docRouter.js';

const EPS = 0.0005;
const PO_CFG = { table: 'purchase_orders', linesTable: 'purchase_order_lines', label: 'Purchase Order' };
const BILL_CFG = { table: 'bills', linesTable: 'bill_lines', label: 'Bill' };
const VC_CFG = { table: 'vendor_credits', linesTable: 'vendor_credit_lines', label: 'Vendor Credit' };

/** Unit cost of a line after line and document discounts (tax excluded). */
const effectiveRate = (line, docDiscount) => (line.quantity ? (line.amount / line.quantity) * (1 - (Number(docDiscount) || 0) / 100) : 0);

export async function refreshPurchaseOrder(client, poId) {
  const { rows: [po] } = await client.query('SELECT status FROM purchase_orders WHERE id = $1', [poId]);
  if (!po || !['issued', 'closed'].includes(po.status)) return;
  const { rows: [a] } = await client.query(
    `SELECT BOOL_AND(CASE WHEN i.item_type = 'goods' THEN l.qty_received + ${EPS} >= l.quantity ELSE TRUE END) AS received,
            BOOL_AND(l.qty_billed + ${EPS} >= l.quantity) AS billed
       FROM purchase_order_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.doc_id = $1`,
    [poId],
  );
  const status = a.received && a.billed ? 'closed' : 'issued';
  if (status !== po.status) await client.query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1', [poId, status]);
}

// ================================================================== purchase orders
const poStatusSelect = `
  (SELECT CASE WHEN COUNT(*) = 0 THEN NULL WHEN SUM(l.qty_received) = 0 THEN 'pending'
               WHEN SUM(l.qty_received) + ${EPS} < SUM(l.quantity) THEN 'partially_received' ELSE 'received' END
     FROM purchase_order_lines l JOIN items i ON i.id = l.item_id AND i.item_type = 'goods' WHERE l.doc_id = d.id) AS receive_status,
  (SELECT CASE WHEN SUM(l.qty_billed) = 0 THEN 'not_billed'
               WHEN SUM(l.qty_billed) + ${EPS} < SUM(l.quantity) THEN 'partially_billed' ELSE 'billed' END
     FROM purchase_order_lines l WHERE l.doc_id = d.id) AS bill_status`;

export const purchaseOrders = createDocRouter({
  ...PO_CFG, entity: 'purchase_order', module: 'purchase_orders', numberType: 'purchase_order', contactType: 'vendor',
  listExtraSelect: poStatusSelect,
  header: (b, contact) => ({
    expected_delivery_date: date(b.expected_delivery_date, { field: 'Expected delivery date' }),
    payment_terms: int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: contact.payment_terms }),
    shipment_preference: str(b.shipment_preference, { field: 'Shipment preference', max: 100 }),
  }),
  enrich: async (db, req, doc) => {
    const [{ rows: receives }, { rows: bills }, { rows: [st] }] = await Promise.all([
      db.query('SELECT id, number, receive_date FROM purchase_receives WHERE purchase_order_id = $1 ORDER BY id', [doc.id]),
      db.query('SELECT id, number, doc_date, due_date, status, total, balance FROM bills WHERE purchase_order_id = $1 ORDER BY id', [doc.id]),
      db.query(`SELECT ${poStatusSelect} FROM purchase_orders d WHERE d.id = $1`, [doc.id]),
    ]);
    Object.assign(doc, { receives, bills, ...st });
  },
});

purchaseOrders.post('/:id/issue', can('purchase_orders', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const po = await fetchDoc(client, PO_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (po.status !== 'draft') throw conflict('Only draft purchase orders can be issued');
    await client.query("UPDATE purchase_orders SET status = 'issued', updated_at = now() WHERE id = $1", [po.id]);
    await audit(client, req, 'approve', 'purchase_order', po.id, `Purchase order ${po.number} issued`);
    return fetchDoc(client, PO_CFG, req.orgId, po.id);
  });
  res.json(doc);
});

purchaseOrders.post('/:id/cancel', can('purchase_orders', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const po = await fetchDoc(client, PO_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (po.status !== 'issued') throw conflict('Only issued purchase orders can be cancelled');
    if (po.lines.some((l) => l.qty_received > 0 || l.qty_billed > 0)) throw conflict('This purchase order has receives or bills. Delete them first.');
    await client.query("UPDATE purchase_orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [po.id]);
    await audit(client, req, 'void', 'purchase_order', po.id, `Purchase order ${po.number} cancelled`);
    return fetchDoc(client, PO_CFG, req.orgId, po.id);
  });
  res.json(doc);
});

// ================================================================== purchase receives
export const purchaseReceives = Router();

purchaseReceives.get('/', can('purchase_receives', 'view'), async (req, res) => {
  const p = listParams(req.query, { number: 'd.number', date: 'd.receive_date', created: 'd.created_at' }, 'created');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.purchase_order_id) { params.push(Number(req.query.purchase_order_id)); where.push(`d.purchase_order_id = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`(d.number ILIKE $${params.length} OR po.number ILIKE $${params.length} OR c.display_name ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const joins = 'JOIN purchase_orders po ON po.id = d.purchase_order_id JOIN contacts c ON c.id = d.contact_id JOIN warehouses wh ON wh.id = d.warehouse_id';
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(`SELECT d.*, po.number AS purchase_order_number, c.display_name AS contact_name, wh.name AS warehouse_name,
                  (SELECT SUM(quantity) FROM purchase_receive_lines WHERE receive_id = d.id) AS total_quantity
             FROM purchase_receives d ${joins} WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM purchase_receives d ${joins} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

purchaseReceives.get('/next-number', can('purchase_receives', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'purchase_receive') });
});

async function fetchReceive(db, orgId, rId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, po.number AS purchase_order_number, c.display_name AS contact_name, w.name AS warehouse_name, u.name AS created_by_name
       FROM purchase_receives d JOIN purchase_orders po ON po.id = d.purchase_order_id JOIN contacts c ON c.id = d.contact_id
       JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, rId],
  );
  if (!rows[0]) throw notFound('Purchase receive');
  const { rows: lines } = await db.query(
    `SELECT rl.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.tracking AS item_tracking, pol.quantity AS ordered
       FROM purchase_receive_lines rl JOIN items i ON i.id = rl.item_id JOIN purchase_order_lines pol ON pol.id = rl.po_line_id
      WHERE rl.receive_id = $1 ORDER BY pol.position`,
    [rId],
  );
  const units = await trackingFor(db, orgId, 'purchase_receive', rId);
  for (const l of lines) l.units = units[l.item_id] || [];
  return { ...rows[0], lines };
}

purchaseReceives.get('/:id', can('purchase_receives', 'view'), async (req, res) => {
  res.json(await fetchReceive({ query }, req.orgId, Number(req.params.id)));
});

purchaseReceives.post('/', can('purchase_receives', 'create'), async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (client) => {
    const po = await fetchDoc(client, PO_CFG, req.orgId, id(b.purchase_order_id, { field: 'Purchase order', required: true }), { lock: true });
    if (po.status !== 'issued') throw conflict('Goods can only be received against an issued purchase order');
    const lines = [];
    for (const l of Array.isArray(b.lines) ? b.lines : []) {
      const qty = round3(num(l.quantity, { field: 'Quantity', min: 0, def: 0 }));
      if (!qty) continue;
      const pol = po.lines.find((x) => x.id === Number(l.po_line_id));
      if (!pol) throw badRequest('Receive line does not belong to this purchase order');
      if (!pol.item_id || pol.item_type !== 'goods') throw badRequest(`${pol.description || 'This line'} is not a physical item`);
      if (qty > pol.quantity - pol.qty_received + EPS) throw badRequest(`Only ${round3(pol.quantity - pol.qty_received)} of ${pol.item_name} is left to receive`);
      lines.push({ pol, qty, tracking: l.tracking || null });
    }
    if (!lines.length) throw badRequest('Enter a received quantity for at least one item');
    const whId = id(b.warehouse_id, { field: 'Warehouse' }) || po.warehouse_id;
    const { rows: [wh] } = await client.query("SELECT id FROM warehouses WHERE org_id = $1 AND id = $2 AND status = 'active'", [req.orgId, whId]);
    if (!wh) throw badRequest('Select a valid warehouse');
    const receiveDate = date(b.receive_date, { field: 'Received date' }) || today();
    const number = await takeNumber(client, req.orgId, 'purchase_receive', b.number);
    const { rows: [rcv] } = await client.query(
      `INSERT INTO purchase_receives (org_id, number, purchase_order_id, contact_id, receive_date, warehouse_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.orgId, number, po.id, po.contact_id, receiveDate, whId, str(b.notes, { field: 'Notes', max: 2000 }), req.user.id],
    );
    for (const { pol, qty, tracking } of lines) {
      await client.query('INSERT INTO purchase_receive_lines (receive_id, po_line_id, item_id, quantity, tracking) VALUES ($1,$2,$3,$4,$5)', [rcv.id, pol.id, pol.item_id, qty, tracking ? JSON.stringify(tracking) : null]);
      await client.query('UPDATE purchase_order_lines SET qty_received = qty_received + $2 WHERE id = $1', [pol.id, qty]);
      if (pol.track_inventory) {
        await stockIn(client, ctxOf(req), {
          itemId: pol.item_id, warehouseId: whId, qty, unitCost: effectiveRate(pol, po.discount_percent), date: receiveDate, tracking,
          sourceType: 'purchase_receive', sourceId: rcv.id, sourceNumber: number, note: `Received from ${po.contact_name} (${po.number})`,
        });
      }
    }
    await refreshPurchaseOrder(client, po.id);
    await audit(client, req, 'create', 'purchase_receive', rcv.id, `Purchase receive ${number} recorded for ${po.number}`);
    return fetchReceive(client, req.orgId, rcv.id);
  });
  res.status(201).json(result);
});

purchaseReceives.delete('/:id', can('purchase_receives', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const rcv = await fetchReceive(client, req.orgId, Number(req.params.id), true);
    await reverseSource(client, ctxOf(req), 'purchase_receive', rcv.id);
    for (const l of rcv.lines) await client.query('UPDATE purchase_order_lines SET qty_received = qty_received - $2 WHERE id = $1', [l.po_line_id, l.quantity]);
    await client.query('DELETE FROM purchase_receives WHERE id = $1', [rcv.id]);
    await refreshPurchaseOrder(client, rcv.purchase_order_id);
    await audit(client, req, 'delete', 'purchase_receive', rcv.id, `Purchase receive ${rcv.number} deleted`);
  });
  res.status(204).end();
});

// ================================================================== bills
export const bills = createDocRouter({
  ...BILL_CFG, entity: 'bill', module: 'bills', numberType: null, contactType: 'vendor',
  hasBalance: true, lineExtra: ['po_line_id', 'account', 'tracking'], filterCols: ['purchase_order_id'],
  listExtraSelect: `CASE WHEN d.status IN ('open','partially_paid') AND d.due_date < CURRENT_DATE THEN 'overdue' ELSE d.status END AS display_status`,
  header: (b, contact) => {
    const docDate = date(b.doc_date, { field: 'Bill date' }) || today();
    const terms = int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: contact.payment_terms });
    return {
      purchase_order_id: id(b.purchase_order_id, { field: 'Purchase order' }),
      payment_terms: terms,
      due_date: date(b.due_date, { field: 'Due date' }) || addDays(docDate, terms),
    };
  },
  validate: async (client, req, { header, lines }) => {
    if (header.due_date < header.doc_date) throw badRequest('Due date cannot be before the bill date');
    if (header.purchase_order_id) {
      const po = await fetchDoc(client, PO_CFG, req.orgId, header.purchase_order_id);
      if (po.contact_id !== header.contact_id) throw badRequest('The purchase order belongs to a different vendor');
      if (!['issued', 'closed'].includes(po.status)) throw badRequest('The purchase order must be issued before billing');
      header.warehouse_id = po.warehouse_id;
      for (const l of lines) {
        if (l.po_line_id && !po.lines.some((x) => x.id === Number(l.po_line_id))) throw badRequest('Bill line does not belong to the purchase order');
      }
    } else {
      for (const l of lines) l.po_line_id = null;
    }
    for (const l of lines) l.account = l.account ? String(l.account).slice(0, 100) : null;
  },
  enrich: async (db, req, doc) => {
    const [{ rows: payments }, { rows: credits }, { rows: [po] }] = await Promise.all([
      db.query(`SELECT a.id, a.amount, p.id AS payment_id, p.number, p.payment_date, p.mode, p.reference
                  FROM payment_made_allocations a JOIN payments_made p ON p.id = a.payment_id WHERE a.bill_id = $1 ORDER BY p.payment_date`, [doc.id]),
      db.query(`SELECT a.id, a.amount, a.applied_date, vc.id AS vendor_credit_id, vc.number
                  FROM vendor_credit_applications a JOIN vendor_credits vc ON vc.id = a.vendor_credit_id WHERE a.bill_id = $1 ORDER BY a.id`, [doc.id]),
      db.query('SELECT id, number FROM purchase_orders WHERE id = $1', [doc.purchase_order_id]),
    ]);
    doc.payments = payments;
    doc.credits = credits;
    doc.purchase_order_number = po?.number || null;
    doc.display_status = ['open', 'partially_paid'].includes(doc.status) && doc.due_date < today() ? 'overdue' : doc.status;
  },
});

bills.post('/:id/open', can('bills', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const bill = await fetchDoc(client, BILL_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (bill.status !== 'draft') throw conflict('Only draft bills can be opened');
    if (bill.purchase_order_id) {
      for (const l of bill.lines) {
        if (!l.po_line_id) continue;
        const { rows: [pol] } = await client.query('SELECT quantity, qty_billed FROM purchase_order_lines WHERE id = $1 FOR UPDATE', [l.po_line_id]);
        if (l.quantity > pol.quantity - pol.qty_billed + EPS) {
          throw conflict(`${l.item_name || l.description}: only ${round3(pol.quantity - pol.qty_billed)} left to bill on the purchase order`);
        }
        await client.query('UPDATE purchase_order_lines SET qty_billed = qty_billed + $2 WHERE id = $1', [l.po_line_id, l.quantity]);
      }
    } else {
      // Direct bill (no purchase order): goods enter stock when the bill is opened.
      for (const l of bill.lines) {
        if (l.item_id && l.track_inventory) {
          await stockIn(client, ctxOf(req), {
            itemId: l.item_id, warehouseId: bill.warehouse_id, qty: l.quantity, unitCost: effectiveRate(l, bill.discount_percent), date: bill.doc_date, tracking: l.tracking,
            sourceType: 'bill', sourceId: bill.id, sourceNumber: bill.number, note: `Billed by ${bill.contact_name}`,
          });
        }
      }
    }
    await client.query("UPDATE bills SET status = 'open', balance = total, updated_at = now() WHERE id = $1", [bill.id]);
    await refreshPayable(client, 'bill', bill.id);
    if (bill.purchase_order_id) await refreshPurchaseOrder(client, bill.purchase_order_id);
    await audit(client, req, 'approve', 'bill', bill.id, `Bill ${bill.number} opened`);
    return fetchDoc(client, BILL_CFG, req.orgId, bill.id);
  });
  res.json(doc);
});

bills.post('/:id/void', can('bills', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const bill = await fetchDoc(client, BILL_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (['draft', 'void'].includes(bill.status)) throw conflict('Only open bills can be voided');
    if (bill.amount_paid > 0 || bill.credits_applied > 0) throw conflict('Remove the payments and credits applied to this bill first');
    await reverseSource(client, ctxOf(req), 'bill', bill.id);
    for (const l of bill.lines) {
      if (l.po_line_id) await client.query('UPDATE purchase_order_lines SET qty_billed = qty_billed - $2 WHERE id = $1', [l.po_line_id, l.quantity]);
    }
    await client.query("UPDATE bills SET status = 'void', balance = 0, updated_at = now() WHERE id = $1", [bill.id]);
    if (bill.purchase_order_id) await refreshPurchaseOrder(client, bill.purchase_order_id);
    await audit(client, req, 'void', 'bill', bill.id, `Bill ${bill.number} voided`);
    return fetchDoc(client, BILL_CFG, req.orgId, bill.id);
  });
  res.json(doc);
});

// ================================================================== vendor credits
export const vendorCredits = createDocRouter({
  ...VC_CFG, entity: 'vendor_credit', module: 'vendor_credits', numberType: 'vendor_credit', contactType: 'vendor',
  hasCreditBalance: true, filterCols: ['bill_id'], lineExtra: ['tracking'],
  header: (b) => ({ bill_id: id(b.bill_id, { field: 'Bill' }), return_stock: bool(b.return_stock) }),
  validate: async (client, req, { header }) => {
    if (header.bill_id) {
      const { rows } = await client.query('SELECT contact_id FROM bills WHERE org_id = $1 AND id = $2', [req.orgId, header.bill_id]);
      if (!rows[0] || rows[0].contact_id !== header.contact_id) throw badRequest('The bill belongs to a different vendor');
    }
  },
  enrich: async (db, req, doc) => {
    const [{ rows: apps }, { rows: [b] }] = await Promise.all([
      db.query('SELECT a.*, b.number AS bill_number FROM vendor_credit_applications a JOIN bills b ON b.id = a.bill_id WHERE a.vendor_credit_id = $1 ORDER BY a.id', [doc.id]),
      db.query('SELECT number FROM bills WHERE id = $1', [doc.bill_id]),
    ]);
    doc.applications = apps;
    doc.bill_number = b?.number || null;
  },
});

vendorCredits.post('/:id/open', can('vendor_credits', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const vc = await fetchDoc(client, VC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (vc.status !== 'draft') throw conflict('Only draft vendor credits can be opened');
    if (vc.return_stock) {
      for (const l of vc.lines) {
        if (l.item_id && l.track_inventory) {
          await stockOut(client, ctxOf(req), {
            itemId: l.item_id, warehouseId: vc.warehouse_id, qty: l.quantity, date: vc.doc_date, tracking: l.tracking,
            sourceType: 'vendor_credit', sourceId: vc.id, sourceNumber: vc.number, note: `Returned to ${vc.contact_name}`,
          });
        }
      }
    }
    await client.query("UPDATE vendor_credits SET status = 'open', balance = total, updated_at = now() WHERE id = $1", [vc.id]);
    await refreshCredit(client, 'vendor_credit', vc.id);
    await audit(client, req, 'approve', 'vendor_credit', vc.id, `Vendor credit ${vc.number} opened`);
    return fetchDoc(client, VC_CFG, req.orgId, vc.id);
  });
  res.json(doc);
});

vendorCredits.post('/:id/apply', can('vendor_credits', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const vc = await fetchDoc(client, VC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (vc.status !== 'open') throw conflict('Only open vendor credits can be applied');
    let total = 0;
    for (const a of Array.isArray(req.body?.allocations) ? req.body.allocations : []) {
      const amount = round2(num(a.amount, { field: 'Amount', min: 0, def: 0 }));
      if (!amount) continue;
      const { rows: [bill] } = await client.query('SELECT * FROM bills WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(a.bill_id)]);
      if (!bill || bill.contact_id !== vc.contact_id) throw badRequest('Bill not found for this vendor');
      if (!['open', 'partially_paid'].includes(bill.status)) throw badRequest(`Bill ${bill.number} is not open`);
      if (amount > bill.balance + 0.004) throw badRequest(`Amount exceeds the balance of bill ${bill.number}`);
      await client.query('INSERT INTO vendor_credit_applications (vendor_credit_id, bill_id, amount, applied_date) VALUES ($1,$2,$3,$4)', [vc.id, bill.id, amount, today()]);
      await refreshPayable(client, 'bill', bill.id);
      total += amount;
    }
    if (!total) throw badRequest('Enter an amount to apply');
    if (total > vc.balance + 0.004) throw badRequest('Total exceeds the credit available');
    await refreshCredit(client, 'vendor_credit', vc.id);
    await audit(client, req, 'update', 'vendor_credit', vc.id, `Vendor credit ${vc.number}: ${total} applied to bills`);
    return fetchDoc(client, VC_CFG, req.orgId, vc.id);
  });
  res.json(doc);
});

vendorCredits.delete('/:id/applications/:appId', can('vendor_credits', 'edit'), async (req, res) => {
  await tx(async (client) => {
    const vc = await fetchDoc(client, VC_CFG, req.orgId, Number(req.params.id), { lock: true });
    const { rows: [app] } = await client.query('DELETE FROM vendor_credit_applications WHERE id = $1 AND vendor_credit_id = $2 RETURNING bill_id', [Number(req.params.appId), vc.id]);
    if (!app) throw notFound('Credit application');
    await refreshPayable(client, 'bill', app.bill_id);
    await refreshCredit(client, 'vendor_credit', vc.id);
  });
  res.status(204).end();
});

vendorCredits.post('/:id/void', can('vendor_credits', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const vc = await fetchDoc(client, VC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (!['open', 'closed'].includes(vc.status)) throw conflict('Only open vendor credits can be voided');
    const { rows } = await client.query('SELECT 1 FROM vendor_credit_applications WHERE vendor_credit_id = $1 LIMIT 1', [vc.id]);
    if (rows.length) throw conflict('Remove the applied credits first');
    await reverseSource(client, ctxOf(req), 'vendor_credit', vc.id);
    await client.query("UPDATE vendor_credits SET status = 'void', balance = 0, updated_at = now() WHERE id = $1", [vc.id]);
    await audit(client, req, 'void', 'vendor_credit', vc.id, `Vendor credit ${vc.number} voided`);
    return fetchDoc(client, VC_CFG, req.orgId, vc.id);
  });
  res.json(doc);
});
