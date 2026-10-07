import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { date, dateTime, label, money, qty } from '../lib/format';
import { Badge, Checkbox, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

const OPS_BY_TYPE = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'],
  label: ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty'],
  status: ['equals', 'not_equals'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  money: ['equals', 'gt', 'gte', 'lt', 'lte'],
  date: ['equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
};
const PERIODS = [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This fiscal year'], ['last_12_months', 'Last 12 months']];

function cell(c, v) {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return money(v);
  if (c.type === 'number') return qty(v);
  if (c.type === 'date') return date(v);
  if (c.type === 'datetime') return dateTime(v);
  if (c.type === 'status') return <Badge status={v} />;
  if (c.type === 'label') return label(v);
  return String(v);
}

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const meta = useApi('/reports/builder/sources');
  const [r, setR] = useState<any>(null);
  const [period, setPeriod] = useState('this_month');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);

  useEffect(() => {
    if (id) api.get(`/reports/custom/${id}`).then((x) => setR({ ...x, definition: { columns: [], filters: [], group_by: null, sort: null, ...x.definition } })).catch((e) => toast(e.message, 'error'));
    else setR({ name: '', description: '', source: 'invoices', shared: false, definition: { columns: ['number', 'doc_date', 'contact', 'status', 'total'], filters: [], group_by: null, sort: null } });
  }, [id, toast]);
  if (meta.error) return <div className="page"><ErrorBox error={meta.error} /></div>;
  if (!meta.data || !r) return <div className="page"><Spinner /></div>;
  const src = meta.data.sources.find((s) => s.key === r.source) || meta.data.sources[0];
  const fields = src.fields;
  const d = r.definition;
  const setDef = (patch) => { setR((x) => ({ ...x, definition: { ...x.definition, ...patch } })); setPreview(null); };
  const changeSource = (key) => {
    const s = meta.data.sources.find((x) => x.key === key);
    setR((x) => ({ ...x, source: key, definition: { columns: s.fields.slice(0, 5).map((f) => f.key), filters: [], group_by: null, sort: null } }));
    setPreview(null);
  };
  const toggleCol = (k, on) => setDef({ columns: on ? [...d.columns, k] : d.columns.filter((c) => c !== k) });
  const move = (k, dir) => {
    const i = d.columns.indexOf(k); const j = i + dir;
    if (j < 0 || j >= d.columns.length) return;
    const cols = [...d.columns]; [cols[i], cols[j]] = [cols[j], cols[i]];
    setDef({ columns: cols });
  };
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const doPreview = async () => {
    setPreviewError(null);
    try { setPreview(await api.post('/reports/builder/preview', { source: r.source, definition: d, period })); } catch (e) { setPreviewError(e); setPreview(null); }
  };
  const save = async () => {
    const body = { name: r.name, description: r.description, source: r.source, shared: r.shared, definition: d };
    const saved = await run(() => (id ? api.put(`/reports/custom/${id}`, body) : api.post('/reports/custom', body)), 'Report saved');
    if (saved) navigate(`/reports/custom_${saved.id}`);
  };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete the report “${r.name}”? Its schedules stop too.`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/reports/custom/${id}`), 'Report deleted')) !== undefined) navigate('/reports');
  };
  const groups = [...new Set(meta.data.sources.map((s) => s.group))];
  const numericCols = d.columns.filter((k) => ['money', 'number'].includes(byKey[k]?.type) && byKey[k]?.sum);
  return (
    <div className="page">
      <PageHead title={id ? `Edit report: ${r.name}` : 'New custom report'} crumb={<Link to="/reports">Reports</Link>}>
        {id && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
      </PageHead>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <div className="card"><div className="card-body stack">
            <Field label="Report name" required><Input value={r.name} onChange={(v) => setR({ ...r, name: v })} placeholder="e.g. Fan sales by customer" /></Field>
            <Field label="Description (optional)"><Textarea rows={2} value={r.description || ''} onChange={(v) => setR({ ...r, description: v })} /></Field>
            <Field label="Report on" hint={src.dated ? 'The report period (chosen when you open the report) applies to the date.' : 'Shows everything as of today.'}>
              <select className="input" value={r.source} onChange={(e) => changeSource(e.target.value)}>
                {groups.map((g: any) => <optgroup key={g} label={g}>{meta.data.sources.filter((s) => s.group === g).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>)}
              </select>
            </Field>
            <Checkbox checked={r.shared} onChange={(v) => setR({ ...r, shared: v })}>Share with everyone in the team (otherwise only you see it)</Checkbox>
          </div></div>

          <div className="card">
            <div className="card-head"><h3>Columns</h3><span className="small faint">{d.columns.length} chosen</span></div>
            <div className="card-body stack" style={{ gap: 4, maxHeight: 360, overflowY: 'auto' }}>
              {d.columns.map((k) => byKey[k] && (
                <div key={k} className="row" style={{ gap: 4 }}>
                  <Checkbox checked onChange={() => toggleCol(k, false)}>{byKey[k].label}</Checkbox>
                  <span className="spacer" />
                  <button type="button" className="btn ghost sm" onClick={() => move(k, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="btn ghost sm" onClick={() => move(k, 1)} aria-label="Move down">↓</button>
                </div>
              ))}
              {fields.filter((f) => !d.columns.includes(f.key)).map((f) => (
                <Checkbox key={f.key} checked={false} onChange={() => toggleCol(f.key, true)}><span className="muted">{f.label}</span></Checkbox>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card"><div className="card-body stack">
            <div className="small muted">Only include rows where…</div>
            {d.filters.map((f, i) => {
              const fd = byKey[f.field] || fields[0];
              const ops = OPS_BY_TYPE[fd.type] || OPS_BY_TYPE.text;
              const setF = (patch) => setDef({ filters: d.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}><Select value={f.field} onChange={(v) => setF({ field: v, op: (OPS_BY_TYPE[byKey[v]?.type] || OPS_BY_TYPE.text)[0], value: '' })} options={fields.map((x) => [x.key, x.label])} /></div>
                  <div style={{ flex: '1 1 140px' }}><Select value={f.op} onChange={(v) => setF({ op: v })} options={ops.map((o) => [o, meta.data.ops[o]])} /></div>
                  {!['is_empty', 'is_not_empty'].includes(f.op) && <div style={{ flex: '1 1 140px' }}><Input type={['money', 'number'].includes(fd.type) ? 'number' : fd.type === 'date' ? 'date' : 'text'} value={f.value} onChange={(v) => setF({ value: v })} /></div>}
                  <button type="button" className="btn ghost sm danger" onClick={() => setDef({ filters: d.filters.filter((_, j) => j !== i) })} aria-label="Remove filter">✕</button>
                </div>
              );
            })}
            <div><button type="button" className="btn sm" onClick={() => setDef({ filters: [...d.filters, { field: fields[0].key, op: (OPS_BY_TYPE[fields[0].type] || OPS_BY_TYPE.text)[0], value: '' }] })}>+ Add filter</button></div>
            <div className="grid-3">
              <Field label="Group by" hint="Totals per group, e.g. per customer or category."><Select value={d.group_by || ''} onChange={(v) => setDef({ group_by: v || null })} options={fields.filter((f) => !['money', 'number'].includes(f.type)).map((f) => [f.key, f.label])} placeholder="No grouping (one row each)" /></Field>
              <Field label="Sort by"><Select value={d.sort?.field || ''} onChange={(v) => setDef({ sort: v ? { field: v, dir: d.sort?.dir || 'desc' } : null })}
                options={[...(d.group_by ? [['count', 'Count']] : []), ...(d.group_by ? [[d.group_by, byKey[d.group_by]?.label], ...numericCols.map((k) => [k, byKey[k].label])] : d.columns.map((k) => [k, byKey[k]?.label]))]} placeholder="Default" /></Field>
              <Field label="Order"><Select value={d.sort?.dir || 'desc'} onChange={(v) => setDef({ sort: d.sort ? { ...d.sort, dir: v } : null })} options={[['desc', 'Largest / newest first'], ['asc', 'Smallest / oldest first']]} disabled={!d.sort} /></Field>
            </div>
            {d.group_by && <div className="info-box small">Grouped: the report shows one row per {byKey[d.group_by]?.label.toLowerCase()} with a count{numericCols.length ? ` and the total of ${numericCols.map((k) => byKey[k].label).join(', ')}` : ''}. Choose number or amount columns to total them.</div>}
          </div></div>

          <div className="card">
            <div className="card-head">
              <h3>Preview</h3>
              {src.dated && <div style={{ width: 170 }}><Select value={period} onChange={(v) => { setPeriod(v); setPreview(null); }} options={PERIODS} /></div>}
              <button type="button" className="btn sm" onClick={doPreview}>Run preview</button>
            </div>
            <ErrorBox error={previewError} />
            {!preview ? <div className="faint small" style={{ padding: 16 }}>Press “Run preview” to see the first rows.</div> : (
              <div className="table-wrap"><table className="table compact">
                <thead><tr>{preview.columns.map((c) => <th key={c.key} className={['money', 'number'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {!preview.rows.length && <tr><td colSpan={preview.columns.length} className="faint center">No rows match.</td></tr>}
                  {preview.rows.map((row, i) => <tr key={i}>{preview.columns.map((c) => <td key={c.key} className={['money', 'number'].includes(c.type) ? 'num' : ''}>{cell(c, row[c.key])}</td>)}</tr>)}
                </tbody>
                {preview.totals && <tfoot><tr>{preview.columns.map((c, i) => <td key={c.key} className={['money', 'number'].includes(c.type) ? 'num' : ''}>{i === 0 ? 'Total' : preview.totals[c.key] !== undefined ? cell(c, preview.totals[c.key]) : ''}</td>)}</tr></tfoot>}
              </table>
              {preview.row_count > preview.rows.length && <div className="small faint" style={{ padding: 8 }}>Showing 200 of {preview.row_count} rows.</div>}</div>
            )}
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !r.name.trim() || !d.columns.length} onClick={save}>{busy ? 'Saving…' : 'Save report'}</button>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
