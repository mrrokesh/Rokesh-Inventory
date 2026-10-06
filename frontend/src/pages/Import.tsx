import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { downloadCsv, parseCsv } from '../lib/format';
import { BackLink, ErrorBox, PageHead } from '../components/ui';
import { useToast } from '../components/Toast';

// Column headers for each import template (first one listed as required).
const TEMPLATES = {
  items: {
    title: 'Items & Opening Stock', api: '/items/import', back: '/items', required: ['name'],
    columns: ['name', 'sku', 'item_type', 'unit', 'category', 'brand', 'manufacturer', 'barcode', 'hsn_sac', 'description', 'selling_price', 'cost_price',
      'sales_tax', 'purchase_tax', 'track_inventory', 'reorder_level', 'returnable', 'opening_stock', 'opening_stock_rate', 'warehouse',
      'length_cm', 'width_cm', 'height_cm', 'weight_kg'],
    sample: { name: 'Dell Latitude 5440 i5/16GB/512GB', sku: 'DELL-LAT-5440', item_type: 'goods', unit: 'pcs', category: 'Laptops', brand: 'Dell', selling_price: '72000', cost_price: '61000', track_inventory: 'yes', reorder_level: '3', returnable: 'yes', opening_stock: '10', opening_stock_rate: '61000' },
    notes: ['item_type: goods or service', 'track_inventory / returnable: yes or no', 'sales_tax / purchase_tax: the tax name or rate as set up in Settings → Taxes', 'warehouse: warehouse name (defaults to the primary warehouse)', 'opening_stock_rate defaults to cost_price'],
  },
  customers: {
    title: 'Customers', api: '/customers/import', back: '/customers', required: ['display_name'],
    columns: ['display_name', 'customer_type', 'company_name', 'salutation', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'website', 'gst_treatment', 'gstin', 'pan',
      'place_of_supply', 'currency', 'payment_terms', 'credit_limit', 'billing_attention', 'billing_street1', 'billing_street2', 'billing_city', 'billing_state', 'billing_zip',
      'billing_country', 'billing_phone', 'shipping_attention', 'shipping_street1', 'shipping_street2', 'shipping_city', 'shipping_state', 'shipping_zip', 'shipping_country', 'shipping_phone', 'notes'],
    sample: { display_name: 'Sri Ganesh Computers', customer_type: 'business', company_name: 'Sri Ganesh Computers Pvt Ltd', email: 'accounts@example.in', phone: '+91 44 2345 6789', gst_treatment: 'registered', gstin: '33ABCDE1234F1Z5', place_of_supply: 'Tamil Nadu', currency: 'INR', payment_terms: '30', billing_city: 'Chennai', billing_state: 'Tamil Nadu', billing_country: 'India' },
    notes: ['customer_type: business or individual', 'gst_treatment: registered, registered_composition, unregistered, consumer, overseas, sez, deemed_export', 'payment_terms: number of days (0 = due on receipt)'],
  },
  vendors: {
    title: 'Vendors', api: '/vendors/import', back: '/vendors', required: ['display_name'],
    columns: ['display_name', 'company_name', 'salutation', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'website', 'gst_treatment', 'gstin', 'pan', 'place_of_supply',
      'currency', 'payment_terms', 'billing_attention', 'billing_street1', 'billing_street2', 'billing_city', 'billing_state', 'billing_zip', 'billing_country', 'billing_phone', 'notes'],
    sample: { display_name: 'Redington India', company_name: 'Redington Limited', email: 'orders@example.in', gst_treatment: 'registered', gstin: '33AABCR1234A1Z9', place_of_supply: 'Tamil Nadu', currency: 'INR', payment_terms: '45', billing_city: 'Chennai', billing_state: 'Tamil Nadu', billing_country: 'India' },
    notes: ['gst_treatment: registered, registered_composition, unregistered, overseas, sez', 'payment_terms: number of days'],
  },
};

export default function Import() {
  const { type } = useParams();
  const t = TEMPLATES[type];
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!t) return <div className="page"><ErrorBox error={{ message: 'Unknown import type' }} /></div>;

  const template = () => downloadCsv(`${type}-import-template.csv`, t.columns.map((c) => ({ key: c, label: c })), [t.sample]);
  const onFile = async (file) => {
    setResult(null); setError(null);
    if (!file) return;
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    const missing = t.required.filter((c) => !parsed.length || !(c in parsed[0]));
    if (missing.length) { setError({ message: `Missing required column(s): ${missing.join(', ')}. Download the template for the exact headers.` }); setRows(null); return; }
    setRows(parsed);
  };
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(t.api, { rows });
      setResult(r);
      toast(`${r.imported} record(s) imported${r.errors.length ? `, ${r.errors.length} skipped` : ''}`, r.errors.length ? 'error' : 'success');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const previewCols = rows ? Object.keys(rows[0] || {}).slice(0, 8) : [];
  return (
    <div className="page narrow">
      <BackLink to={t.back}>Back</BackLink>
      <PageHead title={`Import ${t.title}`}><button type="button" className="btn" onClick={template}>Download CSV template</button></PageHead>
      <ErrorBox error={error} />
      <div className="card mb"><div className="card-body stack">
        <div>Upload a CSV file (UTF-8, first row = column headers). Required: <strong>{t.required.join(', ')}</strong>.</div>
        <ul className="small muted" style={{ margin: 0 }}>{t.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <div className="small muted">Accepted headers: <span className="mono">{t.columns.join(', ')}</span></div>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files[0])} />
      </div></div>
      {rows && !result && (
        <div className="card mb">
          <div className="card-head"><h3>Preview — {rows.length} row(s) from {fileName}</h3><button type="button" className="btn primary" disabled={busy || !rows.length} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length} row(s)`}</button></div>
          <div className="table-wrap"><table className="table compact">
            <thead><tr><th>Row</th>{previewCols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}><td>{i + 2}</td>{previewCols.map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody>
          </table></div>
          {rows.length > 10 && <div className="small faint" style={{ padding: 10 }}>…and {rows.length - 10} more</div>}
        </div>
      )}
      {result && (
        <div className="card">
          <div className="card-head"><h3>Import complete</h3><Link className="btn" to={t.back}>View {t.title.toLowerCase()}</Link></div>
          <div className="card-body">
            <div className="mb"><strong>{result.imported}</strong> imported, <strong>{result.errors.length}</strong> skipped.</div>
            {result.errors.length > 0 && (
              <table className="table compact"><thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>{result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.error}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
