import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLookups } from '../lib/lookups';
import { date, downloadXlsx, label, money, qty } from '../lib/format';
import { Badge, ErrorBox, PageHead, Select, Spinner, useApi } from '../components/ui';
import Icon from '../components/Icon';

const PERIODS = [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This fiscal year'], ['last_12_months', 'Last 12 months'], ['custom', 'Custom']];

export function ReportsIndex() {
  const { data, error } = useApi('/reports');
  const [search, setSearch] = useState('');
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  const shown: any[] = data.filter((r: any) => !search || `${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase()));
  const groups: any[] = [...new Set(shown.map((r) => r.group))];
  return (
    <div className="page">
      <PageHead title="Reports"><input type="search" className="input" style={{ width: 260 }} placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} /></PageHead>
      <div className="grid-2">
        {groups.map((g) => (
          <div className="card" key={g}>
            <div className="card-head"><h3>{g}</h3></div>
            <table className="table compact"><tbody>
              {shown.filter((r) => r.group === g).map((r) => (
                <tr key={r.key}><td><Link to={`/reports/${r.key}`} className="bold">{r.title}</Link><div className="small faint">{r.description}</div></td></tr>
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

function fmt(col, v) {
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'money': return money(v);
    case 'number': return qty(v);
    case 'percent': return `${Number(v).toFixed(2)}%`;
    case 'date': return date(v);
    case 'status': return <Badge status={v} />;
    default: return v;
  }
}

export function ReportView() {
  const { key } = useParams();
  const [sp, setSp] = useSearchParams();
  const { warehouses } = useLookups('warehouses');
  const period = sp.get('period') || 'this_year';
  const params = { period: period === 'custom' ? undefined : period, from: period === 'custom' ? sp.get('from') : undefined, to: period === 'custom' ? sp.get('to') : undefined, warehouse_id: sp.get('warehouse_id') || undefined };
  const { data: rep, error, loading } = useApi(`/reports/${key}`, params);
  const setParam = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const exportXlsx = () => {
    const rows = rep.totals ? [...rep.rows, { ...rep.totals, [rep.columns[0].key]: 'Total' }] : rep.rows;
    downloadXlsx(`${key}-${rep.from}-${rep.to}.xlsx`, rep.columns, rows);
  };
  const chartData = rep?.chart ? rep.rows.slice(0, rep.chart.limit).map((r) => ({ name: String(r[rep.chart.label]).slice(0, 18), value: Number(r[rep.chart.value]) })) : null;

  return (
    <div className="page">
      <PageHead title={rep?.title || 'Report'} crumb={<Link to="/reports">Reports</Link>}>
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
        {rep && <span className="muted small">{rep.dated ? `${date(rep.from)} – ${date(rep.to)}` : `As of today`}</span>}
      </div></div>
      <ErrorBox error={error} />
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
                      {rep.columns.map((c) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''} style={r.bold ? { fontWeight: 600, background: 'var(--surface-2)' } : undefined}>{c.key === 'source_type' ? label(r[c.key]) : fmt(c, r[c.key])}</td>)}
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
