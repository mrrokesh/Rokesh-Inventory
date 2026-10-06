// Dashboard widget catalogue.
// Each widget has one purpose, is readable at a glance, deep-links to the related page,
// and offers only the sizes where extra space adds real information.
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { date, dateTime, label, money, qty } from '../../lib/format';
import { isDark } from '../../lib/theme';
import Icon from '../../components/Icon';

const compact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return money(n);
};
const rows = (size, small = 3, large = 7) => (size === 'large' ? large : small);
const Empty = ({ children }) => <div className="w-empty">{children}</div>;

function StatTiles({ items }: any) {
  return (
    <div className="w-stats">
      {items.map(([n, l, to]) => (
        <Link key={l} to={to} className="w-stat" onClick={(e) => e.stopPropagation()}>
          <div key={n} className={`n ${!n ? 'zero' : ''}`}>{n ?? 0}</div>
          <div className="l">{l}</div>
        </Link>
      ))}
    </div>
  );
}

export const WIDGETS: any[] = [
  {
    id: 'getting_started', title: 'Getting started', icon: 'check', color: 'green', sizes: ['large', 'medium'], defaultSize: 'large',
    description: 'Follow the setup checklist step by step until your first order ships.',
    render: ({ data, size }) => {
      const steps = [
        ['has_profile', 'Fill in your company details', '/settings/organization'],
        ['has_item', 'Add your first item', '/items/new'],
        ['has_customer', 'Add a customer', '/customers/new'],
        ['has_vendor', 'Add a vendor (supplier)', '/vendors/new'],
        ['has_purchase_order', 'Order stock from a vendor', '/purchase-orders/new'],
        ['has_receive', 'Receive the stock', '/purchase-orders?status=issued'],
        ['has_sales_order', 'Create a sales order', '/sales-orders/new'],
        ['has_shipment', 'Pack and ship it', '/sales-orders?status=confirmed'],
        ['has_invoice', 'Send the invoice', '/invoices/new'],
        ['has_payment', 'Record the payment', '/payments-received/new'],
      ];
      const done = steps.filter(([k]) => data.onboarding[k]).length;
      const next = steps.filter(([k]) => !data.onboarding[k]);
      if (!next.length) return <Empty><div><div className="w-ok">✓ All set up</div><div className="w-sub">You have completed every setup step. You can remove this widget.</div></div></Empty>;
      return (
        <>
          <div className="w-sub" style={{ marginTop: 0 }}>{done} of {steps.length} steps done</div>
          <div className="progress" style={{ margin: '8px 0 6px' }}><div style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ul className="w-list">
            {next.slice(0, size === 'large' ? 6 : 2).map(([k, text, to], i) => (
              <li key={k}>
                <span className="step-dot" aria-hidden="true" />
                <span className="grow">{i === 0 ? <strong>Next: {text}</strong> : text}</span>
                <Link className="btn sm" to={to} onClick={(e) => e.stopPropagation()}>{i === 0 ? 'Start' : 'Go'}</Link>
              </li>
            ))}
          </ul>
          <Link className="small" to="/help/getting-started" onClick={(e) => e.stopPropagation()} style={{ marginTop: 'auto' }}>Read the beginner's guide →</Link>
        </>
      );
    },
  },
  {
    id: 'today', title: 'Today', icon: 'home', color: 'blue', sizes: ['medium', 'small'], defaultSize: 'medium',
    description: "See today's orders, invoices, payments and shipments at a glance.",
    render: ({ data, size }) => (size === 'small' ? (
      <>
        <div className="w-big md">{compact(data.today.received)}</div>
        <div className="w-sub">received today</div>
        <div className="w-foot">{data.today.sales_orders} new order(s) · {data.today.shipped} shipped</div>
      </>
    ) : (
      <StatTiles items={[
        [data.today.sales_orders, 'New orders', '/sales-orders'],
        [compact(data.today.invoiced), 'Invoiced', '/invoices'],
        [compact(data.today.received), 'Received', '/payments-received'],
        [data.today.shipped, 'Shipped', '/shipments'],
      ]} />
    )),
  },
  {
    id: 'low_stock', title: 'Low stock', icon: 'alert', color: 'orange', perm: 'items', sizes: ['medium', 'large', 'small'], defaultSize: 'medium',
    description: 'Spot items running low and reorder them in one click.',
    link: () => '/items?stock=low',
    render: ({ data, size, can }) => {
      const list = data.low_stock_items;
      if (size === 'small') {
        return (
          <>
            <div className={`w-big ${list.length ? 'w-alert' : ''}`}>{data.products.low_stock}</div>
            <div className="w-sub">{data.products.low_stock === 1 ? 'item needs' : 'items need'} reordering</div>
            <div className="w-foot">{data.products.out_of_stock} out of stock</div>
          </>
        );
      }
      if (!list.length) return <Empty><div><div className="w-ok">✓ Stock levels look healthy</div><div className="w-sub">Set a reorder point on items to get alerts here.</div></div></Empty>;
      return (
        <>
          <ul className="w-list">
            {list.slice(0, rows(size, 2, 6)).map((it) => (
              <li key={it.id}>
                <span className="grow"><Link to={`/items/${it.id}`} onClick={(e) => e.stopPropagation()}>{it.name}</Link></span>
                <span className="meta"><span className={it.available <= 0 ? 'w-alert' : ''}>{qty(it.available)} left</span> · reorder at {qty(it.reorder_level)}</span>
              </li>
            ))}
          </ul>
          {can('purchase_orders', 'create') && (
            <div className="w-foot">
              <Link className="btn sm primary" to={`/purchase-orders/new?items=${list.map((i) => i.id).join(',')}`} onClick={(e) => e.stopPropagation()}>Reorder {list.length > 1 ? `${list.length} items` : 'item'}</Link>
              <span>Creates a draft purchase order</span>
            </div>
          )}
        </>
      );
    },
  },
  {
    id: 'sales_activity', title: 'Sales activity', icon: 'sales', color: 'blue', perm: 'sales_orders', sizes: ['medium'], defaultSize: 'medium',
    description: 'Track orders waiting to be packed, shipped, delivered or invoiced.',
    render: ({ data }) => (
      <StatTiles items={[
        [data.pending.to_be_packed, 'To be packed', '/sales-orders?status=confirmed'],
        [data.pending.to_be_shipped, 'To be shipped', '/packages?status=not_shipped'],
        [data.pending.to_be_delivered, 'To be delivered', '/shipments?status=shipped'],
        [data.pending.to_be_invoiced, 'To be invoiced', '/sales-orders?status=confirmed'],
      ]} />
    ),
  },
  {
    id: 'purchase_activity', title: 'Purchase activity', icon: 'purchases', color: 'purple', perm: 'purchase_orders', sizes: ['medium'], defaultSize: 'medium',
    description: 'Track purchase orders waiting to be received or billed.',
    render: ({ data }) => (
      <StatTiles items={[
        [data.pending.to_be_received, 'To be received', '/purchase-orders?status=issued'],
        [data.pending.receive_in_progress, 'Partly received', '/purchase-orders?status=issued'],
        [data.pending.to_be_billed, 'To be billed', '/purchase-orders?status=issued'],
        [data.products.low_stock, 'Below reorder', '/items?stock=low'],
      ]} />
    ),
  },
  {
    id: 'stock_value', title: 'Stock value', icon: 'inventory', color: 'green', perm: 'items', sizes: ['small', 'medium'], defaultSize: 'small',
    description: 'See how much the stock in your warehouses is worth right now.',
    link: () => '/reports/inventory_valuation',
    render: ({ data, size }) => (size === 'small' ? (
      <>
        <div className="w-big md">{compact(data.inventory.stock_value)}</div>
        <div className="w-sub">{qty(data.inventory.quantity_in_hand)} units in hand</div>
        <div className="w-foot">{qty(data.inventory.quantity_to_receive)} on order</div>
      </>
    ) : (
      <div className="w-split">
        <div>
          <div className="w-big md">{compact(data.inventory.stock_value)}</div>
          <div className="w-sub">{qty(data.inventory.quantity_in_hand)} units in hand</div>
          <div className="w-sub">{qty(data.inventory.quantity_to_receive)} units on order</div>
        </div>
        <ul className="w-list">
          {data.top_stocked.slice(0, 3).map((it) => (
            <li key={it.id}><span className="grow">{it.name}</span><span className="meta">{compact(it.value)}</span></li>
          ))}
          {!data.top_stocked.length && <li className="faint">No stock yet</li>}
        </ul>
      </div>
    )),
  },
  {
    id: 'receivables', title: 'Money owed to you', icon: 'money', color: 'green', perm: 'invoices', sizes: ['small', 'medium'], defaultSize: 'small',
    description: 'Know how much customers owe you and how much is overdue.',
    link: () => '/invoices?status=unpaid',
    render: ({ data, size }) => {
      const overdue = Number(data.money.receivables_overdue);
      if (size === 'small') {
        return (
          <>
            <div className="w-big md">{compact(data.money.receivables)}</div>
            <div className="w-sub">unpaid customer invoices</div>
            <div className={`w-foot ${overdue > 0 ? 'w-alert' : ''}`}>{overdue > 0 ? `⚠ ${compact(overdue)} overdue` : '✓ Nothing overdue'}</div>
          </>
        );
      }
      const a = data.receivables_aging;
      const buckets = [['Not yet due', a.current, ''], ['1–15 days late', a.d1_15, 'warn'], ['16–30 days late', a.d16_30, 'warn'], ['31–45 days late', a.d31_45, 'bad'], ['45+ days late', a.d45_plus, 'bad']];
      const max = Math.max(1, ...buckets.map((b) => Number(b[1])));
      return (
        <div className="w-split" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <div><div className="w-big md">{compact(data.money.receivables)}</div><div className="w-sub">unpaid in total</div></div>
          <div className="w-bars">
            {buckets.map(([l, v, cls]) => (
              <div className="w-bar" key={l}><span className="faint">{l}</span><div className="track"><div className={`fill ${cls}`} style={{ width: `${(Number(v) / max) * 100}%` }} /></div><span className="right">{compact(v)}</span></div>
            ))}
          </div>
        </div>
      );
    },
  },
  {
    id: 'payables', title: 'Money you owe', icon: 'purchases', color: 'orange', perm: 'bills', sizes: ['small'], defaultSize: 'small',
    description: 'Know how much you owe vendors and how much is overdue.',
    link: () => '/bills?status=unpaid',
    render: ({ data }) => {
      const overdue = Number(data.money.payables_overdue);
      return (
        <>
          <div className="w-big md">{compact(data.money.payables)}</div>
          <div className="w-sub">unpaid vendor bills</div>
          <div className={`w-foot ${overdue > 0 ? 'w-alert' : ''}`}>{overdue > 0 ? `⚠ ${compact(overdue)} overdue` : '✓ Nothing overdue'}</div>
        </>
      );
    },
  },
  {
    id: 'cash_flow', title: 'Cash in & out', icon: 'money', color: 'purple', perm: 'reports', sizes: ['small'], defaultSize: 'small',
    description: 'Compare money received from customers with money paid to vendors.',
    link: () => '/reports/payments_received',
    render: ({ data, period }) => {
      const net = Number(data.money.received_in_period) - Number(data.money.paid_in_period);
      return (
        <>
          <div className={`w-big md ${net < 0 ? 'w-alert' : ''}`}>{net < 0 ? '−' : '+'}{compact(Math.abs(net))}</div>
          <div className="w-sub">net cash {period}</div>
          <div className="w-foot">In {compact(data.money.received_in_period)} · Out {compact(data.money.paid_in_period)}</div>
        </>
      );
    },
  },
  {
    id: 'sales_trend', title: 'Sales by month', icon: 'reports', color: 'blue', perm: 'sales_orders', sizes: ['large', 'medium'], defaultSize: 'large',
    description: 'Follow your confirmed sales order value month by month.',
    link: () => '/sales-orders',
    render: ({ data }) => {
      const chart = data.sales_by_month.map((m) => ({ month: m.month, total: Number(m.total) }));
      if (!chart.length) return <Empty>No confirmed sales orders in this period yet.</Empty>;
      const dark = isDark();
      return (
        <>
          <div className="w-sub" style={{ marginTop: 0 }}>Total {compact(data.sales_summary.total)} from {data.sales_summary.confirmed + data.sales_summary.closed} orders</div>
          <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: 0, right: 4, top: 4 }}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: dark ? '#aab0c0' : '#5a6276' }} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} tick={{ fill: dark ? '#aab0c0' : '#5a6276' }}
                  tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip formatter={(v) => money(v)} cursor={{ fill: dark ? '#232736' : '#f4f5f8' }}
                  contentStyle={{ background: dark ? '#1b1e29' : '#fff', border: '1px solid', borderColor: dark ? '#2e3345' : '#e3e6ec', borderRadius: 8 }} />
                <Bar dataKey="total" name="Sales" fill={dark ? '#5b9dff' : '#408dfb'} radius={[6, 6, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      );
    },
  },
  {
    id: 'top_selling', title: 'Best sellers', icon: 'items', color: 'green', perm: 'invoices', sizes: ['medium', 'large'], defaultSize: 'medium',
    description: 'See which items sell the most, by quantity invoiced.',
    link: () => '/reports/sales_by_item',
    render: ({ data, size }) => (!data.top_selling.length ? <Empty>Best sellers appear once you send invoices.</Empty> : (
      <ul className="w-list">
        {data.top_selling.slice(0, rows(size, 3, 5)).map((it, i) => (
          <li key={it.id}>
            <span className="badge blue">#{i + 1}</span>
            <span className="grow">{it.name}</span>
            <span className="meta">{qty(it.quantity)} {it.unit} · {compact(it.amount)}</span>
          </li>
        ))}
      </ul>
    )),
  },
  {
    id: 'shipments', title: 'On the way', icon: 'truck', color: 'purple', perm: 'packages', sizes: ['medium', 'large'], defaultSize: 'medium',
    description: 'Follow shipments that are on the way and mark them delivered.',
    link: () => '/shipments?status=shipped',
    render: ({ data, size, can, actions }) => (!data.open_shipments.length ? <Empty>✓ No shipments on the way right now.</Empty> : (
      <ul className="w-list">
        {data.open_shipments.slice(0, rows(size, 2, 6)).map((s) => (
          <li key={s.id}>
            <span className="grow"><Link to={`/shipments/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.number}</Link> · {s.contact_name}
              <div className="small faint">{[s.carrier, s.estimated_delivery && `due ${date(s.estimated_delivery)}`].filter(Boolean).join(' · ') || label(s.status)}</div></span>
            {can('packages', 'edit') && <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); actions.markDelivered(s); }}>Delivered</button>}
          </li>
        ))}
      </ul>
    )),
  },
  {
    id: 'top_vendors', title: 'Top vendors', icon: 'user', color: 'orange', perm: 'purchase_orders', sizes: ['medium'], defaultSize: 'medium',
    description: 'See which vendors you buy from the most.',
    link: () => '/vendors',
    render: ({ data }) => (!data.top_vendors.length ? <Empty>Top vendors appear once you issue purchase orders.</Empty> : (
      <ul className="w-list">
        {data.top_vendors.slice(0, 3).map((v) => (
          <li key={v.id}><span className="grow">{v.display_name}</span><span className="meta">{v.orders} order(s) · {compact(v.total)}</span></li>
        ))}
      </ul>
    )),
  },
  {
    id: 'recent_activity', title: 'Recent activity', icon: 'reports', color: 'blue', sizes: ['medium', 'large'], defaultSize: 'medium',
    description: 'Catch up on what your team created, changed or deleted.',
    link: () => '/settings/audit',
    render: ({ data, size }) => (!data.recent_activity.length ? <Empty>Nothing has happened yet.</Empty> : (
      <ul className="w-list">
        {data.recent_activity.slice(0, rows(size, 3, 7)).map((a) => (
          <li key={a.id}><span className="grow" title={a.summary}>{a.summary}</span><span className="meta">{dateTime(a.created_at).split(',')[0]}</span></li>
        ))}
      </ul>
    )),
  },
];

export const WIDGET_MAP = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export const DEFAULT_LAYOUT = [
  { id: 'getting_started', size: 'large' },
  { id: 'today', size: 'medium' },
  { id: 'low_stock', size: 'medium' },
  { id: 'sales_activity', size: 'medium' },
  { id: 'purchase_activity', size: 'medium' },
  { id: 'stock_value', size: 'small' },
  { id: 'receivables', size: 'small' },
  { id: 'payables', size: 'small' },
  { id: 'cash_flow', size: 'small' },
  { id: 'sales_trend', size: 'large' },
  { id: 'shipments', size: 'medium' },
  { id: 'top_selling', size: 'medium' },
  { id: 'recent_activity', size: 'medium' },
];

/** Placeholder shapes shown while a widget's data loads. */
export function WidgetPlaceholder({ size }: any) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
      <div className="w-skel" style={{ height: 28, width: size === 'small' ? '70%' : '40%' }} />
      <div className="w-skel" style={{ height: 12, width: '55%' }} />
      {size !== 'small' && <div className="w-skel" style={{ height: 12, width: '80%' }} />}
      {size === 'large' && <div className="w-skel" style={{ flex: 1 }} />}
    </div>
  );
}

export function WidgetIcon({ w }: any) {
  return <span className={`w-icon ${w.color}`}><Icon name={w.icon} size={15} className="" /></span>;
}
