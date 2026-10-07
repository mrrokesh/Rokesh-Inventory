import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLookups } from '../lib/lookups';
import { date, dateTime, downloadXlsx, label, money, qty } from '../lib/format';
import { Badge, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, confirmDialog, useAction, useApi } from '../components/ui';
import Icon from '../components/Icon';

const SCHEDULE_PERIODS = [['yesterday', 'Yesterday'], ['today', 'Today'], ['last_week', 'Last week'], ['this_week', 'This week'], ['this_month', 'This month so far'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This fiscal year'], ['last_30_days', 'Last 30 days'], ['last_12_months', 'Last 12 months']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${((Number(h) + 11) % 12) + 1}:00 ${Number(h) < 12 ? 'AM' : 'PM'}`;
const describeSchedule = (s) => (s.frequency === 'daily' ? `Every day at ${hourLabel(s.hour)}`
  : s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.weekday]} at ${hourLabel(s.hour)}` : `Monthly on day ${s.day_of_month} at ${hourLabel(s.hour)}`);

/** Favourite star: reads/writes the signed-in user's favourites. */
function useFavourites() {
  const fav = useApi('/reports/favourites');
  const list: string[] = fav.data || [];
  const toggle = async (key) => {
    try {
      if (list.includes(key)) await api.del(`/reports/favourites/${key}`); else await api.put(`/reports/favourites/${key}`, {});
      fav.reload();
    } catch { /* ignore */ }
  };
  return { list, toggle, loaded: !!fav.data };
}

function Star({ on, onClick, title }: any) {
  return (
    <button type="button" className="btn ghost sm" onClick={onClick} title={title || (on ? 'Remove from favourites' : 'Add to favourites')} aria-label={title || (on ? 'Remove from favourites' : 'Add to favourites')}
      style={{ color: on ? '#f5a623' : 'var(--text-3, #9aa1b1)', padding: '2px 4px' }}>
      <Icon name="star" size={15} className="" style={on ? { fill: 'currentColor' } : undefined} />
    </button>
  );
}

const PERIODS = [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This fiscal year'], ['last_12_months', 'Last 12 months'], ['custom', 'Custom']];

export function ReportsIndex() {
  const { data, error } = useApi('/reports');
  const schedules = useApi('/reports/schedules');
  const fav = useFavourites();
  const [search, setSearch] = useState('');
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  const shown: any[] = data.filter((r: any) => !search || `${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase()));
  const groups: any[] = [...new Set(shown.map((r) => r.group))];
  const byKey = Object.fromEntries(data.map((r) => [r.key, r]));
  const favs = fav.list.map((k) => byKey[k]).filter(Boolean);
  return (
    <div className="page">
      <PageHead title="Reports">
        <input type="search" className="input" style={{ width: 260 }} placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Link className="btn primary" to="/reports/custom/new">+ New custom report</Link>
      </PageHead>
      {!search && (favs.length > 0 || schedules.data?.length > 0) && (
        <div className="grid-2 mb">
          <div className="card">
            <div className="card-head"><h3>★ Favourites</h3></div>
            <table className="table compact"><tbody>
              {!favs.length && <tr><td className="faint small">Click the star next to a report to keep it here.</td></tr>}
              {favs.map((r) => <tr key={r.key}><td><Star on onClick={() => fav.toggle(r.key)} /> <Link to={`/reports/${r.key}`} className="bold">{r.title}</Link></td></tr>)}
            </tbody></table>
          </div>
          <div className="card">
            <div className="card-head"><h3>Scheduled reports</h3></div>
            <table className="table compact"><tbody>
              {!schedules.data?.length && <tr><td className="faint small">Open a report and press Schedule to have it emailed automatically.</td></tr>}
              {(schedules.data || []).map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/reports/${x.report_key}`} className="bold">{byKey[x.report_key]?.title || x.report_key}</Link>
                    <div className="small faint">{describeSchedule(x)} · to {x.recipients}{!x.is_active ? ' · paused' : ''}</div></td>
                  <td className="right small">{x.last_status && <Badge status={x.last_status === 'sent' ? 'active' : 'failed'}>{x.last_status === 'sent' ? 'Last sent OK' : 'Last send failed'}</Badge>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
      <div className="grid-2">
        {groups.map((g) => (
          <div className="card" key={g}>
            <div className="card-head"><h3>{g}</h3></div>
            <table className="table compact"><tbody>
              {shown.filter((r) => r.group === g).map((r) => (
                <tr key={r.key}><td style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>{fav.loaded && <Star on={fav.list.includes(r.key)} onClick={() => fav.toggle(r.key)} />}<div><Link to={`/reports/${r.key}`} className="bold">{r.title}</Link><div className="small faint">{r.description}</div></div></td></tr>
              ))}
            </tbody></table>
          </div>
        ))}
        <div className="card">
          <div className="card-head"><h3>Activity</h3></div>
          <table className="table compact"><tbody>
            <tr><td><Link to="/settings/audit" className="bold">Activity Logs &amp; Audit Trail</Link><div className="small faint">Who created, changed or deleted what, and when.</div></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

/** Cell with an optional link: col.link = '/invoices/{id}' filled from the row. */
function Cell({ col, row }: any) {
  const v = col.key === 'source_type' ? label(row[col.key]) : fmt(col, row[col.key]);
  if (!col.link || v === '' || v === null) return <>{v}</>;
  let ok = true;
  const to = col.link.replace(/\{(\w+)\}/g, (_m, k) => { if (row[k] === null || row[k] === undefined) ok = false; return row[k]; });
  return ok ? <Link to={to}>{v}</Link> : <>{v}</>;
}

function fmt(col, v) {
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'money': return money(v);
    case 'number': return qty(v);
    case 'percent': return `${Number(v).toFixed(2)}%`;
    case 'date': return date(v);
    case 'datetime': return dateTime(v);
    case 'label': return label(v);
    case 'status': return <Badge status={v} />;
    default: return v;
  }
}

function ScheduleModal({ reportKey, title, dated, warehouse, onClose }: any) {
  const { user, can } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { warehouses } = useLookups('warehouses');
  const list = useApi('/reports/schedules', { report_key: reportKey });
  const blank = { frequency: 'weekly', weekday: 1, day_of_month: 1, hour: 9, period: dated ? 'last_week' : 'this_month', recipients: user?.email || '', warehouse_id: '' };
  const [f, setF] = useState<any>(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const editable = can('reports', 'export');
  const save = async () => {
    const body = { ...f, report_key: reportKey, hour: Number(f.hour), weekday: Number(f.weekday), day_of_month: Number(f.day_of_month) };
    if (await run(() => (f.id ? api.put(`/reports/schedules/${f.id}`, body) : api.post('/reports/schedules', body)), 'Schedule saved')) { setF(null); list.reload(); }
  };
  const remove = async (x) => {
    if (!(await confirmDialog({ message: 'Stop sending this report?', danger: true, confirmText: 'Remove' }))) return;
    if ((await run(() => api.del(`/reports/schedules/${x.id}`), 'Schedule removed')) !== undefined) list.reload();
  };
  const sendNow = async (x) => { if (await run(() => api.post(`/reports/schedules/${x.id}/send`), `Sent to ${x.recipients}`)) list.reload(); };
  const toggle = async (x) => { if (await run(() => api.put(`/reports/schedules/${x.id}`, { ...x, is_active: !x.is_active }), x.is_active ? 'Paused' : 'Resumed')) list.reload(); };
  return (
    <Modal title={`Schedule: ${title}`} onClose={onClose} wide
      footer={f ? <><button type="button" className="btn primary" disabled={busy} onClick={save}>Save schedule</button><button type="button" className="btn" onClick={() => setF(null)}>Cancel</button></>
        : <button type="button" className="btn" onClick={onClose}>Close</button>}>
      {!f ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>The report is emailed automatically: a table in the email, and the full report as a spreadsheet (CSV) attachment. Email must be set up under Settings → Email.</p>
          {list.data?.length ? (
            <table className="table compact"><tbody>
              {list.data.map((x) => (
                <tr key={x.id}>
                  <td><div className="bold">{describeSchedule(x)}{!x.is_active && <span className="faint"> (paused)</span>}</div>
                    <div className="small faint">To {x.recipients} · period: {SCHEDULE_PERIODS.find((p) => p[0] === x.period)?.[1] || x.period}</div>
                    <div className="small faint">{x.is_active ? `Next: ${new Date(x.next_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                      {x.last_status && <> · Last: {x.last_status === 'sent' ? 'sent OK' : <span style={{ color: 'var(--danger, #d33)' }}>failed – {x.last_error}</span>}</>}</div></td>
                  {editable && <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => sendNow(x)}>Send now</button>
                    <button type="button" className="btn sm" onClick={() => setF({ ...x, warehouse_id: x.warehouse_id || '' })}>Edit</button>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(x)}>{x.is_active ? 'Pause' : 'Resume'}</button>
                    <button type="button" className="btn sm danger" disabled={busy} onClick={() => remove(x)}>Remove</button>
                  </td>}
                </tr>
              ))}
            </tbody></table>
          ) : <div className="faint">This report is not scheduled yet.</div>}
          {editable && <div><button type="button" className="btn primary sm" onClick={() => setF(blank)}>+ New schedule</button></div>}
        </div>
      ) : (
        <div className="stack">
          <div className="grid-3">
            <Field label="How often"><Select value={f.frequency} onChange={set('frequency')} options={[['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']]} /></Field>
            {f.frequency === 'weekly' && <Field label="On"><Select value={f.weekday} onChange={set('weekday')} options={WEEKDAYS.map((d, i) => [i, d])} /></Field>}
            {f.frequency === 'monthly' && <Field label="On day" hint="1 to 28"><Input type="number" min="1" max="28" value={f.day_of_month} onChange={set('day_of_month')} /></Field>}
            <Field label="At"><Select value={f.hour} onChange={set('hour')} options={Array.from({ length: 24 }, (_, h) => [h, hourLabel(h)])} /></Field>
          </div>
          {dated && <Field label="Report period" hint="The dates the report covers each time it is sent."><Select value={f.period} onChange={set('period')} options={SCHEDULE_PERIODS} /></Field>}
          {warehouse && warehouses.length > 1 && <Field label="Warehouse"><Select value={f.warehouse_id || ''} onChange={set('warehouse_id')} options={warehouses.map((w) => [w.id, w.name])} placeholder="All warehouses" /></Field>}
          <Field label="Send to" required hint="Email addresses, separated by commas."><Input value={f.recipients} onChange={set('recipients')} /></Field>
        </div>
      )}
    </Modal>
  );
}

export function ReportView() {
  const { key } = useParams();
  const [sp, setSp] = useSearchParams();
  const { warehouses, reportingTags } = useLookups('warehouses', 'reportingTags');
  const period = sp.get('period') || 'this_year';
  const tagParams = Object.fromEntries([...sp.entries()].filter(([k, v]) => /^tag_\d+$/.test(k) && v));
  const params = { period: period === 'custom' ? undefined : period, from: period === 'custom' ? sp.get('from') : undefined, to: period === 'custom' ? sp.get('to') : undefined, warehouse_id: sp.get('warehouse_id') || undefined, ...tagParams };
  const { data: rep, error, loading } = useApi(`/reports/${key}`, params);
  const fav = useFavourites();
  const [scheduling, setScheduling] = useState(false);
  const setParam = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const exportXlsx = () => {
    const rows = rep.totals ? [...rep.rows, { ...rep.totals, [rep.columns[0].key]: 'Total' }] : rep.rows;
    downloadXlsx(`${key}-${rep.from}-${rep.to}.xlsx`, rep.columns, rows);
  };
  const chartData = rep?.chart ? rep.rows.slice(0, rep.chart.limit).map((r) => ({ name: String(r[rep.chart.label]).slice(0, 18), value: Number(r[rep.chart.value]) })) : null;

  return (
    <div className="page">
      <PageHead title={rep?.title || 'Report'} crumb={<Link to="/reports">Reports</Link>}>
        {fav.loaded && <Star on={fav.list.includes(key)} onClick={() => fav.toggle(key)} />}
        {rep?.custom && <Link className="btn" to={`/reports/custom/${key.replace('custom_', '')}/edit`}>Edit report</Link>}
        {rep && <button type="button" className="btn" onClick={() => setScheduling(true)}><Icon name="clock" size={14} className="" /> Schedule</button>}
        {rep && <button type="button" className="btn" onClick={exportXlsx}><Icon name="download" size={14} className="" /> Export Excel</button>}
        {rep && <button type="button" className="btn" onClick={() => window.print()}><Icon name="print" size={14} className="" /> Print / PDF</button>}
      </PageHead>
      <div className="card mb no-print"><div className="toolbar" style={{ borderBottom: 0 }}>
        {(rep?.dated ?? true) && (
          <>
            <div style={{ width: 180 }}><Select value={period} onChange={(v) => setParam('period', v)} options={PERIODS} /></div>
            {period === 'custom' && (
              <>
                <input type="date" className="input" style={{ width: 160 }} value={sp.get('from') || ''} onChange={(e) => setParam('from', e.target.value)} aria-label="From" />
                <span>to</span>
                <input type="date" className="input" style={{ width: 160 }} value={sp.get('to') || ''} onChange={(e) => setParam('to', e.target.value)} aria-label="To" />
              </>
            )}
          </>
        )}
        {rep?.warehouse && warehouses.length > 1 && (
          <div style={{ width: 220 }}><Select value={sp.get('warehouse_id') || ''} onChange={(v) => setParam('warehouse_id', v)} options={warehouses.map((w) => [w.id, w.name])} placeholder="All warehouses" /></div>
        )}
        {rep?.tagged && (reportingTags?.tags || []).filter((t) => t.is_active).map((t) => (
          <div key={t.id} style={{ width: 180 }}><Select value={sp.get(`tag_${t.id}`) || ''} onChange={(v) => setParam(`tag_${t.id}`, v)} options={(t.options || []).map((o) => [o, o])} placeholder={`All ${t.name}`} aria-label={t.name} /></div>
        ))}
        {rep && <span className="muted small">{rep.dated ? `${date(rep.from)} – ${date(rep.to)}` : `As of today`}{rep.tag_filters?.length ? ` · ${rep.tag_filters.map((f) => `${f.name}: ${f.value}`).join(', ')}` : ''}</span>}
      </div></div>
      <ErrorBox error={error} />
      {scheduling && rep && <ScheduleModal reportKey={key} title={rep.title} dated={rep.dated} warehouse={rep.warehouse} onClose={() => setScheduling(false)} />}
      {loading && !rep && <Spinner />}
      {rep && (
        <>
          {rep.description && <p className="muted" style={{ marginTop: 0 }}>{rep.description}</p>}
          {chartData && chartData.length > 0 && (
            <div className="card mb no-print"><div className="card-body" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e6ec" />
                  <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} interval={0} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="value" fill="#408dfb" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div></div>
          )}
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{rep.columns.map((c) => <th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rep.rows.length === 0 && <tr><td colSpan={rep.columns.length} className="faint center">No data for this period.</td></tr>}
                  {rep.rows.map((r, i) => (
                    <tr key={i} className={r.bold ? 'bold' : ''}>
                      {rep.columns.map((c) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''} style={r.bold ? { fontWeight: 600, background: 'var(--surface-2)' } : undefined}><Cell col={c} row={r} /></td>)}
                    </tr>
                  ))}
                </tbody>
                {rep.totals && rep.rows.length > 0 && (
                  <tfoot><tr>{rep.columns.map((c, i) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{i === 0 ? 'Total' : rep.totals[c.key] !== undefined ? fmt(c, rep.totals[c.key]) : ''}</td>)}</tr></tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
