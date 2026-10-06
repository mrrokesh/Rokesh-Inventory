import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, id, bool, oneOf, round2 } from '../lib/validate.js';

const r = Router();

export function applyPriceList(pl, baseRate, customRate) {
  if (!pl) return baseRate;
  if (pl.scheme === 'per_item') return customRate ?? baseRate;
  const pct = Number(pl.percentage) / 100;
  let rate = pl.markup ? baseRate * (1 + pct) : baseRate * (1 - pct);
  if (pl.rounding === 'whole') rate = Math.round(rate);
  else if (pl.rounding === '0.99') rate = Math.floor(rate) + 0.99;
  else if (pl.rounding === '0.50') rate = Math.round(rate * 2) / 2;
  return round2(Math.max(0, rate));
}

r.get('/', can('items', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, (SELECT COUNT(*)::int FROM contacts c WHERE c.price_list_id = p.id) AS contact_count
       FROM price_lists p WHERE p.org_id = $1 ORDER BY p.name`,
    [req.orgId],
  );
  res.json({ data: rows, total: rows.length });
});

r.get('/:id', can('items', 'view'), async (req, res) => {
  const { rows } = await query('SELECT * FROM price_lists WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!rows[0]) throw notFound('Price list');
  const { rows: items } = await query(
    `SELECT pli.item_id, pli.rate, i.name, i.sku, i.selling_price, i.cost_price
       FROM price_list_items pli JOIN items i ON i.id = pli.item_id WHERE pli.price_list_id = $1 ORDER BY i.name`,
    [rows[0].id],
  );
  res.json({ ...rows[0], items });
});

/** Rates for a set of items under a price list: GET /price-lists/:id/rates?item_ids=1,2,3 */
r.get('/:id/rates', async (req, res) => {
  const { rows: [pl] } = await query('SELECT * FROM price_lists WHERE org_id = $1 AND id = $2 AND is_active', [req.orgId, Number(req.params.id)]);
  if (!pl) return res.json({});
  const ids = String(req.query.item_ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.json({});
  const { rows } = await query(
    `SELECT i.id, i.selling_price, i.cost_price, pli.rate AS custom_rate FROM items i
       LEFT JOIN price_list_items pli ON pli.item_id = i.id AND pli.price_list_id = $2
      WHERE i.org_id = $1 AND i.id = ANY($3::bigint[])`,
    [req.orgId, pl.id, ids],
  );
  const out = {};
  for (const it of rows) {
    const base = pl.kind === 'sales' ? Number(it.selling_price) : Number(it.cost_price);
    out[it.id] = applyPriceList(pl, base, it.custom_rate === null ? null : Number(it.custom_rate));
  }
  res.json(out);
});

async function save(req: any, plId?: any) {
  const b = req.body || {};
  const scheme = oneOf(b.scheme, ['percentage', 'per_item'], { field: 'Pricing scheme', def: 'percentage' });
  const values = [
    str(b.name, { field: 'Name', required: true, max: 120 }),
    oneOf(b.kind, ['sales', 'purchase'], { field: 'Type', def: 'sales' }),
    scheme,
    bool(b.markup, true),
    num(b.percentage, { field: 'Percentage', min: 0, max: 1000, def: 0 }),
    oneOf(b.rounding, ['none', 'whole', '0.99', '0.50'], { field: 'Rounding', def: 'none' }),
    str(b.description, { field: 'Description', max: 1000 }),
    bool(b.is_active, true),
  ];
  return tx(async (client) => {
    let row;
    if (plId) {
      const { rows } = await client.query(
        `UPDATE price_lists SET name=$3, kind=$4, scheme=$5, markup=$6, percentage=$7, rounding=$8, description=$9, is_active=$10
          WHERE org_id = $1 AND id = $2 RETURNING *`,
        [req.orgId, plId, ...values],
      );
      if (!rows[0]) throw notFound('Price list');
      row = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO price_lists (org_id, name, kind, scheme, markup, percentage, rounding, description, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.orgId, ...values],
      );
      row = rows[0];
    }
    await client.query('DELETE FROM price_list_items WHERE price_list_id = $1', [row.id]);
    if (scheme === 'per_item') {
      const items = Array.isArray(b.items) ? b.items : [];
      for (const [i, it] of items.entries()) {
        const itemId = id(it.item_id, { field: `Row ${i + 1} item`, required: true });
        const rate = num(it.rate, { field: `Row ${i + 1} rate`, required: true, min: 0 });
        const { rows } = await client.query('SELECT 1 FROM items WHERE org_id = $1 AND id = $2', [req.orgId, itemId]);
        if (!rows[0]) throw badRequest(`Row ${i + 1}: item not found`);
        await client.query(
          'INSERT INTO price_list_items (price_list_id, item_id, rate) VALUES ($1, $2, $3) ON CONFLICT (price_list_id, item_id) DO UPDATE SET rate = EXCLUDED.rate',
          [row.id, itemId, rate],
        );
      }
    }
    await audit(client, req, plId ? 'update' : 'create', 'price_list', row.id, `Price list ${row.name} ${plId ? 'updated' : 'created'}`);
    return row;
  });
}

r.post('/', can('items', 'create'), async (req, res) => res.status(201).json(await save(req)));
r.put('/:id', can('items', 'edit'), async (req, res) => res.json(await save(req, Number(req.params.id))));

r.delete('/:id', can('items', 'delete'), async (req, res) => {
  const plId = Number(req.params.id);
  const { rows: used } = await query('SELECT 1 FROM contacts WHERE price_list_id = $1 LIMIT 1', [plId]);
  if (used.length) throw conflict('This price list is assigned to contacts. Remove it from them first.');
  const { rows } = await query('DELETE FROM price_lists WHERE org_id = $1 AND id = $2 RETURNING name', [req.orgId, plId]);
  if (!rows[0]) throw notFound('Price list');
  await audit({ query }, req, 'delete', 'price_list', plId, `Price list ${rows[0].name} deleted`);
  res.status(204).end();
});

export default r;
