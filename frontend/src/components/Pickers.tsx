import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { money, qty } from '../lib/format';
import { useDebounced } from './ui';

/**
 * Searchable remote combobox.
 * fetcher(term) => Promise<array>; renderOption(o) => node; getLabel(o) => string.
 */
export function Combobox({ value, valueLabel, onSelect, fetcher, renderOption, getLabel, placeholder, onCreate, createLabel, disabled, autoFocus }: any) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState([]);
  const [hl, setHl] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(term, 200);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  // Position the list against the viewport so tables with overflow don't clip it.
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 300 && r.top > below;
      setPos({ left: r.left, width: Math.max(r.width, 300), ...(up ? { top: 'auto', bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2, bottom: 'auto' }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetcher(debounced).then((o) => { if (alive) { setOptions(o); setHl(0); } }).catch(() => alive && setOptions([])).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setTerm(''); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (o) => { onSelect(o); setOpen(false); setTerm(''); };
  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, options.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && options[hl]) { e.preventDefault(); pick(options[hl]); }
    if (e.key === 'Escape') { setOpen(false); setTerm(''); }
  };

  return (
    <div className="combo" ref={ref}>
      <input ref={inputRef} className="input" disabled={disabled} autoFocus={autoFocus} placeholder={placeholder}
        value={open ? term : (valueLabel || '')} onFocus={() => setOpen(true)} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onKeyDown={onKey} />
      {open && (
        <div className="combo-list" style={pos ? { position: 'fixed', right: 'auto', ...pos } : undefined}>
          {loading && !options.length && <div className="empty">Searching…</div>}
          {!loading && !options.length && <div className="empty">No results</div>}
          {options.map((o, i) => (
            <button type="button" key={o.id} className={`${i === hl ? 'hl' : ''} ${value === o.id ? 'bold' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => pick(o)}>
              {renderOption ? renderOption(o) : getLabel(o)}
            </button>
          ))}
          {onCreate && <button type="button" className="add" onClick={() => { setOpen(false); onCreate(term); }}>+ {createLabel || 'Add new'}</button>}
        </div>
      )}
    </div>
  );
}

export function ContactPicker({ type, value, valueLabel, onSelect, onCreate, disabled, autoFocus }: any) {
  const endpoint = type === 'customer' ? '/customers' : '/vendors';
  return (
    <Combobox value={value} valueLabel={valueLabel} disabled={disabled} autoFocus={autoFocus}
      placeholder={`Select or search a ${type}`} onSelect={onSelect}
      fetcher={(t) => api.get(endpoint, { search: t, status: 'active', per_page: 20 }).then((r) => r.data)}
      renderOption={(c) => (
        <div>
          <div>{c.display_name}</div>
          <div className="small faint">{[c.company_name !== c.display_name && c.company_name, c.email, c.phone].filter(Boolean).join(' · ')}</div>
        </div>
      )}
      onCreate={onCreate} createLabel={`New ${type}`} />
  );
}

export function ItemPicker({ value, valueLabel, onSelect, params = {}, priceKind = 'sales', disabled, placeholder = 'Type or click to select an item' }: any) {
  return (
    <Combobox value={value} valueLabel={valueLabel} disabled={disabled} placeholder={placeholder} onSelect={onSelect}
      fetcher={(t) => api.get('/items', { search: t, status: 'active', per_page: 25, ...params }).then((r) => r.data)}
      renderOption={(it) => (
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{it.name}</div>
            <div className="small faint">{[it.sku && `SKU: ${it.sku}`, `Rate: ${money(priceKind === 'sales' ? it.selling_price : it.cost_price)}`].filter(Boolean).join(' · ')}</div>
          </div>
          {it.track_inventory && (
            <div className="small right">
              <div className="faint">Available</div>
              <div className={it.available_stock <= 0 ? 'bold' : ''} style={{ color: it.available_stock <= 0 ? 'var(--red)' : undefined }}>{qty(it.available_stock)} {it.unit || ''}</div>
            </div>
          )}
        </div>
      )} />
  );
}
