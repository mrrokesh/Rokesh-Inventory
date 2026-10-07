import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, id, date, today, listParams, round3 } from '../lib/validate.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { stockIn, stockOut, ctxOf, loadItems } from '../lib/stock.js';
import { getWarehouse } from '../lib/documents.js';

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

// =================================================================== stock counts
export const stockCounts = Router();

stockCounts.get('/', can('inventory', 'view'), (req, res) => listDocs(req, res, {
  table: 'stock_counts',
  select: `d.*, w.name AS warehouse_name, u.name AS created_by_name,
           (SELECT COUNT(*)::int FROM stock_count_lines WHERE stock_count_id = d.id) AS line_count,
           (SELECT COUNT(*)::int FROM stock_count_lines WHERE stock_count_id = d.id AND counted_qty IS NOT NULL) AS counted_lines`,
  joins: 'JOIN warehouses w ON w.id = d.warehouse_id LEFT JOIN users u ON u.id = d.created_by',
  dateCol: 'count_date', searchCols: ['d.number', 'd.notes'], filterCols: ['warehouse_id'],
}));

stockCounts.get('/next-number', can('inventory', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'stock_count') });
});

async function fetchStockCount(db, orgId, countId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, w.name AS warehouse_name, u.name AS created_by_name
       FROM stock_counts d JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, countId],
  );
  if (!rows[0]) throw notFound('Stock count');
  // While a count is open, compare against the stock on hand *now* (sales and receipts may happen
  // during the count). Once completed, system_qty holds the quantity the adjustment was based on.
  const open = ['draft', 'in_progress'].includes(rows[0].status);
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.tracking AS item_tracking,
            ${open ? 'COALESCE(sl.on_hand, 0)' : 'l.system_qty'} AS current_qty,
            (l.counted_qty - ${open ? 'COALESCE(sl.on_hand, 0)' : 'l.system_qty'}) AS difference
       FROM stock_count_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN stock_levels sl ON sl.item_id = l.item_id AND sl.warehouse_id = $2
      WHERE l.stock_count_id = $1 ORDER BY l.position, l.id`,
    [countId, rows[0].warehouse_id],
  );
  return { ...rows[0], lines };
}

stockCounts.get('/:id', can('inventory', 'view'), async (req, res) => {
  res.json(await fetchStockCount({ query }, req.orgId, Number(req.params.id)));
});

stockCounts.post('/', can('inventory', 'create'), async (req, res) => {
  const result = await tx(async (client) => {
    const b = req.body || {};
    const wh = await getWarehouse(client, req.orgId, id(b.warehouse_id, { field: 'Warehouse' }));
    const countDate = date(b.count_date, { field: 'Date', required: true }) || today();
    const notes = str(b.notes, { field: 'Notes', max: 2000 });
    const number = await takeNumber(client, req.orgId, 'stock_count', b.number);

    let itemIds = Array.isArray(b.item_ids) ? b.item_ids.map((x) => id(x, { field: 'Item' })).filter(Boolean) : [];
    if (b.fill_warehouse) {
      const { rows } = await client.query(
        `SELECT i.id FROM items i
           JOIN stock_levels sl ON sl.item_id = i.id AND sl.warehouse_id = $2
          WHERE i.org_id = $1 AND i.track_inventory AND i.status = 'active' AND sl.on_hand <> 0
          ORDER BY i.name`,
        [req.orgId, wh.id],
      );
      itemIds = rows.map((r) => r.id);
    }
    if (!itemIds.length && Array.isArray(b.lines) && b.lines.length) {
      itemIds = b.lines.map((l, i) => id(l.item_id, { field: `Line ${i + 1} item`, required: true }));
    }
    if (!itemIds.length) {
      throw badRequest(b.fill_warehouse
        ? 'This warehouse has no stocked items to count. Add items with stock, or choose specific items.'
        : 'Add at least one item, or fill from warehouse stock');
    }

    const items = await loadItems(client, req.orgId, itemIds);
    for (const itemId of itemIds) {
      if (!items.get(itemId).track_inventory) throw badRequest(`${items.get(itemId).name} does not track inventory`);
    }

    const { rows: [sc] } = await client.query(
      `INSERT INTO stock_counts (org_id, number, count_date, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'in_progress',$6) RETURNING id`,
      [req.orgId, number, countDate, wh.id, notes, req.user.id],
    );

    let pos = 0;
    for (const itemId of [...new Set(itemIds)]) {
      const { rows: [lvl] } = await client.query(
        'SELECT COALESCE(on_hand,0) AS on_hand FROM stock_levels WHERE item_id = $1 AND warehouse_id = $2',
        [itemId, wh.id],
      );
      const counted = Array.isArray(b.lines)
        ? b.lines.find((l) => Number(l.item_id) === itemId)?.counted_qty
        : undefined;
      await client.query(
        `INSERT INTO stock_count_lines (stock_count_id, item_id, system_qty, counted_qty, position)
         VALUES ($1,$2,$3,$4,$5)`,
        [sc.id, itemId, lvl?.on_hand ?? 0, counted === undefined || counted === '' || counted === null ? null : round3(num(counted, { field: 'Counted quantity' })), pos++],
      );
    }
    await audit(client, req, 'create', 'stock_count', sc.id, `Stock count ${number} created`);
    return fetchStockCount(client, req.orgId, sc.id);
  });
  res.status(201).json(result);
});

stockCounts.put('/:id', can('inventory', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const cur = await fetchStockCount(client, req.orgId, Number(req.params.id), true);
    if (!['draft', 'in_progress'].includes(cur.status)) throw conflict('Only open stock counts can be edited');
    const b = req.body || {};
    await client.query(
      `UPDATE stock_counts SET count_date = $3, notes = $4, status = 'in_progress'
        WHERE org_id = $1 AND id = $2`,
      [req.orgId, cur.id, date(b.count_date, { field: 'Date', required: true }) || cur.count_date, str(b.notes, { field: 'Notes', max: 2000 })],
    );
    if (Array.isArray(b.lines)) {
      for (const l of b.lines) {
        const lineId = id(l.id, { field: 'Line' });
        if (!lineId) continue;
        const counted = l.counted_qty === '' || l.counted_qty === null || l.counted_qty === undefined
          ? null
          : round3(num(l.counted_qty, { field: 'Counted quantity', min: 0 }));
        await client.query(
          'UPDATE stock_count_lines SET counted_qty = $3, tracking = $4 WHERE id = $1 AND stock_count_id = $2',
          [lineId, cur.id, counted, l.tracking ? JSON.stringify(l.tracking) : null],
        );
      }
    }
    await audit(client, req, 'update', 'stock_count', cur.id, `Stock count ${cur.number} updated`);
    return fetchStockCount(client, req.orgId, cur.id);
  });
  res.json(result);
});

stockCounts.post('/:id/complete', can('inventory', 'approve'), async (req, res) => {
  const result = await tx(async (client) => {
    const sc = await fetchStockCount(client, req.orgId, Number(req.params.id), true);
    if (!['draft', 'in_progress'].includes(sc.status)) throw conflict('This stock count is already completed or cancelled');
    // Re-read stock on hand under lock so the adjustment brings stock exactly to the counted quantity,
    // even if goods moved while the count was in progress.
    for (const l of sc.lines) {
      const { rows: [lvl] } = await client.query(
        'SELECT on_hand FROM stock_levels WHERE item_id = $1 AND warehouse_id = $2 FOR UPDATE',
        [l.item_id, sc.warehouse_id],
      );
      const onHand = round3(Number(lvl?.on_hand ?? 0));
      l.current_qty = onHand;
      l.difference = l.counted_qty === null ? null : round3(Number(l.counted_qty) - onHand);
      await client.query('UPDATE stock_count_lines SET system_qty = $2 WHERE id = $1', [l.id, onHand]);
    }
    const diffs = sc.lines.filter((l) => l.counted_qty !== null && Number(l.difference) !== 0);
    const missing = diffs.find((l) => l.item_tracking !== 'none' && Number(l.difference) > 0 && !l.tracking);
    if (missing) {
      const what = missing.item_tracking === 'serial' ? 'serial numbers' : 'batch details';
      throw badRequest(`${missing.item_name}: you counted ${Number(missing.difference)} more than in stock. Add the ${what} for the extra units before completing.`);
    }
    let adjustmentId = null;
    if (diffs.length) {
      const number = await takeNumber(client, req.orgId, 'inventory_adjustment');
      const { rows: [adj] } = await client.query(
        `INSERT INTO inventory_adjustments (org_id, number, reference, mode, adj_date, warehouse_id, account, reason, description, status, created_by)
         VALUES ($1,$2,$3,'quantity',$4,$5,'Cost of Goods Sold','Stocktaking results',$6,'adjusted',$7) RETURNING id`,
        [req.orgId, number, sc.number, sc.count_date, sc.warehouse_id, `From stock count ${sc.number}`, req.user.id],
      );
      adjustmentId = adj.id;
      const ctx = ctxOf(req);
      const items = await loadItems(client, req.orgId, diffs.map((l) => l.item_id));
      let pos = 0;
      for (const l of diffs) {
        const qtyAdj = round3(Number(l.difference));
        await client.query(
          `INSERT INTO inventory_adjustment_lines (adjustment_id, item_id, qty_adjusted, unit_cost, value_adjusted, tracking, position)
           VALUES ($1,$2,$3,$4,0,$5,$6)`,
          [adj.id, l.item_id, qtyAdj, qtyAdj > 0 ? items.get(l.item_id).cost_price : null, l.tracking ? JSON.stringify(l.tracking) : null, pos++],
        );
        const base = {
          itemId: l.item_id, warehouseId: sc.warehouse_id, date: sc.count_date, tracking: l.tracking || undefined,
          sourceType: 'inventory_adjustment', sourceId: adj.id, sourceNumber: number, note: `Stock count ${sc.number}`,
        };
        if (qtyAdj > 0) await stockIn(client, ctx, { ...base, qty: qtyAdj, unitCost: items.get(l.item_id).cost_price });
        else await stockOut(client, ctx, { ...base, qty: -qtyAdj });
      }
      await audit(client, req, 'create', 'inventory_adjustment', adj.id, `Inventory adjustment ${number} created from stock count ${sc.number}`);
    }
    await client.query(
      `UPDATE stock_counts SET status = 'completed', completed_at = now(), adjustment_id = $2 WHERE id = $1`,
      [sc.id, adjustmentId],
    );
    await audit(client, req, 'approve', 'stock_count', sc.id, `Stock count ${sc.number} completed`);
    return fetchStockCount(client, req.orgId, sc.id);
  });
  res.json(result);
});

stockCounts.post('/:id/cancel', can('inventory', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const sc = await fetchStockCount(client, req.orgId, Number(req.params.id), true);
    if (sc.status === 'completed') throw conflict('Completed stock counts cannot be cancelled');
    if (sc.status === 'cancelled') throw conflict('Already cancelled');
    await client.query("UPDATE stock_counts SET status = 'cancelled' WHERE id = $1", [sc.id]);
    await audit(client, req, 'update', 'stock_count', sc.id, `Stock count ${sc.number} cancelled`);
    return fetchStockCount(client, req.orgId, sc.id);
  });
  res.json(result);
});

stockCounts.delete('/:id', can('inventory', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const sc = await fetchStockCount(client, req.orgId, Number(req.params.id), true);
    if (sc.status === 'completed') throw conflict('Completed stock counts cannot be deleted');
    await client.query('DELETE FROM stock_counts WHERE id = $1', [sc.id]);
    await audit(client, req, 'delete', 'stock_count', sc.id, `Stock count ${sc.number} deleted`);
  });
  res.status(204).end();
});

// =================================================================== picklists
export const picklists = Router();

picklists.get('/', can('packages', 'view'), (req, res) => listDocs(req, res, {
  table: 'picklists',
  select: `d.*, w.name AS warehouse_name, so.number AS sales_order_number, c.display_name AS customer_name, u.name AS created_by_name,
           (SELECT COALESCE(SUM(quantity_to_pick),0) FROM picklist_lines WHERE picklist_id = d.id) AS total_qty`,
  joins: `JOIN warehouses w ON w.id = d.warehouse_id
          LEFT JOIN sales_orders so ON so.id = d.sales_order_id
          LEFT JOIN contacts c ON c.id = so.contact_id
          LEFT JOIN users u ON u.id = d.created_by`,
  dateCol: 'pick_date', searchCols: ['d.number', 'so.number', 'c.display_name', 'd.notes'], filterCols: ['warehouse_id', 'sales_order_id'],
}));

picklists.get('/next-number', can('packages', 'create'), async (req, res) => {
  res.json({ number: await peekNumber({ query }, req.orgId, 'picklist') });
});

async function fetchPicklist(db, orgId, plId, lock = false) {
  const { rows } = await db.query(
    `SELECT d.*, w.name AS warehouse_name, so.number AS sales_order_number, c.display_name AS customer_name, u.name AS created_by_name
       FROM picklists d JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN sales_orders so ON so.id = d.sales_order_id
       LEFT JOIN contacts c ON c.id = so.contact_id
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
    [orgId, plId],
  );
  if (!rows[0]) throw notFound('Picklist');
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit,
            COALESCE(sl.on_hand,0) AS on_hand
       FROM picklist_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN stock_levels sl ON sl.item_id = l.item_id AND sl.warehouse_id = $2
      WHERE l.picklist_id = $1 ORDER BY l.position, l.id`,
    [plId, rows[0].warehouse_id],
  );
  return { ...rows[0], lines };
}

picklists.get('/:id', can('packages', 'view'), async (req, res) => {
  res.json(await fetchPicklist({ query }, req.orgId, Number(req.params.id)));
});

picklists.post('/', can('packages', 'create'), async (req, res) => {
  const result = await tx(async (client) => {
    const b = req.body || {};
    const soId = id(b.sales_order_id, { field: 'Sales order', required: true });
    const { rows: [so] } = await client.query(
      `SELECT so.*, c.display_name AS customer_name FROM sales_orders so
         JOIN contacts c ON c.id = so.contact_id
        WHERE so.org_id = $1 AND so.id = $2 FOR UPDATE OF so`,
      [req.orgId, soId],
    );
    if (!so) throw notFound('Sales order');
    if (so.status !== 'confirmed') throw conflict('Only confirmed sales orders can be picked');
    const wh = await getWarehouse(client, req.orgId, id(b.warehouse_id, { field: 'Warehouse' }) || so.warehouse_id);
    const { rows: soLines } = await client.query(
      `SELECT l.*, i.name AS item_name, i.track_inventory
         FROM sales_order_lines l JOIN items i ON i.id = l.item_id
        WHERE l.doc_id = $1 ORDER BY l.position, l.id`,
      [soId],
    );
    // Quantities already on other open (not yet picked) picklists for this order, so two picklists
    // can't send pickers after the same goods.
    const { rows: openRows } = await client.query(
      `SELECT pl.sales_order_line_id, SUM(pl.quantity_to_pick) AS qty
         FROM picklist_lines pl JOIN picklists p ON p.id = pl.picklist_id
        WHERE p.sales_order_id = $1 AND p.status = 'draft' AND pl.sales_order_line_id IS NOT NULL
        GROUP BY pl.sales_order_line_id`,
      [soId],
    );
    const onOpenPicklists = new Map(openRows.map((r) => [Number(r.sales_order_line_id), Number(r.qty)]));
    const remaining = (l) => round3(Number(l.quantity) - Number(l.qty_packed || 0) - (onOpenPicklists.get(Number(l.id)) || 0));
    const lines = Array.isArray(b.lines) && b.lines.length
      ? b.lines.map((l, i) => {
        const line = {
          item_id: id(l.item_id, { field: `Line ${i + 1} item`, required: true }),
          sales_order_line_id: id(l.sales_order_line_id, { field: 'Sales order line' }),
          quantity_to_pick: round3(num(l.quantity_to_pick, { field: `Line ${i + 1} quantity`, required: true, min: 0.001 })),
        };
        const sol = line.sales_order_line_id && soLines.find((s) => Number(s.id) === line.sales_order_line_id);
        if (line.sales_order_line_id && !sol) throw badRequest(`Line ${i + 1} does not belong to this sales order`);
        if (sol && line.quantity_to_pick > remaining(sol) + 0.0005) {
          throw badRequest(`${sol.item_name}: only ${Math.max(0, remaining(sol))} left to pick (the rest is packed or on another open picklist)`);
        }
        return line;
      })
      : soLines.filter((l) => l.track_inventory && remaining(l) > 0).map((l) => ({
        item_id: l.item_id,
        sales_order_line_id: l.id,
        quantity_to_pick: remaining(l),
      }));
    if (!lines.length) throw badRequest('Nothing left to pick on this sales order — it is fully packed or already on an open picklist');

    const number = await takeNumber(client, req.orgId, 'picklist', b.number);
    const { rows: [pl] } = await client.query(
      `INSERT INTO picklists (org_id, number, pick_date, warehouse_id, sales_order_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.orgId, number, date(b.pick_date, { field: 'Date', required: true }) || today(), wh.id, soId, str(b.notes, { field: 'Notes', max: 2000 }), req.user.id],
    );
    let pos = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO picklist_lines (picklist_id, item_id, sales_order_line_id, quantity_to_pick, position)
         VALUES ($1,$2,$3,$4,$5)`,
        [pl.id, l.item_id, l.sales_order_line_id || null, l.quantity_to_pick, pos++],
      );
    }
    await audit(client, req, 'create', 'picklist', pl.id, `Picklist ${number} created for ${so.number}`);
    return fetchPicklist(client, req.orgId, pl.id);
  });
  res.status(201).json(result);
});

picklists.post('/:id/pick', can('packages', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const pl = await fetchPicklist(client, req.orgId, Number(req.params.id), true);
    if (pl.status !== 'draft') throw conflict('This picklist is already picked or cancelled');
    const b = req.body || {};
    if (Array.isArray(b.lines)) {
      for (const l of b.lines) {
        const lineId = id(l.id, { field: 'Line' });
        if (!lineId) continue;
        const qp = round3(num(l.quantity_picked, { field: 'Picked quantity', min: 0 }));
        await client.query(
          'UPDATE picklist_lines SET quantity_picked = $3 WHERE id = $1 AND picklist_id = $2',
          [lineId, pl.id, qp],
        );
      }
    } else {
      await client.query(
        'UPDATE picklist_lines SET quantity_picked = quantity_to_pick WHERE picklist_id = $1',
        [pl.id],
      );
    }
    await client.query("UPDATE picklists SET status = 'picked', picked_at = now() WHERE id = $1", [pl.id]);
    await audit(client, req, 'approve', 'picklist', pl.id, `Picklist ${pl.number} marked picked`);
    return fetchPicklist(client, req.orgId, pl.id);
  });
  res.json(result);
});

picklists.post('/:id/cancel', can('packages', 'edit'), async (req, res) => {
  const result = await tx(async (client) => {
    const pl = await fetchPicklist(client, req.orgId, Number(req.params.id), true);
    if (pl.status === 'cancelled') throw conflict('Already cancelled');
    if (pl.status === 'picked') throw conflict('Picked picklists cannot be cancelled — delete and recreate if needed');
    await client.query("UPDATE picklists SET status = 'cancelled' WHERE id = $1", [pl.id]);
    await audit(client, req, 'update', 'picklist', pl.id, `Picklist ${pl.number} cancelled`);
    return fetchPicklist(client, req.orgId, pl.id);
  });
  res.json(result);
});

picklists.delete('/:id', can('packages', 'delete'), async (req, res) => {
  await tx(async (client) => {
    const pl = await fetchPicklist(client, req.orgId, Number(req.params.id), true);
    await client.query('DELETE FROM picklists WHERE id = $1', [pl.id]);
    await audit(client, req, 'delete', 'picklist', pl.id, `Picklist ${pl.number} deleted`);
  });
  res.status(204).end();
});
