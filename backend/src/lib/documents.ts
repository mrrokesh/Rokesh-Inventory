import { badRequest, notFound } from './errors.js';
import { num, id, str, round2, round3 } from './validate.js';

/** Validate an array of priced lines from a request body. */
export function parseLines(input: any, { allowNoItem = true, extra = [] }: any = {}) {
  if (!Array.isArray(input) || input.length === 0) throw badRequest('Add at least one line item');
  return input.map((l, i) => {
    const row = i + 1;
    const line = {
      item_id: id(l.item_id, { field: `Line ${row} item` }),
      description: str(l.description, { field: `Line ${row} description`, max: 2000 }),
      quantity: round3(num(l.quantity, { field: `Line ${row} quantity`, required: true, min: 0.001 })),
      rate: round2(num(l.rate, { field: `Line ${row} rate`, min: 0, def: 0 })),
      discount_percent: num(l.discount_percent, { field: `Line ${row} discount`, min: 0, max: 100, def: 0 }),
      tax_id: id(l.tax_id, { field: `Line ${row} tax` }),
      position: i,
    };
    if (!line.item_id && !allowNoItem) throw badRequest(`Line ${row}: select an item`);
    if (!line.item_id && !line.description) throw badRequest(`Line ${row}: select an item or enter a description`);
    for (const key of extra) line[key] = l[key] ?? null;
    return line;
  });
}

export async function loadTaxRates(db, orgId, lines) {
  const ids = [...new Set(lines.map((l) => l.tax_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await db.query('SELECT id, rate FROM taxes WHERE org_id = $1 AND id = ANY($2::bigint[])', [orgId, ids]);
  const map = new Map(rows.map((r) => [r.id, Number(r.rate)]));
  for (const t of ids) if (!map.has(t)) throw badRequest(`Tax #${t} does not exist`);
  return map;
}

/**
 * Compute line amounts and document totals.
 * line amount = qty * rate * (1 - line discount%)
 * document discount% applies to the sub total; tax is charged on the discounted line amounts.
 */
export function computeTotals(lines, taxRates, header) {
  const docDisc = Number(header.discount_percent) || 0;
  let subTotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    l.tax_rate = l.tax_id ? taxRates.get(l.tax_id) ?? 0 : 0;
    l.amount = round2(l.quantity * l.rate * (1 - (l.discount_percent || 0) / 100));
    subTotal += l.amount;
    taxTotal += l.amount * (1 - docDisc / 100) * (l.tax_rate / 100);
  }
  subTotal = round2(subTotal);
  const discountTotal = round2(subTotal * docDisc / 100);
  taxTotal = round2(taxTotal);
  const total = round2(subTotal - discountTotal + taxTotal + (Number(header.shipping_charge) || 0) + (Number(header.adjustment) || 0));
  if (total < 0) throw badRequest('Document total cannot be negative');
  return { sub_total: subTotal, discount_total: discountTotal, tax_total: taxTotal, total };
}

export async function insertLines(client, table, docId, lines, extraCols = []) {
  const cols = ['doc_id', 'item_id', 'description', 'quantity', 'rate', 'discount_percent', 'tax_id', 'tax_rate', 'amount', 'position', ...extraCols];
  for (const l of lines) {
    const values = [docId, l.item_id, l.description, l.quantity, l.rate, l.discount_percent, l.tax_id, l.tax_rate, l.amount, l.position,
      ...extraCols.map((c) => l[c] ?? null)];
    await client.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      values,
    );
  }
}

/** Fetch a priced document with its lines and related names. */
export async function fetchDoc(db: any, cfg: any, orgId: any, docId: any, { lock = false }: any = {}) {
  const { rows } = await db.query(
    `SELECT d.*, c.display_name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
            c.billing_address AS contact_billing_address, c.shipping_address AS contact_shipping_address,
            c.gstin AS contact_gstin, c.gst_treatment AS contact_gst_treatment,
            w.name AS warehouse_name, u.name AS created_by_name
       FROM ${cfg.table} d
       JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN users u ON u.id = d.created_by
      WHERE d.org_id = $1 AND d.id = $2`,
    [orgId, docId],
  );
  if (!rows[0]) throw notFound(cfg.label);
  if (lock) await db.query(`SELECT id FROM ${cfg.table} WHERE id = $1 FOR UPDATE`, [docId]);
  const doc = rows[0];
  const { rows: lines } = await db.query(
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.track_inventory, i.item_type,
            i.tracking AS item_tracking, i.hsn_sac, t.name AS tax_name
       FROM ${cfg.linesTable} l
       LEFT JOIN items i ON i.id = l.item_id
       LEFT JOIN taxes t ON t.id = l.tax_id
      WHERE l.doc_id = $1 ORDER BY l.position, l.id`,
    [docId],
  );
  doc.lines = lines;
  return doc;
}

/** Ensure a contact exists, belongs to the org, and is of the right type. */
export async function getContact(db, orgId, contactId, type) {
  const { rows } = await db.query(
    'SELECT * FROM contacts WHERE org_id = $1 AND id = $2 AND contact_type = $3',
    [orgId, contactId, type],
  );
  if (!rows[0]) throw badRequest(`Select a valid ${type}`);
  return rows[0];
}

export async function getWarehouse(db, orgId, warehouseId) {
  if (warehouseId) {
    const { rows } = await db.query("SELECT * FROM warehouses WHERE org_id = $1 AND id = $2", [orgId, warehouseId]);
    if (!rows[0]) throw badRequest('Select a valid warehouse');
    if (rows[0].status !== 'active') throw badRequest(`Warehouse ${rows[0].name} is inactive`);
    return rows[0];
  }
  const { rows } = await db.query(
    "SELECT * FROM warehouses WHERE org_id = $1 AND status = 'active' ORDER BY is_primary DESC, id LIMIT 1",
    [orgId],
  );
  if (!rows[0]) throw badRequest('Create a warehouse first (Settings → Warehouses)');
  return rows[0];
}

/** Recalculate paid/credited/balance/status for an invoice or bill. */
export async function refreshPayable(client, kind, docId) {
  const isInvoice = kind === 'invoice';
  const table = isInvoice ? 'invoices' : 'bills';
  const paidSql = isInvoice
    ? 'SELECT COALESCE(SUM(amount),0) AS s FROM payment_received_allocations WHERE invoice_id = $1'
    : 'SELECT COALESCE(SUM(amount),0) AS s FROM payment_made_allocations WHERE bill_id = $1';
  const creditSql = isInvoice
    ? 'SELECT COALESCE(SUM(amount),0) AS s FROM credit_applications WHERE invoice_id = $1'
    : 'SELECT COALESCE(SUM(amount),0) AS s FROM vendor_credit_applications WHERE bill_id = $1';
  const { rows: [p] } = await client.query(paidSql, [docId]);
  const { rows: [c] } = await client.query(creditSql, [docId]);
  const { rows: [d] } = await client.query(`SELECT total, status FROM ${table} WHERE id = $1`, [docId]);
  if (d.status === 'draft' || d.status === 'void') return;
  const paid = Number(p.s);
  const credited = Number(c.s);
  const balance = round2(Number(d.total) - paid - credited);
  const openStatus = isInvoice ? 'sent' : 'open';
  const status = balance <= 0.004 ? 'paid' : (paid + credited > 0 ? 'partially_paid' : openStatus);
  await client.query(
    `UPDATE ${table} SET amount_paid = $2, credits_applied = $3, balance = $4, status = $5, updated_at = now() WHERE id = $1`,
    [docId, paid, credited, Math.max(0, balance), status],
  );
}

/** Recalculate remaining balance / status of a credit note or vendor credit. */
export async function refreshCredit(client, kind, creditId) {
  const isCN = kind === 'credit_note';
  const table = isCN ? 'credit_notes' : 'vendor_credits';
  const appliedSql = isCN
    ? `SELECT (SELECT COALESCE(SUM(amount),0) FROM credit_applications WHERE credit_note_id = $1)
            + (SELECT COALESCE(SUM(amount),0) FROM credit_refunds WHERE credit_note_id = $1) AS s`
    : 'SELECT COALESCE(SUM(amount),0) AS s FROM vendor_credit_applications WHERE vendor_credit_id = $1';
  const { rows: [a] } = await client.query(appliedSql, [creditId]);
  const { rows: [d] } = await client.query(`SELECT total, status FROM ${table} WHERE id = $1`, [creditId]);
  if (d.status === 'draft' || d.status === 'void') return;
  const balance = round2(Number(d.total) - Number(a.s));
  if (balance < -0.004) throw badRequest('Amount exceeds the available credit');
  await client.query(`UPDATE ${table} SET balance = $2, status = $3, updated_at = now() WHERE id = $1`,
    [creditId, Math.max(0, balance), balance <= 0.004 ? 'closed' : 'open']);
}
