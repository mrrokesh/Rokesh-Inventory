import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str } from '../lib/validate.js';
import { parseItem, insertItem } from './items.js';

const r = Router();

function parseAttributes(input) {
  if (!Array.isArray(input) || !input.length) throw badRequest('Add at least one attribute (e.g. Color, Size)');
  if (input.length > 3) throw badRequest('An item group can have at most 3 attributes');
  return input.map((a, i) => {
    const name = str(a.name, { field: `Attribute ${i + 1}`, required: true, max: 50 });
    const options = [...new Set((Array.isArray(a.options) ? a.options : []).map((o) => String(o).trim()).filter(Boolean))];
    if (!options.length) throw badRequest(`Add options for ${name}`);
    return { name, options };
  });
}

r.get('/', can('items', 'view'), async (req, res) => {
  const { rows } = await query(
    `SELECT g.*, COUNT(i.id)::int AS item_count,
            COALESCE(SUM(s.on_hand), 0) AS stock_on_hand
       FROM item_groups g
       LEFT JOIN items i ON i.group_id = g.id
       LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand FROM stock_levels WHERE org_id = $1 GROUP BY item_id) s ON s.item_id = i.id
      WHERE g.org_id = $1 ${req.query.search ? 'AND g.name ILIKE $2' : ''}
      GROUP BY g.id ORDER BY g.name`,
    req.query.search ? [req.orgId, `%${req.query.search}%`] : [req.orgId],
  );
  res.json({ data: rows, total: rows.length });
});

r.get('/:id', can('items', 'view'), async (req, res) => {
  const { rows } = await query('SELECT * FROM item_groups WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!rows[0]) throw notFound('Item group');
  const { rows: items } = await query(
    `SELECT i.*, COALESCE(s.on_hand,0) AS stock_on_hand, COALESCE(s.committed,0) AS committed_stock
       FROM items i LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(committed) AS committed FROM stock_levels GROUP BY item_id) s ON s.item_id = i.id
      WHERE i.group_id = $1 ORDER BY i.name`,
    [rows[0].id],
  );
  res.json({ ...rows[0], items });
});

async function createVariants(client, req, group, variants) {
  const created = [];
  for (const [i, v] of (Array.isArray(variants) ? variants : []).entries()) {
    const attrs = v.attributes && typeof v.attributes === 'object' ? v.attributes : {};
    for (const a of group.attributes) {
      if (!attrs[a.name] || !a.options.includes(attrs[a.name])) throw badRequest(`Variant ${i + 1}: choose a valid ${a.name}`);
    }
    const name = v.name || `${group.name} - ${group.attributes.map((a) => attrs[a.name]).join('/')}`;
    const parsed = await parseItem({
      ...v, name, unit: v.unit || group.unit, category: v.category || group.category, brand: v.brand || group.brand,
      item_type: 'goods', attributes: attrs,
    }, req);
    created.push(await insertItem(client, req, parsed, { group_id: group.id, is_composite: false }));
  }
  return created;
}

r.post('/', can('items', 'create'), async (req, res) => {
  const b = req.body || {};
  const attributes = parseAttributes(b.attributes);
  if (!Array.isArray(b.variants) || !b.variants.length) throw badRequest('Add at least one variant');
  const group = await tx(async (client) => {
    const { rows: [g] } = await client.query(
      `INSERT INTO item_groups (org_id, name, description, unit, category, brand, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.orgId, str(b.name, { field: 'Group name', required: true, max: 200 }), str(b.description, { field: 'Description', max: 2000 }),
        str(b.unit, { field: 'Unit', max: 30 }), str(b.category, { field: 'Category', max: 100 }), str(b.brand, { field: 'Brand', max: 100 }),
        JSON.stringify(attributes)],
    );
    const items = await createVariants(client, req, g, b.variants);
    await audit(client, req, 'create', 'item_group', g.id, `Item group ${g.name} created with ${items.length} variants`);
    return g;
  });
  res.status(201).json(group);
});

r.put('/:id', can('items', 'edit'), async (req, res) => {
  const b = req.body || {};
  const groupId = Number(req.params.id);
  const attributes = parseAttributes(b.attributes);
  const group = await tx(async (client) => {
    const { rows: [cur] } = await client.query('SELECT * FROM item_groups WHERE org_id = $1 AND id = $2 FOR UPDATE', [req.orgId, groupId]);
    if (!cur) throw notFound('Item group');
    // Existing options cannot be removed if a variant uses them.
    const { rows: items } = await client.query('SELECT attributes FROM items WHERE group_id = $1', [groupId]);
    for (const it of items) {
      for (const [k, val] of Object.entries(it.attributes || {})) {
        const a = attributes.find((x) => x.name === k);
        if (!a || !a.options.includes(val)) throw conflict(`Option "${k}: ${val}" is used by an existing variant and cannot be removed`);
      }
    }
    const { rows: [g] } = await client.query(
      `UPDATE item_groups SET name = $3, description = $4, unit = $5, category = $6, brand = $7, attributes = $8
        WHERE org_id = $1 AND id = $2 RETURNING *`,
      [req.orgId, groupId, str(b.name, { field: 'Group name', required: true, max: 200 }), str(b.description, { field: 'Description', max: 2000 }),
        str(b.unit, { field: 'Unit', max: 30 }), str(b.category, { field: 'Category', max: 100 }), str(b.brand, { field: 'Brand', max: 100 }),
        JSON.stringify(attributes)],
    );
    if (Array.isArray(b.variants) && b.variants.length) await createVariants(client, req, g, b.variants);
    await audit(client, req, 'update', 'item_group', groupId, `Item group ${g.name} updated`);
    return g;
  });
  res.json(group);
});

r.delete('/:id', can('items', 'delete'), async (req, res) => {
  const groupId = Number(req.params.id);
  const { rows: [g] } = await query('SELECT * FROM item_groups WHERE org_id = $1 AND id = $2', [req.orgId, groupId]);
  if (!g) throw notFound('Item group');
  const { rows } = await query('SELECT 1 FROM items WHERE group_id = $1 LIMIT 1', [groupId]);
  if (rows.length) throw conflict('Delete or move the variants in this group first');
  await query('DELETE FROM item_groups WHERE id = $1', [groupId]);
  await audit({ query }, req, 'delete', 'item_group', groupId, `Item group ${g.name} deleted`);
  res.status(204).end();
});

export default r;
