// Serial-number and batch tracking. Called by the stock engine for items whose
// `tracking` is 'serial' or 'batch'. Every function must run inside a transaction.
//
// Tracking details (m.tracking) look like:
//   serial in/out: { serials: ['SN1', 'SN2'] }
//   batch in:      { batches: [{ batch_no, quantity, mfg_date, expiry_date }] }
//   batch out:     { batches: [{ batch_id | batch_no, quantity }] }
// For stock going out, details are optional: the oldest serials / earliest-expiring batches are picked.
import { badRequest, conflict } from './errors.js';
import { round3 } from './validate.js';

const EPS = 0.0005;

export function normalizeSerials(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  const out = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  for (const s of out) if (s.length > 100) throw badRequest(`Serial number "${s.slice(0, 20)}…" is too long`);
  return out;
}

async function itemInfo(client, itemId) {
  const { rows } = await client.query('SELECT tracking, name, sku FROM items WHERE id = $1', [itemId]);
  return rows[0];
}

const label = (it) => (it.sku ? `${it.name} (${it.sku})` : it.name);

async function entry(client, ctx, m, { serialId = null, batchId = null, qty }) {
  await client.query(
    `INSERT INTO tracking_entries (org_id, source_type, source_id, item_id, warehouse_id, serial_id, batch_id, quantity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.orgId, m.sourceType, m.sourceId, m.itemId, m.warehouseId, serialId, batchId, qty],
  );
}

/**
 * Apply tracking for a stock movement. dir = +1 (in) or -1 (out).
 * Returns the units used: { serials: [...] } or { batches: [{ batch_no, quantity, mfg_date, expiry_date }] }, or null.
 */
export async function applyTracking(client, ctx, m, dir, qty) {
  const it = await itemInfo(client, m.itemId);
  if (!it || it.tracking === 'none') return null;
  const t = m.tracking || {};

  if (it.tracking === 'serial') {
    if (Math.abs(qty - Math.round(qty)) > EPS) throw badRequest(`${label(it)} is tracked by serial number, so quantities must be whole numbers`);
    const n = Math.round(qty);
    let serials = normalizeSerials(t.serials);
    if (dir > 0) {
      if (serials.length !== n) throw badRequest(`Enter ${n} serial number(s) for ${label(it)} (${serials.length} entered)`);
      for (const s of serials) {
        const { rows: [ex] } = await client.query(
          'SELECT id, status, warehouse_id FROM serial_numbers WHERE org_id = $1 AND item_id = $2 AND serial = $3 FOR UPDATE',
          [ctx.orgId, m.itemId, s],
        );
        let id;
        if (ex) {
          if (ex.status === 'in_stock') throw conflict(`Serial number ${s} of ${label(it)} is already in stock`);
          await client.query("UPDATE serial_numbers SET status = 'in_stock', warehouse_id = $2 WHERE id = $1", [ex.id, m.warehouseId]);
          id = ex.id;
        } else {
          const { rows: [r] } = await client.query(
            "INSERT INTO serial_numbers (org_id, item_id, serial, warehouse_id, status) VALUES ($1,$2,$3,$4,'in_stock') RETURNING id",
            [ctx.orgId, m.itemId, s, m.warehouseId],
          );
          id = r.id;
        }
        await entry(client, ctx, m, { serialId: id, qty: 1 });
      }
      return { serials };
    }
    // out
    let rows;
    if (serials.length) {
      if (serials.length !== n) throw badRequest(`Select ${n} serial number(s) for ${label(it)} (${serials.length} selected)`);
      ({ rows } = await client.query(
        `SELECT id, serial FROM serial_numbers WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3 AND status = 'in_stock'
            AND serial = ANY($4::text[]) FOR UPDATE`,
        [ctx.orgId, m.itemId, m.warehouseId, serials],
      ));
      if (rows.length !== n) {
        const found = new Set(rows.map((r) => r.serial));
        throw conflict(`Serial number(s) not in stock in this warehouse: ${serials.filter((s) => !found.has(s)).join(', ')}`);
      }
    } else {
      ({ rows } = await client.query(
        `SELECT id, serial FROM serial_numbers WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3 AND status = 'in_stock'
          ORDER BY created_at, id LIMIT $4 FOR UPDATE`,
        [ctx.orgId, m.itemId, m.warehouseId, n],
      ));
      if (rows.length < n) throw conflict(`Only ${rows.length} serial-numbered unit(s) of ${label(it)} are in stock here; ${n} needed`);
      serials = rows.map((r) => r.serial);
    }
    for (const r of rows) {
      await client.query("UPDATE serial_numbers SET status = 'out', warehouse_id = NULL WHERE id = $1", [r.id]);
      await entry(client, ctx, m, { serialId: r.id, qty: -1 });
    }
    return { serials };
  }

  // ---- batch
  const batches = Array.isArray(t.batches) ? t.batches.filter((b) => Number(b.quantity) > 0) : [];
  if (dir > 0) {
    if (!batches.length) throw badRequest(`Enter the batch number(s) for ${label(it)}`);
    const sum = round3(batches.reduce((s, b) => s + Number(b.quantity), 0));
    if (Math.abs(sum - qty) > EPS) throw badRequest(`Batch quantities for ${label(it)} add up to ${sum}, but ${qty} are being added`);
    const used = [];
    for (const b of batches) {
      const no = String(b.batch_no || '').trim();
      if (!no) throw badRequest(`Enter a batch number for ${label(it)}`);
      const q = round3(Number(b.quantity));
      const { rows: [r] } = await client.query(
        `INSERT INTO batches (org_id, item_id, warehouse_id, batch_no, mfg_date, expiry_date, quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (item_id, warehouse_id, batch_no) DO UPDATE
           SET quantity = batches.quantity + EXCLUDED.quantity,
               mfg_date = COALESCE(EXCLUDED.mfg_date, batches.mfg_date),
               expiry_date = COALESCE(EXCLUDED.expiry_date, batches.expiry_date)
         RETURNING id, mfg_date, expiry_date`,
        [ctx.orgId, m.itemId, m.warehouseId, no, b.mfg_date || null, b.expiry_date || null, q],
      );
      await entry(client, ctx, m, { batchId: r.id, qty: q });
      used.push({ batch_no: no, quantity: q, mfg_date: r.mfg_date, expiry_date: r.expiry_date });
    }
    return { batches: used };
  }
  // out
  let picks = [];
  if (batches.length) {
    const sum = round3(batches.reduce((s, b) => s + Number(b.quantity), 0));
    if (Math.abs(sum - qty) > EPS) throw badRequest(`Batch quantities for ${label(it)} add up to ${sum}, but ${qty} are needed`);
    for (const b of batches) {
      const { rows: [r] } = await client.query(
        `SELECT * FROM batches WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3 AND ${b.batch_id ? 'id = $4' : 'batch_no = $4'} FOR UPDATE`,
        [ctx.orgId, m.itemId, m.warehouseId, b.batch_id || String(b.batch_no || '').trim()],
      );
      if (!r) throw conflict(`Batch ${b.batch_no || b.batch_id} of ${label(it)} is not in this warehouse`);
      picks.push({ r, q: round3(Number(b.quantity)) });
    }
  } else {
    // First-expiry-first-out
    const { rows } = await client.query(
      `SELECT * FROM batches WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3 AND quantity > 0
        ORDER BY expiry_date NULLS LAST, created_at, id FOR UPDATE`,
      [ctx.orgId, m.itemId, m.warehouseId],
    );
    let left = qty;
    for (const r of rows) {
      if (left <= EPS) break;
      const q = round3(Math.min(left, Number(r.quantity)));
      picks.push({ r, q });
      left = round3(left - q);
    }
    if (left > EPS) throw conflict(`Not enough batch stock of ${label(it)} in this warehouse (${round3(qty - left)} available, ${qty} needed)`);
  }
  const used = [];
  for (const { r, q } of picks) {
    if (Number(r.quantity) + EPS < q) throw conflict(`Batch ${r.batch_no} of ${label(it)} has only ${Number(r.quantity)} left`);
    await client.query('UPDATE batches SET quantity = quantity - $2 WHERE id = $1', [r.id, q]);
    await entry(client, ctx, m, { batchId: r.id, qty: -q });
    used.push({ batch_no: r.batch_no, quantity: q, mfg_date: r.mfg_date, expiry_date: r.expiry_date });
  }
  return { batches: used };
}

/** Undo the tracking effects of a source document. */
export async function reverseTracking(client, ctx, sourceType, sourceId) {
  const { rows } = await client.query(
    `SELECT e.*, s.status AS serial_status, s.warehouse_id AS serial_wh, s.serial, b.quantity AS batch_qty, b.batch_no
       FROM tracking_entries e
       LEFT JOIN serial_numbers s ON s.id = e.serial_id
       LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.org_id = $1 AND e.source_type = $2 AND e.source_id = $3 ORDER BY e.id`,
    [ctx.orgId, sourceType, sourceId],
  );
  for (const e of rows) {
    const q = Number(e.quantity);
    if (e.serial_id) {
      if (q > 0) {
        if (e.serial_status !== 'in_stock' || e.serial_wh !== e.warehouse_id) {
          throw conflict(`Serial number ${e.serial} has already been used, so this transaction cannot be reversed`);
        }
        await client.query('DELETE FROM tracking_entries WHERE id = $1', [e.id]);
        const { rows: other } = await client.query('SELECT 1 FROM tracking_entries WHERE serial_id = $1 LIMIT 1', [e.serial_id]);
        if (other.length) await client.query("UPDATE serial_numbers SET status = 'out', warehouse_id = NULL WHERE id = $1", [e.serial_id]);
        else await client.query('DELETE FROM serial_numbers WHERE id = $1', [e.serial_id]);
      } else {
        if (e.serial_status === 'in_stock') throw conflict(`Serial number ${e.serial} is back in stock elsewhere, so this transaction cannot be reversed`);
        await client.query("UPDATE serial_numbers SET status = 'in_stock', warehouse_id = $2 WHERE id = $1", [e.serial_id, e.warehouse_id]);
        await client.query('DELETE FROM tracking_entries WHERE id = $1', [e.id]);
      }
    } else if (e.batch_id) {
      if (q > 0 && Number(e.batch_qty) + EPS < q) throw conflict(`Batch ${e.batch_no} has already been used, so this transaction cannot be reversed`);
      await client.query('UPDATE batches SET quantity = quantity - $2 WHERE id = $1', [e.batch_id, q]);
      await client.query('DELETE FROM tracking_entries WHERE id = $1', [e.id]);
    }
  }
}

/** Tracking units recorded against a source (for display), grouped by item. */
export async function trackingFor(db, orgId, sourceType, sourceIds) {
  const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
  if (!ids.length) return {};
  const { rows } = await db.query(
    `SELECT e.item_id, s.serial, b.batch_no, b.expiry_date, ABS(e.quantity) AS quantity
       FROM tracking_entries e LEFT JOIN serial_numbers s ON s.id = e.serial_id LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.org_id = $1 AND e.source_type = $2 AND e.source_id = ANY($3::bigint[]) ORDER BY s.serial, b.batch_no`,
    [orgId, sourceType, ids],
  );
  const out = {};
  for (const r of rows) {
    out[r.item_id] = out[r.item_id] || [];
    out[r.item_id].push(r.serial ? r.serial : `${r.batch_no} × ${Number(r.quantity)}${r.expiry_date ? ` (exp ${r.expiry_date})` : ''}`);
  }
  return out;
}
