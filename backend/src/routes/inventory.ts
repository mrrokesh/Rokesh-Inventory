import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, id, date, oneOf, today, listParams, round2, round3 } from '../lib/validate.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { stockIn, stockOut, revalue, reverseSource, ctxOf, loadItems } from '../lib/stock.js';
import { getWarehouse } from '../lib/documents.js';

/** Generic paginated list for simple inventory documents. */
async function listDocs(req, res, { table, select, joins = '', dateCol, searchCols, filterCols = [] }) {
  const p = listParams(req.query, { number: 'd.number', date: `d.${dateCol}`, created: 'd.created_at', status: 'd.status' }, 'created');
  const params = [req.orgId];
  const where = ['d.org_id = $1'];
  if (req.query.status) { params.push(req.query.status); where.push(`d.status = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`d.${dateCol} >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`d.${dateCol} <= $${params.length}`); }
  for (const c of filterCols) if (req.query[c]) { params.push(Number(req.query[c])); where.push(`d.${c} = $${params.length}`); }
  if (p.search) {
    params.push(`%${p.search}%`);
    where.push(`(${searchCols.map((c) => `${c} ILIKE $${params.length}`).join(' OR ')})`);
  }
  const w = where.join(' AND ');
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT ${select} FROM ${table} d ${joins} WHERE ${w} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
    query(`SELECT COUNT(*)::int AS n FROM ${table} d ${joins} WHERE ${w}`, params),
  ]);
  res.json({ data: rows, total: c.n, page: p.page, per_page: p.perPage });
}

// =================================================================== adjustments
export const adjustments = Router();

adjustments.get('/', can('inventory', 'view'), (req, res) => listDocs(req, res, {
  table: 'inventory_adjustments',
  select: `d.*, w.name AS warehouse_name, u.name AS created_by_name,
           (SELECT COALESCE(SUM(m.value),0) FROM stock_movements m WHERE m.source_type = 'inventory_adjustment' AND m.source_id = d.id) AS value_change`,
  joins: 'JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN users u ON u.id = d.created_by',
  dateCol: 'adj_date', searchCols: ['d.number', 'd.reference', 'd.reason'], filterCols: ['warehouse_id'],
}));

adjustments.get('/next-number', can('inventory', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'inventory_adjustment') });
});

async function fetchAdjustment(db, orgId, adjId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, w.name AS warehouse_name, u.name AS created_by_name FROM inventory_adjustments d
       JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, adjId],
  );
  if (!rows[0]) throw notFound('Inventory adjustment');
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.tracking AS item_tracking,
            COALESCE(sl.on_hand, 0) AS current_on_hand
       FROM inventory_adjustment_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN stock_levels sl ON sl.item_id = l.item_id AND sl.warehouse_id = $2
      WHERE l.adjustment_id = $1 ORDER BY l.position, l.id`,
    [adjId, rows[0].warehouse_id],
  );
  return { ...rows[0], lines };
}

adjustments.get('/:id', can('inventory', 'view'), async (req, res) => {
  res.json(await fetchAdjustment({ query }, req.orgId, Number(req.params.id)));
});

async function parseAdjustment(client, req) {
  const b = req.body || {};
  const mode = oneOf(b.mode, ['quantity', 'value'], { field: 'Mode', def: 'quantity' });
  const wh = await getWarehouse(client, req.orgId, id(b.warehouse_id, { field: 'Warehouse' }));
  const header = {
    reference: str(b.reference, { field: 'Reference', max: 100 }),
    mode,
    adj_date: date(b.adj_date, { field: 'Date', required: true }),
    warehouse_id: wh.id,
    account: str(b.account, { field: 'Account', max: 100 }) || 'Cost of Goods Sold',
    reason: str(b.reason, { field: 'Reason', required: true, max: 200 }),
    description: str(b.description, { field: 'Description', max: 2000 }),
  };
  if (!Array.isArray(b.lines) || !b.lines.length) throw badRequest('Add at least one item');
  const lines = b.lines.map((l, i) => ({
    item_id: id(l.item_id, { field: `Line ${i + 1} item`, required: true }),
    qty_adjusted: mode === 'quantity' ? round3(num(l.qty_adjusted, { field: `Line ${i + 1} quantity adjusted`, required: true })) : 0,
    unit_cost: mode === 'quantity' ? num(l.unit_cost, { field: `Line ${i + 1} cost`, min: 0 }) : null,
    value_adjusted: mode === 'value' ? round2(num(l.value_adjusted, { field: `Line ${i + 1} value adjusted`, required: true })) : 0,
    tracking: mode === 'quantity' && l.tracking ? l.tracking : null,
    position: i,
  }));
  for (const l of lines) {
    if (mode === 'quantity' && l.qty_adjusted === 0) throw badRequest('Quantity adjusted cannot be zero');
    if (mode === 'value' && l.value_adjusted === 0) throw badRequest('Value adjusted cannot be zero');
  }
  const items = await loadItems(client, req.orgId, lines.map((l) => l.item_id));
  for (const l of lines) {
    const it = items.get(l.item_id);
    if (!it.track_inventory) throw badRequest(`${it.name} does not track inventory`);
  }
  if (new Set(lines.map((l) => l.item_id)).size !== lines.length) throw badRequest('Each item can be added only once');
  return { header, lines, items };
}

async function postAdjustment(client, req, adj) {
  const ctx = ctxOf(req);
  const items = await loadItems(client, req.orgId, adj.lines.map((l) => l.item_id));
  for (const l of adj.lines) {
    const base = { itemId: l.item_id, warehouseId: adj.warehouse_id, date: adj.adj_date, sourceType: 'inventory_adjustment', sourceId: adj.id, sourceNumber: adj.number, note: adj.reason };
    if (adj.mode === 'value') await revalue(client, ctx, { ...base, delta: l.value_adjusted });
    else if (l.qty_adjusted > 0) await stockIn(client, ctx, { ...base, qty: l.qty_adjusted, unitCost: l.unit_cost ?? items.get(l.item_id).cost_price, tracking: l.tracking });
    else await stockOut(client, ctx, { ...base, qty: -l.qty_adjusted, tracking: l.tracking });
  }
}

async function insertAdjLines(client, adjId, lines) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO inventory_adjustment_lines (adjustment_id, item_id, qty_adjusted, unit_cost, value_adjusted, tracking, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adjId, l.item_id, l.qty_adjusted, l.unit_cost, l.value_adjusted, l.tracking ? JSON.stringify(l.tracking) : null, l.position],
    );
  }
}

adjustments.post('/', can('inventory', 'create'), async (req, res) => {
  const result = await tx(async (client) => {
    const { header, lines } = await parseAdjustment(client, req);
    const number = await takeNumber(client, req.orgId, 'inventory_adjustment', req.body.number);
    const { rows: [adj] } = await client.query(
      `INSERT INTO inventory_adjustments (org_id, number, reference, mode, adj_date, warehouse_id, account, reason, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.orgId, number, header.reference, header.mode, header.adj_date, header.warehouse_id, header.account, header.reason, header.description, req.user.id],
    );
    await insertAdjLines(client, adj.id, lines);
    if (req.body.status === 'adjusted') {
      const full = await fetchAdjustment(client, req.orgId, adj.id);
      await postAdjustment(client, req, full);
      await client.query("UPDATE inventory_adjustments SET status = 'adjusted' WHERE id = $1", [adj.id]);
    }
    await audit(client, req, 'create', 'inventory_adjustment', adj.id, `Inventory adjustment ${number} created${req.body.status === 'adjusted' ? ' and adjusted' : ''}`);
    return fetchAdjustment(client, req.orgId, adj.id);
  });
  res.status(201).json(result);
});

adjustments.put('/:id', can('inventory', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const cur = await fetchAdjustment(client, req.orgId, Number(req.params.id), true);
    if (cur.status !== 'draft') throw conflict('Only draft adjustments can be edited');
    const { header, lines } = await parseAdjustment(client, req);
    await client.query(
      `UPDATE inventory_adjustments SET reference=$3, mode=$4, adj_date=$5, warehouse_id=$6, account=$7, reason=$8, description=$9
        WHERE org_id = $1 AND id = $2`,
      [req.orgId, cur.id, header.reference, header.mode, header.adj_date, header.warehouse_id, header.account, header.reason, header.description],
    );
    await client.query('DELETE FROM inventory_adjustment_lines WHERE adjustment_id = $1', [cur.id]);
    await insertAdjLines(client, cur.id, lines);
    await audit(client, req, 'update', 'inventory_adjustment', cur.id, `Inventory adjustment ${cur.number} updated`);
    return fetchAdjustment(client, req.orgId, cur.id);
  });
  res.json(result);
});

adjustments.post('/:id/adjust', can('inventory', 'approve'), async (req, res) => {
  const result = await tx(async (client) => {
    const adj = await fetchAdjustment(client, req.orgId, Number(req.params.id), true);
    if (adj.status !== 'draft') throw conflict('This adjustment is already adjusted');
    await postAdjustment(client, req, adj);
    await client.query("UPDATE inventory_adjustments SET status = 'adjusted' WHERE id = $1", [adj.id]);
    await audit(client, req, 'approve', 'inventory_adjustment', adj.id, `Inventory adjustment ${adj.number} converted to adjusted`);
    return fetchAdjustment(client, req.orgId, adj.id);
  });
  res.json(result);
});

adjustments.delete('/:id', can('inventory', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const adj = await fetchAdjustment(client, req.orgId, Number(req.params.id), true);
    if (adj.status === 'adjusted') await reverseSource(client, ctxOf(req), 'inventory_adjustment', adj.id);
    await client.query('DELETE FROM inventory_adjustments WHERE id = $1', [adj.id]);
    await audit(client, req, 'delete', 'inventory_adjustment', adj.id, `Inventory adjustment ${adj.number} deleted`);
  });
  res.status(204).end();
});

// =================================================================== transfer orders
export const transfers = Router();

transfers.get('/', can('inventory', 'view'), (req, res) => listDocs(req, res, {
  table: 'transfer_orders',
  select: `d.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
           (SELECT COALESCE(SUM(quantity),0) FROM transfer_order_lines WHERE transfer_order_id = d.id) AS total_quantity`,
  joins: 'JOIN warehouses fw ON fw.id = d.from_warehouse_id JOIN warehouses tw ON tw.id = d.to_warehouse_id',
  dateCol: 'transfer_date', searchCols: ['d.number', 'd.reason', 'fw.name', 'tw.name'],
}));

transfers.get('/next-number', can('inventory', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'transfer_order') });
});

async function fetchTransfer(db, orgId, toId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, fw.name AS from_warehouse_name, tw.name AS to_warehouse_name, u.name AS created_by_name
       FROM transfer_orders d JOIN warehouses fw ON fw.id = d.from_warehouse_id JOIN warehouses tw ON tw.id = d.to_warehouse_id
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, toId],
  );
  if (!rows[0]) throw notFound('Transfer order');
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.tracking AS item_tracking,
            COALESCE(sf.on_hand,0) AS source_on_hand, COALESCE(st.on_hand,0) AS destination_on_hand
       FROM transfer_order_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN stock_levels sf ON sf.item_id = l.item_id AND sf.warehouse_id = $2
       LEFT JOIN stock_levels st ON st.item_id = l.item_id AND st.warehouse_id = $3
      WHERE l.transfer_order_id = $1 ORDER BY l.position, l.id`,
    [toId, rows[0].from_warehouse_id, rows[0].to_warehouse_id],
  );
  return { ...rows[0], lines };
}

transfers.get('/:id', can('inventory', 'view'), async (req, res) => {
  res.json(await fetchTransfer({ query }, req.orgId, Number(req.params.id)));
});

async function parseTransfer(client, req) {
  const b = req.body || {};
  const from = await getWarehouse(client, req.orgId, id(b.from_warehouse_id, { field: 'Source warehouse', required: true }));
  const to = await getWarehouse(client, req.orgId, id(b.to_warehouse_id, { field: 'Destination warehouse', required: true }));
  if (from.id === to.id) throw badRequest('Source and destination warehouses must be different');
  if (!Array.isArray(b.lines) || !b.lines.length) throw badRequest('Add at least one item');
  const lines = b.lines.map((l, i) => ({
    item_id: id(l.item_id, { field: `Line ${i + 1} item`, required: true }),
    quantity: round3(num(l.quantity, { field: `Line ${i + 1} quantity`, required: true, min: 0.001 })),
    tracking: l.tracking || null,
    position: i,
  }));
  if (new Set(lines.map((l) => l.item_id)).size !== lines.length) throw badRequest('Each item can be added only once');
  const items = await loadItems(client, req.orgId, lines.map((l) => l.item_id));
  for (const l of lines) if (!items.get(l.item_id).track_inventory) throw badRequest(`${items.get(l.item_id).name} does not track inventory`);
  return {
    header: {
      transfer_date: date(b.transfer_date, { field: 'Date', required: true }),
      from_warehouse_id: from.id, to_warehouse_id: to.id,
      reason: str(b.reason, { field: 'Reason', max: 500 }),
    },
    lines,
  };
}

async function dispatchTransfer(client, req, t) {
  for (const l of t.lines) {
    const { value, tracking } = await stockOut(client, ctxOf(req), {
      itemId: l.item_id, warehouseId: t.from_warehouse_id, qty: l.quantity, date: t.transfer_date, tracking: l.tracking,
      sourceType: 'transfer_out', sourceId: t.id, sourceNumber: t.number, note: `Transfer to ${t.to_warehouse_name}`,
    });
    await client.query('UPDATE transfer_order_lines SET unit_cost = $2, tracking = $3 WHERE id = $1', [l.id, l.quantity ? value / l.quantity : 0, tracking ? JSON.stringify(tracking) : null]);
  }
  await client.query("UPDATE transfer_orders SET status = 'in_transit' WHERE id = $1", [t.id]);
}

async function receiveTransfer(client, req, t, receivedDate) {
  const { rows: lines } = await client.query('SELECT * FROM transfer_order_lines WHERE transfer_order_id = $1', [t.id]);
  for (const l of lines) {
    await stockIn(client, ctxOf(req), {
      itemId: l.item_id, warehouseId: t.to_warehouse_id, qty: l.quantity, unitCost: l.unit_cost, date: receivedDate, tracking: l.tracking,
      sourceType: 'transfer_in', sourceId: t.id, sourceNumber: t.number, note: `Transfer from ${t.from_warehouse_name}`,
    });
  }
  await client.query("UPDATE transfer_orders SET status = 'received', received_date = $2 WHERE id = $1", [t.id, receivedDate]);
}

transfers.post('/', can('inventory', 'create'), async (req, res) => {
  const result = await tx(async (client) => {
    const { header, lines } = await parseTransfer(client, req);
    const number = await takeNumber(client, req.orgId, 'transfer_order', req.body.number);
    const { rows: [t] } = await client.query(
      `INSERT INTO transfer_orders (org_id, number, transfer_date, from_warehouse_id, to_warehouse_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.orgId, number, header.transfer_date, header.from_warehouse_id, header.to_warehouse_id, header.reason, req.user.id],
    );
    for (const l of lines) {
      await client.query('INSERT INTO transfer_order_lines (transfer_order_id, item_id, quantity, tracking, position) VALUES ($1,$2,$3,$4,$5)', [t.id, l.item_id, l.quantity, l.tracking ? JSON.stringify(l.tracking) : null, l.position]);
    }
    const action = req.body.action; // 'draft' | 'in_transit' | 'received'
    if (action === 'in_transit' || action === 'received') {
      await dispatchTransfer(client, req, await fetchTransfer(client, req.orgId, t.id));
      if (action === 'received') await receiveTransfer(client, req, await fetchTransfer(client, req.orgId, t.id), header.transfer_date);
    }
    await audit(client, req, 'create', 'transfer_order', t.id, `Transfer order ${number} created`);
    return fetchTransfer(client, req.orgId, t.id);
  });
  res.status(201).json(result);
});

transfers.put('/:id', can('inventory', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const cur = await fetchTransfer(client, req.orgId, Number(req.params.id), true);
    if (cur.status !== 'draft') throw conflict('Only draft transfer orders can be edited');
    const { header, lines } = await parseTransfer(client, req);
    await client.query(
      'UPDATE transfer_orders SET transfer_date=$3, from_warehouse_id=$4, to_warehouse_id=$5, reason=$6 WHERE org_id = $1 AND id = $2',
      [req.orgId, cur.id, header.transfer_date, header.from_warehouse_id, header.to_warehouse_id, header.reason],
    );
    await client.query('DELETE FROM transfer_order_lines WHERE transfer_order_id = $1', [cur.id]);
    for (const l of lines) {
      await client.query('INSERT INTO transfer_order_lines (transfer_order_id, item_id, quantity, tracking, position) VALUES ($1,$2,$3,$4,$5)', [cur.id, l.item_id, l.quantity, l.tracking ? JSON.stringify(l.tracking) : null, l.position]);
    }
    await audit(client, req, 'update', 'transfer_order', cur.id, `Transfer order ${cur.number} updated`);
    return fetchTransfer(client, req.orgId, cur.id);
  });
  res.json(result);
});

transfers.post('/:id/dispatch', can('inventory', 'approve'), async (req, res) => {
  const result = await tx(async (client) => {
    const t = await fetchTransfer(client, req.orgId, Number(req.params.id), true);
    if (t.status !== 'draft') throw conflict('Only draft transfer orders can be dispatched');
    await dispatchTransfer(client, req, t);
    await audit(client, req, 'update', 'transfer_order', t.id, `Transfer order ${t.number} marked in transit`);
    return fetchTransfer(client, req.orgId, t.id);
  });
  res.json(result);
});

transfers.post('/:id/receive', can('inventory', 'approve'), async (req, res) => {
  const result = await tx(async (client) => {
    const t = await fetchTransfer(client, req.orgId, Number(req.params.id), true);
    if (t.status !== 'in_transit') throw conflict('Only in-transit transfer orders can be received');
    const receivedDate = date(req.body?.received_date, { field: 'Received date' }) || today();
    if (receivedDate < t.transfer_date) throw badRequest('Received date cannot be before the transfer date');
    await receiveTransfer(client, req, t, receivedDate);
    await audit(client, req, 'update', 'transfer_order', t.id, `Transfer order ${t.number} received`);
    return fetchTransfer(client, req.orgId, t.id);
  });
  res.json(result);
});

transfers.delete('/:id', can('inventory', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const t = await fetchTransfer(client, req.orgId, Number(req.params.id), true);
    await reverseSource(client, ctxOf(req), 'transfer_in', t.id);
    await reverseSource(client, ctxOf(req), 'transfer_out', t.id);
    await client.query('DELETE FROM transfer_orders WHERE id = $1', [t.id]);
    await audit(client, req, 'delete', 'transfer_order', t.id, `Transfer order ${t.number} deleted`);
  });
  res.status(204).end();
});

// =================================================================== assemblies (composite items)
export const assemblies = Router();

assemblies.get('/', can('inventory', 'view'), (req, res) => listDocs(req, res, {
  table: 'assemblies',
  select: 'd.*, i.name AS item_name, i.sku AS item_sku, w.name AS warehouse_name',
  joins: 'JOIN items i ON i.id = d.composite_item_id JOIN warehouses w ON w.id = d.warehouse_id',
  dateCol: 'assembly_date', searchCols: ['d.number', 'i.name', 'i.sku'], filterCols: ['composite_item_id'],
}));

assemblies.get('/:id', can('inventory', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, w.name AS warehouse_name, u.name AS created_by_name
       FROM assemblies d JOIN items i ON i.id = d.composite_item_id JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN users u ON u.id = d.created_by WHERE d.org_id = $1 AND d.id = $2`,
    [req.orgId, Number(req.params.id)],
  );
  if (!rows[0]) throw notFound('Assembly');
  const { rows: movements } = await query(
    `SELECT m.item_id, i.name AS item_name, i.sku AS item_sku, m.quantity, m.value FROM stock_movements m JOIN items i ON i.id = m.item_id
      WHERE m.source_type = 'assembly' AND m.source_id = $1 ORDER BY m.quantity DESC, i.name`,
    [rows[0].id],
  );
  res.json({ ...rows[0], movements });
});

assemblies.post('/', can('inventory', 'create'), async (req, res) => {
  const b = req.body || {};
  const result = await tx(async (client) => {
    const itemId = id(b.composite_item_id, { field: 'Composite item', required: true });
    const { rows: [item] } = await client.query('SELECT * FROM items WHERE org_id = $1 AND id = $2 AND is_composite', [req.orgId, itemId]);
    if (!item) throw badRequest('Select a composite item');
    const wh = await getWarehouse(client, req.orgId, id(b.warehouse_id, { field: 'Warehouse' }));
    const qty = round3(num(b.quantity, { field: 'Quantity', required: true, min: 0.001 }));
    const kind = oneOf(b.kind, ['assemble', 'disassemble'], { field: 'Type', def: 'assemble' });
    const asmDate = date(b.assembly_date, { field: 'Date' }) || today();
    const { rows: comps } = await client.query(
      `SELECT cc.component_item_id, cc.quantity, i.track_inventory, i.cost_price, i.name, i.tracking FROM composite_components cc
         JOIN items i ON i.id = cc.component_item_id WHERE cc.composite_item_id = $1`,
      [itemId],
    );
    if (!comps.length) throw badRequest('This composite item has no components');
    const serialized = comps.find((c) => c.tracking !== 'none');
    if (serialized) throw badRequest(`Assemblies can't use serial- or batch-tracked components (${serialized.name}). Adjust those items separately.`);
    const number = await takeNumber(client, req.orgId, 'assembly', b.number);
    const { rows: [asm] } = await client.query(
      `INSERT INTO assemblies (org_id, number, composite_item_id, warehouse_id, quantity, assembly_date, kind, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.orgId, number, itemId, wh.id, qty, asmDate, kind, str(b.notes, { field: 'Notes', max: 2000 }), req.user.id],
    );
    const ctx = ctxOf(req);
    const base = { warehouseId: wh.id, date: asmDate, sourceType: 'assembly', sourceId: asm.id, sourceNumber: number };
    let total = 0;
    if (kind === 'assemble') {
      for (const c of comps) {
        const need = round3(Number(c.quantity) * qty);
        if (c.track_inventory) {
          const { value } = await stockOut(client, ctx, { ...base, itemId: c.component_item_id, qty: need, note: `Used to assemble ${item.name}` });
          total += value;
        } else {
          total += need * Number(c.cost_price);
        }
      }
      await stockIn(client, ctx, { ...base, itemId, qty, unitCost: total / qty, note: 'Assembled' });
    } else {
      const { value } = await stockOut(client, ctx, { ...base, itemId, qty, note: 'Disassembled' });
      total = value;
      const tracked = comps.filter((c) => c.track_inventory);
      const weights = tracked.map((c) => Number(c.cost_price) * Number(c.quantity));
      const weightSum = weights.reduce((s, w) => s + w, 0);
      for (const [i, c] of tracked.entries()) {
        const share = weightSum > 0 ? weights[i] / weightSum : 1 / tracked.length;
        const outQty = round3(Number(c.quantity) * qty);
        await stockIn(client, ctx, { ...base, itemId: c.component_item_id, qty: outQty, unitCost: (value * share) / outQty, note: `Recovered from ${item.name}` });
      }
    }
    await client.query('UPDATE assemblies SET total_cost = $2 WHERE id = $1', [asm.id, round2(total)]);
    await audit(client, req, 'create', 'assembly', asm.id, `${kind === 'assemble' ? 'Assembled' : 'Disassembled'} ${qty} × ${item.name} (${number})`);
    return { id: asm.id, number };
  });
  res.status(201).json(result);
});

assemblies.delete('/:id', can('inventory', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const { rows: [asm] } = await client.query('SELECT * FROM assemblies WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, Number(req.params.id)]);
    if (!asm) throw notFound('Assembly');
    await reverseSource(client, ctxOf(req), 'assembly', asm.id);
    await client.query('DELETE FROM assemblies WHERE id = $1', [asm.id]);
    await audit(client, req, 'delete', 'assembly', asm.id, `Assembly ${asm.number} deleted`);
  });
  res.status(204).end();
});
