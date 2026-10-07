// Records of organization-defined modules (/m/:slug) and embedded web tabs (/tabs/:id).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { date, dateTime, money, qty } from '../lib/format';
import { useLookups } from '../lib/lookups';
import DataTable from '../components/DataTable';
import { FieldInput, customFieldText } from '../components/CustomFields';
import { ContactPicker, ItemPicker } from '../components/Pickers';
import { History } from '../components/Attachments';
import { BackLink, ErrorBox, Field, PageHead, Spinner, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const LOOKUPS = ['customer', 'vendor', 'item'];

function useModule(slug) {
  const { customModules } = useLookups('customModules');
  return customModules ? (customModules.modules || []).find((m) => m.slug === slug) || false : null;
}

/** Display a stored value, including names for customer / vendor / item links. */
function show(f, v, names) {
  if (v === undefined || v === null || v === '') return '';
  if (f.field_type === 'customer' || f.field_type === 'vendor') {
    const name = names?.contact?.[v] || `#${v}`;
    return <Link to={`/${f.field_type}s/${v}`} onClick={(e) => e.stopPropagation()}>{name}</Link>;
  }
  if (f.field_type === 'item') return <Link to={`/items/${v}`} onClick={(e) => e.stopPropagation()}>{names?.item?.[v] || `#${v}`}</Link>;
  if (f.field_type === 'decimal') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (f.field_type === 'url') return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{v}</a>;
  return customFieldText(f, v);
}

export function ModuleList() {
  const { slug } = useParams();
  const { can } = useAuth();
  const mod = useModule(slug);
  const [names, setNames] = useState<any>({});
  if (mod === null) return <div className="page"><Spinner /></div>;
  if (!mod) return <div className="page"><ErrorBox error={new Error('This module does not exist (any more).')} /></div>;
  const cols = mod.fields.filter((f) => f.show_in_list).slice(0, 7);
  return (
    <div className="page">
      <PageHead title={mod.name}>
        {can('custom_modules', 'create') && <Link className="btn primary" to={`/m/${slug}/new`}>+ New {mod.singular.toLowerCase()}</Link>}
      </PageHead>
      {mod.description && <p className="muted" style={{ marginTop: 0 }}>{mod.description}</p>}
      <DataTable endpoint={`/m/${slug}/records`} rowLink={(r) => `/m/${slug}/${r.id}`} exportName={slug}
        emptyTitle={`No ${mod.name.toLowerCase()} yet`} searchPlaceholder={`Search ${mod.name.toLowerCase()}`}
        filters={mod.fields.filter((f) => f.field_type === 'dropdown').slice(0, 2).map((f) => ({ key: `f_${f.field_key}`, label: f.label, options: [['', `All ${f.label.toLowerCase()}`], ...f.options.map((o) => [o, o])] }))}
        onData={(res) => setNames(res.names || {})}
        columns={[
          { key: 'number', label: 'Number', sort: 'number', render: (r) => <span className="bold">{r.number}</span> },
          ...cols.map((f) => ({ key: f.field_key, label: f.label, num: ['number', 'decimal'].includes(f.field_type), render: (r) => show(f, r.data?.[f.field_key], names), csv: (r) => r.data?.[f.field_key] ?? '' })),
          { key: 'created_at', label: 'Created', sort: 'created', render: (r) => date(r.created_at) },
        ]} />
    </div>
  );
}

function RecordInput({ f, value, onChange, names }: any) {
  if (f.field_type === 'customer' || f.field_type === 'vendor') {
    return <ContactPicker type={f.field_type} value={value || null} valueLabel={names?.contact?.[value] || ''} onSelect={(c) => onChange(c.id, c.display_name, 'contact')} />;
  }
  if (f.field_type === 'item') return <ItemPicker value={value || null} valueLabel={names?.item?.[value] || ''} onSelect={(it) => onChange(it.id, it.name, 'item')} />;
  return <FieldInput d={f} value={value} onChange={(v) => onChange(v)} />;
}

export function ModuleRecordForm() {
  const { slug, id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const mod = useModule(slug);
  const [data, setData] = useState<any>(null);
  const [names, setNames] = useState<any>({ contact: {}, item: {} });
  useEffect(() => {
    if (!mod) return;
    if (id) api.get(`/m/${slug}/records/${id}`).then((r) => { setData(r.data || {}); setNames(r.names || { contact: {}, item: {} }); }).catch((e) => toast(e.message, 'error'));
    else setData(Object.fromEntries(mod.fields.filter((f) => f.default_value).map((f) => [f.field_key, f.field_type === 'checkbox' ? f.default_value === 'true' : f.default_value])));
  }, [mod, id, slug, toast]);
  if (mod === null || (mod && !data)) return <div className="page"><Spinner /></div>;
  if (!mod) return <div className="page"><ErrorBox error={new Error('This module does not exist (any more).')} /></div>;
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => (id ? api.put(`/m/${slug}/records/${id}`, { data }) : api.post(`/m/${slug}/records`, { data })), `${mod.singular} saved`);
    if (r) navigate(`/m/${slug}/${r.id}`);
  };
  return (
    <form className="page narrow" onSubmit={save}>
      <BackLink to={`/m/${slug}`}>{mod.name}</BackLink>
      <PageHead title={id ? `Edit ${mod.singular.toLowerCase()}` : `New ${mod.singular.toLowerCase()}`} />
      <div className="card"><div className="card-body stack">
        {mod.fields.map((f) => (
          <Field key={f.field_key} label={f.field_type === 'checkbox' ? '' : f.label} required={f.required} hint={f.help_text || undefined}>
            <RecordInput f={f} value={data[f.field_key]} names={names}
              onChange={(v, label, kind) => {
                setData((d) => ({ ...d, [f.field_key]: v }));
                if (kind) setNames((n) => ({ ...n, [kind]: { ...n[kind], [v]: label } }));
              }} />
          </Field>
        ))}
      </div></div>
      <div className="form-footer">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

export function ModuleRecordDetail() {
  const { slug, id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const { data: r, error } = useApi(`/m/${slug}/records/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!r) return <div className="page"><Spinner /></div>;
  const mod = r.module;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete ${mod.singular.toLowerCase()} ${r.number}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/m/${slug}/records/${r.id}`), `${mod.singular} deleted`)) !== undefined) navigate(`/m/${slug}`);
  };
  const title = r.data?.[mod.fields[0]?.field_key];
  return (
    <div className="page narrow">
      <PageHead title={`${mod.singular} ${r.number}${title && typeof title === 'string' ? ` · ${title}` : ''}`} crumb={<Link to={`/m/${slug}`}>{mod.name}</Link>}>
        {can('custom_modules', 'edit') && <Link className="btn" to={`/m/${slug}/${r.id}/edit`}>Edit</Link>}
        {can('custom_modules', 'delete') && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body">
        <dl className="kv">
          {mod.fields.map((f) => <span key={f.field_key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{show(f, r.data?.[f.field_key], r.names) || '—'}</dd></span>)}
          <dt>Created</dt><dd>{dateTime(r.created_at)}{r.created_by_name ? ` by ${r.created_by_name}` : r.source === 'web_form' ? ' from a web form' : ''}</dd>
          {r.updated_by_name && r.updated_at !== r.created_at && <><dt>Last changed</dt><dd>{dateTime(r.updated_at)} by {r.updated_by_name}</dd></>}
        </dl>
      </div></div>
      <History entityType={`cm_${slug}`} entityId={r.id} />
    </div>
  );
}

export function WebTabPage() {
  const { id } = useParams();
  const { webTabs } = useLookups('webTabs');
  const tab = (webTabs || []).find((t) => String(t.id) === String(id));
  if (!webTabs?.length && !tab) return <div className="page"><Spinner /></div>;
  if (!tab) return <div className="page"><ErrorBox error={new Error('This tab no longer exists.')} /></div>;
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', maxWidth: 'none' }}>
      <PageHead title={tab.name}>
        <a className="btn" href={tab.url} target="_blank" rel="noreferrer">Open in a new browser tab ↗</a>
      </PageHead>
      {tab.open_mode === 'new_tab' ? (
        <div className="card"><div className="card-body">This page opens in its own browser tab. Use the button above.</div></div>
      ) : (
        <>
          <div className="small faint mb">If the page below stays blank, that website does not allow being shown inside other apps. Use “Open in a new browser tab”.</div>
          <iframe title={tab.name} src={tab.url} style={{ flex: 1, width: '100%', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" referrerPolicy="no-referrer" />
        </>
      )}
    </div>
  );
}

export { money, qty };
