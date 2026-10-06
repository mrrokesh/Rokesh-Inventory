import { useRef, useState } from 'react';
import { api, documentUrl } from '../api';
import { useAuth } from '../auth';
import { dateTime, fileSize } from '../lib/format';
import { confirmDialog, useApi } from './ui';
import { useToast } from './Toast';
import Icon from './Icon';

/** Files attached to a record. */
export function Attachments({ entityType, entityId }: any) {
  const { can } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useApi(can('documents') ? '/documents' : null, { entity_type: entityType, entity_id: entityId, per_page: 50 });
  if (!can('documents')) return null;
  const upload = async (files) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('entity_type', entityType);
    fd.append('entity_id', entityId);
    setBusy(true);
    try { await api.upload('/documents', fd); toast('Uploaded'); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); input.current.value = ''; }
  };
  const remove = async (d) => {
    if (!(await confirmDialog({ message: `Delete ${d.file_name}?`, danger: true, confirmText: 'Delete' }))) return;
    try { await api.del(`/documents/${d.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const docs = data?.data || [];
  return (
    <div className="card no-print">
      <div className="card-head">
        <h3><Icon name="attach" size={14} className="" /> Attachments ({docs.length})</h3>
        {can('documents', 'create') && (
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => upload([...e.target.files])} />
            <button type="button" className="btn sm" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Uploading…' : 'Upload files'}</button>
          </>
        )}
      </div>
      <div className="card-body flush">
        {docs.length === 0 && <div className="faint small" style={{ padding: 12 }}>No files attached. PDFs, images, spreadsheets and documents up to 10 MB.</div>}
        <table className="table compact"><tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td><a href={documentUrl(d.id, true)} target="_blank" rel="noreferrer">{d.file_name}</a><div className="small faint">{fileSize(d.size_bytes)} · {d.uploaded_by_name} · {dateTime(d.created_at)}</div></td>
              <td className="num">
                <a className="btn sm ghost" href={documentUrl(d.id)}>Download</a>
                {can('documents', 'delete') && <button type="button" className="btn sm ghost danger" onClick={() => remove(d)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

/** Audit history for a record. */
export function History({ entityType, entityId, reloadKey }: any) {
  const { can } = useAuth();
  const { data } = useApi(can('reports') ? '/settings/audit-logs' : null, { entity_type: entityType, entity_id: entityId, per_page: 30 }, [reloadKey]);
  if (!can('reports')) return null;
  const rows = data?.data || [];
  return (
    <div className="card no-print">
      <div className="card-head"><h3>History</h3></div>
      <div className="card-body flush">
        {rows.length === 0 && <div className="faint small" style={{ padding: 12 }}>No history yet.</div>}
        <table className="table compact"><tbody>
          {rows.map((a) => <tr key={a.id}><td>{a.summary}<div className="small faint">{a.user_name || 'System'} · {dateTime(a.created_at)}</div></td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
