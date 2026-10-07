// Settings → Currencies: foreign currencies and their exchange rates to the base currency.
import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { CURRENCY_NAMES, baseCurrency } from '../lib/currency.js';

const r = Router();

r.get('/', async (req, res) => {
  const base = await baseCurrency({ query }, req.orgId);
  const { rows } = await query(
    `SELECT c.*, (SELECT COUNT(*) FROM contacts k WHERE k.org_id = c.org_id AND k.currency = c.code)::int AS contacts
       FROM currencies c WHERE c.org_id = $1 ORDER BY c.code`,
    [req.orgId],
  );
  res.json({ base, base_name: CURRENCY_NAMES[base] || base, currencies: rows, known: CURRENCY_NAMES });
});

function parseRate(v) {
  const rate = Number(v);
  if (!(rate > 0) || !Number.isFinite(rate)) throw badRequest('Enter the exchange rate, e.g. 83.25 (how much 1 unit is worth in your base currency)');
  return Math.round(rate * 1e6) / 1e6;
}

r.post('/', can('settings', 'edit'), async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw badRequest('Currency code must be 3 letters, e.g. USD');
  const base = await baseCurrency({ query }, req.orgId);
  if (code === base) throw badRequest(`${code} is your base currency`);
  const name = String(b.name || CURRENCY_NAMES[code] || code).trim().slice(0, 60);
  try {
    const { rows: [row] } = await query('INSERT INTO currencies (org_id, code, name, exchange_rate) VALUES ($1, $2, $3, $4) RETURNING *', [req.orgId, code, name, parseRate(b.exchange_rate)]);
    await audit({ query }, req, 'create', 'currency', row.id, `Currency ${code} added at ${row.exchange_rate} ${base}`);
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') throw conflict(`${code} is already set up`);
    throw err;
  }
});

r.put('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [row] } = await query(
    'UPDATE currencies SET exchange_rate = $3, name = COALESCE(NULLIF($4, \'\'), name), updated_at = now() WHERE org_id = $1 AND id = $2 RETURNING *',
    [req.orgId, Number(req.params.id), parseRate(req.body?.exchange_rate), String(req.body?.name || '').trim().slice(0, 60)],
  );
  if (!row) throw notFound('Currency');
  await audit({ query }, req, 'update', 'currency', row.id, `Exchange rate for ${row.code} set to ${row.exchange_rate}`);
  res.json(row);
});

r.delete('/:id', can('settings', 'edit'), async (req, res) => {
  const { rows: [c] } = await query('SELECT * FROM currencies WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!c) throw notFound('Currency');
  const { rows: used } = await query('SELECT 1 FROM contacts WHERE org_id = $1 AND currency = $2 LIMIT 1', [req.orgId, c.code]);
  if (used.length) throw conflict(`Some customers or vendors use ${c.code}, so it can't be removed.`);
  await query('DELETE FROM currencies WHERE id = $1', [c.id]);
  await audit({ query }, req, 'delete', 'currency', c.id, `Currency ${c.code} removed`);
  res.status(204).end();
});

export default r;
