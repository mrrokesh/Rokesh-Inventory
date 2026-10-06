import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLookups } from '../lib/lookups';
import { date, money, qty, today } from '../lib/format';
import DataTable from '../components/DataTable';
import { ItemPicker } from '../components/Pickers';
import { Attachments, History } from '../components/Attachments';
import { BackLink, Badge, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';
import { TrackingButton, TrackingModal } from '../components/Tracking';

const REASONS = ['Stock on fire', 'Stolen goods', 'Damaged goods', 'Stocktaking results', 'Inventory revaluation', 'Expired goods', 'Found extra stock', 'Opening stock correction', 'Other'];
let k = 0;

/** Current on-hand quantity of an item in a warehouse. */
async function stockIn(itemId, warehouseId) {
  const it = await api.get(`/items/${itemId}`);
  const w = it.warehouses.find((x) => x.warehouse_id === Number(warehouseId));
  return { item: it, onHand: w ? w.on_hand : 0, value: it.stock_value, avgCost: it.stock_on_hand > 0 ? it.stock_value / it.stock_on_hand : it.cost_price };
}

// ================================================================ adjustments
export function AdjustmentsList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Inventory Adjustments">{can('inventory', 'create') && <Link className="btn primary" to="/inventory/adjustments/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/inventory-adjustments" rowLink={(r) => `/inventory/adjustments/${r.id}`} exportName="inventory-adjustments"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['draft', 'Draft'], ['adjusted', 'Adjusted']] }]}
        emptyTitle="No adjustments yet" emptyText="Correct stock for damage, theft, stock-take differences or revalue inventory."
        emptyAction={can('inventory', 'create') && <Link className="btn primary" to="/inventory/adjustments/new">+ New adjustment</Link>}
        columns={[
          { key: 'adj_date', label: 'Date', sort: 'date', render: (r) => date(r.adj_date) },
          { key: 'number', label: 'Adjustment#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'reference', label: 'Reference#' },
          { key: 'reason', label: 'Reason' },
          { key: 'mode', label: 'Type', render: (r) => (r.mode === 'quantity' ? 'Quantity' : 'Value') },
          { key: 'warehouse_name', label: 'Warehouse' },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'value_change', label: 'Value change', num: true, render: (r) => money(r.value_change) },
          { key: 'created_by_name', label: 'Created by' },
        ]} />
    </div>
  );
}

export function AdjustmentForm() {
  const { id } = useParams();
  const editing = !!id;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [f, setF] = useState<any>({ number: '', reference: '', mode: 'quantity', adj_date: today(), warehouse_id: '', account: 'Cost of Goods Sold', reason: '', description: '' });
  const [lines, setLines] = useState<any[]>([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (editing) {
          const a = await api.get(`/inventory-adjustments/${id}`);
          setF({ number: a.number, reference: a.reference || '', mode: a.mode, adj_date: a.adj_date, warehouse_id: a.warehouse_id, account: a.account, reason: a.reason, description: a.description || '' });
          setLines(a.lines.map((l) => ({ _k: ++k, item_id: l.item_id, item_name: l.item_name, on_hand: l.current_on_hand, qty_adjusted: l.qty_adjusted, new_qty: l.current_on_hand + l.qty_adjusted, unit_cost: l.unit_cost ?? '', value_adjusted: l.value_adjusted, tmode: l.item_tracking, tracking: l.tracking })));
        } else {
          const n = await api.get('/inventory-adjustments/next-number');
          setF((x) => ({ ...x, number: n.number }));
        }
      } catch (err) { setError(err); } finally { setLoading(false); }
    })();
  }, [editing, id]);

  useEffect(() => {
    if (!f.warehouse_id && warehouses.length) {
      const w = warehouses.find((x) => x.is_primary) || warehouses[0];
      setF((x) => ({ ...x, warehouse_id: w.id }));
    }
  }, [warehouses, f.warehouse_id]);

  // Pre-select an item from ?item=
  useEffect(() => {
    const itemId = sp.get('item');
    if (!itemId || editing || !f.warehouse_id || lines.length) return;
    stockIn(itemId, f.warehouse_id).then(({ item, onHand, avgCost }) => setLines([{ _k: ++k, item_id: item.id, item_name: item.name, on_hand: onHand, qty_adjusted: '', new_qty: '', unit_cost: '', avg_cost: avgCost, value_adjusted: '', tmode: item.tracking, tracking: null }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.warehouse_id]);

  // Refresh on-hand figures when the warehouse changes.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useEffect(() => {
    if (!f.warehouse_id) return;
    for (const l of linesRef.current) {
      if (!l.item_id) continue;
      stockIn(l.item_id, f.warehouse_id).then(({ onHand }) => setLines((cur) => cur.map((x) => (x._k === l._k ? { ...x, on_hand: onHand, new_qty: x.qty_adjusted === '' ? '' : onHand + Number(x.qty_adjusted) } : x))));
    }
  }, [f.warehouse_id]);

  const upd = (key, patch) => setLines((ls) => ls.map((l) => (l._k === key ? { ...l, ...patch } : l)));
  const [trackLine, setTrackLine] = useState(null);
  const pickItem = async (key, it) => {
    const { onHand, avgCost } = await stockIn(it.id, f.warehouse_id);
    upd(key, { item_id: it.id, item_name: it.name, on_hand: onHand, avg_cost: avgCost, qty_adjusted: '', new_qty: '', tmode: it.tracking, tracking: null });
  };

  const save = async (status) => {
    setBusy(true); setError(null);
    try {
      const body = { ...f, status, lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, qty_adjusted: l.qty_adjusted, unit_cost: l.unit_cost === '' ? null : l.unit_cost, value_adjusted: l.value_adjusted, tracking: l.tracking || null })) };
      let saved;
      if (editing) {
        saved = await api.put(`/inventory-adjustments/${id}`, body);
        if (status === 'adjusted') saved = await api.post(`/inventory-adjustments/${id}/adjust`);
      } else saved = await api.post('/inventory-adjustments', body);
      toast(status === 'adjusted' ? 'Stock adjusted' : 'Adjustment saved as draft');
      navigate(`/inventory/adjustments/${saved.id}`);
    } catch (err) { setError(err); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };
  if (loading) return <div className="page"><Spinner /></div>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); save('draft'); }}>
      <div className="page">
        <BackLink to="/inventory/adjustments">Inventory Adjustments</BackLink>
        <PageHead title={editing ? `Edit ${f.number}` : 'New Adjustment'} />
        <ErrorBox error={error} />
        <div className="card mb"><div className="card-body">
          <div className="grid-3">
            <Field label="Mode of adjustment">
              <div className="radio-group">
                {[['quantity', 'Quantity adjustment'], ['value', 'Value adjustment']].map(([v, l]) => (
                  <label key={v} className="checkbox"><input type="radio" checked={f.mode === v} onChange={() => setF({ ...f, mode: v })} />{l}</label>
                ))}
              </div>
            </Field>
            <Field label="Reference number"><Input value={f.reference} onChange={(v) => setF({ ...f, reference: v })} /></Field>
            <Field label="Date" required><Input type="date" required value={f.adj_date} onChange={(v) => setF({ ...f, adj_date: v })} /></Field>
            <Field label="Account" required><Select value={f.account} onChange={(v) => setF({ ...f, account: v })} options={['Cost of Goods Sold', 'Inventory Shrinkage', 'Damaged Goods Write-off', 'Inventory Revaluation', 'Other Expenses'].map((x) => [x, x])} /></Field>
            <Field label="Reason" required>
              <input className="input" list="adj-reasons" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              <datalist id="adj-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Warehouse"><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
          </div>
          <Field label="Description" className="mt"><Textarea rows={2} value={f.description} onChange={(v) => setF({ ...f, description: v })} /></Field>
        </div></div>
        <div className="card mb">
          <table className="table lines">
            <thead>
              {f.mode === 'quantity' ? (
                <tr><th>Item details</th><th className="num">Quantity available</th><th className="num" style={{ width: 150 }}>New quantity on hand</th><th className="num" style={{ width: 150 }}>Quantity adjusted</th><th className="num" style={{ width: 150 }}>Cost price (for additions)</th><th /></tr>
              ) : (
                <tr><th>Item details</th><th className="num">Quantity available</th><th className="num" style={{ width: 170 }}>Value adjusted (+/-)</th><th /></tr>
              )}
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l._k}>
                  <td className="item-cell"><ItemPicker value={l.item_id} valueLabel={l.item_name} params={{ tracked: 'true' }} onSelect={(it) => pickItem(l._k, it)} />
                    {f.mode === 'quantity' && Number(l.qty_adjusted) !== 0 && l.qty_adjusted !== '' && (
                      <TrackingButton mode={l.tmode} direction={Number(l.qty_adjusted) > 0 ? 'in' : 'out'} required={Number(l.qty_adjusted) > 0} value={l.tracking} onClick={() => setTrackLine(l)} />
                    )}</td>
                  <td className="num">{l.item_id ? qty(l.on_hand) : ''}</td>
                  {f.mode === 'quantity' ? (
                    <>
                      <td><input className="input num" type="number" step="any" min="0" value={l.new_qty} onChange={(e) => upd(l._k, { new_qty: e.target.value, qty_adjusted: e.target.value === '' ? '' : Number(e.target.value) - Number(l.on_hand) })} /></td>
                      <td><input className="input num" type="number" step="any" value={l.qty_adjusted} onChange={(e) => upd(l._k, { qty_adjusted: e.target.value, new_qty: e.target.value === '' ? '' : Number(l.on_hand) + Number(e.target.value) })} /></td>
                      <td><input className="input num" type="number" min="0" step="0.01" disabled={!(Number(l.qty_adjusted) > 0)} placeholder={l.avg_cost ? Number(l.avg_cost).toFixed(2) : ''} value={l.unit_cost} onChange={(e) => upd(l._k, { unit_cost: e.target.value })} /></td>
                    </>
                  ) : (
                    <td><input className="input num" type="number" step="0.01" value={l.value_adjusted} onChange={(e) => upd(l._k, { value_adjusted: e.target.value })} /></td>
                  )}
                  <td><button type="button" className="btn ghost sm danger" onClick={() => setLines((ls) => ls.filter((x) => x._k !== l._k))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 12 }}><button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { _k: ++k, item_id: null, item_name: '', on_hand: 0, qty_adjusted: '', new_qty: '', unit_cost: '', value_adjusted: '' }])}>+ Add item</button></div>
        </div>
        <div className="small faint">Removed stock is costed FIFO. Added stock uses the cost price you enter (or the current average cost).</div>
        {trackLine && (
          <TrackingModal itemId={trackLine.item_id} itemName={trackLine.item_name} mode={trackLine.tmode} direction={Number(trackLine.qty_adjusted) > 0 ? 'in' : 'out'}
            quantity={Math.abs(Number(trackLine.qty_adjusted))} warehouseId={f.warehouse_id} value={trackLine.tracking} onClose={() => setTrackLine(null)}
            onSave={(v) => { upd(trackLine._k, { tracking: v }); setTrackLine(null); }} />
        )}
      </div>
      <div className="form-footer">
        <button type="submit" className="btn" disabled={busy}>Save as Draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save('adjusted')}>Convert to Adjusted</button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

export function AdjustmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [hk, setHk] = useState(0);
  const { data: a, error, reload } = useApi(`/inventory-adjustments/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!a) return <div className="page"><Spinner /></div>;
  const adjust = async () => { if (await run(() => api.post(`/inventory-adjustments/${a.id}/adjust`), 'Stock adjusted')) { reload(); setHk((x) => x + 1); } };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${a.number}?${a.status === 'adjusted' ? ' Its stock changes will be reversed.' : ''}`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/inventory-adjustments/${a.id}`), 'Adjustment deleted')) !== undefined) navigate('/inventory/adjustments');
  };
  return (
    <div className="page narrow">
      <PageHead title={`Adjustment ${a.number}`} crumb={<Link to="/inventory/adjustments">Inventory Adjustments</Link>}>
        <Badge status={a.status} />
        {a.status === 'draft' && can('inventory', 'edit') && <Link className="btn" to={`/inventory/adjustments/${a.id}/edit`}>Edit</Link>}
        {a.status === 'draft' && can('inventory', 'approve') && <button type="button" className="btn primary" disabled={busy} onClick={adjust}>Convert to adjusted</button>}
        {can('inventory', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body"><dl className="kv">
        <dt>Date</dt><dd>{date(a.adj_date)}</dd><dt>Type</dt><dd>{a.mode === 'quantity' ? 'Quantity adjustment' : 'Value adjustment'}</dd>
        <dt>Reason</dt><dd>{a.reason}</dd><dt>Account</dt><dd>{a.account}</dd><dt>Warehouse</dt><dd>{a.warehouse_name}</dd>
        {a.reference && <><dt>Reference#</dt><dd>{a.reference}</dd></>}
        {a.description && <><dt>Description</dt><dd>{a.description}</dd></>}
        <dt>Created by</dt><dd>{a.created_by_name}</dd>
      </dl></div></div>
      <div className="card mb"><table className="table">
        <thead><tr><th>Item</th><th className="num">Current on hand</th><th className="num">{a.mode === 'quantity' ? 'Quantity adjusted' : 'Value adjusted'}</th>{a.mode === 'quantity' && <th className="num">Cost price</th>}</tr></thead>
        <tbody>{a.lines.map((l) => (
          <tr key={l.id}><td><Link to={`/items/${l.item_id}`}>{l.item_name}</Link> <span className="faint small">{l.item_sku}</span></td><td className="num">{qty(l.current_on_hand)}</td>
            <td className="num bold" style={{ color: (l.qty_adjusted || l.value_adjusted) < 0 ? 'var(--red)' : 'var(--green)' }}>{a.mode === 'quantity' ? `${l.qty_adjusted > 0 ? '+' : ''}${qty(l.qty_adjusted)}` : money(l.value_adjusted)}</td>
            {a.mode === 'quantity' && <td className="num">{l.unit_cost !== null ? money(l.unit_cost) : '—'}</td>}</tr>
        ))}</tbody>
      </table></div>
      <div className="stack"><Attachments entityType="inventory_adjustment" entityId={a.id} /><History entityType="inventory_adjustment" entityId={a.id} reloadKey={hk} /></div>
    </div>
  );
}

// ================================================================ transfer orders
export function TransfersList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Transfer Orders">{can('inventory', 'create') && <Link className="btn primary" to="/inventory/transfers/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/transfer-orders" rowLink={(r) => `/inventory/transfers/${r.id}`} exportName="transfer-orders"
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['draft', 'Draft'], ['in_transit', 'In transit'], ['received', 'Received']] }]}
        emptyTitle="No transfer orders yet" emptyText="Move stock between warehouses."
        emptyAction={can('inventory', 'create') && <Link className="btn primary" to="/inventory/transfers/new">+ New transfer order</Link>}
        columns={[
          { key: 'transfer_date', label: 'Date', sort: 'date', render: (r) => date(r.transfer_date) },
          { key: 'number', label: 'Transfer order#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'from_warehouse_name', label: 'Source warehouse' },
          { key: 'to_warehouse_name', label: 'Destination warehouse' },
          { key: 'total_quantity', label: 'Quantity', num: true, render: (r) => qty(r.total_quantity) },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

export function TransferForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [f, setF] = useState<any>({ number: '', transfer_date: today(), from_warehouse_id: '', to_warehouse_id: '', reason: '' });
  const [lines, setLines] = useState<any[]>([{ _k: ++k, item_id: null, item_name: '', quantity: 1, src: null, dst: null }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const active = warehouses.filter((w) => w.status === 'active');
  const [trackT, setTrackT] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        if (editing) {
          const t = await api.get(`/transfer-orders/${id}`);
          setF({ number: t.number, transfer_date: t.transfer_date, from_warehouse_id: t.from_warehouse_id, to_warehouse_id: t.to_warehouse_id, reason: t.reason || '' });
          setLines(t.lines.map((l) => ({ _k: ++k, item_id: l.item_id, item_name: l.item_name, quantity: l.quantity, src: l.source_on_hand, dst: l.destination_on_hand, tmode: l.item_tracking, tracking: l.tracking })));
        } else {
          const n = await api.get('/transfer-orders/next-number');
          setF((x) => ({ ...x, number: n.number }));
        }
      } catch (err) { setError(err); } finally { setLoading(false); }
    })();
  }, [editing, id]);
  useEffect(() => {
    if (!f.from_warehouse_id && active.length >= 2) setF((x) => ({ ...x, from_warehouse_id: active[0].id, to_warehouse_id: active[1].id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses]);

  const refreshStock = async (key, itemId) => {
    const it = await api.get(`/items/${itemId}`);
    const s = it.warehouses.find((w) => w.warehouse_id === Number(f.from_warehouse_id));
    const d = it.warehouses.find((w) => w.warehouse_id === Number(f.to_warehouse_id));
    setLines((ls) => ls.map((l) => (l._k === key ? { ...l, src: s?.on_hand ?? 0, dst: d?.on_hand ?? 0 } : l)));
  };
  useEffect(() => { lines.forEach((l) => l.item_id && refreshStock(l._k, l.item_id)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.from_warehouse_id, f.to_warehouse_id]);

  const save = async (action) => {
    setBusy(true); setError(null);
    try {
      const body = { ...f, action, lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, quantity: l.quantity, tracking: l.tracking || null })) };
      let saved;
      if (editing) {
        saved = await api.put(`/transfer-orders/${id}`, body);
        if (action !== 'draft') saved = await api.post(`/transfer-orders/${id}/dispatch`);
        if (action === 'received') saved = await api.post(`/transfer-orders/${id}/receive`, { received_date: f.transfer_date });
      } else saved = await api.post('/transfer-orders', body);
      toast(action === 'draft' ? 'Transfer order saved as draft' : action === 'in_transit' ? 'Stock dispatched (in transit)' : 'Stock transferred');
      navigate(`/inventory/transfers/${saved.id}`);
    } catch (err) { setError(err); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };
  if (loading) return <div className="page"><Spinner /></div>;
  if (active.length < 2) {
    return <div className="page narrow"><PageHead title="New Transfer Order" /><div className="warn-box">You need at least two active warehouses to transfer stock. <Link to="/settings/warehouses">Add a warehouse</Link>.</div></div>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); save('draft'); }}>
      <div className="page">
        <BackLink to="/inventory/transfers">Transfer Orders</BackLink>
        <PageHead title={editing ? `Edit ${f.number}` : 'New Transfer Order'} />
        <ErrorBox error={error} />
        <div className="card mb"><div className="card-body grid-3">
          <Field label="Transfer order#"><Input value={f.number} onChange={(v) => setF({ ...f, number: v })} disabled={editing} /></Field>
          <Field label="Date" required><Input type="date" required value={f.transfer_date} onChange={(v) => setF({ ...f, transfer_date: v })} /></Field>
          <Field label="Reason"><Input value={f.reason} onChange={(v) => setF({ ...f, reason: v })} /></Field>
          <Field label="Source warehouse" required><Select value={f.from_warehouse_id} onChange={(v) => setF({ ...f, from_warehouse_id: Number(v) })} options={active.map((w) => [w.id, w.name])} /></Field>
          <Field label="Destination warehouse" required><Select value={f.to_warehouse_id} onChange={(v) => setF({ ...f, to_warehouse_id: Number(v) })} options={active.filter((w) => w.id !== Number(f.from_warehouse_id)).map((w) => [w.id, w.name])} placeholder="Select" /></Field>
        </div></div>
        <div className="card mb">
          <table className="table lines">
            <thead><tr><th>Item details</th><th className="num">Source stock</th><th className="num">Destination stock</th><th className="num" style={{ width: 150 }}>Transfer quantity</th><th /></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l._k}>
                <td className="item-cell"><ItemPicker value={l.item_id} valueLabel={l.item_name} params={{ tracked: 'true' }} onSelect={(it) => { setLines((ls) => ls.map((x) => (x._k === l._k ? { ...x, item_id: it.id, item_name: it.name, tmode: it.tracking, tracking: null } : x))); refreshStock(l._k, it.id); }} />
                  {l.item_id && <TrackingButton mode={l.tmode} direction="out" value={l.tracking} onClick={() => setTrackT(l)} />}</td>
                <td className="num">{l.src !== null ? qty(l.src) : ''}</td>
                <td className="num">{l.dst !== null ? qty(l.dst) : ''}</td>
                <td><input className="input num" type="number" min="0.001" step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x._k === l._k ? { ...x, quantity: e.target.value } : x)))} />
                  {l.src !== null && Number(l.quantity) > l.src && <div className="small" style={{ color: 'var(--red)' }}>More than available</div>}</td>
                <td><button type="button" className="btn ghost sm danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x._k !== l._k))}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ padding: 12 }}><button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { _k: ++k, item_id: null, item_name: '', quantity: 1, src: null, dst: null }])}>+ Add item</button></div>
        </div>
        {trackT && (
          <TrackingModal itemId={trackT.item_id} itemName={trackT.item_name} mode={trackT.tmode} direction="out" quantity={trackT.quantity}
            warehouseId={f.from_warehouse_id} value={trackT.tracking} onClose={() => setTrackT(null)}
            onSave={(v) => { setLines((ls) => ls.map((x) => (x._k === trackT._k ? { ...x, tracking: v } : x))); setTrackT(null); }} />
        )}
      </div>
      <div className="form-footer">
        <button type="submit" className="btn" disabled={busy}>Save as Draft</button>
        <button type="button" className="btn" disabled={busy} onClick={() => save('in_transit')}>Initiate Transfer (in transit)</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save('received')}>Transfer and Mark as Received</button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

export function TransferDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [hk, setHk] = useState(0);
  const { data: t, error, reload } = useApi(`/transfer-orders/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!t) return <div className="page"><Spinner /></div>;
  const act = async (path: any, msg?: any, body?: any) => { if (await run(() => api.post(`/transfer-orders/${t.id}/${path}`, body), msg)) { reload(); setHk((x) => x + 1); } };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${t.number}?${t.status !== 'draft' ? ' Stock movements will be reversed.' : ''}`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/transfer-orders/${t.id}`), 'Transfer order deleted')) !== undefined) navigate('/inventory/transfers');
  };
  return (
    <div className="page narrow">
      <PageHead title={`Transfer Order ${t.number}`} crumb={<Link to="/inventory/transfers">Transfer Orders</Link>}>
        <Badge status={t.status} />
        {t.status === 'draft' && can('inventory', 'edit') && <Link className="btn" to={`/inventory/transfers/${t.id}/edit`}>Edit</Link>}
        {t.status === 'draft' && can('inventory', 'approve') && <button type="button" className="btn primary" disabled={busy} onClick={() => act('dispatch', 'Marked in transit')}>Initiate transfer</button>}
        {t.status === 'in_transit' && can('inventory', 'approve') && <button type="button" className="btn primary" disabled={busy} onClick={() => act('receive', 'Stock received', { received_date: today() })}>Mark as received</button>}
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
        {can('inventory', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body"><dl className="kv">
        <dt>Date</dt><dd>{date(t.transfer_date)}</dd>
        <dt>From</dt><dd>{t.from_warehouse_name}</dd><dt>To</dt><dd>{t.to_warehouse_name}</dd>
        {t.received_date && <><dt>Received on</dt><dd>{date(t.received_date)}</dd></>}
        {t.reason && <><dt>Reason</dt><dd>{t.reason}</dd></>}
        <dt>Created by</dt><dd>{t.created_by_name}</dd>
      </dl></div></div>
      <div className="card mb"><table className="table">
        <thead><tr><th>Item</th><th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">{t.from_warehouse_name} now</th><th className="num">{t.to_warehouse_name} now</th></tr></thead>
        <tbody>{t.lines.map((l) => <tr key={l.id}><td><Link to={`/items/${l.item_id}`}>{l.item_name}</Link> <span className="faint small">{l.item_sku}</span></td><td className="num bold">{qty(l.quantity)} {l.item_unit}</td>
          <td className="num">{l.unit_cost !== null ? money(l.unit_cost) : '—'}</td><td className="num">{qty(l.source_on_hand)}</td><td className="num">{qty(l.destination_on_hand)}</td></tr>)}</tbody>
      </table></div>
      <History entityType="transfer_order" entityId={t.id} reloadKey={hk} />
    </div>
  );
}

// ================================================================ assemblies
export function AssembliesList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Assemblies">{can('inventory', 'create') && <Link className="btn primary" to="/inventory/assemblies/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/assemblies" rowLink={(r) => `/inventory/assemblies/${r.id}`} exportName="assemblies"
        emptyTitle="No assemblies yet" emptyText="Build composite items (kits/bundles) from their components, or break them back down."
        columns={[
          { key: 'assembly_date', label: 'Date', sort: 'date', render: (r) => date(r.assembly_date) },
          { key: 'number', label: 'Assembly#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'kind', label: 'Type', render: (r) => (r.kind === 'assemble' ? 'Assemble' : 'Disassemble') },
          { key: 'item_name', label: 'Composite item' },
          { key: 'quantity', label: 'Quantity', num: true, render: (r) => qty(r.quantity) },
          { key: 'warehouse_name', label: 'Warehouse' },
          { key: 'total_cost', label: 'Cost', num: true, render: (r) => money(r.total_cost) },
        ]} />
    </div>
  );
}

export function AssemblyForm() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [item, setItem] = useState(null);
  const [f, setF] = useState<any>({ kind: 'assemble', quantity: 1, assembly_date: today(), warehouse_id: '', notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadItem = (itemId) => api.get(`/items/${itemId}`).then(setItem).catch(setError);
  useEffect(() => { if (sp.get('item')) loadItem(sp.get('item')); }, [sp]);
  useEffect(() => {
    if (!f.warehouse_id && warehouses.length) setF((x) => ({ ...x, warehouse_id: (warehouses.find((w) => w.is_primary) || warehouses[0]).id }));
  }, [warehouses, f.warehouse_id]);
  const [compStock, setCompStock] = useState({});
  useEffect(() => {
    if (!item || !f.warehouse_id) return;
    Promise.all(item.components.map((c) => api.get(`/items/${c.item_id}`))).then((its) => {
      setCompStock(Object.fromEntries(its.map((it) => [it.id, it.warehouses.find((w) => w.warehouse_id === Number(f.warehouse_id))?.on_hand ?? 0])));
    });
  }, [item, f.warehouse_id]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post('/assemblies', { ...f, composite_item_id: item?.id });
      toast(f.kind === 'assemble' ? 'Items assembled' : 'Items disassembled');
      navigate(`/inventory/assemblies/${r.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const compositeOnHand = item?.warehouses.find((w) => w.warehouse_id === Number(f.warehouse_id))?.on_hand ?? 0;
  return (
    <div className="page narrow">
      <BackLink to="/inventory/assemblies">Assemblies</BackLink>
      <PageHead title="New Assembly" />
      <ErrorBox error={error} />
      <div className="card mb"><div className="card-body grid-2">
        <Field label="Composite item" required>
          <ItemPicker value={item?.id} valueLabel={item?.name} params={{ composite: 'true' }} onSelect={(it) => loadItem(it.id)} placeholder="Select a composite item" />
        </Field>
        <Field label="Type">
          <div className="radio-group">
            {[['assemble', 'Assemble (build kits)'], ['disassemble', 'Disassemble (break kits)']].map(([v, l]) => (
              <label key={v} className="checkbox"><input type="radio" checked={f.kind === v} onChange={() => setF({ ...f, kind: v })} />{l}</label>
            ))}
          </div>
        </Field>
        <Field label="Quantity" required><Input type="number" min="0.001" step="any" value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} /></Field>
        <Field label="Date"><Input type="date" value={f.assembly_date} onChange={(v) => setF({ ...f, assembly_date: v })} /></Field>
        <Field label="Warehouse"><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
      </div></div>
      {item && (
        <div className="card mb">
          <div className="card-head"><h3>{f.kind === 'assemble' ? 'Components that will be used' : 'Components that will be recovered'}</h3><span className="small muted">{item.name} on hand here: {qty(compositeOnHand)}</span></div>
          <table className="table">
            <thead><tr><th>Component</th><th className="num">Per unit</th><th className="num">Required</th><th className="num">On hand</th></tr></thead>
            <tbody>{item.components.map((c) => {
              const need = Number(c.quantity) * Number(f.quantity || 0);
              const have = compStock[c.item_id];
              return (
                <tr key={c.item_id}><td>{c.name}</td><td className="num">{qty(c.quantity)}</td><td className="num bold">{qty(need)}</td>
                  <td className="num" style={{ color: f.kind === 'assemble' && c.track_inventory && have !== undefined && have < need ? 'var(--red)' : undefined }}>{c.track_inventory ? qty(have ?? 0) : 'Not tracked'}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !item} onClick={save}>{f.kind === 'assemble' ? 'Assemble' : 'Disassemble'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </div>
  );
}

export function AssemblyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const { data: a, error } = useApi(`/assemblies/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!a) return <div className="page"><Spinner /></div>;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${a.number}? Its stock movements will be reversed.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/assemblies/${a.id}`), 'Assembly deleted')) !== undefined) navigate('/inventory/assemblies');
  };
  return (
    <div className="page narrow">
      <PageHead title={`Assembly ${a.number}`} crumb={<Link to="/inventory/assemblies">Assemblies</Link>}>
        {can('inventory', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body"><dl className="kv">
        <dt>Type</dt><dd>{a.kind === 'assemble' ? 'Assemble' : 'Disassemble'}</dd>
        <dt>Composite item</dt><dd><Link to={`/items/${a.composite_item_id}`}>{a.item_name}</Link></dd>
        <dt>Quantity</dt><dd>{qty(a.quantity)} {a.item_unit}</dd><dt>Date</dt><dd>{date(a.assembly_date)}</dd>
        <dt>Warehouse</dt><dd>{a.warehouse_name}</dd><dt>Total cost</dt><dd>{money(a.total_cost)}</dd>
        {a.notes && <><dt>Notes</dt><dd>{a.notes}</dd></>}
        <dt>Created by</dt><dd>{a.created_by_name}</dd>
      </dl></div></div>
      <div className="card"><div className="card-head"><h3>Stock movements</h3></div><table className="table">
        <thead><tr><th>Item</th><th className="num">Quantity</th><th className="num">Value</th></tr></thead>
        <tbody>{a.movements.map((m, i) => <tr key={i}><td><Link to={`/items/${m.item_id}`}>{m.item_name}</Link></td>
          <td className="num" style={{ color: m.quantity < 0 ? 'var(--red)' : 'var(--green)' }}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)}</td><td className="num">{money(m.value)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
