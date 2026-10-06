import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../../api';
import { useAuth } from '../../auth';
import { useLookups } from '../../lib/lookups';
import { date, dateTime, label, money, qty, today } from '../../lib/format';
import { Badge, Dropdown, ErrorBox, Modal, PageHead, Spinner, Tabs, confirmDialog, useAction, useApi } from '../../components/ui';
import { Attachments, History } from '../../components/Attachments';
import { useToast } from '../../components/Toast';
import { stockBadge } from './ItemsList';

const SOURCE_LINKS = {
  shipment: (id) => `/shipments/${id}`, invoice: (id) => `/invoices/${id}`, purchase_receive: (id) => `/purchase-receives/${id}`,
  bill: (id) => `/bills/${id}`, inventory_adjustment: (id) => `/inventory/adjustments/${id}`, transfer_out: (id) => `/inventory/transfers/${id}`,
  transfer_in: (id) => `/inventory/transfers/${id}`, assembly: (id) => `/inventory/assemblies/${id}`, sales_return: (id) => `/sales-returns/${id}`,
  vendor_credit: (id) => `/vendor-credits/${id}`, delivery_challan: (id) => `/delivery-challans/${id}`, opening_stock: null,
};

function OpeningStockModal({ item, onClose, onDone }: any) {
  const { warehouses } = useLookups('warehouses');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [asOf, setAsOf] = useState(today());
  const [rows, setRows] = useState<any>({});
  const save = async () => {
    const opening_stock = Object.entries(rows as Record<string, any>).filter(([, r]) => Number(r.quantity) > 0).map(([wid, r]) => ({ warehouse_id: Number(wid), quantity: r.quantity, unit_cost: r.unit_cost || item.cost_price }));
    const ok = await run(() => api.post(`/items/${item.id}/opening-stock`, { opening_stock, opening_stock_date: asOf }), 'Opening stock recorded');
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title="Add opening stock" onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="field mb"><label>As of date</label><input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      <table className="table compact">
        <thead><tr><th>Warehouse</th><th className="num">Quantity</th><th className="num">Rate per unit</th></tr></thead>
        <tbody>
          {warehouses.filter((w) => w.status === 'active').map((w) => (
            <tr key={w.id}><td>{w.name}</td>
              <td><input className="input num" type="number" min="0" step="any" value={rows[w.id]?.quantity || ''} onChange={(e) => setRows({ ...rows, [w.id]: { ...rows[w.id], quantity: e.target.value } })} /></td>
              <td><input className="input num" type="number" min="0" step="0.01" placeholder={String(item.cost_price)} value={rows[w.id]?.unit_cost || ''} onChange={(e) => setRows({ ...rows, [w.id]: { ...rows[w.id], unit_cost: e.target.value } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function TrackingTab({ item }: any) {
  const [status, setStatus] = useState('in_stock');
  const [search, setSearch] = useState('');
  const [hist, setHist] = useState(null);
  const { data } = useApi(`/items/${item.id}/tracking`, { status });
  if (!data) return <Spinner />;
  const showHistory = async (serial) => setHist({ serial, rows: await api.get(`/items/${item.id}/serials/${encodeURIComponent(serial)}/history`) });
  if (data.tracking === 'batch') {
    return (
      <table className="table compact">
        <thead><tr><th>Batch</th><th>Warehouse</th><th>Manufactured</th><th>Expiry</th><th className="num">Quantity</th></tr></thead>
        <tbody>
          {data.batches.length === 0 && <tr><td colSpan={5} className="faint">No batches in stock.</td></tr>}
          {data.batches.map((b) => {
            const expired = b.expiry_date && b.expiry_date < today();
            return <tr key={b.id}><td className="mono">{b.batch_no}</td><td>{b.warehouse_name}</td><td>{date(b.mfg_date) || '—'}</td>
              <td style={{ color: expired ? 'var(--red)' : undefined }}>{date(b.expiry_date) || '—'}{expired ? ' ⚠ expired' : ''}</td><td className="num">{qty(b.quantity)}</td></tr>;
          })}
        </tbody>
      </table>
    );
  }
  const list = (data.serials || []).filter((s) => !search || s.serial.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <input type="search" className="input" style={{ width: 240 }} placeholder="Find a serial number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="in_stock">In stock</option><option value="out">Sold / out of stock</option></select>
        <span className="muted small">{list.length} serial number(s)</span>
      </div>
      <table className="table compact">
        <thead><tr><th>Serial number</th><th>Warehouse</th><th>Added</th><th /></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={4} className="faint">None.</td></tr>}
          {list.map((s) => <tr key={s.id}><td className="mono">{s.serial}</td><td>{s.warehouse_name || '—'}</td><td>{date(s.created_at)}</td>
            <td className="num"><button type="button" className="btn sm ghost" onClick={() => showHistory(s.serial)}>History</button></td></tr>)}
        </tbody>
      </table>
      {hist && (
        <Modal title={`History of ${hist.serial}`} onClose={() => setHist(null)}>
          <table className="table compact">
            <thead><tr><th>When</th><th>What happened</th><th>Reference</th><th>Warehouse</th></tr></thead>
            <tbody>{hist.rows.map((r, i) => (
              <tr key={i}><td>{dateTime(r.created_at)}</td><td>{Number(r.quantity) > 0 ? 'In: ' : 'Out: '}{label(r.source_type)}</td>
                <td>{SOURCE_LINKS[r.source_type] ? <Link to={SOURCE_LINKS[r.source_type](r.source_id)}>{r.source_number}</Link> : r.source_number}</td><td>{r.warehouse_name}</td></tr>
            ))}</tbody>
          </table>
        </Modal>
      )}
    </>
  );
}

function Movements({ itemId }: any) {
  const [page, setPage] = useState(1);
  const { data } = useApi(`/items/${itemId}/movements`, { page, per_page: 25 });
  if (!data) return <Spinner />;
  if (!data.data.length) return <div className="empty-state">No stock transactions yet.</div>;
  return (
    <>
      <table className="table compact">
        <thead><tr><th>Date</th><th>Transaction</th><th>Reference</th><th>Warehouse</th><th className="num">Quantity</th><th className="num">Value</th><th>By</th></tr></thead>
        <tbody>
          {data.data.map((m) => (
            <tr key={m.id}>
              <td>{date(m.movement_date)}</td>
              <td>{label(m.source_type)}<div className="small faint">{m.note}</div></td>
              <td>{SOURCE_LINKS[m.source_type] ? <Link to={SOURCE_LINKS[m.source_type](m.source_id)}>{m.source_number}</Link> : m.source_number}</td>
              <td>{m.warehouse_name}</td>
              <td className="num" style={{ color: m.quantity < 0 ? 'var(--red)' : 'var(--green)' }}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)}</td>
              <td className="num">{money(m.value)}</td>
              <td className="small faint">{m.user_name}<div>{dateTime(m.created_at)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > 25 && (
        <div className="pager">
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} / {Math.ceil(data.total / 25)}</span>
          <button type="button" className="btn sm" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'overview');
  const [openingModal, setOpeningModal] = useState(false);
  const { data: it, error, reload } = useApi(`/items/${id}`);
  const [, run] = useAction(toast);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!it) return <div className="page"><Spinner /></div>;

  const toggleStatus = async () => {
    const status = it.status === 'active' ? 'inactive' : 'active';
    if (await run(() => api.post(`/items/${it.id}/status`, { status }), `Item marked ${status}`)) reload();
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete item', message: `Delete ${it.name}? This cannot be undone.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/items/${it.id}`), 'Item deleted')) !== undefined) navigate(it.is_composite ? '/composite-items' : '/items');
  };
  const removeImage = async () => { if (await run(() => api.del(`/items/${it.id}/image`).then(() => true), 'Image removed')) reload(); };

  return (
    <div className="page">
      <PageHead title={it.name} crumb={<Link to={it.is_composite ? '/composite-items' : '/items'}>{it.is_composite ? 'Composite Items' : 'Items'}</Link>}>
        <Badge status={it.status} />
        {can('items', 'edit') && <Link className="btn" to={`/items/${it.id}/edit`}>Edit</Link>}
        {it.is_composite && can('inventory', 'create') && <Link className="btn primary" to={`/inventory/assemblies/new?item=${it.id}`}>Assemble</Link>}
        {it.track_inventory && !it.is_composite && can('inventory', 'create') && <Link className="btn" to={`/inventory/adjustments/new?item=${it.id}`}>Adjust stock</Link>}
        <Dropdown button={(t) => <button type="button" className="btn" onClick={t}>More ▾</button>}>
          {can('sales_orders', 'create') && <Link to={`/sales-orders/new?item=${it.id}`}>New sales order</Link>}
          {can('purchase_orders', 'create') && <Link to={`/purchase-orders/new?item=${it.id}`}>New purchase order</Link>}
          {it.track_inventory && !it.is_composite && can('items', 'edit') && it.stock_on_hand === 0 && <button type="button" onClick={() => setOpeningModal(true)}>Add opening stock</button>}
          {can('items', 'edit') && <button type="button" onClick={toggleStatus}>Mark as {it.status === 'active' ? 'inactive' : 'active'}</button>}
          {can('items', 'edit') && it.image_path && <button type="button" onClick={removeImage}>Remove image</button>}
          {can('items', 'delete') && <><div className="sep" /><button type="button" className="danger" onClick={remove}>Delete</button></>}
        </Dropdown>
      </PageHead>
      <Tabs tabs={[['overview', 'Overview'], ...(it.track_inventory ? [['transactions', 'Stock history']] : []), ...(it.tracking !== 'none' ? [['tracking', it.tracking === 'serial' ? 'Serial numbers' : 'Batches']] : []), ['history', 'History']]} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
          <div className="stack">
            <div className="card"><div className="card-body">
              <dl className="kv">
                <dt>Item type</dt><dd>{it.is_composite ? 'Composite item' : it.item_type === 'goods' ? (it.track_inventory ? 'Inventory item' : 'Non-inventory goods') : 'Service'}</dd>
                <dt>SKU</dt><dd>{it.sku || '—'}</dd>
                <dt>Unit</dt><dd>{it.unit || '—'}</dd>
                {it.barcode && <><dt>Barcode</dt><dd>{it.barcode}</dd></>}
                {it.group_name && <><dt>Item group</dt><dd><Link to={`/item-groups/${it.group_id}`}>{it.group_name}</Link> {Object.entries(it.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</dd></>}
                {it.category && <><dt>Category</dt><dd>{it.category}</dd></>}
                {it.brand && <><dt>Brand</dt><dd>{it.brand}</dd></>}
                {it.manufacturer && <><dt>Manufacturer</dt><dd>{it.manufacturer}</dd></>}
                {it.hsn_sac && <><dt>HSN/SAC</dt><dd>{it.hsn_sac}</dd></>}
                <dt>Returnable</dt><dd>{it.returnable ? 'Yes' : 'No'}</dd>
                {it.tracking !== 'none' && <><dt>Tracked by</dt><dd>{it.tracking === 'serial' ? 'Serial number' : 'Batch & expiry'}</dd></>}
                {(it.length_cm || it.weight_kg) && <><dt>Dimensions / weight</dt><dd>{[it.length_cm, it.width_cm, it.height_cm].filter(Boolean).join(' × ')} {it.length_cm ? 'cm' : ''} {it.weight_kg ? `· ${it.weight_kg} kg` : ''}</dd></>}
                {it.description && <><dt>Description</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{it.description}</dd></>}
              </dl>
            </div></div>
            <div className="grid-2">
              <div className="card"><div className="card-head"><h3>Sales information</h3></div><div className="card-body">
                <dl className="kv"><dt>Selling price</dt><dd className="bold">{money(it.selling_price)}</dd><dt>Tax</dt><dd>{it.sales_tax_name || 'Non-taxable'}</dd>
                  {it.sales_description && <><dt>Description</dt><dd>{it.sales_description}</dd></>}</dl>
              </div></div>
              <div className="card"><div className="card-head"><h3>Purchase information</h3></div><div className="card-body">
                <dl className="kv"><dt>Cost price</dt><dd className="bold">{money(it.cost_price)}</dd><dt>Tax</dt><dd>{it.purchase_tax_name || 'Non-taxable'}</dd>
                  <dt>Preferred vendor</dt><dd>{it.preferred_vendor_id ? <Link to={`/vendors/${it.preferred_vendor_id}`}>{it.preferred_vendor_name}</Link> : '—'}</dd></dl>
              </div></div>
            </div>
            {it.is_composite && (
              <div className="card"><div className="card-head"><h3>Components</h3></div><div className="card-body flush">
                <table className="table compact"><thead><tr><th>Item</th><th className="num">Quantity per unit</th><th className="num">Cost</th></tr></thead>
                  <tbody>{it.components.map((c) => <tr key={c.item_id}><td><Link to={`/items/${c.item_id}`}>{c.name}</Link> <span className="faint small">{c.sku}</span></td><td className="num">{qty(c.quantity)} {c.unit}</td><td className="num">{money(c.cost_price * c.quantity)}</td></tr>)}</tbody>
                </table>
              </div></div>
            )}
            {it.used_in.length > 0 && (
              <div className="card"><div className="card-head"><h3>Used in composite items</h3></div><div className="card-body flush">
                <table className="table compact"><tbody>{it.used_in.map((c) => <tr key={c.id}><td><Link to={`/items/${c.id}`}>{c.name}</Link></td><td className="num">{qty(c.quantity)} per unit</td></tr>)}</tbody></table>
              </div></div>
            )}
            <Attachments entityType="item" entityId={it.id} />
          </div>
          <div className="stack">
            {it.image_path && <div className="card"><img src={mediaUrl(it.image_path)} alt={it.name} style={{ width: '100%', borderRadius: 8, display: 'block' }} /></div>}
            {it.track_inventory && (
              <>
                <div className="card"><div className="card-head"><h3>Stock</h3>{stockBadge(it)}</div><div className="card-body">
                  <dl className="kv">
                    <dt>Stock on hand</dt><dd className="bold">{qty(it.stock_on_hand)} {it.unit}</dd>
                    <dt>Committed</dt><dd>{qty(it.committed_stock)}</dd>
                    <dt>Available for sale</dt><dd className="bold">{qty(it.available_stock)}</dd>
                    <dt>To be received</dt><dd>{qty(it.qty_to_receive)}</dd>
                    <dt>To be shipped</dt><dd>{qty(it.qty_to_ship)}</dd>
                    <dt>Reorder point</dt><dd>{qty(it.reorder_level)}</dd>
                    <dt>Stock value (FIFO)</dt><dd>{money(it.stock_value)}</dd>
                  </dl>
                </div></div>
                <div className="card"><div className="card-head"><h3>Warehouses</h3></div><div className="card-body flush">
                  <table className="table compact"><thead><tr><th>Warehouse</th><th className="num">On hand</th><th className="num">Committed</th><th className="num">Available</th></tr></thead>
                    <tbody>{it.warehouses.map((w) => <tr key={w.warehouse_id}><td>{w.warehouse_name}</td><td className="num">{qty(w.on_hand)}</td><td className="num">{qty(w.committed)}</td><td className="num">{qty(w.available)}</td></tr>)}</tbody>
                  </table>
                </div></div>
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'transactions' && <div className="card"><Movements itemId={it.id} /></div>}
      {tab === 'tracking' && <div className="card"><TrackingTab item={it} /></div>}
      {tab === 'history' && <History entityType="item" entityId={it.id} />}
      {openingModal && <OpeningStockModal item={it} onClose={() => setOpeningModal(false)} onDone={reload} />}
    </div>
  );
}
