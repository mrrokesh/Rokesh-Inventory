// Outbound webhooks. Events are queued inside the same transaction as the change
// (so a rolled-back change never notifies anyone) and delivered by a background worker.
import crypto from 'node:crypto';
import { pool } from '../db.js';

export const WEBHOOK_EVENTS = [
  'sales_order.create', 'sales_order.approve', 'sales_order.void',
  'invoice.create', 'invoice.approve', 'invoice.void',
  'payments_received.create', 'shipment.create', 'shipment.update', 'package.create',
  'estimate.create', 'estimate.update', 'delivery_challan.approve',
  'purchase_order.create', 'purchase_order.approve', 'purchase_receive.create', 'bill.approve', 'payments_made.create',
  'item.create', 'item.update', 'customer.create', 'vendor.create', 'inventory_adjustment.approve', 'transfer_order.update',
];

/** Queue an event for every enabled webhook subscribed to it. `db` may be a transaction client. */
export async function enqueueEvent(db, orgId, event, data) {
  const { rows } = await db.query(
    "SELECT id FROM webhooks WHERE org_id = $1 AND enabled AND ($2 = ANY(events) OR '*' = ANY(events))",
    [orgId, event],
  );
  for (const w of rows) {
    await db.query(
      'INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload) VALUES ($1, $2, $3, $4)',
      [orgId, w.id, event, JSON.stringify({ event, occurred_at: new Date().toISOString(), data })],
    );
  }
}

export const signPayload = (secret, body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

const BACKOFF_MIN = [1, 5, 30, 120, 360];

async function deliverBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= now()
        ORDER BY d.id LIMIT 20 FOR UPDATE OF d SKIP LOCKED`,
    );
    for (const d of rows) {
      const body = JSON.stringify(d.payload);
      let ok = false;
      let status = null;
      let error = null;
      try {
        const res = await fetch(d.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Inventory-Webhooks/1.0', 'X-Inventory-Event': d.event,
            'X-Inventory-Delivery': String(d.id), 'X-Inventory-Signature': signPayload(d.secret, body) },
          body,
          signal: AbortSignal.timeout(10000),
        });
        status = res.status;
        ok = res.ok;
        if (!ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = err.name === 'TimeoutError' ? 'Timed out after 10 s' : err.message;
      }
      const attempts = d.attempts + 1;
      if (ok) {
        await client.query("UPDATE webhook_deliveries SET status = 'sent', attempts = $2, response_status = $3, last_error = NULL WHERE id = $1", [d.id, attempts, status]);
      } else if (attempts > BACKOFF_MIN.length) {
        await client.query("UPDATE webhook_deliveries SET status = 'failed', attempts = $2, response_status = $3, last_error = $4 WHERE id = $1", [d.id, attempts, status, error]);
      } else {
        await client.query(
          `UPDATE webhook_deliveries SET attempts = $2, response_status = $3, last_error = $4,
                  next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1`,
          [d.id, attempts, status, error, String(BACKOFF_MIN[attempts - 1])],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Webhook delivery error:', err.message);
  } finally {
    client.release();
  }
}

export function startWebhookWorker() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await deliverBatch(); } finally { running = false; }
  }, 5000).unref();
}
