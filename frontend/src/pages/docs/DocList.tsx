import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { useAction } from '../../components/ui';
import { useAuth } from '../../auth';
import { date, money } from '../../lib/format';
import DataTable from '../../components/DataTable';
import { Badge, PageHead } from '../../components/ui';
import { useReportingTags } from '../../components/ReportingTags';

export default function DocList({ cfg }: any) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [rk, setRk] = useState(0);
  const tags = useReportingTags(cfg.entity);
  const shopify = cfg.key === 'sales_orders' && (user.integrations || []).includes('shopify') && can('sales_orders', 'create');
  const syncShopify = async () => { const r = await run(() => api.post('/integrations/shopify/sync', { what: 'orders' })); if (r) { toast(r.message); setRk((x) => x + 1); } };
  const extra = {
    sales_orders: [
      { key: 'channel', label: 'Channel', render: (r) => (r.channel && r.channel !== 'direct' ? <Badge status={r.channel} /> : '') },
      { key: 'shipment_status', label: 'Shipped', render: (r) => <Badge status={r.shipment_status} /> },
      { key: 'invoice_status', label: 'Invoiced', render: (r) => <Badge status={r.invoice_status} /> },
    ],
    purchase_orders: [
      { key: 'receive_status', label: 'Received', render: (r) => <Badge status={r.receive_status} /> },
      { key: 'bill_status', label: 'Billed', render: (r) => <Badge status={r.bill_status} /> },
      { key: 'expected_delivery_date', label: 'Delivery date', render: (r) => date(r.expected_delivery_date) },
    ],
  }[cfg.key] || [];
  const columns = [
    { key: 'doc_date', label: 'Date', sort: 'date', render: (r) => date(r.doc_date) },
    { key: 'number', label: cfg.numberLabel, sort: 'number', render: (r) => <span className="bold" style={{ color: 'var(--primary)' }}>{r.number}</span> },
    { key: 'reference', label: 'Reference#' },
    { key: 'contact_name', label: cfg.contactType === 'customer' ? 'Customer' : 'Vendor', sort: 'contact' },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge status={r.display_status || r.status} />, csv: (r) => r.display_status || r.status },
    ...(cfg.hasBalance ? [{ key: 'due_date', label: 'Due date', sort: 'due', render: (r) => date(r.due_date) }] : []),
    ...extra,
    { key: 'total', label: 'Amount', num: true, sort: 'total', render: (r) => money(r.total) },
    ...(cfg.hasBalance || cfg.hasCredit ? [{ key: 'balance', label: cfg.hasCredit ? 'Balance' : 'Balance due', num: true, sort: cfg.hasBalance ? 'balance' : undefined, render: (r) => money(r.balance) }] : []),
  ];
  return (
    <div className="page">
      <PageHead title={cfg.title}>
        {shopify && <button type="button" className="btn" disabled={busy} onClick={syncShopify}>{busy ? 'Importing…' : 'Import Shopify orders'}</button>}
        {can(cfg.perm, 'create') && <Link className="btn primary" to={`${cfg.path}/new`}>+ New</Link>}
      </PageHead>
      <DataTable endpoint={cfg.api} reloadKey={rk} rowLink={(r) => `${cfg.path}/${r.id}`} exportName={cfg.key} columns={columns}
        searchPlaceholder={`Search ${cfg.numberLabel}, reference or ${cfg.contactType}`}
        filters={[{ key: 'status', label: 'Status', options: cfg.statuses }, ...tags.map((t) => ({ key: `tag_${t.id}`, label: t.name, options: [['', `All ${t.name}`], ...(t.options || []).map((o) => [o, o])] }))]}
        emptyTitle={`No ${cfg.title.toLowerCase()} yet`}
        emptyAction={can(cfg.perm, 'create') && <Link className="btn primary" to={`${cfg.path}/new`}>+ New {cfg.one.toLowerCase()}</Link>} />
    </div>
  );
}
