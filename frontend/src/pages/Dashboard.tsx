import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Modal, Select, confirmDialog } from '../components/ui';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon';
import { DEFAULT_LAYOUT, WIDGETS, WIDGET_MAP, WidgetIcon, WidgetPlaceholder } from './dashboard/widgets';

const PERIODS = [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['this_year', 'This fiscal year'], ['last_12_months', 'Last 12 months']];
const PERIOD_TEXT = { this_month: 'this month', last_month: 'last month', this_quarter: 'this quarter', this_year: 'this fiscal year', last_12_months: 'in the last 12 months' };
const SIZE_LABEL = { small: 'S', medium: 'M', large: 'L' };
const REFRESH_MS = 5 * 60 * 1000;

function ago(ts, now) {
  if (!ts) return '';
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  return m === 1 ? '1 minute ago' : `${m} minutes ago`;
}

function Gallery({ layout, onAdd, onClose, can }: any) {
  const available = WIDGETS.filter((w) => !w.perm || can(w.perm));
  return (
    <Modal wide title="Add widgets" onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ marginTop: 0 }}>Pick the information you want to see first when you open the app. Small widgets show one number; larger ones add detail.</p>
      <div className="gallery">
        {available.map((w) => {
          const onBoard = layout.some((l) => l.id === w.id);
          return (
            <div className="gallery-item" key={w.id}>
              <h4><WidgetIcon w={w} /> {w.title}</h4>
              <p>{w.description}</p>
              <div className="row" style={{ gap: 6 }}>
                {onBoard ? <span className="badge green">✓ On your dashboard</span> : w.sizes.map((s) => (
                  <button type="button" key={s} className="btn sm" onClick={() => onAdd(w.id, s)}>+ {s[0].toUpperCase() + s.slice(1)}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [period, setPeriod] = useState('this_year');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [layout, setLayout] = useState(null);
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setData(await api.get('/dashboard', { period }));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (err) { setError(err); } finally { loadingRef.current = false; }
  }, [period]);

  useEffect(() => { load(); }, [load]);
  // Keep content fresh: refresh periodically and when the tab regains focus.
  useEffect(() => {
    const t = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const onFocus = () => { if (Date.now() - (updatedAt || 0) > 60000) load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); clearInterval(tick); window.removeEventListener('focus', onFocus); };
  }, [load, updatedAt]);

  useEffect(() => {
    api.get('/auth/me/dashboard').then((r) => setLayout(r.layout || DEFAULT_LAYOUT)).catch(() => setLayout(DEFAULT_LAYOUT));
  }, []);

  const saveLayout = async (next) => {
    setLayout(next);
    try { await api.put('/auth/me/dashboard', { layout: next }); } catch (err) { toast(`Layout not saved: ${err.message}`, 'error'); }
  };
  const visible = (layout || []).filter((l) => WIDGET_MAP[l.id] && (!WIDGET_MAP[l.id].perm || can(WIDGET_MAP[l.id].perm)));

  const move = (id, dir) => {
    const i = layout.findIndex((l) => l.id === id);
    const j = i + dir;
    if (j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    saveLayout(next);
  };
  const drop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const next = layout.filter((l) => l.id !== dragId);
    const idx = next.findIndex((l) => l.id === targetId);
    next.splice(idx, 0, layout.find((l) => l.id === dragId));
    saveLayout(next);
  };
  const resize = (id, size) => saveLayout(layout.map((l) => (l.id === id ? { ...l, size } : l)));
  const remove = (id) => saveLayout(layout.filter((l) => l.id !== id));
  const add = (id, size) => { saveLayout([...layout, { id, size }]); toast(`${WIDGET_MAP[id].title} added`); };
  const reset = async () => {
    if (await confirmDialog({ message: 'Put the dashboard back to the standard set of widgets?', confirmText: 'Reset' })) saveLayout(DEFAULT_LAYOUT);
  };

  const actions = {
    markDelivered: async (s) => {
      try {
        await api.put(`/shipments/${s.id}`, { ...s, status: 'delivered' });
        toast(`${s.number} marked as delivered`);
        load();
      } catch (err) { toast(err.message, 'error'); }
    },
  };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ marginRight: 'auto' }}>
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <div className="updated" aria-live="polite">
            {updatedAt ? `Updated ${ago(updatedAt, now)}` : 'Loading…'}
            {' · '}<button type="button" className="btn link small" onClick={load}>Refresh</button>
          </div>
        </div>
        {!editing && <div style={{ width: 170 }}><Select value={period} onChange={setPeriod} options={PERIODS} aria-label="Period" /></div>}
        {editing ? (
          <>
            <button type="button" className="btn" onClick={() => setGallery(true)}><Icon name="plus" size={14} className="" /> Add widgets</button>
            <button type="button" className="btn" onClick={reset}>Reset</button>
            <button type="button" className="btn primary" onClick={() => setEditing(false)}>Done</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} className="" /> Customize</button>
        )}
      </div>
      {editing && <div className="info-box mb small">Drag widgets to reorder them (or use the ◀ ▶ buttons). Use S / M / L to change a widget's size, and × to remove it. Changes are saved automatically.</div>}
      <ErrorBox error={error} />

      <div className={`widget-grid ${editing ? 'editing' : ''}`}>
        {visible.map((l) => {
          const w = WIDGET_MAP[l.id];
          const size = w.sizes.includes(l.size) ? l.size : w.defaultSize;
          const href = w.link && data ? w.link(data) : null;
          const go = () => { if (!editing && href) navigate(href); };
          return (
            <section key={l.id}
              className={`widget ${size} ${href && !editing ? 'link' : ''} ${dragId === l.id ? 'dragging' : ''} ${overId === l.id && dragId !== l.id ? 'drop-target' : ''}`}
              aria-label={w.title}
              tabIndex={href && !editing ? 0 : undefined}
              onClick={go}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) go(); }}
              draggable={editing}
              onDragStart={() => setDragId(l.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { if (editing) { e.preventDefault(); setOverId(l.id); } }}
              onDrop={(e) => { e.preventDefault(); drop(l.id); setDragId(null); setOverId(null); }}>
              {editing && (
                <div className="w-edit">
                  <button type="button" onClick={() => move(l.id, -1)} aria-label={`Move ${w.title} earlier`}>◀</button>
                  <button type="button" onClick={() => move(l.id, 1)} aria-label={`Move ${w.title} later`}>▶</button>
                  {w.sizes.length > 1 && ['small', 'medium', 'large'].filter((s) => w.sizes.includes(s)).map((s) => (
                    <button type="button" key={s} className={size === s ? 'on' : ''} onClick={() => resize(l.id, s)} aria-label={`${s} size`} aria-pressed={size === s}>{SIZE_LABEL[s]}</button>
                  ))}
                  <button type="button" className="remove" onClick={() => remove(l.id)} aria-label={`Remove ${w.title}`}>×</button>
                </div>
              )}
              <div className="w-head"><WidgetIcon w={w} /><span className="w-title">{w.title}</span></div>
              {data ? w.render({ data, size, can, actions, period: PERIOD_TEXT[period] }) : <WidgetPlaceholder size={size} />}
            </section>
          );
        })}
      </div>
      {layout && visible.length === 0 && (
        <div className="empty-state">
          <h3>Your dashboard is empty</h3>
          <p>Add widgets to see the numbers that matter to you.</p>
          <button type="button" className="btn primary" onClick={() => { setEditing(true); setGallery(true); }}>Add widgets</button>
        </div>
      )}
      {gallery && <Gallery layout={layout} can={can} onAdd={add} onClose={() => setGallery(false)} />}
    </div>
  );
}
