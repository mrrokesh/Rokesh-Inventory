import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { addressLines, date, label, money, qty, today } from '../lib/format';
import DataTable from '../components/DataTable';
import { Attachments, History } from '../components/Attachments';
import { Badge, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';
import { ShipModal } from './docs/Modals';

// ================================================================ packages
export function PackagesList() {
  return (
    <div className="page">
      <PageHead title="Packages" />
      <DataTable endpoint="/packages" rowLink={(r) => `/packages/${r.id}`} exportName="packages"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['not_shipped', 'Not shipped'], ['shipped', 'Shipped'], ['delivered', 'Delivered']] }]}
        emptyTitle="No packages yet" emptyText="Create packages from a confirmed sales order (Create package)."
        columns={[
          { key: 'package_date', label: 'Date', sort: 'date', render: (r) => date(r.package_date) },
          { key: 'number', label: 'Package#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'sales_order_number', label: 'Sales order#' },
          { key: 'contact_name', label: 'Customer', sort: 'contact' },
          { key: 'total_quantity', label: 'Quantity', num: true, render: (r) => qty(r.total_quantity) },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'carrier', label: 'Carrier / tracking', render: (r) => [r.carrier, r.tracking_number].filter(Boolean).join(' · ') },
        ]} />
    </div>
  );
}

export function PackageDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const [ship, setShip] = useState(false);
  const [booking, setBooking] = useState(false);
  const { data: p, error, reload } = useApi(`/packages/${id}`);
  const shiprocket = async () => {
    if (!(await confirmDialog({ title: 'Ship with Shiprocket', message: 'Book this package with Shiprocket? A courier is assigned automatically and the shipping charge is deducted from your Shiprocket wallet.', confirmText: 'Book shipment' }))) return;
    setBooking(true);
    const r = await run(() => api.post(`/integrations/shiprocket/book/${p.id}`), 'Booked with Shiprocket');
    setBooking(false);
    if (r) { toast(`AWB ${r.awb} with ${r.courier}`); reload(); }
  };
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!p) return <div className="page"><Spinner /></div>;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete package ${p.number}? The items go back to "to be packed".`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/packages/${p.id}`), 'Package deleted')) !== undefined) navigate(`/sales-orders/${p.sales_order_id}`);
  };
  return (
    <div className="page narrow">
      <PageHead title={`Package ${p.number}`} crumb={<Link to="/packages">Packages</Link>}>
        <Badge status={p.status} />
        {!p.shipment && can('packages', 'create') && <button type="button" className="btn primary" onClick={() => setShip(true)}><Icon name="truck" size={14} className="" /> Ship package</button>}
        {!p.shipment && can('packages', 'create') && (user.integrations || []).includes('shiprocket') && <button type="button" className="btn" disabled={booking} onClick={shiprocket}>{booking ? 'Booking…' : 'Ship with Shiprocket'}</button>}
        {p.shipment && <Link className="btn" to={`/shipments/${p.shipment.id}`}>View shipment {p.shipment.number}</Link>}
        <button type="button" className="btn" onClick={() => window.print()}>Print packing slip</button>
        {!p.shipment && can('packages', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="doc-paper mb">
        <div className="row"><div className="doc-title">Packing slip</div><div className="spacer" /><div className="right"><div className="bold">{p.number}</div><div className="small muted">{date(p.package_date)}</div></div></div>
        <div className="grid-2 mt">
          <div><div className="small muted">Ship to</div><div className="bold">{p.contact_name}</div>{addressLines(p.shipping_address).map((l) => <div key={l} className="small">{l}</div>)}</div>
          <dl className="kv">
            <dt>Sales order</dt><dd><Link to={`/sales-orders/${p.sales_order_id}`}>{p.sales_order_number}</Link></dd>
            <dt>Warehouse</dt><dd>{p.warehouse_name}</dd>
            {(p.length_cm || p.weight_kg) && <><dt>Dimensions / weight</dt><dd>{[p.length_cm, p.width_cm, p.height_cm].filter(Boolean).join(' × ')} cm {p.weight_kg ? `· ${p.weight_kg} kg` : ''}</dd></>}
          </dl>
        </div>
        <table className="table mt">
          <thead><tr><th>#</th><th>Item</th><th className="num">Ordered</th><th className="num">Packed</th></tr></thead>
          <tbody>{p.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.item_name}<div className="small faint">{l.item_sku}</div>{l.units?.length > 0 && <div className="small mono">{l.units.join(', ')}</div>}</td><td className="num">{qty(l.ordered)}</td><td className="num bold">{qty(l.quantity)} {l.item_unit}</td></tr>)}</tbody>
        </table>
        {p.notes && <div className="mt small muted">{p.notes}</div>}
      </div>
      <Attachments entityType="package" entityId={p.id} />
      {ship && <ShipModal pkg={p} onClose={() => setShip(false)} onDone={() => { setShip(false); reload(); }} />}
    </div>
  );
}

// ================================================================ shipments
export function ShipmentsList() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [rk, setRk] = useState(0);
  const sync = async () => { const r = await run(() => api.post('/integrations/shiprocket/sync')); if (r) { toast(r.message); setRk((x) => x + 1); } };
  return (
    <div className="page">
      <PageHead title="Shipments">
        {(user.integrations || []).includes('shiprocket') && can('packages', 'edit') && <button type="button" className="btn" disabled={busy} onClick={sync}>{busy ? 'Checking…' : 'Update Shiprocket tracking'}</button>}
      </PageHead>
      <DataTable endpoint="/shipments" reloadKey={rk} rowLink={(r) => `/shipments/${r.id}`} exportName="shipments" searchPlaceholder="Search shipment#, tracking#, customer"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['shipped', 'Shipped'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['returned', 'Returned'], ['failed', 'Failed']] }]}
        emptyTitle="No shipments yet" emptyText="Ship a package to create a shipment."
        columns={[
          { key: 'ship_date', label: 'Date', sort: 'date', render: (r) => date(r.ship_date) },
          { key: 'number', label: 'Shipment#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'sales_order_number', label: 'Sales order#' },
          { key: 'package_number', label: 'Package#' },
          { key: 'contact_name', label: 'Customer' },
          { key: 'carrier', label: 'Carrier' },
          { key: 'tracking_number', label: 'Tracking#' },
          { key: 'estimated_delivery', label: 'Est. delivery', render: (r) => date(r.estimated_delivery) },
          { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

function ShipmentEdit({ sh, onClose, onDone }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ ...sh, delivered_date: sh.delivered_date || today() });
  const save = async () => { if (await run(() => api.put(`/shipments/${sh.id}`, f), 'Shipment updated')) onDone(); };
  return (
    <Modal title={`Update ${sh.number}`} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="grid-2">
        <Field label="Status"><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[['shipped', 'Shipped'], ['in_transit', 'In transit'], ['delivered', 'Delivered'], ['returned', 'Returned'], ['failed', 'Failed']]} /></Field>
        {f.status === 'delivered' && <Field label="Delivered on"><Input type="date" value={f.delivered_date} onChange={(v) => setF({ ...f, delivered_date: v })} /></Field>}
        <Field label="Carrier"><Input value={f.carrier} onChange={(v) => setF({ ...f, carrier: v })} /></Field>
        <Field label="Tracking#"><Input value={f.tracking_number} onChange={(v) => setF({ ...f, tracking_number: v })} /></Field>
        <Field label="Service"><Input value={f.service_type} onChange={(v) => setF({ ...f, service_type: v })} /></Field>
        <Field label="Shipping cost"><Input type="number" min="0" step="0.01" value={f.shipping_cost} onChange={(v) => setF({ ...f, shipping_cost: v })} /></Field>
        <Field label="Estimated delivery"><Input type="date" value={f.estimated_delivery} onChange={(v) => setF({ ...f, estimated_delivery: v })} /></Field>
      </div>
      <Field label="Notes" className="mt"><Textarea rows={2} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
      {['returned', 'failed'].includes(f.status) && <div className="warn-box mt small">This only changes the tracking status. To bring goods back into stock, create a sales return from the sales order.</div>}
    </Modal>
  );
}

export function ShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const [edit, setEdit] = useState(false);
  const [hk, setHk] = useState(0);
  const { data: s, error, reload } = useApi(`/shipments/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!s) return <div className="page"><Spinner /></div>;
  const quick = async (status) => { if (await run(() => api.put(`/shipments/${s.id}`, { ...s, status }), `Marked ${status.replace('_', ' ')}`)) { reload(); setHk((k) => k + 1); } };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete shipment ${s.number}? The shipped stock will be put back into the warehouse.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/shipments/${s.id}`), 'Shipment deleted, stock restored')) !== undefined) navigate(`/packages/${s.package_id}`);
  };
  const trackUrl = s.tracking_url && s.tracking_number ? s.tracking_url.replace('{tracking}', encodeURIComponent(s.tracking_number)) : null;
  return (
    <div className="page narrow">
      <PageHead title={`Shipment ${s.number}`} crumb={<Link to="/shipments">Shipments</Link>}>
        <Badge status={s.status} />
        {can('packages', 'edit') && s.status === 'shipped' && <button type="button" className="btn" onClick={() => quick('in_transit')}>Mark in transit</button>}
        {can('packages', 'edit') && ['shipped', 'in_transit'].includes(s.status) && <button type="button" className="btn primary" onClick={() => quick('delivered')}>Mark delivered</button>}
        {can('packages', 'edit') && <button type="button" className="btn" onClick={() => setEdit(true)}>Edit</button>}
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
        {can('packages', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body grid-2">
        <dl className="kv">
          <dt>Customer</dt><dd><Link to={`/customers/${s.contact_id}`}>{s.contact_name}</Link></dd>
          <dt>Sales order</dt><dd><Link to={`/sales-orders/${s.sales_order_id}`}>{s.sales_order_number}</Link></dd>
          <dt>Package</dt><dd><Link to={`/packages/${s.package_id}`}>{s.package_number}</Link></dd>
          <dt>Shipped on</dt><dd>{date(s.ship_date)}</dd>
          {s.delivered_date && <><dt>Delivered on</dt><dd>{date(s.delivered_date)}</dd></>}
        </dl>
        <dl className="kv">
          <dt>Carrier</dt><dd>{s.carrier || '—'} {s.service_type && <span className="faint">({s.service_type})</span>}</dd>
          <dt>Tracking#</dt><dd>{trackUrl ? <a href={trackUrl} target="_blank" rel="noreferrer">{s.tracking_number}</a> : s.tracking_number || '—'}</dd>
          <dt>Shipping cost</dt><dd>{money(s.shipping_cost)}</dd>
          <dt>Est. delivery</dt><dd>{date(s.estimated_delivery) || '—'}</dd>
          {s.provider && <><dt>Booked via</dt><dd>{label(s.provider)}{s.label_url && <> · <a href={s.label_url} target="_blank" rel="noreferrer">Download label</a></>}</dd></>}
          <dt>Ship to</dt><dd>{addressLines(s.shipping_address).join(', ') || '—'}</dd>
        </dl>
      </div></div>
      <div className="card mb"><table className="table">
        <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
        <tbody>{s.lines.map((l) => <tr key={l.id}><td>{l.item_name} <span className="faint small">{l.item_sku}</span></td><td className="num">{qty(l.quantity)} {l.item_unit}</td></tr>)}</tbody>
      </table></div>
      {s.notes && <div className="card mb"><div className="card-body">{s.notes}</div></div>}
      <div className="stack">
        <Attachments entityType="shipment" entityId={s.id} />
        <History entityType="shipment" entityId={s.id} reloadKey={hk} />
      </div>
      {edit && <ShipmentEdit sh={s} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); setHk((k) => k + 1); }} />}
    </div>
  );
}

// ================================================================ sales returns
export function SalesReturnsList() {
  return (
    <div className="page">
      <PageHead title="Sales Returns" />
      <DataTable endpoint="/sales-returns" rowLink={(r) => `/sales-returns/${r.id}`} exportName="sales-returns"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['approved', 'Approved'], ['received', 'Received'], ['credited', 'Credited']] }]}
        emptyTitle="No sales returns yet" emptyText="Create a return from a sales order that has shipped items (More → Create sales return)."
        columns={[
          { key: 'return_date', label: 'Date', sort: 'date', render: (r) => date(r.return_date) },
          { key: 'number', label: 'RMA#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'sales_order_number', label: 'Sales order#' },
          { key: 'contact_name', label: 'Customer' },
          { key: 'total_quantity', label: 'Quantity', num: true, render: (r) => qty(r.total_quantity) },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

export function SalesReturnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [hk, setHk] = useState(0);
  const { data: r, error, reload } = useApi(`/sales-returns/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!r) return <div className="page"><Spinner /></div>;
  const receive = async () => { if (await run(() => api.post(`/sales-returns/${r.id}/receive`, { received_date: today() }), 'Return received into stock')) { reload(); setHk((k) => k + 1); } };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${r.number}?${r.received_date ? ' Restocked items will be removed from stock again.' : ''}`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/sales-returns/${r.id}`), 'Sales return deleted')) !== undefined) navigate(`/sales-orders/${r.sales_order_id}`);
  };
  return (
    <div className="page narrow">
      <PageHead title={`Sales Return ${r.number}`} crumb={<Link to="/sales-returns">Sales Returns</Link>}>
        <Badge status={r.status} />
        {r.status === 'approved' && can('sales_returns', 'edit') && <button type="button" className="btn primary" disabled={busy} onClick={receive}>Receive items</button>}
        {r.credit_notes.length === 0 && can('sales_returns', 'create') && <Link className="btn" to={`/credit-notes/new?from_return=${r.id}`}>Create credit note</Link>}
        {can('sales_returns', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body">
        <dl className="kv">
          <dt>Customer</dt><dd><Link to={`/customers/${r.contact_id}`}>{r.contact_name}</Link></dd>
          <dt>Sales order</dt><dd><Link to={`/sales-orders/${r.sales_order_id}`}>{r.sales_order_number}</Link></dd>
          <dt>Return date</dt><dd>{date(r.return_date)}</dd>
          <dt>Warehouse</dt><dd>{r.warehouse_name}</dd>
          {r.received_date && <><dt>Received on</dt><dd>{date(r.received_date)}</dd></>}
          {r.reason && <><dt>Reason</dt><dd>{r.reason}</dd></>}
          {r.credit_notes.map((c) => <Fragment key={c.id}><dt>Credit note</dt><dd><Link to={`/credit-notes/${c.id}`}>{c.number}</Link> · {money(c.total)} <Badge status={c.status} /></dd></Fragment>)}
        </dl>
      </div></div>
      <div className="card mb"><table className="table">
        <thead><tr><th>Item</th><th className="num">Returned</th><th>Restock</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id}><td>{l.item_name} <span className="faint small">{l.item_sku}</span></td><td className="num">{qty(l.quantity)} {l.item_unit}</td><td>{l.restock ? 'Back to stock' : 'Not restocked'}</td></tr>)}</tbody>
      </table></div>
      <div className="stack">
        <Attachments entityType="sales_return" entityId={r.id} />
        <History entityType="sales_return" entityId={r.id} reloadKey={hk} />
      </div>
    </div>
  );
}

// ================================================================ purchase receives
export function PurchaseReceivesList() {
  return (
    <div className="page">
      <PageHead title="Purchase Receives" />
      <DataTable endpoint="/purchase-receives" rowLink={(r) => `/purchase-receives/${r.id}`} exportName="purchase-receives"
        emptyTitle="No purchase receives yet" emptyText="Receive goods from an issued purchase order (Receive)."
        columns={[
          { key: 'receive_date', label: 'Date', sort: 'date', render: (r) => date(r.receive_date) },
          { key: 'number', label: 'Receive#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'purchase_order_number', label: 'Purchase order#' },
          { key: 'contact_name', label: 'Vendor' },
          { key: 'warehouse_name', label: 'Warehouse' },
          { key: 'total_quantity', label: 'Quantity', num: true, render: (r) => qty(r.total_quantity) },
        ]} />
    </div>
  );
}

export function PurchaseReceiveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const { data: r, error } = useApi(`/purchase-receives/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!r) return <div className="page"><Spinner /></div>;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${r.number}? The received stock will be removed (only possible if it has not been used yet).`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/purchase-receives/${r.id}`), 'Purchase receive deleted')) !== undefined) navigate(`/purchase-orders/${r.purchase_order_id}`);
  };
  return (
    <div className="page narrow">
      <PageHead title={`Purchase Receive ${r.number}`} crumb={<Link to="/purchase-receives">Purchase Receives</Link>}>
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
        {can('purchase_receives', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body">
        <dl className="kv">
          <dt>Vendor</dt><dd><Link to={`/vendors/${r.contact_id}`}>{r.contact_name}</Link></dd>
          <dt>Purchase order</dt><dd><Link to={`/purchase-orders/${r.purchase_order_id}`}>{r.purchase_order_number}</Link></dd>
          <dt>Received on</dt><dd>{date(r.receive_date)}</dd>
          <dt>Warehouse</dt><dd>{r.warehouse_name}</dd>
          <dt>Recorded by</dt><dd>{r.created_by_name}</dd>
          {r.notes && <><dt>Notes</dt><dd>{r.notes}</dd></>}
        </dl>
      </div></div>
      <div className="card mb"><table className="table">
        <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id}><td>{l.item_name} <span className="faint small">{l.item_sku}</span>{l.units?.length > 0 && <div className="small mono">{l.units.join(', ')}</div>}</td><td className="num">{qty(l.ordered)}</td><td className="num bold">{qty(l.quantity)} {l.item_unit}</td></tr>)}</tbody>
      </table></div>
      <Attachments entityType="purchase_receive" entityId={r.id} />
    </div>
  );
}
