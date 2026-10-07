// Customer & vendor portal — what a customer or vendor sees at /portal/<org-slug>.
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { addressLines, date, dateTime, label, modeLabel, money, qty, INDIAN_STATES } from '../../lib/format';
import { Badge, EmptyState, ErrorBox, Field, Input, Select, Spinner, Textarea } from '../../components/ui';
import { API_BASE, mediaUrl } from '../../api';
import { APP_NAME, LOGO_SRC } from '../../brand';
import { useToast } from '../../components/Toast';

const KEY = (slug) => `inv_portal_${slug}`;
const getTok = (slug) => { try { return localStorage.getItem(KEY(slug)) || ''; } catch { return ''; } };
const setTok = (slug, t) => { try { if (t) localStorage.setItem(KEY(slug), t); else localStorage.removeItem(KEY(slug)); } catch { /* storage unavailable */ } };

function usePortalApi(slug: any, onUnauthorized?: any) {
  return useCallback(async (method: any, path: any, body?: any) => {
    const res = await fetch(`${API_BASE}/api/portal/${slug}${path}`, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(getTok(slug) ? { Authorization: `Bearer ${getTok(slug)}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    if (!res.ok) throw new Error(data?.error || 'Something went wrong');
    return data;
  }, [slug, onUnauthorized]);
}

function Shell({ org, children }: any) {
  return (
    <div className="auth-split">
      <div className="auth-pane">
        <div className="auth-card">
          <div className="auth-brand">
            <img src={org?.logo_path ? mediaUrl(org.logo_path) : LOGO_SRC} alt="" />
            <div>
              <div className="auth-app-name">{org?.name || APP_NAME}</div>
              <div className="auth-app-tag">Customer &amp; vendor portal</div>
            </div>
          </div>
          {children}
        </div>
      </div>
      <aside className="auth-hero">
        <img src={LOGO_SRC} alt={APP_NAME} />
        <p className="auth-hero-title">{APP_NAME}</p>
        <p className="auth-hero-tag">Orders, invoices and payments for your account.</p>
      </aside>
    </div>
  );
}

function Login({ slug, org, onIn }: any) {
  const call = usePortalApi(slug);
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const r = await call('POST', '/login', f); setTok(slug, r.token); onIn(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Shell org={org}>
      <form className="stack" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>Customers: see your orders, invoices and payments. Suppliers: see our purchase orders, your bills and payments.</p>
        <ErrorBox error={error} />
        <Field label="Email"><Input type="email" required autoFocus autoComplete="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small faint center">No password yet or forgot it? Ask {org?.name || 'us'} to send you a new portal invitation{org?.email ? ` (${org.email})` : ''}.</div>
      </form>
    </Shell>
  );
}

function Invite({ slug, org, onIn }: any) {
  const { token } = useParams();
  const call = usePortalApi(slug);
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState('');
  useEffect(() => { call('GET', `/invite/${token}`).then(setInfo).catch(setError); }, [call, token]);
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await call('POST', `/invite/${token}`, { password: pw }); setTok(slug, r.token); onIn(); navigate(`/portal/${slug}`); } catch (err) { setError(err); }
  };
  return (
    <Shell org={org}>
      <ErrorBox error={error} />
      {info && (
        <form className="stack" onSubmit={submit}>
          <p className="center" style={{ margin: 0 }}>Welcome, <strong>{info.display_name}</strong>. Choose a password to finish setting up your account ({info.email}).</p>
          <Field label="Choose a password" hint="At least 8 characters"><Input type="password" required minLength={8} autoFocus autoComplete="new-password" value={pw} onChange={setPw} /></Field>
          <button className="btn primary">Save and continue</button>
        </form>
      )}
      {error && <Link to={`/portal/${slug}`} className="btn mt">Go to sign in</Link>}
    </Shell>
  );
}

const KIND_LABEL = { invoices: 'Invoices', 'sales-orders': 'Orders', estimates: 'Quotes', 'credit-notes': 'Credit notes',
  'purchase-orders': 'Purchase orders', bills: 'Bills', 'vendor-credits': 'Credits' };
const CUSTOMER_KINDS = ['invoices', 'sales-orders', 'estimates', 'credit-notes'];
const VENDOR_KINDS = ['purchase-orders', 'bills', 'vendor-credits'];
const DOC_TITLE = { invoices: 'Invoice', 'sales-orders': 'Sales order', estimates: 'Estimate', 'credit-notes': 'Credit note', 'purchase-orders': 'Purchase order', bills: 'Bill', 'vendor-credits': 'Vendor credit' };
const today = () => new Date().toISOString().slice(0, 10);

function DocList({ call, slug, kind }: any) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { call('GET', `/docs/${kind}`).then(setRows).catch(setError); }, [call, kind]);
  if (error) return <ErrorBox error={error} />;
  if (!rows) return <Spinner />;
  if (!rows.length) return <EmptyState title={`No ${KIND_LABEL[kind].toLowerCase()} yet`} />;
  return (
    <div className="card"><table className="table">
      <thead><tr><th>Number</th><th>Date</th>{['invoices', 'bills'].includes(kind) && <th>Due</th>}{kind === 'estimates' && <th>Valid until</th>}{kind === 'purchase-orders' && <th>Delivery by</th>}<th>Status</th><th className="num">Amount</th>{['invoices', 'bills'].includes(kind) && <th className="num">Balance</th>}</tr></thead>
      <tbody>{rows.map((d) => (
        <tr key={d.id}>
          <td><Link to={`/portal/${slug}/${kind}/${d.id}`} className="bold">{d.number}</Link></td><td>{date(d.doc_date)}</td>
          {['invoices', 'bills'].includes(kind) && <td>{date(d.due_date)}</td>}{kind === 'estimates' && <td>{date(d.expiry_date) || '—'}</td>}{kind === 'purchase-orders' && <td>{date(d.expected_delivery_date) || '—'}</td>}
          <td>{kind === 'purchase-orders' && d.status === 'issued'
            ? <Badge status={d.vendor_response || 'pending'}>{d.vendor_response ? undefined : 'Awaiting your reply'}</Badge>
            : <Badge status={['invoices', 'bills'].includes(kind) && ['sent', 'open', 'partially_paid'].includes(d.status) && d.due_date < today() ? 'overdue' : ['sent', 'open'].includes(d.status) && ['invoices', 'bills'].includes(kind) ? 'unpaid' : d.status}>{d.status === 'sent' && kind === 'estimates' ? 'Awaiting your reply' : undefined}</Badge>}</td>
          <td className="num">{money(d.total, { currency: d.currency })}</td>{['invoices', 'bills'].includes(kind) && <td className="num">{money(d.balance, { currency: d.currency })}</td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function DocView({ call, slug, kind }: any) {
  const { id } = useParams();
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState({ expected_delivery_date: '', note: '' });
  const load = useCallback(() => call('GET', `/docs/${kind}/${id}`).then(setDoc).catch(setError), [call, kind, id]);
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!doc) return <Spinner />;
  const m = (v) => money(v, { currency: doc.currency });
  const vendor = VENDOR_KINDS.includes(kind);
  const answerPo = async (action) => {
    setBusy(true);
    try { await call('POST', `/docs/purchase-orders/${doc.id}/respond`, { action, ...answer }); toast(action === 'accept' ? 'Thank you — order accepted' : 'Order declined'); load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const respond = async (action) => {
    setBusy(true);
    try { await call('POST', `/docs/estimates/${doc.id}/respond`, { action }); toast(action === 'accept' ? 'Thank you — quote accepted' : 'Quote declined'); load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const pay = async () => {
    setBusy(true);
    try { const r = await call('POST', `/docs/invoices/${doc.id}/pay`); window.location.href = r.url; } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const send = async () => {
    if (!comment.trim()) return;
    try { await call('POST', `/docs/${kind}/${doc.id}/comments`, { body: comment }); setComment(''); load(); toast('Message sent'); } catch (e) { toast(e.message, 'error'); }
  };
  const inter = doc.place_of_supply && doc.org_state && doc.place_of_supply.toLowerCase() !== doc.org_state.toLowerCase();
  const taxes = new Map();
  for (const l of doc.lines) {
    if (!Number(l.tax_rate)) continue;
    const t = l.amount * (1 - doc.discount_percent / 100) * (l.tax_rate / 100);
    const parts = inter ? [[`IGST ${Number(l.tax_rate)}%`, t]] : [[`CGST ${l.tax_rate / 2}%`, t / 2], [`SGST ${l.tax_rate / 2}%`, t / 2]];
    for (const [k, v] of parts) taxes.set(k, (taxes.get(k) || 0) + v);
  }
  return (
    <div className="stack">
      <div className="row wrap">
        <Link to={`/portal/${slug}/${kind}`} className="small">← {KIND_LABEL[kind]}</Link>
        <span className="spacer" />
        {kind === 'estimates' && ['sent', 'declined'].includes(doc.status) && <button type="button" className="btn primary" disabled={busy} onClick={() => respond('accept')}>Accept quote</button>}
        {kind === 'estimates' && ['sent', 'accepted'].includes(doc.status) && <button type="button" className="btn" disabled={busy} onClick={() => respond('decline')}>Decline</button>}
        {doc.can_pay_online && <button type="button" className="btn primary" disabled={busy} onClick={pay}>{busy ? 'Opening…' : `Pay ${m(doc.balance)} online`}</button>}
        <button type="button" className="btn" onClick={() => window.print()}>Print / PDF</button>
      </div>
      {kind === 'purchase-orders' && doc.status === 'issued' && (
        <div className="card no-print"><div className="card-body stack">
          {doc.vendor_response
            ? <div>You <b>{doc.vendor_response}</b> this order on {dateTime(doc.vendor_response_at)}.{doc.vendor_response_note && <> Your note: “{doc.vendor_response_note}”</>} You can change your answer below.</div>
            : <div className="bold">Please confirm whether you can supply this order.</div>}
          <div className="grid-2">
            <Field label="Delivery date you can meet" hint="Optional — leave empty to keep the date we asked for."><Input type="date" value={answer.expected_delivery_date} onChange={(v) => setAnswer({ ...answer, expected_delivery_date: v })} /></Field>
            <Field label="Note to us (optional)"><Input value={answer.note} onChange={(v) => setAnswer({ ...answer, note: v })} placeholder="e.g. 2 items will come in a second lot" /></Field>
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => answerPo('accept')}>Accept order</button>
            <button type="button" className="btn" disabled={busy} onClick={() => answerPo('decline')}>Can't supply</button>
          </div>
        </div></div>
      )}
      <div className="doc-paper">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div><div className="doc-title">{DOC_TITLE[kind]}</div><div className="bold"># {doc.number}</div></div>
          <span className="spacer" />
          <div className="right"><Badge status={doc.status} />{['invoices', 'bills'].includes(kind) && doc.status !== 'paid' && <div className="mt"><div className="small muted">{kind === 'bills' ? 'Balance to be paid to you' : 'Balance due'}</div><div className="bold" style={{ fontSize: 20 }}>{m(doc.balance)}</div></div>}</div>
        </div>
        <div className="grid-2 mt">
          <div><div className="small muted">{vendor ? 'Supplier' : 'Bill to'}</div><div className="bold">{doc.contact_name}</div>{addressLines(doc.billing_address).map((l) => <div key={l} className="small">{l}</div>)}</div>
          <dl className="kv">
            <dt>Date</dt><dd>{date(doc.doc_date)}</dd>
            {doc.due_date && <><dt>Due date</dt><dd>{date(doc.due_date)}</dd></>}
            {doc.expiry_date && <><dt>Valid until</dt><dd>{date(doc.expiry_date)}</dd></>}
            {doc.reference && <><dt>Reference</dt><dd>{doc.reference}</dd></>}
            {doc.place_of_supply && <><dt>Place of supply</dt><dd>{doc.place_of_supply}</dd></>}
            {doc.expected_delivery_date && <><dt>Deliver by</dt><dd>{date(doc.expected_delivery_date)}</dd></>}
          </dl>
        </div>
        <table className="table mt">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
          <tbody>{doc.lines.map((l) => (
            <tr key={l.id}><td>{l.item_name || l.description}{l.item_name && l.description && <div className="small muted">{l.description}</div>}</td>
              <td className="num">{qty(l.quantity)} {l.item_unit || ''}</td><td className="num">{m(l.rate)}</td><td className="num">{m(l.amount)}</td></tr>
          ))}</tbody>
        </table>
        <div className="totals mt" style={{ background: 'none' }}>
          <div className="t-row"><span>Sub total</span><span>{m(doc.sub_total)}</span></div>
          {doc.discount_total > 0 && <div className="t-row"><span>Discount</span><span>-{m(doc.discount_total)}</span></div>}
          {[...taxes.entries()].map(([k, v]) => <div className="t-row" key={k}><span>{k}</span><span>{m(v)}</span></div>)}
          {doc.shipping_charge > 0 && <div className="t-row"><span>Shipping</span><span>{m(doc.shipping_charge)}</span></div>}
          {doc.adjustment !== 0 && <div className="t-row"><span>Adjustment</span><span>{m(doc.adjustment)}</span></div>}
          <div className="t-row grand"><span>Total</span><span>{m(doc.total)}</span></div>
        </div>
        {doc.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{doc.notes}</p>}
        {doc.terms && <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{doc.terms}</p>}
      </div>
      {doc.payments?.length > 0 && (
        <div className="card"><div className="card-head"><h3>Payments</h3></div><table className="table compact"><tbody>
          {doc.payments.map((p) => <tr key={p.number}><td>{p.number}</td><td>{date(p.payment_date)}</td><td>{modeLabel(p.mode)}</td><td className="num">{m(p.amount)}</td></tr>)}
        </tbody></table></div>
      )}
      <div className="card no-print">
        <div className="card-head"><h3>Questions or comments</h3></div>
        <div className="card-body stack" style={{ gap: 8 }}>
          {doc.comments.map((c) => (
            <div key={c.id} style={{ padding: '8px 10px', borderRadius: 8, background: c.contact_id ? 'var(--primary-soft)' : 'var(--surface-2)' }}>
              <div className="small"><strong>{c.contact_id ? 'You' : c.user_name || 'Team'}</strong> <span className="faint">· {dateTime(c.created_at)}</span></div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          ))}
          <Textarea rows={2} value={comment} onChange={setComment} placeholder="Write a message to us about this document…" />
          <div><button type="button" className="btn primary sm" disabled={!comment.trim()} onClick={send}>Send message</button></div>
        </div>
      </div>
    </div>
  );
}

function Home({ me, slug }: any) {
  const c = me.contact;
  const m = (v) => money(v, { currency: c.currency });
  if (c.contact_type === 'vendor') {
    return (
      <div className="stack">
        <h2>Hello, {c.display_name}</h2>
        <div className="grid-4">
          <Link to={`/portal/${slug}/bills`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">To be paid to you</div><div className="value sm">{m(me.payable)}</div>{Number(me.overdue) > 0 && <div className="small w-alert">{m(me.overdue)} past due date</div>}</Link>
          <Link to={`/portal/${slug}/purchase-orders`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Open purchase orders</div><div className="value sm">{me.open_orders}</div></Link>
          <Link to={`/portal/${slug}/purchase-orders`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Waiting for your reply</div><div className="value sm">{me.awaiting_reply}</div></Link>
          <Link to={`/portal/${slug}/vendor-credits`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Credits with you</div><div className="value sm">{m(me.credits)}</div></Link>
        </div>
        <div className="card"><div className="card-body small muted">
          Questions? Contact {me.org.name}{me.org.email ? ` at ${me.org.email}` : ''}{me.org.phone ? ` or ${me.org.phone}` : ''}. You can also write a message on any purchase order or bill.
        </div></div>
      </div>
    );
  }
  return (
    <div className="stack">
      <h2>Hello, {c.display_name}</h2>
      <div className="grid-4">
        <Link to={`/portal/${slug}/invoices`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">You owe</div><div className="value sm">{money(me.outstanding)}</div>{Number(me.overdue) > 0 && <div className="small w-alert">⚠ {money(me.overdue)} overdue</div>}</Link>
        <Link to={`/portal/${slug}/credit-notes`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Credit available</div><div className="value sm">{money(me.credits)}</div></Link>
        <Link to={`/portal/${slug}/sales-orders`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Open orders</div><div className="value sm">{me.open_orders}</div></Link>
        <Link to={`/portal/${slug}/estimates`} className="card stat" style={{ color: 'var(--text)' }}><div className="label">Quotes awaiting your reply</div><div className="value sm">{me.pending_estimates}</div></Link>
      </div>
      <div className="card"><div className="card-body small muted">
        Questions? Contact {me.org.name}{me.org.email ? ` at ${me.org.email}` : ''}{me.org.phone ? ` or ${me.org.phone}` : ''}. You can also write a message on any invoice or order.
      </div></div>
    </div>
  );
}

function Payments({ call }: any) {
  const [rows, setRows] = useState(null);
  useEffect(() => { call('GET', '/payments').then(setRows).catch(() => setRows([])); }, [call]);
  if (!rows) return <Spinner />;
  if (!rows.length) return <EmptyState title="No payments yet" />;
  return <div className="card"><table className="table"><thead><tr><th>Date</th><th>Receipt#</th><th>Mode</th><th>For invoices / bills</th><th className="num">Amount</th></tr></thead>
    <tbody>{rows.map((p) => <tr key={p.id}><td>{date(p.payment_date)}</td><td>{p.number}</td><td>{modeLabel(p.mode)}</td><td>{p.invoices}</td><td className="num">{money(p.amount, { currency: p.currency })}</td></tr>)}</tbody></table></div>;
}

function Shipments({ call }: any) {
  const [rows, setRows] = useState(null);
  useEffect(() => { call('GET', '/shipments').then(setRows).catch(() => setRows([])); }, [call]);
  if (!rows) return <Spinner />;
  if (!rows.length) return <EmptyState title="No shipments yet" />;
  return <div className="card"><table className="table"><thead><tr><th>Shipped</th><th>Order</th><th>Courier</th><th>Tracking</th><th>Status</th><th>Expected / delivered</th></tr></thead>
    <tbody>{rows.map((s) => <tr key={s.id}><td>{date(s.ship_date)}</td><td>{s.sales_order_number}</td><td>{s.carrier}</td>
      <td>{s.tracking_link ? <a href={s.tracking_link} target="_blank" rel="noreferrer">{s.tracking_number}</a> : s.tracking_number}</td>
      <td><Badge status={s.status} /></td><td>{date(s.delivered_date || s.estimated_delivery)}</td></tr>)}</tbody></table></div>;
}

function Statement({ call }: any) {
  const [rows, setRows] = useState(null);
  useEffect(() => { call('GET', '/statement').then(setRows).catch(() => setRows([])); }, [call]);
  if (!rows) return <Spinner />;
  return (
    <div className="stack">
      <div className="row"><h2>Account statement</h2><span className="spacer" /><button type="button" className="btn no-print" onClick={() => window.print()}>Print / PDF</button></div>
      <div className="card"><table className="table"><thead><tr><th>Date</th><th>Transaction</th><th>Number</th><th className="num">Charges</th><th className="num">Payments / credits</th><th className="num">Balance</th></tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={6} className="faint">No transactions yet.</td></tr>}
          {rows.map((r, i) => <tr key={i}><td>{date(r.date)}</td><td>{r.type}</td><td>{r.number}</td><td className="num">{Number(r.debit) ? money(r.debit) : ''}</td><td className="num">{Number(r.credit) ? money(r.credit) : ''}</td><td className="num bold">{money(r.balance)}</td></tr>)}
        </tbody></table></div>
    </div>
  );
}

function Profile({ call, me, reload }: any) {
  const toast = useToast();
  const [f, setF] = useState({ phone: me.contact.phone || '', mobile: me.contact.mobile || '', billing_address: me.contact.billing_address || {}, shipping_address: me.contact.shipping_address || {} });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const save = async () => { try { await call('PUT', '/me', f); toast('Details updated'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const changePw = async () => { try { await call('POST', '/me/password', pw); toast('Password changed'); setPw({ current_password: '', new_password: '' }); } catch (e) { toast(e.message, 'error'); } };
  const addr = (k) => (
    <div className="stack">
      {['attention', 'street1', 'street2', 'city', 'zip'].map((x) => (
        <Field key={x} label={{ attention: 'Attention', street1: 'Street 1', street2: 'Street 2', city: 'City', zip: 'PIN code' }[x]}>
          <Input value={f[k][x] || ''} onChange={(v) => setF({ ...f, [k]: { ...f[k], [x]: v } })} />
        </Field>
      ))}
      <Field label="State"><Select value={f[k].state || ''} onChange={(v) => setF({ ...f, [k]: { ...f[k], state: v } })} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select" /></Field>
    </div>
  );
  return (
    <div className="stack">
      <h2>My details</h2>
      <div className="card"><div className="card-body stack">
        <div className="muted small">Name: <strong>{me.contact.display_name}</strong> · Email: <strong>{me.contact.email}</strong>{me.contact.gstin ? <> · GSTIN <strong>{me.contact.gstin}</strong></> : null}. To change these, contact us.</div>
        <div className="grid-2"><Field label="Phone"><Input value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></Field><Field label="Mobile"><Input value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} /></Field></div>
        <div className="grid-2"><div><h3 className="mb">Billing address</h3>{addr('billing_address')}</div><div><h3 className="mb">Shipping address</h3>{addr('shipping_address')}</div></div>
        <div><button type="button" className="btn primary" onClick={save}>Save details</button></div>
      </div></div>
      <div className="card"><div className="card-head"><h3>Change password</h3></div><div className="card-body grid-2">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(v) => setPw({ ...pw, current_password: v })} /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(v) => setPw({ ...pw, new_password: v })} /></Field>
        <div><button type="button" className="btn" disabled={!pw.current_password || pw.new_password.length < 8} onClick={changePw}>Change password</button></div>
      </div></div>
    </div>
  );
}

export default function Portal() {
  const { slug } = useParams();
  const [org, setOrg] = useState(null);
  const [me, setMe] = useState(null);
  const [signedIn, setSignedIn] = useState(!!getTok(slug));
  const [error, setError] = useState(null);
  const logout = useCallback(() => { setTok(slug, ''); setSignedIn(false); setMe(null); }, [slug]);
  const call = usePortalApi(slug, logout);
  const loadMe = useCallback(() => call('GET', '/me').then(setMe).catch(() => {}), [call]);
  useEffect(() => { fetch(`${API_BASE}/api/portal/${slug}/info`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('This portal link is not valid')))).then(setOrg).catch(setError); }, [slug]);
  useEffect(() => { if (signedIn) loadMe(); }, [signedIn, loadMe]);
  useEffect(() => { document.title = org ? `${org.name} – ${me?.contact?.contact_type === 'vendor' ? 'Vendor' : 'Customer'} portal` : 'Portal'; }, [org, me]);

  if (error) return <Shell><ErrorBox error={error} /></Shell>;
  return (
    <Routes>
      <Route path="invite/:token" element={<Invite slug={slug} org={org} onIn={() => setSignedIn(true)} />} />
      <Route path="*" element={!signedIn ? <Login slug={slug} org={org} onIn={() => setSignedIn(true)} /> : !me ? <Spinner /> : (
        <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
          <header className="topbar no-print" style={{ height: 'auto', padding: '10px 20px', flexWrap: 'wrap' }}>
            {me.org.logo_path && <img src={mediaUrl(me.org.logo_path)} alt="" style={{ height: 32 }} />}
            <strong>{me.org.name}</strong>
            <nav className="row wrap" style={{ gap: 4, marginLeft: 16 }}>
              {(me.contact.contact_type === 'vendor'
                ? [['', 'Home'], ['purchase-orders', 'Purchase orders'], ['bills', 'Bills'], ['vendor-credits', 'Credits'], ['payments', 'Payments'], ['statement', 'Statement'], ['profile', 'My details']]
                : [['', 'Home'], ['invoices', 'Invoices'], ['sales-orders', 'Orders'], ['estimates', 'Quotes'], ['shipments', 'Shipments'], ['payments', 'Payments'], ['statement', 'Statement'], ['profile', 'My details']]).map(([p, l]) => (
                <NavLink key={p} end={p === ''} to={`/portal/${slug}${p ? `/${p}` : ''}`} className={({ isActive }) => `btn sm ${isActive ? 'primary' : 'ghost'}`}>{l}</NavLink>
              ))}
            </nav>
            <span className="spacer" />
            <span className="small muted">{me.contact.display_name}</span>
            <button type="button" className="btn sm" onClick={logout}>Sign out</button>
          </header>
          <main className="page" style={{ margin: '0 auto' }}>
            <Routes>
              <Route index element={<Home me={me} slug={slug} />} />
              {(me.contact.contact_type === 'vendor' ? VENDOR_KINDS : CUSTOMER_KINDS).map((k) => [
                <Route key={k} path={k} element={<div className="stack"><h2>{KIND_LABEL[k]}</h2><DocList call={call} slug={slug} kind={k} /></div>} />,
                <Route key={`${k}-d`} path={`${k}/:id`} element={<DocView call={call} slug={slug} kind={k} />} />,
              ])}
              <Route path="payments" element={<div className="stack"><h2>Payments</h2><Payments call={call} /></div>} />
              <Route path="shipments" element={<div className="stack"><h2>Shipments</h2><Shipments call={call} /></div>} />
              <Route path="statement" element={<Statement call={call} />} />
              <Route path="profile" element={<Profile call={call} me={me} reload={loadMe} />} />
              <Route path="*" element={<Navigate to={`/portal/${slug}`} replace />} />
            </Routes>
          </main>
        </div>
      )} />
    </Routes>
  );
}
