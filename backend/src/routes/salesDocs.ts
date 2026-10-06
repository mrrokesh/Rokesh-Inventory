// Estimates (quotes) and delivery challans.
import { tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { conflict } from '../lib/errors.js';
import { str, date, obj, oneOf, today } from '../lib/validate.js';
import { takeNumber } from '../lib/numbering.js';
import { stockOut, reverseSource, ctxOf } from '../lib/stock.js';
import { fetchDoc } from '../lib/documents.js';
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
