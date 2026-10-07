// PDF / document template settings (Settings -> PDF Templates).
export const TEMPLATE_DOC_TYPES = ['estimate', 'sales_order', 'delivery_challan', 'invoice', 'credit_note', 'purchase_order', 'bill', 'vendor_credit', 'package', 'payment_receipt'];

export const DEFAULT_TEMPLATE = {
  layout: 'standard',          // standard | compact | modern
  accent_color: '',            // empty = organization brand colour
  title: '',                   // empty = default title (e.g. "Tax Invoice")
  show_logo: true,
  show_org_address: true,
  show_sku: true,
  show_hsn: true,
  show_discount: true,
  show_tax_column: true,
  show_unit: true,
  show_custom_fields: true,
  show_signature: true,
  signature_label: 'Authorised Signatory',
  header_note: '',
  footer_note: '',
  bank_details: '',
  default_notes: '',
  default_terms: '',
  font_size: 'normal',         // small | normal | large
};

/** The template for a document type, merged with defaults. */
export async function documentTemplate(db, orgId, docType) {
  const { rows: [row] } = await db.query('SELECT settings FROM document_templates WHERE org_id = $1 AND doc_type = $2', [orgId, docType]);
  return { ...DEFAULT_TEMPLATE, ...(row?.settings || {}) };
}
