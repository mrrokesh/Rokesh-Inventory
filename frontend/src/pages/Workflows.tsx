import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../lib/format';
import { Badge, Checkbox, ErrorBox, Field, Input, PageHead, Select, Spinner, Tabs, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const ACTION_LABELS = { email: 'Send an email', sms: 'Send an SMS', webhook: 'Call a webhook', field_update: 'Update a field', task: 'Create a task' };
const OPS_BY_TYPE = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  select: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  date: ['equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  boolean: ['equals'],
};
const OP_TEXT = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with',
  gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', is_empty: 'is empty', is_not_empty: 'is not empty',
};
const DATE_OP_TEXT = { equals: 'is on', gt: 'is after', gte: 'is on or after', lt: 'is before', lte: 'is on or before' };

const NEW_ACTION = {
  email: { type: 'email', to_contact: true, to_creator: false, emails: '', subject: '', message: '', include_document: true },
  sms: { type: 'sms', to_contact: true, numbers: '', message: '' },
  webhook: { type: 'webhook', url: '', secret: '' },
  field_update: { type: 'field_update', field: '', value: '' },
  task: { type: 'task', title: '', description: '', assignee_id: '', due_in_days: 1, priority: 'normal' },
};

const blankRule = (module = 'invoice') => ({
  name: '', description: '', module, trigger_type: 'event', events: ['create'], date_field: '', offset_days: 0, match: 'all', conditions: [], actions: [], is_active: true,
});

function describeTrigger(r, meta) {
  const m = meta.modules[r.module];
  if (r.trigger_type === 'date') {
    const f = m?.dateFields.find((x) => x.key === r.date_field)?.label || r.date_field;
    const d = Number(r.offset_days);
    return d === 0 ? `On the ${f.toLowerCase()}` : `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ${d > 0 ? 'after' : 'before'} the ${f.toLowerCase()}`;
  }
  return `When ${r.events.map((e) => meta.events[e]?.toLowerCase()).join(' or ')}`;
}

// ------------------------------------------------------------------ editor
function ConditionRow({ c, fields, onChange, onRemove }: any) {
  const f = fields.find((x) => x.key === c.field) || fields[0];
  const ops = OPS_BY_TYPE[f?.type] || OPS_BY_TYPE.text;
  const needsValue = !['is_empty', 'is_not_empty'].includes(c.op);
  const opLabel = (o) => (f?.type === 'date' && DATE_OP_TEXT[o]) || OP_TEXT[o];
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 180px' }}><Select value={c.field} onChange={(v) => { const nf = fields.find((x) => x.key === v); onChange({ field: v, op: (OPS_BY_TYPE[nf?.type] || OPS_BY_TYPE.text)[0], value: '' }); }} options={fields.map((x) => [x.key, x.label])} /></div>
      <div style={{ flex: '1 1 150px' }}><Select value={c.op} onChange={(v) => onChange({ ...c, op: v })} options={ops.map((o) => [o, opLabel(o)])} /></div>
      <div style={{ flex: '1 1 180px' }}>
        {needsValue && (f?.type === 'select'
          ? <Select value={c.value} onChange={(v) => onChange({ ...c, value: v })} options={(f.options || []).map((o) => [o, o.replace(/_/g, ' ')])} placeholder="Select" />
          : f?.type === 'boolean'
            ? <Select value={c.value || 'true'} onChange={(v) => onChange({ ...c, value: v })} options={[['true', 'Yes (ticked)'], ['false', 'No (not ticked)']]} />
            : <Input type={f?.type === 'number' ? 'number' : f?.type === 'date' ? 'date' : 'text'} value={c.value} onChange={(v) => onChange({ ...c, value: v })} />)}
      </div>
      <button type="button" className="btn ghost sm danger" onClick={onRemove} aria-label="Remove condition">✕</button>
    </div>
  );
}

function Placeholders({ fields }: any) {
  const toast = useToast();
  const keys = [...fields.map((f) => [f.key, f.label]), ['link', 'Link to the record'], ['org_name', 'Your organization name'], ['today', 'Today’s date']];
  const copy = async (k) => { try { await navigator.clipboard.writeText(`{{${k}}}`); toast(`Copied {{${k}}}`); } catch { /* clipboard blocked */ } };
  return (
    <details className="small">
      <summary className="muted" style={{ cursor: 'pointer' }}>Insert record details with placeholders like {'{{number}}'} — click to see the list</summary>
      <div className="row mt" style={{ flexWrap: 'wrap', gap: 6 }}>
        {keys.map(([k, l]) => <button type="button" key={k} className="btn sm" title={l} onClick={() => copy(k)}>{`{{${k}}}`}</button>)}
      </div>
      <div className="faint mt">Click a placeholder to copy it, then paste it into the subject, message or title.</div>
    </details>
  );
}

function ActionCard({ a, m, users, onChange, onRemove, index }: any) {
  const set = (k) => (v) => onChange({ ...a, [k]: v });
  return (
    <div className="card mb" style={{ borderLeft: '3px solid var(--primary)' }}><div className="card-body stack">
      <div className="row"><strong>{index + 1}. {ACTION_LABELS[a.type]}</strong><div className="spacer" /><button type="button" className="btn ghost sm danger" onClick={onRemove}>Remove</button></div>
      {a.type === 'email' && (
        <>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            {m.contact && <Checkbox checked={a.to_contact} onChange={set('to_contact')}>{m.contact === 'self' ? 'This contact' : `The ${m.contact}`}</Checkbox>}
            <Checkbox checked={a.to_creator} onChange={set('to_creator')}>The user who created the record</Checkbox>
          </div>
          <Field label="Other email addresses" hint="Separate several with commas, e.g. accounts@yourcompany.com"><Input value={a.emails} onChange={set('emails')} /></Field>
          <Field label="Subject" required><Input value={a.subject} onChange={set('subject')} placeholder="e.g. Reminder: invoice {{number}} is overdue" /></Field>
          <Field label="Message"><Textarea rows={4} value={a.message} onChange={set('message')} placeholder={'Dear {{contact_name}},\n\nThis is a reminder that {{number}} for {{total}} was due on {{due_date}}.'} /></Field>
          {m.document && <Checkbox checked={a.include_document} onChange={set('include_document')}>Include the document (items and totals) in the email</Checkbox>}
        </>
      )}
      {a.type === 'sms' && (
        <>
          {m.contact && <Checkbox checked={a.to_contact} onChange={set('to_contact')}>{m.contact === 'self' ? "This contact's mobile number" : `The ${m.contact}'s mobile number`}</Checkbox>}
          <Field label="Other mobile numbers" hint="Separate several with commas, e.g. your sales manager."><Input value={a.numbers} onChange={set('numbers')} /></Field>
          <Field label="Message" required hint={`Keep it short (${(a.message || '').length} characters). On MSG91 it is sent inside your DLT template. Needs Twilio or MSG91 under Settings → Integrations.`}>
            <Textarea rows={3} value={a.message} onChange={set('message')} placeholder="Hi {{contact_name}}, invoice {{number}} for {{total}} is due on {{due_date}}." />
          </Field>
        </>
      )}
      {a.type === 'webhook' && (
        <>
          <Field label="Web address (URL)" required hint="The record is sent there as JSON with a POST request — for Zapier, Make, n8n or your own system."><Input value={a.url} onChange={set('url')} placeholder="https://hooks.example.com/…" /></Field>
          <Field label="Secret (optional)" hint="If set, each request carries an X-Inventory-Signature header (HMAC-SHA256) so the receiver can check it came from you."><Input value={a.secret} onChange={set('secret')} /></Field>
        </>
      )}
      {a.type === 'field_update' && (
        <div className="grid-2">
          <Field label="Field" required>
            <Select value={a.field} onChange={set('field')} options={m.updatable.map((f) => [f.key, f.label])} placeholder="Select" />
            {!m.updatable.some((f) => f.custom) && <div className="hint">Tip: add custom fields in Settings → Custom fields to have more fields to update.</div>}
          </Field>
          <Field label="New value" hint="Can use placeholders.">
            {(() => {
              const f = m.updatable.find((x) => x.key === a.field);
              if (f?.type === 'select') return <Select value={a.value} onChange={set('value')} options={(f.options || []).map((o) => [o, o])} placeholder="Select" />;
              if (f?.type === 'boolean') return <Select value={a.value} onChange={set('value')} options={[['true', 'Yes'], ['false', 'No']]} placeholder="Select" />;
              return <Input type={f?.type === 'date' ? 'date' : 'text'} value={a.value} onChange={set('value')} />;
            })()}
          </Field>
        </div>
      )}
      {a.type === 'task' && (
        <>
          <Field label="Task title" required><Input value={a.title} onChange={set('title')} placeholder="e.g. Call {{contact_name}} about {{number}}" /></Field>
          <Field label="Details"><Textarea rows={2} value={a.description} onChange={set('description')} /></Field>
          <div className="grid-3">
            <Field label="Assign to"><Select value={a.assignee_id || ''} onChange={(v) => set('assignee_id')(v ? Number(v) : '')} options={users.map((u) => [u.id, u.name])} placeholder="Nobody" /></Field>
            <Field label="Due in (days)"><Input type="number" min="0" max="365" value={a.due_in_days} onChange={set('due_in_days')} /></Field>
            <Field label="Priority"><Select value={a.priority} onChange={set('priority')} options={[['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]} /></Field>
          </div>
        </>
      )}
    </div></div>
  );
}

function RuleEditor({ meta, rule, onDone }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [r, setR] = useState(() => JSON.parse(JSON.stringify(rule)));
  const m = meta.modules[r.module];
  const set = (k) => (v) => setR((x) => ({ ...x, [k]: v }));
  const changeModule = (mod) => {
    const nm = meta.modules[mod];
    setR((x) => ({ ...x, module: mod, events: x.events.filter((e) => nm.events.includes(e)), date_field: '', conditions: [], actions: x.actions.filter((a) => a.type !== 'field_update') }));
  };
  const save = async () => {
    const body = { ...r, offset_days: Number(r.offset_days) || 0 };
    const saved = await run(() => (r.id ? api.put(`/workflows/${r.id}`, body) : api.post('/workflows', body)), 'Workflow rule saved');
    if (saved) onDone(true);
  };
  const before = Number(r.offset_days) < 0;
  return (
    <>
      <PageHead title={r.id ? `Edit rule: ${rule.name}` : 'New workflow rule'}>
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
      </PageHead>
      <div className="card mb"><div className="card-body stack">
        <div className="grid-2">
          <Field label="Rule name" required><Input value={r.name} onChange={set('name')} placeholder="e.g. Overdue invoice reminder" autoFocus /></Field>
          <Field label="Applies to"><Select value={r.module} onChange={changeModule} options={Object.entries(meta.modules).map(([k, v]: any) => [k, v.label])} /></Field>
        </div>
        <Field label="Description (optional)"><Input value={r.description || ''} onChange={set('description')} /></Field>
      </div></div>

      <h3 className="mb">1. When should it run?</h3>
      <div className="card mb"><div className="card-body stack">
        <div className="row" style={{ gap: 16 }}>
          <label className="checkbox"><input type="radio" checked={r.trigger_type === 'event'} onChange={() => set('trigger_type')('event')} /> When something happens to a record</label>
          <label className="checkbox"><input type="radio" checked={r.trigger_type === 'date'} onChange={() => set('trigger_type')('date')} /> On a date (e.g. before or after a due date)</label>
        </div>
        {r.trigger_type === 'event' ? (
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            {m.events.map((e) => (
              <Checkbox key={e} checked={r.events.includes(e)} onChange={(v) => set('events')(v ? [...r.events, e] : r.events.filter((x) => x !== e))}>{m.label.replace(/s$/, '')} {meta.events[e].toLowerCase()}</Checkbox>
            ))}
          </div>
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 90 }}><Input type="number" min="0" max="365" value={Math.abs(Number(r.offset_days) || 0)} onChange={(v) => set('offset_days')((before ? -1 : 1) * Math.abs(Number(v) || 0))} /></div>
            <span>days</span>
            <div style={{ width: 120 }}><Select value={before ? 'before' : 'after'} onChange={(v) => set('offset_days')((v === 'before' ? -1 : 1) * Math.abs(Number(r.offset_days) || 0))} options={[['after', 'after'], ['before', 'before']]} /></div>
            <span>the</span>
            <div style={{ width: 220 }}><Select value={r.date_field} onChange={set('date_field')} options={m.dateFields.map((f) => [f.key, f.label])} placeholder="Choose a date" /></div>
            <div className="hint" style={{ flexBasis: '100%' }}>Checked every few minutes. Each record is handled at most once a day. Use 0 days for “on the date”.</div>
          </div>
        )}
      </div></div>

      <h3 className="mb">2. Only if… <span className="small muted" style={{ fontWeight: 400 }}>(optional — leave empty to run for every record)</span></h3>
      <div className="card mb"><div className="card-body stack">
        {r.conditions.length > 1 && (
          <div className="row" style={{ gap: 8 }}>
            <span>Run when</span>
            <div style={{ width: 200 }}><Select value={r.match} onChange={set('match')} options={[['all', 'ALL conditions are true'], ['any', 'ANY condition is true']]} /></div>
          </div>
        )}
        {r.conditions.map((c, i) => (
          <ConditionRow key={i} c={c} fields={m.fields} onChange={(nc) => set('conditions')(r.conditions.map((x, j) => (j === i ? nc : x)))} onRemove={() => set('conditions')(r.conditions.filter((_, j) => j !== i))} />
        ))}
        <div><button type="button" className="btn sm" onClick={() => set('conditions')([...r.conditions, { field: m.fields[0].key, op: (OPS_BY_TYPE[m.fields[0].type] || OPS_BY_TYPE.text)[0], value: '' }])}>+ Add condition</button></div>
      </div></div>

      <h3 className="mb">3. Then do this</h3>
      {r.actions.map((a, i) => (
        <ActionCard key={i} index={i} a={a} m={m} users={meta.users} onChange={(na) => set('actions')(r.actions.map((x, j) => (j === i ? na : x)))} onRemove={() => set('actions')(r.actions.filter((_, j) => j !== i))} />
      ))}
      <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(ACTION_LABELS).map(([k, l]) => <button type="button" key={k} className="btn sm" onClick={() => set('actions')([...r.actions, { ...NEW_ACTION[k] }])}>+ {l}</button>)}
      </div>
      {r.actions.some((a) => ['email', 'sms', 'task', 'field_update'].includes(a.type)) && <div className="mb"><Placeholders fields={m.fields} /></div>}

      <div className="form-footer">
        <Checkbox checked={r.is_active} onChange={set('is_active')}>Active</Checkbox>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button>
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ logs
function Logs({ meta, ruleId = null }: any) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useApi('/workflows/logs', { status: status || undefined, rule_id: ruleId || undefined, page, per_page: 25 }, [status, ruleId, page]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <>
      <div className="row mb" style={{ gap: 8 }}>
        <span className="muted">Show</span>
        <div style={{ width: 180 }}><Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[['', 'All runs'], ['success', 'Successful'], ['partial', 'Partly failed'], ['failed', 'Failed']]} /></div>
      </div>
      <div className="card table-wrap"><table className="table">
        <thead><tr><th>When</th><th style={{ minWidth: 140 }}>Rule</th><th>Record</th><th>Trigger</th><th>Result</th></tr></thead>
        <tbody>
          {!data.data.length && <tr><td colSpan={5} className="faint center" style={{ padding: 32 }}>No runs yet. Runs appear here when a rule’s conditions match.</td></tr>}
          {data.data.map((l) => (
            <tr key={l.id}>
              <td className="nowrap">{dateTime(l.created_at)}</td>
              <td>{l.rule_name}<div className="small faint">{meta.modules[l.module]?.label}</div></td>
              <td>{l.entity_label}</td>
              <td className="small">{l.trigger.startsWith('date:') ? 'Date rule' : l.trigger === 'manual' ? 'Run manually' : meta.events[l.trigger] || l.trigger}</td>
              <td style={{ minWidth: 280 }}>
                <Badge status={l.status === 'success' ? 'active' : l.status === 'partial' ? 'pending' : 'failed'}>{l.status === 'success' ? 'Success' : l.status === 'partial' ? 'Partly failed' : 'Failed'}</Badge>
                {(l.results || []).map((x, i) => <div key={i} className="small" style={{ color: x.ok ? 'var(--text-2)' : 'var(--danger, #d33)' }}>{x.ok ? '✓' : '✕'} {ACTION_LABELS[x.type]}: {x.message}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {data.total > data.per_page && (
        <div className="row mt" style={{ gap: 8 }}>
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="small muted">Page {page} of {Math.ceil(data.total / data.per_page)}</span>
          <button type="button" className="btn sm" disabled={page * data.per_page >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ list
export default function WorkflowSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const meta = useApi('/workflows/meta');
  const list = useApi('/workflows');
  const [tab, setTab] = useState('rules');
  const [editing, setEditing] = useState(null);
  const editable = can('settings', 'edit');
  useEffect(() => { window.scrollTo({ top: 0 }); }, [editing]);
  if (meta.error || list.error) return <ErrorBox error={meta.error || list.error} />;
  if (!meta.data || !list.data) return <Spinner />;
  if (editing) return <RuleEditor meta={meta.data} rule={editing} onDone={(saved) => { setEditing(null); if (saved) list.reload(); }} />;
  const toggle = async (r) => { if (await run(() => api.post(`/workflows/${r.id}/toggle`), r.is_active ? 'Rule turned off' : 'Rule turned on')) list.reload(); };
  const remove = async (r) => {
    if (!(await confirmDialog({ message: `Delete the rule “${r.name}”? Its past runs stay in the log.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/workflows/${r.id}`), 'Rule deleted')) !== undefined) list.reload();
  };
  return (
    <>
      <PageHead title="Workflow Rules">
        {editable && tab === 'rules' && <button type="button" className="btn primary" onClick={() => setEditing(blankRule())}>+ New rule</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>
        Let the app do routine work for you: <b>when</b> something happens (or on a date), <b>if</b> conditions are met, <b>then</b> send an email, call a webhook, update a field or create a task.
      </p>
      <Tabs tabs={[['rules', `Rules (${list.data.length})`], ['logs', 'Logs']]} active={tab} onChange={setTab} />
      {tab === 'logs' ? <Logs meta={meta.data} /> : (
        <div className="card table-wrap"><table className="table">
          <thead><tr><th>Rule</th><th>Applies to</th><th>Runs</th><th>Actions</th><th>Status</th>{editable && <th />}</tr></thead>
          <tbody>
            {!list.data.length && (
              <tr><td colSpan={6} className="center" style={{ padding: 32 }}>
                <div className="bold">No rules yet</div>
                <div className="muted small">Ideas: email customers 3 days after an invoice is due · create a task when a big sales order is confirmed · notify your team when stock of an item is edited below its reorder point.</div>
              </td></tr>
            )}
            {list.data.map((r) => (
              <tr key={r.id}>
                <td><span className="bold">{r.name}</span><div className="small faint">{describeTrigger(r, meta.data)}{r.conditions.length ? ` · ${r.conditions.length} condition${r.conditions.length > 1 ? 's' : ''}` : ''}</div></td>
                <td>{meta.data.modules[r.module]?.label}</td>
                <td>{r.run_count}{r.last_run_at && <div className="small faint">last {dateTime(r.last_run_at)}</div>}</td>
                <td className="small">{r.actions.map((a) => ACTION_LABELS[a.type]).join(', ')}</td>
                <td><Badge status={r.is_active ? 'active' : 'inactive'} /></td>
                {editable && (
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn sm" onClick={() => setEditing(r)}>Edit</button>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(r)}>{r.is_active ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(r)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
