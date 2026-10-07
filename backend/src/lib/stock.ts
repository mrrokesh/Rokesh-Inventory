// Stock engine: on-hand / committed quantities, FIFO cost lots and movement history.
// Every function here must be called with a transaction client.
import { badRequest, conflict } from './errors.js';
import { round2, round3 } from './validate.js';
import { applyTracking, reverseTracking } from './tracking.js';

const EPS = 0.0005;

/** Load items for an org keyed by id; throws if any id is missing. */
export async function loadItems(client, orgId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  if (!unique.length) return new Map();
  const { rows } = await client.query(
    `SELECT id, name, sku, item_type, track_inventory, is_composite, cost_price, selling_price, unit, status
       FROM items WHERE org_id = $1 AND id = ANY($2::bigint[])`,
    [orgId, unique],
  );
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const i of unique) if (!map.has(i)) throw badRequest(`Item #${i} does not exist`);
  return map;
}

async function lockLevel(client, orgId, itemId, warehouseId) {
  await client.query(
    `INSERT INTO stock_levels (org_id, item_id, warehouse_id) VALUES ($1, $2, $3)
     ON CONFLICT (item_id, warehouse_id) DO NOTHING`,
    [orgId, itemId, warehouseId],
  );
  const { rows } = await client.query(
    'SELECT on_hand, committed FROM stock_levels WHERE item_id = $1 AND warehouse_id = $2 FOR UPDATE',
    [itemId, warehouseId],
  );
  return rows[0];
}

async function allowNegative(client, orgId) {
  const { rows } = await client.query('SELECT allow_negative_stock FROM organizations WHERE id = $1', [orgId]);
  return rows[0]?.allow_negative_stock === true;
}

async function itemLabel(client, itemId) {
  const { rows } = await client.query('SELECT name, sku FROM items WHERE id = $1', [itemId]);
  const r = rows[0];
  return r ? (r.sku ? `${r.name} (${r.sku})` : r.name) : `Item #${itemId}`;
}

async function warehouseName(client, warehouseId) {
  const { rows } = await client.query('SELECT name FROM warehouses WHERE id = $1', [warehouseId]);
  return rows[0]?.name || `Warehouse #${warehouseId}`;
}

/** Add stock: creates a FIFO lot and a positive movement. */
export async function stockIn(client, ctx, m) {
  const qty = round3(m.qty);
  if (qty <= 0) return { value: 0 };
  const unitCost = Math.max(0, Number(m.unitCost) || 0);
  await lockLevel(client, ctx.orgId, m.itemId, m.warehouseId);
  await client.query(
    `INSERT INTO stock_lots (org_id, item_id, warehouse_id, lot_date, qty_in, qty_remaining, unit_cost, source_type, source_id)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
    [ctx.orgId, m.itemId, m.warehouseId, m.date, qty, unitCost, m.sourceType, m.sourceId],
  );
  await client.query(
    'UPDATE stock_levels SET on_hand = on_hand + $3 WHERE item_id = $1 AND warehouse_id = $2',
    [m.itemId, m.warehouseId, qty],
  );
  const value = round2(qty * unitCost);
  await insertMovement(client, ctx, m, qty, value);
  const tracking = await applyTracking(client, ctx, m, 1, qty);
  return { value, tracking };
}

/** Remove stock FIFO. Returns the cost value removed (positive number). */
export async function stockOut(client, ctx, m) {
  const qty = round3(m.qty);
  if (qty <= 0) return { value: 0, unitCost: 0 };
  const level = await lockLevel(client, ctx.orgId, m.itemId, m.warehouseId);
  if (Number(level.on_hand) + EPS < qty && !(await allowNegative(client, ctx.orgId))) {
    const label = await itemLabel(client, m.itemId);
    const wh = await warehouseName(client, m.warehouseId);
    throw conflict(`Not enough stock for ${label} in ${wh}: ${Number(level.on_hand)} on hand, ${qty} needed.`);
  }
  const tracking = await applyTracking(client, ctx, m, -1, qty);
  const { rows: lots } = await client.query(
    `SELECT id, qty_remaining, unit_cost FROM stock_lots
      WHERE item_id = $1 AND warehouse_id = $2 AND qty_remaining > 0
      ORDER BY lot_date, id FOR UPDATE`,
    [m.itemId, m.warehouseId],
  );
  let remaining = qty;
  let value = 0;
  let lastCost = null;
  for (const lot of lots) {
    if (remaining <= EPS) break;
    const take = Math.min(remaining, Number(lot.qty_remaining));
    await client.query('UPDATE stock_lots SET qty_remaining = qty_remaining - $2 WHERE id = $1', [lot.id, take]);
    value += take * Number(lot.unit_cost);
    lastCost = Number(lot.unit_cost);
    remaining = round3(remaining - take);
  }
  if (remaining > EPS) {
    // Negative stock allowed: cost the shortfall at the last known cost or the item's cost price.
    if (lastCost === null) {
      const { rows } = await client.query('SELECT cost_price FROM items WHERE id = $1', [m.itemId]);
      lastCost = Number(rows[0]?.cost_price) || 0;
    }
    value += remaining * lastCost;
  }
  value = round2(value);
  await client.query(
    'UPDATE stock_levels SET on_hand = on_hand - $3 WHERE item_id = $1 AND warehouse_id = $2',
    [m.itemId, m.warehouseId, qty],
  );
  await insertMovement(client, ctx, m, -qty, -value);
  return { value, unitCost: qty ? value / qty : 0, tracking };
}

/** Revalue the remaining FIFO lots of an item/warehouse by `delta` (value adjustment). */
export async function revalue(client, ctx, m) {
  const delta = round2(m.delta);
  if (!delta) return;
  await lockLevel(client, ctx.orgId, m.itemId, m.warehouseId);
  const { rows: lots } = await client.query(
    `SELECT id, qty_remaining, unit_cost FROM stock_lots
      WHERE item_id = $1 AND warehouse_id = $2 AND qty_remaining > 0 FOR UPDATE`,
    [m.itemId, m.warehouseId],
  );
  const totalQty = lots.reduce((s, l) => s + Number(l.qty_remaining), 0);
  if (totalQty <= EPS) {
    throw conflict(`${await itemLabel(client, m.itemId)} has no stock in this warehouse to revalue.`);
  }
  const currentValue = lots.reduce((s, l) => s + Number(l.qty_remaining) * Number(l.unit_cost), 0);
  if (currentValue + delta < -EPS) throw badRequest('A value adjustment cannot make stock value negative.');
  const perUnit = delta / totalQty;
  for (const lot of lots) {
    await client.query('UPDATE stock_lots SET unit_cost = GREATEST(0, unit_cost + $2) WHERE id = $1', [lot.id, perUnit]);
  }
  await insertMovement(client, ctx, m, 0, delta);
}

/**
 * Undo every stock effect of a source document (used when deleting/voiding).
 * Stock added by the source can only be removed if none of it has been consumed yet.
 */
export async function reverseSource(client, ctx, sourceType, sourceId) {
  const { rows: [lc] } = await client.query(
    `SELECT c.number FROM landed_cost_lines l JOIN landed_costs c ON c.id = l.landed_cost_id
      WHERE l.source_type = $1 AND l.source_id = $2 AND c.org_id = $3 AND c.status = 'applied' LIMIT 1`,
    [sourceType, sourceId, ctx.orgId],
  );
  if (lc) throw conflict(`Landed cost ${lc.number} has been added to this stock. Void the landed cost first.`);
  await reverseTracking(client, ctx, sourceType, sourceId);
  const { rows: moves } = await client.query(
    `SELECT id, item_id, warehouse_id, quantity, value, movement_date FROM stock_movements
      WHERE org_id = $1 AND source_type = $2 AND source_id = $3`,
    [ctx.orgId, sourceType, sourceId],
  );
  if (!moves.length) return;
  if (moves.some((mv) => Number(mv.quantity) === 0 && Number(mv.value) !== 0)) {
    throw conflict('Value adjustments cannot be reversed. Create a new value adjustment instead.');
  }
  const { rows: lots } = await client.query(
    'SELECT id, item_id, qty_in, qty_remaining FROM stock_lots WHERE source_type = $1 AND source_id = $2 AND org_id = $3 FOR UPDATE',
    [sourceType, sourceId, ctx.orgId],
  );
  for (const lot of lots) {
    if (Math.abs(Number(lot.qty_in) - Number(lot.qty_remaining)) > EPS) {
      throw conflict(`Stock of ${await itemLabel(client, lot.item_id)} added by this transaction has already been used (sold, shipped or transferred), so it cannot be reversed.`);
    }
  }
  if (lots.length) await client.query('DELETE FROM stock_lots WHERE id = ANY($1::bigint[])', [lots.map((l) => l.id)]);
  for (const mv of moves) {
    const q = Number(mv.quantity);
    await lockLevel(client, ctx.orgId, mv.item_id, mv.warehouse_id);
    if (q < 0) {
      // Put removed stock back as a new lot at the cost it left with.
      const unitCost = Math.abs(Number(mv.value)) / Math.abs(q);
      await client.query(
        `INSERT INTO stock_lots (org_id, item_id, warehouse_id, lot_date, qty_in, qty_remaining, unit_cost, source_type, source_id)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'reversal', $7)`,
        [ctx.orgId, mv.item_id, mv.warehouse_id, mv.movement_date, -q, unitCost, mv.id],
      );
    }
    await client.query(
      'UPDATE stock_levels SET on_hand = on_hand - $3 WHERE item_id = $1 AND warehouse_id = $2',
      [mv.item_id, mv.warehouse_id, q],
    );
  }
  await client.query('DELETE FROM stock_movements WHERE id = ANY($1::bigint[])', [moves.map((m) => m.id)]);
}

/**
 * Add `perUnit` to the unit cost of one FIFO lot (landed cost). Records a value-only movement for the
 * part that lands on stock still on hand; returns { onHand, used } values.
 */
export async function addLotCost(client, ctx, lotId, perUnit, m) {
  const { rows: [lot] } = await client.query('SELECT * FROM stock_lots WHERE id = $1 AND org_id = $2 FOR UPDATE', [lotId, ctx.orgId]);
  if (!lot) throw conflict('A received stock batch no longer exists.');
  await lockLevel(client, ctx.orgId, lot.item_id, lot.warehouse_id);
  if (Number(lot.unit_cost) + perUnit < -EPS) throw badRequest('Removing this cost would make the stock cost negative.');
  await client.query('UPDATE stock_lots SET unit_cost = GREATEST(0, unit_cost + $2) WHERE id = $1', [lotId, perUnit]);
  const onHand = round2(perUnit * Number(lot.qty_remaining));
  const used = round2(perUnit * (Number(lot.qty_in) - Number(lot.qty_remaining)));
  if (onHand) await insertMovement(client, ctx, { ...m, itemId: lot.item_id, warehouseId: lot.warehouse_id }, 0, onHand);
  return { onHand, used, lot };
}

/** Adjust committed (reserved for confirmed sales orders) quantity. */
export async function commit(client, ctx, itemId, warehouseId, delta) {
  if (!delta) return;
  await lockLevel(client, ctx.orgId, itemId, warehouseId);
  await client.query(
    'UPDATE stock_levels SET committed = GREATEST(0, committed + $3) WHERE item_id = $1 AND warehouse_id = $2',
    [itemId, warehouseId, round3(delta)],
  );
}

async function insertMovement(client, ctx, m, qty, value) {
  await client.query(
    `INSERT INTO stock_movements (org_id, item_id, warehouse_id, movement_date, quantity, value,
                                  source_type, source_id, source_number, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [ctx.orgId, m.itemId, m.warehouseId, m.date, qty, value, m.sourceType, m.sourceId,
      m.sourceNumber ?? null, m.note ?? null, ctx.userId ?? null],
  );
}

/** Context object built from a request. */
export const ctxOf = (req) => ({ orgId: req.orgId, userId: req.user?.id });
