// Additional detail / history reports (Zoho Inventory parity). Same shape as reports.ts:
// { group, title, description, dated, warehouse, run(ctx) => { columns, rows, totals?, chart? } }
// A column may carry `link: '/invoices/{id}'` — the page turns the cell into a link using row fields.
import { query } from '../db.js';
import { round2 } from '../lib/validate.js';

const col = (key, label, type = 'text', link = undefined) => ({ key, label, type, ...(link ? { link } : {}) });
const sumCols = (rows, keys) => Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((s, x) => s + (Number(x[k]) || 0), 0))]));
const SALE = "('sent','partially_paid','paid')";
const BILL = "('open','partially_paid','paid')";

export const EXTRA_REPORTS: any = {
  // ================================================================ sales
  sales_summary: {
    group: 'Sales', title: 'Sales Summary', dated: true, warehouse: false,
    description: 'Invoiced sales per day (or per month for long periods): number of invoices, sales, tax and total.',
    run: async ({ org, from, to }) => {
      const days = (Date.parse(to) - Date.parse(from)) / 86400000;
      const unit = days > 62 ? 'month' : 'day';
      const { rows } = await query(
        `SELECT to_char(date_trunc('${unit}', d.doc_date), '${unit === 'month' ? 'Mon YYYY' : 'DD Mon YYYY'}') AS period,
                COUNT(*)::int AS invoices, SUM(d.sub_total - d.discount_total) AS sales, SUM(d.tax_total) AS tax, SUM(d.total) AS total
           FROM invoices d WHERE d.org_id = $1 AND d.status IN ${SALE} AND d.doc_date BETWEEN $2 AND $3
          GROUP BY date_trunc('${unit}', d.doc_date) ORDER BY date_trunc('${unit}', d.doc_date)`,
        [org, from, to],
      );
      return {
        columns: [col('period', unit === 'month' ? 'Month' : 'Date'), col('invoices', 'Invoices', 'number'), col('sales', 'Sales (excl. tax)', 'money'), col('tax', 'Tax', 'money'), col('total', 'Total', 'money')],
        rows, totals: sumCols(rows, ['invoices', 'sales', 'tax', 'total']), chart: { type: 'bar', label: 'period', value: 'total', limit: 31 },
      };
    },
  },
  sales_by_category: {
    group: 'Sales', title: 'Sales by Category', dated: true, warehouse: false,
    description: 'Quantity, sales, cost and margin per item category.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `WITH s AS (
           SELECT l.item_id, SUM(l.quantity) AS quantity, SUM(l.amount * (1 - d.discount_percent / 100)) AS sales
             FROM invoice_lines l JOIN invoices d ON d.id = l.doc_id
            WHERE d.org_id = $1 AND d.status IN ${SALE} AND d.doc_date BETWEEN $2 AND $3 AND l.item_id IS NOT NULL GROUP BY l.item_id),
         c AS (SELECT item_id, -SUM(value) AS cogs FROM stock_movements
                WHERE org_id = $1 AND source_type IN ('shipment','invoice','sales_return') AND movement_date BETWEEN $2 AND $3 GROUP BY item_id)
         SELECT COALESCE(NULLIF(i.category, ''), '(no category)') AS category, COUNT(*)::int AS items, SUM(s.quantity) AS quantity, SUM(s.sales) AS sales,
                SUM(COALESCE(c.cogs, 0)) AS cogs, SUM(s.sales - COALESCE(c.cogs, 0)) AS margin,
                CASE WHEN SUM(s.sales) > 0 THEN SUM(s.sales - COALESCE(c.cogs, 0)) / SUM(s.sales) * 100 ELSE 0 END AS margin_pct
           FROM s JOIN items i ON i.id = s.item_id LEFT JOIN c ON c.item_id = s.item_id
          GROUP BY 1 ORDER BY sales DESC`,
        [org, from, to],
      );
      return {
        columns: [col('category', 'Category'), col('items', 'Items sold', 'number'), col('quantity', 'Quantity', 'number'), col('sales', 'Sales', 'money'),
          col('cogs', 'Cost of goods sold', 'money'), col('margin', 'Margin', 'money'), col('margin_pct', 'Margin %', 'percent')],
        rows, totals: sumCols(rows, ['quantity', 'sales', 'cogs', 'margin']), chart: { type: 'bar', label: 'category', value: 'sales', limit: 10 },
      };
    },
  },
  sales_by_channel: {
    group: 'Sales', title: 'Sales by Channel', dated: true, warehouse: false,
    description: 'Invoiced sales per sales channel (direct, Shopify, …), based on the sales order each invoice came from.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT COALESCE(so.channel, 'direct') AS channel, COUNT(*)::int AS invoices, SUM(d.sub_total - d.discount_total) AS sales, SUM(d.total) AS total
           FROM invoices d LEFT JOIN sales_orders so ON so.id = d.sales_order_id
          WHERE d.org_id = $1 AND d.status IN ${SALE} AND d.doc_date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY total DESC`,
        [org, from, to],
      );
      return {
        columns: [col('channel', 'Channel', 'label'), col('invoices', 'Invoices', 'number'), col('sales', 'Sales (excl. tax)', 'money'), col('total', 'Total', 'money')],
        rows, totals: sumCols(rows, ['invoices', 'sales', 'total']), chart: { type: 'bar', label: 'channel', value: 'total', limit: 10 },
      };
    },
  },
  invoice_details: {
    group: 'Sales', title: 'Invoice Details', dated: true, warehouse: false,
    description: 'Every invoice in the period with its status, due date, amount and balance.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, d.due_date, c.display_name AS customer, d.contact_id,
                CASE WHEN d.status IN ('sent','partially_paid') AND d.due_date < CURRENT_DATE THEN 'overdue' ELSE d.status END AS status,
                d.total, d.balance, d.salesperson
           FROM invoices d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Invoice#', 'text', '/invoices/{id}'), col('doc_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('status', 'Status', 'status'), col('due_date', 'Due date', 'date'), col('salesperson', 'Salesperson'), col('total', 'Amount', 'money'), col('balance', 'Balance due', 'money')],
        rows, totals: sumCols(rows, ['total', 'balance']),
      };
    },
  },
  sales_order_details: {
    group: 'Sales', title: 'Sales Order Details', dated: true, warehouse: false,
    description: 'Every sales order in the period with its status and amount.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, d.expected_shipment_date, c.display_name AS customer, d.contact_id, d.status, d.channel, d.total
           FROM sales_orders d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Sales order#', 'text', '/sales-orders/{id}'), col('doc_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('status', 'Status', 'status'), col('expected_shipment_date', 'Expected shipment', 'date'), col('channel', 'Channel', 'label'), col('total', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['total']),
      };
    },
  },
  estimate_details: {
    group: 'Sales', title: 'Estimate Details', dated: true, warehouse: false,
    description: 'Every estimate (quote) in the period, and whether it was accepted, declined or converted.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, d.expiry_date, c.display_name AS customer, d.contact_id,
                CASE WHEN d.status = 'sent' AND d.expiry_date < CURRENT_DATE THEN 'expired' ELSE d.status END AS status, d.total
           FROM estimates d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Estimate#', 'text', '/estimates/{id}'), col('doc_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('status', 'Status', 'status'), col('expiry_date', 'Valid until', 'date'), col('total', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['total']),
      };
    },
  },
  delivery_challan_details: {
    group: 'Sales', title: 'Delivery Challan Details', dated: true, warehouse: false,
    description: 'Every delivery challan in the period with its type, status and value.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, c.display_name AS customer, d.contact_id, d.challan_type, d.status, d.total
           FROM delivery_challans d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Challan#', 'text', '/delivery-challans/{id}'), col('doc_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('challan_type', 'Type', 'label'), col('status', 'Status', 'status'), col('total', 'Value', 'money')],
        rows, totals: sumCols(rows, ['total']),
      };
    },
  },
  credit_note_details: {
    group: 'Sales', title: 'Credit Note Details', dated: true, warehouse: false,
    description: 'Every credit note in the period with the amount still available to use.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, c.display_name AS customer, d.contact_id, d.status, d.total, d.balance
           FROM credit_notes d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Credit note#', 'text', '/credit-notes/{id}'), col('doc_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('status', 'Status', 'status'), col('total', 'Amount', 'money'), col('balance', 'Credits remaining', 'money')],
        rows, totals: sumCols(rows, ['total', 'balance']),
      };
    },
  },
  sales_return_history: {
    group: 'Sales', title: 'Sales Return History', dated: true, warehouse: false,
    description: 'Goods customers returned: item, quantity, reason and whether it went back into stock.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT r.id, r.number, r.return_date, c.display_name AS customer, r.contact_id, so.number AS sales_order, r.sales_order_id, r.status, r.reason,
                i.name AS item, l.quantity, CASE WHEN l.restock THEN 'Yes' ELSE 'No' END AS restocked
           FROM sales_returns r JOIN sales_return_lines l ON l.sales_return_id = r.id JOIN items i ON i.id = l.item_id
           JOIN contacts c ON c.id = r.contact_id JOIN sales_orders so ON so.id = r.sales_order_id
          WHERE r.org_id = $1 AND r.return_date BETWEEN $2 AND $3 ORDER BY r.return_date DESC, r.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Return#', 'text', '/sales-returns/{id}'), col('return_date', 'Date', 'date'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('sales_order', 'Sales order#', 'text', '/sales-orders/{sales_order_id}'), col('item', 'Item'), col('quantity', 'Quantity', 'number'),
          col('restocked', 'Back in stock'), col('reason', 'Reason'), col('status', 'Status', 'status')],
        rows, totals: sumCols(rows, ['quantity']),
      };
    },
  },
  refund_history: {
    group: 'Sales', title: 'Refund History', dated: true, warehouse: false,
    description: 'Money refunded to customers from credit notes.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT f.refund_date, d.id, d.number AS credit_note, c.display_name AS customer, d.contact_id, f.mode, f.reference, f.amount
           FROM credit_refunds f JOIN credit_notes d ON d.id = f.credit_note_id JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND f.refund_date BETWEEN $2 AND $3 ORDER BY f.refund_date DESC`,
        [org, from, to],
      );
      return {
        columns: [col('refund_date', 'Date', 'date'), col('credit_note', 'Credit note#', 'text', '/credit-notes/{id}'), col('customer', 'Customer', 'text', '/customers/{contact_id}'),
          col('mode', 'Mode', 'label'), col('reference', 'Reference'), col('amount', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['amount']),
      };
    },
  },
  packing_history: {
    group: 'Sales', title: 'Packing History', dated: true, warehouse: false,
    description: 'Packages created in the period: items packed, weight and shipping status.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT p.id, p.number, p.package_date, c.display_name AS customer, p.contact_id, so.number AS sales_order, p.sales_order_id, p.status,
                SUM(l.quantity) AS quantity, p.weight_kg
           FROM packages p JOIN package_lines l ON l.package_id = p.id JOIN contacts c ON c.id = p.contact_id JOIN sales_orders so ON so.id = p.sales_order_id
          WHERE p.org_id = $1 AND p.package_date BETWEEN $2 AND $3
          GROUP BY p.id, c.display_name, so.number ORDER BY p.package_date DESC, p.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Package#', 'text', '/packages/{id}'), col('package_date', 'Date', 'date'), col('customer', 'Customer'),
          col('sales_order', 'Sales order#', 'text', '/sales-orders/{sales_order_id}'), col('quantity', 'Quantity packed', 'number'), col('weight_kg', 'Weight (kg)', 'number'), col('status', 'Status', 'status')],
        rows, totals: sumCols(rows, ['quantity', 'weight_kg']),
      };
    },
  },
  shipment_details: {
    group: 'Sales', title: 'Shipment Details', dated: true, warehouse: false,
    description: 'Shipments in the period: carrier, tracking number, delivery status and shipping cost.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT s.id, s.number, s.ship_date, c.display_name AS customer, so.number AS sales_order, s.sales_order_id, s.carrier, s.tracking_number,
                s.status, s.estimated_delivery, s.delivered_date, s.shipping_cost
           FROM shipments s JOIN contacts c ON c.id = s.contact_id JOIN sales_orders so ON so.id = s.sales_order_id
          WHERE s.org_id = $1 AND s.ship_date BETWEEN $2 AND $3 ORDER BY s.ship_date DESC, s.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Shipment#', 'text', '/shipments/{id}'), col('ship_date', 'Shipped', 'date'), col('customer', 'Customer'),
          col('sales_order', 'Sales order#', 'text', '/sales-orders/{sales_order_id}'), col('carrier', 'Carrier'), col('tracking_number', 'Tracking#'),
          col('status', 'Status', 'status'), col('estimated_delivery', 'Expected', 'date'), col('delivered_date', 'Delivered', 'date'), col('shipping_cost', 'Shipping cost', 'money')],
        rows, totals: sumCols(rows, ['shipping_cost']),
      };
    },
  },
  shipments_by_item: {
    group: 'Sales', title: 'Shipped Quantity by Item', dated: true, warehouse: false,
    description: 'How many units of each item were shipped in the period, and in how many shipments.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT i.id, i.name, i.sku, COUNT(DISTINCT s.id)::int AS shipments, SUM(l.quantity) AS quantity
           FROM shipments s JOIN package_lines l ON l.package_id = s.package_id JOIN items i ON i.id = l.item_id
          WHERE s.org_id = $1 AND s.ship_date BETWEEN $2 AND $3 GROUP BY i.id ORDER BY quantity DESC`,
        [org, from, to],
      );
      return {
        columns: [col('name', 'Item', 'text', '/items/{id}'), col('sku', 'SKU'), col('shipments', 'Shipments', 'number'), col('quantity', 'Quantity shipped', 'number')],
        rows, totals: sumCols(rows, ['shipments', 'quantity']), chart: { type: 'bar', label: 'name', value: 'quantity', limit: 10 },
      };
    },
  },

  // ================================================================ inventory
  committed_stock_details: {
    group: 'Inventory', title: 'Committed Stock Details', dated: false, warehouse: true,
    description: 'Stock reserved for confirmed sales orders that has not shipped yet — which order is holding which item.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT so.id, so.number, so.doc_date, so.expected_shipment_date, c.display_name AS customer, i.name AS item, l.item_id, w.name AS warehouse,
                l.quantity AS ordered, l.qty_shipped AS shipped, (l.quantity - l.qty_shipped) AS committed
           FROM sales_order_lines l JOIN sales_orders so ON so.id = l.doc_id JOIN items i ON i.id = l.item_id
           JOIN contacts c ON c.id = so.contact_id JOIN warehouses w ON w.id = so.warehouse_id
          WHERE so.org_id = $1 AND so.status = 'confirmed' AND i.track_inventory AND l.quantity - l.qty_shipped > 0
            ${warehouse ? 'AND so.warehouse_id = $2' : ''}
          ORDER BY so.expected_shipment_date NULLS LAST, so.doc_date`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('number', 'Sales order#', 'text', '/sales-orders/{id}'), col('doc_date', 'Order date', 'date'), col('expected_shipment_date', 'Expected shipment', 'date'),
          col('customer', 'Customer'), col('item', 'Item', 'text', '/items/{item_id}'), col('warehouse', 'Warehouse'),
          col('ordered', 'Ordered', 'number'), col('shipped', 'Shipped', 'number'), col('committed', 'Committed', 'number')],
        rows, totals: sumCols(rows, ['ordered', 'shipped', 'committed']),
      };
    },
  },
  inventory_turnover: {
    group: 'Inventory', title: 'Inventory Turnover', dated: true, warehouse: false,
    description: 'How fast each item sells: cost of goods sold ÷ average stock value. Higher is better; “days” is how long stock lasts on average.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `WITH m AS (
           SELECT item_id,
                  SUM(value) FILTER (WHERE movement_date < $2) AS opening,
                  SUM(value) FILTER (WHERE movement_date <= $3) AS closing,
                  -SUM(value) FILTER (WHERE movement_date BETWEEN $2 AND $3 AND source_type IN ('shipment','invoice','delivery_challan')) AS cogs
             FROM stock_movements WHERE org_id = $1 GROUP BY item_id)
         SELECT i.id, i.name, i.sku, COALESCE(m.opening, 0) AS opening, COALESCE(m.closing, 0) AS closing, COALESCE(m.cogs, 0) AS cogs,
                (COALESCE(m.opening, 0) + COALESCE(m.closing, 0)) / 2 AS average
           FROM m JOIN items i ON i.id = m.item_id
          WHERE COALESCE(m.cogs, 0) <> 0 OR COALESCE(m.closing, 0) <> 0
          ORDER BY cogs DESC`,
        [org, from, to],
      );
      const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000 + 1);
      for (const x of rows) {
        const avg = Number(x.average);
        x.turnover = avg > 0 ? round2(Number(x.cogs) / avg) : null;
        x.days = x.turnover ? Math.round(days / x.turnover) : null;
      }
      return {
        columns: [col('name', 'Item', 'text', '/items/{id}'), col('sku', 'SKU'), col('opening', 'Opening stock value', 'money'), col('closing', 'Closing stock value', 'money'),
          col('average', 'Average stock value', 'money'), col('cogs', 'Cost of goods sold', 'money'), col('turnover', 'Turnover (times)', 'number'), col('days', 'Days of stock', 'number')],
        rows, totals: sumCols(rows, ['opening', 'closing', 'average', 'cogs']), chart: { type: 'bar', label: 'name', value: 'turnover', limit: 10 },
      };
    },
  },
  adjustment_summary: {
    group: 'Inventory', title: 'Inventory Adjustment Summary', dated: true, warehouse: true,
    description: 'Adjustments grouped by reason (damaged, stolen, stocktake…): how much quantity and value they changed.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT a.reason, COUNT(DISTINCT a.id)::int AS adjustments, SUM(l.qty_adjusted) AS quantity,
                SUM(CASE WHEN a.mode = 'value' THEN l.value_adjusted ELSE 0 END) AS value_change,
                (SELECT COALESCE(SUM(m.value), 0) FROM stock_movements m JOIN inventory_adjustments a2 ON a2.id = m.source_id
                  WHERE m.source_type = 'inventory_adjustment' AND a2.org_id = $1 AND a2.reason = a.reason AND a2.status = 'adjusted'
                    AND a2.adj_date BETWEEN $2 AND $3 ${warehouse ? 'AND a2.warehouse_id = $4' : ''}) AS stock_value_change
           FROM inventory_adjustments a JOIN inventory_adjustment_lines l ON l.adjustment_id = a.id
          WHERE a.org_id = $1 AND a.status = 'adjusted' AND a.adj_date BETWEEN $2 AND $3 ${warehouse ? 'AND a.warehouse_id = $4' : ''}
          GROUP BY a.reason ORDER BY adjustments DESC`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      return {
        columns: [col('reason', 'Reason'), col('adjustments', 'Adjustments', 'number'), col('quantity', 'Quantity change', 'number'), col('stock_value_change', 'Stock value change', 'money')],
        rows, totals: sumCols(rows, ['adjustments', 'quantity', 'stock_value_change']),
      };
    },
  },
  adjustment_details: {
    group: 'Inventory', title: 'Inventory Adjustment Details', dated: true, warehouse: true,
    description: 'Every adjusted item line: date, reason, quantity or value change.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT a.id, a.number, a.adj_date, a.reason, a.mode, w.name AS warehouse, i.name AS item, l.item_id, l.qty_adjusted, l.value_adjusted, a.reference
           FROM inventory_adjustments a JOIN inventory_adjustment_lines l ON l.adjustment_id = a.id JOIN items i ON i.id = l.item_id JOIN warehouses w ON w.id = a.warehouse_id
          WHERE a.org_id = $1 AND a.status = 'adjusted' AND a.adj_date BETWEEN $2 AND $3 ${warehouse ? 'AND a.warehouse_id = $4' : ''}
          ORDER BY a.adj_date DESC, a.number DESC, l.position`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      return {
        columns: [col('number', 'Adjustment#', 'text', '/inventory/adjustments/{id}'), col('adj_date', 'Date', 'date'), col('reason', 'Reason'), col('mode', 'Type', 'label'),
          col('warehouse', 'Warehouse'), col('item', 'Item', 'text', '/items/{item_id}'), col('qty_adjusted', 'Quantity change', 'number'), col('value_adjusted', 'Value change', 'money'), col('reference', 'Reference')],
        rows, totals: sumCols(rows, ['qty_adjusted', 'value_adjusted']),
      };
    },
  },
  transfer_history: {
    group: 'Inventory', title: 'Transfer Order History', dated: true, warehouse: false,
    description: 'Stock moved between warehouses: what, how much, from where to where.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT t.id, t.number, t.transfer_date, fw.name AS from_wh, tw.name AS to_wh, t.status, i.name AS item, l.item_id, l.quantity,
                ROUND(l.quantity * COALESCE(l.unit_cost, 0), 2) AS value
           FROM transfer_orders t JOIN transfer_order_lines l ON l.transfer_order_id = t.id JOIN items i ON i.id = l.item_id
           JOIN warehouses fw ON fw.id = t.from_warehouse_id JOIN warehouses tw ON tw.id = t.to_warehouse_id
          WHERE t.org_id = $1 AND t.transfer_date BETWEEN $2 AND $3 ORDER BY t.transfer_date DESC, t.number DESC, l.position`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Transfer#', 'text', '/inventory/transfers/{id}'), col('transfer_date', 'Date', 'date'), col('from_wh', 'From'), col('to_wh', 'To'),
          col('status', 'Status', 'status'), col('item', 'Item', 'text', '/items/{item_id}'), col('quantity', 'Quantity', 'number'), col('value', 'Value', 'money')],
        rows, totals: sumCols(rows, ['quantity', 'value']),
      };
    },
  },
  landed_cost_summary: {
    group: 'Inventory', title: 'Landed Cost Summary', dated: true, warehouse: false,
    description: 'Freight, duty and other charges added to stock cost, and how much of each went to goods already sold.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT c.id, c.number, c.cost_date, c.description, b.number AS bill, c.bill_id, c.method, c.amount, c.applied_to_stock, c.expensed
           FROM landed_costs c LEFT JOIN bills b ON b.id = c.bill_id
          WHERE c.org_id = $1 AND c.status = 'applied' AND c.cost_date BETWEEN $2 AND $3 ORDER BY c.cost_date DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Landed cost#', 'text', '/landed-costs/{id}'), col('cost_date', 'Date', 'date'), col('description', 'Description'), col('bill', 'Charges bill', 'text', '/bills/{bill_id}'),
          col('method', 'Split by', 'label'), col('amount', 'Amount', 'money'), col('applied_to_stock', 'Added to stock', 'money'), col('expensed', 'Already sold', 'money')],
        rows, totals: sumCols(rows, ['amount', 'applied_to_stock', 'expensed']),
      };
    },
  },

  // ================================================================ purchases
  receive_history: {
    group: 'Purchases', title: 'Receive History', dated: true, warehouse: true,
    description: 'Goods received from vendors: every item line on every purchase receive.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT p.id, p.number, p.receive_date, po.number AS purchase_order, p.purchase_order_id, c.display_name AS vendor, p.contact_id,
                i.name AS item, l.item_id, w.name AS warehouse, l.quantity
           FROM purchase_receives p JOIN purchase_receive_lines l ON l.receive_id = p.id JOIN items i ON i.id = l.item_id
           JOIN purchase_orders po ON po.id = p.purchase_order_id JOIN contacts c ON c.id = p.contact_id JOIN warehouses w ON w.id = p.warehouse_id
          WHERE p.org_id = $1 AND p.receive_date BETWEEN $2 AND $3 ${warehouse ? 'AND p.warehouse_id = $4' : ''}
          ORDER BY p.receive_date DESC, p.number DESC`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      return {
        columns: [col('number', 'Receive#', 'text', '/purchase-receives/{id}'), col('receive_date', 'Date', 'date'), col('purchase_order', 'Purchase order#', 'text', '/purchase-orders/{purchase_order_id}'),
          col('vendor', 'Vendor', 'text', '/vendors/{contact_id}'), col('item', 'Item', 'text', '/items/{item_id}'), col('warehouse', 'Warehouse'), col('quantity', 'Quantity', 'number')],
        rows, totals: sumCols(rows, ['quantity']),
      };
    },
  },
  receives_by_item: {
    group: 'Purchases', title: 'Received Quantity by Item', dated: true, warehouse: true,
    description: 'Total units of each item received in the period.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT i.id, i.name, i.sku, COUNT(DISTINCT p.id)::int AS receives, SUM(l.quantity) AS quantity
           FROM purchase_receives p JOIN purchase_receive_lines l ON l.receive_id = p.id JOIN items i ON i.id = l.item_id
          WHERE p.org_id = $1 AND p.receive_date BETWEEN $2 AND $3 ${warehouse ? 'AND p.warehouse_id = $4' : ''}
          GROUP BY i.id ORDER BY quantity DESC`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      return {
        columns: [col('name', 'Item', 'text', '/items/{id}'), col('sku', 'SKU'), col('receives', 'Receives', 'number'), col('quantity', 'Quantity received', 'number')],
        rows, totals: sumCols(rows, ['receives', 'quantity']), chart: { type: 'bar', label: 'name', value: 'quantity', limit: 10 },
      };
    },
  },
  active_purchase_orders: {
    group: 'Purchases', title: 'Open Purchase Orders', dated: false, warehouse: false,
    description: 'Issued purchase orders still waiting for goods or a bill, with what is outstanding.',
    run: async ({ org }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, d.expected_delivery_date, c.display_name AS vendor, d.contact_id,
                SUM(l.quantity) AS ordered, SUM(l.qty_received) AS received, SUM(l.qty_billed) AS billed,
                SUM(l.quantity - l.qty_received) AS to_receive, d.total,
                CASE WHEN d.expected_delivery_date < CURRENT_DATE AND SUM(l.quantity - l.qty_received) > 0 THEN 'overdue' ELSE d.status END AS status
           FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.status = 'issued'
          GROUP BY d.id, c.display_name ORDER BY d.expected_delivery_date NULLS LAST, d.doc_date`,
        [org],
      );
      return {
        columns: [col('number', 'Purchase order#', 'text', '/purchase-orders/{id}'), col('doc_date', 'Date', 'date'), col('vendor', 'Vendor', 'text', '/vendors/{contact_id}'),
          col('expected_delivery_date', 'Expected delivery', 'date'), col('status', 'Status', 'status'), col('ordered', 'Ordered', 'number'), col('received', 'Received', 'number'),
          col('to_receive', 'Still to receive', 'number'), col('billed', 'Billed', 'number'), col('total', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['ordered', 'received', 'to_receive', 'billed', 'total']),
      };
    },
  },
  purchase_orders_by_vendor: {
    group: 'Purchases', title: 'Purchase Orders by Vendor', dated: true, warehouse: false,
    description: 'Number and value of purchase orders per vendor, and how much has arrived.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT c.id, c.display_name AS vendor, COUNT(DISTINCT d.id)::int AS orders, SUM(l.quantity) AS ordered, SUM(l.qty_received) AS received,
                (SELECT SUM(total) FROM purchase_orders x WHERE x.contact_id = c.id AND x.org_id = $1 AND x.status NOT IN ('draft','cancelled') AND x.doc_date BETWEEN $2 AND $3) AS amount
           FROM purchase_orders d JOIN purchase_order_lines l ON l.doc_id = d.id JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.status NOT IN ('draft','cancelled') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY c.id ORDER BY amount DESC`,
        [org, from, to],
      );
      return {
        columns: [col('vendor', 'Vendor', 'text', '/vendors/{id}'), col('orders', 'Purchase orders', 'number'), col('ordered', 'Quantity ordered', 'number'), col('received', 'Quantity received', 'number'), col('amount', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['orders', 'ordered', 'received', 'amount']), chart: { type: 'bar', label: 'vendor', value: 'amount', limit: 10 },
      };
    },
  },
  purchases_by_category: {
    group: 'Purchases', title: 'Purchases by Category', dated: true, warehouse: false,
    description: 'Value of goods billed per item category.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT COALESCE(NULLIF(i.category, ''), '(no category)') AS category, COUNT(DISTINCT l.item_id)::int AS items, SUM(l.quantity) AS quantity,
                SUM(l.amount * (1 - d.discount_percent / 100)) AS amount
           FROM bill_lines l JOIN bills d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id
          WHERE d.org_id = $1 AND d.status IN ${BILL} AND d.doc_date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY amount DESC`,
        [org, from, to],
      );
      return {
        columns: [col('category', 'Category'), col('items', 'Items', 'number'), col('quantity', 'Quantity', 'number'), col('amount', 'Amount (excl. tax)', 'money')],
        rows, totals: sumCols(rows, ['quantity', 'amount']), chart: { type: 'bar', label: 'category', value: 'amount', limit: 10 },
      };
    },
  },
  bill_details: {
    group: 'Purchases', title: 'Bill Details', dated: true, warehouse: false,
    description: 'Every bill in the period with its status, due date, amount and balance.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, d.due_date, c.display_name AS vendor, d.contact_id,
                CASE WHEN d.status IN ('open','partially_paid') AND d.due_date < CURRENT_DATE THEN 'overdue' ELSE d.status END AS status, d.total, d.balance
           FROM bills d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Bill#', 'text', '/bills/{id}'), col('doc_date', 'Date', 'date'), col('vendor', 'Vendor', 'text', '/vendors/{contact_id}'), col('status', 'Status', 'status'),
          col('due_date', 'Due date', 'date'), col('total', 'Amount', 'money'), col('balance', 'Balance due', 'money')],
        rows, totals: sumCols(rows, ['total', 'balance']),
      };
    },
  },
  vendor_credit_details: {
    group: 'Purchases', title: 'Vendor Credit Details', dated: true, warehouse: false,
    description: 'Every vendor credit in the period with the amount still available.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.id, d.number, d.doc_date, c.display_name AS vendor, d.contact_id, d.status, d.total, d.balance
           FROM vendor_credits d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.doc_date BETWEEN $2 AND $3 ORDER BY d.doc_date DESC, d.number DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Vendor credit#', 'text', '/vendor-credits/{id}'), col('doc_date', 'Date', 'date'), col('vendor', 'Vendor', 'text', '/vendors/{contact_id}'),
          col('status', 'Status', 'status'), col('total', 'Amount', 'money'), col('balance', 'Credits remaining', 'money')],
        rows, totals: sumCols(rows, ['total', 'balance']),
      };
    },
  },

  // ================================================================ activity
  system_mails: {
    group: 'Activity', title: 'Emails Sent', dated: true, warehouse: false,
    description: 'Every email the app sent (documents, reminders, workflow emails) and whether it was delivered to the mail server.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT e.created_at, e.entity_type, e.to_addr, e.subject, e.status, e.error, u.name AS sent_by
           FROM email_log e LEFT JOIN users u ON u.id = e.sent_by
          WHERE e.org_id = $1 AND e.created_at::date BETWEEN $2 AND $3 ORDER BY e.created_at DESC LIMIT 2000`,
        [org, from, to],
      );
      for (const x of rows) x.sent_by = x.sent_by || 'Automatic';
      return {
        columns: [col('created_at', 'When', 'datetime'), col('entity_type', 'Document', 'label'), col('to_addr', 'To'), col('subject', 'Subject'), col('status', 'Status', 'status'), col('error', 'Error'), col('sent_by', 'Sent by')],
        rows,
      };
    },
  },
  workflow_runs: {
    group: 'Activity', title: 'Workflow Rule Runs', dated: true, warehouse: false,
    description: 'How often each workflow rule ran in the period, and how many runs had a failed action.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT rule_name, module, COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE status = 'success')::int AS succeeded,
                COUNT(*) FILTER (WHERE status <> 'success')::int AS with_errors, MAX(created_at) AS last_run
           FROM workflow_logs WHERE org_id = $1 AND created_at::date BETWEEN $2 AND $3 GROUP BY rule_name, module ORDER BY runs DESC`,
        [org, from, to],
      );
      return {
        columns: [col('rule_name', 'Rule'), col('module', 'Applies to', 'label'), col('runs', 'Runs', 'number'), col('succeeded', 'Succeeded', 'number'), col('with_errors', 'With errors', 'number'), col('last_run', 'Last run', 'datetime')],
        rows, totals: sumCols(rows, ['runs', 'succeeded', 'with_errors']),
      };
    },
  },
  integration_activity: {
    group: 'Activity', title: 'Integration Activity', dated: true, warehouse: false,
    description: 'What the connected apps (Razorpay, Shiprocket, Shopify) did, and any errors.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT created_at, provider, action, status, message FROM integration_logs
          WHERE org_id = $1 AND created_at::date BETWEEN $2 AND $3 ORDER BY created_at DESC LIMIT 2000`,
        [org, from, to],
      );
      return { columns: [col('created_at', 'When', 'datetime'), col('provider', 'App', 'label'), col('action', 'Action', 'label'), col('status', 'Result', 'status'), col('message', 'Details')], rows };
    },
  },
  api_key_usage: {
    group: 'Activity', title: 'API Keys', dated: false, warehouse: false,
    description: 'API keys of this organization, who they act as, and when each was last used.',
    run: async ({ org }) => {
      const { rows } = await query(
        `SELECT k.name, k.prefix, u.name AS user_name, k.created_at, k.last_used_at
           FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.org_id = $1 ORDER BY k.last_used_at DESC NULLS LAST`,
        [org],
      );
      return { columns: [col('name', 'Key name'), col('prefix', 'Starts with'), col('user_name', 'Acts as user'), col('created_at', 'Created', 'datetime'), col('last_used_at', 'Last used', 'datetime')], rows };
    },
  },
};
