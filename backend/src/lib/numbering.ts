import { conflict } from './errors.js';

// Default prefixes, matching Zoho Inventory conventions.
export const DEFAULT_SERIES = [
  ['estimate', 'EST-', 5],
  ['sales_order', 'SO-', 5],
  ['delivery_challan', 'DC-', 5],
  ['package', 'PKG-', 5],
  ['shipment', 'SHP-', 5],
  ['invoice', 'INV-', 6],
  ['payment_received', 'PR-', 5],
  ['sales_return', 'RMA-', 5],
  ['credit_note', 'CN-', 5],
  ['purchase_order', 'PO-', 5],
  ['purchase_receive', 'RCV-', 5],
  ['payment_made', 'PM-', 5],
  ['vendor_credit', 'DN-', 5],
  ['inventory_adjustment', 'ADJ-', 5],
  ['transfer_order', 'TO-', 5],
  ['assembly', 'ASM-', 5],
];

export const formatNumber = (prefix, n, padding) => `${prefix}${String(n).padStart(padding, '0')}`;

/** Peek at the next number without consuming it (for new-document forms). */
export async function peekNumber(db, orgId, docType) {
  const { rows } = await db.query(
    'SELECT prefix, next_number, padding FROM number_series WHERE org_id = $1 AND doc_type = $2',
    [orgId, docType],
  );
  if (!rows[0]) return '';
  return formatNumber(rows[0].prefix, rows[0].next_number, rows[0].padding);
}

/**
 * Returns the number to use. If the caller supplied a number, it is used as-is
 * (and the sequence is advanced if it matches the auto value). Must run in a transaction.
 */
export async function takeNumber(client: any, orgId: any, docType: any, supplied?: any) {
  const { rows } = await client.query(
    `SELECT prefix, next_number, padding FROM number_series
      WHERE org_id = $1 AND doc_type = $2 FOR UPDATE`,
    [orgId, docType],
  );
  const s = rows[0];
  if (!s) throw conflict(`Numbering for ${docType} is not configured`);
  const auto = formatNumber(s.prefix, s.next_number, s.padding);
  const number = supplied && String(supplied).trim() ? String(supplied).trim() : auto;
  if (number === auto) {
    await client.query(
      'UPDATE number_series SET next_number = next_number + 1 WHERE org_id = $1 AND doc_type = $2',
      [orgId, docType],
    );
  }
  return number;
}
