import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useLookups } from '../../lib/lookups';
import { money, today } from '../../lib/format';
import { ContactPicker, ItemPicker } from '../../components/Pickers';
import { BackLink, Checkbox, ErrorBox, FormRow, Input, PageHead, Select, Spinner, Textarea, useApi } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { TrackingButton, TrackingModal } from '../../components/Tracking';

const EMPTY = {
  name: '', sku: '', barcode: '', item_type: 'goods', unit: 'pcs', category: '', brand: '', manufacturer: '', description: '', hsn_sac: '',
  selling_price: '', cost_price: '', sales_description: '', purchase_description: '', sales_tax_id: '', purchase_tax_id: '',
  preferred_vendor_id: '', preferred_vendor_name: '', track_inventory: true, reorder_level: '', returnable: true,
  length_cm: '', width_cm: '', height_cm: '', weight_kg: '', status: 'active', tracking: 'none',
};

export default function ItemForm({ composite: compositeProp = false }: any) {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { taxes, warehouses, units, organization } = useLookups('taxes', 'warehouses', 'units', 'organization');
  const meta = useApi('/items/meta/lookups');
  const [f, setF] = useState<any>(EMPTY);
  const [composite, setComposite] = useState(compositeProp);
  const [components, setComponents] = useState([]);
  const [opening, setOpening] = useState([]);
  const [openingDate, setOpeningDate] = useState(today());
  const [image, setImage] = useState(null);
  const [trackRow, setTrackRow] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    api.get(`/items/${id}`).then((it) => {
      const v = { ...EMPTY };
      for (const k of Object.keys(EMPTY)) v[k] = it[k] ?? EMPTY[k];
      v.preferred_vendor_name = it.preferred_vendor_name || '';
      setF(v);
      setComposite(it.is_composite);
      setComponents(it.components.map((c) => ({ item_id: c.item_id, name: c.name, quantity: c.quantity, cost_price: c.cost_price, selling_price: c.selling_price })));
    }).catch(setError).finally(() => setLoading(false));
  }, [editing, id]);

  useEffect(() => {
    if (!editing && warehouses.length && !opening.length) {
      setOpening(warehouses.filter((w) => w.status === 'active').map((w) => ({ warehouse_id: w.id, name: w.name, quantity: '', unit_cost: '' })));
    }
  }, [warehouses, editing, opening.length]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body = { ...f, is_composite: composite };
      if (composite) body.components = components.map((c) => ({ item_id: c.item_id, quantity: c.quantity }));
      if (!editing && !composite && f.track_inventory) {
        body.opening_stock = opening.filter((o) => Number(o.quantity) > 0).map((o) => ({ ...o, unit_cost: o.unit_cost === '' ? f.cost_price : o.unit_cost }));
        body.opening_stock_date = openingDate;
      }
      const saved = editing ? await api.put(`/items/${id}`, body) : await api.post('/items', body);
      if (image) {
        const fd = new FormData();
        fd.append('file', image);
        await api.upload(`/items/${saved.id}/image`, fd).catch((err) => toast(`Item saved, but image upload failed: ${err.message}`, 'error'));
      }
      toast(editing ? 'Item updated' : 'Item created');
      navigate(`/items/${saved.id}`);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Spinner /></div>;
  const lk = meta.data || { categories: [], brands: [], manufacturers: [] };
  const taxOptions = taxes.filter((t) => t.kind === 'tax' && t.is_active).map((t) => [t.id, `${t.name} [${t.rate}%]`]);
  const componentCost = components.reduce((s, c) => s + Number(c.cost_price || 0) * Number(c.quantity || 0), 0);
  const componentPrice = components.reduce((s, c) => s + Number(c.selling_price || 0) * Number(c.quantity || 0), 0);

  return (
    <form onSubmit={submit}>
      <div className="page narrow">
        <BackLink to={composite ? '/composite-items' : '/items'}>Back</BackLink>
        <PageHead title={editing ? `Edit ${f.name}` : composite ? 'New Composite Item' : 'New Item'} />
        <ErrorBox error={error} />
        <div className="card"><div className="card-body">
          <div className="form-section">
            {!composite && (
              <FormRow label="Type">
                <div className="radio-group">
                  {[['goods', 'Goods'], ['service', 'Service']].map(([v, l]) => (
                    <label key={v} className="checkbox"><input type="radio" checked={f.item_type === v} onChange={() => setF({ ...f, item_type: v, track_inventory: v === 'goods' ? f.track_inventory : false })} />{l}</label>
                  ))}
                </div>
              </FormRow>
            )}
            <FormRow label="Name" required><Input required value={f.name} onChange={set('name')} autoFocus /></FormRow>
            <FormRow label="SKU" hint="Stock keeping unit — must be unique"><Input value={f.sku} onChange={set('sku')} /></FormRow>
            <FormRow label="Unit">
              <input className="input" list="unit-list" value={f.unit || ''} onChange={(e) => set('unit')(e.target.value)} />
              <datalist id="unit-list">{units.map((u) => <option key={u.id} value={u.name} />)}</datalist>
            </FormRow>
            <FormRow label="Barcode (UPC/EAN/ISBN)"><Input value={f.barcode} onChange={set('barcode')} /></FormRow>
            <FormRow label="Category">
              <input className="input" list="cat-list" value={f.category || ''} onChange={(e) => set('category')(e.target.value)} />
              <datalist id="cat-list">{lk.categories.map((c) => <option key={c} value={c} />)}</datalist>
            </FormRow>
            <FormRow label="Brand">
              <input className="input" list="brand-list" value={f.brand || ''} onChange={(e) => set('brand')(e.target.value)} />
              <datalist id="brand-list">{lk.brands.map((c) => <option key={c} value={c} />)}</datalist>
            </FormRow>
            <FormRow label="Manufacturer">
              <input className="input" list="mfr-list" value={f.manufacturer || ''} onChange={(e) => set('manufacturer')(e.target.value)} />
              <datalist id="mfr-list">{lk.manufacturers.map((c) => <option key={c} value={c} />)}</datalist>
            </FormRow>
            {(organization?.gst_registered || f.hsn_sac) && (
              <FormRow label={f.item_type === 'service' ? 'SAC' : 'HSN code'}><Input value={f.hsn_sac} onChange={set('hsn_sac')} /></FormRow>
            )}
            <FormRow label="Description"><Textarea value={f.description} onChange={set('description')} /></FormRow>
            <FormRow label="Image" hint="PNG, JPG, GIF or WebP, up to 5 MB">
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files[0] || null)} />
            </FormRow>
            {editing && <FormRow label="Status"><Select value={f.status} onChange={set('status')} options={[['active', 'Active'], ['inactive', 'Inactive']]} /></FormRow>}
          </div>

          {composite && (
            <div className="form-section">
              <h3>Components (bill of materials)</h3>
              <p className="small muted">Stock of this item is created by assembling it from these components (Inventory → Assemblies).</p>
              <table className="table lines">
                <thead><tr><th>Item</th><th className="num" style={{ width: 120 }}>Quantity</th><th className="num">Cost</th><th className="num">Selling</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>
                  {components.map((c, i) => (
                    <tr key={i}>
                      <td className="item-cell">
                        <ItemPicker value={c.item_id} valueLabel={c.name} params={{ composite: 'false' }}
                          onSelect={(it) => setComponents((cs) => cs.map((x, j) => (j === i ? { ...x, item_id: it.id, name: it.name, cost_price: it.cost_price, selling_price: it.selling_price } : x)))} />
                      </td>
                      <td><input className="input num" type="number" min="0.001" step="any" value={c.quantity}
                        onChange={(e) => setComponents((cs) => cs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                      <td className="num">{money(Number(c.cost_price || 0) * Number(c.quantity || 0))}</td>
                      <td className="num">{money(Number(c.selling_price || 0) * Number(c.quantity || 0))}</td>
                      <td><button type="button" className="btn ghost sm danger" onClick={() => setComponents((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove">✕</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(componentCost)}</td><td className="num">{money(componentPrice)}</td><td /></tr></tfoot>
              </table>
              <button type="button" className="btn sm mt" onClick={() => setComponents((cs) => [...cs, { item_id: null, name: '', quantity: 1 }])}>+ Add component</button>
            </div>
          )}

          <div className="grid-2 form-section">
            <div className="stack">
              <h3>Sales information</h3>
              <div className="field"><label className="req">Selling price ({organization?.currency || 'INR'})</label>
                <Input type="number" min="0" step="0.01" value={f.selling_price} onChange={set('selling_price')} placeholder={composite && componentPrice ? componentPrice.toFixed(2) : ''} /></div>
              <div className="field"><label>Sales description</label><Textarea value={f.sales_description} onChange={set('sales_description')} rows={2} /></div>
              <div className="field"><label>Sales tax</label><Select value={f.sales_tax_id} onChange={set('sales_tax_id')} options={taxOptions} placeholder="Non-taxable" /></div>
            </div>
            <div className="stack">
              <h3>Purchase information</h3>
              <div className="field"><label>Cost price ({organization?.currency || 'INR'})</label>
                <Input type="number" min="0" step="0.01" value={f.cost_price} onChange={set('cost_price')} placeholder={composite && componentCost ? componentCost.toFixed(2) : ''} /></div>
              <div className="field"><label>Purchase description</label><Textarea value={f.purchase_description} onChange={set('purchase_description')} rows={2} /></div>
              <div className="field"><label>Purchase tax</label><Select value={f.purchase_tax_id} onChange={set('purchase_tax_id')} options={taxOptions} placeholder="Non-taxable" /></div>
              <div className="field"><label>Preferred vendor</label>
                <ContactPicker type="vendor" value={f.preferred_vendor_id} valueLabel={f.preferred_vendor_name}
                  onSelect={(v) => setF({ ...f, preferred_vendor_id: v.id, preferred_vendor_name: v.display_name })} />
                {f.preferred_vendor_id && <button type="button" className="btn link small" onClick={() => setF({ ...f, preferred_vendor_id: '', preferred_vendor_name: '' })}>Clear</button>}
              </div>
            </div>
          </div>

          {f.item_type === 'goods' && (
            <div className="form-section">
              <h3>Inventory</h3>
              {!composite && (
                <FormRow label="Track inventory" hint="Inventory tracking cannot be changed once the item has transactions.">
                  <Checkbox checked={f.track_inventory} onChange={set('track_inventory')}>Track stock for this item</Checkbox>
                </FormRow>
              )}
              {f.track_inventory && (
                <>
                  <FormRow label="Valuation method"><Input value="FIFO (First In, First Out)" disabled onChange={() => {}} /></FormRow>
                  {!composite && (
                    <FormRow label="Serial / batch tracking" hint="Serial numbers: every unit has its own number (laptops, printers). Batches: lots with expiry dates (toner, chemicals). Can't be changed once the item has stock.">
                      <Select value={f.tracking} onChange={set('tracking')} options={[['none', 'None'], ['serial', 'Serial numbers'], ['batch', 'Batches (with expiry date)']]} />
                    </FormRow>
                  )}
                  <FormRow label="Reorder point" hint="You'll get a low-stock alert when available stock falls to this level.">
                    <Input type="number" min="0" step="any" value={f.reorder_level} onChange={set('reorder_level')} />
                  </FormRow>
                  {!editing && !composite && (
                    <>
                      <FormRow label="Opening stock as of"><Input type="date" value={openingDate} onChange={setOpeningDate} /></FormRow>
                      <table className="table compact lines" style={{ maxWidth: 640 }}>
                        <thead><tr><th>Warehouse</th><th className="num">Opening stock</th><th className="num">Rate per unit</th>{f.tracking !== 'none' && <th>Serial / batch</th>}</tr></thead>
                        <tbody>
                          {opening.map((o, i) => (
                            <tr key={o.warehouse_id}>
                              <td>{o.name}</td>
                              <td><input className="input num" type="number" min="0" step="any" value={o.quantity} onChange={(e) => setOpening((os) => os.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                              <td><input className="input num" type="number" min="0" step="0.01" placeholder={f.cost_price || '0.00'} value={o.unit_cost} onChange={(e) => setOpening((os) => os.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))} /></td>
                              {f.tracking !== 'none' && <td>{Number(o.quantity) > 0 && <TrackingButton mode={f.tracking} direction="in" required value={o.tracking} onClick={() => setTrackRow(i)} />}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
              <FormRow label="Returnable item"><Checkbox checked={f.returnable} onChange={set('returnable')}>Customers can return this item</Checkbox></FormRow>
              <FormRow label="Dimensions (L × W × H cm)">
                <div className="row">
                  <Input type="number" min="0" step="any" value={f.length_cm} onChange={set('length_cm')} placeholder="L" />
                  <Input type="number" min="0" step="any" value={f.width_cm} onChange={set('width_cm')} placeholder="W" />
                  <Input type="number" min="0" step="any" value={f.height_cm} onChange={set('height_cm')} placeholder="H" />
                </div>
              </FormRow>
              <FormRow label="Weight (kg)"><Input type="number" min="0" step="any" value={f.weight_kg} onChange={set('weight_kg')} /></FormRow>
            </div>
          )}
        </div></div>
      </div>
      {trackRow !== null && (
        <TrackingModal itemName={f.name || 'New item'} mode={f.tracking} direction="in" quantity={opening[trackRow].quantity} value={opening[trackRow].tracking}
          onClose={() => setTrackRow(null)} onSave={(v) => { setOpening((os) => os.map((x, j) => (j === trackRow ? { ...x, tracking: v } : x))); setTrackRow(null); }} />
      )}
      <div className="form-footer">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}
