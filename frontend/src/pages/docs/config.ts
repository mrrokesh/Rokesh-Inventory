// Configuration for priced transaction documents.
export const CHALLAN_TYPES = [['supply_on_approval', 'Supply on approval'], ['job_work', 'Job work'], ['supply_of_liquid_gas', 'Supply of liquid gas'], ['others', 'Others']];

export const DOCS = {
  estimates: {
    key: 'estimates', api: '/estimates', path: '/estimates', title: 'Estimates', one: 'Estimate', perm: 'estimates',
    entity: 'estimate', contactType: 'customer', priceKind: 'sales', numberLabel: 'Estimate#', dateLabel: 'Estimate Date',
    printTitle: 'Estimate', warehouseLabel: 'Warehouse', addresses: true,
    header: [
      { key: 'expiry_date', label: 'Expiry Date', type: 'date' },
      { key: 'salesperson', label: 'Salesperson', type: 'text' },
    ],
    statuses: [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['converted', 'Converted']],
    postLabel: 'Save and Mark as Sent', postAction: 'send',
  },
  delivery_challans: {
    key: 'delivery_challans', api: '/delivery-challans', path: '/delivery-challans', title: 'Delivery Challans', one: 'Delivery Challan', perm: 'delivery_challans',
    entity: 'delivery_challan', contactType: 'customer', priceKind: 'sales', numberLabel: 'Delivery Challan#', dateLabel: 'Challan Date',
    printTitle: 'Delivery Challan', warehouseLabel: 'Dispatch from warehouse', addresses: true,
    header: [{ key: 'challan_type', label: 'Challan Type', type: 'select', options: CHALLAN_TYPES }],
    statuses: [['', 'All'], ['draft', 'Draft'], ['open', 'Open'], ['delivered', 'Delivered'], ['returned', 'Returned'], ['invoiced', 'Invoiced']],
    postLabel: 'Save and Open (stock out)', postAction: 'open',
  },
  sales_orders: {
    key: 'sales_orders', api: '/sales-orders', path: '/sales-orders', title: 'Sales Orders', one: 'Sales Order', perm: 'sales_orders',
    entity: 'sales_order', contactType: 'customer', priceKind: 'sales', numberLabel: 'Sales Order#', dateLabel: 'Sales Order Date',
    printTitle: 'Sales Order', warehouseLabel: 'Ship from warehouse', addresses: true,
    header: [
      { key: 'expected_shipment_date', label: 'Expected Shipment Date', type: 'date' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'terms' },
      { key: 'delivery_method', label: 'Delivery Method', type: 'text', list: ['Courier', 'Hand delivery', 'Pickup', 'Transport'] },
      { key: 'salesperson', label: 'Salesperson', type: 'text' },
    ],
    statuses: [['', 'All'], ['draft', 'Draft'], ['confirmed', 'Confirmed'], ['closed', 'Closed'], ['void', 'Void']],
    postLabel: 'Save and Confirm', postAction: 'confirm',
  },
  invoices: {
    key: 'invoices', api: '/invoices', path: '/invoices', title: 'Invoices', one: 'Invoice', perm: 'invoices',
    entity: 'invoice', contactType: 'customer', priceKind: 'sales', numberLabel: 'Invoice#', dateLabel: 'Invoice Date',
    printTitle: 'Tax Invoice', warehouseLabel: 'Warehouse', addresses: true, hasBalance: true, linkField: 'sales_order_id', lineLink: 'so_line_id',
    header: [
      { key: 'payment_terms', label: 'Terms', type: 'terms' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'salesperson', label: 'Salesperson', type: 'text' },
    ],
    statuses: [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['partially_paid', 'Partially paid'], ['paid', 'Paid'], ['void', 'Void']],
    postLabel: 'Save and Mark as Sent', postAction: 'send',
  },
  credit_notes: {
    key: 'credit_notes', api: '/credit-notes', path: '/credit-notes', title: 'Credit Notes', one: 'Credit Note', perm: 'sales_returns',
    entity: 'credit_note', contactType: 'customer', priceKind: 'sales', numberLabel: 'Credit Note#', dateLabel: 'Credit Note Date',
    printTitle: 'Credit Note', warehouseLabel: 'Warehouse', hasCredit: true,
    header: [],
    statuses: [['', 'All'], ['draft', 'Draft'], ['open', 'Open'], ['closed', 'Closed'], ['void', 'Void']],
    postLabel: 'Save as Open', postAction: 'open',
  },
  purchase_orders: {
    key: 'purchase_orders', api: '/purchase-orders', path: '/purchase-orders', title: 'Purchase Orders', one: 'Purchase Order', perm: 'purchase_orders',
    entity: 'purchase_order', contactType: 'vendor', priceKind: 'purchase', numberLabel: 'Purchase Order#', dateLabel: 'Date',
    printTitle: 'Purchase Order', warehouseLabel: 'Deliver to warehouse',
    header: [
      { key: 'expected_delivery_date', label: 'Expected Delivery Date', type: 'date' },
      { key: 'payment_terms', label: 'Payment Terms', type: 'terms' },
      { key: 'shipment_preference', label: 'Shipment Preference', type: 'text', list: ['Courier', 'Vendor delivery', 'Pickup', 'Transport'] },
    ],
    statuses: [['', 'All'], ['draft', 'Draft'], ['issued', 'Issued'], ['closed', 'Closed'], ['cancelled', 'Cancelled']],
    postLabel: 'Save and Issue', postAction: 'issue',
  },
  bills: {
    key: 'bills', api: '/bills', path: '/bills', title: 'Bills', one: 'Bill', perm: 'bills',
    entity: 'bill', contactType: 'vendor', priceKind: 'purchase', numberLabel: 'Bill#', dateLabel: 'Bill Date', manualNumber: true,
    printTitle: 'Bill', warehouseLabel: 'Receive into warehouse', hasBalance: true, linkField: 'purchase_order_id', lineLink: 'po_line_id', accountColumn: true,
    header: [
      { key: 'payment_terms', label: 'Payment Terms', type: 'terms' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
    ],
    statuses: [['', 'All'], ['draft', 'Draft'], ['open', 'Open'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['partially_paid', 'Partially paid'], ['paid', 'Paid'], ['void', 'Void']],
    postLabel: 'Save as Open', postAction: 'open',
  },
  vendor_credits: {
    key: 'vendor_credits', api: '/vendor-credits', path: '/vendor-credits', title: 'Vendor Credits', one: 'Vendor Credit', perm: 'vendor_credits',
    entity: 'vendor_credit', contactType: 'vendor', priceKind: 'purchase', numberLabel: 'Credit Note#', dateLabel: 'Vendor Credit Date',
    printTitle: 'Vendor Credit', warehouseLabel: 'Return from warehouse', hasCredit: true,
    header: [{ key: 'return_stock', label: 'Goods returned to vendor', type: 'checkbox', hint: 'Removes the items from stock when the vendor credit is opened.' }],
    statuses: [['', 'All'], ['draft', 'Draft'], ['open', 'Open'], ['closed', 'Closed'], ['void', 'Void']],
    postLabel: 'Save as Open', postAction: 'open',
  },
};

export const BILL_ACCOUNTS = ['Inventory Asset', 'Cost of Goods Sold', 'Freight & Shipping', 'Office Supplies', 'Software & Subscriptions', 'Professional Fees', 'Rent', 'Repairs & Maintenance', 'Utilities', 'Other Expenses'];

/** Mirror of the backend totals calculation. */
export function computeTotals(lines, taxes, h) {
  const rate = (id) => Number(taxes.find((t) => String(t.id) === String(id))?.rate || 0);
  const docDisc = Number(h.discount_percent) || 0;
  let sub = 0;
  const taxBreak = new Map();
  for (const l of lines) {
    const amount = Math.round(Number(l.quantity || 0) * Number(l.rate || 0) * (1 - Number(l.discount_percent || 0) / 100) * 100) / 100;
    l._amount = amount;
    sub += amount;
    if (l.tax_id) {
      const t = taxes.find((x) => String(x.id) === String(l.tax_id));
      const key = t ? `${t.name} (${t.rate}%)` : 'Tax';
      taxBreak.set(key, (taxBreak.get(key) || 0) + amount * (1 - docDisc / 100) * (rate(l.tax_id) / 100));
    }
  }
  const discount = Math.round(sub * docDisc) / 100;
  const tax = [...taxBreak.values()].reduce((s, v) => s + v, 0);
  const total = sub - discount + tax + Number(h.shipping_charge || 0) + Number(h.adjustment || 0);
  return { sub_total: sub, discount_total: discount, tax_total: Math.round(tax * 100) / 100, taxBreak: [...taxBreak.entries()], total: Math.round(total * 100) / 100 };
}
