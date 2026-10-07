import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { label } from '../lib/format';
import Icon from './Icon';

/** Load data on mount / when deps change. Returns { data, error, loading, reload, setData }. */
export function useApi(path: any, params?: any, deps: any[] = [], _extra?: any): any {
  const [state, setState] = useState<any>({ data: null, error: null, loading: true });
  const key = path ? `${path}?${JSON.stringify(params || {})}` : null;
  const counter = useRef(0);
  const load = useCallback(async () => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    const n = ++counter.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path, params);
      if (n === counter.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === counter.current) setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

const STATUS_COLORS = {
  draft: 'grey', confirmed: 'blue', closed: 'green', void: 'grey', issued: 'blue', cancelled: 'grey',
  sent: 'blue', open: 'blue', partially_paid: 'orange', paid: 'green', overdue: 'red', unpaid: 'orange',
  not_shipped: 'orange', shipped: 'blue', in_transit: 'purple', delivered: 'green', returned: 'red', failed: 'red',
  pending: 'orange', packed: 'blue', partially_packed: 'orange', partially_shipped: 'orange',
  not_invoiced: 'grey', partially_invoiced: 'orange', invoiced: 'green',
  received: 'green', partially_received: 'orange', not_billed: 'grey', partially_billed: 'orange', billed: 'green',
  adjusted: 'green', approved: 'blue', credited: 'green', active: 'green', inactive: 'grey', invited: 'orange',
  low: 'orange', out: 'red', in_stock: 'green', due_soon: 'orange',
  expired: 'red', accepted: 'green', declined: 'red', converted: 'purple', shopify: 'purple', direct: 'grey',
};

export function Badge({ status, children }: any) {
  if (!status && !children) return null;
  return <span className={`badge ${STATUS_COLORS[status] || ''}`}>{children || label(status)}</span>;
}

export const Spinner = () => <div className="spinner" />;

export function EmptyState({ title, text, action }: any) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error }: any) {
  if (!error) return null;
  return <div className="error-box">{error.message || String(error)}</div>;
}

export function Field({ label: text, required, hint, children, className = '' }: any) {
  return (
    <div className={`field ${className}`}>
      {text && <label className={required ? 'req' : ''}>{text}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function FormRow({ label: text, required, children, hint }: any) {
  return (
    <div className="form-row">
      <label className={required ? 'req' : ''}>{text}{required ? '*' : ''}</label>
      <div>{children}{hint && <div className="hint faint small" style={{ marginTop: 4 }}>{hint}</div>}</div>
    </div>
  );
}

export function Input({ value, onChange, ...rest }: any) {
  return <input className={`input ${rest.type === 'number' ? 'num' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Select({ value, onChange, options, placeholder, ...rest }: any) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (Array.isArray(o)
        ? <option key={o[0]} value={o[0]}>{o[1]}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function Textarea({ value, onChange, ...rest }: any) {
  return <textarea className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Checkbox({ checked, onChange, children, disabled }: any) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Tabs({ tabs, active, onChange }: any) {
  return (
    <div className="tabs">
      {tabs.map(([key, text]) => (
        <button type="button" key={key} className={active === key ? 'active' : ''} onClick={() => onChange(key)}>{text}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: any) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog. Usage: const confirm = useConfirm(); if (await confirm({...})) ... */
let confirmSetter = null;
export function ConfirmHost() {
  const [state, setState] = useState(null);
  confirmSetter = setState;
  if (!state) return null;
  const close = (v) => { state.resolve(v); setState(null); };
  return (
    <Modal title={state.title || 'Are you sure?'} onClose={() => close(false)}
      footer={<>
        <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
        <button type="button" className={`btn ${state.danger ? 'danger solid' : 'primary'}`} onClick={() => close(true)} autoFocus>{state.confirmText || 'Confirm'}</button>
      </>}>
      <div style={{ whiteSpace: 'pre-line' }}>{state.message}</div>
    </Modal>
  );
}
export function confirmDialog(opts: any) {
  return new Promise((resolve) => { if (confirmSetter) confirmSetter({ ...opts, resolve }); else resolve(window.confirm(opts.message)); });
}

export function Dropdown({ button, children, left }: any) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {button(() => setOpen((o) => !o), open)}
      {open && <div className={`menu ${left ? 'left' : ''}`} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export function PageHead({ title, crumb, children }: any) {
  return (
    <>
      {crumb && <div className="breadcrumb">{crumb}</div>}
      <div className="page-head">
        <h1>{title}</h1>
        <div className="btn-group">{children}</div>
      </div>
    </>
  );
}

export function BackLink({ to, children }: any) {
  return <Link to={to} className="small"><Icon name="back" size={12} className="" /> {children}</Link>;
}

/** Debounce a value. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Run an async action with busy state + toast on error. */
export function useAction(toast: any) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: any, success?: any) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (err) {
      toast(err.message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [busy, run] as const;
}
