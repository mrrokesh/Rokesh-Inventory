import { Router } from 'express';
import { query } from '../db.js';
import { can, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { str, int, bool, email as emailV } from '../lib/validate.js';
import { fetchDoc } from '../lib/documents.js';
import { encrypt, mask } from '../lib/secrets.js';
import { appUrl, emailLayout, esc, logEmail, sendMail, smtpSettings } from '../lib/mailer.js';
import { taxBreakdown } from '../lib/gst.js';
import { hasPermission } from '../lib/permissions.js';
import { DEFAULT_TEMPLATE, documentTemplate } from '../lib/templates.js';
import { fieldDefs } from '../lib/customFields.js';

const r = Router();

// Documents that can be emailed: entity -> table config + permission module.
export const EMAILABLE = {
  estimate: { table: 'estimates', linesTable: 'estimate_lines', label: 'Estimate', module: 'estimates' },
  sales_order: { table: 'sales_orders', linesTable: 'sales_order_lines', label: 'Sales Order', module: 'sales_orders' },
  invoice: { table: 'invoices', linesTable: 'invoice_lines', label: 'Invoice', module: 'invoices' },
  credit_note: { table: 'credit_notes', linesTable: 'credit_note_lines', label: 'Credit Note', module: 'sales_returns' },
  delivery_challan: { table: 'delivery_challans', linesTable: 'delivery_challan_lines', label: 'Delivery Challan', module: 'delivery_challans' },
  purchase_order: { table: 'purchase_orders', linesTable: 'purchase_order_lines', label: 'Purchase Order', module: 'purchase_orders' },
  vendor_credit: { table: 'vendor_credits', linesTable: 'vendor_credit_lines', label: 'Vendor Credit', module: 'vendor_credits' },
};

const inr = (n, cur = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur }).format(Number(n) || 0);
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/** Template settings and custom field definitions used when rendering a document. */
export async function documentExtras(db, orgId, entityType) {
  const template = await documentTemplate(db, orgId, entityType);
  const fields = await fieldDefs(db, orgId, entityType);
  return { template, fields };
}

function cfText(d, v) {
  if (v === undefined || v === null || v === '') return '';
  if (d.field_type === 'checkbox') return v ? 'Yes' : 'No';
  if (d.field_type === 'date') return fmtDate(v);
  return String(v);
}

/** HTML for a priced document (used in emails and the customer portal). */
export function documentHtml(cfg, doc, org, extras: any = {}) {
  const t = { ...DEFAULT_TEMPLATE, ...(extras.template || {}) };
  const accent = t.accent_color || org.brand_color || '#408dfb';
  const cfs = t.show_custom_fields
    ? (extras.fields || []).filter((d) => d.show_in_pdf).map((d) => [d.label, cfText(d, doc.custom_fields?.[d.field_key])]).filter(([, v]) => v)
    : [];
  const cur = doc.currency || org.currency || 'INR';
  const gst = taxBreakdown(doc, org.state);
  const rows = doc.lines.map((l, i) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(l.item_name || '')}${t.show_sku && l.item_sku ? `<span style="color:#8a90a0"> · ${esc(l.item_sku)}</span>` : ''}${l.description ? `<div style="color:#5a6276;font-size:12px">${esc(l.description)}</div>` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${Number(l.quantity)} ${t.show_unit ? esc(l.item_unit || '') : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(l.rate, cur)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${inr(l.amount, cur)}</td></tr>`).join('');
  const taxRows = gst.rows.flatMap((t) => (gst.inter
    ? [[`IGST ${t.rate}%`, t.igst]]
    : [[`CGST ${t.rate / 2}%`, t.cgst], [`SGST ${t.rate / 2}%`, t.sgst]]));
  const line = (k: any, v?: any, bold?: any) => `<tr><td style="padding:4px 8px;text-align:right;${bold ? 'font-weight:700' : ''}">${esc(k)}</td><td style="padding:4px 8px;text-align:right;${bold ? 'font-weight:700' : ''}">${v}</td></tr>`;
  return `
  <table role="presentation" width="100%" style="font-size:13px;margin-bottom:12px"><tr>
    <td><strong style="color:${accent}">${esc(t.title || cfg.label)} #${esc(doc.number)}</strong><br>Date: ${fmtDate(doc.doc_date)}${doc.due_date ? `<br>Due: ${fmtDate(doc.due_date)}` : ''}${doc.expiry_date ? `<br>Valid until: ${fmtDate(doc.expiry_date)}` : ''}${doc.reference ? `<br>Ref: ${esc(doc.reference)}` : ''}${cfs.map(([k, v]) => `<br>${esc(k)}: ${esc(v)}`).join('')}</td>
    <td style="text-align:right">${esc(doc.contact_name)}${doc.contact_gstin ? `<br>GSTIN ${esc(doc.contact_gstin)}` : ''}${doc.place_of_supply ? `<br>Place of supply: ${esc(doc.place_of_supply)}` : ''}</td>
  </tr></table>
  ${t.header_note ? `<p style="white-space:pre-line;border-left:3px solid ${accent};padding:6px 10px;background:#f7f8fa">${esc(t.header_note)}</p>` : ''}
  <table role="presentation" width="100%" cellspacing="0" style="font-size:13px;border-collapse:collapse">
    <tr style="background:#f4f5f8;border-bottom:2px solid ${accent}"><th style="padding:8px;text-align:left">#</th><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Rate</th><th style="padding:8px;text-align:right">Amount</th></tr>
    ${rows}
  </table>
  <table role="presentation" style="margin-left:auto;font-size:13px;margin-top:10px">
    ${line('Sub total', inr(doc.sub_total, cur))}
    ${Number(doc.discount_total) ? line(`Discount (${Number(doc.discount_percent)}%)`, `-${inr(doc.discount_total, cur)}`) : ''}
    ${taxRows.map(([k, v]) => line(k, inr(v, cur))).join('')}
    ${Number(doc.shipping_charge) ? line('Shipping', inr(doc.shipping_charge, cur)) : ''}
    ${Number(doc.adjustment) ? line('Adjustment', inr(doc.adjustment, cur)) : ''}
    ${line('Total', inr(doc.total, cur), true)}
    ${doc.balance !== undefined && doc.status !== 'draft' && cfg.table === 'invoices' ? line('Balance due', inr(doc.balance, cur), true) : ''}
  </table>
  ${doc.notes ? `<p style="margin-top:16px;white-space:pre-line">${esc(doc.notes)}</p>` : ''}
  ${doc.terms ? `<p style="color:#5a6276;font-size:12px;white-space:pre-line">${esc(doc.terms)}</p>` : ''}
  ${t.bank_details ? `<p style="font-size:12px;white-space:pre-line"><strong>Bank details</strong><br>${esc(t.bank_details)}</p>` : ''}
  ${t.footer_note ? `<p style="color:#8a90a0;font-size:12px;text-align:center;white-space:pre-line;border-top:1px solid #eee;padding-top:8px">${esc(t.footer_note)}</p>` : ''}`;
}

// ------------------------------------------------------------------ SMTP settings
r.get('/settings', can('settings', 'view'), async (req, res) => {
  const s = await smtpSettings(req.orgId);
  if (!s) return res.json({ configured: false });
  res.json({ configured: true, host: s.host, port: s.port, secure: s.secure, user: s.user, from_name: s.from_name, from_email: s.from_email, password: mask(s.pass) });
});

r.put('/settings', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (b.clear) {
    await query('UPDATE organizations SET smtp = NULL WHERE id = $1', [req.orgId]);
    return res.json({ configured: false });
  }
  const cur = await smtpSettings(req.orgId);
  const smtp = {
    host: str(b.host, { field: 'SMTP server', required: true, max: 200 }),
    port: int(b.port, { field: 'Port', min: 1, max: 65535, def: 587 }),
    secure: bool(b.secure),
    user: str(b.user, { field: 'Username', max: 200 }),
    from_name: str(b.from_name, { field: 'From name', max: 100 }),
    from_email: emailV(b.from_email, { field: 'From email', required: true }),
    pass_enc: b.password ? encrypt(b.password) : (cur ? encrypt(cur.pass) : null),
  };
  await query('UPDATE organizations SET smtp = $2 WHERE id = $1', [req.orgId, JSON.stringify(smtp)]);
  await audit({ query }, req, 'update', 'organization', req.orgId, 'Email (SMTP) settings updated');
  res.json({ configured: true });
});

r.post('/settings/test', requireAdmin, async (req, res) => {
  const to = emailV(req.body?.to, { field: 'Send test to', required: true });
  const { rows: [org] } = await query('SELECT name FROM organizations WHERE id = $1', [req.orgId]);
  await sendMail(req.orgId, {
    to, subject: `Test email from ${org.name}`,
    html: emailLayout({ orgName: org.name, title: 'Email is working', intro: 'This test message confirms your email settings are correct. You can now email documents to customers and vendors.' }),
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ preview & send documents
async function buildDocEmail(req, entityType, entityId) {
  const cfg = EMAILABLE[entityType];
  if (!cfg) throw badRequest('This kind of document cannot be emailed');
  if (!hasPermission(req.user, cfg.module, 'view')) throw badRequest('You do not have access to this document');
  const doc = await fetchDoc({ query }, cfg, req.orgId, entityId);
  const { rows: [org] } = await query('SELECT * FROM organizations WHERE id = $1', [req.orgId]);
  const { rows: [contact] } = await query('SELECT portal_enabled, email FROM contacts WHERE id = $1', [doc.contact_id]);
  const portal = contact.portal_enabled && org.portal_slug ? `${appUrl()}/portal/${org.portal_slug}` : null;
  const button = doc.payment_link_url && ['sent', 'partially_paid'].includes(doc.status)
    ? { label: `Pay ${inr(doc.balance, doc.currency || org.currency)} online`, url: doc.payment_link_url }
    : portal ? { label: 'View in customer portal', url: portal } : null;
  const extras = await documentExtras({ query }, req.orgId, entityType);
  return { cfg, doc, org, contact, button, extras };
}

r.get('/compose/:entityType/:id', async (req, res) => {
  const { cfg, doc, org, contact } = await buildDocEmail(req, req.params.entityType, Number(req.params.id));
  const configured = !!(await smtpSettings(req.orgId));
  res.json({
    configured,
    to: contact.email || doc.contact_email || '',
    subject: `${cfg.label} ${doc.number} from ${org.name}`,
    message: `Dear ${doc.contact_name},\n\nPlease find ${cfg.label.toLowerCase()} ${doc.number} for ${inr(doc.total, doc.currency || org.currency)} below.${
      doc.due_date && cfg.table === 'invoices' ? `\nIt is due on ${fmtDate(doc.due_date)}.` : ''}\n\nThank you for your business.\n${org.name}`,
  });
});

r.post('/send', async (req, res) => {
  const b = req.body || {};
  const entityType = str(b.entity_type, { field: 'Document type', required: true });
  const entityId = Number(b.entity_id);
  const { cfg, doc, org, button, extras } = await buildDocEmail(req, entityType, entityId);
  const to = String(b.to || '').split(/[,;\s]+/).filter(Boolean).map((e) => emailV(e, { field: 'To' }));
  if (!to.length) throw badRequest('Enter at least one recipient');
  const cc = String(b.cc || '').split(/[,;\s]+/).filter(Boolean).map((e) => emailV(e, { field: 'Cc' }));
  const subject = str(b.subject, { field: 'Subject', required: true, max: 200 });
  const message = str(b.message, { field: 'Message', max: 5000 }) || '';
  const html = emailLayout({ orgName: org.name, intro: message, button, bodyHtml: documentHtml(cfg, doc, org, extras) });
  try {
    await sendMail(req.orgId, { to, cc, subject, html, replyTo: org.email || undefined });
    await logEmail(req.orgId, { entityType, entityId, to, subject, status: 'sent', userId: req.user.id });
  } catch (err) {
    await logEmail(req.orgId, { entityType, entityId, to, subject, status: 'failed', error: err.message, userId: req.user.id });
    throw err;
  }
  await audit({ query }, req, 'update', entityType, entityId, `${cfg.label} ${doc.number} emailed to ${to.join(', ')}`);
  res.json({ ok: true });
});

r.get('/log', async (req, res) => {
  const params = [req.orgId];
  let where = 'org_id = $1';
  if (req.query.entity_type) { params.push(req.query.entity_type); where += ` AND entity_type = $${params.length}`; }
  if (req.query.entity_id) { params.push(Number(req.query.entity_id)); where += ` AND entity_id = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM email_log WHERE ${where} ORDER BY created_at DESC LIMIT 100`, params);
  res.json(rows);
});

/** Email a link (invitation / password reset / portal invite) if email is configured. Returns true if sent. */
export async function emailLink(req: any, opts: any) {
  const { to, subject, title, intro, label, url } = opts || {};
  if (!(await smtpSettings(req.orgId)) || !to) return false;
  const { rows: [org] } = await query('SELECT name FROM organizations WHERE id = $1', [req.orgId]);
  try {
    await sendMail(req.orgId, { to, subject, html: emailLayout({ orgName: org.name, title, intro, button: { label, url } }) });
    await logEmail(req.orgId, { to, subject, status: 'sent', userId: req.user?.id });
    return true;
  } catch (err) {
    await logEmail(req.orgId, { to, subject, status: 'failed', error: err.message, userId: req.user?.id });
    return false;
  }
}

export default r;
