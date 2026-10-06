import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useLookups } from '../../lib/lookups';
import { date, money, qty, today, PAYMENT_MODES } from '../../lib/format';
import { Checkbox, Field, Input, Modal, Select, Textarea, useAction } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { TrackingButton, TrackingModal } from '../../components/Tracking';

/** Per-line serial/batch state for the quantity dialogs. */
function useLineTracking() {
  const [tracking, setTracking] = useState({});
  const [editing, setEditing] = useState(null);
  return { tracking, setTracking, editing, setEditing };
}

/** Quantity picker table shared by package / receive / return dialogs. */
function QtyTable({ rows, values, setValues, maxLabel, extra }: any) {
  return (
    <table className="table compact">
      <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">{maxLabel}</th><th className="num" style={{ width: 130 }}>Quantity</th>{extra && <th>{extra.label}</th>}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.item_name}<div className="small faint">{r.item_sku}</div></td>
            <td className="num">{qty(r.quantity)}</td>
            <td className="num">{qty(r.max)}</td>
            <td><input className="input num" type="number" min="0" max={r.max} step="any" value={values[r.id] ?? ''} onChange={(e) => setValues({ ...values, [r.id]: e.target.value })} /></td>
            {extra && <td>{extra.render(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PackageModal({ so, onClose, onDone }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const rows = so.lines.filter((l) => l.item_id && l.item_type === 'goods').map((l) => ({ ...l, max: Math.max(0, l.quantity - l.qty_packed) })).filter((l) => l.max > 0);
  const [values, setValues] = useState(Object.fromEntries(rows.map((r) => [r.id, r.max])));
  const [f, setF] = useState({ package_date: today(), notes: '', length_cm: '', width_cm: '', height_cm: '', weight_kg: '' });
  const t = useLineTracking();
  const anyTracked = rows.some((r) => r.item_tracking && r.item_tracking !== 'none');
  const save = async () => {
    const pkg = await run(() => api.post('/packages', { sales_order_id: so.id, ...f, lines: rows.map((r) => ({ so_line_id: r.id, quantity: values[r.id] || 0, tracking: t.tracking[r.id] || null })) }), 'Package created');
    if (pkg) onDone(pkg);
  };
  return (
    <Modal wide title={`New package for ${so.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !rows.length} onClick={save}>Create package</button></>}>
      {!rows.length ? <div className="faint">Everything on this order has been packed.</div> : (
        <>
          <div className="grid-3 mb">
            <Field label="Package date"><Input type="date" value={f.package_date} onChange={(v) => setF({ ...f, package_date: v })} /></Field>
            <Field label="Dimensions L×W×H (cm)"><div className="row"><Input type="number" min="0" value={f.length_cm} onChange={(v) => setF({ ...f, length_cm: v })} /><Input type="number" min="0" value={f.width_cm} onChange={(v) => setF({ ...f, width_cm: v })} /><Input type="number" min="0" value={f.height_cm} onChange={(v) => setF({ ...f, height_cm: v })} /></div></Field>
            <Field label="Weight (kg)"><Input type="number" min="0" step="any" value={f.weight_kg} onChange={(v) => setF({ ...f, weight_kg: v })} /></Field>
          </div>
          <QtyTable rows={rows} values={values} setValues={setValues} maxLabel="To pack"
            extra={anyTracked ? { label: 'Serial / batch', render: (r) => <TrackingButton mode={r.item_tracking} direction="out" value={t.tracking[r.id]} onClick={() => t.setEditing(r)} /> } : null} />
          <Field label="Internal notes" className="mt"><Textarea rows={2} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
          {t.editing && <TrackingModal itemId={t.editing.item_id} itemName={t.editing.item_name} mode={t.editing.item_tracking} direction="out" quantity={values[t.editing.id]}
            warehouseId={so.warehouse_id} value={t.tracking[t.editing.id]} onClose={() => t.setEditing(null)}
            onSave={(v) => { t.setTracking({ ...t.tracking, [t.editing.id]: v }); t.setEditing(null); }} />}
        </>
      )}
    </Modal>
  );
}

export function ShipModal({ pkg, onClose, onDone }: any) {
  const toast = useToast();
  const { carriers } = useLookups('carriers');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ ship_date: today(), carrier: '', service_type: '', tracking_number: '', shipping_cost: '', estimated_delivery: '', notes: '', delivered: false });
  const save = async () => {
    const r = await run(() => api.post(`/packages/${pkg.id}/ship`, f), 'Package shipped and stock updated');
    if (r) onDone(r);
  };
  return (
    <Modal title={`Ship package ${pkg.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ship</button></>}>
      <div className="grid-2">
        <Field label="Shipment date" required><Input type="date" value={f.ship_date} onChange={(v) => setF({ ...f, ship_date: v })} /></Field>
        <Field label="Carrier">
          <input className="input" list="carrier-list" value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} />
          <datalist id="carrier-list">{carriers.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <Field label="Tracking number"><Input value={f.tracking_number} onChange={(v) => setF({ ...f, tracking_number: v })} /></Field>
        <Field label="Service type"><Input value={f.service_type} onChange={(v) => setF({ ...f, service_type: v })} placeholder="e.g. Surface, Express" /></Field>
        <Field label="Shipping cost"><Input type="number" min="0" step="0.01" value={f.shipping_cost} onChange={(v) => setF({ ...f, shipping_cost: v })} /></Field>
        <Field label="Estimated delivery"><Input type="date" value={f.estimated_delivery} onChange={(v) => setF({ ...f, estimated_delivery: v })} /></Field>
      </div>
      <Field label="Notes" className="mt"><Textarea rows={2} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
      <div className="mt"><Checkbox checked={f.delivered} onChange={(v) => setF({ ...f, delivered: v })}>Already delivered</Checkbox></div>
      <div className="info-box mt small">Shipping removes the packed items from stock in {pkg.warehouse_name}.</div>
    </Modal>
  );
}

export function ReceiveModal({ po, onClose, onDone }: any) {
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [busy, run] = useAction(toast);
  const rows = po.lines.filter((l) => l.item_id && l.item_type === 'goods').map((l) => ({ ...l, max: Math.max(0, l.quantity - l.qty_received) })).filter((l) => l.max > 0);
  const [values, setValues] = useState(Object.fromEntries(rows.map((r) => [r.id, r.max])));
  const [f, setF] = useState({ receive_date: today(), warehouse_id: po.warehouse_id, notes: '' });
  const t = useLineTracking();
  const anyTracked = rows.some((r) => r.item_tracking && r.item_tracking !== 'none');
  const save = async () => {
    const r = await run(() => api.post('/purchase-receives', { purchase_order_id: po.id, ...f, lines: rows.map((x) => ({ po_line_id: x.id, quantity: values[x.id] || 0, tracking: t.tracking[x.id] || null })) }), 'Items received into stock');
    if (r) onDone(r);
  };
  return (
    <Modal wide title={`Receive items for ${po.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !rows.length} onClick={save}>Receive</button></>}>
      {!rows.length ? <div className="faint">All goods on this purchase order have been received.</div> : (
        <>
          <div className="grid-2 mb">
            <Field label="Received date"><Input type="date" value={f.receive_date} onChange={(v) => setF({ ...f, receive_date: v })} /></Field>
            <Field label="Warehouse"><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
          </div>
          <QtyTable rows={rows} values={values} setValues={setValues} maxLabel="To receive"
            extra={anyTracked ? { label: 'Serial / batch', render: (r) => <TrackingButton mode={r.item_tracking} direction="in" required value={t.tracking[r.id]} onClick={() => t.setEditing(r)} /> } : null} />
          {t.editing && <TrackingModal itemId={t.editing.item_id} itemName={t.editing.item_name} mode={t.editing.item_tracking} direction="in" quantity={values[t.editing.id]}
            value={t.tracking[t.editing.id]} onClose={() => t.setEditing(null)}
            onSave={(v) => { t.setTracking({ ...t.tracking, [t.editing.id]: v }); t.setEditing(null); }} />}
          <Field label="Notes" className="mt"><Textarea rows={2} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
        </>
      )}
    </Modal>
  );
}

export function ReturnModal({ so, onClose, onDone }: any) {
  const toast = useToast();
  const { warehouses } = useLookups('warehouses');
  const [busy, run] = useAction(toast);
  const rows = so.lines.filter((l) => l.item_id).map((l) => ({ ...l, max: Math.max(0, l.qty_shipped - l.qty_returned) })).filter((l) => l.max > 0);
  const [values, setValues] = useState({});
  const [restock, setRestock] = useState(Object.fromEntries(rows.map((r) => [r.id, true])));
  const [f, setF] = useState({ return_date: today(), warehouse_id: so.warehouse_id, reason: '' });
  const save = async () => {
    const r = await run(() => api.post('/sales-returns', { sales_order_id: so.id, ...f, lines: rows.map((x) => ({ so_line_id: x.id, quantity: values[x.id] || 0, restock: restock[x.id] })) }), 'Sales return created');
    if (r) onDone(r);
  };
  return (
    <Modal wide title={`Sales return for ${so.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !rows.length} onClick={save}>Create return</button></>}>
      {!rows.length ? <div className="faint">Nothing has been shipped on this order yet, so nothing can be returned.</div> : (
        <>
          <div className="grid-3 mb">
            <Field label="Return date"><Input type="date" value={f.return_date} onChange={(v) => setF({ ...f, return_date: v })} /></Field>
            <Field label="Receive into"><Select value={f.warehouse_id} onChange={(v) => setF({ ...f, warehouse_id: Number(v) })} options={warehouses.filter((w) => w.status === 'active').map((w) => [w.id, w.name])} /></Field>
            <Field label="Reason"><Input value={f.reason} onChange={(v) => setF({ ...f, reason: v })} placeholder="e.g. Damaged in transit" /></Field>
          </div>
          <QtyTable rows={rows} values={values} setValues={setValues} maxLabel="Returnable"
            extra={{ label: 'Restock', render: (r) => <Checkbox checked={restock[r.id]} onChange={(v) => setRestock({ ...restock, [r.id]: v })}>Back to stock</Checkbox> }} />
          <div className="small faint mt">Untick "Back to stock" for damaged goods that should not return to inventory.</div>
        </>
      )}
    </Modal>
  );
}

/** Apply a credit (credit note / vendor credit) to open invoices / bills of the same contact. */
export function ApplyCreditModal({ credit, kind, onClose, onDone }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [docs, setDocs] = useState(null);
  const [values, setValues] = useState<any>({});
  const docApi = kind === 'credit_note' ? '/invoices' : '/bills';
  useEffect(() => {
    api.get(docApi, { contact_id: credit.contact_id, status: 'unpaid', per_page: 100, sort: 'date', dir: 'asc' }).then((r) => setDocs(r.data)).catch(() => setDocs([]));
  }, [docApi, credit.contact_id]);
  const total = (Object.values(values) as any[]).reduce((s, v) => s + Number(v || 0), 0);
  const save = async () => {
    const key = kind === 'credit_note' ? 'invoice_id' : 'bill_id';
    const api2 = kind === 'credit_note' ? `/credit-notes/${credit.id}/apply` : `/vendor-credits/${credit.id}/apply`;
    const r = await run(() => api.post(api2, { allocations: Object.entries(values).filter(([, v]) => Number(v) > 0).map(([id, amount]) => ({ [key]: Number(id), amount })) }), 'Credits applied');
    if (r) onDone(r);
  };
  return (
    <Modal wide title={`Apply credits from ${credit.number}`} onClose={onClose}
      footer={<><span className="muted" style={{ marginRight: 'auto' }}>Applying {money(total)} of {money(credit.balance)} available</span>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || total <= 0 || total > Number(credit.balance) + 0.004} onClick={save}>Apply</button></>}>
      {docs === null ? 'Loading…' : docs.length === 0 ? <div className="faint">There are no unpaid {kind === 'credit_note' ? 'invoices' : 'bills'} for {credit.contact_name}.</div> : (
        <table className="table compact">
          <thead><tr><th>Date</th><th>Number</th><th className="num">Amount</th><th className="num">Balance</th><th className="num" style={{ width: 150 }}>Amount to apply</th></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}><td>{date(d.doc_date)}</td><td>{d.number}</td><td className="num">{money(d.total)}</td><td className="num">{money(d.balance)}</td>
              <td><input className="input num" type="number" min="0" max={d.balance} step="0.01" value={values[d.id] ?? ''} onChange={(e) => setValues({ ...values, [d.id]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}

export function RefundModal({ cn, onClose, onDone }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ refund_date: today(), amount: cn.balance, mode: 'bank_transfer', reference: '' });
  const save = async () => {
    const r = await run(() => api.post(`/credit-notes/${cn.id}/refund`, f), 'Refund recorded');
    if (r) onDone(r);
  };
  return (
    <Modal title={`Refund from ${cn.number}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Record refund</button></>}>
      <div className="grid-2">
        <Field label="Date"><Input type="date" value={f.refund_date} onChange={(v) => setF({ ...f, refund_date: v })} /></Field>
        <Field label="Amount" hint={`Available: ${money(cn.balance)}`}><Input type="number" min="0.01" max={cn.balance} step="0.01" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label="Paid via"><Select value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={PAYMENT_MODES} /></Field>
        <Field label="Reference#"><Input value={f.reference} onChange={(v) => setF({ ...f, reference: v })} /></Field>
      </div>
    </Modal>
  );
}
