// Exchange gain / loss on foreign-currency transactions (amounts in the base currency).
// Realized: when a payment or credit clears an invoice/bill at a different rate than the document was booked at.
//   Sales:     gain = amount × (payment or credit-note rate − invoice rate)
//   Purchases: gain = amount × (bill rate − payment or vendor-credit rate)
// Unrealized: open balances revalued at today's rate (Settings → Currencies) — a "what if we settled today" view.
import { query } from '../db.js';

/** One row per settlement in the period. */
export const REALIZED_SQL = `
  SELECT p.payment_date AS date, 'Payment received' AS kind, p.number AS ref, d.number AS doc, d.currency, c.display_name AS contact,
         a.amount, d.exchange_rate AS doc_rate, p.exchange_rate AS settle_rate, a.amount * (p.exchange_rate - d.exchange_rate) AS gain
    FROM payment_received_allocations a JOIN payments_received p ON p.id = a.payment_id JOIN invoices d ON d.id = a.invoice_id JOIN contacts c ON c.id = d.contact_id
   WHERE d.org_id = $1 AND p.payment_date BETWEEN $2 AND $3 AND p.exchange_rate <> d.exchange_rate
  UNION ALL
  SELECT ca.applied_date, 'Credit note applied', cn.number, d.number, d.currency, c.display_name,
         ca.amount, d.exchange_rate, cn.exchange_rate, ca.amount * (cn.exchange_rate - d.exchange_rate)
    FROM credit_applications ca JOIN credit_notes cn ON cn.id = ca.credit_note_id JOIN invoices d ON d.id = ca.invoice_id JOIN contacts c ON c.id = d.contact_id
   WHERE d.org_id = $1 AND ca.applied_date BETWEEN $2 AND $3 AND cn.exchange_rate <> d.exchange_rate
  UNION ALL
  SELECT p.payment_date, 'Payment made', p.number, d.number, d.currency, c.display_name,
         a.amount, d.exchange_rate, p.exchange_rate, a.amount * (d.exchange_rate - p.exchange_rate)
    FROM payment_made_allocations a JOIN payments_made p ON p.id = a.payment_id JOIN bills d ON d.id = a.bill_id JOIN contacts c ON c.id = d.contact_id
   WHERE d.org_id = $1 AND p.payment_date BETWEEN $2 AND $3 AND p.exchange_rate <> d.exchange_rate
  UNION ALL
  SELECT va.applied_date, 'Vendor credit applied', vc.number, d.number, d.currency, c.display_name,
         va.amount, d.exchange_rate, vc.exchange_rate, va.amount * (d.exchange_rate - vc.exchange_rate)
    FROM vendor_credit_applications va JOIN vendor_credits vc ON vc.id = va.vendor_credit_id JOIN bills d ON d.id = va.bill_id JOIN contacts c ON c.id = d.contact_id
   WHERE d.org_id = $1 AND va.applied_date BETWEEN $2 AND $3 AND vc.exchange_rate <> d.exchange_rate`;

export async function realizedGain(orgId, from, to) {
  const { rows: [r] } = await query(`SELECT COALESCE(SUM(gain), 0)::float AS v FROM (${REALIZED_SQL}) x`, [orgId, from, to]);
  return Math.round(r.v * 100) / 100;
}

/** Open foreign-currency balances revalued at today's saved rate. */
export const UNREALIZED_SQL = `
  SELECT 'Invoice' AS kind, d.number AS doc, d.currency, c.display_name AS contact, d.balance AS amount,
         d.exchange_rate AS doc_rate, k.exchange_rate AS settle_rate, d.balance * (k.exchange_rate - d.exchange_rate) AS gain
    FROM invoices d JOIN contacts c ON c.id = d.contact_id JOIN currencies k ON k.org_id = d.org_id AND k.code = d.currency
   WHERE d.org_id = $1 AND d.status IN ('sent','partially_paid') AND d.balance > 0 AND k.exchange_rate <> d.exchange_rate
  UNION ALL
  SELECT 'Bill', d.number, d.currency, c.display_name, d.balance,
         d.exchange_rate, k.exchange_rate, d.balance * (d.exchange_rate - k.exchange_rate)
    FROM bills d JOIN contacts c ON c.id = d.contact_id JOIN currencies k ON k.org_id = d.org_id AND k.code = d.currency
   WHERE d.org_id = $1 AND d.status IN ('open','partially_paid') AND d.balance > 0 AND k.exchange_rate <> d.exchange_rate`;
