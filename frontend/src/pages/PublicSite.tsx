import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { API_BASE } from '../api';
import { APP_NAME, APP_TAGLINE, LOGO_SRC } from '../brand';
import { Spinner } from '../components/ui';

function Shell({ children }: { children: any }) {
  return (
    <div className="auth-split" style={{ minHeight: '100vh', display: 'block' }}>
      <header className="row" style={{ padding: '16px 24px', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Link to="/pricing" className="row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
          <img src={LOGO_SRC} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div>
            <div className="bold">{APP_NAME}</div>
            <div className="small faint">{APP_TAGLINE}</div>
          </div>
        </Link>
        <nav className="row" style={{ gap: 16 }}>
          <Link to="/pricing">Pricing</Link>
          <Link to="/support">Support</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link className="btn primary sm" to="/login">Sign in</Link>
          <Link className="btn sm" to="/platform">Platform</Link>
        </nav>
      </header>
      <main style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px 64px' }}>{children}</main>
      <footer className="small faint center" style={{ padding: 24, borderTop: '1px solid var(--border)' }}>
        © {new Date().getFullYear()} {APP_NAME}. <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/support">Support</Link>
      </footer>
    </div>
  );
}

function Pricing() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/public/pricing`).then((r) => r.json()).then(setData).catch(() => setData({ data: [], support_email: 'support@rokesh.com' }));
  }, []);
  if (!data) return <Spinner />;
  return (
    <Shell>
      <h1 style={{ marginTop: 0 }}>Pricing</h1>
      <p className="muted">Choose a plan for your inventory team. Contact us to get started — we provision your organization and invite your admin.</p>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 24 }}>
        {(data.data || []).map((p) => (
          <div key={p.code} className="card"><div className="card-body stack">
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            <div><span className="bold" style={{ fontSize: 28 }}>₹{Number(p.price_monthly || 0).toLocaleString('en-IN')}</span><span className="faint"> / month</span></div>
            <p className="muted" style={{ margin: 0 }}>{p.description || 'Inventory, sales and purchasing for your business.'}</p>
            <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Up to {p.max_users ?? 'unlimited'} users</li>
              <li>Up to {p.max_warehouses ?? 'unlimited'} warehouses</li>
              <li>Up to {p.max_items ?? 'unlimited'} items</li>
            </ul>
            <a className="btn primary" href={`mailto:${data.support_email}?subject=${encodeURIComponent(`Interested in ${p.name}`)}`}>Contact sales</a>
          </div></div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 24 }}>Need a custom or dedicated deployment? Email <a href={`mailto:${data.support_email}`}>{data.support_email}</a>.</p>
    </Shell>
  );
}

function Support() {
  const [email, setEmail] = useState('support@rokesh.com');
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/public-info`).then((r) => r.json()).then((d) => { if (d.support_email) setEmail(d.support_email); }).catch(() => {});
  }, []);
  return (
    <Shell>
      <h1 style={{ marginTop: 0 }}>Support</h1>
      <p className="muted">We help you onboard, migrate data, and keep your inventory running.</p>
      <div className="card"><div className="card-body stack">
        <div><div className="small faint">Email</div><a href={`mailto:${email}`}>{email}</a></div>
        <div><div className="small faint">Platform operators</div><p style={{ margin: 0 }}>If you run Rokesh Inventory for clients, sign in at <Link to="/platform">/platform</Link>.</p></div>
        <div><div className="small faint">In-app help</div><p style={{ margin: 0 }}>After sign-in, open <strong>Help & Guides</strong> or the <strong>?</strong> button on any screen.</p></div>
        <a className="btn primary" href={`mailto:${email}?subject=Support%20request`}>Email support</a>
      </div></div>
    </Shell>
  );
}

function Terms() {
  return (
    <Shell>
      <h1 style={{ marginTop: 0 }}>Terms of Service</h1>
      <p className="muted">Last updated: {new Date().toLocaleDateString('en-IN')}</p>
      <div className="stack" style={{ lineHeight: 1.6 }}>
        <p>These Terms govern use of {APP_NAME} (“Service”) provided by the operator (“we”, “us”). By creating or using an organization account you agree to these Terms.</p>
        <h3>1. Accounts</h3>
        <p>You are responsible for users you invite, credentials, and activity under your organization. Keep passwords confidential and notify us of unauthorized access.</p>
        <h3>2. Acceptable use</h3>
        <p>You may use the Service only for lawful business inventory, sales and purchasing. You must not attempt to access other tenants’ data, disrupt the Service, or misuse APIs.</p>
        <h3>3. Your data</h3>
        <p>You retain ownership of business data you enter. We process it to provide the Service. Customer portal data belongs to the organization that enabled the portal.</p>
        <h3>4. Plans and payment</h3>
        <p>Paid plans are billed as agreed (typically monthly). Non-payment may result in suspension. Trial access ends on the trial expiry date unless activated.</p>
        <h3>5. Availability</h3>
        <p>We aim for reliable uptime but do not guarantee uninterrupted service. Scheduled maintenance may occur with notice when practical.</p>
        <h3>6. Limitation of liability</h3>
        <p>To the extent permitted by law, we are not liable for indirect or consequential losses. Our aggregate liability is limited to fees paid for the Service in the three months preceding the claim.</p>
        <h3>7. Termination</h3>
        <p>Either party may terminate for material breach. On termination, access ends; you may request an export of your data within a reasonable period where available.</p>
        <h3>8. Contact</h3>
        <p>Questions about these Terms: see <Link to="/support">Support</Link>.</p>
      </div>
    </Shell>
  );
}

function Privacy() {
  return (
    <Shell>
      <h1 style={{ marginTop: 0 }}>Privacy Policy</h1>
      <p className="muted">Last updated: {new Date().toLocaleDateString('en-IN')}</p>
      <div className="stack" style={{ lineHeight: 1.6 }}>
        <p>This Policy describes how {APP_NAME} handles personal and business data when you use the Service.</p>
        <h3>1. Data we process</h3>
        <p>Account details (name, email), organization profile, inventory and transaction records, support messages, and technical logs (IP, device, timestamps) needed to operate and secure the Service.</p>
        <h3>2. How we use data</h3>
        <p>To provide inventory features, authenticate users, bill subscriptions, send transactional email you configure, improve reliability, and comply with law.</p>
        <h3>3. Sharing</h3>
        <p>We do not sell your data. Subprocessors (hosting, email, payment gateways such as Razorpay) process data only to deliver the Service. Each organization’s data is isolated by tenant controls.</p>
        <h3>4. Retention</h3>
        <p>We retain data while your organization is active and for a limited period afterward for backups, disputes, and legal obligations.</p>
        <h3>5. Security</h3>
        <p>Access is authenticated; passwords are hashed; secrets are encrypted at rest where applicable. No method of transmission is perfectly secure.</p>
        <h3>6. Your rights</h3>
        <p>Organization admins can update user and profile data in Settings. Contact support to request correction or deletion subject to legal holds.</p>
        <h3>7. Contact</h3>
        <p>Privacy requests: <Link to="/support">Support</Link>.</p>
      </div>
    </Shell>
  );
}

export default function PublicSite() {
  return (
    <Routes>
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/support" element={<Support />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
    </Routes>
  );
}

export { Pricing, Support, Terms, Privacy };
