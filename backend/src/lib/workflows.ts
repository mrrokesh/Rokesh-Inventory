// Workflow rules engine.
// Events are queued by audit() inside the same transaction as the change, then a background
// worker checks them against the organization's rules and runs the actions. Date-based rules
// ("3 days after the due date") are checked by a second, slower timer.
import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { badRequest } from './errors.js';
import { fieldDefs, parseCustomFields } from './customFields.js';
import { appUrl, emailLayout, esc, logEmail, sendMail } from './mailer.js';

// ------------------------------------------------------------------ record types
const DOC_FIELDS = [
  ['number', 'Number', 'text'], ['reference', 'Reference#', 'text'], ['status', 'Status', 'select'],
  ['contact_name', 'Contact name', 'text'], ['contact_email', 'Contact email', 'text'],
  ['doc_date', 'Date', 'date'], ['due_date', 'Due date', 'date'], ['expiry_date', 'Valid until', 'date'],
  ['expected_shipment_date', 'Expected shipment date', 'date'], ['expected_delivery_date', 'Expected delivery date', 'date'],
  ['sub_total', 'Sub total', 'number'], ['total', 'Total', 'number'], ['balance', 'Balance', 'number'],
  ['salesperson', 'Salesperson', 'text'], ['place_of_supply', 'Place of supply', 'text'], ['channel', 'Sales channel', 'text'],
  ['notes', 'Notes', 'text'],
];
const DOC_UPDATABLE = ['reference', 'salesperson', 'notes', 'terms'];

const doc = (label, table, contact, path, statuses, events = ['create', 'update', 'approve', 'void']) => ({
  label, table, contact, path, statuses, events, kind: 'doc', fields: DOC_FIELDS, updatable: DOC_UPDATABLE,
});

export const WF_MODULES: Record<string, any> = {
  estimate: doc('Estimates', 'estimates', 'customer', '/estimates', ['draft', 'sent', 'accepted', 'declined', 'converted'], ['create', 'update']),
  sales_order: doc('Sales orders', 'sales_orders', 'customer', '/sales-orders', ['draft', 'confirmed', 'closed', 'void']),
  delivery_challan: doc('Delivery challans', 'delivery_challans', 'customer', '/delivery-challans', ['draft', 'open', 'delivered', 'returned', 'invoiced'], ['create', 'update', 'approve']),
  invoice: doc('Invoices', 'invoices', 'customer', '/invoices', ['draft', 'sent', 'partially_paid', 'paid', 'void']),
  credit_note: doc('Credit notes', 'credit_notes', 'customer', '/credit-notes', ['draft', 'open', 'closed', 'void']),
  purchase_order: doc('Purchase orders', 'purchase_orders', 'vendor', '/purchase-orders', ['draft', 'issued', 'cancelled', 'closed']),
  bill: doc('Bills', 'bills', 'vendor', '/bills', ['draft', 'open', 'partially_paid', 'paid', 'void']),
  vendor_credit: doc('Vendor credits', 'vendor_credits', 'vendor', '/vendor-credits', ['draft', 'open', 'closed', 'void']),
  item: {
    label: 'Items', table: 'items', path: '/items', kind: 'item', statuses: ['active', 'inactive'], events: ['create', 'update'],
    fields: [
      ['name', 'Name', 'text'], ['sku', 'SKU', 'text'], ['category', 'Category', 'text'], ['brand', 'Brand', 'text'], ['manufacturer', 'Manufacturer', 'text'],
      ['item_type', 'Item type', 'text'], ['status', 'Status', 'select'], ['selling_price', 'Selling price', 'number'], ['cost_price', 'Cost price', 'number'],
      ['reorder_level', 'Reorder point', 'number'], ['stock_on_hand', 'Stock on hand', 'number'], ['created_at', 'Created on', 'date'],
    ],
    updatable: ['category', 'brand', 'manufacturer', 'description'],
  },
  customer: {
    label: 'Customers', table: 'contacts', contactType: 'customer', path: '/customers', kind: 'contact', statuses: ['active', 'inactive'], events: ['create', 'update'],
    fields: [
      ['display_name', 'Display name', 'text'], ['company_name', 'Company name', 'text'], ['email', 'Email', 'text'], ['phone', 'Phone', 'text'],
      ['gst_treatment', 'GST treatment', 'text'], ['place_of_supply', 'Place of supply', 'text'], ['payment_terms', 'Payment terms (days)', 'number'],
      ['credit_limit', 'Credit limit', 'number'], ['status', 'Status', 'select'], ['created_at', 'Created on', 'date'],
    ],
    updatable: ['notes'],
  },
};
WF_MODULES.vendor = { ...WF_MODULES.customer, label: 'Vendors', contactType: 'vendor', path: '/vendors', fields: WF_MODULES.customer.fields.filter((f) => f[0] !== 'credit_limit') };

export const WF_EVENTS = { create: 'Created', update: 'Edited', approve: 'Approved / sent', void: 'Voided' };
export const WF_OPS = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with',
  gt: 'is greater than / after', gte: 'is at least / on or after', lt: 'is less than / before', lte: 'is at most / on or before',
  is_empty: 'is empty', is_not_empty: 'is not empty',
};
export const WF_ACTIONS = ['email', 'sms', 'webhook', 'field_update', 'task'];

const columnCache = new Map();
async function tableColumns(table) {
  if (!columnCache.has(table)) {
    const { rows } = await query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table]);
    columnCache.set(table, new Set(rows.map((r) => r.column_name)));
  }
  return columnCache.get(table);
}

/** Fields that can be used in conditions / placeholders / date triggers for a module (incl. custom fields). */
export async function moduleFields(db, orgId, module) {
  const m = WF_MODULES[module];
  const cols = await tableColumns(m.table);
  const virtual = new Set(['contact_name', 'contact_email', 'stock_on_hand']);
  const fields = m.fields
    .filter(([k]) => virtual.has(k) || cols.has(k))
    .filter(([k]) => !(m.kind !== 'doc' && (k === 'contact_name' || k === 'contact_email')))
    .map(([key, label, type]) => ({ key, label, type, options: key === 'status' ? m.statuses : undefined }));
  const defs = await fieldDefs(db, orgId, module);
  for (const d of defs) {
    const type = ['number', 'decimal'].includes(d.field_type) ? 'number' : d.field_type === 'date' ? 'date' : d.field_type === 'checkbox' ? 'boolean' : d.field_type === 'dropdown' ? 'select' : 'text';
    fields.push({ key: `cf.${d.field_key}`, label: d.label, type, options: d.field_type === 'dropdown' ? d.options : undefined, custom: true });
  }
  const updatable = [
    ...m.updatable.filter((k) => cols.has(k)).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1).replace('_', ' '), type: 'text' })),
    ...fields.filter((f) => f.custom),
  ];
  return { fields, updatable, dateFields: fields.filter((f) => f.type === 'date' && !f.custom) };
}

// ------------------------------------------------------------------ rule validation
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

export async function parseRule(db, orgId, b) {
  const module = clean(b.module, 40);
  const m = WF_MODULES[module];
  if (!m) throw badRequest('Choose what the rule applies to');
  const name = clean(b.name, 120);
  if (!name) throw badRequest('Give the rule a name');
  const meta = await moduleFields(db, orgId, module);
  const fieldKeys = new Map<string, any>(meta.fields.map((f) => [f.key, f]));
  const trigger_type = b.trigger_type === 'date' ? 'date' : 'event';
  let events = [];
  let date_field = null;
  let offset_days = 0;
  if (trigger_type === 'event') {
    events = [...new Set((Array.isArray(b.events) ? b.events : []).map(String))].filter((e) => m.events.includes(e));
    if (!events.length) throw badRequest('Choose when the rule runs (created, edited, …)');
  } else {
    date_field = clean(b.date_field, 60);
    if (!meta.dateFields.some((f) => f.key === date_field)) throw badRequest('Choose the date the rule is based on');
    offset_days = Math.trunc(Number(b.offset_days) || 0);
    if (Math.abs(offset_days) > 365) throw badRequest('Days before/after must be between -365 and 365');
  }
  const conditions = (Array.isArray(b.conditions) ? b.conditions : []).slice(0, 20).map((c, i) => {
    const f = fieldKeys.get(String(c.field));
    if (!f) throw badRequest(`Condition ${i + 1}: choose a field`);
    if (!WF_OPS[c.op]) throw badRequest(`Condition ${i + 1}: choose a comparison`);
    const value = clean(c.value, 300);
    if (!['is_empty', 'is_not_empty'].includes(c.op) && value === '' && f.type !== 'boolean') throw badRequest(`Condition ${i + 1}: enter a value for “${f.label}”`);
    return { field: f.key, op: c.op, value };
  });
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 10).map((a, i) => parseAction(a, i, module, meta));
  if (!actions.length) throw badRequest('Add at least one action');
  for (const a of actions) {
    if (a.type === 'task' && a.assignee_id) {
      const { rows } = await db.query('SELECT 1 FROM users WHERE org_id = $1 AND id = $2', [orgId, a.assignee_id]);
      if (!rows.length) throw badRequest('The task assignee is not a user in this organization');
    }
  }
  return {
    name, module, trigger_type, events, date_field, offset_days, conditions, actions,
    description: clean(b.description, 500) || null,
    match: b.match === 'any' ? 'any' : 'all',
    is_active: b.is_active === undefined ? true : !!b.is_active,
  };
}

function parseAction(a, i, module, meta) {
  const n = `Action ${i + 1}`;
  switch (a?.type) {
    case 'email': {
      const emails = String(a.emails || '').split(/[,;\s]+/).filter(Boolean);
      for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest(`${n}: “${e}” is not a valid email address`);
      const to_contact = !!a.to_contact && module !== 'item';
      const to_creator = !!a.to_creator;
      if (!emails.length && !to_contact && !to_creator) throw badRequest(`${n}: choose who receives the email`);
      const subject = clean(a.subject, 200);
      if (!subject) throw badRequest(`${n}: enter an email subject`);
      return { type: 'email', to_contact, to_creator, emails: emails.join(', '), subject, message: clean(a.message, 5000), include_document: !!a.include_document };
    }
    case 'sms': {
      const numbers = String(a.numbers || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
      const to_contact = !!a.to_contact && module !== 'item';
      if (!numbers.length && !to_contact) throw badRequest(`${n}: choose who receives the text message`);
      const message = clean(a.message, 1000);
      if (!message) throw badRequest(`${n}: write the text message`);
      return { type: 'sms', to_contact, numbers: numbers.join(', '), message };
    }
    case 'webhook': {
      const url = clean(a.url, 500);
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw badRequest(`${n}: enter a web address starting with https://`);
      return { type: 'webhook', url, secret: clean(a.secret, 200) };
    }
    case 'field_update': {
      const f = meta.updatable.find((x) => x.key === a.field);
      if (!f) throw badRequest(`${n}: choose a field to update`);
      return { type: 'field_update', field: f.key, value: clean(a.value, 2000) };
    }
    case 'task': {
      const title = clean(a.title, 200);
      if (!title) throw badRequest(`${n}: enter a task title`);
      return {
        type: 'task', title, description: clean(a.description, 2000), assignee_id: a.assignee_id ? Number(a.assignee_id) : null,
        due_in_days: Math.max(0, Math.min(365, Math.trunc(Number(a.due_in_days) || 0))), priority: ['low', 'normal', 'high'].includes(a.priority) ? a.priority : 'normal',
      };
    }
    default:
      throw badRequest(`${n}: choose what to do`);
  }
}

// ------------------------------------------------------------------ queueing (called from audit)
/** Queue a change for workflow processing if any active rule listens for it. `db` may be a transaction client. */
export async function enqueueWorkflow(db, orgId, entityType, action, entityId, userId) {
  if (!entityId || !WF_MODULES[entityType] || !WF_EVENTS[action]) return;
  await db.query(
    `INSERT INTO workflow_queue (org_id, module, event, entity_id, user_id)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM workflow_rules WHERE org_id = $1 AND module = $2 AND is_active AND trigger_type = 'event' AND $3 = ANY(events))`,
    [orgId, entityType, action, entityId, userId ?? null],
  );
}

// ------------------------------------------------------------------ evaluation
export async function loadRecord(db, orgId, module, id) {
  const m = WF_MODULES[module];
  let sql;
  if (m.kind === 'doc') {
    sql = `SELECT t.*, c.display_name AS contact_name, c.email AS contact_email
             FROM ${m.table} t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.org_id = $1 AND t.id = $2`;
  } else if (m.kind === 'item') {
    sql = `SELECT t.*, COALESCE((SELECT SUM(on_hand) FROM stock_levels s WHERE s.item_id = t.id), 0)::float AS stock_on_hand
             FROM items t WHERE t.org_id = $1 AND t.id = $2`;
  } else {
    sql = `SELECT t.* FROM contacts t WHERE t.org_id = $1 AND t.id = $2 AND t.contact_type = '${m.contactType}'`;
  }
  const { rows: [rec] } = await db.query(sql, [orgId, id]);
  return rec || null;
}

const fieldValue = (rec, key) => (key.startsWith('cf.') ? rec.custom_fields?.[key.slice(3)] : rec[key]);
const asDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

export function checkCondition(rec, c, fieldType) {
  const raw = fieldValue(rec, c.field);
  if (c.op === 'is_empty') return isBlank(raw) || raw === false;
  if (c.op === 'is_not_empty') return !isBlank(raw) && raw !== false;
  if (fieldType === 'boolean') {
    const want = ['true', 'yes', '1'].includes(String(c.value).toLowerCase());
    const have = raw === true || raw === 'true';
    return c.op === 'not_equals' ? have !== want : have === want;
  }
  if (isBlank(raw)) return c.op === 'not_equals' || c.op === 'not_contains';
  let a: any = raw;
  let b: any = c.value;
  if (fieldType === 'number') { a = Number(raw); b = Number(c.value); }
  else if (fieldType === 'date') { a = asDate(raw); b = asDate(c.value); }
  else { a = String(raw).toLowerCase(); b = String(c.value).toLowerCase(); }
  switch (c.op) {
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'contains': return String(a).includes(String(b));
    case 'not_contains': return !String(a).includes(String(b));
    case 'starts_with': return String(a).startsWith(String(b));
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    default: return false;
  }
}

export function matches(rule, rec, fields) {
  if (!rule.conditions?.length) return true;
  const types = new Map(fields.map((f) => [f.key, f.type]));
  const results = rule.conditions.map((c) => checkCondition(rec, c, types.get(c.field) || 'text'));
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

const money = (n, cur = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur }).format(Number(n) || 0);
const prettyDate = (v) => asDate(v).split('-').reverse().join('/');

/** Replace {{field}} placeholders with the record's values. */
export function fillPlaceholders(text, ctx) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    if (key in ctx.extra) return ctx.extra[key];
    const f = ctx.fields.find((x) => x.key === key);
    const v = fieldValue(ctx.rec, key);
    if (v === undefined || v === null) return '';
    if (f?.type === 'date' || v instanceof Date) return prettyDate(v);
    if (f?.type === 'number' && !f.custom && /total|balance|price|limit/.test(key)) return money(v, ctx.rec.currency || ctx.org.currency);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  });
}

function recordLabel(module, rec) {
  return rec.number || rec.name || rec.display_name || `#${rec.id}`;
}

// ------------------------------------------------------------------ actions
async function runAction(a, ctx) {
  const { module, rec, org, rule } = ctx;
  const m = WF_MODULES[module];
  if (a.type === 'email') {
    const to = String(a.emails || '').split(/[,;\s]+/).filter(Boolean);
    if (a.to_contact) {
      const email = m.kind === 'doc' ? rec.contact_email : rec.email;
      if (email) to.push(email);
    }
    if (a.to_creator && rec.created_by) {
      const { rows: [u] } = await query('SELECT email FROM users WHERE id = $1', [rec.created_by]);
      if (u?.email) to.push(u.email);
    }
    const recipients = [...new Set(to)];
    if (!recipients.length) return { type: 'email', ok: false, message: 'No email address to send to (the contact has no email?)' };
    const subject = fillPlaceholders(a.subject, ctx);
    let bodyHtml = '';
    if (a.include_document && m.kind === 'doc') {
      const { EMAILABLE, documentHtml, documentExtras } = await import('../routes/email.js');
      const { fetchDoc } = await import('./documents.js');
      const cfg = EMAILABLE[module];
      if (cfg) {
        const full = await fetchDoc({ query }, cfg, ctx.orgId, rec.id);
        bodyHtml = documentHtml(cfg, full, org, await documentExtras({ query }, ctx.orgId, module));
      }
    }
    const html = emailLayout({ orgName: org.name, intro: fillPlaceholders(a.message, ctx), bodyHtml, button: { label: `Open ${recordLabel(module, rec)}`, url: ctx.extra.link } });
    try {
      await sendMail(ctx.orgId, { to: recipients, subject, html, replyTo: org.email || undefined });
      await logEmail(ctx.orgId, { entityType: module, entityId: rec.id, to: recipients, subject, status: 'sent' });
      return { type: 'email', ok: true, message: `Emailed ${recipients.join(', ')}` };
    } catch (err) {
      await logEmail(ctx.orgId, { entityType: module, entityId: rec.id, to: recipients, subject, status: 'failed', error: err.message });
      return { type: 'email', ok: false, message: err.message };
    }
  }
  if (a.type === 'sms') {
    const { sendSms } = await import('./sms.js');
    const numbers = String(a.numbers || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    if (a.to_contact) {
      let phone = m.kind === 'doc' ? null : rec.mobile || rec.phone;
      if (m.kind === 'doc') {
        const { rows: [c] } = await query('SELECT mobile, phone FROM contacts WHERE id = $1', [rec.contact_id]);
        phone = c?.mobile || c?.phone;
      }
      if (phone) numbers.push(phone);
    }
    const unique = [...new Set(numbers)];
    if (!unique.length) return { type: 'sms', ok: false, message: 'No mobile number to send to (the contact has no mobile number?)' };
    const text = fillPlaceholders(a.message, ctx);
    const sent = [];
    const failed = [];
    for (const num of unique) {
      try { sent.push((await sendSms(ctx.orgId, num, text, { entityType: module, entityId: rec.id })).to); } catch (err) { failed.push(`${num}: ${err.message}`); }
    }
    return { type: 'sms', ok: !failed.length, message: [sent.length ? `Texted ${sent.join(', ')}` : '', ...failed].filter(Boolean).join('; ') };
  }
  if (a.type === 'webhook') {
    const body = JSON.stringify({
      event: ctx.trigger, rule: { id: rule.id, name: rule.name }, module, occurred_at: new Date().toISOString(),
      record: Object.fromEntries(Object.entries(rec).filter(([k]) => !['org_id'].includes(k))),
    });
    const headers: any = { 'Content-Type': 'application/json', 'User-Agent': 'Inventory-Workflows/1.0', 'X-Inventory-Workflow': String(rule.id) };
    if (a.secret) headers['X-Inventory-Signature'] = `sha256=${crypto.createHmac('sha256', a.secret).update(body).digest('hex')}`;
    try {
      const res = await fetch(a.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      return { type: 'webhook', ok: res.ok, message: `${a.url} answered HTTP ${res.status}` };
    } catch (err) {
      return { type: 'webhook', ok: false, message: err.name === 'TimeoutError' ? 'Timed out after 10 s' : err.message };
    }
  }
  if (a.type === 'field_update') {
    const value = fillPlaceholders(a.value, ctx);
    if (a.field.startsWith('cf.')) {
      const key = a.field.slice(3);
      const next = await parseCustomFields({ query }, ctx.orgId, module, { [key]: value }, rec.custom_fields || {});
      await query(`UPDATE ${m.table} SET custom_fields = $3 WHERE org_id = $1 AND id = $2`, [ctx.orgId, rec.id, JSON.stringify(next)]);
      rec.custom_fields = next;
    } else {
      const cols = await tableColumns(m.table);
      if (!m.updatable.includes(a.field) || !cols.has(a.field)) return { type: 'field_update', ok: false, message: `Field ${a.field} cannot be updated` };
      await query(`UPDATE ${m.table} SET ${a.field} = $3 WHERE org_id = $1 AND id = $2`, [ctx.orgId, rec.id, value || null]);
      rec[a.field] = value;
    }
    // Logged directly (not via audit()) so a field update can never trigger another workflow run.
    await query('INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, summary) VALUES ($1, NULL, $2, $3, $4, $5)',
      [ctx.orgId, 'update', module, rec.id, `Workflow “${rule.name}” set ${a.field.replace('cf.', '')} to “${value}”`]);
    return { type: 'field_update', ok: true, message: `${a.field.replace('cf.', '')} set to “${value}”` };
  }
  if (a.type === 'task') {
    const { rows: [t] } = await query(
      `INSERT INTO tasks (org_id, title, description, priority, due_date, assignee_id, related_type, related_id, related_number, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8, $9, NULL) RETURNING id`,
      [ctx.orgId, fillPlaceholders(a.title, ctx), fillPlaceholders(a.description, ctx) || null, a.priority, a.due_in_days, a.assignee_id, module, rec.id, recordLabel(module, rec)],
    );
    return { type: 'task', ok: true, message: `Task #${t.id} created` };
  }
  return { type: a.type, ok: false, message: 'Unknown action' };
}

/** Run one rule's actions for one record and write the log. */
export async function executeRule(orgId, rule, module, rec, trigger, fields = null) {
  const { rows: [org] } = await query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  const meta = fields || (await moduleFields({ query }, orgId, module)).fields;
  const ctx = {
    orgId, rule, module, rec, org, trigger, fields: meta,
    extra: { org_name: org.name, link: `${appUrl()}${WF_MODULES[module].path}/${rec.id}`, today: prettyDate(new Date()), rule_name: rule.name },
  };
  const results = [];
  for (const a of rule.actions) {
    try { results.push(await runAction(a, ctx)); } catch (err) { results.push({ type: a.type, ok: false, message: err.message }); }
  }
  const okCount = results.filter((r) => r.ok).length;
  const status = okCount === results.length ? 'success' : okCount ? 'partial' : 'failed';
  const { rows } = await query(
    `INSERT INTO workflow_logs (org_id, rule_id, rule_name, module, entity_id, entity_label, trigger, status, results)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING RETURNING *`,
    [orgId, rule.id, rule.name, module, rec.id, recordLabel(module, rec), trigger, status, JSON.stringify(results)],
  );
  await query('UPDATE workflow_rules SET run_count = run_count + 1, last_run_at = now() WHERE id = $1', [rule.id]);
  return rows[0] || { status, results };
}

// ------------------------------------------------------------------ workers
async function processQueue() {
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query('BEGIN');
    ({ rows: jobs } = await client.query(
      'DELETE FROM workflow_queue WHERE id IN (SELECT id FROM workflow_queue ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *',
    ));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Workflow queue error:', err.message);
    return;
  } finally {
    client.release();
  }
  for (const job of jobs.sort((a, b) => Number(a.id) - Number(b.id))) {
    try {
      const { rows: rules } = await query(
        "SELECT * FROM workflow_rules WHERE org_id = $1 AND module = $2 AND is_active AND trigger_type = 'event' AND $3 = ANY(events) ORDER BY id",
        [job.org_id, job.module, job.event],
      );
      if (!rules.length) continue;
      const rec = await loadRecord({ query }, job.org_id, job.module, job.entity_id);
      if (!rec) continue;
      const { fields } = await moduleFields({ query }, job.org_id, job.module);
      for (const rule of rules) if (matches(rule, rec, fields)) await executeRule(job.org_id, rule, job.module, rec, job.event, fields);
    } catch (err) {
      console.error('Workflow run error:', err.message);
    }
  }
}

/** Check date-based rules (all of them, or just one right after it is saved). */
export async function processDateRules(ruleId = null) {
  const { rows: rules } = await query(
    `SELECT r.*, o.timezone FROM workflow_rules r JOIN organizations o ON o.id = r.org_id
      WHERE r.is_active AND r.trigger_type = 'date' ${ruleId ? 'AND r.id = $1' : ''}`,
    ruleId ? [ruleId] : [],
  );
  for (const rule of rules) {
    try {
      const m = WF_MODULES[rule.module];
      const meta = await moduleFields({ query }, rule.org_id, rule.module);
      if (!m || !meta.dateFields.some((f) => f.key === rule.date_field)) continue;
      const { rows: [{ today }] } = await query('SELECT to_char((now() AT TIME ZONE $1)::date, \'YYYY-MM-DD\') AS today', [rule.timezone || 'Asia/Kolkata']);
      const trigger = `date:${today}`;
      const { rows: due } = await query(
        `SELECT t.id FROM ${m.table} t
          WHERE t.org_id = $1 AND (t.${rule.date_field})::date + $2::int = $3::date
            ${m.contactType ? `AND t.contact_type = '${m.contactType}'` : ''}
            AND NOT EXISTS (SELECT 1 FROM workflow_logs l WHERE l.rule_id = $4 AND l.entity_id = t.id AND l.trigger = $5)
          LIMIT 200`,
        [rule.org_id, rule.offset_days, today, rule.id, trigger],
      );
      for (const { id } of due) {
        const rec = await loadRecord({ query }, rule.org_id, rule.module, id);
        if (rec && matches(rule, rec, meta.fields)) await executeRule(rule.org_id, rule, rule.module, rec, trigger, meta.fields);
      }
    } catch (err) {
      console.error(`Workflow date rule ${rule.id} error:`, err.message);
    }
  }
}

export function startWorkflowWorkers() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await processQueue(); } finally { busy = false; }
  }, 3000).unref();
  let dateBusy = false;
  const runDates = async () => {
    if (dateBusy) return;
    dateBusy = true;
    try { await processDateRules(); } catch (err) { console.error('Workflow date rules error:', err.message); } finally { dateBusy = false; }
  };
  setTimeout(runDates, 20000).unref();
  setInterval(runDates, 10 * 60 * 1000).unref();
}

