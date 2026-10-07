import { Router } from 'express';
import { query } from '../db.js';
import { hasPermission } from '../lib/permissions.js';

const r = Router();

/** Start/end dates for a named period, using the organization's fiscal year start month. */
export function periodRange(period, fyStart = 4) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const end = iso(now);
  switch (period) {
    case 'today': return { from: end, to: end };
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return { from: iso(d), to: iso(d) }; }
    case 'last_week': { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); const e = new Date(d); e.setDate(e.getDate() + 6); return { from: iso(d), to: iso(e) }; }
    case 'this_week': { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: iso(d), to: end }; }
    case 'this_month': return { from: iso(new Date(y, m, 1)), to: end };
    case 'last_month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: end }; }
    case 'last_30_days': { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: iso(d), to: end }; }
    case 'last_12_months': { const d = new Date(y, m - 11, 1); return { from: iso(d), to: end }; }
    case 'this_year':
    default: {
      const startMonth = fyStart - 1;
      const startYear = m >= startMonth ? y : y - 1;
      return { from: iso(new Date(startYear, startMonth, 1)), to: end };
    }
  }
}

r.get('/', async (req, res) => {
  const org = req.orgId;
  const { rows: [o] } = await query('SELECT fiscal_year_start FROM organizations WHERE id = $1', [org]);
  const { from, to } = periodRange(req.query.period || 'this_year', o.fiscal_year_start);
  const q = (sql, params = [org]) => query(sql, params).then((x) => x.rows);

  const [
    [pending], [inv], [products], topSelling, topStocked, salesByMonth, [purchases], [money],
    recentActivity, recentSOs, recentPOs, [onboarding], topVendors, [salesSummary],
  ] = await Promise.all([
    q(`SELECT
        (SELECT COUNT(DISTINCT d.id) FROM sales_orders d JOIN sales_order_lines l ON l.doc_id = d.id JOIN items i ON i.id = l.item_id
          WHERE d.org_id = $1 AND d.status = 'confirmed' AND i.item_type = 'goods' AND l.qty_packed < l.quantity)::int AS to_be_packed,
        (SELECT COUNT(*) FROM packages WHERE org_id = $1 AND status = 'not_shipped')::int AS to_be_shipped,
        (SELECT COUNT(*) FROM shipments WHERE org_id = $1 AND status IN ('shipped','in_transit'))::int AS to_be_delivered,
        (SELECT COUNT(DISTINCT d.id) FROM sales_orders d JOIN sales_order_lines l ON l.doc_id = d.id
          WHERE d.org_id = $1 AND d.status = 'confirmed' AND l.qty_invoiced < l.quantity)::int AS to_be_invoiced,
        (SELECT COUNT(DISTINCT d.id) FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id JOIN items i ON i.id = l.item_id
          WHERE d.org_id = $1 AND d.status = 'issued' AND i.item_type = 'goods' AND l.qty_received = 0
            AND NOT EXISTS (SELECT 1 FROM purchase_receives pr WHERE pr.purchase_order_id = d.id))::int AS to_be_received,
        (SELECT COUNT(DISTINCT d.id) FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id
          WHERE d.org_id = $1 AND d.status = 'issued' AND l.qty_received < l.quantity
            AND EXISTS (SELECT 1 FROM purchase_receives pr WHERE pr.purchase_order_id = d.id))::int AS receive_in_progress,
        (SELECT COUNT(DISTINCT d.id) FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id
          WHERE d.org_id = $1 AND d.status = 'issued' AND l.qty_billed < l.quantity)::int AS to_be_billed`),
    q(`SELECT COALESCE(SUM(on_hand),0) AS quantity_in_hand,
              (SELECT COALESCE(SUM(l.quantity - l.qty_received),0) FROM purchase_order_lines l JOIN purchase_orders d ON d.id = l.doc_id
                JOIN items i ON i.id = l.item_id WHERE d.org_id = $1 AND d.status = 'issued' AND i.item_type = 'goods') AS quantity_to_receive,
              (SELECT COALESCE(SUM(qty_remaining * unit_cost),0) FROM stock_lots WHERE org_id = $1) AS stock_value
         FROM stock_levels WHERE org_id = $1`),
    q(`SELECT COUNT(*)::int AS all_items,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_items,
              (SELECT COUNT(*) FROM item_groups WHERE org_id = $1)::int AS item_groups,
              COUNT(*) FILTER (WHERE i.track_inventory AND i.reorder_level > 0 AND COALESCE(s.avail,0) <= i.reorder_level)::int AS low_stock,
              COUNT(*) FILTER (WHERE i.track_inventory AND COALESCE(s.on_hand,0) <= 0 AND i.status = 'active')::int AS out_of_stock
         FROM items i LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(on_hand - committed) AS avail FROM stock_levels WHERE org_id = $1 GROUP BY item_id) s
           ON s.item_id = i.id
        WHERE i.org_id = $1`),
    q(`SELECT i.id, i.name, i.sku, i.unit, i.image_path, SUM(l.quantity) AS quantity, SUM(l.amount) AS amount
         FROM invoice_lines l JOIN invoices d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id
        WHERE d.org_id = $1 AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
        GROUP BY i.id ORDER BY SUM(l.quantity) DESC LIMIT 5`, [org, from, to]),
    q(`SELECT i.id, i.name, i.sku, i.unit, SUM(sl.qty_remaining) AS quantity, SUM(sl.qty_remaining * sl.unit_cost) AS value
         FROM stock_lots sl JOIN items i ON i.id = sl.item_id WHERE sl.org_id = $1 AND sl.qty_remaining > 0
        GROUP BY i.id ORDER BY SUM(sl.qty_remaining * sl.unit_cost) DESC LIMIT 5`),
    q(`SELECT to_char(date_trunc('month', doc_date), 'YYYY-MM') AS month, SUM(total) AS total, COUNT(*)::int AS orders
         FROM sales_orders WHERE org_id = $1 AND status IN ('confirmed','closed') AND doc_date BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`, [org, from, to]),
    q(`SELECT COALESCE(SUM(l.quantity),0) AS quantity_ordered, COALESCE(SUM(l.amount),0) AS total_cost,
              COUNT(DISTINCT d.id)::int AS orders
         FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id
        WHERE d.org_id = $1 AND d.status IN ('issued','closed') AND d.doc_date BETWEEN $2 AND $3`, [org, from, to]),
    q(`SELECT
        (SELECT COALESCE(SUM(balance),0) FROM invoices WHERE org_id = $1 AND status IN ('sent','partially_paid')) AS receivables,
        (SELECT COALESCE(SUM(balance),0) FROM invoices WHERE org_id = $1 AND status IN ('sent','partially_paid') AND due_date < CURRENT_DATE) AS receivables_overdue,
        (SELECT COALESCE(SUM(balance),0) FROM bills WHERE org_id = $1 AND status IN ('open','partially_paid')) AS payables,
        (SELECT COALESCE(SUM(balance),0) FROM bills WHERE org_id = $1 AND status IN ('open','partially_paid') AND due_date < CURRENT_DATE) AS payables_overdue,
        (SELECT COALESCE(SUM(amount),0) FROM payments_received WHERE org_id = $1 AND payment_date BETWEEN $2 AND $3) AS received_in_period,
        (SELECT COALESCE(SUM(amount),0) FROM payments_made WHERE org_id = $1 AND payment_date BETWEEN $2 AND $3) AS paid_in_period,
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = $1 AND status NOT IN ('draft','void') AND doc_date BETWEEN $2 AND $3) AS invoiced_in_period`,
      [org, from, to]),
    q(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.created_at, u.name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = $1 ORDER BY a.created_at DESC LIMIT 10`),
    q(`SELECT d.id, d.number, d.doc_date, d.status, d.total, c.display_name AS contact_name FROM sales_orders d
         JOIN contacts c ON c.id = d.contact_id WHERE d.org_id = $1 ORDER BY d.created_at DESC LIMIT 5`),
    q(`SELECT d.id, d.number, d.doc_date, d.status, d.total, c.display_name AS contact_name FROM purchase_orders d
         JOIN contacts c ON c.id = d.contact_id WHERE d.org_id = $1 ORDER BY d.created_at DESC LIMIT 5`),
    q(`SELECT
        EXISTS (SELECT 1 FROM items WHERE org_id = $1) AS has_item,
        EXISTS (SELECT 1 FROM stock_movements WHERE org_id = $1) AS has_stock,
        EXISTS (SELECT 1 FROM contacts WHERE org_id = $1 AND contact_type = 'vendor') AS has_vendor,
        EXISTS (SELECT 1 FROM purchase_orders WHERE org_id = $1) AS has_purchase_order,
        EXISTS (SELECT 1 FROM purchase_receives WHERE org_id = $1) AS has_receive,
        EXISTS (SELECT 1 FROM bills WHERE org_id = $1) AS has_bill,
        EXISTS (SELECT 1 FROM contacts WHERE org_id = $1 AND contact_type = 'customer') AS has_customer,
        EXISTS (SELECT 1 FROM sales_orders WHERE org_id = $1) AS has_sales_order,
        EXISTS (SELECT 1 FROM packages WHERE org_id = $1) AS has_package,
        EXISTS (SELECT 1 FROM shipments WHERE org_id = $1) AS has_shipment,
        EXISTS (SELECT 1 FROM invoices WHERE org_id = $1) AS has_invoice,
        EXISTS (SELECT 1 FROM payments_received WHERE org_id = $1) AS has_payment,
        EXISTS (SELECT 1 FROM taxes WHERE org_id = $1) AS has_tax,
        (SELECT logo_path IS NOT NULL OR (address->>'street1') IS NOT NULL FROM organizations WHERE id = $1) AS has_profile`),
    q(`SELECT c.id, c.display_name, SUM(d.total) AS total, COUNT(*)::int AS orders FROM purchase_orders d JOIN contacts c ON c.id = d.contact_id
        WHERE d.org_id = $1 AND d.status IN ('issued','closed') AND d.doc_date BETWEEN $2 AND $3
        GROUP BY c.id ORDER BY SUM(d.total) DESC LIMIT 5`, [org, from, to]),
    q(`SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
        COUNT(*) FILTER (WHERE status = 'void')::int AS void,
        COALESCE(SUM(total) FILTER (WHERE status IN ('confirmed','closed')),0) AS total
         FROM sales_orders WHERE org_id = $1 AND doc_date BETWEEN $2 AND $3`, [org, from, to]),
  ]);

  const [lowStockItems, [aging], openShipments, [today]] = await Promise.all([
    q(`SELECT i.id, i.name, i.sku, i.unit, i.reorder_level, COALESCE(s.on_hand,0) AS on_hand, COALESCE(s.available,0) AS available,
              i.preferred_vendor_id
         FROM items i LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(on_hand - committed) AS available FROM stock_levels WHERE org_id = $1 GROUP BY item_id) s
           ON s.item_id = i.id
        WHERE i.org_id = $1 AND i.track_inventory AND i.status = 'active' AND i.reorder_level > 0 AND COALESCE(s.available,0) <= i.reorder_level
        ORDER BY COALESCE(s.available,0) - i.reorder_level LIMIT 8`),
    q(`SELECT
        COALESCE(SUM(balance) FILTER (WHERE due_date >= CURRENT_DATE),0) AS current,
        COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 15),0) AS d1_15,
        COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 16 AND 30),0) AS d16_30,
        COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 45),0) AS d31_45,
        COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date > 45),0) AS d45_plus
         FROM invoices WHERE org_id = $1 AND status IN ('sent','partially_paid')`),
    q(`SELECT s.id, s.number, s.status, s.carrier, s.tracking_number, s.ship_date, s.estimated_delivery, c.display_name AS contact_name
         FROM shipments s JOIN contacts c ON c.id = s.contact_id
        WHERE s.org_id = $1 AND s.status IN ('shipped','in_transit')
        ORDER BY s.estimated_delivery NULLS LAST, s.ship_date LIMIT 6`),
    q(`SELECT
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = $1 AND status NOT IN ('draft','void') AND doc_date = CURRENT_DATE) AS invoiced,
        (SELECT COUNT(*) FROM sales_orders WHERE org_id = $1 AND doc_date = CURRENT_DATE)::int AS sales_orders,
        (SELECT COALESCE(SUM(amount),0) FROM payments_received WHERE org_id = $1 AND payment_date = CURRENT_DATE) AS received,
        (SELECT COUNT(*) FROM shipments WHERE org_id = $1 AND ship_date = CURRENT_DATE)::int AS shipped`),
  ]);

  res.json({
    generated_at: new Date().toISOString(), low_stock_items: lowStockItems, receivables_aging: aging, open_shipments: openShipments, today,
    period: { from, to }, pending, inventory: inv, products, top_selling: topSelling, top_stocked: topStocked,
    sales_by_month: salesByMonth, sales_summary: salesSummary, purchases, money, top_vendors: topVendors,
    recent_activity: recentActivity, recent_sales_orders: recentSOs, recent_purchase_orders: recentPOs, onboarding,
  });
});

// Global search across modules.
r.get('/search', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const like = `%${term}%`;
  const p = [req.orgId, like];
  const sources = [
    ["'item'", 'id', 'name', 'sku', 'items', ''],
    ["contact_type", 'id', 'display_name', 'email', 'contacts', ''],
    ["'sales_order'", 'id', 'number', 'reference', 'sales_orders', ''],
    ["'invoice'", 'id', 'number', 'reference', 'invoices', ''],
    ["'purchase_order'", 'id', 'number', 'reference', 'purchase_orders', ''],
    ["'bill'", 'id', 'number', 'reference', 'bills', ''],
    ["'package'", 'id', 'number', 'notes', 'packages', ''],
    ["'shipment'", 'id', 'number', 'tracking_number', 'shipments', ''],
    ["'credit_note'", 'id', 'number', 'reference', 'credit_notes', ''],
    ["'vendor_credit'", 'id', 'number', 'reference', 'vendor_credits', ''],
    ["'estimate'", 'id', 'number', 'reference', 'estimates', ''],
    ["'delivery_challan'", 'id', 'number', 'reference', 'delivery_challans', ''],
  ];
  const sql = sources.map(([type, idc, title, sub, table]) =>
    `(SELECT ${type} AS type, ${idc} AS id, ${title} AS title, ${sub} AS subtitle FROM ${table}
       WHERE org_id = $1 AND (${title} ILIKE $2 OR ${sub} ILIKE $2) LIMIT 5)`).join(' UNION ALL ');
  const { rows } = await query(sql, p);
  const { rows: serials } = await query(
    `SELECT 'serial' AS type, s.item_id AS id, 'Serial ' || s.serial AS title, i.name || ' · ' || CASE WHEN s.status = 'in_stock' THEN 'in stock' ELSE 'sold / out' END AS subtitle
       FROM serial_numbers s JOIN items i ON i.id = s.item_id WHERE s.org_id = $1 AND s.serial ILIKE $2 LIMIT 5`,
    p,
  );
  rows.push(...serials);
  const moduleOf = {
    serial: 'items', estimate: 'estimates', delivery_challan: 'delivery_challans',
    item: 'items', customer: 'customers', vendor: 'vendors', sales_order: 'sales_orders', invoice: 'invoices',
    purchase_order: 'purchase_orders', bill: 'bills', package: 'packages', shipment: 'packages',
    credit_note: 'sales_returns', vendor_credit: 'vendor_credits',
  };
  res.json(rows.filter((row) => hasPermission(req.user, moduleOf[row.type], 'view')));
});

export default r;
