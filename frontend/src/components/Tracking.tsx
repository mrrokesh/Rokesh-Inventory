// Serial-number / batch entry for one line.
// direction 'in'  → type new serial numbers / batch numbers
// direction 'out' → choose from what is in stock (or leave empty to pick automatically)
import { useEffect, useState } from 'react';
import { api } from '../api';
import { date, qty as fmtQty } from '../lib/format';
import { Modal } from './ui';

const parseSerials = (text) => [...new Set(String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];

export function trackingSummary(t) {
  if (!t) return '';
  if (t.serials?.length) return `${t.serials.length} serial${t.serials.length > 1 ? 's' : ''}: ${t.serials.slice(0, 3).join(', ')}${t.serials.length > 3 ? '…' : ''}`;
  if (t.batches?.length) return t.batches.map((b) => `${b.batch_no || 'batch'} × ${b.quantity}`).join(', ');
  return '';
}

export function TrackingModal({ itemId, itemName, mode, direction, quantity, warehouseId, value, onSave, onClose }: any) {
  const need = Number(quantity) || 0;
  const [serialText, setSerialText] = useState((value?.serials || []).join('\n'));
  const [chosen, setChosen] = useState(new Set(value?.serials || []));
  const [batches, setBatches] = useState(value?.batches?.length ? value.batches : [{ batch_no: '', quantity: need, mfg_date: '', expiry_date: '' }]);
  const [outBatches, setOutBatches] = useState(Object.fromEntries((value?.batches || []).map((b) => [b.batch_no, b.quantity])));
  const [stock, setStock] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (direction !== 'out' || !itemId) return;
    api.get(`/items/${itemId}/tracking`, warehouseId ? { warehouse_id: warehouseId } : {}).then(setStock).catch(() => setStock({ serials: [], batches: [] }));
  }, [direction, itemId, warehouseId]);

  const save = () => {
    setError('');
    if (mode === 'serial') {
      const list = direction === 'in' ? parseSerials(serialText) : [...chosen];
      if (list.length && list.length !== Math.round(need)) { setError(`Enter exactly ${need} serial number(s) — you have ${list.length}.`); return; }
      if (direction === 'in' && !list.length) { setError('Enter the serial numbers.'); return; }
      onSave(list.length ? { serials: list } : null);
    } else if (direction === 'in') {
      const list = batches.filter((b) => b.batch_no.trim() && Number(b.quantity) > 0).map((b) => ({ ...b, batch_no: b.batch_no.trim(), quantity: Number(b.quantity) }));
      const sum = list.reduce((s, b) => s + b.quantity, 0);
      if (Math.abs(sum - need) > 0.0005) { setError(`Batch quantities add up to ${sum}, but the line quantity is ${need}.`); return; }
      onSave({ batches: list });
    } else {
      const list = Object.entries(outBatches).filter(([, q]) => Number(q) > 0).map(([batch_no, q]) => ({ batch_no, quantity: Number(q) }));
      const sum = list.reduce((s, b) => s + b.quantity, 0);
      if (list.length && Math.abs(sum - need) > 0.0005) { setError(`Selected quantities add up to ${sum}, but the line quantity is ${need}.`); return; }
      onSave(list.length ? { batches: list } : null);
    }
  };

  const count = mode === 'serial' ? (direction === 'in' ? parseSerials(serialText).length : chosen.size) : null;
  return (
    <Modal wide title={`${mode === 'serial' ? 'Serial numbers' : 'Batches'} — ${itemName}`} onClose={onClose}
      footer={<>
        {mode === 'serial' && <span className="muted" style={{ marginRight: 'auto' }}>{count} of {need} {direction === 'in' ? 'entered' : 'selected'}</span>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={save}>Save</button>
      </>}>
      {error && <div className="error-box">{error}</div>}
      {direction === 'out' && <div className="info-box small mb">Pick the exact {mode === 'serial' ? 'units' : 'batches'} going out, or leave everything unselected and the app will pick automatically ({mode === 'serial' ? 'oldest first' : 'earliest expiry first'}).</div>}

      {mode === 'serial' && direction === 'in' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Type or scan {need} serial number(s), one per line (commas also work). A barcode scanner that presses Enter after each scan works well here.</p>
          <textarea className="input mono" rows={10} autoFocus value={serialText} onChange={(e) => setSerialText(e.target.value)} placeholder={'SN-0001\nSN-0002'} />
        </>
      )}

      {mode === 'serial' && direction === 'out' && (
        !stock ? 'Loading…' : !stock.serials?.length ? <div className="faint">No serial numbers of this item are in stock in this warehouse.</div> : (
          <>
            <div className="row mb"><button type="button" className="btn sm" onClick={() => setChosen(new Set(stock.serials.slice(0, Math.round(need)).map((s) => s.serial)))}>Select oldest {need}</button>
              <button type="button" className="btn sm ghost" onClick={() => setChosen(new Set())}>Clear</button></div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
              {stock.serials.map((s) => (
                <label key={s.id} className="checkbox mono" style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <input type="checkbox" checked={chosen.has(s.serial)} onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(s.serial); else n.delete(s.serial);
                    setChosen(n);
                  }} />{s.serial}
                </label>
              ))}
            </div>
          </>
        )
      )}

      {mode === 'batch' && direction === 'in' && (
        <>
          <table className="table compact lines">
            <thead><tr><th>Batch number</th><th>Manufactured</th><th>Expiry date</th><th className="num">Quantity</th><th /></tr></thead>
            <tbody>{batches.map((b, i) => (
              <tr key={i}>
                <td><input className="input" value={b.batch_no} autoFocus={i === 0} onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, batch_no: e.target.value } : x)))} /></td>
                <td><input className="input" type="date" value={b.mfg_date || ''} onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, mfg_date: e.target.value } : x)))} /></td>
                <td><input className="input" type="date" value={b.expiry_date || ''} onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, expiry_date: e.target.value } : x)))} /></td>
                <td><input className="input num" type="number" min="0" step="any" value={b.quantity} onChange={(e) => setBatches(batches.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                <td><button type="button" className="btn ghost sm danger" disabled={batches.length === 1} onClick={() => setBatches(batches.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
          <button type="button" className="btn sm mt" onClick={() => setBatches([...batches, { batch_no: '', quantity: '', mfg_date: '', expiry_date: '' }])}>+ Add batch</button>
        </>
      )}

      {mode === 'batch' && direction === 'out' && (
        !stock ? 'Loading…' : !stock.batches?.length ? <div className="faint">No batches of this item are in stock in this warehouse.</div> : (
          <table className="table compact">
            <thead><tr><th>Batch</th><th>Expiry</th><th className="num">Available</th><th className="num" style={{ width: 140 }}>Take</th></tr></thead>
            <tbody>{stock.batches.map((b) => (
              <tr key={b.id}><td className="mono">{b.batch_no}</td><td>{date(b.expiry_date) || '—'}</td><td className="num">{fmtQty(b.quantity)}</td>
                <td><input className="input num" type="number" min="0" max={b.quantity} step="any" value={outBatches[b.batch_no] ?? ''} onChange={(e) => setOutBatches({ ...outBatches, [b.batch_no]: e.target.value })} /></td></tr>
            ))}</tbody>
          </table>
        )
      )}
    </Modal>
  );
}

/** Small button + summary shown on a line for tracked items. */
export function TrackingButton({ mode, direction, value, required, onClick }: any) {
  if (!mode || mode === 'none') return null;
  const summary = trackingSummary(value);
  return (
    <div className="small" style={{ marginTop: 4 }}>
      <button type="button" className="btn link small" onClick={onClick}>
        {summary ? 'Change' : direction === 'in' ? `Add ${mode === 'serial' ? 'serial numbers' : 'batch details'}` : `Choose ${mode === 'serial' ? 'serial numbers' : 'batches'}`}
      </button>
      {summary ? <span className="faint"> · {summary}</span> : required ? <span style={{ color: 'var(--red)' }}> · required</span> : <span className="faint"> · optional (picked automatically)</span>}
    </div>
  );
}
