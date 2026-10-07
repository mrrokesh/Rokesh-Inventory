import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { resolveCurrency } from '../lib/currency.js';
import { str, num, id, date, oneOf, today, listParams, round2 } from '../lib/validate.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { getContact, refreshPayable } from '../lib/documents.js';

export const PAYMENT_MODES = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'online_gateway', 'other'];

/** Router for payments received (against invoices) or payments made (against bills). */
export function paymentsRouter(kind) {
  const received = kind === 'received';
  const cfg = received
    ? { table: 'payments_received', alloc: 'payment_received_allocations', docTable: 'invoices', docCol: 'invoice_id', docKind: 'invoice', contactType: 'customer', module: 'payments_received', numberType: 'payment_received', label: 'Payment received', openStatuses: ['sent', 'partially_paid'] }
    : { table: 'payments_made', alloc: 'payment_made_allocations', docTable: 'bills', docCol: 'bill_id', docKind: 'bill', contactType: 'vendor', module: 'payments_made', numberType: 'payment_made', label: 'Payment made', openStatuses: ['open', 'partially_paid'] };
  const r = Router();
  const M = cfg.module;

  r.get('/', can(M, 'view'), async (req, res) => {
    const p = listParams(req.query, { number: 'd.number', date: 'd.payment_date', amount: 'd.amount', created: 'd.created_at', contact: 'c.display_name' }, 'created');
    const params = [req.orgId];
    const where = ['d.org_id = $1'];
    if (req.query.contact_id) { params.push(Number(req.query.contact_id)); where.push(`d.contact_id = $${params.length}`); }
    if (req.query.mode) { params.push(req.query.mode); where.push(`d.mode = $${params.length}`); }
    if (req.query.from) { params.push(req.query.from); where.push(`d.payment_date >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); where.push(`d.payment_date <= $${params.length}`); }
    if (p.search) { params.push(`%${p.search}%`); where.push(`(d.number ILIKE $${params.length} OR d.reference ILIKE $${params.length} OR c.display_name ILIKE $${params.length})`); }
    const w = where.join(' AND ');
    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      query(`SELECT d.*, c.display_name AS contact_name,
                    (SELECT string_agg(x.number, ', ') FROM ${cfg.alloc} a JOIN ${cfg.docTable} x ON x.id = a.${cfg.docCol} WHERE a.payment_id = d.id) AS applied_to
               FROM ${cfg.table} d JOIN contacts c ON c.id = d.contact_id WHERE ${w}
              ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      query(`SELECT COUNT(*)::int AS n FROM ${cfg.table} d JOIN contacts c ON c.id = d.contact_id WHERE ${w}`, params),
    ]);
    res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
  });

  r.get('/next-number', can(M, 'create'), async (req, res) => {
    res.json({ number: await peekNumber({ query }, req.orgId, cfg.numberType) });
  });

  async function fetchPayment(db, orgId, pid, lock = false) {
    const { rows } = await db.query(
      `SELECT d.*, c.display_name AS contact_name, c.email AS contact_email, c.billing_address AS contact_billing_address, u.name AS created_by_name
         FROM ${cfg.table} d JOIN contacts c ON c.id = d.contact_id LEFT JOIN users u ON u.id = d.created_by
        WHERE d.org_id = $1 AND d.id = $2 ${lock ? 'FOR UPDATE OF d' : ''}`,
      [orgId, pid],
    );
    if (!rows[0]) throw notFound(cfg.label);
    const { rows: allocations } = await db.query(
      `SELECT a.id, a.${cfg.docCol} AS doc_id, a.amount, x.number AS doc_number, x.doc_date, x.due_date, x.total AS doc_total, x.balance AS doc_balance, x.exchange_rate AS doc_rate
         FROM ${cfg.alloc} a JOIN ${cfg.docTable} x ON x.id = a.${cfg.docCol} WHERE a.payment_id = $1 ORDER BY x.doc_date`,
      [pid],
    );
    // Exchange gain/loss when a foreign-currency payment settles documents booked at another rate.
    const rate = Number(rows[0].exchange_rate) || 1;
    for (const a of allocations) {
      a.fx_gain = Math.round(Number(a.amount) * (received ? rate - Number(a.doc_rate) : Number(a.doc_rate) - rate) * 100) / 100;
    }
    return { ...rows[0], allocations, fx_gain: Math.round(allocations.reduce((s, a) => s + a.fx_gain, 0) * 100) / 100 };
  }

  r.get('/:id', can(M, 'view'), async (req, res) => {
    res.json(await fetchPayment({ query }, req.orgId, Number(req.params.id)));
  });

  async function applyAllocations(client, req, paymentId, contactId, amount, allocations) {
    let allocated = 0;
    const touched = new Set();
    for (const a of Array.isArray(allocations) ? allocations : []) {
      const value = round2(num(a.amount, { field: 'Amount applied', min: 0, def: 0 }));
      if (!value) continue;
      const docId = id(a.doc_id ?? a[cfg.docCol], { field: 'Document', required: true });
      const { rows: [doc] } = await client.query(`SELECT * FROM ${cfg.docTable} WHERE org_id = $1 AND id = $2 FOR UPDATE`, [req.orgId, docId]);
      if (!doc || doc.contact_id !== contactId) throw badRequest(`${cfg.docKind === 'invoice' ? 'Invoice' : 'Bill'} not found for this ${cfg.contactType}`);
      if (!cfg.openStatuses.includes(doc.status)) throw badRequest(`${doc.number} is not open for payment`);
      if (value > doc.balance + 0.004) throw badRequest(`Amount applied to ${doc.number} exceeds its balance (${doc.balance})`);
      const { rows: [pay] } = await client.query(`SELECT currency FROM ${cfg.table} WHERE id = $1`, [paymentId]);
      if ((doc.currency || pay.currency) !== pay.currency) throw badRequest(`${doc.number} is in ${doc.currency}; record a ${doc.currency} payment for it`);
      await client.query(`INSERT INTO ${cfg.alloc} (payment_id, ${cfg.docCol}, amount) VALUES ($1, $2, $3)`, [paymentId, docId, value]);
      await refreshPayable(client, cfg.docKind, docId);
      touched.add(docId);
      allocated += value;
    }
    allocated = round2(allocated);
    if (allocated > amount + 0.004) throw badRequest('The amounts applied exceed the payment amount');
    await client.query(`UPDATE ${cfg.table} SET unused_amount = $2 WHERE id = $1`, [paymentId, round2(amount - allocated)]);
    return touched;
  }

  function parse(b) {
    return {
      contact_id: id(b.contact_id, { field: cfg.contactType === 'customer' ? 'Customer' : 'Vendor', required: true }),
      payment_date: date(b.payment_date, { field: 'Payment date' }) || today(),
      amount: round2(num(b.amount, { field: 'Amount', required: true, min: 0.01 })),
      mode: oneOf(b.mode, PAYMENT_MODES, { field: 'Payment mode', def: 'cash' }),
      reference: str(b.reference, { field: 'Reference', max: 100 }),
      notes: str(b.notes, { field: 'Notes', max: 2000 }),
      ...(received ? { bank_charges: num(b.bank_charges, { field: 'Bank charges', min: 0, def: 0 }) } : {}),
    };
  }

  r.post('/', can(M, 'create'), async (req, res) => {
    const b = req.body || {};
    const v: any = parse(b);
    const result = await tx(async (client) => {
      const contact = await getContact(client, req.orgId, v.contact_id, cfg.contactType);
      Object.assign(v, await resolveCurrency(client, req.orgId, contact.currency, b.exchange_rate));
      const number = await takeNumber(client, req.orgId, cfg.numberType, b.number);
      const keys = Object.keys(v);
      const { rows: [pay] } = await client.query(
        `INSERT INTO ${cfg.table} (org_id, number, created_by, ${keys.join(', ')}) VALUES ($1, $2, $3, ${keys.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING id`,
        [req.orgId, number, req.user.id, ...keys.map((k) => v[k])],
      );
      await applyAllocations(client, req, pay.id, v.contact_id, v.amount, b.allocations);
      await audit(client, req, 'create', cfg.table, pay.id, `${cfg.label} ${number} of ${v.amount} recorded`);
      return fetchPayment(client, req.orgId, pay.id);
    });
    res.status(201).json(result);
  });

  r.put('/:id', can(M, 'edit'), async (req, res) => {
    const b = req.body || {};
    const v: any = parse(b);
    const result = await tx(async (client) => {
      const cur = await fetchPayment(client, req.orgId, Number(req.params.id), true);
      if (v.contact_id !== cur.contact_id) throw badRequest(`The ${cfg.contactType} of a payment cannot be changed`);
      const contact = await getContact(client, req.orgId, v.contact_id, cfg.contactType);
      Object.assign(v, await resolveCurrency(client, req.orgId, contact.currency, b.exchange_rate, cur));
      await client.query(`DELETE FROM ${cfg.alloc} WHERE payment_id = $1`, [cur.id]);
      for (const a of cur.allocations) await refreshPayable(client, cfg.docKind, a.doc_id);
      const keys = Object.keys(v);
      await client.query(
        `UPDATE ${cfg.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [cur.id, ...keys.map((k) => v[k])],
      );
      await applyAllocations(client, req, cur.id, v.contact_id, v.amount, b.allocations);
      await audit(client, req, 'update', cfg.table, cur.id, `${cfg.label} ${cur.number} updated`);
      return fetchPayment(client, req.orgId, cur.id);
    });
    res.json(result);
  });

  r.delete('/:id', can(M, 'delete'), async (req, res) => {
    await tx(async (client) => {
      const cur = await fetchPayment(client, req.orgId, Number(req.params.id), true);
      await client.query(`DELETE FROM ${cfg.table} WHERE id = $1`, [cur.id]);
      for (const a of cur.allocations) await refreshPayable(client, cfg.docKind, a.doc_id);
      await audit(client, req, 'delete', cfg.table, cur.id, `${cfg.label} ${cur.number} deleted`);
    });
    res.status(204).end();
  });

  return r;
}
