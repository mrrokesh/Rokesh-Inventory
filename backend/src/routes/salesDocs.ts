// Estimates (quotes) and delivery challans.
import { tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, int, date, obj, oneOf, today, addDays, round2 } from '../lib/validate.js';
import { takeNumber } from '../lib/numbering.js';
import { stockOut, reverseSource, ctxOf } from '../lib/stock.js';
import { fetchDoc, refreshPayable } from '../lib/documents.js';
import { PAYMENT_MODES } from './payments.js';
import { trackingFor } from '../lib/tracking.js';
import { createDocRouter } from './docRouter.js';

const EST_CFG = { table: 'estimates', linesTable: 'estimate_lines', label: 'Estimate' };
const DC_CFG = { table: 'delivery_challans', linesTable: 'delivery_challan_lines', label: 'Delivery Challan' };

const addressHeader = (b, contact) => ({
  billing_address: Object.keys(obj(b.billing_address)).length ? obj(b.billing_address) : contact.billing_address,
  shipping_address: Object.keys(obj(b.shipping_address)).length ? obj(b.shipping_address) : contact.shipping_address,
});

// ================================================================== estimates
export const estimates = createDocRouter({
  ...EST_CFG, entity: 'estimate', module: 'estimates', numberType: 'estimate', contactType: 'customer',
  listExtraSelect: `CASE WHEN d.status = 'sent' AND d.expiry_date < CURRENT_DATE THEN 'expired' ELSE d.status END AS display_status`,
  header: (b, contact) => ({
    expiry_date: date(b.expiry_date, { field: 'Expiry date' }),
    salesperson: str(b.salesperson, { field: 'Salesperson', max: 100 }),
    ...addressHeader(b, contact),
  }),
  enrich: async (db, req, doc) => {
    const { rows } = await db.query('SELECT id, number, status FROM sales_orders WHERE id = $1', [doc.sales_order_id]);
    doc.sales_order_number = rows[0]?.number || null;
    doc.display_status = doc.status === 'sent' && doc.expiry_date && doc.expiry_date < today() ? 'expired' : doc.status;
  },
});

function estimateStatus(from, to, verb) {
  return async (req, res) => {
    const doc = await tx(async (client) => {
      const est = await fetchDoc(client, EST_CFG, req.orgId, Number(req.params.id), { lock: true });
      if (!from.includes(est.status)) throw conflict(`This estimate cannot be ${verb} now (it is ${est.status})`);
      await client.query('UPDATE estimates SET status = $2, updated_at = now() WHERE id = $1', [est.id, to]);
      await audit(client, req, 'update', 'estimate', est.id, `Estimate ${est.number} ${verb}`);
      return fetchDoc(client, EST_CFG, req.orgId, est.id);
    });
    res.json(doc);
  };
}
estimates.post('/:id/send', can('estimates', 'approve'), estimateStatus(['draft'], 'sent', 'marked as sent'));
estimates.post('/:id/accept', can('estimates', 'approve'), estimateStatus(['draft', 'sent', 'declined'], 'accepted', 'marked as accepted'));
estimates.post('/:id/decline', can('estimates', 'approve'), estimateStatus(['sent', 'accepted'], 'declined', 'marked as declined'));

/** Convert an estimate into a draft sales order with the same lines. */
export async function convertEstimate(client, req, estimateId) {
  const est = await fetchDoc(client, EST_CFG, req.orgId, estimateId, { lock: true });
  if (['converted'].includes(est.status)) throw conflict('This estimate has already been converted');
  if (est.status === 'declined') throw conflict('Declined estimates cannot be converted. Mark it accepted first.');
  const number = await takeNumber(client, req.orgId, 'sales_order');
  const { rows: [{ payment_terms: terms }] } = await client.query('SELECT payment_terms FROM contacts WHERE id = $1', [est.contact_id]);
  const { rows: [so] } = await client.query(
    `INSERT INTO sales_orders (org_id, number, reference, contact_id, doc_date, payment_terms, salesperson, warehouse_id, discount_percent,
                               shipping_charge, adjustment, sub_total, discount_total, tax_total, total, billing_address, shipping_address,
                               notes, terms, place_of_supply, estimate_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id, number`,
    [req.orgId, number, est.number, est.contact_id, today(), terms, est.salesperson, est.warehouse_id, est.discount_percent,
      est.shipping_charge, est.adjustment, est.sub_total, est.discount_total, est.tax_total, est.total,
      JSON.stringify(est.billing_address), JSON.stringify(est.shipping_address), est.notes, est.terms, est.place_of_supply, est.id, req.user?.id ?? null],
  );
  for (const l of est.lines) {
    await client.query(
      `INSERT INTO sales_order_lines (doc_id, item_id, description, quantity, rate, discount_percent, tax_id, tax_rate, amount, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [so.id, l.item_id, l.description, l.quantity, l.rate, l.discount_percent, l.tax_id, l.tax_rate, l.amount, l.position],
    );
  }
  await client.query("UPDATE estimates SET status = 'converted', sales_order_id = $2, updated_at = now() WHERE id = $1", [est.id, so.id]);
  await audit(client, req, 'create', 'sales_order', so.id, `Sales order ${so.number} created from estimate ${est.number}`);
  return so;
}

estimates.post('/:id/convert', can('sales_orders', 'create'), async (req, res) => {
  const so = await tx((client) => convertEstimate(client, req, Number(req.params.id)));
  res.status(201).json(so);
});

// ================================================================== delivery challans
export const deliveryChallans = createDocRouter({
  ...DC_CFG, entity: 'delivery_challan', module: 'delivery_challans', numberType: 'delivery_challan', contactType: 'customer',
  lineExtra: ['tracking'],
  header: (b, contact) => ({
    challan_type: oneOf(b.challan_type, ['supply_on_approval', 'job_work', 'supply_of_liquid_gas', 'others'], { field: 'Challan type', def: 'supply_on_approval' }),
    ...addressHeader(b, contact),
  }),
  enrich: async (db, req, doc) => {
    const [{ rows: inv }, units] = await Promise.all([
      db.query('SELECT id, number, status FROM invoices WHERE id = $1', [doc.invoice_id]),
      trackingFor(db, req.orgId, 'delivery_challan', doc.id),
    ]);
    doc.invoice_number = inv[0]?.number || null;
    for (const l of doc.lines) l.units = units[l.item_id] || [];
  },
});

// Open: goods leave the warehouse.
deliveryChallans.post('/:id/open', can('delivery_challans', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const dc = await fetchDoc(client, DC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (dc.status !== 'draft') throw conflict('Only draft challans can be opened');
    for (const l of dc.lines) {
      if (l.item_id && l.track_inventory) {
        await stockOut(client, ctxOf(req), {
          itemId: l.item_id, warehouseId: dc.warehouse_id, qty: l.quantity, date: dc.doc_date, tracking: l.tracking,
          sourceType: 'delivery_challan', sourceId: dc.id, sourceNumber: dc.number, note: `Delivery challan to ${dc.contact_name}`,
        });
      }
    }
    await client.query("UPDATE delivery_challans SET status = 'open', updated_at = now() WHERE id = $1", [dc.id]);
    await audit(client, req, 'approve', 'delivery_challan', dc.id, `Delivery challan ${dc.number} opened (stock out)`);
    return fetchDoc(client, DC_CFG, req.orgId, dc.id);
  });
  res.json(doc);
});

deliveryChallans.post('/:id/deliver', can('delivery_challans', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const dc = await fetchDoc(client, DC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (dc.status !== 'open') throw conflict('Only open challans can be marked as delivered');
    await client.query("UPDATE delivery_challans SET status = 'delivered', updated_at = now() WHERE id = $1", [dc.id]);
    await audit(client, req, 'update', 'delivery_challan', dc.id, `Delivery challan ${dc.number} marked as delivered`);
    return fetchDoc(client, DC_CFG, req.orgId, dc.id);
  });
  res.json(doc);
});

// Return: all goods come back to the warehouse (e.g. supply on approval not accepted, job work completed).
deliveryChallans.post('/:id/return', can('delivery_challans', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const dc = await fetchDoc(client, DC_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (!['open', 'delivered'].includes(dc.status)) throw conflict('Only open or delivered challans can be returned');
    await reverseSource(client, ctxOf(req), 'delivery_challan', dc.id);
    await client.query("UPDATE delivery_challans SET status = 'returned', updated_at = now() WHERE id = $1", [dc.id]);
    await audit(client, req, 'update', 'delivery_challan', dc.id, `Delivery challan ${dc.number} returned — stock restored`);
    return fetchDoc(client, DC_CFG, req.orgId, dc.id);
  });
  res.json(doc);
});

// ================================================================== retainer invoices
const RI_CFG = { table: 'retainers', linesTable: 'retainer_lines', label: 'Retainer Invoice' };

async function refreshRetainer(client, retainerId) {
  const { rows: [r] } = await client.query('SELECT total, amount_paid, status FROM retainers WHERE id = $1', [retainerId]);
  if (!r || r.status === 'draft' || r.status === 'void') return;
  const { rows: [a] } = await client.query('SELECT COALESCE(SUM(amount),0) AS s FROM retainer_applications WHERE retainer_id = $1', [retainerId]);
  const applied = Number(a.s);
  const paid = Number(r.amount_paid);
  const unused = round2(Math.max(0, paid - applied));
  const balance = round2(Math.max(0, Number(r.total) - paid));
  let status = 'sent';
  if (paid >= Number(r.total) - 0.004 && unused <= 0.004) status = 'closed';
  else if (paid >= Number(r.total) - 0.004) status = 'paid';
  else if (paid > 0) status = 'partially_paid';
  await client.query(
    `UPDATE retainers SET amount_applied = $2, unused = $3, balance = $4, status = $5, updated_at = now() WHERE id = $1`,
    [retainerId, applied, unused, balance, status],
  );
}

export const retainers = createDocRouter({
  ...RI_CFG, entity: 'retainer', module: 'retainers', numberType: 'retainer_invoice', contactType: 'customer',
  hasBalance: true,
  listExtraSelect: `CASE WHEN d.status IN ('sent','partially_paid') AND d.due_date < CURRENT_DATE THEN 'overdue' ELSE d.status END AS display_status`,
  header: (b, contact) => {
    const docDate = date(b.doc_date, { field: 'Date' }) || today();
    const terms = int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: contact.payment_terms });
    return {
      payment_terms: terms,
      due_date: date(b.due_date, { field: 'Due date' }) || addDays(docDate, terms),
      salesperson: str(b.salesperson, { field: 'Salesperson', max: 100 }),
      ...addressHeader(b, contact),
    };
  },
  enrich: async (db, req, doc) => {
    const [{ rows: payments }, { rows: applications }] = await Promise.all([
      db.query('SELECT id, amount, payment_date, mode, reference FROM retainer_payments WHERE retainer_id = $1 ORDER BY payment_date, id', [doc.id]),
      db.query(
        `SELECT a.id, a.amount, a.applied_date, a.invoice_id, i.number AS invoice_number
           FROM retainer_applications a JOIN invoices i ON i.id = a.invoice_id WHERE a.retainer_id = $1 ORDER BY a.id`,
        [doc.id],
      ),
    ]);
    doc.retainer_payments = payments;
    doc.applications = applications;
    doc.display_status = ['sent', 'partially_paid'].includes(doc.status) && doc.due_date < today() ? 'overdue' : doc.status;
  },
});

retainers.post('/:id/send', can('retainers', 'approve'), async (req, res) => {
  const doc = await tx(async (client) => {
    const ri = await fetchDoc(client, RI_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (ri.status !== 'draft') throw conflict('Only draft retainer invoices can be marked as sent');
    await client.query("UPDATE retainers SET status = 'sent', balance = total, unused = 0, updated_at = now() WHERE id = $1", [ri.id]);
    await audit(client, req, 'approve', 'retainer', ri.id, `Retainer invoice ${ri.number} marked as sent`);
    return fetchDoc(client, RI_CFG, req.orgId, ri.id);
  });
  res.json(doc);
});

retainers.post('/:id/record-payment', can('retainers', 'edit'), async (req, res) => {
  const b = req.body || {};
  const doc = await tx(async (client) => {
    const ri = await fetchDoc(client, RI_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (!['sent', 'partially_paid'].includes(ri.status)) throw conflict('This retainer invoice is not open for payment');
    const amount = round2(num(b.amount, { field: 'Amount', required: true, min: 0.01 }));
    if (amount > Number(ri.balance) + 0.004) throw badRequest('Amount exceeds the balance due');
    await client.query(
      `INSERT INTO retainer_payments (retainer_id, amount, payment_date, mode, reference) VALUES ($1,$2,$3,$4,$5)`,
      [ri.id, amount, date(b.payment_date, { field: 'Date' }) || today(), oneOf(b.mode, PAYMENT_MODES, { field: 'Mode', def: 'bank_transfer' }), str(b.reference, { field: 'Reference', max: 100 })],
    );
    await client.query('UPDATE retainers SET amount_paid = amount_paid + $2 WHERE id = $1', [ri.id, amount]);
    await refreshRetainer(client, ri.id);
    await audit(client, req, 'update', 'retainer', ri.id, `Payment of ${amount} recorded on retainer ${ri.number}`);
    return fetchDoc(client, RI_CFG, req.orgId, ri.id);
  });
  res.json(doc);
});

retainers.post('/:id/apply', can('retainers', 'edit'), async (req, res) => {
  const doc = await tx(async (client) => {
    const ri = await fetchDoc(client, RI_CFG, req.orgId, Number(req.params.id), { lock: true });
    if (!['paid', 'partially_paid', 'sent', 'closed'].includes(ri.status)) throw conflict('Collect payment on this retainer before applying it');
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    let total = 0;
    for (const a of allocations) {
      const amount = round2(num(a.amount, { field: 'Amount', min: 0, def: 0 }));
      if (!amount) continue;
      const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(a.invoice_id)]);
      if (!inv || inv.contact_id !== ri.contact_id) throw badRequest('Invoice not found for this customer');
      if (!['sent', 'partially_paid'].includes(inv.status)) throw badRequest(`Invoice ${inv.number} is not open`);
      if (amount > inv.balance + 0.004) throw badRequest(`Amount exceeds the balance of invoice ${inv.number}`);
      await client.query(
        'INSERT INTO retainer_applications (retainer_id, invoice_id, amount, applied_date) VALUES ($1,$2,$3,$4)',
        [ri.id, inv.id, amount, today()],
      );
      await refreshPayable(client, 'invoice', inv.id);
      total += amount;
    }
    if (!total) throw badRequest('Enter an amount to apply');
    const unused = Number(ri.unused || 0);
    if (total > unused + 0.004) throw badRequest('Total exceeds unused retainer amount');
    await refreshRetainer(client, ri.id);
    await audit(client, req, 'update', 'retainer', ri.id, `Retainer ${ri.number}: ${total} applied to invoices`);
    return fetchDoc(client, RI_CFG, req.orgId, ri.id);
  });
  res.json(doc);
});

retainers.delete('/:id/applications/:appId', can('retainers', 'edit'), async (req, res) => {
  await tx(async (client) => {
    const ri = await fetchDoc(client, RI_CFG, req.orgId, Number(req.params.id), { lock: true });
    const { rows: [app] } = await client.query(
      'DELETE FROM retainer_applications WHERE id = $1 AND retainer_id = $2 RETURNING invoice_id',
      [Number(req.params.appId), ri.id],
    );
    if (!app) throw notFound('Application');
    await refreshPayable(client, 'invoice', app.invoice_id);
    await refreshRetainer(client, ri.id);
    await audit(client, req, 'update', 'retainer', ri.id, `Retainer application removed from ${ri.number}`);
  });
  res.status(204).end();
});
