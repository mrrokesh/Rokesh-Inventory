import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { money, qty } from '../../lib/format';
import DataTable from '../../components/DataTable';
import { Badge, PageHead, confirmDialog } from '../../components/ui';
import { useToast } from '../../components/Toast';

export function stockBadge(it) {
  if (!it.track_inventory) return <span className="faint small">Not tracked</span>;
  if (it.stock_on_hand <= 0) return <Badge status="out">Out of stock</Badge>;
  if (it.reorder_level > 0 && it.available_stock <= it.reorder_level) return <Badge status="low">Low stock</Badge>;
  return null;
}

export default function ItemsList({ composite = false }: any) {
  const { can } = useAuth();
  const toast = useToast();
  const base = composite ? '/composite-items' : '/items';
  const setStatus = (status) => async (ids) => {
    try {
      for (const id of ids) await api.post(`/items/${id}/status`, { status });
      toast(`${ids.length} item(s) marked ${status}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (ids) => {
    if (!(await confirmDialog({ title: 'Delete items', message: `Delete ${ids.length} item(s)? Items used in transactions cannot be deleted.`, danger: true, confirmText: 'Delete' }))) return false;
    let ok = 0;
    for (const id of ids) {
      try { await api.del(`/items/${id}`); ok += 1; } catch (e) { toast(e.message, 'error'); }
    }
    if (ok) toast(`${ok} item(s) deleted`);
    return true;
  };
  return (
    <div className="page">
      <PageHead title={composite ? 'Composite Items' : 'Items'}>
        {can('items', 'import') && !composite && <Link className="btn" to="/import/items">Import</Link>}
        {can('items', 'create') && <Link className="btn primary" to={`${base}/new`}>+ New</Link>}
      </PageHead>
      <DataTable
        endpoint="/items"
        params={{ composite: composite ? 'true' : undefined }}
        exportName={composite ? 'composite-items' : 'items'}
        rowLink={(r) => `/items/${r.id}`}
        searchPlaceholder="Search name, SKU, barcode, category"
        filters={[
          { key: 'status', label: 'Status', default: 'active', options: [['active', 'Active items'], ['inactive', 'Inactive items'], ['all', 'All items']].map(([v, l]) => [v === 'all' ? '' : v, l]) },
          { key: 'item_type', label: 'Type', options: [['', 'All types'], ['goods', 'Goods'], ['service', 'Services']] },
          { key: 'stock', label: 'Stock', options: [['', 'Any stock'], ['low', 'Low stock'], ['out', 'Out of stock']] },
        ]}
        bulkActions={can('items', 'edit') ? [
          { label: 'Mark active', run: setStatus('active') },
          { label: 'Mark inactive', run: setStatus('inactive') },
          ...(can('items', 'delete') ? [{ label: 'Delete', danger: true, run: remove }] : []),
        ] : []}
        emptyTitle={composite ? 'No composite items yet' : 'No items yet'}
        emptyText={composite ? 'Bundle several items into a kit and assemble it from stock.' : 'Add the goods and services you buy and sell.'}
        emptyAction={can('items', 'create') && <Link className="btn primary" to={`${base}/new`}>+ New {composite ? 'composite item' : 'item'}</Link>}
        columns={[
          { key: 'name', label: 'Name', sort: 'name', render: (r) => (
            <div className="row" style={{ gap: 10 }}>
              {r.image_path ? <img className="thumb" src={r.image_path} alt="" /> : <span className="thumb" />}
              <div><div className="bold">{r.name}</div><div className="small faint">{r.group_name || r.category || ''}</div></div>
            </div>) },
          { key: 'sku', label: 'SKU', sort: 'sku' },
          { key: 'item_type', label: 'Type', render: (r) => (r.is_composite ? 'Composite' : r.item_type === 'goods' ? 'Goods' : 'Service') },
          { key: 'stock_on_hand', label: 'Stock on hand', num: true, sort: 'stock', render: (r) => (r.track_inventory ? <>{qty(r.stock_on_hand)} {r.unit}<div>{stockBadge(r)}</div></> : '—') },
          { key: 'available_stock', label: 'Available', num: true, render: (r) => (r.track_inventory ? qty(r.available_stock) : '—') },
          { key: 'reorder_level', label: 'Reorder point', num: true, sort: 'reorder', render: (r) => (r.reorder_level ? qty(r.reorder_level) : '—') },
          { key: 'selling_price', label: 'Selling price', num: true, sort: 'rate', render: (r) => money(r.selling_price) },
          { key: 'cost_price', label: 'Cost price', num: true, sort: 'cost', render: (r) => money(r.cost_price) },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
        ]}
      />
    </div>
  );
}
