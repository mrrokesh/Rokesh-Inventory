import { useEffect, useRef, useState } from 'react';
import { api, mediaUrl } from '../api';
import { useAuth } from '../auth';
import { invalidateLookups, useLookups } from '../lib/lookups';
import { label, today } from '../lib/format';
import { Badge, Checkbox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';
import { DOCS } from './docs/config';
import { DocPaper, TEMPLATE_DEFAULTS } from './docs/DocDetail';

const TYPE_LABELS = {
  text: 'Text (single line)', textarea: 'Text (multi-line)', number: 'Number', decimal: 'Decimal', date: 'Date', checkbox: 'Checkbox (yes/no)',
  dropdown: 'Dropdown', email: 'Email', url: 'Website / URL', phone: 'Phone',
};

// ------------------------------------------------------------------ custom fields
const EMPTY_FIELD = { label: '', field_type: 'text', options: '', required: false, default_value: '', pattern: '', pattern_message: '', help_text: '', show_in_pdf: true, show_in_list: false, is_active: true, position: 0 };

export function CustomFieldsSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const meta = useApi('/settings/custom-fields/meta');
  const [entity, setEntity] = useState('item');
  const { data, reload } = useApi('/settings/custom-fields', { entity }, [entity]);
  const [edit, setEdit] = useState(null);
  const editable = can('settings', 'edit');
  if (!meta.data || !data) return <Spinner />;
  const entities = meta.data.entities;
  const refresh = () => { reload(); invalidateLookups('customFields'); };
  const save = async () => {
    const body = { ...edit, entity, options: typeof edit.options === 'string' ? edit.options : (edit.options || []).join('\n') };
    const ok = await run(() => (edit.id ? api.put(`/settings/custom-fields/${edit.id}`, body) : api.post('/settings/custom-fields', body)), 'Custom field saved');
    if (ok) { setEdit(null); refresh(); }
  };
  const remove = async (f) => {
    if (!(await confirmDialog({ message: `Delete the field “${f.label}”? Values already entered stay saved on records but will no longer be shown. To hide it temporarily, mark it inactive instead.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/settings/custom-fields/${f.id}`), 'Custom field deleted')) !== undefined) refresh();
  };
  const toggle = async (f) => {
    if ((await run(() => api.put(`/settings/custom-fields/${f.id}`, { ...f, is_active: !f.is_active }), f.is_active ? 'Field hidden' : 'Field shown')) !== undefined) refresh();
  };
  const set = (k) => (v) => setEdit((x) => ({ ...x, [k]: v }));
  return (
    <>
      <PageHead title="Custom Fields">
        {editable && <button type="button" className="btn primary" onClick={() => setEdit({ ...EMPTY_FIELD, position: data.length })}>+ New custom field</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>
        Add your own fields when the standard ones are not enough — for example a warranty period on items, a vehicle number on delivery challans or a project code on purchase orders.
        Fields appear on the form, on the record’s page and (if you choose) on the printed PDF.
      </p>
      <div className="row mb" style={{ gap: 8 }}>
        <span className="muted">Fields for</span>
        <div style={{ width: 220 }}><Select value={entity} onChange={setEntity} options={Object.entries(entities)} /></div>
      </div>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Field name</th><th>Data type</th><th>Mandatory</th><th>Show in PDF</th><th>Status</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.length && <tr><td colSpan={6} className="faint center" style={{ padding: 32 }}>No custom fields for {entities[entity].toLowerCase()} yet. Click “New custom field” to add one.</td></tr>}
          {data.map((f) => (
            <tr key={f.id}>
              <td><span className="bold">{f.label}</span>{f.help_text && <div className="small faint">{f.help_text}</div>}</td>
              <td>{TYPE_LABELS[f.field_type]}{f.field_type === 'dropdown' && <div className="small faint">{(f.options || []).join(', ')}</div>}</td>
              <td>{f.required ? 'Yes' : 'No'}</td>
              <td>{f.show_in_pdf ? 'Yes' : 'No'}</td>
              <td><Badge status={f.is_active ? 'active' : 'inactive'} /></td>
              {editable && (
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn sm" onClick={() => setEdit({ ...f, options: (f.options || []).join('\n'), default_value: f.default_value || '', pattern: f.pattern || '', pattern_message: f.pattern_message || '', help_text: f.help_text || '' })}>Edit</button>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(f)}>{f.is_active ? 'Hide' : 'Show'}</button>
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(f)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table></div>
      {edit && (
        <Modal title={edit.id ? `Edit “${edit.label}”` : `New custom field — ${entities[entity]}`} onClose={() => setEdit(null)}
          footer={<><button type="button" className="btn primary" disabled={busy || !edit.label} onClick={save}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></>}>
          <div className="stack">
            <Field label="Label" required hint="The name people see on the form, e.g. “Warranty (months)”."><Input value={edit.label} onChange={set('label')} autoFocus /></Field>
            <Field label="Data type"><Select value={edit.field_type} onChange={set('field_type')} options={meta.data.types.map((t) => [t, TYPE_LABELS[t] || label(t)])} /></Field>
            {edit.field_type === 'dropdown' && <Field label="Choices" required hint="One choice per line."><Textarea rows={4} value={edit.options} onChange={set('options')} /></Field>}
            {edit.field_type === 'checkbox'
              ? <Checkbox checked={edit.default_value === 'true'} onChange={(v) => set('default_value')(v ? 'true' : '')}>Ticked by default</Checkbox>
              : <Field label="Default value" hint="Filled in automatically on new records. Leave blank for none."><Input value={edit.default_value} onChange={set('default_value')} /></Field>}
            <Field label="Help text" hint="A short tip shown under the field."><Input value={edit.help_text} onChange={set('help_text')} /></Field>
            {['text', 'phone'].includes(edit.field_type) && (
              <div className="grid-2">
                <Field label="Format rule (optional)" hint="Advanced: a regular expression, e.g. [A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4} for a vehicle number."><Input value={edit.pattern} onChange={set('pattern')} /></Field>
                <Field label="Message when the format is wrong"><Input value={edit.pattern_message} onChange={set('pattern_message')} /></Field>
              </div>
            )}
            <Checkbox checked={edit.required} onChange={set('required')}>Mandatory — a record can’t be saved without it</Checkbox>
            <Checkbox checked={edit.show_in_pdf} onChange={set('show_in_pdf')}>Show on printed / emailed PDF</Checkbox>
            <Checkbox checked={edit.is_active} onChange={set('is_active')}>Active</Checkbox>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ PDF templates
const TEMPLATE_TYPES: any[] = Object.values(DOCS).filter((d: any) => d.entity).map((d: any) => [d.entity, d.title, d]);

// Display-only sample used for the live preview (never saved anywhere).
function sampleDoc(cfg) {
  const lines = [
    { id: 1, item_name: 'Wireless Keyboard', item_sku: 'KB-200', item_unit: 'pcs', hsn_sac: '8471', description: 'Slim, 2.4 GHz', quantity: 2, rate: 1450, discount_percent: 5, tax_rate: 18, amount: 2900 },
    { id: 2, item_name: 'Installation service', item_sku: 'SRV-01', item_unit: 'hrs', hsn_sac: '998713', quantity: 1, rate: 800, discount_percent: 0, tax_rate: 18, amount: 800 },
  ];
  const sub = 3700;
  return {
    number: `${(cfg.one || 'DOC').slice(0, 3).toUpperCase()}-00001`, doc_date: today(), status: 'sent', contact_id: 0, contact_name: cfg.contactType === 'vendor' ? 'Sample Vendor' : 'Sample Customer',
    billing_address: { street1: '12 Market Road', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' }, shipping_address: {}, lines, reference: 'REF-1', place_of_supply: 'Tamil Nadu',
    discount_percent: 0, discount_total: 0, sub_total: sub, shipping_charge: 0, adjustment: 0, total: sub * 1.18, balance: sub * 1.18, amount_paid: 0, credits_applied: 0,
    notes: 'Thank you for your business.', terms: '', custom_fields: {},
  };
}

export function TemplatesSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { organization: org, templates } = useLookups('organization', 'templates');
  const [docType, setDocType] = useState('invoice');
  const [t, setT] = useState(null);
  const editable = can('settings', 'edit');
  useEffect(() => { if (templates) setT({ ...TEMPLATE_DEFAULTS, ...(templates[docType] || {}) }); }, [templates, docType]);
  if (!templates || !t) return <Spinner />;
  const entry = TEMPLATE_TYPES.find((x) => x[0] === docType);
  const cfg = entry?.[2];
  const set = (k) => (v) => setT((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await run(() => api.put(`/settings/templates/${docType}`, t), 'Template saved')) invalidateLookups('templates'); };
  const reset = () => setT({ ...TEMPLATE_DEFAULTS });
  const toggles = [
    ['show_logo', 'Organization logo'], ['show_org_address', 'Organization address & email'], ['show_sku', 'Item SKU'], ['show_hsn', 'HSN / SAC column'],
    ['show_unit', 'Unit next to quantity'], ['show_discount', 'Discount column'], ['show_tax_column', 'Tax % column'], ['show_custom_fields', 'Custom fields'], ['show_signature', 'Signature block'],
  ];
  return (
    <>
      <PageHead title="PDF Templates" />
      <p className="muted" style={{ marginTop: 0 }}>Choose how each document looks when printed, saved as PDF or emailed. Changes apply to all documents of that type, including ones already created.</p>
      <div className="grid-2" style={{ gridTemplateColumns: '200px minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="card"><div className="settings-nav">
          {TEMPLATE_TYPES.map(([k, title]: any) => <a key={k} href="#" className={docType === k ? 'active' : ''} onClick={(e) => { e.preventDefault(); setDocType(k); }}>{title}</a>)}
        </div></div>
        <div className="stack">
          <div className="card"><div className="card-body stack">
            <div className="grid-3">
              <Field label="Layout"><Select value={t.layout} onChange={set('layout')} options={[['standard', 'Standard'], ['compact', 'Compact (fits more lines)'], ['modern', 'Modern (coloured header)']]} disabled={!editable} /></Field>
              <Field label="Font size"><Select value={t.font_size} onChange={set('font_size')} options={[['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']]} disabled={!editable} /></Field>
              <Field label="Accent colour" hint={t.accent_color ? '' : `Using the brand colour${org?.brand_color ? ` (${org.brand_color})` : ''}`}>
                <div className="row">
                  <input type="color" value={t.accent_color || org?.brand_color || '#408dfb'} onChange={(e) => set('accent_color')(e.target.value)} disabled={!editable} style={{ width: 44, height: 34, padding: 2 }} />
                  {t.accent_color && <button type="button" className="btn link small" onClick={() => set('accent_color')('')}>Use brand colour</button>}
                </div>
              </Field>
              <Field label="Document title" hint={`Default: ${cfg?.printTitle}`}><Input value={t.title} onChange={set('title')} placeholder={cfg?.printTitle} disabled={!editable} /></Field>
              <Field label="Signature label"><Input value={t.signature_label} onChange={set('signature_label')} disabled={!editable} /></Field>
            </div>
            <div>
              <div className="small muted mb">Show on the document</div>
              <div className="grid-3">{toggles.map(([k, l]) => <Checkbox key={k} checked={t[k]} onChange={set(k)} disabled={!editable}>{l}</Checkbox>)}</div>
            </div>
            <div className="grid-2">
              <Field label="Header note" hint="Shown under the title, e.g. “Subject to Chennai jurisdiction”."><Textarea rows={2} value={t.header_note} onChange={set('header_note')} disabled={!editable} /></Field>
              <Field label="Footer note" hint="Shown at the bottom of every page."><Textarea rows={2} value={t.footer_note} onChange={set('footer_note')} disabled={!editable} /></Field>
              <Field label="Bank details" hint="Account name, number, IFSC, UPI ID — so customers know where to pay."><Textarea rows={3} value={t.bank_details} onChange={set('bank_details')} disabled={!editable} /></Field>
              <div className="stack">
                <Field label="Default notes" hint="Pre-filled on new documents; can be changed per document."><Textarea rows={2} value={t.default_notes} onChange={set('default_notes')} disabled={!editable} /></Field>
                <Field label="Default terms & conditions"><Textarea rows={2} value={t.default_terms} onChange={set('default_terms')} disabled={!editable} /></Field>
              </div>
            </div>
            {editable && (
              <div className="row">
                <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
                <button type="button" className="btn" onClick={reset}>Reset to default</button>
              </div>
            )}
          </div></div>
          {cfg && (
            <div>
              <div className="small muted mb">Live preview (sample data — nothing is saved)</div>
              <div style={{ pointerEvents: 'none' }}><DocPaper cfg={cfg} doc={{ ...sampleDoc(cfg), notes: t.default_notes || 'Thank you for your business.', terms: t.default_terms }} org={org} template={t} preview /></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ branding
export function BrandingSettings() {
  const { can, refresh } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const sigInput = useRef(null);
  const [org, setOrg] = useState(null);
  const editable = can('settings', 'edit');
  useEffect(() => { api.get('/settings/organization').then(setOrg).catch(() => {}); }, []);
  if (!org) return <Spinner />;
  const saveColour = async (c) => {
    const r = await run(() => api.put('/settings/organization', { ...org, brand_color: c }), c ? 'Brand colour saved' : 'Brand colour reset');
    if (r) { setOrg(r); invalidateLookups('organization'); refresh(); }
  };
  const uploadSig = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await run(() => api.upload('/settings/organization/signature', fd), 'Signature uploaded');
    if (r) { setOrg((o) => ({ ...o, signature_path: r.signature_path })); invalidateLookups('organization'); }
  };
  const removeSig = async () => {
    if ((await run(() => api.del('/settings/organization/signature'), 'Signature removed')) !== undefined) { setOrg((o) => ({ ...o, signature_path: null })); invalidateLookups('organization'); }
  };
  return (
    <>
      <PageHead title="Branding" />
      <div className="card mb"><div className="card-body stack">
        <div>
          <h3 style={{ margin: 0 }}>Brand colour</h3>
          <p className="muted small">Used for buttons and highlights in the app, and as the accent colour on your PDFs (each template can override it).</p>
          <div className="row">
            <input type="color" value={org.brand_color || '#408dfb'} disabled={!editable || busy} onChange={(e) => setOrg((o) => ({ ...o, brand_color: e.target.value }))} style={{ width: 52, height: 38, padding: 2 }} />
            <span className="mono">{org.brand_color || 'Default (#408dfb)'}</span>
            {editable && <button type="button" className="btn primary sm" disabled={busy} onClick={() => saveColour(org.brand_color || null)}>Save colour</button>}
            {editable && org.brand_color && <button type="button" className="btn sm" disabled={busy} onClick={() => saveColour(null)}>Reset to default</button>}
          </div>
        </div>
      </div></div>
      <div className="card"><div className="card-body">
        <h3 style={{ margin: 0 }}>Digital signature</h3>
        <p className="muted small">An image of the authorised signature, printed above “Authorised Signatory” on your documents. Use a PNG with a transparent or white background.</p>
        <div className="row">
          <div className="img-drop" onClick={() => editable && sigInput.current.click()} role="button" tabIndex={0} style={{ width: 220 }}>
            {org.signature_path ? <img src={mediaUrl(org.signature_path)} alt="Signature" /> : 'Upload signature'}
          </div>
          <input ref={sigInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadSig(e.target.files[0])} />
          {org.signature_path && editable && <button type="button" className="btn sm danger" disabled={busy} onClick={removeSig}>Remove</button>}
        </div>
      </div></div>
    </>
  );
}

// ------------------------------------------------------------------ reporting tags
export function ReportingTagsSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/settings/reporting-tags');
  const [edit, setEdit] = useState(null);
  const editable = can('settings', 'edit');
  if (!data) return <Spinner />;
  const modules = data.modules;
  const refresh = () => { reload(); invalidateLookups('reportingTags'); };
  const save = async () => {
    const ok = await run(() => (edit.id ? api.put(`/settings/reporting-tags/${edit.id}`, edit) : api.post('/settings/reporting-tags', edit)), 'Reporting tag saved');
    if (ok) { setEdit(null); refresh(); }
  };
  const remove = async (t) => {
    if (!(await confirmDialog({ message: `Delete the tag “${t.name}”? Values already chosen on documents stay saved but are no longer shown or reported.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/settings/reporting-tags/${t.id}`), 'Reporting tag deleted')) !== undefined) refresh();
  };
  const set = (k) => (v) => setEdit((x) => ({ ...x, [k]: v }));
  return (
    <>
      <PageHead title="Reporting Tags">
        {editable && <button type="button" className="btn primary" onClick={() => setEdit({ name: '', options: '', modules: Object.keys(modules), required: false, is_active: true })}>+ New tag</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>
        Label your transactions to see results by region, branch, project, sales team or anything else. For example a tag <b>Region</b> with values <i>North, South, East, West</i>.
        Choose the value on each document, then filter lists by it and open <b>Reports → Sales by Reporting Tag</b>.
      </p>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Tag</th><th>Values</th><th>Used on</th><th>Required</th><th>Status</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.tags.length && <tr><td colSpan={6} className="faint center" style={{ padding: 32 }}>No reporting tags yet.</td></tr>}
          {data.tags.map((t) => (
            <tr key={t.id}>
              <td className="bold">{t.name}</td>
              <td className="small">{(t.options || []).join(', ')}</td>
              <td className="small">{t.modules.length === Object.keys(modules).length ? 'All documents' : t.modules.map((m) => modules[m]).join(', ')}</td>
              <td>{t.required ? 'Yes' : 'No'}</td>
              <td><Badge status={t.is_active ? 'active' : 'inactive'} /></td>
              {editable && <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn sm" onClick={() => setEdit({ ...t, options: (t.options || []).join('\n') })}>Edit</button>
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(t)}>Delete</button>
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {edit && (
        <Modal title={edit.id ? `Edit “${edit.name}”` : 'New reporting tag'} onClose={() => setEdit(null)}
          footer={<><button type="button" className="btn primary" disabled={busy || !edit.name} onClick={save}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></>}>
          <div className="stack">
            <Field label="Tag name" required hint="e.g. Region, Branch, Project, Sales team"><Input value={edit.name} onChange={set('name')} autoFocus /></Field>
            <Field label="Values" required hint="One per line."><Textarea rows={5} value={edit.options} onChange={set('options')} /></Field>
            <div>
              <div className="small muted mb">Use on</div>
              <div className="grid-2">{Object.entries(modules).map(([k, l]: any) => (
                <Checkbox key={k} checked={edit.modules.includes(k)} onChange={(v) => set('modules')(v ? [...edit.modules, k] : edit.modules.filter((m) => m !== k))}>{l}</Checkbox>
              ))}</div>
            </div>
            <Checkbox checked={edit.required} onChange={set('required')}>Required — documents can’t be saved without a value</Checkbox>
            <Checkbox checked={edit.is_active} onChange={set('is_active')}>Active</Checkbox>
          </div>
        </Modal>
      )}
    </>
  );
}
