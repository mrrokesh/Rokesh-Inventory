// Public web form at /f/<token>: no sign-in. Can be linked to or embedded on a website in an iframe.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, mediaUrl } from '../api';
import { ErrorBox, Field, Input, Select, Spinner, Textarea } from '../components/ui';

export default function PublicForm() {
  const { token } = useParams();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [values, setValues] = useState<any>({});
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const embedded = typeof window !== 'undefined' && window.self !== window.top;
  useEffect(() => {
    fetch(`${API_BASE}/api/public/forms/${token}`)
      .then(async (r) => { const d = await r.json().catch(() => null); if (!r.ok) throw new Error(d?.error || 'This form is not available.'); return d; })
      .then((d) => { setForm(d); document.title = d.title; })
      .catch(setError);
  }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/public/forms/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values, website: trap }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || 'Could not send the form. Please try again.');
      setDone(d.message);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const set = (k) => (v) => setValues((x) => ({ ...x, [k]: v }));
  const input = (f) => {
    const common = { value: values[f.key] ?? '', onChange: set(f.key), required: f.required };
    switch (f.type) {
      case 'textarea': return <Textarea rows={4} {...common} />;
      case 'email': return <Input type="email" autoComplete="email" {...common} />;
      case 'phone': return <Input type="tel" autoComplete="tel" {...common} />;
      case 'number': case 'decimal': return <Input type="number" step="any" {...common} />;
      case 'date': return <Input type="date" {...common} />;
      case 'url': return <Input type="url" placeholder="https://" {...common} />;
      case 'dropdown': return <Select {...common} options={(f.options || []).map((o) => [o, o])} placeholder="Select" />;
      case 'checkbox': return <label className="checkbox"><input type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key)(e.target.checked)} /> {f.label}</label>;
      default: return <Input {...common} />;
    }
  };
  return (
    <div style={{ minHeight: '100vh', background: embedded ? 'transparent' : 'var(--bg)', padding: embedded ? 0 : '32px 16px' }}>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}><div className="card-body stack">
        {!form && !error && <Spinner />}
        {form && (
          <div className="row" style={{ gap: 12 }}>
            {form.org.logo_path && <img src={mediaUrl(form.org.logo_path)} alt="" style={{ maxHeight: 44, maxWidth: 120 }} />}
            <div><h2 style={{ margin: 0 }}>{form.title}</h2><div className="small faint">{form.org.name}</div></div>
          </div>
        )}
        {done ? (
          <div className="info-box" role="status" style={{ whiteSpace: 'pre-wrap' }}>{done}</div>
        ) : form && (
          <form className="stack" onSubmit={submit}>
            {form.intro && <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{form.intro}</p>}
            <ErrorBox error={error} />
            {form.fields.map((f) => <Field key={f.key} label={f.type === 'checkbox' ? '' : f.label} required={f.required}>{input(f)}</Field>)}
            {/* Hidden from people; spam bots fill it in and are ignored. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" /></label>
            </div>
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        )}
        {!form && error && <ErrorBox error={error} />}
      </div></div>
    </div>
  );
}
