import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../middleware/auth.js';
import { badRequest } from '../lib/errors.js';
import { round2 } from '../lib/validate.js';
import { periodRange } from './dashboard.js';
import { EXTRA_REPORTS } from './reportsExtra.js';
import { realizedGain } from '../lib/fx.js';
import { reportExtrasRouter } from './reportSchedules.js';

const r = Router();

const col = (key, label, type = 'text') => ({ key, label, type });
const sumCols = (rows, keys) => Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((s, x) => s + (Number(x[k]) || 0), 0))]));

// Each report: async (ctx) => ({ columns, rows, totals?, chart? })
// ctx = { org, from, to, warehouse, params(list) }
const REPORTS: any = {
  // ---------------------------------------------------------------- inventory
  inventory_summary: {
    group: 'Inventory', title: 'Inventory Summary', dated: false, warehouse: true,
    description: 'Stock on hand, committed and available quantities for every tracked item.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, i.unit, i.reorder_level,
                COALESCE(SUM(sl.on_hand),0) AS on_hand, COALESCE(SUM(sl.committed),0) AS committed,
                COALESCE(SUM(sl.on_hand - sl.committed),0) AS available,
                (SELECT COALESCE(SUM(l.quantity - l.qty_received),0) FROM purchase_order_lines l JOIN purchase_orders d ON d.id = l.doc_id
                  WHERE l.item_id = i.id AND d.status = 'issued' ${warehouse ? 'AND d.warehouse_id = $2' : ''}) AS to_receive
           FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          WHERE i.org_id = $1 AND i.track_inventory GROUP BY i.id ORDER BY i.name`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('unit', 'Unit'), col('on_hand', 'Stock on hand', 'number'), col('committed', 'Committed', 'number'),
          col('available', 'Available for sale', 'number'), col('to_receive', 'Quantity to receive', 'number'), col('reorder_level', 'Reorder point', 'number')],
        rows, totals: sumCols(rows, ['on_hand', 'committed', 'available', 'to_receive']),
      };
    },
  },
  inventory_valuation: {
    group: 'Inventory', title: 'Inventory Valuation Summary (FIFO)', dated: false, warehouse: true,
    description: 'Value of stock on hand using remaining FIFO cost layers.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, i.unit, SUM(sl.qty_remaining) AS quantity, SUM(sl.qty_remaining * sl.unit_cost) AS value,
                CASE WHEN SUM(sl.qty_remaining) > 0 THEN SUM(sl.qty_remaining * sl.unit_cost) / SUM(sl.qty_remaining) ELSE 0 END AS avg_cost,
                i.selling_price, SUM(sl.qty_remaining) * i.selling_price AS retail_value
           FROM stock_lots sl JOIN items i ON i.id = sl.item_id
          WHERE sl.org_id = $1 AND sl.qty_remaining > 0 ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          GROUP BY i.id ORDER BY value DESC`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('quantity', 'Stock on hand', 'number'), col('avg_cost', 'Average cost', 'money'),
          col('value', 'Inventory value', 'money'), col('selling_price', 'Selling price', 'money'), col('retail_value', 'Retail value', 'money')],
        rows, totals: sumCols(rows, ['quantity', 'value', 'retail_value']),
        chart: { type: 'bar', label: 'name', value: 'value', limit: 10 },
      };
    },
  },
  stock_summary: {
    group: 'Inventory', title: 'Stock Summary', dated: true, warehouse: true,
    description: 'Opening stock, quantity in, quantity out and closing stock for the period.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, i.unit,
                COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_date < $2),0) AS opening,
                COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_date BETWEEN $2 AND $3 AND m.quantity > 0),0) AS qty_in,
                COALESCE(-SUM(m.quantity) FILTER (WHERE m.movement_date BETWEEN $2 AND $3 AND m.quantity < 0),0) AS qty_out,
                COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_date <= $3),0) AS closing
           FROM items i LEFT JOIN stock_movements m ON m.item_id = i.id ${warehouse ? 'AND m.warehouse_id = $4' : ''}
          WHERE i.org_id = $1 AND i.track_inventory GROUP BY i.id ORDER BY i.name`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('unit', 'Unit'), col('opening', 'Opening stock', 'number'),
          col('qty_in', 'Quantity in', 'number'), col('qty_out', 'Quantity out', 'number'), col('closing', 'Closing stock', 'number')],
        rows, totals: sumCols(rows, ['opening', 'qty_in', 'qty_out', 'closing']),
      };
    },
  },
  low_stock: {
    group: 'Inventory', title: 'Low Stock Items', dated: false, warehouse: false,
    description: 'Items whose available stock is at or below the reorder point.',
    run: async ({ org }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, i.unit, i.reorder_level, COALESCE(s.on_hand,0) AS on_hand, COALESCE(s.available,0) AS available,
                i.reorder_level - COALESCE(s.available,0) AS shortfall, v.display_name AS preferred_vendor
           FROM items i LEFT JOIN (SELECT item_id, SUM(on_hand) AS on_hand, SUM(on_hand - committed) AS available FROM stock_levels GROUP BY item_id) s ON s.item_id = i.id
           LEFT JOIN contacts v ON v.id = i.preferred_vendor_id
          WHERE i.org_id = $1 AND i.track_inventory AND i.status = 'active' AND i.reorder_level > 0 AND COALESCE(s.available,0) <= i.reorder_level
          ORDER BY shortfall DESC`,
        [org],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('on_hand', 'Stock on hand', 'number'), col('available', 'Available', 'number'),
          col('reorder_level', 'Reorder point', 'number'), col('shortfall', 'Shortfall', 'number'), col('preferred_vendor', 'Preferred vendor')],
        rows,
      };
    },
  },
  out_of_stock: {
    group: 'Inventory', title: 'Out of Stock Items', dated: false, warehouse: true,
    description: 'Active tracked items with no stock on hand.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, i.unit, COALESCE(SUM(sl.on_hand),0) AS on_hand, COALESCE(SUM(sl.committed),0) AS committed,
                (SELECT MAX(m.movement_date) FROM stock_movements m WHERE m.item_id = i.id AND m.quantity < 0) AS last_sold
           FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          WHERE i.org_id = $1 AND i.track_inventory AND i.status = 'active'
          GROUP BY i.id HAVING COALESCE(SUM(sl.on_hand),0) <= 0 ORDER BY i.name`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('on_hand', 'Stock on hand', 'number'), col('committed', 'Committed (backordered)', 'number'), col('last_sold', 'Last stock out', 'date')],
        rows,
      };
    },
  },
  stock_movement: {
    group: 'Inventory', title: 'Stock Movement', dated: true, warehouse: true,
    description: 'Every stock in/out transaction in the period.',
    run: async ({ org, from, to, warehouse }) => {
      const { rows } = await query(
        `SELECT m.movement_date, i.name, i.sku, w.name AS warehouse, m.source_type, m.source_number, m.quantity, m.value, m.note
           FROM stock_movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id
          WHERE m.org_id = $1 AND m.movement_date BETWEEN $2 AND $3 ${warehouse ? 'AND m.warehouse_id = $4' : ''}
          ORDER BY m.movement_date DESC, m.id DESC LIMIT 5000`,
        warehouse ? [org, from, to, warehouse] : [org, from, to],
      );
      for (const x of rows) x.source_type = x.source_type.replaceAll('_', ' ');
      return {
        columns: [col('movement_date', 'Date', 'date'), col('name', 'Item'), col('sku', 'SKU'), col('warehouse', 'Warehouse'), col('source_type', 'Transaction'),
          col('source_number', 'Reference'), col('quantity', 'Quantity', 'number'), col('value', 'Value', 'money'), col('note', 'Note')],
        rows,
      };
    },
  },
  warehouse_stock: {
    group: 'Inventory', title: 'Warehouse Stock', dated: false, warehouse: true,
    description: 'Stock on hand of each item in each warehouse.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT w.name AS warehouse, i.name, i.sku, sl.on_hand, sl.committed, sl.on_hand - sl.committed AS available,
                (SELECT COALESCE(SUM(qty_remaining * unit_cost),0) FROM stock_lots WHERE item_id = i.id AND warehouse_id = w.id) AS value
           FROM stock_levels sl JOIN items i ON i.id = sl.item_id JOIN warehouses w ON w.id = sl.warehouse_id
          WHERE sl.org_id = $1 AND (sl.on_hand <> 0 OR sl.committed <> 0) ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          ORDER BY w.name, i.name`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('warehouse', 'Warehouse'), col('name', 'Item'), col('sku', 'SKU'), col('on_hand', 'Stock on hand', 'number'),
          col('committed', 'Committed', 'number'), col('available', 'Available', 'number'), col('value', 'Value', 'money')],
        rows, totals: sumCols(rows, ['on_hand', 'committed', 'available', 'value']),
      };
    },
  },
  inventory_aging: {
    group: 'Inventory', title: 'Inventory Aging', dated: false, warehouse: true,
    description: 'Remaining stock grouped by how long it has been held (FIFO lots).',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku,
                COALESCE(SUM(sl.qty_remaining) FILTER (WHERE CURRENT_DATE - sl.lot_date <= 30),0) AS d0_30,
                COALESCE(SUM(sl.qty_remaining) FILTER (WHERE CURRENT_DATE - sl.lot_date BETWEEN 31 AND 60),0) AS d31_60,
                COALESCE(SUM(sl.qty_remaining) FILTER (WHERE CURRENT_DATE - sl.lot_date BETWEEN 61 AND 90),0) AS d61_90,
                COALESCE(SUM(sl.qty_remaining) FILTER (WHERE CURRENT_DATE - sl.lot_date > 90),0) AS d90_plus,
                SUM(sl.qty_remaining) AS total, SUM(sl.qty_remaining * sl.unit_cost) AS value
           FROM stock_lots sl JOIN items i ON i.id = sl.item_id
          WHERE sl.org_id = $1 AND sl.qty_remaining > 0 ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          GROUP BY i.id ORDER BY i.name`,
        warehouse ? [org, warehouse] : [org],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('d0_30', '0–30 days', 'number'), col('d31_60', '31–60 days', 'number'),
          col('d61_90', '61–90 days', 'number'), col('d90_plus', '> 90 days', 'number'), col('total', 'Total', 'number'), col('value', 'Value', 'money')],
        rows, totals: sumCols(rows, ['d0_30', 'd31_60', 'd61_90', 'd90_plus', 'total', 'value']),
      };
    },
  },
  fifo_lots: {
    group: 'Inventory', title: 'FIFO Cost Lot Tracking', dated: false, warehouse: true,
    description: 'Open FIFO cost layers that make up current stock value.',
    run: async ({ org, warehouse }) => {
      const { rows } = await query(
        `SELECT sl.lot_date, i.name, i.sku, w.name AS warehouse, sl.source_type, sl.qty_in, sl.qty_remaining, sl.unit_cost,
                sl.qty_remaining * sl.unit_cost AS value
           FROM stock_lots sl JOIN items i ON i.id = sl.item_id JOIN warehouses w ON w.id = sl.warehouse_id
          WHERE sl.org_id = $1 AND sl.qty_remaining > 0 ${warehouse ? 'AND sl.warehouse_id = $2' : ''}
          ORDER BY i.name, sl.lot_date, sl.id`,
        warehouse ? [org, warehouse] : [org],
      );
      for (const x of rows) x.source_type = x.source_type.replaceAll('_', ' ');
      return {
        columns: [col('lot_date', 'Date', 'date'), col('name', 'Item'), col('sku', 'SKU'), col('warehouse', 'Warehouse'), col('source_type', 'Source'),
          col('qty_in', 'Quantity in', 'number'), col('qty_remaining', 'Remaining', 'number'), col('unit_cost', 'Unit cost', 'money'), col('value', 'Value', 'money')],
        rows, totals: sumCols(rows, ['qty_remaining', 'value']),
      };
    },
  },
  abc_analysis: {
    group: 'Inventory', title: 'ABC Analysis', dated: true, warehouse: false,
    description: 'Items classed A (top 70% of sales value), B (next 20%) and C (last 10%).',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT i.name, i.sku, SUM(l.quantity) AS quantity, SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate) AS sales
           FROM invoice_lines l JOIN invoices d ON d.id = l.doc_id JOIN items i ON i.id = l.item_id
          WHERE d.org_id = $1 AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY i.id ORDER BY sales DESC`,
        [org, from, to],
      );
      const total = rows.reduce((s, x) => s + Number(x.sales), 0) || 1;
      let cum = 0;
      for (const x of rows) {
        const before = cum;
        cum += Number(x.sales);
        x.share = round2((Number(x.sales) / total) * 100);
        x.cumulative = round2((cum / total) * 100);
        x.class = before / total < 0.7 ? 'A' : before / total < 0.9 ? 'B' : 'C';
      }
      return {
        columns: [col('class', 'Class'), col('name', 'Item'), col('sku', 'SKU'), col('quantity', 'Quantity sold', 'number'),
          col('sales', 'Sales value', 'money'), col('share', '% of sales', 'percent'), col('cumulative', 'Cumulative %', 'percent')],
        rows, totals: sumCols(rows, ['quantity', 'sales']),
      };
    },
  },

  // ---------------------------------------------------------------- sales
  sales_by_item: {
    tagged: true,
    group: 'Sales', title: 'Sales by Item', dated: true, warehouse: false,
    description: 'Quantity sold, sales value, cost of goods and margin per item (from issued invoices).',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `WITH s AS (
           SELECT l.item_id, SUM(l.quantity) AS quantity, SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate) AS sales
             FROM invoice_lines l JOIN invoices d ON d.id = l.doc_id
            WHERE d.org_id = $1 ${tagSql('d')} AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3 AND l.item_id IS NOT NULL
            GROUP BY l.item_id),
         c AS (
           SELECT item_id, -SUM(value) AS cogs FROM stock_movements
            WHERE org_id = $1 AND source_type IN ('shipment','invoice','sales_return') AND movement_date BETWEEN $2 AND $3
            GROUP BY item_id)
         SELECT i.name, i.sku, s.quantity, s.sales, CASE WHEN s.quantity > 0 THEN s.sales / s.quantity ELSE 0 END AS avg_price,
                COALESCE(c.cogs, 0) AS cogs, s.sales - COALESCE(c.cogs, 0) AS margin,
                CASE WHEN s.sales > 0 THEN (s.sales - COALESCE(c.cogs, 0)) / s.sales * 100 ELSE 0 END AS margin_pct
           FROM s JOIN items i ON i.id = s.item_id LEFT JOIN c ON c.item_id = s.item_id ORDER BY s.sales DESC`,
        [org, from, to],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('quantity', 'Quantity sold', 'number'), col('sales', 'Sales', 'money'),
          col('avg_price', 'Average price', 'money'), col('cogs', 'Cost of goods sold', 'money'), col('margin', 'Margin', 'money'), col('margin_pct', 'Margin %', 'percent')],
        rows, totals: sumCols(rows, ['quantity', 'sales', 'cogs', 'margin']),
        chart: { type: 'bar', label: 'name', value: 'sales', limit: 10 },
      };
    },
  },
  sales_by_customer: {
    tagged: true,
    group: 'Sales', title: 'Sales by Customer', dated: true, warehouse: false,
    description: 'Invoice count and sales per customer.',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT c.display_name AS customer, COUNT(*)::int AS invoices, SUM((d.sub_total - d.discount_total) * d.exchange_rate) AS sales,
                SUM(d.tax_total * d.exchange_rate) AS tax, SUM(d.total * d.exchange_rate) AS total, SUM(d.balance * d.exchange_rate) AS balance
           FROM invoices d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY c.id ORDER BY total DESC`,
        [org, from, to],
      );
      return {
        columns: [col('customer', 'Customer'), col('invoices', 'Invoices', 'number'), col('sales', 'Sales (excl. tax)', 'money'),
          col('tax', 'Tax', 'money'), col('total', 'Total', 'money'), col('balance', 'Outstanding', 'money')],
        rows, totals: sumCols(rows, ['invoices', 'sales', 'tax', 'total', 'balance']),
        chart: { type: 'bar', label: 'customer', value: 'total', limit: 10 },
      };
    },
  },
  sales_by_salesperson: {
    tagged: true,
    group: 'Sales', title: 'Sales by Salesperson', dated: true, warehouse: false,
    description: 'Invoiced sales grouped by salesperson.',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT COALESCE(d.salesperson, '(none)') AS salesperson, COUNT(*)::int AS invoices, SUM((d.sub_total - d.discount_total) * d.exchange_rate) AS sales, SUM(d.total * d.exchange_rate) AS total
           FROM invoices d WHERE d.org_id = $1 ${tagSql('d')} AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY 1 ORDER BY total DESC`,
        [org, from, to],
      );
      return { columns: [col('salesperson', 'Salesperson'), col('invoices', 'Invoices', 'number'), col('sales', 'Sales (excl. tax)', 'money'), col('total', 'Total', 'money')], rows, totals: sumCols(rows, ['invoices', 'sales', 'total']) };
    },
  },
  order_fulfillment: {
    tagged: true,
    group: 'Sales', title: 'Order Fulfillment', dated: true, warehouse: false,
    description: 'Ordered, packed, shipped and invoiced quantities per sales order.',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT d.number, d.doc_date, c.display_name AS customer, d.status, d.expected_shipment_date,
                SUM(l.quantity) AS ordered, SUM(l.qty_packed) AS packed, SUM(l.qty_shipped) AS shipped, SUM(l.qty_invoiced) AS invoiced, d.total
           FROM sales_orders d JOIN contacts c ON c.id = d.contact_id JOIN sales_order_lines l ON l.doc_id = d.id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.doc_date BETWEEN $2 AND $3 AND d.status <> 'void'
          GROUP BY d.id, c.display_name ORDER BY d.doc_date DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Sales order#'), col('doc_date', 'Date', 'date'), col('customer', 'Customer'), col('status', 'Status', 'status'),
          col('expected_shipment_date', 'Expected shipment', 'date'), col('ordered', 'Ordered', 'number'), col('packed', 'Packed', 'number'),
          col('shipped', 'Shipped', 'number'), col('invoiced', 'Invoiced', 'number'), col('total', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['ordered', 'packed', 'shipped', 'invoiced', 'total']),
      };
    },
  },
  customer_balances: {
    tagged: true,
    group: 'Receivables', title: 'Customer Balances (Receivables Aging)', dated: false, warehouse: false,
    description: 'Outstanding invoice balances per customer, grouped by days overdue.',
    run: async ({ tagSql, org }) => {
      const { rows } = await query(
        `SELECT c.display_name AS customer,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE d.due_date >= CURRENT_DATE),0) AS current,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 1 AND 15),0) AS d1_15,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 16 AND 30),0) AS d16_30,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 31 AND 45),0) AS d31_45,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date > 45),0) AS d45_plus,
                SUM(d.balance * d.exchange_rate) AS total
           FROM invoices d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.status IN ('sent','partially_paid') GROUP BY c.id ORDER BY total DESC`,
        [org],
      );
      return {
        columns: [col('customer', 'Customer'), col('current', 'Current', 'money'), col('d1_15', '1–15 days', 'money'), col('d16_30', '16–30 days', 'money'),
          col('d31_45', '31–45 days', 'money'), col('d45_plus', '> 45 days', 'money'), col('total', 'Total', 'money')],
        rows, totals: sumCols(rows, ['current', 'd1_15', 'd16_30', 'd31_45', 'd45_plus', 'total']),
      };
    },
  },
  payments_received: {
    group: 'Receivables', title: 'Payments Received', dated: true, warehouse: false,
    description: 'Customer payments recorded in the period.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.payment_date, d.number, c.display_name AS customer, d.mode, d.reference, d.amount * d.exchange_rate AS amount, d.unused_amount * d.exchange_rate AS unused_amount
           FROM payments_received d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.payment_date BETWEEN $2 AND $3 ORDER BY d.payment_date DESC`,
        [org, from, to],
      );
      for (const x of rows) x.mode = x.mode.replaceAll('_', ' ');
      return {
        columns: [col('payment_date', 'Date', 'date'), col('number', 'Payment#'), col('customer', 'Customer'), col('mode', 'Mode'), col('reference', 'Reference'),
          col('amount', 'Amount', 'money'), col('unused_amount', 'Unused', 'money')],
        rows, totals: sumCols(rows, ['amount', 'unused_amount']),
      };
    },
  },

  // ---------------------------------------------------------------- purchases
  purchases_by_vendor: {
    tagged: true,
    group: 'Purchases', title: 'Purchases by Vendor', dated: true, warehouse: false,
    description: 'Bills and purchase value per vendor.',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT c.display_name AS vendor, COUNT(*)::int AS bills, SUM((d.sub_total - d.discount_total) * d.exchange_rate) AS amount, SUM(d.tax_total * d.exchange_rate) AS tax,
                SUM(d.total * d.exchange_rate) AS total, SUM(d.balance * d.exchange_rate) AS balance
           FROM bills d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY c.id ORDER BY total DESC`,
        [org, from, to],
      );
      return {
        columns: [col('vendor', 'Vendor'), col('bills', 'Bills', 'number'), col('amount', 'Amount (excl. tax)', 'money'), col('tax', 'Tax', 'money'),
          col('total', 'Total', 'money'), col('balance', 'Outstanding', 'money')],
        rows, totals: sumCols(rows, ['bills', 'amount', 'tax', 'total', 'balance']),
        chart: { type: 'bar', label: 'vendor', value: 'total', limit: 10 },
      };
    },
  },
  purchases_by_item: {
    tagged: true,
    group: 'Purchases', title: 'Purchases by Item', dated: true, warehouse: false,
    description: 'Quantity and value purchased per item (from bills).',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT COALESCE(i.name, l.description) AS name, i.sku, SUM(l.quantity) AS quantity, SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate) AS amount,
                CASE WHEN SUM(l.quantity) > 0 THEN SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate) / SUM(l.quantity) ELSE 0 END AS avg_cost
           FROM bill_lines l JOIN bills d ON d.id = l.doc_id LEFT JOIN items i ON i.id = l.item_id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
          GROUP BY 1, 2 ORDER BY amount DESC`,
        [org, from, to],
      );
      return {
        columns: [col('name', 'Item'), col('sku', 'SKU'), col('quantity', 'Quantity purchased', 'number'), col('amount', 'Amount', 'money'), col('avg_cost', 'Average cost', 'money')],
        rows, totals: sumCols(rows, ['quantity', 'amount']),
      };
    },
  },
  purchase_order_details: {
    tagged: true,
    group: 'Purchases', title: 'Purchase Order Details', dated: true, warehouse: false,
    description: 'Ordered, received and billed quantities per purchase order.',
    run: async ({ tagSql, org, from, to }) => {
      const { rows } = await query(
        `SELECT d.number, d.doc_date, c.display_name AS vendor, d.status, d.expected_delivery_date,
                SUM(l.quantity) AS ordered, SUM(l.qty_received) AS received, SUM(l.qty_billed) AS billed, d.total
           FROM purchase_orders d JOIN contacts c ON c.id = d.contact_id JOIN purchase_order_lines l ON l.doc_id = d.id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.doc_date BETWEEN $2 AND $3
          GROUP BY d.id, c.display_name ORDER BY d.doc_date DESC`,
        [org, from, to],
      );
      return {
        columns: [col('number', 'Purchase order#'), col('doc_date', 'Date', 'date'), col('vendor', 'Vendor'), col('status', 'Status', 'status'),
          col('expected_delivery_date', 'Expected delivery', 'date'), col('ordered', 'Ordered', 'number'), col('received', 'Received', 'number'),
          col('billed', 'Billed', 'number'), col('total', 'Amount', 'money')],
        rows, totals: sumCols(rows, ['ordered', 'received', 'billed', 'total']),
      };
    },
  },
  vendor_balances: {
    tagged: true,
    group: 'Payables', title: 'Vendor Balances (Payables Aging)', dated: false, warehouse: false,
    description: 'Outstanding bill balances per vendor, grouped by days overdue.',
    run: async ({ tagSql, org }) => {
      const { rows } = await query(
        `SELECT c.display_name AS vendor,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE d.due_date >= CURRENT_DATE),0) AS current,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 1 AND 15),0) AS d1_15,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 16 AND 30),0) AS d16_30,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date BETWEEN 31 AND 45),0) AS d31_45,
                COALESCE(SUM(d.balance * d.exchange_rate) FILTER (WHERE CURRENT_DATE - d.due_date > 45),0) AS d45_plus,
                SUM(d.balance * d.exchange_rate) AS total
           FROM bills d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 ${tagSql('d')} AND d.status IN ('open','partially_paid') GROUP BY c.id ORDER BY total DESC`,
        [org],
      );
      return {
        columns: [col('vendor', 'Vendor'), col('current', 'Current', 'money'), col('d1_15', '1–15 days', 'money'), col('d16_30', '16–30 days', 'money'),
          col('d31_45', '31–45 days', 'money'), col('d45_plus', '> 45 days', 'money'), col('total', 'Total', 'money')],
        rows, totals: sumCols(rows, ['current', 'd1_15', 'd16_30', 'd31_45', 'd45_plus', 'total']),
      };
    },
  },
  payments_made: {
    group: 'Payables', title: 'Payments Made', dated: true, warehouse: false,
    description: 'Vendor payments recorded in the period.',
    run: async ({ org, from, to }) => {
      const { rows } = await query(
        `SELECT d.payment_date, d.number, c.display_name AS vendor, d.mode, d.reference, d.amount * d.exchange_rate AS amount, d.unused_amount * d.exchange_rate AS unused_amount
           FROM payments_made d JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = $1 AND d.payment_date BETWEEN $2 AND $3 ORDER BY d.payment_date DESC`,
        [org, from, to],
      );
      for (const x of rows) x.mode = x.mode.replaceAll('_', ' ');
      return {
        columns: [col('payment_date', 'Date', 'date'), col('number', 'Payment#'), col('vendor', 'Vendor'), col('mode', 'Mode'), col('reference', 'Reference'),
          col('amount', 'Amount', 'money'), col('unused_amount', 'Unused', 'money')],
        rows, totals: sumCols(rows, ['amount', 'unused_amount']),
      };
    },
  },

  // ---------------------------------------------------------------- accounting
  tax_summary: {
    group: 'Taxes & Accounting', title: 'Tax Summary', dated: true, warehouse: false,
    description: 'Tax collected on sales and paid on purchases, by tax rate.',
    run: async ({ org, from, to }) => {
      const sql = (lines, docs, statuses, sign) => `
        SELECT COALESCE(t.name, l.tax_rate || '%') AS tax, l.tax_rate,
               ${sign} * SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate) AS taxable,
               ${sign} * SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate * l.tax_rate / 100) AS tax_amount
          FROM ${lines} l JOIN ${docs} d ON d.id = l.doc_id LEFT JOIN taxes t ON t.id = l.tax_id
         WHERE d.org_id = $1 AND d.status IN (${statuses}) AND d.doc_date BETWEEN $2 AND $3 AND l.tax_rate > 0
         GROUP BY 1, 2`;
      const [sales, credits, purchases, vcredits] = await Promise.all([
        query(sql('invoice_lines', 'invoices', "'sent','partially_paid','paid'", 1), [org, from, to]),
        query(sql('credit_note_lines', 'credit_notes', "'open','closed'", -1), [org, from, to]),
        query(sql('bill_lines', 'bills', "'open','partially_paid','paid'", 1), [org, from, to]),
        query(sql('vendor_credit_lines', 'vendor_credits', "'open','closed'", -1), [org, from, to]),
      ]);
      const merge = (a, b, type) => {
        const m = new Map();
        for (const x of [...a.rows, ...b.rows]) {
          const k = x.tax;
          const cur = m.get(k) || { type, tax: k, tax_rate: x.tax_rate, taxable: 0, tax_amount: 0 };
          cur.taxable = round2(cur.taxable + Number(x.taxable));
          cur.tax_amount = round2(cur.tax_amount + Number(x.tax_amount));
          m.set(k, cur);
        }
        return [...m.values()];
      };
      const out = merge(sales, credits, 'Output tax (sales)');
      const inp = merge(purchases, vcredits, 'Input tax (purchases)');
      const rows = [...out, ...inp];
      const outTotal = out.reduce((s, x) => s + x.tax_amount, 0);
      const inTotal = inp.reduce((s, x) => s + x.tax_amount, 0);
      rows.push({ type: 'Net tax payable', tax: '', tax_rate: null, taxable: null, tax_amount: round2(outTotal - inTotal) });
      return {
        columns: [col('type', 'Type'), col('tax', 'Tax'), col('tax_rate', 'Rate', 'percent'), col('taxable', 'Taxable amount', 'money'), col('tax_amount', 'Tax amount', 'money')],
        rows,
      };
    },
  },
  profit_loss: {
    group: 'Taxes & Accounting', title: 'Profit and Loss Summary', dated: true, warehouse: false,
    description: 'Sales, cost of goods sold, gross profit and other expenses for the period.',
    run: async ({ org, from, to }) => {
      const one = async (sql) => Number((await query(sql, [org, from, to])).rows[0].v) || 0;
      const sales = await one(`SELECT COALESCE(SUM((sub_total - discount_total + shipping_charge + adjustment) * exchange_rate),0) AS v FROM invoices
                                WHERE org_id = $1 AND status NOT IN ('draft','void') AND doc_date BETWEEN $2 AND $3`);
      const returns = await one(`SELECT COALESCE(SUM((sub_total - discount_total + shipping_charge + adjustment) * exchange_rate),0) AS v FROM credit_notes
                                  WHERE org_id = $1 AND status IN ('open','closed') AND doc_date BETWEEN $2 AND $3`);
      const cogs = await one(`SELECT COALESCE(-SUM(value),0) AS v FROM stock_movements
                               WHERE org_id = $1 AND source_type IN ('shipment','invoice','sales_return') AND movement_date BETWEEN $2 AND $3`);
      const adjustments = await one(`SELECT COALESCE(-SUM(value),0) AS v FROM stock_movements
                                      WHERE org_id = $1 AND source_type = 'inventory_adjustment' AND movement_date BETWEEN $2 AND $3`);
      const expenses = await one(`SELECT COALESCE(SUM(l.amount * (1 - d.discount_percent / 100) * d.exchange_rate),0) AS v
                                    FROM bill_lines l JOIN bills d ON d.id = l.doc_id LEFT JOIN items i ON i.id = l.item_id
                                   WHERE d.org_id = $1 AND d.status NOT IN ('draft','void') AND d.doc_date BETWEEN $2 AND $3
                                     AND (i.id IS NULL OR NOT i.track_inventory)`);
      const shipping = await one(`SELECT COALESCE(SUM(shipping_cost),0) AS v FROM shipments WHERE org_id = $1 AND ship_date BETWEEN $2 AND $3`);
      const netSales = sales - returns;
      const gross = netSales - cogs;
      const fx = await realizedGain(org, from, to);
      const net = gross - adjustments - expenses - shipping + fx;
      const rows = [
        { account: 'Sales', amount: round2(sales) },
        { account: 'Less: Sales returns / credit notes', amount: round2(-returns) },
        { account: 'Net sales', amount: round2(netSales), bold: true },
        { account: 'Cost of goods sold (FIFO)', amount: round2(-cogs) },
        { account: 'Gross profit', amount: round2(gross), bold: true },
        { account: 'Inventory adjustments (loss) / gain', amount: round2(-adjustments) },
        { account: 'Non-inventory purchases & services (bills)', amount: round2(-expenses) },
        { account: 'Shipping costs', amount: round2(-shipping) },
        ...(fx ? [{ account: 'Exchange gain / (loss)', amount: round2(fx) }] : []),
        { account: 'Net profit', amount: round2(net), bold: true },
      ];
      return { columns: [col('account', 'Account'), col('amount', 'Amount', 'money')], rows };
    },
  },
};

// ---------------------------------------------------------------- GST (India)
// Line-level taxable value and tax split. Intra-state (place of supply = organization state) → CGST+SGST, otherwise IGST.
const gstLines = (lines, docs, statuses, dateCol = 'd.doc_date') => `
  SELECT d.id AS doc_id, d.number, ${dateCol} AS doc_date, d.total * d.exchange_rate AS total, c.display_name, c.gstin, c.gst_treatment,
         COALESCE(d.place_of_supply, c.place_of_supply, $4) AS pos, l.tax_rate, l.quantity, i.hsn_sac, COALESCE(i.unit, 'nos') AS unit,
         l.amount * (1 - d.discount_percent / 100) * d.exchange_rate AS taxable,
         (lower(COALESCE(d.place_of_supply, c.place_of_supply, $4)) <> lower($4)) AS inter
    FROM ${lines} l JOIN ${docs} d ON d.id = l.doc_id JOIN contacts c ON c.id = d.contact_id LEFT JOIN items i ON i.id = l.item_id
   WHERE d.org_id = $1 AND d.status IN (${statuses}) AND ${dateCol} BETWEEN $2 AND $3`;
const SALE = "'sent','partially_paid','paid'";
const CREDIT = "'open','closed'";
const PURCHASE = "'open','partially_paid','paid'";
const REGISTERED = "('registered','registered_composition','sez','deemed_export')";
const taxCols = `ROUND(SUM(taxable)::numeric, 2) AS taxable,
  ROUND(SUM(CASE WHEN inter THEN taxable * tax_rate / 100 ELSE 0 END)::numeric, 2) AS igst,
  ROUND(SUM(CASE WHEN inter THEN 0 ELSE taxable * tax_rate / 200 END)::numeric, 2) AS cgst,
  ROUND(SUM(CASE WHEN inter THEN 0 ELSE taxable * tax_rate / 200 END)::numeric, 2) AS sgst`;
const gstColumns = [col('taxable', 'Taxable value', 'money'), col('igst', 'IGST', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money')];
const B2CL_LIMIT = 100000;

Object.assign(REPORTS, {
  gstr1_b2b: {
    group: 'GST', title: 'GSTR-1: B2B invoices', dated: true, warehouse: false,
    description: 'Invoices to GST-registered customers (Table 4), one row per invoice and tax rate.',
    run: async ({ org, from, to, state }) => {
      const { rows } = await query(
        `SELECT gstin, display_name AS receiver, number, doc_date, total AS invoice_value, pos, tax_rate, ${taxCols}
           FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x
          WHERE gstin IS NOT NULL AND gst_treatment IN ${REGISTERED} GROUP BY gstin, display_name, number, doc_date, total, pos, tax_rate ORDER BY doc_date, number`,
        [org, from, to, state],
      );
      return { columns: [col('gstin', 'GSTIN of recipient'), col('receiver', 'Receiver name'), col('number', 'Invoice number'), col('doc_date', 'Invoice date', 'date'),
        col('invoice_value', 'Invoice value', 'money'), col('pos', 'Place of supply'), col('tax_rate', 'Rate', 'percent'), ...gstColumns],
      rows, totals: sumCols(rows, ['taxable', 'igst', 'cgst', 'sgst']) };
    },
  },
  gstr1_b2cl: {
    group: 'GST', title: 'GSTR-1: B2C large', dated: true, warehouse: false,
    description: `Inter-state invoices above ₹${B2CL_LIMIT.toLocaleString('en-IN')} to unregistered customers (Table 5).`,
    run: async ({ org, from, to, state }) => {
      const { rows } = await query(
        `SELECT number, doc_date, total AS invoice_value, pos, tax_rate, ${taxCols}
           FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x
          WHERE (gstin IS NULL OR gst_treatment NOT IN ${REGISTERED}) AND inter AND total > ${B2CL_LIMIT}
          GROUP BY number, doc_date, total, pos, tax_rate ORDER BY doc_date, number`,
        [org, from, to, state],
      );
      return { columns: [col('number', 'Invoice number'), col('doc_date', 'Invoice date', 'date'), col('invoice_value', 'Invoice value', 'money'),
        col('pos', 'Place of supply'), col('tax_rate', 'Rate', 'percent'), ...gstColumns], rows, totals: sumCols(rows, ['taxable', 'igst']) };
    },
  },
  gstr1_b2cs: {
    group: 'GST', title: 'GSTR-1: B2C small', dated: true, warehouse: false,
    description: 'All other sales to unregistered customers, summarised by place of supply and rate (Table 7).',
    run: async ({ org, from, to, state }) => {
      const { rows } = await query(
        `SELECT CASE WHEN inter THEN 'Inter-state' ELSE 'Intra-state' END AS type, pos, tax_rate, ${taxCols}
           FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x
          WHERE (gstin IS NULL OR gst_treatment NOT IN ${REGISTERED}) AND NOT (inter AND total > ${B2CL_LIMIT}) AND tax_rate > 0
          GROUP BY inter, pos, tax_rate ORDER BY pos, tax_rate`,
        [org, from, to, state],
      );
      return { columns: [col('type', 'Type'), col('pos', 'Place of supply'), col('tax_rate', 'Rate', 'percent'), ...gstColumns], rows,
        totals: sumCols(rows, ['taxable', 'igst', 'cgst', 'sgst']) };
    },
  },
  gstr1_cdnr: {
    group: 'GST', title: 'GSTR-1: Credit notes (registered)', dated: true, warehouse: false,
    description: 'Credit notes issued to GST-registered customers (Table 9B).',
    run: async ({ org, from, to, state }) => {
      const { rows } = await query(
        `SELECT gstin, display_name AS receiver, number, doc_date, total AS note_value, pos, tax_rate, ${taxCols}
           FROM (${gstLines('credit_note_lines', 'credit_notes', CREDIT)}) x
          WHERE gstin IS NOT NULL AND gst_treatment IN ${REGISTERED} GROUP BY gstin, display_name, number, doc_date, total, pos, tax_rate ORDER BY doc_date`,
        [org, from, to, state],
      );
      return { columns: [col('gstin', 'GSTIN of recipient'), col('receiver', 'Receiver name'), col('number', 'Note number'), col('doc_date', 'Note date', 'date'),
        col('note_value', 'Note value', 'money'), col('pos', 'Place of supply'), col('tax_rate', 'Rate', 'percent'), ...gstColumns],
      rows, totals: sumCols(rows, ['taxable', 'igst', 'cgst', 'sgst']) };
    },
  },
  gstr1_hsn: {
    group: 'GST', title: 'GSTR-1: HSN summary', dated: true, warehouse: false,
    description: 'Outward supplies summarised by HSN/SAC code (Table 12). Add HSN/SAC codes on items for this report.',
    run: async ({ org, from, to, state }) => {
      const { rows } = await query(
        `SELECT COALESCE(hsn_sac, '(missing)') AS hsn, unit, tax_rate, ROUND(SUM(quantity)::numeric, 3) AS quantity,
                ROUND(SUM(taxable * (1 + tax_rate / 100))::numeric, 2) AS total_value, ${taxCols}
           FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x GROUP BY hsn_sac, unit, tax_rate ORDER BY hsn_sac NULLS FIRST, tax_rate`,
        [org, from, to, state],
      );
      return { columns: [col('hsn', 'HSN/SAC'), col('unit', 'UQC'), col('tax_rate', 'Rate', 'percent'), col('quantity', 'Total quantity', 'number'),
        col('total_value', 'Total value', 'money'), ...gstColumns], rows, totals: sumCols(rows, ['quantity', 'total_value', 'taxable', 'igst', 'cgst', 'sgst']) };
    },
  },
  gstr3b: {
    group: 'GST', title: 'GSTR-3B summary', dated: true, warehouse: false,
    description: 'Monthly summary: tax on outward supplies (3.1), inter-state supplies to unregistered persons (3.2), input tax credit (4) and net tax.',
    run: async ({ org, from, to, state }) => {
      const sum = async (sql) => (await query(sql, [org, from, to, state])).rows[0];
      const out = await sum(`SELECT ${taxCols} FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x WHERE tax_rate > 0`);
      const cn = await sum(`SELECT ${taxCols} FROM (${gstLines('credit_note_lines', 'credit_notes', CREDIT)}) x WHERE tax_rate > 0`);
      const nil = await sum(`SELECT ${taxCols} FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x WHERE tax_rate = 0`);
      const itc = await sum(`SELECT ${taxCols} FROM (${gstLines('bill_lines', 'bills', PURCHASE)}) x WHERE tax_rate > 0`);
      const vc = await sum(`SELECT ${taxCols} FROM (${gstLines('vendor_credit_lines', 'vendor_credits', CREDIT)}) x WHERE tax_rate > 0`);
      const { rows: unreg } = await query(
        `SELECT pos, ${taxCols} FROM (${gstLines('invoice_lines', 'invoices', SALE)}) x
          WHERE inter AND (gstin IS NULL OR gst_treatment NOT IN ${REGISTERED}) AND tax_rate > 0 GROUP BY pos ORDER BY pos`,
        [org, from, to, state],
      );
      const n = (v) => Number(v) || 0;
      const diff = (a, b) => Object.fromEntries(['taxable', 'igst', 'cgst', 'sgst'].map((k) => [k, round2(n(a[k]) - n(b[k]))]));
      const outward = diff(out, cn);
      const credit = diff(itc, vc);
      const rows = [
        { section: '3.1(a) Outward taxable supplies (net of credit notes)', ...outward, bold: true },
        { section: '3.1(c) Nil-rated / exempted supplies', taxable: round2(n(nil.taxable)), igst: 0, cgst: 0, sgst: 0 },
        ...unreg.map((u) => ({ section: `3.2 Inter-state to unregistered – ${u.pos}`, taxable: n(u.taxable), igst: n(u.igst), cgst: null, sgst: null })),
        { section: '4(A)(5) Input tax credit – all other ITC (bills, net of vendor credits)', ...credit, bold: true },
        { section: 'Net tax payable (output − ITC)', taxable: null, igst: round2(outward.igst - credit.igst), cgst: round2(outward.cgst - credit.cgst), sgst: round2(outward.sgst - credit.sgst), bold: true },
      ];
      return { columns: [col('section', 'Section'), ...gstColumns], rows };
    },
  },
});

Object.assign(REPORTS, EXTRA_REPORTS);

r.get('/', can('reports', 'view'), (_req, res) => {
  res.json(Object.entries(REPORTS).map(([key, x]: any) => ({ key, group: x.group, title: x.title, description: x.description, dated: x.dated, warehouse: x.warehouse, tagged: !!x.tagged })));
});

/** Run a report for an organization (used by the page and by scheduled emails). */
export async function runReport(orgId, key, opts: any = {}) {
  const rep = REPORTS[String(key)];
  if (!rep) throw badRequest('Unknown report');
  const { rows: [o] } = await query('SELECT fiscal_year_start, state FROM organizations WHERE id = $1', [orgId]);
  let { from, to } = periodRange(opts.period || 'this_year', o.fiscal_year_start);
  if (opts.from) from = String(opts.from).slice(0, 10);
  if (opts.to) to = String(opts.to).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Invalid date range');
  const warehouse = opts.warehouse_id ? Number(opts.warehouse_id) : null;
  // Reporting tag filters (?tag_<id>=<value>): only valid tags and values are used.
  const filters = [];
  if (rep.tagged) {
    const { rows: tags } = await query('SELECT id, name, options FROM reporting_tags WHERE org_id = $1', [orgId]);
    for (const [k, v] of Object.entries(opts)) {
      const m = /^tag_(\d+)$/.exec(k);
      const t = m && tags.find((x) => String(x.id) === m[1]);
      if (t && v && (t.options || []).includes(String(v))) filters.push({ id: t.id, name: t.name, value: String(v) });
    }
  }
  const tagSql = (alias) => filters.map((f) => ` AND ${alias}.tags->>'${Number(f.id)}' = '${f.value.replace(/'/g, "''")}'`).join('');
  const result = await rep.run({ org: orgId, from, to, warehouse, state: o.state || '', tagSql });
  return { key, title: rep.title, description: rep.description, dated: rep.dated, warehouse: rep.warehouse, tagged: !!rep.tagged, tag_filters: filters, from, to, ...result };
}

export const reportExists = (key) => !!REPORTS[String(key)];

// Favourites and schedules come before /:key so their paths are not taken as report keys.
r.use(reportExtrasRouter);

r.get('/:key', can('reports', 'view'), async (req, res) => {
  res.json(await runReport(req.orgId, req.params.key, req.query));
});

export default r;
