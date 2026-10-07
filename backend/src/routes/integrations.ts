import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { can, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { str, bool, id as idV } from '../lib/validate.js';
import { encrypt, mask } from '../lib/secrets.js';
import { appUrl } from '../lib/mailer.js';
import { WEBHOOK_EVENTS } from '../lib/webhooks.js';
import {
  PROVIDERS, getIntegration, logIntegration, razorpayTest, ensurePaymentLink, shiprocketTest, shiprocketBook, shiprocketSyncTracking,
  shopifyTest, shopifyPushStock, shopifyImportOrders,
} from '../lib/integrations.js';
import { shipPackage, fetchPackage } from './sales.js';
import { msg91Test, sendSms, twilioTest } from '../lib/sms.js';

const r = Router();

const TESTS: any = { razorpay: razorpayTest, shiprocket: shiprocketTest, shopify: shopifyTest, twilio: twilioTest, msg91: msg91Test };

r.get('/', can('settings', 'view'), async (req, res) => {
  const { rows: [org] } = await query('SELECT portal_slug FROM organizations WHERE id = $1', [req.orgId]);
  const out = [];
  for (const [key, p] of Object.entries(PROVIDERS) as [string, any][]) {
    const it = await getIntegration(req.orgId, key);
    out.push({
      provider: key, name: p.name, category: p.category, enabled: !!it?.enabled, config: it?.config || {},
      secrets: Object.fromEntries(p.secrets.map((s) => [s, mask(it?.secret?.[s])])),
      last_sync_at: it?.last_sync_at || null, last_error: it?.last_error || null,
      ...(key === 'razorpay' ? { webhook_url: `${appUrl()}/api/hooks/razorpay/${org.portal_slug}` } : {}),
    });
  }
  res.json(out);
});

r.put('/:provider', requireAdmin, async (req, res) => {
  const p = PROVIDERS[String(req.params.provider)];
  if (!p) throw notFound('Integration');
  const b = req.body || {};
  const cur = await getIntegration(req.orgId, req.params.provider);
  const config = {};
  for (const k of p.config) {
    const v = b.config?.[k];
    config[k] = typeof v === 'boolean' ? v : str(v, { field: k, max: 300 });
  }
  const secret = { ...(cur?.secret || {}) };
  for (const k of p.secrets) {
    const v = b.secrets?.[k];
    if (typeof v === 'string' && v.trim() && !v.startsWith('••••')) secret[k] = v.trim();
  }
  delete secret.token; // credentials changed: get a fresh token next time
  await query(
    `INSERT INTO integrations (org_id, provider, enabled, config, secrets) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id, provider) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config, secrets = EXCLUDED.secrets, last_error = NULL`,
    [req.orgId, req.params.provider, bool(b.enabled), JSON.stringify(config), encrypt(secret)],
  );
  await audit({ query }, req, 'update', 'integration', null, `${p.name} integration ${bool(b.enabled) ? 'connected/updated' : 'turned off'}`);
  res.json({ ok: true });
});

r.post('/:provider/test', requireAdmin, async (req, res) => {
  const test = TESTS[String(req.params.provider)];
  if (!test) throw notFound('Integration');
  try {
    const message = await test(req.orgId);
    await logIntegration(req.orgId, req.params.provider, 'test', 'success', message);
    res.json({ ok: true, message });
  } catch (err) {
    await logIntegration(req.orgId, req.params.provider, 'test', 'error', err.message);
    throw err;
  }
});

r.post('/shopify/sync', can('sales_orders', 'create'), async (req, res) => {
  const what = req.body?.what || 'all';
  const messages = [];
  if (what === 'all' || what === 'orders') messages.push(await shopifyImportOrders(req.orgId));
  if (what === 'all' || what === 'stock') messages.push(await shopifyPushStock(req.orgId));
  await query("UPDATE integrations SET last_sync_at = now() WHERE org_id = $1 AND provider = 'shopify'", [req.orgId]);
  res.json({ message: messages.join('. ') });
});

r.post('/shiprocket/sync', can('packages', 'edit'), async (req, res) => {
  res.json({ message: await shiprocketSyncTracking(req.orgId) });
});

r.post('/shiprocket/book/:packageId', can('packages', 'create'), async (req, res) => {
  res.status(201).json(await shiprocketBook(req, Number(req.params.packageId), { shipPackage, fetchPackage }));
});

r.post('/razorpay/payment-link/:invoiceId', can('invoices', 'edit'), async (req, res) => {
  const url = await ensurePaymentLink(req.orgId, Number(req.params.invoiceId));
  await audit({ query }, req, 'update', 'invoice', Number(req.params.invoiceId), 'Online payment link created');
  res.json({ url });
});

// Send a text message by hand (e.g. "Send SMS" on an invoice).
r.post('/sms/send', async (req, res) => {
  const b = req.body || {};
  const result = await sendSms(req.orgId, b.to, b.message, { entityType: b.entity_type || null, entityId: Number(b.entity_id) || null, userId: req.user.id });
  await audit({ query }, req, 'update', b.entity_type || 'sms', Number(b.entity_id) || null, `SMS sent to ${result.to}`);
  res.json(result);
});

r.get('/sms/enabled', async (req, res) => {
  const { rows } = await query("SELECT provider FROM integrations WHERE org_id = $1 AND enabled AND provider IN ('twilio','msg91') LIMIT 1", [req.orgId]);
  res.json({ enabled: !!rows[0], provider: rows[0]?.provider || null });
});

r.get('/logs', can('settings', 'view'), async (req, res) => {
  const params = [req.orgId];
  let where = 'org_id = $1';
  if (req.query.provider) { params.push(req.query.provider); where += ` AND provider = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM integration_logs WHERE ${where} ORDER BY created_at DESC LIMIT 100`, params);
  res.json(rows);
});

// ------------------------------------------------------------------ API keys
r.get('/api-keys', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT k.id, k.name, k.prefix, k.last_used_at, k.created_at, u.name AS user_name, r.name AS role_name
       FROM api_keys k JOIN users u ON u.id = k.user_id JOIN roles r ON r.id = u.role_id WHERE k.org_id = $1 ORDER BY k.created_at DESC`,
    [req.orgId],
  );
  res.json(rows);
});

r.post('/api-keys', requireAdmin, async (req, res) => {
  const name = str(req.body?.name, { field: 'Name', required: true, max: 100 });
  const userId = idV(req.body?.user_id, { field: 'Acts as user' }) || req.user.id;
  const { rows: [u] } = await query("SELECT id FROM users WHERE org_id = $1 AND id = $2 AND status = 'active'", [req.orgId, userId]);
  if (!u) throw badRequest('Choose an active user for the key to act as');
  const key = `ik_${crypto.randomBytes(24).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const { rows: [k] } = await query(
    'INSERT INTO api_keys (org_id, user_id, name, prefix, key_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.orgId, userId, name, key.slice(0, 10), hash],
  );
  await audit({ query }, req, 'create', 'api_key', k.id, `API key "${name}" created`);
  res.status(201).json({ id: k.id, key });
});

r.delete('/api-keys/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('DELETE FROM api_keys WHERE org_id = $1 AND id = $2 RETURNING name', [req.orgId, Number(req.params.id)]);
  if (!rows[0]) throw notFound('API key');
  await audit({ query }, req, 'delete', 'api_key', Number(req.params.id), `API key "${rows[0].name}" revoked`);
  res.status(204).end();
});

// ------------------------------------------------------------------ webhooks
r.get('/webhook-events', (_req, res) => res.json(WEBHOOK_EVENTS));

r.get('/webhooks', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT w.*, (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed') AS failed,
            (SELECT MAX(created_at) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS last_event_at
       FROM webhooks w WHERE w.org_id = $1 ORDER BY w.created_at`,
    [req.orgId],
  );
  res.json(rows);
});

function parseWebhook(b) {
  const url = str(b.url, { field: 'URL', required: true, max: 500 });
  if (!/^https?:\/\//i.test(url)) throw badRequest('The URL must start with https:// (or http:// for testing)');
  const events = Array.isArray(b.events) ? b.events.filter((e) => e === '*' || WEBHOOK_EVENTS.includes(e)) : [];
  if (!events.length) throw badRequest('Choose at least one event');
  return { url, events, enabled: bool(b.enabled, true) };
}

r.post('/webhooks', requireAdmin, async (req, res) => {
  const v = parseWebhook(req.body || {});
  const secret = crypto.randomBytes(24).toString('hex');
  const { rows: [w] } = await query(
    'INSERT INTO webhooks (org_id, url, events, secret, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.orgId, v.url, v.events, secret, v.enabled],
  );
  await audit({ query }, req, 'create', 'webhook', w.id, `Webhook to ${v.url} created`);
  res.status(201).json(w);
});

r.put('/webhooks/:id', requireAdmin, async (req, res) => {
  const v = parseWebhook(req.body || {});
  const { rows } = await query(
    'UPDATE webhooks SET url = $3, events = $4, enabled = $5 WHERE org_id = $1 AND id = $2 RETURNING *',
    [req.orgId, Number(req.params.id), v.url, v.events, v.enabled],
  );
  if (!rows[0]) throw notFound('Webhook');
  res.json(rows[0]);
});

r.delete('/webhooks/:id', requireAdmin, async (req, res) => {
  const { rowCount } = await query('DELETE FROM webhooks WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!rowCount) throw notFound('Webhook');
  res.status(204).end();
});

r.get('/webhooks/:id/deliveries', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.event, d.status, d.attempts, d.response_status, d.last_error, d.created_at, d.next_attempt_at
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.org_id = $1 AND w.id = $2 ORDER BY d.id DESC LIMIT 50`,
    [req.orgId, Number(req.params.id)],
  );
  res.json(rows);
});

r.post('/webhooks/:id/test', requireAdmin, async (req, res) => {
  const { rows: [w] } = await query('SELECT * FROM webhooks WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
  if (!w) throw notFound('Webhook');
  await query(
    'INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload) VALUES ($1,$2,$3,$4)',
    [req.orgId, w.id, 'ping', JSON.stringify({ event: 'ping', occurred_at: new Date().toISOString(), data: { message: 'Test event from your inventory app' } })],
  );
  res.json({ ok: true, message: 'A test event was queued and will be delivered within a few seconds.' });
});

export default r;
