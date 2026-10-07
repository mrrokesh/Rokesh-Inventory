// User-guide articles live in /docs/user-guide/*.md (readable on their own in the repository)
// and are bundled into the app's Help Center.
const files = import.meta.glob('../../../../docs/user-guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const raw = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split('/').pop().replace('.md', ''), text]));

export const ARTICLES = [
  { slug: 'getting-started', group: 'Start here', description: 'Set up the app and complete your first sale in 10 steps.', routes: ['/'] },
  { slug: 'glossary', group: 'Start here', description: 'Plain-language meaning of every word used in the app.', routes: [] },
  { slug: 'dashboard', group: 'Start here', description: 'Read and customize the widgets on your Home page.', routes: [] },
  { slug: 'items', group: 'Everyday work', description: 'Add products and services, variants, kits and price lists.', routes: ['/items', '/item-groups', '/composite-items', '/price-lists', '/import/items'] },
  { slug: 'contacts', group: 'Everyday work', description: 'Add the customers you sell to and the vendors you buy from.', routes: ['/customers', '/vendors', '/import/customers', '/import/vendors'] },
  { slug: 'selling', group: 'Everyday work', description: 'Sales order → package → shipment → invoice → payment.', routes: ['/sales-orders', '/invoices', '/packages', '/shipments'] },
  { slug: 'estimates-challans', group: 'Everyday work', description: 'Send quotes, and dispatch goods on approval or for job work.', routes: ['/estimates', '/delivery-challans'] },
  { slug: 'buying', group: 'Everyday work', description: 'Purchase order → receive → bill → payment, and landed costs.', routes: ['/purchase-orders', '/purchase-receives', '/bills', '/vendor-credits', '/landed-costs'] },
  { slug: 'returns', group: 'Everyday work', description: 'Take goods back, give credit and refund customers.', routes: ['/sales-returns', '/credit-notes'] },
  { slug: 'payments', group: 'Everyday work', description: 'Record money received and money paid.', routes: ['/payments-received', '/payments-made'] },
  { slug: 'stock', group: 'Stock & reports', description: 'Correct counts, move stock between warehouses, build kits.', routes: ['/inventory'] },
  { slug: 'serial-batch', group: 'Stock & reports', description: 'Track every unit by serial number, or lots by batch and expiry.', routes: [] },
  { slug: 'gst', group: 'Stock & reports', description: 'CGST/SGST vs IGST, HSN codes and GSTR-1 / GSTR-3B reports.', routes: ['/reports/gstr'] },
  { slug: 'reports', group: 'Stock & reports', description: 'Find the right report for your question.', routes: ['/reports'] },
  { slug: 'documents', group: 'Stock & reports', description: 'Attach files and print or save PDFs.', routes: ['/documents'] },
  { slug: 'settings-users', group: 'Admin', description: 'Company details, taxes, warehouses, users and roles.', routes: ['/settings', '/profile'] },
  { slug: 'customization', group: 'Admin', description: 'Custom fields, PDF templates, branding, reporting tags and MSME vendors.', routes: ['/settings/custom-fields', '/settings/templates', '/settings/branding', '/settings/reporting-tags'] },
  { slug: 'workflows', group: 'Admin', description: 'Automatic emails, tasks, webhooks and field updates.', routes: ['/settings/workflows'] },
  { slug: 'customer-portal', group: 'Admin', description: 'Let customers see their invoices, orders and shipments online.', routes: [] },
  { slug: 'email-integrations', group: 'Admin', description: 'Email documents, online payments, Shiprocket, Shopify and APIs.', routes: ['/settings/email', '/settings/integrations', '/settings/developer'] },
  { slug: 'faq', group: 'Admin', description: 'Answers to common problems and error messages.', routes: [] },
].map((a) => {
  const text = raw[a.slug] || `# ${a.slug}\n\nThis guide is missing.`;
  const title = (text.match(/^#\s+(.+)$/m) || [])[1] || a.slug;
  return { ...a, title, text };
});

export const ARTICLE_MAP = Object.fromEntries(ARTICLES.map((a) => [a.slug, a]));

/** The most relevant guide for an app path (longest matching route prefix). */
export function helpSlugFor(pathname) {
  let best = 'getting-started';
  let len = 0;
  for (const a of ARTICLES) {
    for (const r of a.routes) {
      const match = r === '/' ? pathname === '/' : pathname === r || pathname.startsWith(`${r}/`);
      if (match && r.length > len) { best = a.slug; len = r.length; }
    }
  }
  return best;
}
