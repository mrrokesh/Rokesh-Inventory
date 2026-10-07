// Custom report builder. A data source is a fixed FROM clause plus a catalogue of fields
// (key → SQL expression). Saved reports only store field keys, operators and values, so users
// pick from the catalogue and never write SQL; values are always passed as parameters.
import { query } from '../db.js';
import { badRequest } from './errors.js';

type Field = { key: string; label: string; type: string; expr: string; sum?: boolean };
const F = (key, label, type, expr, extra: any = {}): Field => ({ key, label, type, expr, sum: ['money', 'number'].includes(type), ...extra });

const DOCS = {
  invoices: { label: 'Invoices', table: 'invoices', lines: 'invoice_lines', contact: 'Customer', cf: 'invoice', tagModule: 'invoice', extra: ['due_date', 'balance', 'salesperson'] },
  sales_orders: { label: 'Sales orders', table: 'sales_orders', lines: 'sales_order_lines', contact: 'Customer', cf: 'sales_order', tagModule: 'sales_order', extra: ['salesperson', 'expected_shipment_date', 'channel'] },
  estimates: { label: 'Estimates', table: 'estimates', lines: 'estimate_lines', contact: 'Customer', cf: 'estimate', tagModule: 'estimate', extra: ['salesperson', 'expiry_date'] },
  credit_notes: { label: 'Credit notes', table: 'credit_notes', lines: 'credit_note_lines', contact: 'Customer', cf: 'credit_note', tagModule: 'credit_note', extra: ['balance'] },
  purchase_orders: { label: 'Purchase orders', table: 'purchase_orders', lines: 'purchase_order_lines', contact: 'Vendor', cf: 'purchase_order', tagModule: 'purchase_order', extra: ['expected_delivery_date'] },
  bills: { label: 'Bills', table: 'bills', lines: 'bill_lines', contact: 'Vendor', cf: 'bill', tagModule: 'bill', extra: ['due_date', 'balance'] },
};
const EXTRA_FIELDS = {
  due_date: F('due_date', 'Due date', 'date', 'd.due_date'),
  balance: F('balance', 'Balance', 'money', 'd.balance * d.exchange_rate'),
  salesperson: F('salesperson', 'Salesperson', 'text', 'd.salesperson'),
  expected_shipment_date: F('expected_shipment_date', 'Expected shipment', 'date', 'd.expected_shipment_date'),
  expected_delivery_date: F('expected_delivery_date', 'Expected delivery', 'date', 'd.expected_delivery_date'),
  expiry_date: F('expiry_date', 'Valid until', 'date', 'd.expiry_date'),
  channel: F('channel', 'Sales channel', 'label', 'd.channel'),
};

function docHeaderSource(key, cfg) {
  return {
    key, label: cfg.label, group: 'Documents', from: `${cfg.table} d JOIN contacts c ON c.id = d.contact_id`, org: 'd.org_id', date: 'd.doc_date', tagAlias: 'd',
    cf: { entity: cfg.cf, alias: 'd' }, tagModule: cfg.tagModule,
    fields: [
      F('number', 'Number', 'text', 'd.number'), F('doc_date', 'Date', 'date', 'd.doc_date'), F('status', 'Status', 'status', 'd.status'),
      F('contact', cfg.contact, 'text', 'c.display_name'), F('reference', 'Reference#', 'text', 'd.reference'),
      F('place_of_supply', 'Place of supply', 'text', 'd.place_of_supply'), F('currency', 'Currency', 'text', 'd.currency'),
      ...cfg.extra.map((e) => EXTRA_FIELDS[e]),
      F('amount', 'Amount (excl. tax)', 'money', '(d.sub_total - d.discount_total) * d.exchange_rate'),
      F('tax', 'Tax', 'money', 'd.tax_total * d.exchange_rate'), F('total', 'Total', 'money', 'd.total * d.exchange_rate'),
      F('contact_gstin', `${cfg.contact} GSTIN`, 'text', 'c.gstin'), F('contact_state', `${cfg.contact} state`, 'text', 'c.place_of_supply'),
    ],
  };
}

function docLineSource(key, cfg) {
  return {
    key, label: `${cfg.label} – item lines`, group: 'Document lines',
    from: `${cfg.lines} l JOIN ${cfg.table} d ON d.id = l.doc_id JOIN contacts c ON c.id = d.contact_id LEFT JOIN items i ON i.id = l.item_id`,
    org: 'd.org_id', date: 'd.doc_date', tagAlias: 'd', tagModule: cfg.tagModule, cf: { entity: 'item', alias: 'i' },
    fields: [
      F('number', 'Document#', 'text', 'd.number'), F('doc_date', 'Date', 'date', 'd.doc_date'), F('status', 'Status', 'status', 'd.status'),
      F('contact', cfg.contact, 'text', 'c.display_name'), F('item', 'Item', 'text', 'COALESCE(i.name, l.description)'), F('sku', 'SKU', 'text', 'i.sku'),
      F('category', 'Category', 'text', "COALESCE(NULLIF(i.category, ''), '(no category)')"), F('brand', 'Brand', 'text', 'i.brand'), F('hsn', 'HSN/SAC', 'text', 'i.hsn_sac'),
      F('quantity', 'Quantity', 'number', 'l.quantity'), F('rate', 'Rate', 'money', 'l.rate * d.exchange_rate', { sum: false }),
      F('discount_percent', 'Line discount %', 'number', 'l.discount_percent', { sum: false }), F('tax_rate', 'Tax %', 'number', 'l.tax_rate', { sum: false }),
      F('amount', 'Amount (excl. tax)', 'money', 'l.amount * (1 - d.discount_percent / 100) * d.exchange_rate'),
      F('tax', 'Tax', 'money', 'l.amount * (1 - d.discount_percent / 100) * l.tax_rate / 100 * d.exchange_rate'),
    ],
  };
}

const contactSource = (type) => ({
  key: `${type}s`, label: type === 'customer' ? 'Customers' : 'Vendors', group: 'Lists', from: 'contacts c', org: 'c.org_id', date: 'c.created_at::date',
  where: `c.contact_type = '${type}'`, cf: { entity: type, alias: 'c' }, dated: false,
  fields: [
    F('name', 'Name', 'text', 'c.display_name'), F('company', 'Company', 'text', 'c.company_name'), F('email', 'Email', 'text', 'c.email'),
    F('phone', 'Phone', 'text', 'COALESCE(c.mobile, c.phone)'), F('gst_treatment', 'GST treatment', 'label', 'c.gst_treatment'), F('gstin', 'GSTIN', 'text', 'c.gstin'),
    F('state', 'Place of supply', 'text', 'c.place_of_supply'), F('city', 'City', 'text', "c.billing_address->>'city'"), F('currency', 'Currency', 'text', 'c.currency'),
    F('payment_terms', 'Payment terms (days)', 'number', 'c.payment_terms', { sum: false }), F('status', 'Status', 'status', 'c.status'),
    F('created', 'Created on', 'date', 'c.created_at::date'),
    type === 'customer'
      ? F('outstanding', 'Receivables', 'money', "(SELECT COALESCE(SUM(balance * exchange_rate), 0) FROM invoices x WHERE x.contact_id = c.id AND x.status IN ('sent','partially_paid'))")
      : F('outstanding', 'Payables', 'money', "(SELECT COALESCE(SUM(balance * exchange_rate), 0) FROM bills x WHERE x.contact_id = c.id AND x.status IN ('open','partially_paid'))"),
  ],
});

export const SOURCES: Record<string, any> = {
  ...Object.fromEntries(Object.entries(DOCS).map(([k, c]) => [k, docHeaderSource(k, c)])),
  ...Object.fromEntries(Object.entries(DOCS).map(([k, c]) => [`${k}_lines`, docLineSource(`${k}_lines`, c)])),
  items: {
    key: 'items', label: 'Items', group: 'Lists', org: 'i.org_id', date: 'i.created_at::date', dated: false, cf: { entity: 'item', alias: 'i' },
    from: `items i
      LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(committed) AS committed FROM stock_levels GROUP BY item_id) s ON s.item_id = i.id
      LEFT JOIN (SELECT item_id, SUM(qty_remaining * unit_cost) AS value FROM stock_lots GROUP BY item_id) v ON v.item_id = i.id`,
    fields: [
      F('name', 'Name', 'text', 'i.name'), F('sku', 'SKU', 'text', 'i.sku'), F('category', 'Category', 'text', "COALESCE(NULLIF(i.category, ''), '(no category)')"),
      F('brand', 'Brand', 'text', 'i.brand'), F('manufacturer', 'Manufacturer', 'text', 'i.manufacturer'), F('item_type', 'Type', 'label', 'i.item_type'),
      F('status', 'Status', 'status', 'i.status'), F('unit', 'Unit', 'text', 'i.unit'), F('hsn', 'HSN/SAC', 'text', 'i.hsn_sac'),
      F('selling_price', 'Selling price', 'money', 'i.selling_price', { sum: false }), F('cost_price', 'Cost price', 'money', 'i.cost_price', { sum: false }),
      F('reorder_level', 'Reorder point', 'number', 'i.reorder_level', { sum: false }), F('on_hand', 'Stock on hand', 'number', 'COALESCE(s.on_hand, 0)'),
      F('committed', 'Committed', 'number', 'COALESCE(s.committed, 0)'), F('available', 'Available', 'number', 'COALESCE(s.on_hand, 0) - COALESCE(s.committed, 0)'),
      F('stock_value', 'Stock value', 'money', 'COALESCE(v.value, 0)'),
    ],
  },
  customers: contactSource('customer'),
  vendors: contactSource('vendor'),
  stock_movements: {
    key: 'stock_movements', label: 'Stock movements', group: 'Inventory', org: 'm.org_id', date: 'm.movement_date',
    from: 'stock_movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id',
    fields: [
      F('date', 'Date', 'date', 'm.movement_date'), F('item', 'Item', 'text', 'i.name'), F('sku', 'SKU', 'text', 'i.sku'),
      F('category', 'Category', 'text', "COALESCE(NULLIF(i.category, ''), '(no category)')"), F('warehouse', 'Warehouse', 'text', 'w.name'),
      F('type', 'Transaction type', 'label', 'm.source_type'), F('number', 'Document#', 'text', 'm.source_number'),
      F('quantity', 'Quantity (+in / −out)', 'number', 'm.quantity'), F('value', 'Value (+in / −out)', 'money', 'm.value'), F('note', 'Note', 'text', 'm.note'),
    ],
  },
  payments_received: {
    key: 'payments_received', label: 'Payments received', group: 'Money', org: 'p.org_id', date: 'p.payment_date',
    from: 'payments_received p JOIN contacts c ON c.id = p.contact_id',
    fields: [
      F('number', 'Payment#', 'text', 'p.number'), F('date', 'Date', 'date', 'p.payment_date'), F('contact', 'Customer', 'text', 'c.display_name'),
      F('mode', 'Mode', 'label', 'p.mode'), F('reference', 'Reference', 'text', 'p.reference'), F('currency', 'Currency', 'text', 'p.currency'),
      F('amount', 'Amount', 'money', 'p.amount * p.exchange_rate'), F('unused', 'Unused', 'money', 'p.unused_amount * p.exchange_rate'),
    ],
  },
  payments_made: {
    key: 'payments_made', label: 'Payments made', group: 'Money', org: 'p.org_id', date: 'p.payment_date',
    from: 'payments_made p JOIN contacts c ON c.id = p.contact_id',
    fields: [
      F('number', 'Payment#', 'text', 'p.number'), F('date', 'Date', 'date', 'p.payment_date'), F('contact', 'Vendor', 'text', 'c.display_name'),
      F('mode', 'Mode', 'label', 'p.mode'), F('reference', 'Reference', 'text', 'p.reference'), F('currency', 'Currency', 'text', 'p.currency'),
      F('amount', 'Amount', 'money', 'p.amount * p.exchange_rate'), F('unused', 'Unused', 'money', 'p.unused_amount * p.exchange_rate'),
    ],
  },
};

export const OPS = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with',
  gt: 'more than / after', gte: 'at least / on or after', lt: 'less than / before', lte: 'at most / on or before', is_empty: 'is empty', is_not_empty: 'is not empty',
};

/** All fields of a source for this organization, including custom fields and reporting tags. */
export async function sourceFields(orgId, sourceKey) {
  const src = SOURCES[sourceKey];
  if (!src) throw badRequest('Choose what the report is about');
  const fields: Field[] = [...src.fields];
  if (src.cf) {
    const { rows } = await query('SELECT field_key, label, field_type FROM custom_fields WHERE org_id = $1 AND entity = $2 AND is_active ORDER BY position, id', [orgId, src.cf.entity]);
    for (const d of rows) {
      if (!/^[a-z0-9_]+$/.test(d.field_key)) continue;
      const raw = `${src.cf.alias}.custom_fields->>'${d.field_key}'`;
      const numeric = ['number', 'decimal'].includes(d.field_type);
      fields.push(F(`cf_${d.field_key}`, `${d.label}${src.cf.entity === 'item' && src.group === 'Document lines' ? ' (item)' : ''}`, numeric ? 'number' : d.field_type === 'date' ? 'date' : 'text',
        numeric ? `NULLIF(${raw}, '')::numeric` : d.field_type === 'date' ? `NULLIF(${raw}, '')::date` : raw, { sum: false }));
    }
  }
  if (src.tagModule) {
    const { rows } = await query('SELECT id, name FROM reporting_tags WHERE org_id = $1 AND $2 = ANY(modules) ORDER BY position, id', [orgId, src.tagModule]);
    for (const t of rows) fields.push(F(`tag_${Number(t.id)}`, `${t.name} (tag)`, 'text', `COALESCE(${src.tagAlias}.tags->>'${Number(t.id)}', '(not tagged)')`));
  }
  return fields;
}

export function parseDefinition(b, fields) {
  const byKey = new Map<string, Field>(fields.map((f) => [f.key, f]));
  const columns = ([...new Set((Array.isArray(b.columns) ? b.columns : []).map(String))] as string[]).filter((k) => byKey.has(k));
  if (!columns.length) throw badRequest('Choose at least one column');
  const filters = (Array.isArray(b.filters) ? b.filters : []).slice(0, 20).map((f, i) => {
    if (!byKey.has(f.field)) throw badRequest(`Filter ${i + 1}: choose a field`);
    if (!OPS[f.op]) throw badRequest(`Filter ${i + 1}: choose a comparison`);
    const value = String(f.value ?? '').slice(0, 300);
    if (!['is_empty', 'is_not_empty'].includes(f.op) && value === '') throw badRequest(`Filter ${i + 1}: enter a value`);
    return { field: f.field, op: f.op, value };
  });
  const group_by = b.group_by && byKey.has(b.group_by) ? b.group_by : null;
  const sort = b.sort?.field && (byKey.has(b.sort.field) || b.sort.field === 'count') ? { field: b.sort.field, dir: b.sort.dir === 'asc' ? 'asc' : 'desc' } : null;
  return { columns, filters, group_by, sort };
}

/** Run a definition. Returns the same shape as built-in reports ({ columns, rows, totals }). */
export async function runDefinition(orgId, sourceKey, def, { from, to, tagSql = (_a) => '' }: any) {
  const src = SOURCES[sourceKey];
  const fields = await sourceFields(orgId, sourceKey);
  const d = parseDefinition(def, fields);
  const byKey = new Map<string, Field>(fields.map((f) => [f.key, f]));
  const params: any[] = [orgId];
  const where = [`${src.org} = $1`];
  if (src.where) where.push(src.where);
  if (src.dated !== false && from && to) { params.push(from, to); where.push(`${src.date} BETWEEN $2 AND $3`); }
  for (const f of d.filters) {
    const fd = byKey.get(f.field);
    const e = fd.expr;
    if (f.op === 'is_empty') { where.push(`(${e} IS NULL OR (${e})::text = '')`); continue; }
    if (f.op === 'is_not_empty') { where.push(`(${e} IS NOT NULL AND (${e})::text <> '')`); continue; }
    const numeric = ['money', 'number'].includes(fd.type);
    const isDate = fd.type === 'date';
    const v = numeric ? Number(f.value) : f.value;
    if (numeric && !Number.isFinite(v)) throw badRequest(`“${fd.label}” needs a number`);
    params.push(['contains', 'not_contains'].includes(f.op) ? `%${f.value}%` : f.op === 'starts_with' ? `${f.value}%` : v);
    const ph = `$${params.length}${isDate ? '::date' : ''}`;
    const lhs = numeric || isDate ? e : `lower((${e})::text)`;
    const rhs = numeric || isDate ? ph : `lower(${ph})`;
    const op = { equals: '=', not_equals: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
    if (op) where.push(f.op === 'not_equals' ? `(${lhs} IS NULL OR ${lhs} <> ${rhs})` : `${lhs} ${op} ${rhs}`);
    else if (f.op === 'contains' || f.op === 'starts_with') where.push(`(${e})::text ILIKE $${params.length}`);
    else if (f.op === 'not_contains') where.push(`((${e}) IS NULL OR (${e})::text NOT ILIKE $${params.length})`);
  }
  const tagCond = src.tagAlias ? tagSql(src.tagAlias) : '';
  const whereSql = where.join(' AND ') + tagCond;
  let sql;
  let columns;
  if (d.group_by) {
    const g = byKey.get(d.group_by);
    const sums = d.columns.map((k) => byKey.get(k)).filter((f) => f.key !== g.key && ['money', 'number'].includes(f.type) && f.sum);
    columns = [{ key: 'group', label: g.label, type: g.type }, { key: 'count', label: 'Count', type: 'number' }, ...sums.map((f) => ({ key: f.key, label: f.label, type: f.type }))];
    const order = d.sort ? (d.sort.field === 'count' ? 'count' : d.sort.field === g.key ? 'group' : sums.some((f) => f.key === d.sort.field) ? `"${d.sort.field}"` : 'count') : sums.length ? `"${sums[0].key}"` : 'count';
    sql = `SELECT ${g.expr} AS "group", COUNT(*)::int AS count${sums.map((f) => `, SUM(${f.expr}) AS "${f.key}"`).join('')}
             FROM ${src.from} WHERE ${whereSql} GROUP BY 1 ORDER BY ${order} ${d.sort?.dir || 'desc'} NULLS LAST LIMIT 5000`;
  } else {
    const cols = d.columns.map((k) => byKey.get(k));
    columns = cols.map((f) => ({ key: f.key, label: f.label, type: f.type }));
    const sortField = d.sort && byKey.get(d.sort.field);
    const order = sortField ? `${sortField.expr} ${d.sort.dir} NULLS LAST` : src.date && src.dated !== false ? `${src.date} DESC` : '1';
    sql = `SELECT ${cols.map((f) => `${f.expr} AS "${f.key}"`).join(', ')} FROM ${src.from} WHERE ${whereSql} ORDER BY ${order} LIMIT 5000`;
  }
  const { rows } = await query(sql, params);
  const sumKeys = columns.filter((c) => c.key === 'count' || (byKey.get(c.key)?.sum && ['money', 'number'].includes(c.type))).map((c) => c.key);
  const totals = Object.fromEntries(sumKeys.map((k) => [k, Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100]));
  const chartValue = columns.find((c) => c.type === 'money') || columns.find((c) => c.key === 'count');
  return {
    columns, rows, totals: sumKeys.length ? totals : undefined,
    chart: d.group_by && chartValue ? { type: 'bar', label: 'group', value: chartValue.key, limit: 12 } : undefined,
    truncated: rows.length >= 5000,
  };
}
