import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLookups } from '../lib/lookups';
import { date, qty, today } from '../lib/format';
import DataTable from '../components/DataTable';
import { ItemPicker } from '../components/Pickers';
import { BackLink, Badge, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

let k = 0;

// ================================================================ stock counts
export function StockCountsList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Stock Counts">{can('inventory', 'create') && <Link className="btn primary" to="/inventory/stock-counts/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/stock-counts" rowLink={(r) => `/inventory/stock-counts/${r.id}`} exportName="stock-counts"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] }]}
        emptyTitle="No stock counts yet" emptyText="Count physical stock in a warehouse and post differences as inventory adjustments."
        emptyAction={can('inventory', 'create') && <Link className="btn primary" to="/inventory/stock-counts/new">+ New stock count</Link>}
        columns={[
          { key: 'count_date', label: 'Date', sort: 'date', render: (r) => date(r.count_date) },
          { key: 'number', label: 'Count#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'warehouse_name', label: 'Warehouse' },
          { key: 'counted_lines', label: 'Counted', render: (r) => `${r.counted_lines}/${r.line_count}` },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'created_by_name', label: 'Created by' },
        ]} />
    </div>
  );
}

export function StockCountForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [f, setF] = useState<any>({ number: '', count_date: today(), warehouse_id: '', notes: '', fill_warehouse: true });
  const [lines, setLines] = useState<any[]>([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/stock-counts/next-number').then((n) => setF((x) => ({ ...x, number: n.number }))).catch(setError); }, []);
  useEffect(() => {
    if (!f.warehouse_id && warehouses.length) setF((x) => ({ ...x, warehouse_id: (warehouses.find((w) => w.is_primary) || warehouses[0]).id }));
  }, [warehouses, f.warehouse_id]);
  const addLine = (it) => {
    if (!it || lines.some((l) => l.item_id === it.id)) return;
    setLines((cur) => [...cur, { _k: ++k, item_id: it.id, item_name: it.name, counted_qty: '' }]);
    setF((x) => ({ ...x, fill_warehouse: false }));
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = f.fill_warehouse
        ? { ...f, fill_warehouse: true }
        : { ...f, fill_warehouse: false, lines: lines.map((l) => ({ item_id: l.item_id, counted_qty: l.counted_qty === '' ? null : l.counted_qty })) };
      if (!f.fill_warehouse && !lines.length) throw new Error('Add at least one item, or fill from warehouse stock');
      const r = await api.post('/stock-counts', body);
      toast('Stock count started');
      navigate(`/inventory/stock-counts/${r.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <BackLink to="/inventory/stock-counts">Stock Counts</BackLink>
      <PageHead title="New Stock Count" />
      <ErrorBox error={error} />
      <div className="card mb"><div className="card-body grid-2">
        <Field label="Count#"><Input value={f.number} onChange={(v) => setF({ ...f, number: v })} /></Field>
        <Field label="Date"><Input type="date" value={f.count_date} onChange={(v) => setF({ ...f, count_date: v })} /></Field>
        <Field label="Warehouse" required><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
        <label className="checkbox" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={f.fill_warehouse} onChange={(e) => setF({ ...f, fill_warehouse: e.target.checked })} />
          Include all items with stock in this warehouse
        </label>
      </div></div>
      {!f.fill_warehouse && (
        <div className="card mb">
          <div className="card-head"><h3>Items to count</h3></div>
          <div className="card-body">
            <ItemPicker onSelect={addLine} placeholder="Add item" params={{ track_inventory: 'true' }} />
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Item</th><th /></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l._k}><td>{l.item_name}</td>
                  <td className="right"><button type="button" className="btn sm ghost" onClick={() => setLines((cur) => cur.filter((x) => x._k !== l._k))}>Remove</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>Start count</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </div>
  );
}

export function StockCountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data: sc, error, reload } = useApi(`/stock-counts/${id}`);
  const [lines, setLines] = useState<any[]>([]);
  useEffect(() => { if (sc) setLines(sc.lines.map((l) => ({ ...l, counted_qty: l.counted_qty ?? '' }))); }, [sc]);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!sc) return <div className="page"><Spinner /></div>;
  const open = ['draft', 'in_progress'].includes(sc.status);
  const saveCounts = async () => {
    if ((await run(() => api.put(`/stock-counts/${sc.id}`, { count_date: sc.count_date, notes: sc.notes, lines }), 'Counts saved')) !== undefined) reload();
  };
  const complete = async () => {
    if (!(await confirmDialog({ message: 'Complete this count? Differences will create an inventory adjustment and update stock.', confirmText: 'Complete' }))) return;
    await saveCounts();
    if ((await run(() => api.post(`/stock-counts/${sc.id}/complete`), 'Stock count completed')) !== undefined) reload();
  };
  const cancel = async () => {
    if (!(await confirmDialog({ message: 'Cancel this stock count?', danger: true, confirmText: 'Cancel count' }))) return;
    if ((await run(() => api.post(`/stock-counts/${sc.id}/cancel`), 'Stock count cancelled')) !== undefined) reload();
  };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${sc.number}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/stock-counts/${sc.id}`), 'Deleted')) !== undefined) navigate('/inventory/stock-counts');
  };
  return (
    <div className="page">
      <PageHead title={`Stock Count ${sc.number}`} crumb={<Link to="/inventory/stock-counts">Stock Counts</Link>}>
        {open && can('inventory', 'edit') && <button type="button" className="btn" disabled={busy} onClick={saveCounts}>Save counts</button>}
        {open && can('inventory', 'approve') && <button type="button" className="btn primary" disabled={busy} onClick={complete}>Complete</button>}
        {open && can('inventory', 'edit') && <button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button>}
        {sc.status !== 'completed' && can('inventory', 'delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body"><dl className="kv">
        <dt>Status</dt><dd><Badge status={sc.status} /></dd>
        <dt>Date</dt><dd>{date(sc.count_date)}</dd>
        <dt>Warehouse</dt><dd>{sc.warehouse_name}</dd>
        {sc.notes && <><dt>Notes</dt><dd>{sc.notes}</dd></>}
        {sc.adjustment_id && <><dt>Adjustment</dt><dd><Link to={`/inventory/adjustments/${sc.adjustment_id}`}>View adjustment</Link></dd></>}
        <dt>Created by</dt><dd>{sc.created_by_name}</dd>
      </dl></div></div>
      <div className="card"><table className="table">
        <thead><tr><th>Item</th><th className="num">System qty</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
        <tbody>{lines.map((l) => {
          const counted = l.counted_qty === '' || l.counted_qty === null ? null : Number(l.counted_qty);
          const diff = counted === null ? null : counted - Number(l.system_qty);
          return (
            <tr key={l.id}>
              <td><Link to={`/items/${l.item_id}`}>{l.item_name}</Link> <span className="faint small">{l.item_sku}</span></td>
              <td className="num">{qty(l.system_qty)} {l.item_unit}</td>
              <td className="num" style={{ width: 140 }}>
                {open ? <input className="input num" type="number" step="any" value={l.counted_qty} onChange={(e) => setLines((cur) => cur.map((x) => (x.id === l.id ? { ...x, counted_qty: e.target.value } : x)))} /> : qty(l.counted_qty ?? 0)}
              </td>
              <td className="num" style={{ color: diff === null ? undefined : diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--green)' : undefined }}>
                {diff === null ? '—' : `${diff > 0 ? '+' : ''}${qty(diff)}`}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}

// ================================================================ picklists
export function PicklistsList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Picklists">{can('packages', 'create') && <Link className="btn primary" to="/inventory/picklists/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/picklists" rowLink={(r) => `/inventory/picklists/${r.id}`} exportName="picklists"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['draft', 'Draft'], ['picked', 'Picked'], ['cancelled', 'Cancelled']] }]}
        emptyTitle="No picklists yet" emptyText="Create a picklist from a confirmed sales order so the warehouse can pick items before packing."
        emptyAction={can('packages', 'create') && <Link className="btn primary" to="/inventory/picklists/new">+ New picklist</Link>}
        columns={[
          { key: 'pick_date', label: 'Date', sort: 'date', render: (r) => date(r.pick_date) },
          { key: 'number', label: 'Picklist#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'sales_order_number', label: 'Sales order', render: (r) => (r.sales_order_id ? <Link to={`/sales-orders/${r.sales_order_id}`}>{r.sales_order_number}</Link> : '—') },
          { key: 'customer_name', label: 'Customer' },
          { key: 'warehouse_name', label: 'Warehouse' },
          { key: 'total_qty', label: 'Qty', num: true, render: (r) => qty(r.total_qty) },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

export function PicklistForm() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [f, setF] = useState<any>({ number: '', pick_date: today(), warehouse_id: '', sales_order_id: sp.get('sales_order') || '', notes: '' });
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/picklists/next-number').then((n) => setF((x) => ({ ...x, number: n.number }))).catch(setError); }, []);
  useEffect(() => {
    api.get('/sales-orders', { status: 'confirmed', per_page: 100 }).then((r) => setOrders(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!f.warehouse_id && warehouses.length) setF((x) => ({ ...x, warehouse_id: (warehouses.find((w) => w.is_primary) || warehouses[0]).id }));
  }, [warehouses, f.warehouse_id]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post('/picklists', f);
      toast('Picklist created');
      navigate(`/inventory/picklists/${r.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <BackLink to="/inventory/picklists">Picklists</BackLink>
      <PageHead title="New Picklist" />
      <ErrorBox error={error} />
      <div className="card mb"><div className="card-body grid-2">
        <Field label="Picklist#"><Input value={f.number} onChange={(v) => setF({ ...f, number: v })} /></Field>
        <Field label="Date"><Input type="date" value={f.pick_date} onChange={(v) => setF({ ...f, pick_date: v })} /></Field>
        <Field label="Sales order" required>
          <Select value={f.sales_order_id} onChange={(v) => setF({ ...f, sales_order_id: Number(v) })}
            options={orders.map((o) => [o.id, `${o.number} — ${o.contact_name}`])} placeholder="Select confirmed sales order" />
        </Field>
        <Field label="Warehouse"><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
      </div></div>
      <p className="muted small">Lines are filled from items still left to pack on the sales order.</p>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !f.sales_order_id} onClick={save}>Create picklist</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </div>
  );
}

export function PicklistDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data: pl, error, reload } = useApi(`/picklists/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!pl) return <div className="page"><Spinner /></div>;
  const markPicked = async () => {
    if (!(await confirmDialog({ message: 'Mark all lines as picked?', confirmText: 'Mark picked' }))) return;
    if ((await run(() => api.post(`/picklists/${pl.id}/pick`), 'Picklist marked picked')) !== undefined) reload();
  };
  const cancel = async () => {
    if (!(await confirmDialog({ message: 'Cancel this picklist?', danger: true, confirmText: 'Cancel' }))) return;
    if ((await run(() => api.post(`/picklists/${pl.id}/cancel`), 'Cancelled')) !== undefined) reload();
  };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${pl.number}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/picklists/${pl.id}`), 'Deleted')) !== undefined) navigate('/inventory/picklists');
  };
  return (
    <div className="page">
      <PageHead title={`Picklist ${pl.number}`} crumb={<Link to="/inventory/picklists">Picklists</Link>}>
        {pl.status === 'draft' && can('packages', 'edit') && <button type="button" className="btn primary" disabled={busy} onClick={markPicked}>Mark picked</button>}
        {pl.status === 'draft' && can('packages', 'edit') && <button type="button" className="btn" disabled={busy} onClick={cancel}>Cancel</button>}
        {pl.sales_order_id && <Link className="btn" to={`/sales-orders/${pl.sales_order_id}`}>Open sales order</Link>}
        {can('packages', 'delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body"><dl className="kv">
        <dt>Status</dt><dd><Badge status={pl.status} /></dd>
        <dt>Date</dt><dd>{date(pl.pick_date)}</dd>
        <dt>Warehouse</dt><dd>{pl.warehouse_name}</dd>
        <dt>Customer</dt><dd>{pl.customer_name}</dd>
        <dt>Sales order</dt><dd>{pl.sales_order_id ? <Link to={`/sales-orders/${pl.sales_order_id}`}>{pl.sales_order_number}</Link> : '—'}</dd>
        {pl.notes && <><dt>Notes</dt><dd>{pl.notes}</dd></>}
        <dt>Created by</dt><dd>{pl.created_by_name}</dd>
      </dl></div></div>
      <div className="card"><table className="table">
        <thead><tr><th>Item</th><th className="num">To pick</th><th className="num">Picked</th><th className="num">On hand</th></tr></thead>
        <tbody>{pl.lines.map((l) => (
          <tr key={l.id}>
            <td><Link to={`/items/${l.item_id}`}>{l.item_name}</Link> <span className="faint small">{l.item_sku}</span></td>
            <td className="num bold">{qty(l.quantity_to_pick)} {l.item_unit}</td>
            <td className="num">{qty(l.quantity_picked)}</td>
            <td className="num" style={{ color: Number(l.on_hand) < Number(l.quantity_to_pick) ? 'var(--red)' : undefined }}>{qty(l.on_hand)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// ================================================================ tasks
export function TasksList() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [tick, setTick] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [f, setF] = useState({ title: '', description: '', priority: 'normal', due_date: '' });
  const create = async () => {
    if ((await run(() => api.post('/tasks', { ...f, assignee_id: user?.id }), 'Task created')) !== undefined) {
      setShowNew(false); setF({ title: '', description: '', priority: 'normal', due_date: '' }); setTick((t) => t + 1);
    }
  };
  return (
    <div className="page">
      <PageHead title="Tasks"><button type="button" className="btn primary" onClick={() => setShowNew(true)}>+ New</button></PageHead>
      {showNew && (
        <div className="card mb"><div className="card-body stack">
          <Field label="Title" required><Input value={f.title} onChange={(v) => setF({ ...f, title: v })} autoFocus /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={(v) => setF({ ...f, description: v })} rows={3} /></Field>
          <div className="grid-2">
            <Field label="Priority"><Select value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={[['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]} /></Field>
            <Field label="Due date"><Input type="date" value={f.due_date} onChange={(v) => setF({ ...f, due_date: v })} /></Field>
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !f.title} onClick={create}>Create task</button>
            <button type="button" className="btn" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div></div>
      )}
      <DataTable endpoint="/tasks" reloadKey={tick} exportName="tasks"
        filters={[
          { key: 'status', label: 'Status', options: [['', 'All'], ['open', 'Open'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] },
          { key: 'assignee_id', label: 'Assignee', options: [['', 'Anyone'], ['me', 'Assigned to me']] },
        ]}
        emptyTitle="No tasks yet" emptyText="Create follow-ups for sales orders, packing, receiving or anything else your team needs to finish."
        columns={[
          { key: 'title', label: 'Task', render: (r) => <Link to={`/tasks/${r.id}`} className="bold">{r.title}</Link> },
          { key: 'priority', label: 'Priority', render: (r) => <Badge status={r.priority} /> },
          { key: 'due_date', label: 'Due', render: (r) => date(r.due_date) },
          { key: 'assignee_name', label: 'Assignee' },
          { key: 'related_number', label: 'Related', render: (r) => r.related_number || '—' },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

export function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data: t, error, reload } = useApi(`/tasks/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!t) return <div className="page"><Spinner /></div>;
  const complete = async () => { if ((await run(() => api.post(`/tasks/${t.id}/complete`), 'Task completed')) !== undefined) reload(); };
  const reopen = async () => { if ((await run(() => api.post(`/tasks/${t.id}/reopen`), 'Task reopened')) !== undefined) reload(); };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete “${t.title}”?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/tasks/${t.id}`), 'Deleted')) !== undefined) navigate('/tasks');
  };
  return (
    <div className="page narrow">
      <PageHead title={t.title} crumb={<Link to="/tasks">Tasks</Link>}>
        {t.status === 'open' && <button type="button" className="btn primary" disabled={busy} onClick={complete}>Complete</button>}
        {t.status === 'completed' && <button type="button" className="btn" disabled={busy} onClick={reopen}>Reopen</button>}
        <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>
      </PageHead>
      <div className="card"><div className="card-body"><dl className="kv">
        <dt>Status</dt><dd><Badge status={t.status} /></dd>
        <dt>Priority</dt><dd><Badge status={t.priority} /></dd>
        <dt>Due</dt><dd>{date(t.due_date) || '—'}</dd>
        <dt>Assignee</dt><dd>{t.assignee_name || '—'}</dd>
        <dt>Created by</dt><dd>{t.created_by_name}</dd>
        {t.related_number && <><dt>Related</dt><dd>{t.related_type}: {t.related_number}</dd></>}
        {t.description && <><dt>Description</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{t.description}</dd></>}
      </dl></div></div>
    </div>
  );
}
