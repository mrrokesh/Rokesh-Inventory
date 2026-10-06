import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { INDIAN_STATES } from '../lib/format';
import { ErrorBox, Field, Input, Select, Spinner } from '../components/ui';

function AuthShell({ title, subtitle, children }: any) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { startSession(await api.post('/auth/login', f)); navigate('/'); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Sign in" subtitle="Sign in to your inventory account">
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Email"><Input type="email" autoComplete="email" required value={f.email} onChange={(v) => setF({ ...f, email: v })} autoFocus /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small muted center">New here? <Link to="/signup">Create an organization</Link></div>
        <div className="small faint center">Forgot your password? Ask your administrator for a password reset link (Settings → Users).</div>
      </form>
    </AuthShell>
  );
}

export function Signup() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ organization_name: '', name: '', email: '', password: '', country: 'India', state: 'Tamil Nadu', currency: 'INR', timezone: 'Asia/Kolkata' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { startSession(await api.post('/auth/signup', f)); navigate('/'); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Create your organization" subtitle="You will be the administrator of this organization.">
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Organization name" required><Input required value={f.organization_name} onChange={set('organization_name')} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Country"><Input value={f.country} onChange={set('country')} /></Field>
          <Field label="State">
            {f.country === 'India' ? <Select value={f.state} onChange={set('state')} options={INDIAN_STATES.map((s) => [s, s])} /> : <Input value={f.state} onChange={set('state')} />}
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Currency"><Input value={f.currency} maxLength={3} onChange={(v) => set('currency')(v.toUpperCase())} /></Field>
          <Field label="Time zone"><Input value={f.timezone} onChange={set('timezone')} /></Field>
        </div>
        <Field label="Your name" required><Input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Email" required><Input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Password" required hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
        <div className="small muted center">Already have an account? <Link to="/login">Sign in</Link></div>
      </form>
    </AuthShell>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState({ name: '', password: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/auth/invite/${token}`).then((d) => { setInfo(d); setF((x) => ({ ...x, name: d.name })); }).catch(setError);
  }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { startSession(await api.post(`/auth/invite/${token}`, f)); navigate('/'); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  if (!info && !error) return <AuthShell title="Accept invitation"><Spinner /></AuthShell>;
  return (
    <AuthShell title={info?.is_reset ? 'Choose a new password' : 'Accept invitation'}
      subtitle={info ? (info.is_reset ? `For ${info.email} at ${info.org_name}` : `Join ${info.org_name} as ${info.email}`) : undefined}>
      <ErrorBox error={error} />
      {info && (
        <form className="stack" onSubmit={submit}>
          <Field label="Your name"><Input value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
          <Field label="Choose a password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : info.is_reset ? 'Save password and sign in' : 'Join organization'}</button>
        </form>
      )}
    </AuthShell>
  );
}
