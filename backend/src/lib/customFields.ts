// Custom fields: org-defined extra fields on items, contacts and transactions.
// Values live in each record's `custom_fields` JSONB column, keyed by field_key.
import { badRequest } from './errors.js';

export const CUSTOM_FIELD_ENTITIES: Record<string, string> = {
  item: 'Items',
  customer: 'Customers',
  vendor: 'Vendors',
  estimate: 'Estimates',
  sales_order: 'Sales orders',
  delivery_challan: 'Delivery challans',
  invoice: 'Invoices',
  credit_note: 'Credit notes',
  purchase_order: 'Purchase orders',
  bill: 'Bills',
  vendor_credit: 'Vendor credits',
};

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'decimal', 'date', 'checkbox', 'dropdown', 'email', 'url', 'phone'];

/** Custom field values from a request body: `custom_fields: {...}` or flat `cf_<key>` columns (CSV import). */
export function cfInput(b) {
  const out = {};
  for (const [k, v] of Object.entries(b || {})) if (k.startsWith('cf_')) out[k.slice(3)] = v;
  return { ...out, ...(b?.custom_fields && typeof b.custom_fields === 'object' ? b.custom_fields : {}) };
}

export async function fieldDefs(db, orgId, entity) {
  const { rows } = await db.query(
    'SELECT * FROM custom_fields WHERE org_id = $1 AND entity = $2 AND is_active ORDER BY position, id',
    [orgId, entity],
  );
  return rows;
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Validate submitted custom field values against the definitions.
 * Unknown keys are dropped; values of inactive/removed fields already stored are kept.
 */
export async function parseCustomFields(db, orgId, entity, input, existing = {}) {
  const defs = await fieldDefs(db, orgId, entity);
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...(existing || {}) };
  for (const d of defs) {
    let v = src[d.field_key];
    if (v === undefined) v = existing?.[d.field_key];
    if (empty(v) && d.default_value != null && existing?.[d.field_key] === undefined) v = d.default_value;
    if (d.field_type === 'checkbox') {
      out[d.field_key] = v === true || v === 'true' || v === 1 || v === '1';
      continue;
    }
    if (empty(v)) {
      if (d.required) throw badRequest(`${d.label} is required`);
      delete out[d.field_key];
      continue;
    }
    const s = String(v).trim();
    switch (d.field_type) {
      case 'number':
        if (!/^-?\d+$/.test(s)) throw badRequest(`${d.label} must be a whole number`);
        out[d.field_key] = Number(s);
        break;
      case 'decimal':
        if (!Number.isFinite(Number(s))) throw badRequest(`${d.label} must be a number`);
        out[d.field_key] = Number(s);
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) || Number.isNaN(Date.parse(s.slice(0, 10)))) throw badRequest(`${d.label} must be a valid date`);
        out[d.field_key] = s.slice(0, 10);
        break;
      case 'dropdown':
        if (!(d.options || []).includes(s)) throw badRequest(`${d.label}: choose one of ${(d.options || []).join(', ')}`);
        out[d.field_key] = s;
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`${d.label} must be a valid email address`);
        out[d.field_key] = s;
        break;
      case 'url':
        if (!/^https?:\/\/\S+$/i.test(s)) throw badRequest(`${d.label} must start with http:// or https://`);
        out[d.field_key] = s;
        break;
      default:
        if (s.length > (d.field_type === 'textarea' ? 5000 : 500)) throw badRequest(`${d.label} is too long`);
        out[d.field_key] = s;
    }
    if (d.pattern && ['text', 'phone'].includes(d.field_type)) {
      let re;
      try { re = new RegExp(`^(?:${d.pattern})$`); } catch { re = null; }
      if (re && !re.test(s)) throw badRequest(d.pattern_message || `${d.label} is not in the expected format`);
    }
  }
  return out;
}
