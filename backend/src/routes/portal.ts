// Customer & vendor portal: contacts sign in at /portal/<org-slug> and see only their own records.
// Customers see invoices, orders, quotes and credits; vendors see purchase orders, bills and payments.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, tx } from '../db.js';
import { config } from '../config.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { str, email as emailV, obj, today } from '../lib/validate.js';
import { fetchDoc } from '../lib/documents.js';
import { audit } from '../lib/audit.js';
import { can } from '../middleware/auth.js';
import { ensurePaymentLink } from '../lib/integrations.js';

const r = Router();

const DOCS = {
  invoices: { table: 'invoices', linesTable: 'invoice_lines', label: 'Invoice', entity: 'invoice', hidden: ['draft'] },
  'sales-orders': { table: 'sales_orders', linesTable: 'sales_order_lines', label: 'Sales Order', entity: 'sales_order', hidden: ['draft'] },
  estimates: { table: 'estimates', linesTable: 'estimate_lines', label: 'Estimate', entity: 'estimate', hidden: ['draft'] },
  'credit-notes': { table: 'credit_notes', linesTable: 'credit_note_lines', label: 'Credit Note', entity: 'credit_note', hidden: ['draft'] },
  'purchase-orders': { table: 'purchase_orders', linesTable: 'purchase_order_lines', label: 'Purchase Order', entity: 'purchase_order', hidden: ['draft'], vendor: true },
  bills: { table: 'bills', linesTable: 'bill_lines', label: 'Bill', entity: 'bill', hidden: ['draft'], vendor: true },
  'vendor-credits': { table: 'vendor_credits', linesTable: 'vendor_credit_lines', label: 'Vendor Credit', entity: 'vendor_credit', hidden: ['draft'], vendor: true },
};
/** The document kinds a signed-in contact may open. */
const kindFor = (req, kind) => {
  const cfg = DOCS[kind];
  if (!cfg || !!cfg.vendor !== (req.contact.contact_type === 'vendor')) throw notFound('Page');
  return cfg;
};

async function orgBySlug(slug) {
  const { rows } = await query('SELECT id, name, logo_path, currency, email, phone, state FROM organizations WHERE portal_slug = $1', [slug]);
  if (!rows[0]) throw notFound('Portal');
  return rows[0];
}

const sign = (contact) => jwt.sign({ sub: contact.id, org: contact.org_id, typ: 'portal' }, config.jwtSecret, { expiresIn: '7d' });

// ------------------------------------------------------------------ public
r.get('/:slug/info', async (req, res) => {
  const org = await orgBySlug(req.params.slug);
  res.json({ name: org.name, logo_path: org.logo_path, email: org.email, phone: org.phone });
});

const failures = new Map();
r.post('/:slug/login', async (req, res) => {
  const org = await orgBySlug(req.params.slug);
  const mail = emailV(req.body?.email, { required: true });
  const key = `${org.id}:${mail}`;
  const f = failures.get(key);
  if (f && f.n >= 10 && Date.now() - f.t < 15 * 60000) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const { rows } = await query(
    `SELECT * FROM contacts WHERE org_id = $1 AND lower(email) = $2 AND portal_enabled AND status = 'active'
      ORDER BY (contact_type = $3) DESC, id`,
    [org.id, mail, req.body?.as === 'vendor' ? 'vendor' : 'customer'],
  );
  let c = null;
  for (const row of rows) {
    if (row.portal_password_hash && (await bcrypt.compare(String(req.body?.password || ''), row.portal_password_hash))) { c = row; break; }
  }
  if (!c) {
    failures.set(key, f && Date.now() - f.t < 15 * 60000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() });
    throw new HttpError(401, 'Incorrect email or password');
  }
  failures.delete(key);
  await query('UPDATE contacts SET portal_last_login = now() WHERE id = $1', [c.id]);
  res.json({ token: sign(c), name: c.display_name, type: c.contact_type });
});

r.get('/:slug/invite/:token', async (req, res) => {
  const org = await orgBySlug(req.params.slug);
  const { rows } = await query('SELECT display_name, email FROM contacts WHERE org_id = $1 AND portal_token = $2 AND portal_enabled', [org.id, req.params.token]);
  if (!rows[0]) throw notFound('Invitation');
  res.json({ ...rows[0], org_name: org.name });
});

r.post('/:slug/invite/:token', async (req, res) => {
  const org = await orgBySlug(req.params.slug);
  const pass = String(req.body?.password || '');
  if (pass.length < 8) throw badRequest('Password must be at least 8 characters');
  const hash = await bcrypt.hash(pass, 12);
  const { rows } = await query(
    `UPDATE contacts SET portal_password_hash = $3, portal_token = NULL, portal_last_login = now()
      WHERE org_id = $1 AND portal_token = $2 AND portal_enabled RETURNING *`,
    [org.id, req.params.token, hash],
  );
  if (!rows[0]) throw notFound('Invitation');
  res.json({ token: sign(rows[0]), name: rows[0].display_name });
});

// ------------------------------------------------------------------ signed-in customer
async function portalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  let p;
  try { p = jwt.verify(token, config.jwtSecret); } catch { return next(new HttpError(401, 'Please sign in')); }
  if (p.typ !== 'portal') return next(new HttpError(401, 'Please sign in'));
  const org = await orgBySlug(req.params.slug).catch(() => null);
  if (!org || org.id !== p.org) return next(new HttpError(401, 'Please sign in'));
  const { rows } = await query("SELECT * FROM contacts WHERE id = $1 AND org_id = $2 AND portal_enabled AND status = 'active'", [p.sub, p.org]);
  if (!rows[0]) return next(new HttpError(401, 'Portal access has been turned off'));
  req.contact = rows[0];
  req.org = org;
  req.orgId = org.id;
  next();
}
r.use('/:slug/me', portalAuth);
r.use('/:slug/docs', portalAuth);
r.use('/:slug/payments', portalAuth);
r.use('/:slug/shipments', portalAuth);
r.use('/:slug/statement', portalAuth);

r.get('/:slug/me', async (req, res) => {
  const c = req.contact;
  const org = { name: req.org.name, logo_path: req.org.logo_path, currency: req.org.currency, email: req.org.email, phone: req.org.phone };
  const contact = { display_name: c.display_name, company_name: c.company_name, email: c.email, phone: c.phone, mobile: c.mobile, gstin: c.gstin,
    billing_address: c.billing_address, shipping_address: c.shipping_address, contact_type: c.contact_type, currency: c.currency };
  if (c.contact_type === 'vendor') {
    const { rows: [v] } = await query(
      `SELECT (SELECT COALESCE(SUM(balance),0) FROM bills WHERE contact_id = $1 AND status IN ('open','partially_paid')) AS payable,
              (SELECT COALESCE(SUM(balance),0) FROM bills WHERE contact_id = $1 AND status IN ('open','partially_paid') AND due_date < CURRENT_DATE) AS overdue,
              (SELECT COUNT(*) FROM purchase_orders WHERE contact_id = $1 AND status = 'issued')::int AS open_orders,
              (SELECT COUNT(*) FROM purchase_orders WHERE contact_id = $1 AND status = 'issued' AND vendor_response IS NULL)::int AS awaiting_reply,
              (SELECT COALESCE(SUM(balance),0) FROM vendor_credits WHERE contact_id = $1 AND status = 'open') AS credits`,
      [c.id],
    );
    return res.json({ org, contact, ...v });
  }
  const { rows: [b] } = await query(
    `SELECT (SELECT COALESCE(SUM(balance),0) FROM invoices WHERE contact_id = $1 AND status IN ('sent','partially_paid')) AS outstanding,
            (SELECT COALESCE(SUM(balance),0) FROM invoices WHERE contact_id = $1 AND status IN ('sent','partially_paid') AND due_date < CURRENT_DATE) AS overdue,
            (SELECT COALESCE(SUM(balance),0) FROM credit_notes WHERE contact_id = $1 AND status = 'open') AS credits,
            (SELECT COUNT(*) FROM sales_orders WHERE contact_id = $1 AND status = 'confirmed')::int AS open_orders,
            (SELECT COUNT(*) FROM estimates WHERE contact_id = $1 AND status = 'sent')::int AS pending_estimates`,
    [c.id],
  );
  res.json({ org, contact, ...b });
});

r.put('/:slug/me', async (req, res) => {
  const b = req.body || {};
  await query(
    'UPDATE contacts SET phone = $2, mobile = $3, billing_address = $4, shipping_address = $5, updated_at = now() WHERE id = $1',
    [req.contact.id, str(b.phone, { field: 'Phone', max: 30 }), str(b.mobile, { field: 'Mobile', max: 30 }),
      JSON.stringify(obj(b.billing_address)), JSON.stringify(obj(b.shipping_address))],
  );
  await audit({ query }, { orgId: req.orgId, user: null }, 'update', req.contact.contact_type, req.contact.id, `${req.contact.display_name} updated their details in the ${req.contact.contact_type} portal`);
  res.json({ ok: true });
});

r.post('/:slug/me/password', async (req, res) => {
  const { rows } = await query('SELECT portal_password_hash FROM contacts WHERE id = $1', [req.contact.id]);
  if (!(await bcrypt.compare(String(req.body?.current_password || ''), rows[0].portal_password_hash || ''))) throw badRequest('Current password is incorrect');
  const pass = String(req.body?.new_password || '');
  if (pass.length < 8) throw badRequest('Password must be at least 8 characters');
  await query('UPDATE contacts SET portal_password_hash = $2 WHERE id = $1', [req.contact.id, await bcrypt.hash(pass, 12)]);
  res.json({ ok: true });
});

const STRIP = ['created_by', 'created_by_name', 'warehouse_id', 'warehouse_name', 'org_id'];
const clean = (doc) => { for (const k of STRIP) delete doc[k]; return doc; };

r.get('/:slug/docs/:kind', async (req, res) => {
  const cfg = kindFor(req, req.params.kind);
  const { rows } = await query(
    `SELECT id, number, reference, doc_date, status, total, currency, ${cfg.table === 'invoices' ? 'due_date, balance, payment_link_url,' : ''}
            ${['credit_notes', 'vendor_credits'].includes(cfg.table) ? 'balance,' : ''} ${cfg.table === 'estimates' ? 'expiry_date,' : ''}
            ${cfg.table === 'bills' ? 'due_date, balance,' : ''} ${cfg.table === 'purchase_orders' ? 'expected_delivery_date, vendor_response,' : ''} created_at
       FROM ${cfg.table} WHERE org_id = $1 AND contact_id = $2 AND status <> ALL($3::text[]) ORDER BY doc_date DESC, id DESC LIMIT 500`,
    [req.orgId, req.contact.id, cfg.hidden],
  );
  res.json(rows);
});

async function ownDoc(req, kind, docId) {
  const cfg = kindFor(req, kind);
  const doc = await fetchDoc({ query }, cfg, req.orgId, docId).catch(() => null);
  if (!doc || doc.contact_id !== req.contact.id || cfg.hidden.includes(doc.status)) throw notFound(cfg.label);
  return { cfg, doc };
}

r.get('/:slug/docs/:kind/:id', async (req, res) => {
  const { cfg, doc } = await ownDoc(req, req.params.kind, Number(req.params.id));
  const { rows: comments } = await query(
    `SELECT c.id, c.body, c.created_at, c.contact_id, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.org_id = $1 AND c.entity_type = $2 AND c.entity_id = $3 AND NOT c.is_internal ORDER BY c.created_at`,
    [req.orgId, cfg.entity, doc.id],
  );
  if (cfg.table === 'invoices') {
    const { rows } = await query(
      `SELECT p.number, p.payment_date, p.mode, a.amount FROM payment_received_allocations a JOIN payments_received p ON p.id = a.payment_id
        WHERE a.invoice_id = $1 ORDER BY p.payment_date`, [doc.id]);
    doc.payments = rows;
    const { rows: [pay] } = await query("SELECT enabled FROM integrations WHERE org_id = $1 AND provider = 'razorpay'", [req.orgId]);
    doc.can_pay_online = !!pay?.enabled && ['sent', 'partially_paid'].includes(doc.status) && doc.balance > 0;
  }
  if (cfg.table === 'bills') {
    const { rows } = await query(
      `SELECT p.number, p.payment_date, p.mode, a.amount FROM payment_made_allocations a JOIN payments_made p ON p.id = a.payment_id
        WHERE a.bill_id = $1 ORDER BY p.payment_date`, [doc.id]);
    doc.payments = rows;
  }
  res.json({ ...clean(doc), comments, org_state: req.org.state });
});

r.post('/:slug/docs/:kind/:id/comments', async (req, res) => {
  const { cfg, doc } = await ownDoc(req, req.params.kind, Number(req.params.id));
  const body = str(req.body?.body, { field: 'Comment', required: true, max: 2000 });
  await query(
    'INSERT INTO comments (org_id, entity_type, entity_id, contact_id, body) VALUES ($1,$2,$3,$4,$5)',
    [req.orgId, cfg.entity, doc.id, req.contact.id, body],
  );
  await audit({ query }, { orgId: req.orgId, user: null }, 'comment', cfg.entity, doc.id, `${req.contact.display_name} commented on ${cfg.label} ${doc.number}: "${body.slice(0, 80)}"`);
  res.status(201).json({ ok: true });
});

r.post('/:slug/docs/estimates/:id/respond', async (req, res) => {
  const { doc } = await ownDoc(req, 'estimates', Number(req.params.id));
  const action = req.body?.action;
  if (!['accept', 'decline'].includes(action)) throw badRequest('Choose accept or decline');
  if (!['sent', 'accepted', 'declined'].includes(doc.status)) throw badRequest('This estimate can no longer be changed');
  if (doc.expiry_date && doc.expiry_date < today() && action === 'accept') throw badRequest('This estimate has expired. Please contact us for a new one.');
  const status = action === 'accept' ? 'accepted' : 'declined';
  await query('UPDATE estimates SET status = $2, updated_at = now() WHERE id = $1', [doc.id, status]);
  await audit({ query }, { orgId: req.orgId, user: null }, 'update', 'estimate', doc.id, `${req.contact.display_name} ${status} estimate ${doc.number} in the customer portal`);
  res.json({ status });
});

// Vendors accept or decline a purchase order, optionally confirming the delivery date.
r.post('/:slug/docs/purchase-orders/:id/respond', async (req, res) => {
  const { doc } = await ownDoc(req, 'purchase-orders', Number(req.params.id));
  const action = req.body?.action;
  if (!['accept', 'decline'].includes(action)) throw badRequest('Choose accept or decline');
  if (doc.status !== 'issued') throw badRequest('This purchase order can no longer be answered');
  const note = str(req.body?.note, { field: 'Note', max: 1000 });
  const delivery = action === 'accept' && req.body?.expected_delivery_date ? String(req.body.expected_delivery_date).slice(0, 10) : null;
  if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) throw badRequest('Enter a valid delivery date');
  const status = action === 'accept' ? 'accepted' : 'declined';
  await query(
    `UPDATE purchase_orders SET vendor_response = $2, vendor_response_at = now(), vendor_response_note = $3,
            expected_delivery_date = COALESCE($4::date, expected_delivery_date), updated_at = now() WHERE id = $1`,
    [doc.id, status, note, delivery],
  );
  await audit({ query }, { orgId: req.orgId, user: null }, 'update', 'purchase_order', doc.id,
    `${req.contact.display_name} ${status} purchase order ${doc.number} in the vendor portal${delivery ? ` (delivery ${delivery.split('-').reverse().join('/')})` : ''}${note ? `: "${note.slice(0, 80)}"` : ''}`);
  res.json({ vendor_response: status });
});

r.post('/:slug/docs/invoices/:id/pay', async (req, res) => {
  const { doc } = await ownDoc(req, 'invoices', Number(req.params.id));
  if (!['sent', 'partially_paid'].includes(doc.status) || doc.balance <= 0) throw badRequest('This invoice has nothing left to pay');
  const url = await ensurePaymentLink(req.orgId, doc.id);
  res.json({ url });
});

r.get('/:slug/payments', async (req, res) => {
  if (req.contact.contact_type === 'vendor') {
    const { rows } = await query(
      `SELECT p.id, p.number, p.payment_date, p.amount, p.currency, p.mode, p.reference,
              (SELECT string_agg(b.number, ', ') FROM payment_made_allocations a JOIN bills b ON b.id = a.bill_id WHERE a.payment_id = p.id) AS invoices
         FROM payments_made p WHERE p.org_id = $1 AND p.contact_id = $2 ORDER BY p.payment_date DESC`,
      [req.orgId, req.contact.id],
    );
    return res.json(rows);
  }
  const { rows } = await query(
    `SELECT p.id, p.number, p.payment_date, p.amount, p.currency, p.mode, p.reference,
            (SELECT string_agg(i.number, ', ') FROM payment_received_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id) AS invoices
       FROM payments_received p WHERE p.org_id = $1 AND p.contact_id = $2 ORDER BY p.payment_date DESC`,
    [req.orgId, req.contact.id],
  );
  res.json(rows);
});

r.get('/:slug/shipments', async (req, res) => {
  if (req.contact.contact_type === 'vendor') return res.json([]);
  const { rows } = await query(
    `SELECT s.id, s.number, s.ship_date, s.carrier, s.tracking_number, s.status, s.estimated_delivery, s.delivered_date,
            so.number AS sales_order_number, sc.tracking_url
       FROM shipments s JOIN sales_orders so ON so.id = s.sales_order_id
       LEFT JOIN shipping_carriers sc ON sc.org_id = s.org_id AND sc.name = s.carrier
      WHERE s.org_id = $1 AND s.contact_id = $2 ORDER BY s.ship_date DESC`,
    [req.orgId, req.contact.id],
  );
  res.json(rows.map((s) => ({ ...s, tracking_link: s.tracking_url && s.tracking_number ? s.tracking_url.replace('{tracking}', encodeURIComponent(s.tracking_number)) : null })));
});

// Account statement: invoices (+), payments and credit notes (−), with running balance.
r.get('/:slug/statement', async (req, res) => {
  if (req.contact.contact_type === 'vendor') {
    // From the vendor's side: bills are what we owe them (+), payments and vendor credits reduce it (−).
    const { rows } = await query(
      `SELECT * FROM (
         SELECT doc_date AS date, 'Bill' AS type, number, total AS debit, 0 AS credit, 0 AS ord FROM bills WHERE contact_id = $1 AND status NOT IN ('draft','void')
         UNION ALL SELECT doc_date, 'Vendor credit', number, 0, total, 2 FROM vendor_credits WHERE contact_id = $1 AND status IN ('open','closed')
         UNION ALL SELECT payment_date, 'Payment', number, 0, amount, 3 FROM payments_made WHERE contact_id = $1
       ) x ORDER BY date, ord, number`,
      [req.contact.id],
    );
    let due = 0;
    return res.json(rows.map((x) => { due += Number(x.debit) - Number(x.credit); return { ...x, balance: Math.round(due * 100) / 100 }; }));
  }
  const { rows } = await query(
    `SELECT * FROM (
       SELECT doc_date AS date, 'Invoice' AS type, number, total AS debit, 0 AS credit, 0 AS ord FROM invoices WHERE contact_id = $1 AND status NOT IN ('draft','void')
       UNION ALL SELECT r.refund_date, 'Refund', cn.number, r.amount, 0, 1 FROM credit_refunds r JOIN credit_notes cn ON cn.id = r.credit_note_id WHERE cn.contact_id = $1
       UNION ALL SELECT doc_date, 'Credit note', number, 0, total, 2 FROM credit_notes WHERE contact_id = $1 AND status IN ('open','closed')
       UNION ALL SELECT payment_date, 'Payment', number, 0, amount, 3 FROM payments_received WHERE contact_id = $1
     ) x ORDER BY date, ord, number`,
    [req.contact.id],
  );
  let bal = 0;
  res.json(rows.map((x) => { bal += Number(x.debit) - Number(x.credit); return { ...x, balance: Math.round(bal * 100) / 100 }; }));
});

// ------------------------------------------------------------------ staff side: enable portal for a customer or vendor
export const portalAdmin = portalAdminFor('customer');
export const vendorPortalAdmin = portalAdminFor('vendor');

function portalAdminFor(type) {
  const router = Router();
  const label = type === 'vendor' ? 'Vendor' : 'Customer';
  router.post('/:id/portal', can(type === 'vendor' ? 'vendors' : 'customers', 'edit'), async (req, res, next) => {
  try {
    const crypto = await import('node:crypto');
    const enable = req.body?.enable !== false;
    const result: any = await tx(async (client) => {
      const { rows: [c] } = await client.query('SELECT * FROM contacts WHERE org_id = $1 AND id = $2 AND contact_type = $3 FOR UPDATE', [req.orgId, Number(req.params.id), type]);
      if (!c) throw notFound(label);
      if (!enable) {
        await client.query('UPDATE contacts SET portal_enabled = FALSE, portal_token = NULL, portal_password_hash = NULL WHERE id = $1', [c.id]);
        await audit(client, req, 'update', type, c.id, `${label} portal turned off for ${c.display_name}`);
        return { enabled: false };
      }
      const { assertModule } = await import('../lib/plans.js');
      await assertModule(req.orgId, 'portal');
      if (!c.email) throw badRequest(`Add an email address to this ${type} first — they sign in to the portal with it`);
      const token = crypto.randomBytes(24).toString('hex');
      await client.query('UPDATE contacts SET portal_enabled = TRUE, portal_token = $2 WHERE id = $1', [c.id, token]);
      const { rows: [org] } = await client.query('SELECT portal_slug FROM organizations WHERE id = $1', [req.orgId]);
      await audit(client, req, 'update', type, c.id, `${label} portal invitation created for ${c.display_name}`);
      return { enabled: true, email: c.email, name: c.display_name, path: `/portal/${org.portal_slug}/invite/${token}`, portal_path: `/portal/${org.portal_slug}` };
    });
    if (result.enabled) {
      const { emailLink } = await import('./email.js');
      const { appUrl } = await import('../lib/mailer.js');
      result.url = `${appUrl()}${result.path}`;
      result.emailed = await emailLink(req, {
        to: result.email, subject: `Your ${type} portal access`, title: `Hello ${result.name}`,
        intro: type === 'vendor'
          ? 'You can now see our purchase orders, accept them and confirm delivery dates, and follow your bills and payments online. Open the link to choose your password.'
          : 'You can now see your orders, invoices, payments and shipments online, and pay invoices. Open the link to choose your password.',
        label: 'Set up my account', url: result.url,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
  });
  return router;
}

export default r;
