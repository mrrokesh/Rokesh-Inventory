// Settings → Custom modules, Web tabs, Web forms.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../lib/format';
import { invalidateLookups } from '../lib/lookups';
import { Badge, Checkbox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const TYPE_LABELS = {
  text: 'Text', textarea: 'Long text', number: 'Whole number', decimal: 'Number with decimals', date: 'Date', checkbox: 'Yes / no', dropdown: 'Dropdown',
  email: 'Email', url: 'Web address', phone: 'Phone', customer: 'Link to a customer', vendor: 'Link to a vendor', item: 'Link to an item',
};

// ------------------------------------------------------------------ custom modules
function ModuleEditor({ mod, types, onClose, onSaved }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [m, setM] = useState(() => ({
    ...mod, fields: (mod.fields || []).map((f) => ({ ...f, options: Array.isArray(f.options) ? f.options.join('\n') : f.options || '' })),
  }));
  const setField = (i, patch) => setM((x) => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const move = (i, dir) => setM((x) => { const fs = [...x.fields]; const j = i + dir; if (j < 0 || j >= fs.length) return x; [fs[i], fs[j]] = [fs[j], fs[i]]; return { ...x, fields: fs }; });
  const save = async () => {
    const r = await run(() => (m.id ? api.put(`/custom-modules/${m.id}`, m) : api.post('/custom-modules', m)), 'Module saved');
    if (r) onSaved();
  };
  return (
    <Modal title={m.id ? `Edit “${mod.name}”` : 'New custom module'} onClose={onClose} wide
      footer={<><button type="button" className="btn primary" disabled={busy || !m.name} onClick={save}>{busy ? 'Saving…' : 'Save module'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack">
        <div className="grid-3">
          <Field label="Name (plural)" required hint="Shown in the menu"><Input value={m.name} onChange={(v) => setM({ ...m, name: v })} placeholder="e.g. Service requests" autoFocus /></Field>
          <Field label="One record is called" hint="e.g. Service request"><Input value={m.singular || ''} onChange={(v) => setM({ ...m, singular: v })} /></Field>
          <Field label="Number prefix" hint="Records are numbered like SR-00001"><Input value={m.number_prefix || ''} maxLength={8} onChange={(v) => setM({ ...m, number_prefix: v.toUpperCase() })} placeholder="SR" /></Field>
        </div>
        <Field label="Description (optional)"><Input value={m.description || ''} onChange={(v) => setM({ ...m, description: v })} /></Field>
        <Checkbox checked={m.show_in_nav !== false} onChange={(v) => setM({ ...m, show_in_nav: v })}>Show in the left menu (under More)</Checkbox>
        <div>
          <div className="row mb"><h3 style={{ margin: 0 }}>Fields</h3><span className="small faint">The first field is used as the record’s title.</span></div>
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>Label</th><th>Type</th><th>Required</th><th>In list</th><th /></tr></thead>
            <tbody>
              {m.fields.map((f, i) => (
                <tr key={i}>
                  <td style={{ minWidth: 180 }}>
                    <Input value={f.label} onChange={(v) => setField(i, { label: v })} placeholder="Field name" />
                    {f.field_type === 'dropdown' && <Textarea rows={2} value={f.options} onChange={(v) => setField(i, { options: v })} placeholder="Choices, one per line" />}
                  </td>
                  <td style={{ minWidth: 170 }}><Select value={f.field_type} onChange={(v) => setField(i, { field_type: v })} options={types.map((t) => [t, TYPE_LABELS[t] || t])} /></td>
                  <td><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} aria-label="Required" /></td>
                  <td><input type="checkbox" checked={!!f.show_in_list} onChange={(e) => setField(i, { show_in_list: e.target.checked })} aria-label="Show in list" /></td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn ghost sm" onClick={() => move(i, -1)} aria-label="Up">↑</button>
                    <button type="button" className="btn ghost sm" onClick={() => move(i, 1)} aria-label="Down">↓</button>
                    <button type="button" className="btn ghost sm danger" onClick={() => setM({ ...m, fields: m.fields.filter((_, j) => j !== i) })} aria-label="Remove">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button type="button" className="btn sm mt" onClick={() => setM({ ...m, fields: [...m.fields, { label: '', field_type: 'text', required: false, show_in_list: m.fields.length < 4, options: '' }] })}>+ Add field</button>
          {m.id && <div className="small faint mt">Changing a field’s type keeps the values already saved; records are checked against the new type the next time they are edited.</div>}
        </div>
      </div>
    </Modal>
  );
}

export function CustomModulesSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/custom-modules');
  const [edit, setEdit] = useState(null);
  const editable = can('settings', 'edit');
  if (!data) return <Spinner />;
  const refresh = () => { reload(); invalidateLookups('customModules'); };
  const remove = async (mod) => {
    if (!(await confirmDialog({ message: mod.records ? `Delete “${mod.name}” and its ${mod.records} record(s)? This cannot be undone.` : `Delete “${mod.name}”?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/custom-modules/${mod.id}?confirm=delete-records`), 'Module deleted')) !== undefined) refresh();
  };
  return (
    <>
      <PageHead title="Custom Modules">
        {editable && <button type="button" className="btn primary" onClick={() => setEdit({ name: '', singular: '', number_prefix: '', show_in_nav: true, fields: [{ label: 'Subject', field_type: 'text', required: true, show_in_list: true }] })}>+ New module</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>
        Keep track of things the app doesn’t have a place for, with your own fields: service requests, equipment on rent, warranty claims, site visits, quotations from suppliers…
        Each module gets its own list, numbering and pages, and can link to customers, vendors and items. Records can also come in through a <Link to="/settings/web-forms">web form</Link>.
      </p>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Module</th><th>Fields</th><th className="num">Records</th><th>In menu</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.modules.length && <tr><td colSpan={5} className="faint center" style={{ padding: 32 }}>No custom modules yet.</td></tr>}
          {data.modules.map((mod) => (
            <tr key={mod.id}>
              <td><Link to={`/m/${mod.slug}`} className="bold">{mod.name}</Link><div className="small faint">{mod.number_prefix}-00001 …</div></td>
              <td className="small">{mod.fields.map((f) => f.label).join(', ')}</td>
              <td className="num">{mod.records}</td>
              <td>{mod.show_in_nav ? 'Yes' : 'No'}</td>
              {editable && <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn sm" onClick={() => setEdit(mod)}>Edit</button>
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(mod)}>Delete</button>
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {edit && <ModuleEditor mod={edit} types={data.field_types} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </>
  );
}

// ------------------------------------------------------------------ web tabs
export function WebTabsSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/web-tabs');
  const [edit, setEdit] = useState(null);
  const editable = can('settings', 'edit');
  if (!data) return <Spinner />;
  const refresh = () => { reload(); invalidateLookups('webTabs'); };
  const save = async () => { if (await run(() => (edit.id ? api.put(`/web-tabs/${edit.id}`, edit) : api.post('/web-tabs', edit)), 'Web tab saved')) { setEdit(null); refresh(); } };
  const remove = async (t) => {
    if (!(await confirmDialog({ message: `Remove the tab “${t.name}”?`, danger: true, confirmText: 'Remove' }))) return;
    if ((await run(() => api.del(`/web-tabs/${t.id}`), 'Web tab removed')) !== undefined) refresh();
  };
  return (
    <>
      <PageHead title="Web Tabs">{editable && <button type="button" className="btn primary" onClick={() => setEdit({ name: '', url: 'https://', open_mode: 'embed' })}>+ New web tab</button>}</PageHead>
      <p className="muted" style={{ marginTop: 0 }}>Add websites your team uses every day (a price sheet, Google Sheets, a courier’s tracking page, your bank) to the left menu under <b>More</b>. Some websites refuse to be shown inside another app; for those choose “Open in a new browser tab”.</p>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Address</th><th>Opens</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.length && <tr><td colSpan={4} className="faint center" style={{ padding: 32 }}>No web tabs yet.</td></tr>}
          {data.map((t) => (
            <tr key={t.id}>
              <td><Link to={`/tabs/${t.id}`} className="bold">{t.name}</Link></td>
              <td className="small" style={{ wordBreak: 'break-all' }}>{t.url}</td>
              <td>{t.open_mode === 'embed' ? 'Inside the app' : 'In a new browser tab'}</td>
              {editable && <td className="right" style={{ whiteSpace: 'nowrap' }}><button type="button" className="btn sm" onClick={() => setEdit(t)}>Edit</button><button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(t)}>Remove</button></td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {edit && (
        <Modal title={edit.id ? `Edit “${edit.name}”` : 'New web tab'} onClose={() => setEdit(null)}
          footer={<><button type="button" className="btn primary" disabled={busy || !edit.name} onClick={save}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></>}>
          <div className="stack">
            <Field label="Name in the menu" required><Input value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} autoFocus /></Field>
            <Field label="Web address" required hint="Must start with https://"><Input value={edit.url} onChange={(v) => setEdit({ ...edit, url: v })} /></Field>
            <Field label="Open"><Select value={edit.open_mode} onChange={(v) => setEdit({ ...edit, open_mode: v })} options={[['embed', 'Inside the app'], ['new_tab', 'In a new browser tab']]} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ web forms
function FormEditor({ form, modules, onClose, onSaved }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(form);
  const available = useApi(f.target ? '/web-forms/fields' : null, { target: f.target }, [f.target]);
  const chosen = new Map(f.fields.map((x) => [x.key, x]));
  const toggle = (fd, on) => setF({ ...f, fields: on ? [...f.fields, { key: fd.key, label: fd.label, required: fd.required }] : f.fields.filter((x) => x.key !== fd.key) });
  const save = async () => { if (await run(() => (f.id ? api.put(`/web-forms/${f.id}`, f) : api.post('/web-forms', f)), 'Web form saved')) onSaved(); };
  return (
    <Modal title={f.id ? `Edit “${form.name}”` : 'New web form'} onClose={onClose} wide
      footer={<><button type="button" className="btn primary" disabled={busy || !f.name || !f.fields.length} onClick={save}>{busy ? 'Saving…' : 'Save form'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Form name" required hint="For you; e.g. “Website enquiry”"><Input value={f.name} onChange={(v) => setF({ ...f, name: v })} autoFocus /></Field>
          <Field label="Each submission creates">
            <Select value={f.target} onChange={(v) => setF({ ...f, target: v, fields: [] })} disabled={!!f.id}
              options={[['customer', 'A new customer (enquiry / lead)'], ...modules.map((mm) => [`module:${mm.id}`, `A new ${mm.singular.toLowerCase()} (${mm.name})`])]} />
          </Field>
          <Field label="Title shown on the form"><Input value={f.title || ''} onChange={(v) => setF({ ...f, title: v })} placeholder={f.name} /></Field>
          <Field label="Email me when someone submits" hint="Needs Settings → Email."><Input type="email" value={f.notify_email || ''} onChange={(v) => setF({ ...f, notify_email: v })} /></Field>
        </div>
        <Field label="Text above the form (optional)"><Textarea rows={2} value={f.intro || ''} onChange={(v) => setF({ ...f, intro: v })} /></Field>
        <div>
          <div className="small muted mb">Fields on the form</div>
          {!available.data ? <Spinner /> : (
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Ask for</th><th>Label on the form</th><th>Required</th></tr></thead>
              <tbody>{available.data.map((fd) => {
                const c = chosen.get(fd.key) as any;
                return (
                  <tr key={fd.key}>
                    <td><Checkbox checked={!!c} onChange={(v) => toggle(fd, v)}>{fd.label}</Checkbox></td>
                    <td>{c && <Input value={c.label} onChange={(v) => setF({ ...f, fields: f.fields.map((x) => (x.key === fd.key ? { ...x, label: v } : x)) })} />}</td>
                    <td>{c && <input type="checkbox" checked={!!c.required || fd.required} disabled={fd.required} onChange={(e) => setF({ ...f, fields: f.fields.map((x) => (x.key === fd.key ? { ...x, required: e.target.checked } : x)) })} aria-label="Required" />}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>
        <Field label="Message after sending"><Textarea rows={2} value={f.success_message || ''} onChange={(v) => setF({ ...f, success_message: v })} placeholder="Thank you! We have received your details and will get back to you soon." /></Field>
        <Checkbox checked={f.enabled !== false} onChange={(v) => setF({ ...f, enabled: v })}>Form is live (accepting submissions)</Checkbox>
      </div>
    </Modal>
  );
}

export function WebFormsSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/web-forms');
  const mods = useApi('/custom-modules');
  const [edit, setEdit] = useState(null);
  const [share, setShare] = useState(null);
  const editable = can('settings', 'edit');
  if (!data || !mods.data) return <Spinner />;
  const urlOf = (f) => `${window.location.origin}/f/${f.token}`;
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Select the text and copy it', 'error'); } };
  const remove = async (f) => {
    if (!(await confirmDialog({ message: `Delete the form “${f.name}”? Its link stops working.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/web-forms/${f.id}`), 'Web form deleted')) !== undefined) reload();
  };
  const targetLabel = (t) => (t === 'customer' ? 'Customers' : mods.data.modules.find((mm) => `module:${mm.id}` === t)?.name || 'Deleted module');
  return (
    <>
      <PageHead title="Web Forms">
        {editable && <button type="button" className="btn primary" onClick={() => setEdit({ name: '', target: 'customer', fields: [], enabled: true })}>+ New web form</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>A web form is a page anyone can fill in — no sign-in. Put its link on your website, WhatsApp or Instagram, or embed it in a web page. Each submission becomes a new customer or a record in one of your custom modules.</p>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>Form</th><th>Creates</th><th className="num">Submissions</th><th>Status</th>{editable && <th />}</tr></thead>
        <tbody>
          {!data.length && <tr><td colSpan={5} className="faint center" style={{ padding: 32 }}>No web forms yet.</td></tr>}
          {data.map((f) => (
            <tr key={f.id}>
              <td><span className="bold">{f.name}</span><div className="small faint">{f.fields.map((x) => x.label).join(', ')}</div></td>
              <td>{targetLabel(f.target)}</td>
              <td className="num">{f.submissions}{f.last_submitted_at && <div className="small faint">last {dateTime(f.last_submitted_at)}</div>}</td>
              <td><Badge status={f.enabled ? 'active' : 'inactive'}>{f.enabled ? 'Live' : 'Off'}</Badge></td>
              {editable && <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn sm primary" onClick={() => setShare(f)}>Share</button>
                <button type="button" className="btn sm" onClick={() => setEdit(f)}>Edit</button>
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(f)}>Delete</button>
              </td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {edit && <FormEditor form={edit} modules={mods.data.modules} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {share && (
        <Modal title={`Share “${share.name}”`} onClose={() => setShare(null)} footer={<button type="button" className="btn" onClick={() => setShare(null)}>Close</button>}>
          <div className="stack">
            <Field label="Link (send it or put it on your site)">
              <div className="row" style={{ gap: 6 }}><Input value={urlOf(share)} readOnly onChange={() => {}} /><button type="button" className="btn sm" onClick={() => copy(urlOf(share), 'Link')}>Copy</button><a className="btn sm" href={urlOf(share)} target="_blank" rel="noreferrer">Open</a></div>
            </Field>
            <Field label="Embed code (paste into your website’s HTML)">
              <Textarea rows={3} readOnly value={`<iframe src="${urlOf(share)}" style="width:100%;max-width:600px;height:640px;border:0" title="${share.name.replace(/"/g, '')}"></iframe>`} onChange={() => {}} />
              <div><button type="button" className="btn sm mt" onClick={() => copy(`<iframe src="${urlOf(share)}" style="width:100%;max-width:600px;height:640px;border:0" title="${share.name.replace(/"/g, '')}"></iframe>`, 'Embed code')}>Copy embed code</button></div>
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
