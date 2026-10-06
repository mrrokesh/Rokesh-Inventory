// Third-party integrations: Razorpay (payment links), Shiprocket (shipping), Shopify (online store).
// Credentials are entered by the organization in Settings → Integrations and stored encrypted.
import crypto from 'node:crypto';
import { pool, query, tx } from '../db.js';
import { badRequest, conflict } from './errors.js';
import { decrypt, encrypt } from './secrets.js';
import { takeNumber } from './numbering.js';
import { refreshPayable, fetchDoc } from './documents.js';
import { commit } from './stock.js';
import { appUrl } from './mailer.js';
import { audit } from './audit.js';
import { round2, today } from './validate.js';

export const PROVIDERS: any = {
  razorpay: { name: 'Razorpay', category: 'Payments', secrets: ['key_secret', 'webhook_secret'], config: ['key_id'] },
  shiprocket: { name: 'Shiprocket', category: 'Shipping', secrets: ['password'], config: ['email', 'pickup_location', 'default_weight_kg'] },
  shopify: { name: 'Shopify', category: 'Sales channel', secrets: ['access_token'], config: ['shop_domain', 'location_id', 'warehouse_id', 'auto_sync', 'import_orders', 'push_stock'] },
};

const systemReq = (orgId) => ({ orgId, user: null });

export async function getIntegration(orgId: any, provider: any, db: any = { query }): Promise<any> {
  const { rows } = await db.query('SELECT * FROM integrations WHERE org_id = $1 AND provider = $2', [orgId, provider]);
  const row = rows[0];
  if (!row) return null;
  return { ...row, secret: decrypt(row.secrets) || {} };
}

async function requireIntegration(orgId, provider) {
  const it = await getIntegration(orgId, provider);
  if (!it || !it.enabled) throw badRequest(`${PROVIDERS[provider].name} is not connected. An administrator can connect it in Settings → Integrations.`);
  return it;
}

export async function logIntegration(orgId: any, provider: any, action: any, status: any, message?: any) {
  await query('INSERT INTO integration_logs (org_id, provider, action, status, message) VALUES ($1,$2,$3,$4,$5)',
    [orgId, provider, action, status, message ? String(message).slice(0, 2000) : null]);
  await query('UPDATE integrations SET last_error = $3 WHERE org_id = $1 AND provider = $2',
    [orgId, provider, status === 'error' ? String(message).slice(0, 500) : null]);
}

async function http(url: any, { method = 'GET', headers = {}, body, timeout = 20000 }: any = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw badRequest(`Could not reach ${new URL(url).host}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data?.error?.description || data?.message || data?.errors || data?.raw || `HTTP ${res.status}`;
    throw badRequest(`${new URL(url).host} said: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 300)}`);
  }
  return { data, headers: res.headers };
}

// =================================================================== Razorpay
function razorpayAuth(it) {
  if (!it.config.key_id || !it.secret.key_secret) throw badRequest('Razorpay Key ID and Key Secret are required');
  return { Authorization: `Basic ${Buffer.from(`${it.config.key_id}:${it.secret.key_secret}`).toString('base64')}` };
}

export async function razorpayTest(orgId) {
  const it = await getIntegration(orgId, 'razorpay');
  await http('https://api.razorpay.com/v1/payment_links?count=1', { headers: razorpayAuth(it) });
  return 'Connected to Razorpay';
}

/** Create (or reuse) a Razorpay payment link for an invoice's current balance. Returns the URL. */
export async function ensurePaymentLink(orgId, invoiceId) {
  const it = await requireIntegration(orgId, 'razorpay');
  const { rows: [inv] } = await query(
    `SELECT i.*, c.display_name, c.email, c.mobile, c.phone, o.currency, o.name AS org_name, o.portal_slug
       FROM invoices i JOIN contacts c ON c.id = i.contact_id JOIN organizations o ON o.id = i.org_id WHERE i.org_id = $1 AND i.id = $2`,
    [orgId, invoiceId],
  );
  if (!inv) throw badRequest('Invoice not found');
  if (!['sent', 'partially_paid'].includes(inv.status) || inv.balance <= 0) throw badRequest('This invoice has nothing left to pay');
  // Reuse an existing link if it is still for the same amount.
  if (inv.payment_link_id) {
    try {
      const { data } = await http(`https://api.razorpay.com/v1/payment_links/${inv.payment_link_id}`, { headers: razorpayAuth(it) });
      if (data.status === 'created' && Math.round(Number(inv.balance) * 100) === data.amount) return data.short_url;
    } catch { /* create a new one below */ }
  }
  const phone = String(inv.mobile || inv.phone || '').replace(/[^\d+]/g, '');
  const { data } = await http('https://api.razorpay.com/v1/payment_links', {
    method: 'POST', headers: razorpayAuth(it),
    body: {
      amount: Math.round(Number(inv.balance) * 100), currency: inv.currency || 'INR', accept_partial: false,
      reference_id: `${inv.number}-${Date.now().toString(36)}`.slice(0, 40),
      description: `Invoice ${inv.number} from ${inv.org_name}`.slice(0, 2048),
      customer: { name: inv.display_name, ...(inv.email ? { email: inv.email } : {}), ...(phone ? { contact: phone } : {}) },
      notify: { sms: false, email: false }, reminder_enable: false,
      notes: { org_id: String(orgId), invoice_id: String(inv.id) },
      ...(inv.portal_slug ? { callback_url: `${appUrl()}/portal/${inv.portal_slug}`, callback_method: 'get' } : {}),
    },
  });
  await query('UPDATE invoices SET payment_link_id = $2, payment_link_url = $3 WHERE id = $1', [inv.id, data.id, data.short_url]);
  await logIntegration(orgId, 'razorpay', 'payment_link', 'success', `Payment link created for ${inv.number}`);
  return data.short_url;
}

/** Razorpay webhook (payment_link.paid / payment.captured): record the payment against the invoice. */
export async function handleRazorpayWebhook(slug, rawBody, signature) {
  const { rows: [org] } = await query('SELECT id FROM organizations WHERE portal_slug = $1', [slug]);
  if (!org) return { status: 404 };
  const it = await getIntegration(org.id, 'razorpay');
  if (!it?.enabled || !it.secret.webhook_secret) return { status: 400 };
  const expected = crypto.createHmac('sha256', it.secret.webhook_secret).update(rawBody).digest('hex');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    await logIntegration(org.id, 'razorpay', 'webhook', 'error', 'Webhook signature did not match (check the webhook secret)');
    return { status: 401 };
  }
  const event = JSON.parse(rawBody.toString('utf8'));
  if (event.event !== 'payment_link.paid') return { status: 200 };
  const link = event.payload?.payment_link?.entity;
  const payment = event.payload?.payment?.entity;
  const invoiceId = Number(link?.notes?.invoice_id);
  if (!invoiceId || !payment?.id) return { status: 200 };
  const amount = round2(Number(payment.amount) / 100);
  await recordGatewayPayment(org.id, invoiceId, amount, payment.id, `Razorpay ${payment.method || ''}`.trim());
  return { status: 200 };
}

export async function recordGatewayPayment(orgId: any, invoiceId: any, amount: any, gatewayId?: any, note?: any) {
  await tx(async (client) => {
    const { rows: dup } = await client.query('SELECT 1 FROM payments_received WHERE org_id = $1 AND gateway_payment_id = $2', [orgId, gatewayId]);
    if (dup.length) return;
    const { rows: [inv] } = await client.query('SELECT * FROM invoices WHERE org_id = $1 AND id = $2 FOR UPDATE', [orgId, invoiceId]);
    if (!inv) return;
    const number = await takeNumber(client, orgId, 'payment_received');
    const applied = ['sent', 'partially_paid'].includes(inv.status) ? Math.min(amount, Number(inv.balance)) : 0;
    const { rows: [p] } = await client.query(
      `INSERT INTO payments_received (org_id, number, contact_id, payment_date, amount, mode, reference, notes, unused_amount, gateway_payment_id)
       VALUES ($1,$2,$3,$4,$5,'online_gateway',$6,$7,$8,$6) RETURNING id`,
      [orgId, number, inv.contact_id, today(), amount, gatewayId, note, round2(amount - applied)],
    );
    if (applied > 0) {
      await client.query('INSERT INTO payment_received_allocations (payment_id, invoice_id, amount) VALUES ($1,$2,$3)', [p.id, inv.id, applied]);
      await refreshPayable(client, 'invoice', inv.id);
    }
    await audit(client, systemReq(orgId), 'create', 'payments_received', p.id, `Online payment ${number} of ${amount} received for invoice ${inv.number}`);
  });
  await logIntegration(orgId, 'razorpay', 'payment', 'success', `Payment ${gatewayId} of ${amount} recorded`);
}

// =================================================================== Shiprocket
const SR = 'https://apiv2.shiprocket.in/v1/external';

async function shiprocketToken(orgId) {
  const it = await requireIntegration(orgId, 'shiprocket');
  const cached = it.secret.token && it.secret.token_expires > Date.now() ? it.secret.token : null;
  if (cached) return cached;
  if (!it.config.email || !it.secret.password) throw badRequest('Shiprocket API user email and password are required');
  const { data } = await http(`${SR}/auth/login`, { method: 'POST', body: { email: it.config.email, password: it.secret.password } });
  const secret = { ...it.secret, token: data.token, token_expires: Date.now() + 9 * 24 * 3600 * 1000 };
  await query('UPDATE integrations SET secrets = $3 WHERE org_id = $1 AND provider = $2', [orgId, 'shiprocket', encrypt(secret)]);
  return data.token;
}

export async function shiprocketTest(orgId) {
  const token = await shiprocketToken(orgId);
  const { data } = await http(`${SR}/settings/company/pickup`, { headers: { Authorization: `Bearer ${token}` } });
  const names = (data?.data?.shipping_address || []).map((a) => a.pickup_location);
  return names.length ? `Connected. Pickup locations: ${names.join(', ')}` : 'Connected to Shiprocket';
}

/** Book a package with Shiprocket: create the order, assign a courier (AWB), get the label, then ship it here. */
export async function shiprocketBook(req, packageId, { shipPackage, fetchPackage }) {
  const orgId = req.orgId;
  const it = await requireIntegration(orgId, 'shiprocket');
  const token = await shiprocketToken(orgId);
  const auth = { Authorization: `Bearer ${token}` };
  const pkg = await fetchPackage({ query }, orgId, packageId);
  if (pkg.shipment) throw conflict('This package has already been shipped');
  const so = await fetchDoc({ query }, { table: 'sales_orders', linesTable: 'sales_order_lines', label: 'Sales order' }, orgId, pkg.sales_order_id);
  const addr = Object.keys(so.shipping_address || {}).length ? so.shipping_address : so.contact_shipping_address || {};
  if (!addr.zip || !addr.city || !addr.state) throw badRequest('The shipping address needs a city, state and PIN code. Edit the customer’s address first.');
  const phone = String(addr.phone || so.contact_phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) throw badRequest('Shiprocket needs a 10-digit phone number for the customer (in the address or contact details).');
  const items = pkg.lines.map((l) => {
    const sol = so.lines.find((x) => x.id === l.so_line_id);
    return { name: l.item_name, sku: l.item_sku || `ITEM-${l.item_id}`, units: Number(l.quantity), selling_price: Number(sol?.rate || 0), tax: Number(sol?.tax_rate || 0) };
  });
  const subTotal = round2(items.reduce((s, i) => s + i.units * i.selling_price, 0));
  const { data: order } = await http(`${SR}/orders/create/adhoc`, {
    method: 'POST', headers: auth,
    body: {
      order_id: pkg.number, order_date: today(), pickup_location: it.config.pickup_location || 'Primary',
      billing_customer_name: so.contact_name, billing_last_name: '', billing_address: addr.street1 || addr.attention || so.contact_name,
      billing_address_2: addr.street2 || '', billing_city: addr.city, billing_pincode: addr.zip, billing_state: addr.state,
      billing_country: addr.country || 'India', billing_email: so.contact_email || '', billing_phone: phone,
      shipping_is_billing: true, order_items: items, payment_method: 'Prepaid', sub_total: subTotal,
      length: Number(pkg.length_cm) || 10, breadth: Number(pkg.width_cm) || 10, height: Number(pkg.height_cm) || 10,
      weight: Number(pkg.weight_kg) || Number(it.config.default_weight_kg) || 0.5,
    },
  });
  if (!order?.shipment_id) throw badRequest(`Shiprocket did not create a shipment: ${JSON.stringify(order).slice(0, 300)}`);
  const { data: awb } = await http(`${SR}/courier/assign/awb`, { method: 'POST', headers: auth, body: { shipment_id: order.shipment_id } });
  const awbData = awb?.response?.data || {};
  if (!awbData.awb_code) {
    await logIntegration(orgId, 'shiprocket', 'book', 'error', `Order created (${order.order_id}) but no courier assigned: ${JSON.stringify(awb).slice(0, 300)}`);
    throw badRequest('Shiprocket created the order but could not assign a courier. Check the order in your Shiprocket dashboard (wallet balance, serviceability).');
  }
  let labelUrl = null;
  try {
    const { data: label } = await http(`${SR}/courier/generate/label`, { method: 'POST', headers: auth, body: { shipment_id: [order.shipment_id] } });
    labelUrl = label?.label_url || null;
  } catch { /* label can be downloaded from Shiprocket later */ }
  const result = await tx((client) => shipPackage(client, req, packageId, {
    carrier: awbData.courier_name || 'Shiprocket', tracking_number: awbData.awb_code, service_type: 'Shiprocket',
  }, { provider: 'shiprocket', external_id: String(order.shipment_id), label_url: labelUrl }));
  await logIntegration(orgId, 'shiprocket', 'book', 'success', `${pkg.number} booked with ${awbData.courier_name} (AWB ${awbData.awb_code})`);
  return { ...(result as any), awb: awbData.awb_code, courier: awbData.courier_name, label_url: labelUrl };
}

const SR_STATUS = (s) => {
  const v = String(s || '').toLowerCase();
  if (v.includes('rto') || v.includes('return')) return 'returned';
  if (v.includes('delivered')) return 'delivered';
  if (v.includes('cancel') || v.includes('lost') || v.includes('undelivered')) return 'failed';
  if (v) return 'in_transit';
  return null;
};

export async function shiprocketSyncTracking(orgId) {
  const token = await shiprocketToken(orgId);
  const { rows } = await query(
    "SELECT id, number, tracking_number, status, package_id FROM shipments WHERE org_id = $1 AND provider = 'shiprocket' AND status IN ('shipped','in_transit') AND tracking_number IS NOT NULL LIMIT 50",
    [orgId],
  );
  let changed = 0;
  for (const s of rows) {
    try {
      const { data } = await http(`${SR}/courier/track/awb/${encodeURIComponent(s.tracking_number)}`, { headers: { Authorization: `Bearer ${token}` } });
      const td = data?.tracking_data || {};
      const status = SR_STATUS(td.shipment_track?.[0]?.current_status || td.shipment_status_text);
      if (status && status !== s.status) {
        const delivered = status === 'delivered' ? (td.shipment_track?.[0]?.delivered_date || '').slice(0, 10) || today() : null;
        await query('UPDATE shipments SET status = $2, delivered_date = COALESCE($3::date, delivered_date) WHERE id = $1', [s.id, status, delivered]);
        if (status === 'delivered') await query("UPDATE packages SET status = 'delivered' WHERE id = $1", [s.package_id]);
        await audit({ query }, systemReq(orgId), 'update', 'shipment', s.id, `Shipment ${s.number} marked ${status.replace('_', ' ')} (Shiprocket tracking)`);
        changed += 1;
      }
    } catch (err) {
      await logIntegration(orgId, 'shiprocket', 'track', 'error', `${s.number}: ${err.message}`);
    }
  }
  await logIntegration(orgId, 'shiprocket', 'track', 'success', `Checked ${rows.length} shipment(s), ${changed} updated`);
  return `Checked ${rows.length} shipment(s), ${changed} updated`;
}

// =================================================================== Shopify
const SHOPIFY_API = '2024-10';

function shopifyBase(it) {
  const shop = String(it.config.shop_domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw badRequest('Enter your store domain like yourstore.myshopify.com');
  if (!it.secret.access_token) throw badRequest('Enter the Shopify Admin API access token');
  return { base: `https://${shop}/admin/api/${SHOPIFY_API}`, headers: { 'X-Shopify-Access-Token': it.secret.access_token } };
}
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function shopifyTest(orgId) {
  const it = await getIntegration(orgId, 'shopify');
  const { base, headers } = shopifyBase(it);
  const { data } = await http(`${base}/shop.json`, { headers });
  const { data: loc } = await http(`${base}/locations.json`, { headers });
  const locs = (loc.locations || []).map((l) => `${l.name} (id ${l.id})`).join(', ');
  return `Connected to ${data.shop?.name}. Locations: ${locs || 'none'}`;
}

/** Push available stock of every item with a matching SKU to Shopify. */
export async function shopifyPushStock(orgId) {
  const it = await requireIntegration(orgId, 'shopify');
  const { base, headers } = shopifyBase(it);
  if (!it.config.location_id) throw badRequest('Enter the Shopify location ID to update stock (use Test connection to see it)');
  const whId = Number(it.config.warehouse_id) || null;
  // Map Shopify variants by SKU (cursor pagination).
  const variants = new Map();
  let url = `${base}/variants.json?limit=250&fields=id,sku,inventory_item_id`;
  while (url) {
    const { data, headers: h } = await http(url, { headers });
    for (const v of data.variants || []) if (v.sku) variants.set(v.sku.trim().toLowerCase(), v.inventory_item_id);
    const link = h.get('link') || '';
    const next = link.split(',').find((p) => p.includes('rel="next"'));
    url = next ? next.match(/<([^>]+)>/)[1] : null;
    await pause(550);
  }
  const { rows } = await query(
    `SELECT i.sku, GREATEST(0, COALESCE(SUM(sl.on_hand - sl.committed), 0)) AS available
       FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id ${whId ? 'AND sl.warehouse_id = $2' : ''}
      WHERE i.org_id = $1 AND i.track_inventory AND i.status = 'active' AND i.sku IS NOT NULL GROUP BY i.id`,
    whId ? [orgId, whId] : [orgId],
  );
  let updated = 0;
  for (const r of rows) {
    const inventoryItemId = variants.get(r.sku.trim().toLowerCase());
    if (!inventoryItemId) continue;
    await http(`${base}/inventory_levels/set.json`, {
      method: 'POST', headers,
      body: { location_id: Number(it.config.location_id), inventory_item_id: inventoryItemId, available: Math.floor(Number(r.available)) },
    });
    updated += 1;
    await pause(550);
  }
  const msg = `Stock updated for ${updated} of ${rows.length} item(s) (matched by SKU)`;
  await logIntegration(orgId, 'shopify', 'push_stock', 'success', msg);
  return msg;
}

/** Import new Shopify orders as confirmed sales orders (items matched by SKU, customers by email). */
export async function shopifyImportOrders(orgId) {
  const it = await requireIntegration(orgId, 'shopify');
  const { base, headers } = shopifyBase(it);
  const sinceId = it.state?.last_order_id || 0;
  const { data } = await http(`${base}/orders.json?status=any&limit=50&order=id+asc${sinceId ? `&since_id=${sinceId}` : ''}`, { headers });
  const orders = data.orders || [];
  let imported = 0;
  let lastId = sinceId;
  for (const o of orders) {
    lastId = Math.max(lastId, o.id);
    if (o.cancelled_at) continue;
    try {
      await tx(async (client) => {
        const { rows: dup } = await client.query("SELECT 1 FROM sales_orders WHERE org_id = $1 AND channel = 'shopify' AND external_id = $2", [orgId, String(o.id)]);
        if (dup.length) return;
        const contactId = await shopifyCustomer(client, orgId, o);
        const { rows: [wh] } = await client.query(
          `SELECT id FROM warehouses WHERE org_id = $1 AND ${it.config.warehouse_id ? 'id = $2' : 'is_primary'} LIMIT 1`,
          it.config.warehouse_id ? [orgId, Number(it.config.warehouse_id)] : [orgId],
        );
        const number = await takeNumber(client, orgId, 'sales_order');
        const ship = o.shipping_address || {};
        const address = { attention: [ship.first_name, ship.last_name].filter(Boolean).join(' '), street1: ship.address1, street2: ship.address2, city: ship.city, state: ship.province, zip: ship.zip, country: ship.country, phone: ship.phone };
        const lines = [];
        for (const [pos, li] of (o.line_items || []).entries()) {
          const { rows: [item] } = li.sku
            ? await client.query('SELECT id, track_inventory FROM items WHERE org_id = $1 AND lower(sku) = lower($2)', [orgId, li.sku])
            : { rows: [] };
          const qty = Number(li.quantity);
          const rate = round2(Number(li.price));
          const disc = Number(li.total_discount) ? round2((Number(li.total_discount) / (qty * rate)) * 100) : 0;
          lines.push({ item, description: item ? null : `${li.title}${li.variant_title ? ` – ${li.variant_title}` : ''}${li.sku ? ` (SKU ${li.sku})` : ''}`,
            qty, rate, disc, amount: round2(qty * rate * (1 - disc / 100)), pos });
        }
        const sub = round2(lines.reduce((s, l) => s + l.amount, 0));
        const shipping = round2((o.shipping_lines || []).reduce((s, l) => s + Number(l.price), 0));
        const tax = round2(Number(o.total_tax) || 0);
        const total = round2(Number(o.total_price) || sub + shipping + tax);
        const adjustment = round2(total - sub - shipping - tax);
        const { rows: [so] } = await client.query(
          `INSERT INTO sales_orders (org_id, number, reference, contact_id, doc_date, warehouse_id, status, shipping_charge, adjustment,
                                     sub_total, tax_total, total, shipping_address, billing_address, notes, channel, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10,$11,$12,$12,$13,'shopify',$14) RETURNING id`,
          [orgId, number, o.name, contactId, String(o.created_at).slice(0, 10), wh.id, shipping, adjustment, sub, tax, total,
            JSON.stringify(address), `Imported from Shopify order ${o.name}${o.financial_status ? ` (${o.financial_status})` : ''}`, String(o.id)],
        );
        for (const l of lines) {
          await client.query(
            `INSERT INTO sales_order_lines (doc_id, item_id, description, quantity, rate, discount_percent, amount, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [so.id, l.item?.id || null, l.description, l.qty, l.rate, l.disc, l.amount, l.pos],
          );
          if (l.item?.track_inventory) await commit(client, { orgId }, l.item.id, wh.id, l.qty);
        }
        await audit(client, systemReq(orgId), 'create', 'sales_order', so.id, `Sales order ${number} imported from Shopify order ${o.name}`);
        imported += 1;
      });
    } catch (err) {
      await logIntegration(orgId, 'shopify', 'import_orders', 'error', `Order ${o.name}: ${err.message}`);
    }
  }
  await query("UPDATE integrations SET state = state || $3::jsonb WHERE org_id = $1 AND provider = $2", [orgId, 'shopify', JSON.stringify({ last_order_id: lastId })]);
  const msg = `${imported} new order(s) imported`;
  await logIntegration(orgId, 'shopify', 'import_orders', 'success', msg);
  return msg;
}

async function shopifyCustomer(client, orgId, o) {
  const email = (o.email || o.customer?.email || '').toLowerCase() || null;
  if (email) {
    const { rows } = await client.query("SELECT id FROM contacts WHERE org_id = $1 AND contact_type = 'customer' AND lower(email) = $2 LIMIT 1", [orgId, email]);
    if (rows[0]) return rows[0].id;
  }
  const b = o.billing_address || o.shipping_address || {};
  const name = [o.customer?.first_name || b.first_name, o.customer?.last_name || b.last_name].filter(Boolean).join(' ') || email || `Shopify customer ${o.id}`;
  const addr = { street1: b.address1, street2: b.address2, city: b.city, state: b.province, zip: b.zip, country: b.country, phone: b.phone };
  const { rows: [c] } = await client.query(
    `INSERT INTO contacts (org_id, contact_type, customer_type, display_name, first_name, last_name, company_name, email, phone, billing_address, shipping_address, notes)
     VALUES ($1,'customer',$2,$3,$4,$5,$6,$7,$8,$9,$9,'Created from Shopify') RETURNING id`,
    [orgId, b.company ? 'business' : 'individual', name, o.customer?.first_name || null, o.customer?.last_name || null, b.company || null, email, b.phone || null, JSON.stringify(addr)],
  );
  return c.id;
}

// =================================================================== scheduler
/** Every 15 minutes: Shopify sync (if auto-sync on) and Shiprocket tracking updates. */
export function startIntegrationScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query('SELECT org_id, provider, config FROM integrations WHERE enabled');
      for (const r of rows) {
        try {
          if (r.provider === 'shopify' && r.config.auto_sync) {
            if (r.config.import_orders !== false) await shopifyImportOrders(r.org_id);
            if (r.config.push_stock !== false && r.config.location_id) await shopifyPushStock(r.org_id);
          }
          if (r.provider === 'shiprocket') await shiprocketSyncTracking(r.org_id);
          await pool.query('UPDATE integrations SET last_sync_at = now() WHERE org_id = $1 AND provider = $2', [r.org_id, r.provider]);
        } catch (err) {
          await logIntegration(r.org_id, r.provider, 'auto_sync', 'error', err.message).catch(() => {});
        }
      }
    } finally {
      running = false;
    }
  };
  setInterval(run, 15 * 60 * 1000).unref();
}
