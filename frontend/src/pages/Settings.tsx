import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, mediaUrl } from '../api';
import { useAuth } from '../auth';
import { invalidateLookups } from '../lib/lookups';
import { dateTime, label, money, INDIAN_STATES } from '../lib/format';
import DataTable from '../components/DataTable';
import { Badge, Checkbox, ErrorBox, Field, FormRow, Input, Modal, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';
import { Developer, EmailSettings, Integrations } from './SettingsExtra';
import { BrandingSettings, CustomFieldsSettings, ReportingTagsSettings, TemplatesSettings } from './SettingsCustom';
import WorkflowSettings from './Workflows';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ organization
function Organization() {
  const { can, refresh } = useAuth();
  const toast = useToast();
  const logoInput = useRef(null);
  const [f, setF] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [busy, run] = useAction(toast);
  const load = () => {
    api.get('/settings/organization').then((o) => setF({ ...o, address: { street1: '', street2: '', city: '', state: '', zip: '', country: 'India', phone: '', ...o.address } })).catch(setError);
    api.get('/settings/plan').then(setPlan).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Spinner />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setAddr = (k) => (v) => setF((x) => ({ ...x, address: { ...x.address, [k]: v } }));
  const editable = can('settings', 'edit');
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.put('/settings/organization', f), 'Organization profile saved')) { invalidateLookups('organization'); refresh(); }
  };
  const uploadLogo = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await run(() => api.upload('/settings/organization/logo', fd), 'Logo updated');
    if (r) { setF((x) => ({ ...x, logo_path: r.logo_path })); invalidateLookups('organization'); }
  };
  const removeLogo = async () => {
    if ((await run(() => api.del('/settings/organization/logo'), 'Logo removed')) !== undefined) { setF((x) => ({ ...x, logo_path: null })); invalidateLookups('organization'); }
  };
  const usage = plan?.usage || {};
  const lim = (n, max) => (max == null ? String(n ?? 0) : `${n ?? 0} / ${max}`);
  return (
    <form onSubmit={save}>
      <PageHead title="Organization Profile" />
      {plan?.plan_name && (
        <div className="card mb"><div className="card-body row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div><div className="small faint">Plan</div><div className="bold">{plan.plan_name}</div></div>
          <div><div className="small faint">Status</div><div><Badge status={plan.status || f.status} /></div></div>
          <div><div className="small faint">Users</div><div>{lim(usage.users, plan.max_users)}</div></div>
          <div><div className="small faint">Warehouses</div><div>{lim(usage.warehouses, plan.max_warehouses)}</div></div>
          <div><div className="small faint">Items</div><div>{lim(usage.items, plan.max_items)}</div></div>
        </div></div>
      )}
      <div className="card"><div className="card-body">
        <div className="form-section">
          <FormRow label="Logo" hint="Appears on invoices, orders and receipts. PNG/JPG up to 5 MB.">
            <div className="row">
              <div className="img-drop" onClick={() => editable && logoInput.current.click()} role="button" tabIndex={0}>{f.logo_path ? <img src={mediaUrl(f.logo_path)} alt="Logo" /> : 'Upload logo'}</div>
              <input ref={logoInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadLogo(e.target.files[0])} />
              {f.logo_path && editable && <button type="button" className="btn sm danger" onClick={removeLogo}>Remove</button>}
            </div>
          </FormRow>
          <FormRow label="Organization name" required><Input required value={f.name} onChange={set('name')} disabled={!editable} /></FormRow>
          <FormRow label="Legal business name"><Input value={f.legal_name} onChange={set('legal_name')} disabled={!editable} /></FormRow>
          <FormRow label="Industry"><Input value={f.industry} onChange={set('industry')} disabled={!editable} placeholder="e.g. IT hardware, software & services" /></FormRow>
          <FormRow label="Email"><Input type="email" value={f.email} onChange={set('email')} disabled={!editable} /></FormRow>
          <FormRow label="Phone"><Input value={f.phone} onChange={set('phone')} disabled={!editable} /></FormRow>
          <FormRow label="Website"><Input value={f.website} onChange={set('website')} disabled={!editable} /></FormRow>
        </div>
        <div className="form-section">
          <h3>Address</h3>
          <FormRow label="Street"><div className="stack"><Input value={f.address.street1} onChange={setAddr('street1')} disabled={!editable} placeholder="Street 1" /><Input value={f.address.street2} onChange={setAddr('street2')} disabled={!editable} placeholder="Street 2" /></div></FormRow>
          <FormRow label="City / PIN"><div className="row"><Input value={f.address.city} onChange={setAddr('city')} disabled={!editable} placeholder="City" /><Input value={f.address.zip} onChange={setAddr('zip')} disabled={!editable} placeholder="PIN code" /></div></FormRow>
          <FormRow label="State"><Select value={f.state || ''} onChange={(v) => { set('state')(v); setAddr('state')(v); }} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select" disabled={!editable} /></FormRow>
          <FormRow label="Country"><Input value={f.country} onChange={(v) => { set('country')(v); setAddr('country')(v); }} disabled={!editable} /></FormRow>
        </div>
        <div className="form-section">
          <h3>Regional settings</h3>
          <FormRow label="Base currency" hint="Set before you record transactions."><Input value={f.currency} maxLength={3} onChange={(v) => set('currency')(v.toUpperCase())} disabled={!editable} /></FormRow>
          <FormRow label="Fiscal year starts"><Select value={f.fiscal_year_start} onChange={(v) => set('fiscal_year_start')(Number(v))} options={MONTHS.map((m, i) => [i + 1, m])} disabled={!editable} /></FormRow>
          <FormRow label="Time zone"><Input value={f.timezone} onChange={set('timezone')} disabled={!editable} /></FormRow>
          <FormRow label="Date format"><Select value={f.date_format} onChange={set('date_format')} options={[['dd/MM/yyyy', 'dd/MM/yyyy'], ['MM/dd/yyyy', 'MM/dd/yyyy'], ['yyyy-MM-dd', 'yyyy-MM-dd']]} disabled={!editable} /></FormRow>
        </div>
        <div className="form-section">
          <h3>Tax & compliance</h3>
          <FormRow label="GST registered"><Checkbox checked={f.gst_registered} onChange={set('gst_registered')} disabled={!editable}>This business is registered for GST</Checkbox></FormRow>
          {f.gst_registered && <FormRow label="GSTIN" required hint="15 characters, e.g. 33ABCDE1234F1Z5"><Input value={f.gstin} maxLength={15} onChange={(v) => set('gstin')(v.toUpperCase())} disabled={!editable} /></FormRow>}
          <FormRow label="PAN"><Input value={f.pan} maxLength={10} onChange={(v) => set('pan')(v.toUpperCase())} disabled={!editable} /></FormRow>
          {f.gst_registered && <FormRow label=""><div className="info-box small">Add your GST rates (e.g. GST5, GST12, GST18, GST28, IGST18) under <NavLink to="/settings/taxes">Taxes</NavLink>, and HSN/SAC codes on each item.</div></FormRow>}
        </div>
        <div className="form-section">
          <h3>Inventory preferences</h3>
          <FormRow label="Negative stock" hint="When off, sales, shipments and adjustments are blocked if there is not enough stock.">
            <Checkbox checked={f.allow_negative_stock} onChange={set('allow_negative_stock')} disabled={!editable}>Allow stock to go below zero</Checkbox>
          </FormRow>
          <FormRow label="Stock valuation" hint={f.valuation_method === 'wac'
            ? 'Weighted average: every unit of an item in a warehouse has the same cost — the average of everything you have in stock. It is recalculated each time stock comes in.'
            : 'FIFO: the oldest stock is sold first, at the price you paid for it.'}>
            <Select value={f.valuation_method || 'fifo'} disabled={!editable}
              onChange={async (v) => {
                const msg = v === 'wac'
                  ? 'Switch to weighted average cost? The stock you have now will be given its average cost when you save. Past sales keep the cost they had.'
                  : 'Switch to FIFO? From now on, new stock keeps its own purchase price and the oldest stock is used first. Current stock keeps its present (average) cost.';
                if (await confirmDialog({ message: msg, confirmText: 'Switch' })) set('valuation_method')(v);
              }}
              options={[['fifo', 'FIFO (First In, First Out)'], ['wac', 'Weighted average cost']]} />
          </FormRow>
          <FormRow label="Inventory start date" hint="Stock can't be recorded before this date — useful once you've entered opening stock, so old-dated entries can't change it. Leave empty for no limit.">
            <div className="row"><Input type="date" value={f.inventory_start_date ? String(f.inventory_start_date).slice(0, 10) : ''} onChange={(v) => set('inventory_start_date')(v || null)} disabled={!editable} />
              {f.inventory_start_date && editable && <button type="button" className="btn link small" onClick={() => set('inventory_start_date')(null)}>Clear</button>}</div>
          </FormRow>
          <FormRow label="Item names" hint="When off, two items can't have the same name (SKUs must always be different).">
            <Checkbox checked={f.allow_duplicate_item_names !== false} onChange={set('allow_duplicate_item_names')} disabled={!editable}>Allow more than one item with the same name</Checkbox>
          </FormRow>
        </div>
      </div></div>
      {editable && <div className="form-footer"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>}
    </form>
  );
}

// ------------------------------------------------------------------ generic simple list editor
function SimpleList({ title, endpoint, lookupKey, fields, columns, description, emptyText }: any) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi(endpoint);
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction(toast);
  const editable = can('settings', 'edit');
  const save = async () => {
    const r = await run(() => (editing.id ? api.put(`${endpoint}/${editing.id}`, editing) : api.post(endpoint, editing)), 'Saved');
    if (r) { setEditing(null); reload(); invalidateLookups(lookupKey); }
  };
  const remove = async (row) => {
    if (!(await confirmDialog({ message: `Delete ${row.name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`${endpoint}/${row.id}`), 'Deleted')) !== undefined) { reload(); invalidateLookups(lookupKey); }
  };
  const blank = Object.fromEntries(fields.map((f) => [f.key, f.default ?? '']));
  return (
    <>
      <PageHead title={title}>{editable && <button type="button" className="btn primary" onClick={() => setEditing(blank)}>+ New</button>}</PageHead>
      {description && <p className="muted" style={{ marginTop: 0 }}>{description}</p>}
      <ErrorBox error={error} />
      <div className="card">
        <table className="table">
          <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}{editable && <th />}</tr></thead>
          <tbody>
            {!data && <tr><td colSpan={columns.length + 1}><Spinner /></td></tr>}
            {data && data.length === 0 && <tr><td colSpan={columns.length + 1} className="faint">{emptyText || 'Nothing here yet.'}</td></tr>}
            {data?.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(row) : row[c.key]}</td>)}
                {editable && <td className="num nowrap"><button type="button" className="btn sm ghost" onClick={() => setEditing(row)}>Edit</button><button type="button" className="btn sm ghost danger" onClick={() => remove(row)}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : `New ${title.replace(/s$/, '').toLowerCase()}`} onClose={() => setEditing(null)}
          footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
          <div className="stack">
            {fields.map((fd) => (
              <Field key={fd.key} label={fd.type === 'checkbox' ? '' : fd.label} required={fd.required} hint={fd.hint}>
                {fd.type === 'checkbox' ? <Checkbox checked={editing[fd.key]} onChange={(v) => setEditing({ ...editing, [fd.key]: v })}>{fd.label}</Checkbox>
                  : fd.options ? <Select value={editing[fd.key]} onChange={(v) => setEditing({ ...editing, [fd.key]: v })} options={fd.options} />
                    : <Input type={fd.type || 'text'} value={editing[fd.key]} onChange={(v) => setEditing({ ...editing, [fd.key]: v })} autoFocus={fd === fields[0]} />}
              </Field>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

const Taxes = () => (
  <SimpleList title="Taxes" endpoint="/settings/taxes" lookupKey="taxes"
    description="Tax rates applied on item lines. For India GST, create rates such as GST5, GST12, GST18, GST28 (intra-state CGST+SGST) and IGST equivalents for inter-state supplies."
    emptyText="No taxes yet. Add the rates you charge (e.g. GST18 at 18%)."
    fields={[{ key: 'name', label: 'Tax name', required: true }, { key: 'rate', label: 'Rate (%)', type: 'number', required: true },
      { key: 'kind', label: 'Type', options: [['tax', 'Tax (GST/VAT)'], ['tds', 'TDS'], ['tcs', 'TCS']], default: 'tax' }, { key: 'is_active', label: 'Active', type: 'checkbox', default: true }]}
    columns={[{ key: 'name', label: 'Name' }, { key: 'rate', label: 'Rate', num: true, render: (r) => `${Number(r.rate)}%` }, { key: 'kind', label: 'Type', render: (r) => r.kind.toUpperCase() },
      { key: 'is_active', label: 'Status', render: (r) => <Badge status={r.is_active ? 'active' : 'inactive'} /> }]} />
);

const Units = () => (
  <SimpleList title="Units" endpoint="/settings/units" lookupKey="units" description="Units of measure used on items (pcs, box, kg, licence, hrs…)."
    fields={[{ key: 'name', label: 'Unit', required: true }]} columns={[{ key: 'name', label: 'Unit' }]} />
);

const Carriers = () => (
  <SimpleList title="Shipping Carriers" endpoint="/settings/carriers" lookupKey="carriers"
    description="Carriers you ship with (Delhivery, Blue Dart, DTDC, India Post, Shiprocket…). Add a tracking URL with {tracking} to get clickable tracking links."
    fields={[{ key: 'name', label: 'Carrier name', required: true }, { key: 'tracking_url', label: 'Tracking URL', hint: 'e.g. https://www.delhivery.com/track/package/{tracking}' }, { key: 'is_active', label: 'Active', type: 'checkbox', default: true }]}
    columns={[{ key: 'name', label: 'Carrier' }, { key: 'tracking_url', label: 'Tracking URL', render: (r) => <span className="small mono">{r.tracking_url}</span> },
      { key: 'is_active', label: 'Status', render: (r) => <Badge status={r.is_active ? 'active' : 'inactive'} /> }]} />
);

// ------------------------------------------------------------------ warehouses
function Warehouses() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi('/settings/warehouses');
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction(toast);
  const editable = can('settings', 'edit');
  const done = () => { reload(); invalidateLookups('warehouses'); };
  const save = async () => {
    const r = await run(() => (editing.id ? api.put(`/settings/warehouses/${editing.id}`, editing) : api.post('/settings/warehouses', editing)), 'Warehouse saved');
    if (r) { setEditing(null); done(); }
  };
  const remove = async (w) => {
    if (!(await confirmDialog({ message: `Delete ${w.name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/settings/warehouses/${w.id}`), 'Warehouse deleted')) !== undefined) done();
  };
  const primary = async (w) => { if (await run(() => api.post(`/settings/warehouses/${w.id}/primary`), `${w.name} is now the primary warehouse`)) done(); };
  const a = editing?.address || {};
  const setA = (k) => (v) => setEditing({ ...editing, address: { ...a, [k]: v } });
  return (
    <>
      <PageHead title="Warehouses">{editable && <button type="button" className="btn primary" onClick={() => setEditing({ name: '', code: '', address: { country: 'India' }, status: 'active' })}>+ New warehouse</button>}</PageHead>
      <p className="muted" style={{ marginTop: 0 }}>Stock is tracked separately for each warehouse. Use transfer orders to move stock between them.</p>
      <ErrorBox error={error} />
      <div className="card"><table className="table">
        <thead><tr><th>Name</th><th>Address</th><th>Contact</th><th className="num">Items in stock</th><th className="num">Stock value</th><th>Status</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data && <tr><td colSpan={7}><Spinner /></td></tr>}
          {data?.map((w) => (
            <tr key={w.id}>
              <td className="bold">{w.name} {w.is_primary && <Badge status="approved">Primary</Badge>}<div className="small faint">{w.code}</div></td>
              <td className="small">{[w.address?.street1, w.address?.city, w.address?.state].filter(Boolean).join(', ')}</td>
              <td className="small">{w.contact_person}<div>{w.phone}</div></td>
              <td className="num">{w.item_count}</td><td className="num">{money(w.stock_value)}</td>
              <td><Badge status={w.status} /></td>
              {editable && <td className="num nowrap">
                <button type="button" className="btn sm ghost" onClick={() => setEditing(w)}>Edit</button>
                {!w.is_primary && w.status === 'active' && <button type="button" className="btn sm ghost" onClick={() => primary(w)}>Make primary</button>}
                {!w.is_primary && <button type="button" className="btn sm ghost danger" onClick={() => remove(w)}>Delete</button>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'New warehouse'} onClose={() => setEditing(null)}
          footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
          <div className="grid-2">
            <Field label="Warehouse name" required><Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} autoFocus /></Field>
            <Field label="Code"><Input value={editing.code} onChange={(v) => setEditing({ ...editing, code: v })} /></Field>
            <Field label="Street"><Input value={a.street1} onChange={setA('street1')} /></Field>
            <Field label="City"><Input value={a.city} onChange={setA('city')} /></Field>
            <Field label="State"><Select value={a.state || ''} onChange={setA('state')} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select" /></Field>
            <Field label="PIN code"><Input value={a.zip} onChange={setA('zip')} /></Field>
            <Field label="Contact person"><Input value={editing.contact_person} onChange={(v) => setEditing({ ...editing, contact_person: v })} /></Field>
            <Field label="Phone"><Input value={editing.phone} onChange={(v) => setEditing({ ...editing, phone: v })} /></Field>
            <Field label="Email"><Input type="email" value={editing.email} onChange={(v) => setEditing({ ...editing, email: v })} /></Field>
            <Field label="Status"><Select value={editing.status} onChange={(v) => setEditing({ ...editing, status: v })} options={[['active', 'Active'], ['inactive', 'Inactive']]} disabled={editing.is_primary} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ numbering
const DOC_NAMES = {
  estimate: 'Estimate', sales_order: 'Sales Order', delivery_challan: 'Delivery Challan', package: 'Package', shipment: 'Shipment',
  invoice: 'Invoice', payment_received: 'Payment Received', sales_return: 'Sales Return', credit_note: 'Credit Note',
  purchase_order: 'Purchase Order', purchase_receive: 'Purchase Receive', bill: 'Bill', payment_made: 'Payment Made', vendor_credit: 'Vendor Credit',
  inventory_adjustment: 'Inventory Adjustment', stock_count: 'Stock Count', transfer_order: 'Transfer Order', assembly: 'Assembly', picklist: 'Picklist',
};
function Numbering() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi('/settings/numbering');
  const [rows, setRows] = useState({});
  const [, run] = useAction(toast);
  useEffect(() => { if (data) setRows(Object.fromEntries(data.map((s) => [s.doc_type, s]))); }, [data]);
  if (!data) return <Spinner />;
  const save = async (t) => { if (await run(() => api.put(`/settings/numbering/${t}`, rows[t]), `${DOC_NAMES[t]} numbering saved`)) reload(); };
  const editable = can('settings', 'edit');
  return (
    <>
      <PageHead title="Transaction Number Series" />
      <p className="muted" style={{ marginTop: 0 }}>Prefix and next number used when a new document is created. Changing the next number does not renumber existing documents.</p>
      <div className="card"><table className="table">
        <thead><tr><th>Document</th><th style={{ width: 140 }}>Prefix</th><th style={{ width: 140 }}>Next number</th><th style={{ width: 110 }}>Digits</th><th>Preview</th>{editable && <th />}</tr></thead>
        <tbody>{data.map((s) => {
          const r = rows[s.doc_type] || s;
          const up = (k, v) => setRows({ ...rows, [s.doc_type]: { ...r, [k]: v } });
          return (
            <tr key={s.doc_type}>
              <td>{DOC_NAMES[s.doc_type] || label(s.doc_type)}</td>
              <td><input className="input" value={r.prefix} disabled={!editable} onChange={(e) => up('prefix', e.target.value)} /></td>
              <td><input className="input num" type="number" min="1" value={r.next_number} disabled={!editable} onChange={(e) => up('next_number', e.target.value)} /></td>
              <td><input className="input num" type="number" min="1" max="10" value={r.padding} disabled={!editable} onChange={(e) => up('padding', e.target.value)} /></td>
              <td className="mono">{`${r.prefix}${String(r.next_number).padStart(Number(r.padding) || 1, '0')}`}</td>
              {editable && <td><button type="button" className="btn sm" onClick={() => save(s.doc_type)}>Save</button></td>}
            </tr>
          );
        })}</tbody>
      </table></div>
    </>
  );
}

// ------------------------------------------------------------------ users & roles
function Users() {
  const { user, can } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi('/settings/users');
  const roles = useApi('/settings/roles');
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction(toast);
  const inviteLink = (token) => `${window.location.origin}/invite/${token}`;
  const copy = async (token) => {
    try { await navigator.clipboard.writeText(inviteLink(token)); toast('Invitation link copied'); } catch { window.prompt('Copy this invitation link', inviteLink(token)); }
  };
  const save = async () => {
    const r = await run(() => (editing.id ? api.put(`/settings/users/${editing.id}`, editing) : api.post('/settings/users', editing)), editing.id ? 'User updated' : 'User invited');
    if (r) {
      setEditing(null); reload();
      if (r.invite_token) { copy(r.invite_token); }
    }
  };
  const remove = async (u) => {
    if (!(await confirmDialog({ message: `Remove ${u.name} (${u.email}) from this organization?`, danger: true, confirmText: 'Remove' }))) return;
    if ((await run(() => api.del(`/settings/users/${u.id}`), 'User removed')) !== undefined) reload();
  };
  const resetLink = async (u) => { const r = await run(() => api.post(`/settings/users/${u.id}/reset-link`), 'Password reset link created'); if (r) copy(r.invite_token); };
  const reinvite = async (u) => { const r = await run(() => api.post(`/settings/users/${u.id}/reinvite`), 'New invitation link created'); if (r) { reload(); copy(r.invite_token); } };
  const admin = user.is_admin;
  return (
    <>
      <PageHead title="Users">{admin && <button type="button" className="btn primary" onClick={() => setEditing({ name: '', email: '', role_id: roles.data?.find((r) => !r.is_admin)?.id || '' })}>+ Invite user</button>}</PageHead>
      <p className="muted" style={{ marginTop: 0 }}>Invited users get a personal link to set their password. Send the copied link to them by email or chat.</p>
      <div className="card"><table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th>{admin && <th />}</tr></thead>
        <tbody>
          {!data && <tr><td colSpan={6}><Spinner /></td></tr>}
          {data?.map((u) => (
            <tr key={u.id}>
              <td className="bold">{u.name}{u.id === user.id && <span className="faint"> (you)</span>}</td><td>{u.email}</td><td>{u.role_name}</td>
              <td><Badge status={u.status} /></td><td className="small">{u.last_login_at ? dateTime(u.last_login_at) : '—'}</td>
              {admin && <td className="num nowrap">
                {u.status === 'invited' && u.invite_token && <button type="button" className="btn sm ghost" onClick={() => copy(u.invite_token)}>Copy invite link</button>}
                {u.status === 'invited' && <button type="button" className="btn sm ghost" onClick={() => reinvite(u)}>New link</button>}
                {u.status === 'active' && u.id !== user.id && <button type="button" className="btn sm ghost" onClick={() => resetLink(u)} title="Creates a one-time link the user can open to choose a new password">Password reset link</button>}
                {u.id !== user.id && <button type="button" className="btn sm ghost" onClick={() => setEditing(u)}>Edit</button>}
                {u.id !== user.id && can('users', 'delete') && <button type="button" className="btn sm ghost danger" onClick={() => remove(u)}>Remove</button>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'Invite user'} onClose={() => setEditing(null)}
          footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>{editing.id ? 'Save' : 'Invite'}</button></>}>
          <div className="stack">
            <Field label="Name" required><Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} autoFocus /></Field>
            <Field label="Email" required><Input type="email" value={editing.email} disabled={!!editing.id} onChange={(v) => setEditing({ ...editing, email: v })} /></Field>
            <Field label="Role" required><Select value={editing.role_id} onChange={(v) => setEditing({ ...editing, role_id: Number(v) })} options={(roles.data || []).map((r) => [r.id, r.name])} placeholder="Select a role" /></Field>
            {editing.id && editing.status !== 'invited' && <Field label="Status"><Select value={editing.status} onChange={(v) => setEditing({ ...editing, status: v })} options={[['active', 'Active'], ['inactive', 'Inactive']]} /></Field>}
          </div>
        </Modal>
      )}
    </>
  );
}

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'import'];
function Roles() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi('/settings/roles');
  const catalog = useApi('/settings/permission-catalog');
  const [editing, setEditing] = useState(null);
  const [busy, run] = useAction(toast);
  const save = async () => {
    const r = await run(() => (editing.id ? api.put(`/settings/roles/${editing.id}`, editing) : api.post('/settings/roles', editing)), 'Role saved');
    if (r) { setEditing(null); reload(); }
  };
  const remove = async (r) => {
    if (!(await confirmDialog({ message: `Delete role ${r.name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/settings/roles/${r.id}`), 'Role deleted')) !== undefined) reload();
  };
  const toggle = (mod, act, on) => {
    const cur = new Set(editing.permissions[mod] || []);
    if (on) { cur.add(act); if (act !== 'view') cur.add('view'); } else { cur.delete(act); if (act === 'view') cur.clear(); }
    setEditing({ ...editing, permissions: { ...editing.permissions, [mod]: [...cur] } });
  };
  return (
    <>
      <PageHead title="Roles">{user.is_admin && <button type="button" className="btn primary" onClick={() => setEditing({ name: '', description: '', permissions: {} })}>+ New role</button>}</PageHead>
      <div className="card"><table className="table">
        <thead><tr><th>Role</th><th>Description</th><th className="num">Users</th>{user.is_admin && <th />}</tr></thead>
        <tbody>{data?.map((r) => (
          <tr key={r.id}><td className="bold">{r.name}</td><td className="small">{r.description}</td><td className="num">{r.user_count}</td>
            {user.is_admin && <td className="num nowrap">{!r.is_admin && <><button type="button" className="btn sm ghost" onClick={() => setEditing(r)}>Edit permissions</button><button type="button" className="btn sm ghost danger" onClick={() => remove(r)}>Delete</button></>}</td>}</tr>
        ))}</tbody>
      </table></div>
      {editing && catalog.data && (
        <Modal wide title={editing.id ? `Role: ${editing.name}` : 'New role'} onClose={() => setEditing(null)}
          footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
          <div className="grid-2 mb">
            <Field label="Role name" required><Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} /></Field>
            <Field label="Description"><Textarea rows={1} value={editing.description} onChange={(v) => setEditing({ ...editing, description: v })} /></Field>
          </div>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <table className="table compact perm-table">
              <thead><tr><th>Module</th>{ACTIONS.map((a) => <th key={a}>{label(a)}</th>)}</tr></thead>
              <tbody>{Object.entries(catalog.data as Record<string, any[]>).map(([mod, acts]) => (
                <tr key={mod}><td>{label(mod)}</td>
                  {ACTIONS.map((a) => <td key={a}>{acts.includes(a) ? <input type="checkbox" checked={(editing.permissions[mod] || []).includes(a)} onChange={(e) => toggle(mod, a, e.target.checked)} aria-label={`${mod} ${a}`} /> : ''}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

function AuditLog() {
  return (
    <>
      <PageHead title="Activity Logs & Audit Trail" />
      <DataTable endpoint="/settings/audit-logs" exportName="audit-log" perPage={50} searchPlaceholder="Search activity"
        filters={[{ key: 'entity_type', label: 'Record type', options: [['', 'All records'], ...['item', 'customer', 'vendor', 'sales_order', 'invoice', 'package', 'shipment', 'payments_received', 'sales_return', 'credit_note', 'purchase_order', 'purchase_receive', 'bill', 'payments_made', 'vendor_credit', 'inventory_adjustment', 'transfer_order', 'assembly', 'warehouse', 'user', 'role', 'organization'].map((t) => [t, label(t)])] }]}
        emptyTitle="No activity yet"
        columns={[
          { key: 'created_at', label: 'Date & time', sort: 'date', render: (r) => dateTime(r.created_at) },
          { key: 'user_name', label: 'User', render: (r) => r.user_name || 'System' },
          { key: 'action', label: 'Action', render: (r) => <Badge status={r.action === 'delete' || r.action === 'void' ? 'void' : r.action === 'create' ? 'active' : 'confirmed'}>{r.action}</Badge> },
          { key: 'entity_type', label: 'Record', render: (r) => label(r.entity_type) },
          { key: 'summary', label: 'Details' },
        ]} />
    </>
  );
}

// ------------------------------------------------------------------ shell
const LINKS = [
  ['organization', 'Organization profile'], ['branding', 'Branding'], ['warehouses', 'Warehouses'], ['taxes', 'Taxes'], ['units', 'Units'], ['numbering', 'Number series'], ['custom-fields', 'Custom fields'], ['reporting-tags', 'Reporting tags'], ['templates', 'PDF templates'], ['workflows', 'Workflow rules'],
  ['carriers', 'Shipping carriers'], ['email', 'Email'], ['announcements', 'Announcements'], ['integrations', 'Integrations'],
  ['developer', 'API keys & webhooks', 'users'], ['users', 'Users', 'users'], ['roles', 'Roles & permissions', 'users'], ['audit', 'Audit log', 'reports'],
];

function AnnouncementsAdmin() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/announcements', { per_page: 100 });
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ title: '', body: '', status: 'published', pinned: false });
  const editable = can('settings', 'edit');
  const save = async () => {
    if ((await run(() => api.post('/announcements', f), 'Announcement published')) !== undefined) {
      setShow(false); setF({ title: '', body: '', status: 'published', pinned: false }); reload();
    }
  };
  const archive = async (a) => {
    if ((await run(() => api.put(`/announcements/${a.id}`, { ...a, status: 'archived' }), 'Announcement archived')) !== undefined) reload();
  };
  const remove = async (a) => {
    if (!(await confirmDialog({ message: `Delete “${a.title}”?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/announcements/${a.id}`), 'Deleted')) !== undefined) reload();
  };
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="Announcements">
        {editable && <button type="button" className="btn primary" onClick={() => setShow(true)}>+ New announcement</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>Post notices for your team. They appear under the megaphone icon in the top bar (like Zoho’s announcements).</p>
      {show && (
        <div className="card mb"><div className="card-body stack">
          <Field label="Title" required><Input value={f.title} onChange={(v) => setF({ ...f, title: v })} autoFocus /></Field>
          <Field label="Message"><Textarea value={f.body} onChange={(v) => setF({ ...f, body: v })} rows={5} /></Field>
          <div className="grid-2">
            <Field label="Status"><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']]} /></Field>
            <label className="checkbox" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to top</label>
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !f.title} onClick={save}>Save</button>
            <button type="button" className="btn" onClick={() => setShow(false)}>Cancel</button>
          </div>
        </div></div>
      )}
      <div className="card"><table className="table">
        <thead><tr><th>Title</th><th>Status</th><th>Published</th><th>Reads</th><th>By</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.data?.length && <tr><td colSpan={6} className="faint center">No announcements yet.</td></tr>}
          {(data.data || []).map((a) => (
            <tr key={a.id}>
              <td><span className="bold">{a.title}</span>{a.pinned && <span className="badge" style={{ marginLeft: 8 }}>Pinned</span>}<div className="small faint" style={{ whiteSpace: 'pre-wrap' }}>{(a.body || '').slice(0, 120)}</div></td>
              <td><Badge status={a.status} /></td>
              <td>{a.published_at ? dateTime(a.published_at) : '—'}</td>
              <td>{a.read_count ?? 0}</td>
              <td>{a.created_by_name}</td>
              {editable && (
                <td className="right">
                  {a.status !== 'archived' && <button type="button" className="btn sm" disabled={busy} onClick={() => archive(a)}>Archive</button>}
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(a)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

export default function Settings() {
  const { can } = useAuth();
  return (
    <div className="page">
      <div className="grid-2" style={{ gridTemplateColumns: '220px minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-head"><h3>Settings</h3></div>
          <div className="settings-nav">
            {LINKS.filter(([, , perm]) => !perm || can(perm)).map(([to, text]) => (
              <NavLink key={to} to={`/settings/${to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{text}</NavLink>
            ))}
          </div>
        </div>
        <div>
          <Routes>
            <Route index element={<Navigate to="organization" replace />} />
            <Route path="organization" element={<Organization />} />
            <Route path="branding" element={<BrandingSettings />} />
            <Route path="custom-fields" element={<CustomFieldsSettings />} />
            <Route path="reporting-tags" element={<ReportingTagsSettings />} />
            <Route path="templates" element={<TemplatesSettings />} />
            <Route path="workflows" element={<WorkflowSettings />} />
            <Route path="warehouses" element={<Warehouses />} />
            <Route path="taxes" element={<Taxes />} />
            <Route path="units" element={<Units />} />
            <Route path="numbering" element={<Numbering />} />
            <Route path="carriers" element={<Carriers />} />
            <Route path="email" element={<EmailSettings />} />
            <Route path="announcements" element={<AnnouncementsAdmin />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="developer" element={<Developer />} />
            <Route path="users" element={<Users />} />
            <Route path="roles" element={<Roles />} />
            <Route path="audit" element={<AuditLog />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const saveName = async () => { if (await run(() => api.put('/auth/me', { name }), 'Profile updated')) refresh(); };
  const savePw = async () => {
    if (pw.new_password !== pw.confirm) { toast('New passwords do not match', 'error'); return; }
    if (await run(() => api.post('/auth/change-password', pw), 'Password changed')) setPw({ current_password: '', new_password: '', confirm: '' });
  };
  return (
    <div className="page narrow">
      <PageHead title="My Profile" />
      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>Details</h3></div><div className="card-body stack">
          <Field label="Name"><Input value={name} onChange={setName} /></Field>
          <Field label="Email"><Input value={user.email} disabled onChange={() => {}} /></Field>
          <Field label="Role"><Input value={user.role_name} disabled onChange={() => {}} /></Field>
          <div><button type="button" className="btn primary" disabled={busy} onClick={saveName}>Save</button></div>
        </div></div>
        <div className="card"><div className="card-head"><h3>Change password</h3></div><div className="card-body stack">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(v) => setPw({ ...pw, current_password: v })} /></Field>
          <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(v) => setPw({ ...pw, new_password: v })} /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} /></Field>
          <div><button type="button" className="btn primary" disabled={busy || !pw.current_password || pw.new_password.length < 8} onClick={savePw}>Change password</button></div>
        </div></div>
      </div>
    </div>
  );
}
