// Landed costs: spread freight / customs / insurance over goods received on purchase receives or bills.
import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, id, date, oneOf, today, listParams, round2 } from '../lib/validate.js';
import { addLotCost, ctxOf } from '../lib/stock.js';

const r = Router();
const SOURCES = { purchase_receive: { table: 'purchase_receives', dateCol: 'receive_date', label: 'Purchase receive' }, bill: { table: 'bills', dateCol: 'doc_date', label: 'Bill' } };
const METHODS = ['quantity', 'value', 'weight', 'manual'];

/** Goods-in documents that can carry landed cost (they created FIFO lots). */
r.get('/sources', can('bills', 'view'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const params: any[] = [req.orgId];
  let filter = '';
  if (search) { params.push(`%${search}%`); filter = `AND (src.number ILIKE $2 OR c.display_name ILIKE $2)`; }
  const { rows } = await query(
    `SELECT src.*, c.display_name AS vendor_name, s.lots, s.qty, s.value FROM (
       SELECT 'purchase_receive' AS source_type, p.id AS source_id, p.number, p.receive_date AS doc_date, p.contact_id FROM purchase_receives p WHERE p.org_id = $1
       UNION ALL
       SELECT 'bill', b.id, b.number, b.doc_date, b.contact_id FROM bills b WHERE b.org_id = $1 AND b.status NOT IN ('draft', 'void')
     ) src
     JOIN contacts c ON c.id = src.contact_id
     JOIN LATERAL (
       SELECT COUNT(*)::int AS lots, SUM(qty_in)::float AS qty, SUM(qty_in * unit_cost)::float AS value
         FROM stock_lots l WHERE l.org_id = $1 AND l.source_type = src.source_type AND l.source_id = src.source_id
     ) s ON s.lots > 0
     WHERE TRUE ${filter}
     ORDER BY src.doc_date DESC, src.number DESC LIMIT 30`,
    params,
  );
  res.json(rows);
});

/** The FIFO lots created by one goods-in document. */
async function sourceLots(db, orgId, sourceType, sourceId) {
  const s = SOURCES[sourceType];
  if (!s) throw badRequest('Choose a purchase receive or bill');
  const { rows: [doc] } = await db.query(`SELECT id, number FROM ${s.table} WHERE org_id = $1 AND id = $2`, [orgId, sourceId]);
  if (!doc) throw notFound(s.label);
  const { rows } = await db.query(
    `SELECT l.id AS lot_id, l.item_id, i.name AS item_name, i.sku, i.weight_kg, l.warehouse_id, w.name AS warehouse_name,
            l.qty_in::float AS quantity, l.qty_remaining::float AS qty_remaining, l.unit_cost::float AS unit_cost,
            ROUND(l.qty_in * l.unit_cost, 2)::float AS base_value
       FROM stock_lots l JOIN items i ON i.id = l.item_id JOIN warehouses w ON w.id = l.warehouse_id
      WHERE l.org_id = $1 AND l.source_type = $2 AND l.source_id = $3 ORDER BY l.id`,
    [orgId, sourceType, sourceId],
  );
  return rows.map((x) => ({ ...x, source_type: sourceType, source_id: sourceId, source_number: doc.number }));
}

r.get('/sources/:type/:id/lots', can('bills', 'view'), async (req, res) => {
  res.json(await sourceLots({ query }, req.orgId, req.params.type, Number(req.params.id)));
});

/** Split `amount` over lots by quantity / value / weight; the last line absorbs rounding. */
export function allocate(lots, amount, method, manual = {}) {
  if (method === 'manual') {
    const out = lots.map((l) => round2(Number(manual[l.lot_id]) || 0));
    if (out.some((v) => v < 0)) throw badRequest('Allocated amounts cannot be negative');
    if (Math.abs(out.reduce((s, v) => s + v, 0) - amount) > 0.005) throw badRequest(`The amounts you allocated add up to ${round2(out.reduce((s, v) => s + v, 0))}, not ${amount}`);
    return out;
  }
  const basis = lots.map((l) => (method === 'quantity' ? l.quantity : method === 'value' ? l.base_value : (Number(l.weight_kg) || 0) * l.quantity));
  const total = basis.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    throw badRequest(method === 'weight' ? 'None of these items has a weight. Add weights on the items, or allocate by quantity or value.' : `Nothing to allocate by ${method}`);
  }
  const out = basis.map((b) => round2((amount * b) / total));
  const diff = round2(amount - out.reduce((s, v) => s + v, 0));
  const last = basis.map((b, i) => (b > 0 ? i : -1)).filter((i) => i >= 0).pop();
  out[last] = round2(out[last] + diff);
  return out;
}

async function fetchLandedCost(db, orgId, lcId) {
  const { rows: [lc] } = await db.query(
    `SELECT c.*, b.number AS bill_number, v.display_name AS bill_vendor, u.name AS created_by_name
       FROM landed_costs c LEFT JOIN bills b ON b.id = c.bill_id LEFT JOIN contacts v ON v.id = b.contact_id LEFT JOIN users u ON u.id = c.created_by
      WHERE c.org_id = $1 AND c.id = $2`,
    [orgId, lcId],
  );
  if (!lc) throw notFound('Landed cost');
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku, w.name AS warehouse_name
       FROM landed_cost_lines l JOIN items i ON i.id = l.item_id JOIN warehouses w ON w.id = l.warehouse_id
      WHERE l.landed_cost_id = $1 ORDER BY l.id`,
    [lcId],
  );
  return { ...lc, lines };
}

r.get('/', can('bills', 'view'), async (req, res) => {
  const p = listParams(req.query, { date: 'c.cost_date', number: 'c.number', amount: 'c.amount', created: 'c.created_at' }, 'date');
  const params: any[] = [req.orgId];
  const where = ['c.org_id = $1'];
  if (req.query.status) { params.push(String(req.query.status)); where.push(`c.status = $${params.length}`); }
  if (req.query.bill_id) { params.push(Number(req.query.bill_id)); where.push(`c.bill_id = $${params.length}`); }
  if (p.search) { params.push(`%${p.search}%`); where.push(`(c.number ILIKE $${params.length} OR c.description ILIKE $${params.length} OR b.number ILIKE $${params.length})`); }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    query(
      `SELECT c.*, b.number AS bill_number,
              (SELECT string_agg(DISTINCT l.source_number, ', ') FROM landed_cost_lines l WHERE l.landed_cost_id = c.id) AS applied_to
         FROM landed_costs c LEFT JOIN bills b ON b.id = c.bill_id
        WHERE ${w} ORDER BY ${p.orderBy}, c.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
      params,
    ),
    query(`SELECT COUNT(*)::int AS n FROM landed_costs c LEFT JOIN bills b ON b.id = c.bill_id WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
});

r.get('/:id', can('bills', 'view'), async (req, res) => {
  res.json(await fetchLandedCost({ query }, req.orgId, Number(req.params.id)));
});

r.post('/', can('bills', 'create'), async (req, res) => {
  const b = req.body || {};
  const amount = round2(num(b.amount, { field: 'Amount', required: true, min: 0.01 }));
  const method = oneOf(b.method, METHODS, { field: 'Allocation method', def: 'value' });
  const costDate = date(b.cost_date, { field: 'Date' }) || today();
  const billId = id(b.bill_id, { field: 'Bill' });
  const description = str(b.description, { field: 'Description', max: 500 });
  const sources = (Array.isArray(b.sources) ? b.sources : []).map((s) => ({ type: String(s.source_type || s.type), id: Number(s.source_id || s.id) }));
  if (!sources.length) throw badRequest('Choose the purchase receive(s) or bill(s) whose goods this cost belongs to');
  const result = await tx(async (client) => {
    if (billId) {
      const { rows: [bill] } = await client.query('SELECT id, number, status, total FROM bills WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, billId]);
      if (!bill) throw badRequest('Bill not found');
      if (['draft', 'void'].includes(bill.status)) throw badRequest(`Bill ${bill.number} must be open before its charges can be used as landed cost`);
      const { rows: [{ used }] } = await client.query("SELECT COALESCE(SUM(amount), 0)::float AS used FROM landed_costs WHERE bill_id = $1 AND status = 'applied'", [billId]);
      if (amount > Number(bill.total) - used + 0.005) throw badRequest(`Only ${round2(Number(bill.total) - used)} of bill ${bill.number} is left to use as landed cost`);
    }
    const seen = new Set();
    const lots = [];
    for (const s of sources) {
      const key = `${s.type}:${s.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lots.push(...(await sourceLots(client, req.orgId, s.type, s.id)));
    }
    if (!lots.length) throw badRequest('The chosen documents did not add any stock');
    const amounts = allocate(lots, amount, method, b.manual || {});
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int + 1 AS n FROM landed_costs WHERE org_id = $1', [req.orgId]);
    let number = `LC-${String(n).padStart(5, '0')}`;
    for (let i = n + 1; (await client.query('SELECT 1 FROM landed_costs WHERE org_id = $1 AND number = $2', [req.orgId, number])).rows.length; i++) number = `LC-${String(i).padStart(5, '0')}`;
    const { rows: [lc] } = await client.query(
      `INSERT INTO landed_costs (org_id, number, cost_date, bill_id, description, amount, method, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.orgId, number, costDate, billId, description, amount, method, req.user.id],
    );
    let onHandTotal = 0;
    let usedTotal = 0;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      const alloc = amounts[i];
      if (!alloc) continue;
      const perUnit = alloc / l.quantity;
      const { onHand, used, lot } = await addLotCost(client, ctxOf(req), l.lot_id, perUnit, {
        date: costDate, sourceType: 'landed_cost', sourceId: lc.id, sourceNumber: number, note: `Landed cost on ${l.source_number}${description ? `: ${description}` : ''}`,
      });
      onHandTotal += onHand;
      usedTotal += used;
      await client.query(
        `INSERT INTO landed_cost_lines (landed_cost_id, lot_id, source_type, source_id, source_number, item_id, warehouse_id, quantity, base_value, amount, per_unit, remaining_at_apply)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [lc.id, l.lot_id, l.source_type, l.source_id, l.source_number, l.item_id, l.warehouse_id, l.quantity, l.base_value, alloc, perUnit, lot.qty_remaining],
      );
    }
    await client.query('UPDATE landed_costs SET applied_to_stock = $2, expensed = $3 WHERE id = $1', [lc.id, round2(onHandTotal), round2(usedTotal)]);
    await audit(client, req, 'create', 'landed_cost', lc.id, `Landed cost ${number} of ${amount} added to ${[...new Set(lots.map((l) => l.source_number))].join(', ')}`);
    return fetchLandedCost(client, req.orgId, lc.id);
  });
  res.status(201).json(result);
});

r.post('/:id/void', can('bills', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const lc = await fetchLandedCost(client, req.orgId, Number(req.params.id));
    if (lc.status === 'void') throw conflict('This landed cost is already void');
    for (const l of lc.lines) {
      if (!l.lot_id) throw conflict('Some of the stock this cost was added to no longer exists, so it cannot be voided.');
      const { rows: [lot] } = await client.query('SELECT qty_remaining FROM stock_lots WHERE id = $1', [l.lot_id]);
      if (!lot || Math.abs(Number(lot.qty_remaining) - Number(l.remaining_at_apply)) > 0.0005) {
        throw conflict(`Stock of ${l.item_name} from ${l.source_number} has been used since the cost was added, so it cannot be voided. Use a value adjustment instead.`);
      }
    }
    for (const l of lc.lines) await client.query('UPDATE stock_lots SET unit_cost = GREATEST(0, unit_cost - $2) WHERE id = $1', [l.lot_id, Number(l.per_unit)]);
    await client.query("DELETE FROM stock_movements WHERE org_id = $1 AND source_type = 'landed_cost' AND source_id = $2", [req.orgId, lc.id]);
    await client.query("UPDATE landed_costs SET status = 'void', voided_at = now() WHERE id = $1", [lc.id]);
    await audit(client, req, 'void', 'landed_cost', lc.id, `Landed cost ${lc.number} voided`);
    return fetchLandedCost(client, req.orgId, lc.id);
  });
  res.json(result);
});

export default r;
