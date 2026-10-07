import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { addressLines, date, dateTime, money, PAYMENT_TERMS, INDIAN_STATES, label } from '../lib/format';
import DataTable from '../components/DataTable';
import { Attachments, History } from '../components/Attachments';
import { BackLink, Badge, Checkbox, ErrorBox, Field, FormRow, Input, PageHead, Select, Spinner, Tabs, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';
import { CustomFieldInputs, CustomFieldValues } from '../components/CustomFields';

const cfgOf = (type) => (type === 'customer'
  ? { type, path: '/customers', api: '/customers', title: 'Customers', one: 'Customer', perm: 'customers' }
  : { type, path: '/vendors', api: '/vendors', title: 'Vendors', one: 'Vendor', perm: 'vendors' });

const GST_TREATMENTS = [
  ['registered', 'Registered Business – Regular'], ['registered_composition', 'Registered Business – Composition'],
  ['unregistered', 'Unregistered Business'], ['consumer', 'Consumer'], ['overseas', 'Overseas'], ['sez', 'Special Economic Zone'], ['deemed_export', 'Deemed Export'],
];

export function ContactsList({ type }: any) {
  const c = cfgOf(type);
  const { can } = useAuth();
  const toast = useToast();
  const setStatus = (status) => async (ids) => {
    try { for (const id of ids) await api.post(`${c.api}/${id}/status`, { status }); toast(`${ids.length} marked ${status}`); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (ids) => {
    if (!(await confirmDialog({ message: `Delete ${ids.length} ${c.one.toLowerCase()}(s)? Contacts with transactions cannot be deleted.`, danger: true, confirmText: 'Delete' }))) return false;
    for (const id of ids) { try { await api.del(`${c.api}/${id}`); } catch (e) { toast(e.message, 'error'); } }
    return true;
  };
  return (
    <div className="page">
      <PageHead title={c.title}>
        {can(c.perm, 'import') && <Link className="btn" to={`/import/${c.perm}`}>Import</Link>}
        {can(c.perm, 'create') && <Link className="btn primary" to={`${c.path}/new`}>+ New</Link>}
      </PageHead>
      <DataTable endpoint={c.api} rowLink={(r) => `${c.path}/${r.id}`} exportName={c.perm}
        searchPlaceholder="Search name, company, email, phone, GSTIN"
        filters={[{ key: 'status', label: 'Status', default: 'active', options: [['active', 'Active'], ['inactive', 'Inactive'], ['', 'All']] }]}
        bulkActions={can(c.perm, 'edit') ? [
          { label: 'Mark active', run: setStatus('active') }, { label: 'Mark inactive', run: setStatus('inactive') },
          ...(can(c.perm, 'delete') ? [{ label: 'Delete', danger: true, run: remove }] : []),
        ] : []}
        emptyTitle={`No ${c.title.toLowerCase()} yet`}
        emptyAction={can(c.perm, 'create') && <Link className="btn primary" to={`${c.path}/new`}>+ New {c.one.toLowerCase()}</Link>}
        columns={[
          { key: 'display_name', label: 'Name', sort: 'name', render: (r) => <span className="bold">{r.display_name}</span> },
          { key: 'company_name', label: 'Company', sort: 'company' },
          { key: 'email', label: 'Email', sort: 'email' },
          { key: 'phone', label: 'Phone', render: (r) => r.phone || r.mobile },
          { key: 'gstin', label: 'GSTIN' },
          type === 'customer'
            ? { key: 'receivables', label: 'Receivables', num: true, render: (r) => money(r.receivables) }
            : { key: 'payables', label: 'Payables', num: true, render: (r) => money(r.payables) },
          { key: 'unused_credits', label: 'Unused credits', num: true, render: (r) => money(r.unused_credits) },
        ]} />
    </div>
  );
}

const EMPTY_ADDR = { attention: '', street1: '', street2: '', city: '', state: '', zip: '', country: 'India', phone: '' };

function AddressFields({ value, onChange }: any) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="stack">
      <Field label="Attention"><Input value={value.attention} onChange={set('attention')} /></Field>
      <Field label="Street 1"><Input value={value.street1} onChange={set('street1')} /></Field>
      <Field label="Street 2"><Input value={value.street2} onChange={set('street2')} /></Field>
      <div className="grid-2">
        <Field label="City"><Input value={value.city} onChange={set('city')} /></Field>
        <Field label="State">
          {value.country === 'India' || !value.country
            ? <Select value={value.state} onChange={set('state')} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select state" />
            : <Input value={value.state} onChange={set('state')} />}
        </Field>
        <Field label="PIN / ZIP"><Input value={value.zip} onChange={set('zip')} /></Field>
        <Field label="Country"><Input value={value.country} onChange={set('country')} /></Field>
      </div>
      <Field label="Phone"><Input value={value.phone} onChange={set('phone')} /></Field>
    </div>
  );
}

export function ContactForm({ type }: any) {
  const c = cfgOf(type);
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const priceLists = useApi('/price-lists');
  const currencies = useApi('/currencies');
  const [tab, setTab] = useState('other');
  const [f, setF] = useState({
    customer_type: 'business', salutation: '', first_name: '', last_name: '', company_name: '', display_name: '', email: '', phone: '', mobile: '',
    website: '', pan: '', gst_treatment: '', gstin: '', place_of_supply: 'Tamil Nadu', currency: 'INR', payment_terms: 0, credit_limit: '', price_list_id: '',
    billing_address: { ...EMPTY_ADDR }, shipping_address: { ...EMPTY_ADDR }, notes: '', status: 'active', contact_persons: [], custom_fields: {},
    msme_registered: false, msme_type: 'micro', udyam_number: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    api.get(`${c.api}/${id}`).then((d) => setF((x) => {
      const v = { ...x };
      for (const k of Object.keys(x)) if (d[k] !== undefined && d[k] !== null) v[k] = d[k];
      v.billing_address = { ...EMPTY_ADDR, ...d.billing_address };
      v.shipping_address = { ...EMPTY_ADDR, ...d.shipping_address };
      return v;
    })).catch(setError).finally(() => setLoading(false));
  }, [editing, id, c.api]);

  const nameOptions = [...new Set([f.company_name, [f.salutation, f.first_name, f.last_name].filter(Boolean).join(' '), [f.first_name, f.last_name].filter(Boolean).join(' ')].filter(Boolean))];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const saved = editing ? await api.put(`${c.api}/${id}`, f) : await api.post(c.api, f);
      toast(`${c.one} saved`);
      navigate(`${c.path}/${saved.id}`);
    } catch (err) { setError(err); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };
  if (loading) return <div className="page"><Spinner /></div>;
  const pls = (priceLists.data?.data || []).filter((p) => p.kind === (type === 'customer' ? 'sales' : 'purchase'));

  return (
    <form onSubmit={submit}>
      <div className="page narrow">
        <BackLink to={c.path}>{c.title}</BackLink>
        <PageHead title={editing ? `Edit ${f.display_name}` : `New ${c.one}`} />
        <ErrorBox error={error} />
        <div className="card"><div className="card-body">
          {type === 'customer' && (
            <FormRow label="Customer type">
              <div className="radio-group">
                {[['business', 'Business'], ['individual', 'Individual']].map(([v, l]) => (
                  <label key={v} className="checkbox"><input type="radio" checked={f.customer_type === v} onChange={() => set('customer_type')(v)} />{l}</label>
                ))}
              </div>
            </FormRow>
          )}
          <FormRow label="Primary contact">
            <div className="row">
              <select className="input" style={{ width: 90 }} value={f.salutation} onChange={(e) => set('salutation')(e.target.value)}>
                <option value="">—</option>{['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.'].map((s) => <option key={s}>{s}</option>)}
              </select>
              <Input placeholder="First name" value={f.first_name} onChange={set('first_name')} />
              <Input placeholder="Last name" value={f.last_name} onChange={set('last_name')} />
            </div>
          </FormRow>
          <FormRow label="Company name"><Input value={f.company_name} onChange={set('company_name')} /></FormRow>
          <FormRow label="Display name" required>
            <input className="input" list="display-names" required value={f.display_name} onChange={(e) => set('display_name')(e.target.value)} />
            <datalist id="display-names">{nameOptions.map((n) => <option key={n} value={n} />)}</datalist>
          </FormRow>
          <FormRow label="Email"><Input type="email" value={f.email} onChange={set('email')} /></FormRow>
          <FormRow label="Phone">
            <div className="row"><Input placeholder="Work phone (+91)" value={f.phone} onChange={set('phone')} /><Input placeholder="Mobile" value={f.mobile} onChange={set('mobile')} /></div>
          </FormRow>

          <div className="mt">
            <Tabs tabs={[['other', 'Other Details'], ['address', 'Address'], ['persons', 'Contact Persons'], ['remarks', 'Remarks']]} active={tab} onChange={setTab} />
            {tab === 'other' && (
              <div>
                <FormRow label="GST treatment"><Select value={f.gst_treatment} onChange={set('gst_treatment')} options={GST_TREATMENTS} placeholder="Select a GST treatment" /></FormRow>
                {['registered', 'registered_composition', 'sez', 'deemed_export'].includes(f.gst_treatment) && (
                  <FormRow label="GSTIN" required hint="15 characters, e.g. 33ABCDE1234F1Z5"><Input value={f.gstin} maxLength={15} onChange={(v) => set('gstin')(v.toUpperCase())} /></FormRow>
                )}
                <FormRow label="Place of supply"><Select value={f.place_of_supply} onChange={set('place_of_supply')} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select" /></FormRow>
                <FormRow label="PAN"><Input value={f.pan} maxLength={10} onChange={(v) => set('pan')(v.toUpperCase())} /></FormRow>
                <FormRow label="Currency" hint="Their invoices or bills will be in this currency. Add more under Settings → Currencies.">
                  <Select value={f.currency || currencies.data?.base || 'INR'} onChange={set('currency')}
                    options={[[currencies.data?.base || 'INR', `${currencies.data?.base || 'INR'} (base)`], ...(currencies.data?.currencies || []).map((c) => [c.code, `${c.code} – ${c.name}`])]} />
                </FormRow>
                <FormRow label="Payment terms"><Select value={f.payment_terms} onChange={(v) => set('payment_terms')(Number(v))} options={PAYMENT_TERMS} /></FormRow>
                {type === 'customer' && <FormRow label="Credit limit" hint="Shown as a warning on new sales orders and invoices."><Input type="number" min="0" step="0.01" value={f.credit_limit} onChange={set('credit_limit')} /></FormRow>}
                <FormRow label="Price list"><Select value={f.price_list_id || ''} onChange={set('price_list_id')} options={pls.map((p) => [p.id, p.name])} placeholder="None" /></FormRow>
                <FormRow label="Website"><Input value={f.website} onChange={set('website')} /></FormRow>
                {editing && <FormRow label="Status"><Select value={f.status} onChange={set('status')} options={[['active', 'Active'], ['inactive', 'Inactive']]} /></FormRow>}
                {type === 'vendor' && (
                  <>
                    <FormRow label="MSME" hint="Micro, small and medium enterprises registered on the Udyam portal must be paid within 45 days of the bill.">
                      <Checkbox checked={f.msme_registered} onChange={set('msme_registered')}>This vendor is MSME (Udyam) registered</Checkbox>
                    </FormRow>
                    {f.msme_registered && (
                      <>
                        <FormRow label="MSME type"><Select value={f.msme_type || 'micro'} onChange={set('msme_type')} options={[['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium']]} /></FormRow>
                        <FormRow label="Udyam registration no." hint="e.g. UDYAM-TN-02-0012345"><Input value={f.udyam_number || ''} onChange={(v) => set('udyam_number')(v.toUpperCase())} maxLength={30} /></FormRow>
                      </>
                    )}
                  </>
                )}
                <CustomFieldInputs entity={type} value={f.custom_fields} onChange={set('custom_fields')} isNew={!editing} />
              </div>
            )}
            {tab === 'address' && (
              <div className="grid-2">
                <div><h3 className="mb">Billing address</h3><AddressFields value={f.billing_address} onChange={set('billing_address')} /></div>
                <div>
                  <div className="row mb"><h3>Shipping address</h3><button type="button" className="btn link small" onClick={() => set('shipping_address')({ ...f.billing_address })}>Copy billing address</button></div>
                  <AddressFields value={f.shipping_address} onChange={set('shipping_address')} />
                </div>
              </div>
            )}
            {tab === 'persons' && (
              <div>
                <table className="table compact lines">
                  <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Designation</th><th /></tr></thead>
                  <tbody>
                    {f.contact_persons.map((p, i) => (
                      <tr key={i}>
                        {['name', 'email', 'phone', 'designation'].map((k) => (
                          <td key={k}><input className="input" value={p[k] || ''} onChange={(e) => set('contact_persons')(f.contact_persons.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>
                        ))}
                        <td><button type="button" className="btn ghost sm danger" onClick={() => set('contact_persons')(f.contact_persons.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="btn sm mt" onClick={() => set('contact_persons')([...f.contact_persons, { name: '', email: '', phone: '', designation: '' }])}>+ Add contact person</button>
              </div>
            )}
            {tab === 'remarks' && <Textarea rows={5} value={f.notes} onChange={set('notes')} placeholder="Internal remarks (not shown to the contact)" />}
          </div>
        </div></div>
      </div>
      <div className="form-footer">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

function ContactTransactions({ type, contactId }: any) {
  const sets = type === 'customer'
    ? [['/sales-orders', 'Sales Orders', '/sales-orders'], ['/invoices', 'Invoices', '/invoices'], ['/payments-received', 'Payments Received', '/payments-received'], ['/credit-notes', 'Credit Notes', '/credit-notes']]
    : [['/purchase-orders', 'Purchase Orders', '/purchase-orders'], ['/bills', 'Bills', '/bills'], ['/payments-made', 'Payments Made', '/payments-made'], ['/vendor-credits', 'Vendor Credits', '/vendor-credits']];
  const [active, setActive] = useState(sets[0][0]);
  const cur = sets.find((s) => s[0] === active);
  const isPayment = active.startsWith('/payments');
  return (
    <>
      <Tabs tabs={sets.map((s) => [s[0], s[1]])} active={active} onChange={setActive} />
      <DataTable key={active} endpoint={active} params={{ contact_id: contactId }} rowLink={(r) => `${cur[2]}/${r.id}`} perPage={10}
        emptyTitle={`No ${cur[1].toLowerCase()} yet`}
        columns={isPayment ? [
          { key: 'payment_date', label: 'Date', render: (r) => date(r.payment_date) }, { key: 'number', label: 'Payment#' },
          { key: 'mode', label: 'Mode', render: (r) => label(r.mode) }, { key: 'amount', label: 'Amount', num: true, render: (r) => money(r.amount) },
        ] : [
          { key: 'doc_date', label: 'Date', render: (r) => date(r.doc_date) }, { key: 'number', label: 'Number' }, { key: 'reference', label: 'Reference' },
          { key: 'status', label: 'Status', render: (r) => <Badge status={r.display_status || r.status} /> },
          { key: 'total', label: 'Amount', num: true, render: (r) => money(r.total) },
          ...(r0Balance(active) ? [{ key: 'balance', label: 'Balance', num: true, render: (r) => money(r.balance) }] : []),
        ]} />
    </>
  );
}
const r0Balance = (p) => ['/invoices', '/bills', '/credit-notes', '/vendor-credits'].includes(p);

function PortalCard({ contact, onChange, type = 'customer' }: any) {
  const { can } = useAuth();
  const base = type === 'vendor' ? '/vendors' : '/customers';
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [link, setLink] = useState(null);
  const enable = async () => {
    const r = await run(() => api.post(`${base}/${contact.id}/portal`, { enable: true }));
    if (!r) return;
    const url = `${window.location.origin}${r.path}`;
    setLink(url);
    try { await navigator.clipboard.writeText(url); } catch { /* shown below */ }
    toast(r.emailed ? `Invitation emailed to ${r.email}` : `Invitation link copied — send it to the ${type}`);
    onChange();
  };
  const disable = async () => {
    if (!(await confirmDialog({ message: `Turn off portal access for ${contact.display_name}? They will no longer be able to sign in.`, confirmText: 'Turn off' }))) return;
    if (await run(() => api.post(`${base}/${contact.id}/portal`, { enable: false }), 'Portal access turned off')) { setLink(null); onChange(); }
  };
  return (
    <div className="card">
      <div className="card-head"><h3>{type === 'vendor' ? 'Vendor portal' : 'Customer portal'}</h3><Badge status={contact.portal_enabled ? 'active' : 'inactive'}>{contact.portal_enabled ? (contact.portal_last_login ? 'Active' : 'Invited') : 'Off'}</Badge></div>
      <div className="card-body small stack" style={{ gap: 8 }}>
        <div className="muted">{type === 'vendor'
          ? 'The vendor can sign in to see your purchase orders, accept or decline them and confirm delivery dates, follow their bills and payments, and send you messages.'
          : 'The customer can sign in to see their orders, invoices, payments and shipments, accept estimates, comment and pay online.'}</div>
        {contact.portal_last_login && <div>Last signed in {dateTime(contact.portal_last_login)}</div>}
        {link && <div className="info-box" style={{ wordBreak: 'break-all' }}>Invitation link: <a href={link} target="_blank" rel="noreferrer">{link}</a></div>}
        {can(type === 'vendor' ? 'vendors' : 'customers', 'edit') && (
          <div className="row">
            <button type="button" className="btn sm primary" disabled={busy} onClick={enable}>{contact.portal_enabled ? 'Send a new invitation link' : 'Invite to portal'}</button>
            {contact.portal_enabled && <button type="button" className="btn sm danger" disabled={busy} onClick={disable}>Turn off</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactDetail({ type }: any) {
  const c = cfgOf(type);
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const [tab, setTab] = useState('overview');
  const { data: d, error, reload } = useApi(`${c.api}/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!d) return <div className="page"><Spinner /></div>;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${d.display_name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`${c.api}/${d.id}`), `${c.one} deleted`)) !== undefined) navigate(c.path);
  };
  const toggle = async () => {
    if (await run(() => api.post(`${c.api}/${d.id}/status`, { status: d.status === 'active' ? 'inactive' : 'active' }), 'Status updated')) reload();
  };
  const outstanding = type === 'customer' ? d.receivables : d.payables;
  return (
    <div className="page">
      <PageHead title={d.display_name} crumb={<Link to={c.path}>{c.title}</Link>}>
        <Badge status={d.status} />
        {can(c.perm, 'edit') && <Link className="btn" to={`${c.path}/${d.id}/edit`}>Edit</Link>}
        {type === 'customer' ? (
          <>
            {can('sales_orders', 'create') && <Link className="btn primary" to={`/sales-orders/new?contact=${d.id}`}>New sales order</Link>}
            {can('invoices', 'create') && <Link className="btn" to={`/invoices/new?contact=${d.id}`}>New invoice</Link>}
            {can('payments_received', 'create') && <Link className="btn" to={`/payments-received/new?contact=${d.id}`}>Receive payment</Link>}
          </>
        ) : (
          <>
            {can('purchase_orders', 'create') && <Link className="btn primary" to={`/purchase-orders/new?contact=${d.id}`}>New purchase order</Link>}
            {can('bills', 'create') && <Link className="btn" to={`/bills/new?contact=${d.id}`}>New bill</Link>}
            {can('payments_made', 'create') && <Link className="btn" to={`/payments-made/new?contact=${d.id}`}>Record payment</Link>}
          </>
        )}
        {can(c.perm, 'edit') && <button type="button" className="btn" onClick={toggle}>Mark {d.status === 'active' ? 'inactive' : 'active'}</button>}
        {can(c.perm, 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <Tabs tabs={[['overview', 'Overview'], ['transactions', 'Transactions'], ['history', 'History']]} active={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)' }}>
          <div className="stack">
            <div className="card"><div className="card-body">
              <div className="bold">{[d.salutation, d.first_name, d.last_name].filter(Boolean).join(' ')}</div>
              {d.company_name && <div>{d.company_name}</div>}
              {d.email && <div><a href={`mailto:${d.email}`}>{d.email}</a></div>}
              {d.phone && <div>{d.phone}</div>}
              {d.mobile && <div>{d.mobile}</div>}
              {d.website && <div>{d.website}</div>}
            </div></div>
            <div className="card"><div className="card-head"><h3>Addresses</h3></div><div className="card-body grid-2">
              <div><div className="small faint mb">Billing</div>{addressLines(d.billing_address).map((l) => <div key={l}>{l}</div>)}{!addressLines(d.billing_address).length && <span className="faint">—</span>}</div>
              <div><div className="small faint mb">Shipping</div>{addressLines(d.shipping_address).map((l) => <div key={l}>{l}</div>)}{!addressLines(d.shipping_address).length && <span className="faint">—</span>}</div>
            </div></div>
            <div className="card"><div className="card-head"><h3>Other details</h3></div><div className="card-body">
              <dl className="kv">
                {type === 'customer' && <><dt>Customer type</dt><dd>{label(d.customer_type)}</dd></>}
                <dt>GST treatment</dt><dd>{GST_TREATMENTS.find((g) => g[0] === d.gst_treatment)?.[1] || '—'}</dd>
                {d.gstin && <><dt>GSTIN</dt><dd className="mono">{d.gstin}</dd></>}
                {d.place_of_supply && <><dt>Place of supply</dt><dd>{d.place_of_supply}</dd></>}
                {d.pan && <><dt>PAN</dt><dd className="mono">{d.pan}</dd></>}
                <dt>Currency</dt><dd>{d.currency}</dd>
                <dt>Payment terms</dt><dd>{PAYMENT_TERMS.find((p) => p[0] === d.payment_terms)?.[1] || `Net ${d.payment_terms}`}</dd>
                {d.credit_limit && <><dt>Credit limit</dt><dd>{money(d.credit_limit)}</dd></>}
                {d.price_list_name && <><dt>Price list</dt><dd>{d.price_list_name}</dd></>}
                {d.msme_registered && <><dt>MSME</dt><dd>{label(d.msme_type)}{d.udyam_number && <span className="mono"> · {d.udyam_number}</span>}<div className="small faint">Pay bills within 45 days</div></dd></>}
                <CustomFieldValues entity={type} values={d.custom_fields} />
              </dl>
              {d.notes && <div className="mt small" style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</div>}
            </div></div>
            {d.contact_persons.length > 0 && (
              <div className="card"><div className="card-head"><h3>Contact persons</h3></div><div className="card-body flush">
                <table className="table compact"><tbody>{d.contact_persons.map((p) => <tr key={p.id}><td>{p.name}<div className="small faint">{p.designation}</div></td><td>{p.email}<div className="small faint">{p.phone}</div></td></tr>)}</tbody></table>
              </div></div>
            )}
          </div>
          <div className="stack">
            <div className="grid-2">
              <div className="card stat"><div className="label">Outstanding {type === 'customer' ? 'receivables' : 'payables'}</div><div className="value sm">{money(outstanding)}</div></div>
              <div className="card stat"><div className="label">Unused credits</div><div className="value sm">{money(d.unused_credits)}</div></div>
            </div>
            {type === 'customer' && d.credit_limit && Number(outstanding) > Number(d.credit_limit) && <div className="warn-box">Outstanding receivables exceed the credit limit of {money(d.credit_limit)}.</div>}
            <PortalCard contact={d} onChange={reload} type={type} />
            <Attachments entityType={type} entityId={d.id} />
          </div>
        </div>
      )}
      {tab === 'transactions' && <ContactTransactions type={type} contactId={d.id} />}
      {tab === 'history' && <History entityType={type} entityId={d.id} />}
    </div>
  );
}
