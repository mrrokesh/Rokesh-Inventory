// Permission catalogue: module -> allowed actions.
export const MODULES = {
  items: ['view', 'create', 'edit', 'delete', 'export', 'import'],
  inventory: ['view', 'create', 'edit', 'delete', 'approve'],         // adjustments, transfers, assemblies
  customers: ['view', 'create', 'edit', 'delete', 'export', 'import'],
  vendors: ['view', 'create', 'edit', 'delete', 'export', 'import'],
  estimates: ['view', 'create', 'edit', 'delete', 'approve'],
  sales_orders: ['view', 'create', 'edit', 'delete', 'approve'],
  delivery_challans: ['view', 'create', 'edit', 'delete', 'approve'],
  packages: ['view', 'create', 'edit', 'delete'],                     // packages + shipments
  invoices: ['view', 'create', 'edit', 'delete', 'approve'],
  payments_received: ['view', 'create', 'edit', 'delete'],
  sales_returns: ['view', 'create', 'edit', 'delete'],                // returns + credit notes
  purchase_orders: ['view', 'create', 'edit', 'delete', 'approve'],
  purchase_receives: ['view', 'create', 'edit', 'delete'],
  bills: ['view', 'create', 'edit', 'delete', 'approve'],
  payments_made: ['view', 'create', 'edit', 'delete'],
  vendor_credits: ['view', 'create', 'edit', 'delete'],
  reports: ['view', 'export'],
  documents: ['view', 'create', 'delete'],
  settings: ['view', 'edit'],
  users: ['view', 'create', 'edit', 'delete'],
};

const all = (mods) => Object.fromEntries(mods.map((m) => [m, [...MODULES[m]]]));
const viewOnly = (mods) => Object.fromEntries(mods.map((m) => [m, ['view']]));
const crud = (mods) => Object.fromEntries(mods.map((m) => [m, MODULES[m].filter((a) => a !== 'delete')]));

/** Roles created for every new organization. Admin bypasses all checks. */
export const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Full access to everything, including settings and users.', is_admin: true, permissions: {} },
  {
    name: 'Manager',
    description: 'Runs day-to-day sales, purchasing and inventory. No user management.',
    is_admin: false,
    permissions: {
      ...all(Object.keys(MODULES).filter((m) => !['settings', 'users'].includes(m))),
      settings: ['view'],
    },
  },
  {
    name: 'Sales User',
    description: 'Customers, sales orders, packages, invoices and payments received.',
    is_admin: false,
    permissions: {
      ...crud(['customers', 'estimates', 'sales_orders', 'delivery_challans', 'packages', 'invoices', 'payments_received', 'sales_returns']),
      ...viewOnly(['items']), documents: ['view', 'create'], reports: ['view'],
    },
  },
  {
    name: 'Purchase User',
    description: 'Vendors, purchase orders, receives, bills and vendor payments.',
    is_admin: false,
    permissions: {
      ...crud(['vendors', 'purchase_orders', 'purchase_receives', 'bills', 'payments_made', 'vendor_credits']),
      ...viewOnly(['items']), documents: ['view', 'create'], reports: ['view'],
    },
  },
  {
    name: 'Warehouse User',
    description: 'Stock handling: adjustments, transfers, packing, shipping and receiving.',
    is_admin: false,
    permissions: {
      items: ['view', 'edit'], inventory: ['view', 'create', 'edit'],
      packages: ['view', 'create', 'edit'], purchase_receives: ['view', 'create'], delivery_challans: ['view', 'create', 'edit'],
      ...viewOnly(['sales_orders', 'purchase_orders', 'sales_returns']), documents: ['view', 'create'], reports: ['view'],
    },
  },
  {
    name: 'Accountant',
    description: 'Invoices, bills, payments, credits and all reports.',
    is_admin: false,
    permissions: {
      ...all(['invoices', 'payments_received', 'bills', 'payments_made', 'vendor_credits', 'reports']),
      sales_returns: ['view', 'create', 'edit'],
      ...viewOnly(['items', 'customers', 'vendors', 'estimates', 'sales_orders', 'delivery_challans', 'purchase_orders', 'inventory', 'settings']),
      documents: ['view', 'create'],
    },
  },
];

/** Strip anything that is not in the catalogue. */
export function sanitizePermissions(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [mod, actions] of Object.entries(input)) {
    if (!MODULES[mod] || !Array.isArray(actions)) continue;
    const valid = actions.filter((a) => MODULES[mod].includes(a));
    if (valid.length) out[mod] = [...new Set(valid)];
  }
  return out;
}

export function hasPermission(user, module, action) {
  if (user.is_admin) return true;
  return Array.isArray(user.permissions?.[module]) && user.permissions[module].includes(action);
}
