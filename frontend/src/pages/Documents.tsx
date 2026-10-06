import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, documentUrl } from '../api';
import { useAuth } from '../auth';
import { dateTime, fileSize, label } from '../lib/format';
import DataTable from '../components/DataTable';
import { Field, Input, Modal, PageHead, confirmDialog, useAction } from '../components/ui';
import { useToast } from '../components/Toast';

const ENTITY_LINKS = {
  item: '/items', customer: '/customers', vendor: '/vendors', sales_order: '/sales-orders', invoice: '/invoices', package: '/packages',
  shipment: '/shipments', credit_note: '/credit-notes', sales_return: '/sales-returns', purchase_order: '/purchase-orders',
  purchase_receive: '/purchase-receives', bill: '/bills', vendor_credit: '/vendor-credits', payments_received: '/payments-received',
  payments_made: '/payments-made', inventory_adjustment: '/inventory/adjustments', transfer_order: '/inventory/transfers',
};
const CATEGORIES = ['Receipts', 'E-way bills', 'Delivery challans', 'Vendor contracts', 'Purchase documents', 'Sales documents', 'Product images', 'Compliance', 'Other'];

export default function Documents() {
  const { can } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [busy, run] = useAction(toast);
  const [category, setCategory] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);
  const upload = async (files) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (category) fd.append('category', category);
    await run(() => api.upload('/documents', fd), `${files.length} file(s) uploaded`);
    input.current.value = '';
    setReloadKey((k) => k + 1);
  };
  const remove = async (ids) => {
    if (!(await confirmDialog({ message: `Delete ${ids.length} document(s)?`, danger: true, confirmText: 'Delete' }))) return false;
    for (const id of ids) await api.del(`/documents/${id}`).catch((e) => toast(e.message, 'error'));
    return true;
  };
  return (
    <div className="page">
      <PageHead title="Documents">
        {can('documents', 'create') && (
          <>
            <input className="input" list="doc-cats" placeholder="Category for upload" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="doc-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            <input ref={input} type="file" multiple hidden onChange={(e) => upload([...e.target.files])} />
            <button type="button" className="btn primary" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Uploading…' : 'Upload files'}</button>
          </>
        )}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>All files uploaded here or attached to items, contacts and transactions. PDF, images, spreadsheets and documents up to 10 MB each.</p>
      <DataTable endpoint="/documents" reloadKey={reloadKey} searchPlaceholder="Search file name or category"
        filters={[{ key: 'entity_type', label: 'Attached to', options: [['', 'All documents'], ...Object.keys(ENTITY_LINKS).map((k) => [k, label(k)])] }]}
        bulkActions={can('documents', 'delete') ? [{ label: 'Delete', danger: true, run: remove }] : []}
        emptyTitle="No documents yet" emptyText="Upload receipts, e-way bills, signed delivery challans and contracts."
        columns={[
          { key: 'file_name', label: 'File name', sort: 'name', render: (r) => <a href={documentUrl(r.id, true)} target="_blank" rel="noreferrer">{r.file_name}</a> },
          { key: 'category', label: 'Category', render: (r) => <button type="button" className="btn link" onClick={() => setEditing(r)}>{r.category || 'Set category'}</button> },
          { key: 'entity_type', label: 'Attached to', render: (r) => (r.entity_type ? <Link to={`${ENTITY_LINKS[r.entity_type]}/${r.entity_id}`}>{label(r.entity_type)} #{r.entity_id}</Link> : <span className="faint">Unattached</span>) },
          { key: 'size_bytes', label: 'Size', num: true, sort: 'size', render: (r) => fileSize(r.size_bytes) },
          { key: 'uploaded_by_name', label: 'Uploaded by' },
          { key: 'created_at', label: 'Uploaded', sort: 'date', render: (r) => dateTime(r.created_at) },
          { key: 'dl', label: '', csv: false, render: (r) => <a className="btn sm" href={documentUrl(r.id)}>Download</a> },
        ]} />
      {editing && <EditDoc doc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}

function EditDoc({ doc, onClose, onSaved }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ file_name: doc.file_name, category: doc.category || '' });
  const save = async () => { if (await run(() => api.put(`/documents/${doc.id}`, f), 'Document updated')) onSaved(); };
  return (
    <Modal title="Edit document" onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack">
        <Field label="File name"><Input value={f.file_name} onChange={(v) => setF({ ...f, file_name: v })} /></Field>
        <Field label="Category">
          <input className="input" list="doc-cats-edit" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          <datalist id="doc-cats-edit">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </div>
    </Modal>
  );
}
