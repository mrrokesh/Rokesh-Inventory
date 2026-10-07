// Reporting tags: organization-wide labels (e.g. Region: North / South) chosen on transactions,
// so sales and purchases can be grouped and filtered by them. Stored as { "<tag id>": "<option>" }.
import { badRequest } from './errors.js';

export const TAG_MODULES: Record<string, string> = {
  estimate: 'Estimates', sales_order: 'Sales orders', delivery_challan: 'Delivery challans', invoice: 'Invoices',
  credit_note: 'Credit notes', purchase_order: 'Purchase orders', bill: 'Bills', vendor_credit: 'Vendor credits',
};

export async function parseTags(db, orgId, module, input, existing = {}) {
  const { rows: defs } = await db.query('SELECT * FROM reporting_tags WHERE org_id = $1 AND is_active AND $2 = ANY(modules) ORDER BY position, id', [orgId, module]);
  const src = input && typeof input === 'object' ? input : null;
  const out = { ...(existing || {}) };
  for (const d of defs) {
    const key = String(d.id);
    const v = src ? src[key] : existing?.[key];
    if (v === undefined || v === null || v === '') {
      if (d.required) throw badRequest(`Choose a value for the reporting tag “${d.name}”`);
      delete out[key];
      continue;
    }
    if (!(d.options || []).includes(String(v))) throw badRequest(`${d.name}: choose one of ${(d.options || []).join(', ')}`);
    out[key] = String(v);
  }
  return out;
}
