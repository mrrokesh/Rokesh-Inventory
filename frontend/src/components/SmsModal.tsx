import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import { Field, Input, Modal, Textarea, useAction } from './ui';

/** "Send SMS" from a document: pre-fills the contact's mobile number and a short message. */
export default function SmsModal({ entityType, entityId, contactApi, contactId, message, onClose }: any) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [to, setTo] = useState('');
  const [text, setText] = useState(message || '');
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    api.get('/integrations/sms/enabled').then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
    if (contactApi && contactId) api.get(`${contactApi}/${contactId}`).then((c) => setTo(c.mobile || c.phone || '')).catch(() => {});
  }, [contactApi, contactId]);
  const send = async () => {
    const r = await run(() => api.post('/integrations/sms/send', { to, message: text, entity_type: entityType, entity_id: entityId }));
    if (r) { toast(`Text message sent to ${r.to}`); onClose(); }
  };
  return (
    <Modal title="Send SMS" onClose={onClose}
      footer={<><button type="button" className="btn primary" disabled={busy || !enabled || !to || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack">
        {enabled === false && <div className="warn-box">SMS is not set up yet. An administrator can connect Twilio or MSG91 in Settings → Integrations.</div>}
        <Field label="Mobile number" hint="10-digit Indian numbers get +91 automatically; include the country code for other countries."><Input value={to} onChange={setTo} placeholder="98765 43210" /></Field>
        <Field label="Message" hint={`${text.length} characters · about ${Math.max(1, Math.ceil(text.length / 160))} SMS`}><Textarea rows={4} value={text} onChange={setText} /></Field>
      </div>
    </Modal>
  );
}
