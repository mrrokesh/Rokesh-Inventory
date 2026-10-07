import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useLookups } from '../../lib/lookups';
import { money, qty, today, PAYMENT_TERMS, INDIAN_STATES } from '../../lib/format';
import { TrackingButton, TrackingModal } from '../../components/Tracking';
import { useAuth } from '../../auth';
import { ContactPicker, ItemPicker } from '../../components/Pickers';
import { BackLink, Checkbox, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { CustomFieldInputs } from '../../components/CustomFields';
import { BILL_ACCOUNTS, computeTotals } from './config';

let lineSeq = 0;
const newLine = (over: any = {}) => ({ _k: ++lineSeq, item_id: null, item_name: '', description: '', quantity: 1, rate: '', discount_percent: 0, tax_id: '', account: '', available: null, track: false, unit: '', tmode: 'none', tracking: null, ...over });

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + Number(n || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function DocForm({ cfg }: any) {
  const { id } = useParams();
  const editing = !!id;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { taxes, warehouses, templates } = useLookups('taxes', 'warehouses', 'templates');
  const [contact, setContact] = useState(null);
  const [h, setH] = useState({
    number: '', reference: '', doc_date: today(), warehouse_id: '', discount_percent: 0, shipping_charge: '', adjustment: '', notes: '', terms: '',
    payment_terms: 0, due_date: '', expected_shipment_date: '', expected_delivery_date: '', delivery_method: '', salesperson: '', shipment_preference: '',
    return_stock: false, sales_order_id: null, purchase_order_id: null, invoice_id: null, sales_return_id: null, bill_id: null,
    delivery_challan_id: null, place_of_supply: '', expiry_date: '', challan_type: 'supply_on_approval', custom_fields: {},
  });
  const { user } = useAuth();
  const [trackFor, setTrackFor] = useState(null);
  const [lines, setLines] = useState<any[]>([newLine()]);
  const [linkLabel, setLinkLabel] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const set = (k) => (v) => setH((x) => ({ ...x, [k]: v }));
  const contactApi = cfg.contactType === 'customer' ? '/customers' : '/vendors';
  const priceField = cfg.priceKind === 'sales' ? 'selling_price' : 'cost_price';
  const taxField = cfg.priceKind === 'sales' ? 'sales_tax_id' : 'purchase_tax_id';

  const fromDocLines = (doc: any, remaining?: any, linkKey?: any) => doc.lines
    .map((l) => ({ l, q: remaining ? remaining(l) : l.quantity }))
    .filter(({ q }) => q > 0.0005)
    .map(({ l, q }) => newLine({
      item_id: l.item_id, item_name: l.item_name || '', description: l.description || '', quantity: q, rate: l.rate, discount_percent: l.discount_percent,
      tax_id: l.tax_id || '', account: l.account || '', track: l.track_inventory, unit: l.item_unit, tmode: l.item_tracking || 'none', tracking: l.tracking || null,
      ...(linkKey ? { [linkKey]: l.id } : {}),
    }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (editing) {
          const d = await api.get(`${cfg.api}/${id}`);
          if (!alive) return;
          if (d.status !== 'draft') { toast(`Only draft ${cfg.one.toLowerCase()}s can be edited`, 'error'); navigate(`${cfg.path}/${id}`, { replace: true }); return; }
          setContact({ id: d.contact_id, display_name: d.contact_name });
          setH((x) => {
            const v = { ...x };
            for (const k of Object.keys(x)) if (d[k] !== undefined && d[k] !== null) v[k] = d[k];
            return v;
          });
          setLines(fromDocLines(d, null).map((l, i) => ({ ...l, so_line_id: d.lines[i]?.so_line_id, po_line_id: d.lines[i]?.po_line_id })));
          if (d.sales_order_number) setLinkLabel(`Sales order ${d.sales_order_number}`);
          if (d.purchase_order_number) setLinkLabel(`Purchase order ${d.purchase_order_number}`);
          return;
        }
        const next = cfg.manualNumber ? { number: '' } : await api.get(`${cfg.api}/next-number`);
        if (!alive) return;
        setH((x) => ({ ...x, number: next.number }));
        const pick = async (cid) => { const c = await api.get(`${contactApi}/${cid}`); if (alive) applyContact(c, false); };
        if (sp.get('from_so')) {
          const so = await api.get(`/sales-orders/${sp.get('from_so')}`);
          await pick(so.contact_id);
          setH((x) => ({ ...x, sales_order_id: so.id, reference: so.number, salesperson: so.salesperson || '', discount_percent: so.discount_percent, warehouse_id: so.warehouse_id }));
          setLines(fromDocLines(so, (l) => l.quantity - l.qty_invoiced, 'so_line_id'));
          setLinkLabel(`Sales order ${so.number}`);
        } else if (sp.get('from_challan')) {
          const dc = await api.get(`/delivery-challans/${sp.get('from_challan')}`);
          await pick(dc.contact_id);
          setH((x) => ({ ...x, delivery_challan_id: dc.id, reference: dc.number, discount_percent: dc.discount_percent, warehouse_id: dc.warehouse_id, place_of_supply: dc.place_of_supply || x.place_of_supply }));
          setLines(fromDocLines(dc, null).map((l) => ({ ...l, tmode: 'none', tracking: null })));
          setLinkLabel(`Delivery challan ${dc.number}`);
        } else if (sp.get('from_po')) {
          const po = await api.get(`/purchase-orders/${sp.get('from_po')}`);
          await pick(po.contact_id);
          setH((x) => ({ ...x, purchase_order_id: po.id, reference: po.number, discount_percent: po.discount_percent, warehouse_id: po.warehouse_id }));
          setLines(fromDocLines(po, (l) => l.quantity - l.qty_billed, 'po_line_id'));
          setLinkLabel(`Purchase order ${po.number}`);
        } else if (sp.get('from_return')) {
          const ret = await api.get(`/sales-returns/${sp.get('from_return')}`);
          await pick(ret.contact_id);
          setH((x) => ({ ...x, sales_return_id: ret.id, reference: ret.number, warehouse_id: ret.warehouse_id }));
          setLines(ret.lines.map((l) => newLine({ item_id: l.item_id, item_name: l.item_name, quantity: l.quantity, rate: l.rate, tax_id: l.tax_id || '', discount_percent: l.discount_percent })));
          setLinkLabel(`Sales return ${ret.number}`);
        } else if (sp.get('from_invoice')) {
          const inv = await api.get(`/invoices/${sp.get('from_invoice')}`);
          await pick(inv.contact_id);
          setH((x) => ({ ...x, invoice_id: inv.id, reference: inv.number, discount_percent: inv.discount_percent }));
          setLines(fromDocLines(inv, null));
          setLinkLabel(`Invoice ${inv.number}`);
        } else if (sp.get('from_bill')) {
          const bill = await api.get(`/bills/${sp.get('from_bill')}`);
          await pick(bill.contact_id);
          setH((x) => ({ ...x, bill_id: bill.id, reference: bill.number, discount_percent: bill.discount_percent, warehouse_id: bill.warehouse_id }));
          setLines(fromDocLines(bill, null));
          setLinkLabel(`Bill ${bill.number}`);
        } else if (sp.get('clone')) {
          const d = await api.get(`${cfg.api}/${sp.get('clone')}`);
          await pick(d.contact_id);
          setH((x) => ({ ...x, discount_percent: d.discount_percent, shipping_charge: d.shipping_charge, adjustment: d.adjustment, notes: d.notes || '', terms: d.terms || '', warehouse_id: d.warehouse_id }));
          setLines(fromDocLines(d, null));
        } else {
          if (sp.get('contact')) await pick(sp.get('contact'));
          if (sp.get('item')) {
            const it = await api.get(`/items/${sp.get('item')}`);
            setLines([newLine({ item_id: it.id, item_name: it.name, rate: it[priceField], tax_id: it[taxField] || '', track: it.track_inventory, available: it.available_stock, unit: it.unit })]);
          }
          if (sp.get('items')) {
            const ids = sp.get('items').split(',').filter(Boolean);
            const items = await Promise.all(ids.map((i) => api.get(`/items/${i}`)));
            setLines(items.map((it) => newLine({ item_id: it.id, item_name: it.name, rate: it[priceField], tax_id: it[taxField] || '', track: it.track_inventory, available: it.available_stock, unit: it.unit, quantity: Math.max(1, Number(it.reorder_level) - Number(it.available_stock)) })));
          }
        }
      } catch (err) {
        if (alive) setError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!h.warehouse_id && warehouses.length) {
      const primary = warehouses.find((w) => w.is_primary) || warehouses[0];
      setH((x) => ({ ...x, warehouse_id: primary.id }));
    }
  }, [warehouses, h.warehouse_id]);

  // New documents start with the template's default notes and terms (Settings → Templates).
  const defaultsApplied = useRef(false);
  useEffect(() => {
    const t = templates?.[cfg.entity];
    if (editing || loading || !t || defaultsApplied.current || sp.get('clone')) return;
    defaultsApplied.current = true;
    setH((x) => ({ ...x, notes: x.notes || t.default_notes || '', terms: x.terms || t.default_terms || '' }));
  }, [templates, editing, loading, cfg.entity, sp]);

  // Due date follows invoice/bill date + terms unless the user edited it.
  const [dueTouched, setDueTouched] = useState(false);
  useEffect(() => {
    if (cfg.hasBalance && !dueTouched && h.doc_date) setH((x) => ({ ...x, due_date: addDays(x.doc_date, x.payment_terms) }));
  }, [h.doc_date, h.payment_terms, cfg.hasBalance, dueTouched]);

  function applyContact(c, updateRates = true) {
    setContact(c);
    setH((x) => ({ ...x, payment_terms: c.payment_terms ?? 0, place_of_supply: c.place_of_supply || x.place_of_supply || user?.org_state || '' }));
    if (updateRates && c.price_list_id) applyPriceList(c.price_list_id, lines);
  }

  async function applyPriceList(plId, ls) {
    const ids = ls.map((l) => l.item_id).filter(Boolean);
    if (!plId || !ids.length) return;
    try {
      const rates = await api.get(`/price-lists/${plId}/rates`, { item_ids: ids.join(',') });
      setLines((cur) => cur.map((l) => (l.item_id && rates[l.item_id] !== undefined ? { ...l, rate: rates[l.item_id] } : l)));
    } catch { /* price list unavailable: keep base rates */ }
  }

  const updateLine = (k, patch) => setLines((ls) => ls.map((l) => (l._k === k ? { ...l, ...patch } : l)));
  const selectItem = async (k, it) => {
    updateLine(k, { item_id: it.id, item_name: it.name, rate: it[priceField], tax_id: it[taxField] || '', track: it.track_inventory, available: it.available_stock, unit: it.unit, tmode: it.tracking || 'none', tracking: null,
      description: (cfg.priceKind === 'sales' ? it.sales_description : it.purchase_description) || '' });
    if (contact?.price_list_id) applyPriceList(contact.price_list_id, [{ item_id: it.id }]);
  };

  const totals = useMemo(() => computeTotals(lines, taxes, h), [lines, taxes, h]);
  const creditWarning = cfg.contactType === 'customer' && contact?.credit_limit && (Number(contact.receivables || 0) + totals.total > Number(contact.credit_limit));

  const save = async (post) => {
    setBusy(true); setError(null);
    try {
      if (!contact) throw new Error(`Select a ${cfg.contactType}`);
      const body = {
        ...h, contact_id: contact.id,
        lines: lines.filter((l) => l.item_id || l.description).map((l) => ({
          item_id: l.item_id, description: l.description, quantity: l.quantity, rate: l.rate || 0, discount_percent: l.discount_percent || 0,
          tax_id: l.tax_id || null, so_line_id: l.so_line_id, po_line_id: l.po_line_id, account: l.account || null, tracking: l.tracking || null,
        })),
      };
      if (!cfg.hasBalance) delete body.due_date;
      const saved = editing ? await api.put(`${cfg.api}/${id}`, body) : await api.post(cfg.api, body);
      if (post) {
        try { await api.post(`${cfg.api}/${saved.id}/${cfg.postAction}`); toast(`${cfg.one} ${saved.number} saved`); } catch (err) { toast(`Saved as draft, but: ${err.message}`, 'error'); }
      } else toast(`${cfg.one} ${saved.number} saved as draft`);
      navigate(`${cfg.path}/${saved.id}`);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Spinner /></div>;
  const taxOptions = taxes.filter((t) => t.kind === 'tax' && (t.is_active || lines.some((l) => String(l.tax_id) === String(t.id))));
  const linked = !!(h.sales_order_id || h.purchase_order_id || h.delivery_challan_id);
  // Which lines need serial/batch details: stock coming in (direct bill) is required; stock going out is optional.
  const trackDir = cfg.key === 'bills' && !h.purchase_order_id ? 'in'
    : (cfg.key === 'invoices' && !h.sales_order_id && !h.delivery_challan_id) || cfg.key === 'delivery_challans' || (cfg.key === 'vendor_credits' && h.return_stock) ? 'out' : null;

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="page">
        <BackLink to={cfg.path}>{cfg.title}</BackLink>
        <PageHead title={editing ? `Edit ${cfg.one} ${h.number}` : `New ${cfg.one}`} />
        <ErrorBox error={error} />
        {linkLabel && <div className="info-box mb">Created from {linkLabel}. {linked ? 'Quantities are limited to what remains on that order.' : ''}</div>}
        <div className="card mb"><div className="card-body">
          <div className="grid-3">
            <Field label={cfg.contactType === 'customer' ? 'Customer name' : 'Vendor name'} required>
              <ContactPicker type={cfg.contactType} value={contact?.id} valueLabel={contact?.display_name} disabled={linked || (editing && !!contact)} autoFocus={!contact}
                onSelect={async (c) => { const full = await api.get(`${contactApi}/${c.id}`); applyContact(full); }}
                onCreate={() => window.open(`${cfg.contactType === 'customer' ? '/customers' : '/vendors'}/new`, '_blank')} />
              {contact && cfg.contactType === 'customer' && contact.receivables !== undefined && (
                <div className="hint">Outstanding: {money(contact.receivables)}{contact.credit_limit ? ` · Credit limit ${money(contact.credit_limit)}` : ''}</div>
              )}
            </Field>
            <Field label={cfg.numberLabel} required hint={cfg.manualNumber ? 'Number on the vendor’s bill' : 'Auto-generated; you can change it'}>
              <Input required={cfg.manualNumber} value={h.number} onChange={set('number')} />
            </Field>
            <Field label="Reference#"><Input value={h.reference} onChange={set('reference')} /></Field>
            <Field label={cfg.dateLabel} required><Input type="date" required value={h.doc_date} onChange={set('doc_date')} /></Field>
            {cfg.header.map((fd) => (
              <Field key={fd.key} label={fd.type === 'checkbox' ? '' : fd.label} hint={fd.hint}>
                {fd.type === 'date' && <Input type="date" value={h[fd.key] || ''} onChange={(v) => { if (fd.key === 'due_date') setDueTouched(true); set(fd.key)(v); }} />}
                {fd.type === 'terms' && <Select value={h.payment_terms} onChange={(v) => { setDueTouched(false); set('payment_terms')(Number(v)); }} options={PAYMENT_TERMS.some((p) => p[0] === Number(h.payment_terms)) ? PAYMENT_TERMS : [...PAYMENT_TERMS, [h.payment_terms, `Net ${h.payment_terms}`]]} />}
                {fd.type === 'text' && (
                  <>
                    <input className="input" list={fd.list ? `dl-${fd.key}` : undefined} value={h[fd.key] || ''} onChange={(e) => set(fd.key)(e.target.value)} />
                    {fd.list && <datalist id={`dl-${fd.key}`}>{fd.list.map((o) => <option key={o} value={o} />)}</datalist>}
                  </>
                )}
                {fd.type === 'select' && <Select value={h[fd.key] || ''} onChange={set(fd.key)} options={fd.options} />}
                {fd.type === 'checkbox' &&<div style={{ paddingTop: 22 }}><Checkbox checked={h[fd.key]} onChange={set(fd.key)}>{fd.label}</Checkbox></div>}
              </Field>
            ))}
            <Field label="Place of supply" hint="Decides CGST + SGST (same state) or IGST (other state)">
              <Select value={h.place_of_supply || ''} onChange={set('place_of_supply')} options={INDIAN_STATES.map((s) => [s, s])} placeholder="Select state" />
            </Field>
            {warehouses.length > 1 && (
              <Field label={cfg.warehouseLabel}>
                <Select value={h.warehouse_id} onChange={(v) => set('warehouse_id')(Number(v))} disabled={linked} options={warehouses.filter((w) => w.status === 'active' || w.id === h.warehouse_id).map((w) => [w.id, w.name])} />
              </Field>
            )}
          </div>
          <CustomFieldInputs entity={cfg.entity} value={h.custom_fields} onChange={set('custom_fields')} layout="grid" isNew={!editing} title="" />
        </div></div>

        <div className="card mb">
          <div className="card-head"><h3>Item table</h3></div>
          <div className="table-wrap">
            <table className="table lines">
              <thead>
                <tr>
                  <th>Item details</th>
                  {cfg.accountColumn && <th style={{ width: 170 }}>Account</th>}
                  <th className="num" style={{ width: 110 }}>Quantity</th>
                  <th className="num" style={{ width: 130 }}>Rate</th>
                  <th className="num" style={{ width: 90 }}>Discount %</th>
                  <th style={{ width: 170 }}>Tax</th>
                  <th className="num" style={{ width: 120 }}>Amount</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._k}>
                    <td className="item-cell">
                      {l.so_line_id || l.po_line_id ? <div className="bold" style={{ padding: '6px 0' }}>{l.item_name || l.description}</div> : (
                        <ItemPicker value={l.item_id} valueLabel={l.item_name} priceKind={cfg.priceKind} onSelect={(it) => selectItem(l._k, it)} />
                      )}
                      <textarea className="input mt" style={{ minHeight: 34, marginTop: 6 }} rows={1} placeholder={l.item_id ? 'Add a description' : 'Or type a description for a non-item line'}
                        value={l.description || ''} onChange={(e) => updateLine(l._k, { description: e.target.value })} />
                      {trackDir && l.track && <TrackingButton mode={l.tmode} direction={trackDir} value={l.tracking} required={trackDir === 'in'} onClick={() => setTrackFor(l)} />}
                      {cfg.priceKind === 'sales' && l.track && l.available !== null && (
                        <div className="small" style={{ color: Number(l.available) < Number(l.quantity) ? 'var(--red)' : 'var(--text-3)' }}>
                          Available for sale: {qty(l.available)} {l.unit}
                        </div>
                      )}
                    </td>
                    {cfg.accountColumn && (
                      <td><select className="input" value={l.account || ''} onChange={(e) => updateLine(l._k, { account: e.target.value })}>
                        <option value="">{l.track ? 'Inventory Asset' : 'Select account'}</option>{BILL_ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
                      </select></td>
                    )}
                    <td><input className="input num" type="number" min="0.001" step="any" required value={l.quantity} onChange={(e) => updateLine(l._k, { quantity: e.target.value })} /></td>
                    <td><input className="input num" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => updateLine(l._k, { rate: e.target.value })} /></td>
                    <td><input className="input num" type="number" min="0" max="100" step="0.01" value={l.discount_percent} onChange={(e) => updateLine(l._k, { discount_percent: e.target.value })} /></td>
                    <td><select className="input" value={l.tax_id || ''} onChange={(e) => updateLine(l._k, { tax_id: e.target.value })}>
                      <option value="">No tax</option>{taxOptions.map((t) => <option key={t.id} value={t.id}>{t.name} [{Number(t.rate)}%]</option>)}
                    </select></td>
                    <td className="num bold">{money(l._amount ?? 0, { symbol: false })}</td>
                    <td><button type="button" className="btn ghost sm danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x._k !== l._k))} aria-label="Remove line">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!linked && <div style={{ padding: 12 }}><button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Add new row</button></div>}
        </div>

        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <Field label={cfg.contactType === 'customer' ? 'Customer notes' : 'Notes'}><Textarea rows={3} value={h.notes} onChange={set('notes')} placeholder="Will be displayed on the document" /></Field>
            <Field label="Terms & conditions"><Textarea rows={3} value={h.terms} onChange={set('terms')} placeholder="Enter the terms and conditions of your business" /></Field>
            <div className="small faint">You can attach files after saving.</div>
          </div>
          <div className="totals">
            <div className="t-row"><span>Sub total</span><span>{money(totals.sub_total)}</span></div>
            <div className="t-row"><span>Discount %</span><input className="input num" type="number" min="0" max="100" step="0.01" value={h.discount_percent} onChange={(e) => set('discount_percent')(e.target.value)} /><span>-{money(totals.discount_total)}</span></div>
            {totals.taxBreak.map(([name, v]) => <div className="t-row" key={name}><span>{name}</span><span>{money(v)}</span></div>)}
            <div className="t-row"><span>Shipping charges</span><input className="input num" type="number" min="0" step="0.01" value={h.shipping_charge} onChange={(e) => set('shipping_charge')(e.target.value)} /></div>
            <div className="t-row"><span>Adjustment</span><input className="input num" type="number" step="0.01" value={h.adjustment} onChange={(e) => set('adjustment')(e.target.value)} /></div>
            <div className="t-row grand"><span>Total</span><span>{money(totals.total)}</span></div>
          </div>
        </div>
        {creditWarning && <div className="warn-box mt">This takes {contact.display_name} over their credit limit of {money(contact.credit_limit)}.</div>}
        {trackFor && (
          <TrackingModal itemId={trackFor.item_id} itemName={trackFor.item_name} mode={trackFor.tmode} direction={trackDir} quantity={trackFor.quantity}
            warehouseId={h.warehouse_id} value={trackFor.tracking} onClose={() => setTrackFor(null)}
            onSave={(t) => { updateLine(trackFor._k, { tracking: t }); setTrackFor(null); }} />
        )}
      </div>
      <div className="form-footer">
        <button type="submit" className="btn" disabled={busy}>Save as Draft</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : cfg.postLabel}</button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}
