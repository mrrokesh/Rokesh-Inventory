import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useLookups } from '../../lib/lookups';
import { money, qty } from '../../lib/format';
import DataTable from '../../components/DataTable';
import { BackLink, Badge, ErrorBox, Field, FormRow, Input, Modal, PageHead, Spinner, Textarea, confirmDialog, useAction, useApi } from '../../components/ui';
import { useToast } from '../../components/Toast';

export function ItemGroupsList() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHead title="Item Groups">{can('items', 'create') && <Link className="btn primary" to="/item-groups/new">+ New</Link>}</PageHead>
      <DataTable endpoint="/item-groups" rowLink={(r) => `/item-groups/${r.id}`}
        emptyTitle="No item groups yet" emptyText="Group variants of a product (size, colour, model) and generate their SKUs together."
        emptyAction={can('items', 'create') && <Link className="btn primary" to="/item-groups/new">+ New item group</Link>}
        columns={[
          { key: 'name', label: 'Name', render: (r) => <span className="bold">{r.name}</span> },
          { key: 'attributes', label: 'Attributes', render: (r) => r.attributes.map((a) => a.name).join(', ') },
          { key: 'item_count', label: 'Variants', num: true },
          { key: 'stock_on_hand', label: 'Stock on hand', num: true, render: (r) => qty(r.stock_on_hand) },
          { key: 'category', label: 'Category' },
        ]} />
    </div>
  );
}

function combos(attributes) {
  const attrs = attributes.filter((a) => a.name.trim() && a.options.length);
  if (!attrs.length) return [];
  return attrs.reduce((acc, a) => acc.flatMap((c) => a.options.map((o) => ({ ...c, [a.name.trim()]: o }))), [{}]);
}
const comboKey = (attrs) => JSON.stringify(Object.keys(attrs).sort().map((k) => [k, attrs[k]]));

export function ItemGroupForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { taxes, units } = useLookups('taxes', 'units');
  const [f, setF] = useState({ name: '', unit: 'pcs', category: '', brand: '', description: '' });
  const [attributes, setAttributes] = useState([{ name: '', optionsText: '', options: [] }]);
  const [defaults, setDefaults] = useState({ selling_price: '', cost_price: '', reorder_level: '', sales_tax_id: '', purchase_tax_id: '', track_inventory: true });
  const [rows, setRows] = useState({});
  const [existing, setExisting] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    if (!editing) return;
    api.get(`/item-groups/${id}`).then((g) => {
      setF({ name: g.name, unit: g.unit || '', category: g.category || '', brand: g.brand || '', description: g.description || '' });
      setAttributes(g.attributes.map((a) => ({ name: a.name, options: a.options, optionsText: a.options.join(', ') })));
      setExisting(g.items);
    }).catch(setError).finally(() => setLoading(false));
  }, [editing, id]);

  const parsedAttrs = attributes.map((a) => ({ name: a.name.trim(), options: a.optionsText.split(',').map((o) => o.trim()).filter(Boolean) }));
  const existingKeys = useMemo(() => new Set(existing.map((it) => comboKey(it.attributes || {}))), [existing]);
  const newCombos = combos(parsedAttrs).filter((c) => !existingKeys.has(comboKey(c)));
  const skuFor = (c) => [f.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(), ...Object.values(c).map((v) => String(v).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase())].filter(Boolean).join('-');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const variants = newCombos.filter((c) => rows[comboKey(c)]?.include !== false).map((c) => {
        const r = rows[comboKey(c)] || {};
        return {
          attributes: c, sku: r.sku ?? skuFor(c), selling_price: r.selling_price ?? defaults.selling_price, cost_price: r.cost_price ?? defaults.cost_price,
          reorder_level: defaults.reorder_level, sales_tax_id: defaults.sales_tax_id, purchase_tax_id: defaults.purchase_tax_id, track_inventory: defaults.track_inventory,
        };
      });
      const body = { ...f, attributes: parsedAttrs, variants };
      const g = editing ? await api.put(`/item-groups/${id}`, body) : await api.post('/item-groups', body);
      toast(editing ? 'Item group updated' : `Item group created with ${variants.length} variants`);
      navigate(`/item-groups/${g.id}`);
    } catch (err) { setError(err); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  };

  if (loading) return <div className="page"><Spinner /></div>;
  const setRow = (key, k, v) => setRows((r) => ({ ...r, [key]: { ...r[key], [k]: v } }));
  const taxOptions = taxes.filter((t) => t.kind === 'tax').map((t) => [t.id, `${t.name} [${t.rate}%]`]);
  return (
    <form onSubmit={submit}>
      <div className="page narrow">
        <BackLink to="/item-groups">Item groups</BackLink>
        <PageHead title={editing ? `Edit ${f.name}` : 'New Item Group'} />
        <ErrorBox error={error} />
        <div className="card"><div className="card-body">
          <div className="form-section">
            <FormRow label="Item group name" required><Input required value={f.name} onChange={(v) => setF({ ...f, name: v })} autoFocus /></FormRow>
            <FormRow label="Unit">
              <input className="input" list="ig-units" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
              <datalist id="ig-units">{units.map((u) => <option key={u.id} value={u.name} />)}</datalist>
            </FormRow>
            <FormRow label="Category"><Input value={f.category} onChange={(v) => setF({ ...f, category: v })} /></FormRow>
            <FormRow label="Brand"><Input value={f.brand} onChange={(v) => setF({ ...f, brand: v })} /></FormRow>
            <FormRow label="Description"><Textarea value={f.description} onChange={(v) => setF({ ...f, description: v })} /></FormRow>
          </div>
          <div className="form-section">
            <h3>Attributes</h3>
            <p className="small muted">Up to 3 attributes, e.g. Color = Red, Blue Â· Size = S, M, L. Separate options with commas.</p>
            {attributes.map((a, i) => (
              <div className="row mb" key={i}>
                <input className="input" style={{ width: 200 }} placeholder="Attribute (e.g. Color)" value={a.name} onChange={(e) => setAttributes((as) => as.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" placeholder="Options (e.g. Red, Blue, Black)" value={a.optionsText} onChange={(e) => setAttributes((as) => as.map((x, j) => (j === i ? { ...x, optionsText: e.target.value } : x)))} />
                {attributes.length > 1 && <button type="button" className="btn ghost danger sm" onClick={() => setAttributes((as) => as.filter((_, j) => j !== i))}>âœ•</button>}
              </div>
            ))}
            {attributes.length < 3 && <button type="button" className="btn sm" onClick={() => setAttributes((as) => [...as, { name: '', optionsText: '', options: [] }])}>+ Add attribute</button>}
          </div>
          <div className="form-section">
            <h3>{editing ? 'New variants to add' : 'Variants'}</h3>
            <div className="grid-3 mb">
              <Field label="Default selling price"><Input type="number" min="0" step="0.01" value={defaults.selling_price} onChange={(v) => setDefaults({ ...defaults, selling_price: v })} /></Field>
              <Field label="Default cost price"><Input type="number" min="0" step="0.01" value={defaults.cost_price} onChange={(v) => setDefaults({ ...defaults, cost_price: v })} /></Field>
              <Field label="Reorder point"><Input type="number" min="0" step="any" value={defaults.reorder_level} onChange={(v) => setDefaults({ ...defaults, reorder_level: v })} /></Field>
              <Field label="Sales tax"><select className="input" value={defaults.sales_tax_id} onChange={(e) => setDefaults({ ...defaults, sales_tax_id: e.target.value })}><option value="">Non-taxable</option>{taxOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Purchase tax"><select className="input" value={defaults.purchase_tax_id} onChange={(e) => setDefaults({ ...defaults, purchase_tax_id: e.target.value })}><option value="">Non-taxable</option>{taxOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            </div>
            {newCombos.length === 0 ? <div className="faint">{editing ? 'Add new attribute options above to create more variants.' : 'Enter attributes and options to generate variants.'}</div> : (
              <table className="table compact lines">
                <thead><tr><th className="check" /><th>Variant</th><th>SKU</th><th className="num">Cost price</th><th className="num">Selling price</th></tr></thead>
                <tbody>
                  {newCombos.map((c) => {
                    const key = comboKey(c);
                    const r = rows[key] || {};
                    return (
                      <tr key={key}>
                        <td className="check"><input type="checkbox" checked={r.include !== false} onChange={(e) => setRow(key, 'include', e.target.checked)} aria-label="Include variant" /></td>
                        <td>{Object.values(c).join(' / ')}</td>
                        <td><input className="input" value={r.sku ?? skuFor(c)} onChange={(e) => setRow(key, 'sku', e.target.value)} /></td>
                        <td><input className="input num" type="number" min="0" step="0.01" placeholder={defaults.cost_price} value={r.cost_price ?? ''} onChange={(e) => setRow(key, 'cost_price', e.target.value)} /></td>
                        <td><input className="input num" type="number" min="0" step="0.01" placeholder={defaults.selling_price} value={r.selling_price ?? ''} onChange={(e) => setRow(key, 'selling_price', e.target.value)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {editing && existing.length > 0 && <p className="small faint mt">{existing.length} existing variant(s) are kept. Edit them individually from the item page.</p>}
          </div>
        </div></div>
      </div>
      <div className="form-footer">
        <button className="btn primary" disabled={busy}>{busy ? 'Savingâ€¦' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

export function ItemGroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [, run] = useAction(toast);
  const { data: g, error } = useApi(`/item-groups/${id}`);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!g) return <div className="page"><Spinner /></div>;
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete item group ${g.name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/item-groups/${g.id}`), 'Item group deleted')) !== undefined) navigate('/item-groups');
  };
  return (
    <div className="page">
      <PageHead title={g.name} crumb={<Link to="/item-groups">Item Groups</Link>}>
        {can('items', 'edit') && <Link className="btn" to={`/item-groups/${g.id}/edit`}>Edit / add variants</Link>}
        {can('items', 'delete') && g.items.length === 0 && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
      </PageHead>
      <div className="card mb"><div className="card-body">
        <dl className="kv">
          {g.attributes.map((a) => <Fragment key={a.name}><dt>{a.name}</dt><dd>{a.options.join(', ')}</dd></Fragment>)}
          {g.category && <><dt>Category</dt><dd>{g.category}</dd></>}
          {g.brand && <><dt>Brand</dt><dd>{g.brand}</dd></>}
          {g.description && <><dt>Description</dt><dd>{g.description}</dd></>}
        </dl>
      </div></div>
      <div className="card mb">
        <div className="card-head"><h3>Variants ({g.items.length})</h3></div>
        <table className="table">
          <thead><tr><th>Name</th><th>SKU</th><th className="num">Stock on hand</th><th className="num">Committed</th><th className="num">Cost</th><th className="num">Selling price</th><th>Status</th></tr></thead>
          <tbody>
            {g.items.map((it) => (
              <tr key={it.id} className="clickable" onClick={() => navigate(`/items/${it.id}`)}>
                <td>{it.name}<div className="small faint">{Object.entries(it.attributes || {}).map(([k, v]) => `${k}: ${v}`).join(' Â· ')}</div></td>
                <td>{it.sku}</td><td className="num">{qty(it.stock_on_hand)}</td><td className="num">{qty(it.committed_stock)}</td>
                <td className="num">{money(it.cost_price)}</td><td className="num">{money(it.selling_price)}</td><td><Badge status={it.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ price lists
export function PriceLists() {
  const { can } = useAuth();
  const [editing, setEditing] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="page">
      <PageHead title="Price Lists">{can('items', 'create') && <button type="button" className="btn primary" onClick={() => setEditing({})}>+ New</button>}</PageHead>
      <DataTable endpoint="/price-lists" reloadKey={reloadKey}
        emptyTitle="No price lists yet" emptyText="Create customer-tier or vendor-specific pricing with a markup/markdown or per-item rates, then assign it to contacts."
        columns={[
          { key: 'name', label: 'Name', render: (r) => <button type="button" className="btn link" onClick={() => setEditing(r)}>{r.name}</button> },
          { key: 'kind', label: 'Type', render: (r) => (r.kind === 'sales' ? 'Sales' : 'Purchase') },
          { key: 'scheme', label: 'Pricing', render: (r) => (r.scheme === 'per_item' ? 'Individual item rates' : `${r.markup ? 'Markup' : 'Markdown'} ${Number(r.percentage)}%`) },
          { key: 'contact_count', label: 'Contacts', num: true },
          { key: 'is_active', label: 'Status', render: (r) => <Badge status={r.is_active ? 'active' : 'inactive'} /> },
        ]} />
      {editing && <PriceListModal pl={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}

function PriceListModal({ pl, onClose, onSaved }: any) {
  const toast = useToast();
  const { can } = useAuth();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: '', kind: 'sales', scheme: 'percentage', markup: true, percentage: '', rounding: 'none', description: '', is_active: true, ...pl });
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (pl.id) api.get(`/price-lists/${pl.id}`).then((d) => setItems(d.items.map((x) => ({ item_id: x.item_id, name: x.name, sku: x.sku, base: f.kind === 'sales' ? x.selling_price : x.cost_price, rate: x.rate }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pl.id]);
  useEffect(() => {
    if (f.scheme !== 'per_item') return;
    api.get('/items', { search, status: 'active', per_page: 50 }).then((r) => setItems((cur) => {
      const have = new Map(cur.map((x) => [x.item_id, x]));
      for (const it of r.data) if (!have.has(it.id)) have.set(it.id, { item_id: it.id, name: it.name, sku: it.sku, base: f.kind === 'sales' ? it.selling_price : it.cost_price, rate: '' });
      return [...have.values()];
    }));
  }, [search, f.scheme, f.kind]);
  const save = async () => {
    const body = { ...f, items: items.filter((x) => x.rate !== '' && x.rate !== null).map((x) => ({ item_id: x.item_id, rate: x.rate })) };
    const ok = await run(() => (pl.id ? api.put(`/price-lists/${pl.id}`, body) : api.post('/price-lists', body)), 'Price list saved');
    if (ok) onSaved();
  };
  const remove = async () => {
    if (!(await confirmDialog({ message: `Delete price list ${pl.name}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/price-lists/${pl.id}`), 'Price list deleted')) !== undefined) onSaved();
  };
  const shown = items.filter((x) => !search || `${x.name} ${x.sku}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal wide title={pl.id ? `Edit ${pl.name}` : 'New Price List'} onClose={onClose}
      footer={<>{pl.id && can('items', 'delete') && <button type="button" className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="grid-2 mb">
        <Field label="Name" required><Input value={f.name} onChange={(v) => setF({ ...f, name: v })} autoFocus /></Field>
        <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="sales">Sales</option><option value="purchase">Purchase</option></select></Field>
        <Field label="Pricing scheme"><select className="input" value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })}><option value="percentage">Mark up / mark down item rates by a percentage</option><option value="per_item">Enter rates individually for each item</option></select></Field>
        <Field label="Status"><select className="input" value={f.is_active ? '1' : '0'} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
      </div>
      {f.scheme === 'percentage' ? (
        <div className="grid-3 mb">
          <Field label="Direction"><select className="input" value={f.markup ? '1' : '0'} onChange={(e) => setF({ ...f, markup: e.target.value === '1' })}><option value="1">Markup</option><option value="0">Markdown</option></select></Field>
          <Field label="Percentage"><Input type="number" min="0" step="0.01" value={f.percentage} onChange={(v) => setF({ ...f, percentage: v })} /></Field>
          <Field label="Round off to"><select className="input" value={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.value })}><option value="none">Never mind</option><option value="whole">Nearest whole number</option><option value="0.99">x.99</option><option value="0.50">Nearest 0.50</option></select></Field>
        </div>
      ) : (
        <>
          <input type="search" className="input mb" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="table compact"><thead><tr><th>Item</th><th className="num">{f.kind === 'sales' ? 'Selling price' : 'Cost price'}</th><th className="num">Custom rate</th></tr></thead>
              <tbody>{shown.map((x) => (
                <tr key={x.item_id}><td>{x.name} <span className="faint small">{x.sku}</span></td><td className="num">{money(x.base)}</td>
                  <td><input className="input num" type="number" min="0" step="0.01" value={x.rate ?? ''} onChange={(e) => setItems((cur) => cur.map((y) => (y.item_id === x.item_id ? { ...y, rate: e.target.value } : y)))} /></td></tr>
              ))}</tbody></table>
          </div>
        </>
      )}
      <Field label="Description"><Textarea value={f.description} onChange={(v) => setF({ ...f, description: v })} rows={2} /></Field>
    </Modal>
  );
}
