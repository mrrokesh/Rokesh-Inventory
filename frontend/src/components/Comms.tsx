import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../lib/format';
import { Checkbox, ErrorBox, Field, Input, Modal, Textarea, confirmDialog, useAction, useApi } from './ui';
import { useToast } from './Toast';

/** Email a document to the customer/vendor. */
export function EmailModal({ entityType, entityId, onClose, onSent }: any) {
  const toast = useToast();
  const { user } = useAuth();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`/email/compose/${entityType}/${entityId}`).then((d) => setF({ to: d.to, cc: '', subject: d.subject, message: d.message, configured: d.configured })).catch(setError);
  }, [entityType, entityId]);
  const send = async () => {
    const ok = await run(() => api.post('/email/send', { entity_type: entityType, entity_id: entityId, to: f.to, cc: f.cc, subject: f.subject, message: f.message }), `Email sent to ${f.to}`);
    if (ok) { onSent?.(); onClose(); }
  };
  return (
    <Modal wide title="Send by email" onClose={onClose}
      footer={f?.configured ? <><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !f.to} onClick={send}>{busy ? 'Sending…' : 'Send'}</button></> : <button type="button" className="btn" onClick={onClose}>Close</button>}>
      <ErrorBox error={error} />
      {!f && !error && 'Loading…'}
      {f && !f.configured && (
        <div className="warn-box">
          Email isn't set up yet. {user.is_admin ? <>Add your email account in <Link to="/settings/email" onClick={onClose}>Settings → Email</Link> first.</> : 'Ask an administrator to set it up in Settings → Email.'}
          {' '}Meanwhile you can use <strong>Print / PDF</strong> and attach the PDF to an email yourself.
        </div>
      )}
      {f?.configured && (
        <div className="stack">
          <Field label="To" hint="Separate several addresses with commas"><Input value={f.to} onChange={(v) => setF({ ...f, to: v })} autoFocus /></Field>
          <Field label="Cc"><Input value={f.cc} onChange={(v) => setF({ ...f, cc: v })} /></Field>
          <Field label="Subject"><Input value={f.subject} onChange={(v) => setF({ ...f, subject: v })} /></Field>
          <Field label="Message" hint="The document's details (items, totals, tax) are added below your message automatically."><Textarea rows={7} value={f.message} onChange={(v) => setF({ ...f, message: v })} /></Field>
        </div>
      )}
    </Modal>
  );
}

/** Comments thread on a record: customer comments from the portal + staff replies / internal notes. */
export function Comments({ entityType, entityId, portal }: any) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(!portal);
  const { data, reload } = useApi('/comments', { entity_type: entityType, entity_id: entityId });
  const post = async () => {
    if (!body.trim()) return;
    if (await run(() => api.post('/comments', { entity_type: entityType, entity_id: entityId, body, is_internal: internal }))) { setBody(''); reload(); }
  };
  const remove = async (c) => {
    if (!(await confirmDialog({ message: 'Delete this comment?', danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/comments/${c.id}`))) !== undefined) reload();
  };
  const list = data || [];
  return (
    <div className="card no-print">
      <div className="card-head"><h3>Comments ({list.length})</h3></div>
      <div className="card-body stack" style={{ gap: 10 }}>
        {list.length === 0 && <div className="faint small">No comments yet.{portal ? ' Customers can comment from the customer portal.' : ''}</div>}
        {list.map((c) => (
          <div key={c.id} style={{ padding: '8px 10px', borderRadius: 8, background: c.contact_name ? 'var(--primary-soft)' : c.is_internal ? 'var(--orange-soft)' : 'var(--surface-2)' }}>
            <div className="small" style={{ display: 'flex', gap: 6 }}>
              <strong>{c.contact_name ? `${c.contact_name} (customer)` : c.user_name}</strong>
              {c.is_internal && <span className="badge orange">Internal</span>}
              <span className="faint" style={{ marginLeft: 'auto' }}>{dateTime(c.created_at)}</span>
              {(c.user_id === user.id || user.is_admin) && !c.contact_name && <button type="button" className="btn link small" onClick={() => remove(c)}>Delete</button>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.body}</div>
          </div>
        ))}
        <Textarea rows={2} value={body} onChange={setBody} placeholder={internal ? 'Add a note for your team…' : 'Reply to the customer…'} />
        <div className="row">
          {portal && <Checkbox checked={internal} onChange={setInternal}>Internal note (customer can't see it)</Checkbox>}
          <span className="spacer" />
          <button type="button" className="btn sm primary" disabled={busy || !body.trim()} onClick={post}>{internal ? 'Add note' : 'Send reply'}</button>
        </div>
      </div>
    </div>
  );
}
