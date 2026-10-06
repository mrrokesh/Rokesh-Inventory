import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fetchAll } from '../api';
import { downloadXlsx } from '../lib/format';
import { EmptyState, ErrorBox, Spinner, useDebounced } from './ui';
import { useToast } from './Toast';
import Icon from './Icon';

/**
 * Server-paginated table with search, filters, sorting, selection, bulk actions and Excel export.
 * columns: [{ key, label, render?: (row) => node, sort?: 'serverKey', num?: bool, csv?: (row) => value }]
 */
export default function DataTable({
  endpoint, columns, rowLink, filters = [], params: fixedParams = {}, bulkActions = [], exportName,
  toolbarExtra, emptyTitle = 'Nothing here yet', emptyText, emptyAction, perPage = 25, reloadKey = 0, searchPlaceholder = 'Search',
}: any) {
  const navigate = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get('search') || '');
  const debounced = useDebounced(search);
  const page = Number(sp.get('page') || 1);
  const sort = sp.get('sort') || '';
  const dir = sp.get('dir') || '';
  const filterValues = Object.fromEntries(filters.map((f) => [f.key, sp.get(f.key) ?? f.default ?? '']));
  const [state, setState] = useState({ loading: true, data: [], total: 0, error: null });
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);

  const query = useMemo(() => ({
    ...fixedParams, ...filterValues, search: debounced, page, per_page: perPage, sort, dir,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(fixedParams), JSON.stringify(filterValues), debounced, page, perPage, sort, dir]);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(endpoint, query)
      .then((res) => { if (alive) { setState({ loading: false, data: res.data || res, total: res.total ?? (res.data || res).length, error: null }); setSelected(new Set()); } })
      .catch((error) => alive && setState({ loading: false, data: [], total: 0, error }));
    return () => { alive = false; };
  }, [endpoint, query, reloadKey, tick]);

  useEffect(() => {
    if ((sp.get('search') || '') !== debounced) {
      const next = new URLSearchParams(sp);
      if (debounced) next.set('search', debounced); else next.delete('search');
      next.delete('page');
      setSp(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const setParam = (k, v, keepEmpty = false) => {
    const next = new URLSearchParams(sp);
    if ((v === '' && !keepEmpty) || v === undefined || v === null) next.delete(k); else next.set(k, v);
    if (k !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };
  const toggleSort = (key) => {
    const next = new URLSearchParams(sp);
    if (sort === key) next.set('dir', dir === 'asc' ? 'desc' : 'asc');
    else { next.set('sort', key); next.set('dir', 'asc'); }
    setSp(next, { replace: true });
  };

  const pages = Math.max(1, Math.ceil(state.total / perPage));
  const allSelected = state.data.length > 0 && state.data.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(state.data.map((r) => r.id)));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const doExport = async () => {
    setExporting(true);
    try {
      const rows = await fetchAll(endpoint, { ...fixedParams, ...filterValues, search: debounced, sort, dir });
      const cols = columns.filter((c) => c.csv !== false).map((c) => ({ key: c.key, label: c.label }));
      const flat = rows.map((r) => Object.fromEntries(columns.filter((c) => c.csv !== false).map((c) => [c.key, c.csv ? c.csv(r) : r[c.key]])));
      await downloadXlsx(`${exportName}.xlsx`, cols, flat);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const runBulk = async (action) => {
    const ids = [...selected];
    const ok = await action.run(ids);
    if (ok !== false) setTick((t) => t + 1);
  };

  const hasBulk = bulkActions.length > 0;
  return (
    <div className="card">
      <div className="toolbar">
        <input type="search" className="input" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
        {filters.map((f) => (
          <select key={f.key} className="input" style={{ width: 'auto' }} value={filterValues[f.key]} onChange={(e) => setParam(f.key, e.target.value, !!f.default)} aria-label={f.label}>
            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        <div className="spacer" />
        {toolbarExtra}
        {exportName && (
          <button type="button" className="btn sm" onClick={doExport} disabled={exporting}>
            <Icon name="download" size={14} className="" /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        )}
      </div>
      {hasBulk && selected.size > 0 && (
        <div className="bulkbar">
          <strong>{selected.size} selected</strong>
          {bulkActions.map((a) => (
            <button type="button" key={a.label} className={`btn sm ${a.danger ? 'danger' : ''}`} onClick={() => runBulk(a)}>{a.label}</button>
          ))}
          <button type="button" className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <ErrorBox error={state.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {hasBulk && <th className="check"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>}
              {columns.map((c) => (
                <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}`} onClick={c.sort ? () => toggleSort(c.sort) : undefined}>
                  {c.label}{c.sort && sort === c.sort ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.data.map((row) => (
              <tr key={row.id ?? JSON.stringify(row)} className={`${rowLink ? 'clickable' : ''} ${selected.has(row.id) ? 'selected' : ''}`}
                onClick={rowLink ? (e) => { if (!(e.target as HTMLElement).closest('input,button,a')) navigate(rowLink(row)); } : undefined}>
                {hasBulk && <td className="check"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} aria-label="Select row" /></td>}
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.loading && <Spinner />}
      {!state.loading && !state.error && state.data.length === 0 && (
        <EmptyState title={debounced || Object.values(filterValues).some(Boolean) ? 'No matching records' : emptyTitle} text={emptyText} action={emptyAction} />
      )}
      {state.total > perPage && (
        <div className="pager">
          <span>{(page - 1) * perPage + 1}–{Math.min(page * perPage, state.total)} of {state.total}</span>
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setParam('page', page - 1)}>Prev</button>
          <span>Page {page} / {pages}</span>
          <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setParam('page', page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
