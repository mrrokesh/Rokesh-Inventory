import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../api';
import { useAuth } from '../auth';
import { useLookups } from '../lib/lookups';
import { addressLines, baseCurrency, date, modeLabel, money, today, PAYMENT_MODES } from '../lib/format';
import DataTable from '../components/DataTable';
import { ContactPicker } from '../components/Pickers';
import { Attachments, History } from '../components/Attachments';
import { BackLink, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const cfgOf = (kind) => (kind === 'received'
  ? { kind, api: '/payments-received', path: '/payments-received', title: 'Payments Received', one: 'Payment Received', perm: 'payments_received', entity: 'payments_received',
    contactType: 'customer', docApi: '/invoices', docPath: '/invoices', docLabel: 'Invoice', docParam: 'invoice' }
  : { kind, api: '/payments-made', path: '/payments-made', title: 'Payments Made', one: 'Payment Made', perm: 'payments_made', entity: 'payments_made',
    contactType: 'vendor', docApi: '/bills', docPath: '/bills', docLabel: 'Bill', docParam: 'bill' });

export function PaymentsList({ kind }: any) {
  const c = cfgOf(kind);
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title={c.title}>{can(c.perm, 'create') && <Link className="btn primary" to={`${c.path}/new`}>+ New</Link>}</PageHead>
      <DataTable endpoint={c.api} rowLink={(r) => `${c.path}/${r.id}`} exportName={c.perm}
        filters={[{ key: 'mode', label: 'Mode', options: [['', 'All modes'], ...PAYMENT_MODES] }]}
        emptyTitle={`No ${c.title.toLowerCase()} yet`}
        emptyAction={can(c.perm, 'create') && <Link className="btn primary" to={`${c.path}/new`}>+ Record a payment</Link>}
        columns={[
          { key: 'payment_date', label: 'Date', sort: 'date', render: (r) => date(r.payment_date) },
          { key: 'number', label: 'Payment#', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          { key: 'reference', label: 'Reference#' },
          { key: 'contact_name', label: c.contactType === 'customer' ? 'Customer' : 'Vendor', sort: 'contact' },
          { key: 'applied_to', label: `${c.docLabel}#` },
          { key: 'mode', label: 'Mode', render: (r) => modeLabel(r.mode) },
          { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (r) => money(r.amount, { currency: r.currency }) },
          { key: 'unused_amount', label: 'Unused', num: true, render: (r) => money(r.unused_amount, { currency: r.currency }) },
        ]} />
    </div>
  );
}

export function PaymentForm({ kind }: any) {
  const c = cfgOf(kind);
  const { id } = useParams();
  const editing = !!id;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [contact, setContact] = useState(null);
  const [f, setF] = useState<any>({ number: '', payment_date: today(), amount: '', mode: 'bank_transfer', reference: '', bank_charges: '', notes: '', exchange_rate: null });
  const [docs, setDocs] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<any>({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const contactApi = c.contactType === 'customer' ? '/customers' : '/vendors';
  // Payments are in the contact's currency; a foreign currency needs today's exchange rate.
  const payCurrency = (contact?.currency || baseCurrency()).toUpperCase();
  const foreign = payCurrency !== baseCurrency();
  const pm = (v, o: any = {}) => money(v, { ...o, currency: payCurrency });
  const [rate, setRate] = useState('');
  useEffect(() => {
    if (!foreign) { setRate(''); return; }
    if (editing && Number(f.exchange_rate) > 0 && Number(f.exchange_rate) !== 1) { setRate(String(f.exchange_rate)); return; }
    api.get('/currencies').then((r) => { const x = r.currencies.find((y) => y.code === payCurrency); setRate(x ? String(Number(x.exchange_rate)) : ''); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payCurrency, foreign]);

  const loadDocs = async (contactId: any, current: any[] = []) => {
    const r: any = await api.get(c.docApi, { contact_id: contactId, status: 'unpaid', per_page: 200, sort: 'date', dir: 'asc' });
    const map = new Map<any, any>(r.data.map((d: any) => [d.id, { ...d }]));
    for (const a of current) {
      const d = map.get(a.doc_id);
      if (d) d.balance += a.amount; else map.set(a.doc_id, { id: a.doc_id, number: a.doc_number, doc_date: a.doc_date, due_date: a.due_date, total: a.doc_total, balance: a.doc_balance + a.amount });
    }
    setDocs([...map.values()].sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date))));
  };

  useEffect(() => {
    (async () => {
      try {
        if (editing) {
          const p = await api.get(`${c.api}/${id}`);
          setContact({ id: p.contact_id, display_name: p.contact_name, currency: p.currency });
          setF({ number: p.number, payment_date: p.payment_date, amount: p.amount, mode: p.mode, reference: p.reference || '', bank_charges: p.bank_charges || '', notes: p.notes || '', exchange_rate: p.exchange_rate });
          setAlloc(Object.fromEntries(p.allocations.map((a) => [a.doc_id, a.amount])));
          await loadDocs(p.contact_id, p.allocations);
        } else {
          const n = await api.get(`${c.api}/next-number`);
          setF((x) => ({ ...x, number: n.number }));
          if (sp.get('contact')) {
            const ct = await api.get(`${contactApi}/${sp.get('contact')}`);
            setContact(ct);
            await loadDocs(ct.id);
            const docId = sp.get(c.docParam);
            if (docId) {
              const d = await api.get(`${c.docApi}/${docId}`);
              setAlloc({ [d.id]: d.balance });
              setF((x) => ({ ...x, amount: d.balance }));
            }
          }
        }
      } catch (err) { setError(err); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pickContact = async (ct) => { setContact(ct); setAlloc({}); await loadDocs(ct.id); };
  const allocated = (Object.values(alloc) as any[]).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(f.amount || 0);
  const autoApply = () => {
    let left = amount;
    const next = {};
    for (const d of docs) {
      if (left <= 0) break;
      const v = Math.min(left, d.balance);
      next[d.id] = Math.round(v * 100) / 100;
      left -= v;
    }
    setAlloc(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (!contact) throw new Error(`Select a ${c.contactType}`);
      if (foreign && !(Number(rate) > 0)) throw new Error(`Enter the exchange rate for ${payCurrency}`);
      const body = { ...f, exchange_rate: foreign ? Number(rate) : null, contact_id: contact.id, allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([docId, v]) => ({ doc_id: Number(docId), amount: v })) };
      const saved = editing ? await api.put(`${c.api}/${id}`, body) : await api.post(c.api, body);
      toast(`Payment ${saved.number} recorded`);
      navigate(`${c.path}/${saved.id}`);
    } catch (err) { setError(err); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };
  if (loading) return <div className="page"><Spinner /></div>;
  return (
    <form onSubmit={submit}>
      <div className="page narrow">
        <BackLink to={c.path}>{c.title}</BackLink>
        <PageHead title={editing ? `Edit payment ${f.number}` : `Record ${c.one}`} />
        <ErrorBox error={error} />
        <div className="card mb"><div className="card-body">
          <div className="grid-3">
            <Field label={c.contactType === 'customer' ? 'Customer name' : 'Vendor name'} required>
              <ContactPicker type={c.contactType} value={contact?.id} valueLabel={contact?.display_name} disabled={editing} onSelect={pickContact} autoFocus={!contact} />
            </Field>
            <Field label={`${c.kind === 'received' ? 'Amount received' : 'Payment made'}${foreign ? ` (${payCurrency})` : ''}`} required>
              <Input type="number" min="0.01" step="0.01" required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            </Field>
            {foreign && (
              <Field label={`Exchange rate (${payCurrency})`} required hint={`How many ${baseCurrency()} you got for 1 ${payCurrency}`}>
                <div className="row" style={{ gap: 6 }}><span className="small nowrap">1 {payCurrency} =</span><Input type="number" min="0.000001" step="any" value={rate} onChange={setRate} required /><span className="small">{baseCurrency()}</span></div>
              </Field>
            )}
            {c.kind === 'received' && <Field label="Bank charges (if any)"><Input type="number" min="0" step="0.01" value={f.bank_charges} onChange={(v) => setF({ ...f, bank_charges: v })} /></Field>}
            <Field label="Payment date" required><Input type="date" required value={f.payment_date} onChange={(v) => setF({ ...f, payment_date: v })} /></Field>
            <Field label="Payment#"><Input value={f.number} onChange={(v) => setF({ ...f, number: v })} disabled={editing} /></Field>
            <Field label="Payment mode"><Select value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={PAYMENT_MODES} /></Field>
            <Field label="Reference#" hint="UTR, cheque number, transaction ID"><Input value={f.reference} onChange={(v) => setF({ ...f, reference: v })} /></Field>
          </div>
        </div></div>
        {contact && (
          <div className="card mb">
            <div className="card-head"><h3>Unpaid {c.docLabel.toLowerCase()}s</h3>{docs.length > 0 && amount > 0 && <button type="button" className="btn sm" onClick={autoApply}>Apply amount automatically</button>}</div>
            {docs.length === 0 ? <div className="faint" style={{ padding: 16 }}>No unpaid {c.docLabel.toLowerCase()}s. The full amount will be kept as an unused credit / advance.</div> : (
              <table className="table">
                <thead><tr><th>Date</th><th>{c.docLabel}#</th><th>Due date</th><th className="num">Amount</th><th className="num">Amount due</th><th className="num" style={{ width: 160 }}>Payment</th></tr></thead>
                <tbody>{docs.map((d) => (
                  <tr key={d.id}><td>{date(d.doc_date)}</td><td>{d.number}</td><td>{date(d.due_date)}</td><td className="num">{pm(d.total)}</td><td className="num">{pm(d.balance)}</td>
                    <td><input className="input num" type="number" min="0" max={d.balance} step="0.01" value={alloc[d.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} />
                      <button type="button" className="btn link small" onClick={() => setAlloc({ ...alloc, [d.id]: d.balance })}>Pay in full</button></td></tr>
                ))}</tbody>
              </table>
            )}
            <div className="totals" style={{ margin: 16, marginLeft: 'auto' }}>
              <div className="t-row"><span>Amount {c.kind === 'received' ? 'received' : 'paid'}</span><span>{pm(amount)}</span></div>
              <div className="t-row"><span>Amount used for payments</span><span>{pm(allocated)}</span></div>
              <div className="t-row grand"><span>Amount in excess</span><span style={{ color: amount - allocated < 0 ? 'var(--red)' : undefined }}>{pm(amount - allocated)}</span></div>
            </div>
          </div>
        )}
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(v) => setF({ ...f, notes: v })} /></Field>
      </div>
      <div className="form-footer">
        <button className="btn primary" disabled={busy || allocated > amount + 0.004}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

export function PaymentDetail({ kind }: any) {
  const c = cfgOf(kind);
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { organization: org } = useLookups('organization');
  const [, run] = useAction(toast);
  const { data: p, error } = useApi(`${c.api}/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!p) return <div className="page"><Spinner /></div>;
  const pm = (v, o: any = {}) => money(v, { ...o, currency: p.currency });
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete payment ${p.number}? The ${c.docLabel.toLowerCase()}s it paid will become unpaid again.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`${c.api}/${p.id}`), 'Payment deleted')) !== undefined) navigate(c.path);
  };
  return (
    <div className="page narrow">
      <PageHead title={`Payment ${p.number}`} crumb={<Link to={c.path}>{c.title}</Link>}>
        {can(c.perm, 'edit') && <Link className="btn" to={`${c.path}/${p.id}/edit`}>Edit</Link>}
        <button type="button" className="btn" onClick={() => window.print()}>Print receipt</button>
        {can(c.perm, 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="doc-paper mb">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div>
            {org?.logo_path && <img src={mediaUrl(org.logo_path)} alt="" style={{ maxHeight: 50 }} />}
            <div className="bold">{org?.legal_name || org?.name}</div>
            {addressLines(org?.address).map((l) => <div key={l} className="small muted">{l}</div>)}
          </div>
          <div className="spacer" />
          <div className="doc-title">{c.kind === 'received' ? 'Payment Receipt' : 'Payment Voucher'}</div>
        </div>
        <div className="grid-2 mt" style={{ marginTop: 24 }}>
          <dl className="kv">
            <dt>Payment date</dt><dd>{date(p.payment_date)}</dd>
            <dt>Payment#</dt><dd>{p.number}</dd>
            <dt>Reference#</dt><dd>{p.reference || '—'}</dd>
            <dt>Payment mode</dt><dd>{modeLabel(p.mode)}</dd>
            {p.currency && p.currency !== baseCurrency() && <><dt>Exchange rate</dt><dd>1 {p.currency} = {Number(p.exchange_rate)} {baseCurrency()} <span className="small faint">({money(Number(p.amount) * Number(p.exchange_rate))})</span></dd></>}
            {p.bank_charges > 0 && <><dt>Bank charges</dt><dd>{pm(p.bank_charges)}</dd></>}
          </dl>
          <div className="card" style={{ background: 'var(--green)', color: '#fff', padding: 18, textAlign: 'center' }}>
            <div className="small">Amount {c.kind === 'received' ? 'received' : 'paid'}</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{pm(p.amount)}</div>
          </div>
        </div>
        <div className="mt"><div className="small muted">{c.kind === 'received' ? 'Received from' : 'Paid to'}</div>
          <div className="bold"><Link to={`/${c.contactType}s/${p.contact_id}`}>{p.contact_name}</Link></div>
          {addressLines(p.contact_billing_address).map((l) => <div key={l} className="small">{l}</div>)}</div>
        <table className="table mt">
          <thead><tr><th>{c.docLabel}#</th><th>{c.docLabel} date</th><th className="num">{c.docLabel} amount</th><th className="num">Payment amount</th></tr></thead>
          <tbody>
            {p.allocations.length === 0 && <tr><td colSpan={4} className="faint">Not applied to any {c.docLabel.toLowerCase()}.</td></tr>}
            {p.allocations.map((a) => <tr key={a.id}><td><Link to={`${c.docPath}/${a.doc_id}`}>{a.doc_number}</Link></td><td>{date(a.doc_date)}</td><td className="num">{pm(a.doc_total)}</td><td className="num">{pm(a.amount)}</td></tr>)}
          </tbody>
        </table>
        {p.unused_amount > 0 && <div className="mt right">Amount in excess (unused credit): <strong>{pm(p.unused_amount)}</strong></div>}
        {Number(p.fx_gain) !== 0 && <div className="mt right small">Exchange {Number(p.fx_gain) > 0 ? 'gain' : 'loss'} on this payment (the rate differs from the {c.kind === 'received' ? 'invoices' : 'bills'}): <strong style={{ color: Number(p.fx_gain) > 0 ? 'var(--green)' : 'var(--danger, #d33)' }}>{money(Math.abs(p.fx_gain))}</strong></div>}
        {p.notes && <div className="mt small muted" style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</div>}
      </div>
      <div className="stack">
        <Attachments entityType={c.entity} entityId={p.id} />
        <History entityType={c.entity === 'payments_received' ? 'payments_received' : 'payments_made'} entityId={p.id} />
      </div>
    </div>
  );
}
