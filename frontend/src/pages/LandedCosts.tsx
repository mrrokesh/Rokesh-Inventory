import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { date, money, qty, today } from '../lib/format';
import DataTable from '../components/DataTable';
import { Combobox } from '../components/Pickers';
import { BackLink, Badge, ErrorBox, Field, Input, PageHead, Select, Spinner, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const METHODS = [
  ['value', 'By value — costlier goods carry more (most common)'],
  ['quantity', 'By quantity — the same amount per unit'],
  ['weight', 'By weight — heavier goods carry more (uses item weights)'],
  ['manual', 'Enter amounts myself'],
];
const SOURCE_LABEL = { purchase_receive: 'Purchase receive', bill: 'Bill' };
const sourcePath = (t, id) => (t === 'bill' ? `/bills/${id}` : `/purchase-receives/${id}`);

/** Same split as the server: proportional, last line absorbs rounding. */
function preview(lots, amount, method, manual) {
  if (method === 'manual') return lots.map((l) => Number(manual[l.lot_id]) || 0);
  const basis = lots.map((l) => (method === 'quantity' ? l.quantity : method === 'value' ? l.base_value : (Number(l.weight_kg) || 0) * l.quantity));
  const total = basis.reduce((s, v) => s + v, 0);
  if (!total || !amount) return lots.map(() => 0);
  const out = basis.map((b) => Math.round(((amount * b) / total) * 100) / 100);
  const diff = Math.round((amount - out.reduce((s, v) => s + v, 0)) * 100) / 100;
  const last = basis.map((b, i) => (b > 0 ? i : -1)).filter((i) => i >= 0).pop();
  if (last !== undefined) out[last] = Math.round((out[last] + diff) * 100) / 100;
  return out;
}

export function LandedCostsList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Landed Costs">
        {can('bills', 'create') && <Link className="btn primary" to="/landed-costs/new">+ New landed cost</Link>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>Add freight, customs duty, insurance or handling charges to the cost of the goods they brought in, so stock value and profit show what the goods really cost you.</p>
      <DataTable endpoint="/landed-costs" rowLink={(r) => `/landed-costs/${r.id}`} exportName="landed-costs"
        emptyTitle="No landed costs yet" emptyText="When you pay extra charges to bring goods in, add them here."
        filters={[{ key: 'status', label: 'Status', options: [['', 'All'], ['applied', 'Applied'], ['void', 'Void']] }]}
        columns={[
          { key: 'cost_date', label: 'Date', sort: 'date', render: (r) => date(r.cost_date) },
          { key: 'number', label: 'Number', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'description', label: 'Description' },
          { key: 'bill_number', label: 'Charges bill' },
          { key: 'applied_to', label: 'Added to' },
          { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (r) => money(r.amount) },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.status === 'applied' ? 'active' : 'void'}>{r.status === 'applied' ? 'Applied' : 'Void'}</Badge> },
        ]} />
    </div>
  );
}

export function LandedCostForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ cost_date: today(), description: '', amount: '', method: 'value' });
  const [bill, setBill] = useState(null);
  const [sources, setSources] = useState([]);
  const [lots, setLots] = useState([]);
  const [manual, setManual] = useState({});
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const b = sp.get('bill');
    if (b) api.get(`/bills/${b}`).then((x) => { setBill(x); setF((y) => ({ ...y, amount: y.amount || x.total, description: y.description || `Charges on bill ${x.number}` })); }).catch(() => {});
    const src = sp.get('source');
    if (src) { const [t, i] = src.split(':'); addSource({ source_type: t, source_id: Number(i) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addSource(s) {
    if (sources.some((x) => x.source_type === s.source_type && x.source_id === s.source_id)) return;
    const ls = await api.get(`/landed-costs/sources/${s.source_type}/${s.source_id}/lots`);
    setSources((cur) => [...cur, { ...s, number: s.number || ls[0]?.source_number }]);
    setLots((cur) => [...cur, ...ls]);
  }
  const removeSource = (s) => {
    setSources((cur) => cur.filter((x) => !(x.source_type === s.source_type && x.source_id === s.source_id)));
    setLots((cur) => cur.filter((l) => !(l.source_type === s.source_type && l.source_id === s.source_id)));
  };

  const amount = Number(f.amount) || 0;
  const alloc = useMemo(() => preview(lots, amount, f.method, manual), [lots, amount, f.method, manual]);
  const allocated = alloc.reduce((s, v) => s + v, 0);
  const noWeights = f.method === 'weight' && lots.length > 0 && !lots.some((l) => Number(l.weight_kg) > 0);
  const save = async () => {
    const body = { ...f, amount, bill_id: bill?.id || null, sources: sources.map((s) => ({ source_type: s.source_type, source_id: s.source_id })), manual };
    const lc = await run(() => api.post('/landed-costs', body), 'Landed cost added');
    if (lc) navigate(`/landed-costs/${lc.id}`);
  };
  return (
    <div className="page">
      <BackLink to="/landed-costs">Landed Costs</BackLink>
      <PageHead title="New Landed Cost" />
      <div className="card mb"><div className="card-body">
        <div className="grid-3">
          <Field label="Charges bill (optional)" hint="The bill from the transporter, clearing agent or insurer. Leave empty to enter an amount only.">
            <Combobox value={bill?.id} valueLabel={bill ? `${bill.number} · ${bill.contact_name}` : ''} placeholder="Search bills"
              onSelect={async (b) => { const full = await api.get(`/bills/${b.id}`); setBill(full); setF((x) => ({ ...x, amount: x.amount || full.total, description: x.description || `Charges on bill ${full.number}` })); }}
              fetcher={(t) => api.get('/bills', { search: t, per_page: 20 }).then((r) => r.data.filter((b) => !['draft', 'void'].includes(b.status)))}
              renderOption={(b) => <div><div>{b.number} · {b.contact_name}</div><div className="small faint">{date(b.doc_date)} · {money(b.total)}</div></div>} />
            {bill && <button type="button" className="btn link small" onClick={() => setBill(null)}>Clear</button>}
          </Field>
          <Field label="Amount to add" required><Input type="number" min="0.01" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Date" required><Input type="date" value={f.cost_date} onChange={set('cost_date')} /></Field>
          <Field label="Description"><Input value={f.description} onChange={set('description')} placeholder="e.g. Sea freight and customs duty for shipment #12" /></Field>
          <Field label="How to split it"><Select value={f.method} onChange={set('method')} options={METHODS} /></Field>
        </div>
      </div></div>

      <div className="card mb">
        <div className="card-head"><h3>Goods this cost belongs to</h3></div>
        <div className="card-body">
          <div style={{ maxWidth: 420 }}>
            <Combobox placeholder="Search purchase receives or bills that brought stock in" onSelect={(s) => addSource(s)}
              fetcher={(t) => api.get('/landed-costs/sources', { search: t })}
              renderOption={(s) => <div><div>{SOURCE_LABEL[s.source_type]} {s.number} · {s.vendor_name}</div><div className="small faint">{date(s.doc_date)} · {qty(s.qty)} units · {money(s.value)}</div></div>} />
          </div>
          {sources.length > 0 && (
            <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
              {sources.map((s) => <span key={`${s.source_type}${s.source_id}`} className="badge blue">{SOURCE_LABEL[s.source_type]} {s.number} <button type="button" className="btn link small" onClick={() => removeSource(s)} aria-label="Remove">✕</button></span>)}
            </div>
          )}
        </div>
        {lots.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Item</th><th>From</th><th>Warehouse</th><th className="num">Qty received</th><th className="num">Still in stock</th><th className="num">Value</th>{f.method === 'weight' && <th className="num">Weight (kg)</th>}<th className="num">Landed cost</th><th className="num">New unit cost</th></tr></thead>
            <tbody>
              {lots.map((l, i) => (
                <tr key={l.lot_id}>
                  <td>{l.item_name}{l.sku && <span className="small faint"> · {l.sku}</span>}</td>
                  <td className="small">{l.source_number}</td>
                  <td className="small">{l.warehouse_name}</td>
                  <td className="num">{qty(l.quantity)}</td>
                  <td className="num">{qty(l.qty_remaining)}</td>
                  <td className="num">{money(l.base_value)}</td>
                  {f.method === 'weight' && <td className="num">{l.weight_kg ? Number(l.weight_kg) * l.quantity : '—'}</td>}
                  <td className="num">
                    {f.method === 'manual'
                      ? <input className="input num" style={{ width: 110 }} type="number" min="0" step="0.01" value={manual[l.lot_id] ?? ''} onChange={(e) => setManual((m) => ({ ...m, [l.lot_id]: e.target.value }))} />
                      : money(alloc[i])}
                  </td>
                  <td className="num">{money(l.unit_cost + (alloc[i] || 0) / l.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={f.method === 'weight' ? 7 : 6} className="right bold">Total allocated</td><td className="num bold" style={{ color: Math.abs(allocated - amount) > 0.005 ? 'var(--danger, #d33)' : undefined }}>{money(allocated)}</td><td /></tr></tfoot>
          </table></div>
        )}
      </div>
      {noWeights && <div className="warn-box mb">None of these items has a weight. Add the weight on each item, or choose another way to split.</div>}
      {lots.some((l) => l.qty_remaining < l.quantity) && (
        <div className="info-box mb">Some of these goods have already been sold or used. Their share of the cost can’t go into stock any more, so it is shown as <b>already used</b> on the landed cost (it belongs in your cost of sales).</div>
      )}
      <div className="form-footer">
        <button type="button" className="btn primary" disabled={busy || !amount || !lots.length || noWeights} onClick={save}>{busy ? 'Saving…' : 'Add landed cost'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </div>
  );
}

export function LandedCostDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data: lc, error, reload } = useApi(`/landed-costs/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!lc) return <div className="page"><Spinner /></div>;
  const voidIt = async () => {
    if (!(await confirmDialog({ message: `Void ${lc.number}? The ${money(lc.amount)} is taken back out of the stock cost. Only possible if none of that stock has been used since.`, danger: true, confirmText: 'Void' }))) return;
    if (await run(() => api.post(`/landed-costs/${lc.id}/void`), 'Landed cost voided')) reload();
  };
  return (
    <div className="page narrow">
      <PageHead title={`Landed Cost ${lc.number}`} crumb={<Link to="/landed-costs">Landed Costs</Link>}>
        {lc.status === 'applied' && can('bills', 'edit') && <button type="button" className="btn danger" disabled={busy} onClick={voidIt}>Void</button>}
      </PageHead>
      {lc.status === 'void' && <div className="warn-box mb">This landed cost is void. It no longer affects stock cost.</div>}
      <div className="grid-3 mb">
        <div className="card stat"><div className="label">Total cost</div><div className="value sm">{money(lc.amount)}</div></div>
        <div className="card stat"><div className="label">Added to stock on hand</div><div className="value sm">{money(lc.applied_to_stock)}</div></div>
        <div className="card stat"><div className="label">Already used (cost of sales)</div><div className="value sm">{money(lc.expensed)}</div></div>
      </div>
      <div className="card mb"><div className="card-body">
        <dl className="kv">
          <dt>Date</dt><dd>{date(lc.cost_date)}</dd>
          {lc.description && <><dt>Description</dt><dd>{lc.description}</dd></>}
          <dt>Charges bill</dt><dd>{lc.bill_id ? <Link to={`/bills/${lc.bill_id}`}>{lc.bill_number}</Link> : '—'}{lc.bill_vendor && <span className="faint"> · {lc.bill_vendor}</span>}</dd>
          <dt>Split</dt><dd>{METHODS.find((m) => m[0] === lc.method)?.[1].split(' — ')[0]}</dd>
          <dt>Status</dt><dd><Badge status={lc.status === 'applied' ? 'active' : 'void'}>{lc.status === 'applied' ? 'Applied' : 'Void'}</Badge></dd>
          <dt>Recorded by</dt><dd>{lc.created_by_name}</dd>
        </dl>
      </div></div>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Item</th><th>Added to</th><th>Warehouse</th><th className="num">Qty</th><th className="num">Value before</th><th className="num">Landed cost</th><th className="num">Per unit</th></tr></thead>
        <tbody>
          {lc.lines.map((l) => (
            <tr key={l.id}>
              <td><Link to={`/items/${l.item_id}`}>{l.item_name}</Link></td>
              <td><Link to={sourcePath(l.source_type, l.source_id)}>{l.source_number}</Link></td>
              <td>{l.warehouse_name}</td>
              <td className="num">{qty(l.quantity)}</td>
              <td className="num">{money(l.base_value)}</td>
              <td className="num bold">{money(l.amount)}</td>
              <td className="num">+{money(l.per_unit)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
