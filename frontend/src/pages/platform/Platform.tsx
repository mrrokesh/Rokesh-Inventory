import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { APP_NAME, LOGO_SRC } from '../../brand';
import { Badge, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, useAction } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';
import { setToken } from '../../api';
import { getPlatformToken, platformApi, setPlatformToken, setPlatformUnauthorizedHandler } from '../../platformApi';

type Admin = { id: number; name: string; email: string };

const MODULE_LABELS: Record<string, string> = {
  shopify: 'Shopify', shiprocket: 'Shiprocket', portal: 'Customer portal', announcements: 'Announcements', sms: 'SMS',
};

function DashboardHome() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { platformApi.get('/dashboard').then(setData).catch(() => {}); }, []);
  if (!data) return <Spinner />;
  const t = data.totals || {};
  return (
    <>
      <PageHead title="Overview" />
      <div className="grid-2 mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          ['Organizations', t.orgs], ['Active', t.active_orgs], ['Trial', t.trial_orgs],
          ['Suspended', t.suspended_orgs], ['Past due', t.past_due], ['Active users', t.active_users],
        ].map(([l, n]) => (
          <div key={l as string} className="card"><div className="card-body"><div className="small faint">{l}</div><div className="bold" style={{ fontSize: 22 }}>{n ?? 0}</div></div></div>
        ))}
      </div>
      {!data.billing_configured && (
        <div className="info-box mb">Platform Razorpay is not configured. Set PLATFORM_RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET on the API to collect client subscriptions.</div>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card"><div className="card-body">
          <h3 style={{ marginTop: 0 }}>Trials ending (14 days)</h3>
          <table className="table">
            <thead><tr><th>Organization</th><th>Plan</th><th>Ends</th></tr></thead>
            <tbody>
              {!(data.trials_ending || []).length && <tr><td colSpan={3} className="faint center">No trials ending soon.</td></tr>}
              {(data.trials_ending || []).map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/platform/orgs/${o.id}`)}>
                  <td><span className="bold">{o.name}</span></td>
                  <td>{o.plan_name || '—'}</td>
                  <td>{o.trial_ends_at ? dateTime(o.trial_ends_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
        <div className="card"><div className="card-body">
          <h3 style={{ marginTop: 0 }}>Recently created</h3>
          <table className="table">
            <thead><tr><th>Organization</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {(data.recent_orgs || []).map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/platform/orgs/${o.id}`)}>
                  <td><span className="bold">{o.name}</span><div className="small faint">{o.plan_name}</div></td>
                  <td><Badge status={o.status} /></td>
                  <td>{dateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      </div>
    </>
  );
}

function PlatformLogin({ onOk }: { onOk: (a: Admin) => void }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await platformApi.post('/auth/login', f);
      setPlatformToken(r.token);
      onOk(r.admin);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="auth-split">
      <div className="auth-pane">
        <div className="auth-card">
          <div className="auth-brand">
            <img src={LOGO_SRC} alt="" />
            <div>
              <div className="auth-app-name">{APP_NAME}</div>
              <div className="auth-app-tag">Platform console</div>
            </div>
          </div>
          <h1>Super Admin</h1>
          <p className="muted" style={{ marginTop: 0 }}>Manage client organizations, plans, and access.</p>
          <form className="stack" onSubmit={submit}>
            <ErrorBox error={error} />
            <Field label="Email"><Input type="email" required autoComplete="username" value={f.email} onChange={(v) => setF({ ...f, email: v })} autoFocus /></Field>
            <Field label="Password"><Input type="password" required autoComplete="current-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
            <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div className="small muted center"><Link to="/login">← Client sign-in</Link></div>
          </form>
        </div>
      </div>
      <aside className="auth-hero">
        <img src={LOGO_SRC} alt={APP_NAME} />
        <p className="auth-hero-title">Operator portal</p>
        <p className="auth-hero-tag">Create clients, assign plans, and suspend access when needed.</p>
      </aside>
    </div>
  );
}

function OrgsList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => platformApi.get('/orgs', { search: q, status: status || undefined, per_page: 50 }).then(setData).catch(setError);
  useEffect(() => { load(); }, [status]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="Organizations">
        <Link className="btn primary" to="/platform/orgs/new">+ New client</Link>
      </PageHead>
      <div className="row mb" style={{ gap: 8 }}>
        <Input value={q} onChange={setQ} placeholder="Search name or email…" />
        <button type="button" className="btn" onClick={load}>Search</button>
        <Select value={status} onChange={setStatus} options={[['', 'All statuses'], ['trial', 'Trial'], ['active', 'Active'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled']]} />
      </div>
      <div className="card"><table className="table">
        <thead><tr><th>Organization</th><th>Status</th><th>Plan</th><th>Users</th><th>Last login</th><th>Created</th></tr></thead>
        <tbody>
          {!data.data?.length && <tr><td colSpan={6} className="faint center">No organizations yet.</td></tr>}
          {(data.data || []).map((o) => (
            <tr key={o.id} className="clickable" onClick={() => navigate(`/platform/orgs/${o.id}`)}>
              <td><span className="bold">{o.name}</span><div className="small faint">{o.email}</div></td>
              <td><Badge status={o.status} /></td>
              <td>{o.plan_name || '—'}</td>
              <td>{o.user_count}</td>
              <td>{o.last_login_at ? dateTime(o.last_login_at) : '—'}</td>
              <td>{dateTime(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

function NewOrg() {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [plans, setPlans] = useState([]);
  const [f, setF] = useState({
    organization_name: '', admin_name: '', admin_email: '', status: 'active', plan_id: '',
    country: 'India', state: 'Tamil Nadu', currency: 'INR', platform_notes: '',
  });
  const [inviteUrl, setInviteUrl] = useState('');
  useEffect(() => {
    platformApi.get('/plans').then((r) => {
      setPlans(r.data || []);
      const starter = (r.data || []).find((p) => p.code === 'starter');
      if (starter) setF((x) => ({ ...x, plan_id: String(starter.id) }));
    }).catch(() => {});
  }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => platformApi.post('/orgs', { ...f, plan_id: f.plan_id ? Number(f.plan_id) : null }), 'Client organization created');
    if (r) {
      setInviteUrl(r.invite_url || '');
      if (!r.invite_url) navigate(`/platform/orgs/${r.id}`);
    }
  };
  if (inviteUrl) {
    return (
      <div className="card"><div className="card-body stack">
        <h2>Client created</h2>
        <p>Send this invitation link so the client admin can set their password:</p>
        <Input value={inviteUrl} readOnly onChange={() => {}} />
        <div className="row">
          <button type="button" className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); toast('Link copied'); } catch { /* */ } }}>Copy link</button>
          <Link className="btn" to="/platform/orgs">Back to list</Link>
        </div>
      </div></div>
    );
  }
  return (
    <form onSubmit={save}>
      <PageHead title="New client organization" />
      <div className="card"><div className="card-body stack">
        <Field label="Organization name" required><Input required value={f.organization_name} onChange={set('organization_name')} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Admin name" required><Input required value={f.admin_name} onChange={set('admin_name')} /></Field>
          <Field label="Admin email" required><Input type="email" required value={f.admin_email} onChange={set('admin_email')} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Status"><Select value={f.status} onChange={set('status')} options={[['active', 'Active'], ['trial', 'Trial'], ['suspended', 'Suspended']]} /></Field>
          <Field label="Plan"><Select value={f.plan_id} onChange={set('plan_id')} options={plans.map((p) => [String(p.id), p.name])} /></Field>
        </div>
        <Field label="Internal notes"><Textarea value={f.platform_notes} onChange={set('platform_notes')} rows={3} /></Field>
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>Create & invite admin</button>
          <Link className="btn" to="/platform/orgs">Cancel</Link>
        </div>
      </div></div>
    </form>
  );
}

function OrgDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [org, setOrg] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [f, setF] = useState(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const load = () => Promise.all([
    platformApi.get(`/orgs/${id}`),
    platformApi.get('/plans'),
  ]).then(([o, p]) => {
    setOrg(o);
    setPlans(p.data || []);
    setF({
      name: o.name,
      status: o.status,
      plan_id: o.plan_id ? String(o.plan_id) : '',
      trial_ends_at: o.trial_ends_at ? String(o.trial_ends_at).slice(0, 10) : '',
      platform_notes: o.platform_notes || '',
    });
  }).catch(setError);
  useEffect(() => { load(); }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!org || !f) return <Spinner />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => platformApi.put(`/orgs/${id}`, {
      ...f,
      plan_id: f.plan_id ? Number(f.plan_id) : null,
      trial_ends_at: f.status === 'trial' && f.trial_ends_at ? f.trial_ends_at : (f.trial_ends_at || null),
    }), 'Organization updated');
    if (r) { setOrg(r); toast('Saved'); }
  };
  const reinvite = async () => {
    const r = await run(() => platformApi.post(`/orgs/${id}/invite-admin`, {}), 'Invite link created');
    if (r?.invite_url) setInviteUrl(r.invite_url);
  };
  const u = org.usage || {};
  return (
    <>
      <PageHead title={org.name}>
        <button type="button" className="btn" disabled={busy} onClick={async () => {
          const r = await run(() => platformApi.post(`/orgs/${id}/impersonate`, {}));
          if (r?.token) {
            setToken(r.token);
            window.location.href = '/';
          }
        }}>Login as client</button>
        <button type="button" className="btn" disabled={busy} onClick={async () => {
          const r = await run(() => platformApi.post(`/orgs/${id}/billing-link`, {}), 'Payment link created');
          if (r?.url) {
            try { await navigator.clipboard.writeText(r.url); toast('Payment link copied'); } catch { window.prompt('Payment link', r.url); }
          }
        }}>Payment link</button>
        <Link className="btn" to="/platform/orgs">← All orgs</Link>
      </PageHead>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={save}><div className="card-body stack">
          <h3 style={{ marginTop: 0 }}>Details</h3>
          <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
          <div className="grid-2">
            <Field label="Status"><Select value={f.status} onChange={set('status')} options={[['trial', 'Trial'], ['active', 'Active'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled']]} /></Field>
            <Field label="Plan"><Select value={f.plan_id} onChange={set('plan_id')} options={[['', '—'], ...plans.map((p) => [String(p.id), p.name])]} /></Field>
          </div>
          {f.status === 'trial' && (
            <Field label="Trial ends"><Input type="date" value={f.trial_ends_at} onChange={set('trial_ends_at')} /></Field>
          )}
          <Field label="Internal notes"><Textarea value={f.platform_notes} onChange={set('platform_notes')} rows={3} /></Field>
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
        </div></form>
        <div className="stack">
          <div className="card"><div className="card-body">
            <h3 style={{ marginTop: 0 }}>Usage</h3>
            <div className="grid-2">
              <div><div className="small faint">Users</div><div className="bold">{u.users ?? 0}{org.max_users != null ? ` / ${org.max_users}` : ''}</div></div>
              <div><div className="small faint">Warehouses</div><div className="bold">{u.warehouses ?? 0}{org.max_warehouses != null ? ` / ${org.max_warehouses}` : ''}</div></div>
              <div><div className="small faint">Items</div><div className="bold">{u.items ?? 0}{org.max_items != null ? ` / ${org.max_items}` : ''}</div></div>
              <div><div className="small faint">Last login</div><div>{org.last_login_at ? dateTime(org.last_login_at) : '—'}</div></div>
            </div>
          </div></div>
          <div className="card"><div className="card-body stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Users</h3>
              <button type="button" className="btn sm" disabled={busy} onClick={reinvite}>Invite / reset admin</button>
            </div>
            {inviteUrl && (
              <div className="stack">
                <Input value={inviteUrl} readOnly onChange={() => {}} />
                <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); toast('Copied'); } catch { /* */ } }}>Copy invite link</button>
              </div>
            )}
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {(org.users || []).map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role_name}</td>
                    <td><Badge status={u.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
    </>
  );
}

function PlansPage() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [data, setData] = useState(null);
  const load = () => platformApi.get('/plans').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;
  const save = async (p) => {
    if (await run(() => platformApi.put(`/plans/${p.id}`, p), 'Plan saved')) load();
  };
  return (
    <>
      <PageHead title="Plans" />
      <p className="muted">Limits and module flags apply per client. Monthly price is used for Razorpay payment links.</p>
      {(data.data || []).map((p) => (
        <PlanEditor key={p.id} plan={p} busy={busy} onSave={save} moduleKeys={data.module_keys} />
      ))}
    </>
  );
}

function PlanEditor({ plan, busy, onSave, moduleKeys }) {
  const mods = plan.modules || {};
  const [f, setF] = useState({
    ...plan,
    max_users: plan.max_users ?? '',
    max_warehouses: plan.max_warehouses ?? '',
    max_items: plan.max_items ?? '',
    price_monthly: plan.price_monthly ?? 0,
    modules: Object.fromEntries((moduleKeys || Object.keys(MODULE_LABELS)).map((k) => [k, mods[k] !== false])),
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="card mb"><div className="card-body stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{f.name} <span className="faint">({f.code})</span></strong>
        <label className="checkbox"><input type="checkbox" checked={f.is_active !== false} onChange={(e) => set('is_active')(e.target.checked)} /> Active</label>
      </div>
      <Field label="Display name"><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Monthly price (INR)"><Input type="number" value={f.price_monthly} onChange={set('price_monthly')} /></Field>
      <div className="grid-2">
        <Field label="Max users"><Input type="number" value={f.max_users} onChange={set('max_users')} placeholder="Unlimited" /></Field>
        <Field label="Max warehouses"><Input type="number" value={f.max_warehouses} onChange={set('max_warehouses')} placeholder="Unlimited" /></Field>
      </div>
      <Field label="Max items"><Input type="number" value={f.max_items} onChange={set('max_items')} placeholder="Unlimited" /></Field>
      <div>
        <div className="small faint mb">Modules</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {Object.keys(f.modules || {}).map((k) => (
            <label key={k} className="checkbox">
              <input type="checkbox" checked={!!f.modules[k]} onChange={(e) => setF((x) => ({ ...x, modules: { ...x.modules, [k]: e.target.checked } }))} />
              {MODULE_LABELS[k] || k}
            </label>
          ))}
        </div>
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => onSave({
        ...f,
        max_users: f.max_users === '' ? null : Number(f.max_users),
        max_warehouses: f.max_warehouses === '' ? null : Number(f.max_warehouses),
        max_items: f.max_items === '' ? null : Number(f.max_items),
        price_monthly: Number(f.price_monthly) || 0,
      })}>Save plan</button>
    </div></div>
  );
}

function AdminsPage() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [data, setData] = useState(null);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const load = () => platformApi.get('/admins').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    if ((await run(() => platformApi.post('/admins', f), 'Admin created')) !== undefined) {
      setShow(false); setF({ name: '', email: '', password: '' }); load();
    }
  };
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="Platform admins">
        <button type="button" className="btn primary" onClick={() => setShow(true)}>+ Add admin</button>
      </PageHead>
      {show && (
        <div className="card mb"><div className="card-body stack">
          <Field label="Name"><Input value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} /></Field>
          <Field label="Password"><Input type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !f.email || !f.password} onClick={save}>Create</button>
            <button type="button" className="btn" onClick={() => setShow(false)}>Cancel</button>
          </div>
        </div></div>
      )}
      <div className="card"><table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last login</th></tr></thead>
        <tbody>
          {(data.data || []).map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.email}</td>
              <td><Badge status={a.status} /></td>
              <td>{a.last_login_at ? dateTime(a.last_login_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

function AuditPage() {
  const [data, setData] = useState(null);
  useEffect(() => { platformApi.get('/audit', { limit: 200 }).then(setData).catch(() => {}); }, []);
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="Platform audit log" />
      <div className="card"><table className="table">
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          {(data.data || []).map((a) => (
            <tr key={a.id}>
              <td className="small">{dateTime(a.created_at)}</td>
              <td>{a.admin_name || '—'}</td>
              <td><code>{a.action}</code> {a.entity_type && <span className="faint">{a.entity_type}#{a.entity_id}</span>}</td>
              <td>{a.detail}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

function PlatformShell({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  return (
    <div className="app">
      <aside className="sidebar no-print" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="brand">
          <img className="brand-mark" src={LOGO_SRC} alt="" />
          <div>
            <div className="brand-name">Platform</div>
            <div className="small" style={{ opacity: 0.7, fontWeight: 400 }}>{APP_NAME}</div>
          </div>
        </div>
        <nav style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
          <NavLink to="/platform" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Overview</NavLink>
          <NavLink to="/platform/orgs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Organizations</NavLink>
          <NavLink to="/platform/plans" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Plans</NavLink>
          <NavLink to="/platform/admins" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Admins</NavLink>
          <NavLink to="/platform/audit" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Audit log</NavLink>
        </nav>
        <div style={{ padding: 12 }}>
          <div className="small" style={{ color: 'var(--sidebar-text)', marginBottom: 8 }}>{admin.email}</div>
          <button type="button" className="btn sm" style={{ width: '100%' }} onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <div className="content">
          <div className="page">
            <Routes>
              <Route index element={<DashboardHome />} />
              <Route path="orgs" element={<OrgsList />} />
              <Route path="orgs/new" element={<NewOrg />} />
              <Route path="orgs/:id" element={<OrgDetail />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="admins" element={<AdminsPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="*" element={<Navigate to="/platform" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Platform() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(!!getPlatformToken());

  useEffect(() => {
    setPlatformUnauthorizedHandler(() => { setPlatformToken(''); setAdmin(null); });
    if (!getPlatformToken()) { setLoading(false); return; }
    platformApi.get('/auth/me').then(setAdmin).catch(() => { setPlatformToken(''); setAdmin(null); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!admin) return <PlatformLogin onOk={setAdmin} />;
  return (
    <PlatformShell
      admin={admin}
      onLogout={() => { setPlatformToken(''); setAdmin(null); }}
    />
  );
}
