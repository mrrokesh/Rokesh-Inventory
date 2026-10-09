import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { badRequest } from './errors.js';
import { appUrl } from './mailer.js';
import { platformAudit } from './platformAudit.js';

function platformKeys() {
  const keyId = config.platformRazorpayKeyId;
  const keySecret = config.platformRazorpayKeySecret;
  if (!keyId || !keySecret) {
    throw badRequest('Platform Razorpay is not configured. Set PLATFORM_RAZORPAY_KEY_ID and PLATFORM_RAZORPAY_KEY_SECRET.');
  }
  return { keyId, keySecret };
}

function authHeader() {
  const { keyId, keySecret } = platformKeys();
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function rzp(path: string, opts: { method?: string; body?: any } = {}) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: { description: text } }; }
  if (!res.ok) {
    throw badRequest(data?.error?.description || `Razorpay error (${res.status})`);
  }
  return data;
}

export function platformBillingConfigured() {
  return !!(config.platformRazorpayKeyId && config.platformRazorpayKeySecret);
}

/** Create a one-month SaaS payment link for an organization. */
export async function createSaasPaymentLink(orgId: number, { createdBy }: { createdBy?: string } = {}) {
  const { rows: [org] } = await query(
    `SELECT o.*, p.name AS plan_name, p.price_monthly, p.id AS plan_pk
       FROM organizations o LEFT JOIN plans p ON p.id = o.plan_id WHERE o.id = $1`,
    [orgId],
  );
  if (!org) throw badRequest('Organization not found');
  if (!org.plan_id) throw badRequest('Assign a plan before collecting payment');
  const amount = Number(org.price_monthly || 0);
  if (!(amount > 0)) throw badRequest('This plan has no monthly price. Set price_monthly on the plan first.');

  const amountPaise = Math.round(amount * 100);
  const link = await rzp('/payment_links', {
    method: 'POST',
    body: {
      amount: amountPaise,
      currency: 'INR',
      accept_partial: false,
      description: `${org.plan_name} — ${org.name} (1 month)`,
      customer: {
        name: org.name,
        email: org.email || undefined,
      },
      notify: { email: true, sms: false },
      reminder_enable: true,
      notes: {
        type: 'saas_subscription',
        org_id: String(orgId),
        plan_id: String(org.plan_id),
        created_by: createdBy || 'system',
      },
      callback_url: `${appUrl()}/settings/billing`,
      callback_method: 'get',
    },
  });

  await query(
    `INSERT INTO platform_payments (org_id, plan_id, amount, currency, razorpay_link_id, status, meta)
     VALUES ($1,$2,$3,'INR',$4,'created',$5)`,
    [orgId, org.plan_id, amount, link.id, JSON.stringify({ short_url: link.short_url })],
  );
  await query(
    `UPDATE organizations SET subscription_status = CASE
       WHEN subscription_status IN ('active') THEN subscription_status ELSE 'pending' END
     WHERE id = $1`,
    [orgId],
  );
  return { url: link.short_url, link_id: link.id, amount, plan_name: org.plan_name };
}

export function verifyPlatformWebhook(rawBody: Buffer | string, signature: string | undefined) {
  const secret = config.platformRazorpayWebhookSecret;
  if (!secret) return false;
  if (!signature) return false;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function markPaid(orgId: number, paymentId: string, amount: number, linkId?: string) {
  const { rows: [cur] } = await query('SELECT paid_until, plan_id FROM organizations WHERE id = $1', [orgId]);
  const base = cur?.paid_until && new Date(cur.paid_until) > new Date() ? new Date(cur.paid_until) : new Date();
  const paidUntil = new Date(base.getTime() + 30 * 86400000);
  await query(
    `UPDATE organizations SET
       status = 'active',
       subscription_status = 'active',
       paid_until = $2,
       last_payment_id = $3
     WHERE id = $1`,
    [orgId, paidUntil, paymentId],
  );
  await query(
    `INSERT INTO platform_payments (org_id, plan_id, amount, currency, razorpay_payment_id, razorpay_link_id, status, meta)
     VALUES ($1,$2,$3,'INR',$4,$5,'paid','{}'::jsonb)`,
    [orgId, cur?.plan_id || null, amount / 100, paymentId, linkId || null],
  );
  await platformAudit(null, 'payment', 'organization', orgId, `SaaS payment ${paymentId} recorded; paid until ${paidUntil.toISOString()}`);
}

export async function handlePlatformRazorpayWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!verifyPlatformWebhook(rawBody, signature)) {
    return { status: 400, error: 'Invalid signature' };
  }
  let event: any;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch {
    return { status: 400, error: 'Bad JSON' };
  }
  const type = event.event || '';
  const payload = event.payload || {};

  if (type === 'payment_link.paid' || type === 'payment.captured') {
    const payment = payload.payment?.entity || payload.payment_link?.entity?.payments?.[0];
    const link = payload.payment_link?.entity;
    const notes = payment?.notes || link?.notes || {};
    if (notes.type !== 'saas_subscription') return { status: 200 };
    const orgId = Number(notes.org_id);
    if (!orgId) return { status: 200 };
    const paymentId = payment?.id || link?.id;
    const amount = Number(payment?.amount || link?.amount || 0);
    if (paymentId) await markPaid(orgId, paymentId, amount, link?.id);
    return { status: 200 };
  }

  if (type === 'subscription.halted' || type === 'subscription.cancelled' || type === 'subscription.pending') {
    const sub = payload.subscription?.entity;
    const notes = sub?.notes || {};
    const orgId = Number(notes.org_id);
    if (!orgId) return { status: 200 };
    await query(
      `UPDATE organizations SET subscription_status = $2,
         status = CASE WHEN $2 = 'cancelled' THEN 'suspended' ELSE status END
       WHERE id = $1`,
      [orgId, type === 'subscription.cancelled' ? 'cancelled' : 'past_due'],
    );
    if (type !== 'subscription.pending') {
      await query(`UPDATE organizations SET status = 'suspended' WHERE id = $1 AND status = 'active'`, [orgId]);
    }
    await platformAudit(null, 'subscription', 'organization', orgId, `Razorpay ${type}`);
    return { status: 200 };
  }

  return { status: 200 };
}

/** Suspend orgs whose paid_until / trial has lapsed. */
export async function enforceBillingLapses() {
  const { rows: expiredPaid } = await query(
    `UPDATE organizations SET status = 'suspended', subscription_status = 'past_due'
      WHERE subscription_status = 'active'
        AND paid_until IS NOT NULL AND paid_until < now()
        AND status = 'active'
      RETURNING id, name`,
  );
  for (const o of expiredPaid) {
    await platformAudit(null, 'auto_suspend', 'organization', o.id, `Auto-suspended ${o.name} — payment period ended`);
  }

  const { rows: expiredTrial } = await query(
    `UPDATE organizations SET status = 'suspended'
      WHERE status = 'trial'
        AND trial_ends_at IS NOT NULL AND trial_ends_at < now()
      RETURNING id, name`,
  );
  for (const o of expiredTrial) {
    await platformAudit(null, 'auto_suspend', 'organization', o.id, `Auto-suspended ${o.name} — trial ended`);
  }

  return { paid: expiredPaid.length, trial: expiredTrial.length };
}

export function startBillingEnforcer() {
  const run = () => enforceBillingLapses().catch((err) => console.error('Billing enforcer:', err.message));
  run();
  setInterval(run, 60 * 60 * 1000);
}
