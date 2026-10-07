import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLookups } from '../lib/lookups';
import { dateTime, label } from '../lib/format';
import { Badge, Checkbox, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, confirmDialog, useAction, useApi } from '../components/ui';
import { useToast } from '../components/Toast';

// ------------------------------------------------------------------ Email
const PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false, note: 'Use an App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.' },
  zoho: { host: 'smtp.zoho.in', port: 587, secure: false, note: 'Use your Zoho Mail address and password (or an app-specific password if 2FA is on).' },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false, note: 'Use your Microsoft 365 email and password. Your admin may need to allow SMTP AUTH.' },
  custom: { host: '', port: 587, secure: false, note: 'Ask your email or hosting provider for the SMTP server details.' },
};

export function EmailSettings() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const { data, reload } = useApi('/email/settings');
  const [f, setF] = useState(null);
  const [preset, setPreset] = useState('custom');
  const [testTo, setTestTo] = useState(user.email);
  const log = useApi('/email/log');
  useEffect(() => {
    if (data) setF({ host: data.host || '', port: data.port || 587, secure: !!data.secure, user: data.user || '', password: '', from_name: data.from_name || user.org_name, from_email: data.from_email || '' });
  }, [data, user.org_name]);
  if (!f) return <Spinner />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await run(() => api.put('/email/settings', f), 'Email settings saved')) { reload(); refresh(); } };
  const test = async () => { if (await run(() => api.post('/email/settings/test', { to: testTo }))) toast(`Test email sent to ${testTo}. Check the inbox (and spam folder).`); };
  const clear = async () => {
    if (!(await confirmDialog({ message: 'Remove the email account? The app will stop sending emails.', danger: true, confirmText: 'Remove' }))) return;
    if (await run(() => api.put('/email/settings', { clear: true }), 'Email account removed')) { reload(); refresh(); }
  };
  const p = PRESETS[preset];
  return (
    <>
      <PageHead title="Email" />
      <p className="muted" style={{ marginTop: 0 }}>Connect the email account the app should send from. Invoices, estimates, orders, invitations and password-reset links are then emailed directly from the app.</p>
      <div className="card mb"><div className="card-body">
        <div className="row mb"><Badge status={data.configured ? 'active' : 'inactive'}>{data.configured ? 'Connected' : 'Not set up'}</Badge></div>
        {!user.is_admin && <div className="info-box mb">Only administrators can change these settings.</div>}
        <div className="grid-2">
          <Field label="Email provider">
            <Select value={preset} onChange={(v) => { setPreset(v); if (v !== 'custom') setF({ ...f, host: PRESETS[v].host, port: PRESETS[v].port, secure: PRESETS[v].secure }); }}
              options={[['gmail', 'Gmail / Google Workspace'], ['zoho', 'Zoho Mail (India)'], ['outlook', 'Outlook / Microsoft 365'], ['custom', 'Other (enter details)']]} />
          </Field>
          <div className="small muted" style={{ alignSelf: 'end' }}>{p.note}</div>
          <Field label="SMTP server" required><Input value={f.host} onChange={set('host')} placeholder="smtp.example.com" /></Field>
          <Field label="Port" hint="587 (STARTTLS) is most common; 465 uses SSL"><Input type="number" value={f.port} onChange={(v) => set('port')(Number(v))} /></Field>
          <Field label="Username" hint="Usually your full email address"><Input value={f.user} onChange={set('user')} autoComplete="off" /></Field>
          <Field label="Password" hint={data.configured ? `Saved (${data.password}). Leave blank to keep it.` : 'Stored encrypted'}><Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <Field label="From name"><Input value={f.from_name} onChange={set('from_name')} /></Field>
          <Field label="From email" required><Input type="email" value={f.from_email} onChange={set('from_email')} /></Field>
        </div>
        <div className="mt"><Checkbox checked={f.secure} onChange={set('secure')}>Use SSL from the start (port 465)</Checkbox></div>
        {user.is_admin && (
          <div className="row mt">
            <button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button>
            {data.configured && <button type="button" className="btn danger" onClick={clear}>Remove</button>}
          </div>
        )}
      </div></div>
      {data.configured && user.is_admin && (
        <div className="card mb"><div className="card-head"><h3>Send a test email</h3></div><div className="card-body row">
          <Input type="email" value={testTo} onChange={setTestTo} />
          <button type="button" className="btn" disabled={busy} onClick={test}>Send test</button>
        </div></div>
      )}
      <div className="card">
        <div className="card-head"><h3>Recently sent</h3></div>
        <table className="table compact"><tbody>
          {(log.data || []).length === 0 && <tr><td className="faint">No emails sent yet.</td></tr>}
          {(log.data || []).map((e) => (
            <tr key={e.id}><td>{e.subject}<div className="small faint">to {e.to_addr}</div></td><td>{e.status === 'sent' ? <Badge status="active">Sent</Badge> : <Badge status="failed">Failed</Badge>}{e.error && <div className="small faint">{e.error}</div>}</td><td className="small nowrap">{dateTime(e.created_at)}</td></tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Integrations
const GUIDES = {
  razorpay: {
    what: 'Send customers a link to pay invoices online by UPI, card or net banking. When they pay, the payment is recorded and the invoice is marked paid automatically.',
    steps: ['Sign in to the Razorpay Dashboard → Account & Settings → API Keys → Generate key. Copy the Key ID and Key Secret here.',
      'In Razorpay → Account & Settings → Webhooks → Add new webhook: paste the Webhook URL shown below, choose a secret, and tick the event payment_link.paid.',
      'Type the same webhook secret here, tick Enabled, Save, then press Test connection.'],
    fields: [['key_id', 'Key ID', 'config'], ['key_secret', 'Key Secret', 'secret'], ['webhook_secret', 'Webhook secret', 'secret']],
  },
  shiprocket: {
    what: 'Book couriers from a package with one click: the app creates the Shiprocket order, gets the AWB (tracking number) and label, and updates delivery status every 15 minutes.',
    steps: ['In Shiprocket → Settings → API → Configure, create an API user (a separate email + password).',
      'Enter that email and password here, and the exact name of your pickup location (Settings → Pickup Addresses).',
      'Tick Enabled, Save, and press Test connection — it lists your pickup locations.'],
    fields: [['email', 'API user email', 'config'], ['password', 'API user password', 'secret'], ['pickup_location', 'Pickup location name', 'config'], ['default_weight_kg', 'Default package weight (kg)', 'config']],
  },
  shopify: {
    what: 'Bring orders from your Shopify store in as sales orders, and keep stock levels on Shopify up to date. Items are matched by SKU, so use the same SKUs in both places.',
    steps: ['In Shopify admin → Settings → Apps and sales channels → Develop apps → Create an app.',
      'Give it Admin API access scopes: read_orders, read_products, read_inventory, write_inventory, read_locations. Install it and copy the Admin API access token.',
      'Enter your store domain (yourstore.myshopify.com) and the token, Save, and press Test connection to see your location IDs. Then fill in the location ID.'],
    fields: [['shop_domain', 'Store domain', 'config'], ['access_token', 'Admin API access token', 'secret'], ['location_id', 'Shopify location ID (for stock)', 'config']],
  },
  twilio: {
    what: 'Send text messages (SMS) to customers and vendors: by hand from any invoice or order, or automatically from workflow rules. Works in most countries.',
    steps: ['Create a Twilio account at twilio.com and buy (or verify) a phone number that can send SMS.',
      'On the Twilio Console home page copy the Account SID and Auth Token.',
      'Enter them here with your Twilio phone number in international format (e.g. +14155550123), tick Enabled, Save, and press Test connection.'],
    fields: [['account_sid', 'Account SID', 'config'], ['auth_token', 'Auth Token', 'secret'], ['from_number', 'Twilio phone number (sender)', 'config']],
  },
  msg91: {
    what: 'Send SMS in India through MSG91. Indian rules (DLT) require every message to follow a template you register in advance.',
    steps: ['Create an MSG91 account and complete DLT registration (sender ID and entity).',
      'Create a DLT-approved template with one variable for the text, e.g. “{#var#} - Your Company”, and add it in MSG91 → Templates (Flow). Name the variable “message” (or enter its name below).',
      'Copy your Auth Key (MSG91 → API) and the template ID here, tick Enabled and Save. Then send a test from any invoice (More → Send SMS).'],
    fields: [['auth_key', 'Auth Key', 'secret'], ['template_id', 'Template (flow) ID', 'config'], ['variable_name', 'Template variable name (default: message)', 'config']],
  },
};

function IntegrationCard({ it, onSaved, warehouses }: any) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ enabled: it.enabled, config: { ...it.config }, secrets: {} });
  const g = GUIDES[it.provider];
  const logs = useApi(open ? '/integrations/logs' : null, { provider: it.provider }, [open]);
  const save = async () => { if (await run(() => api.put(`/integrations/${it.provider}`, f), `${it.name} settings saved`)) onSaved(); };
  const test = async () => { const r = await run(() => api.post(`/integrations/${it.provider}/test`)); if (r) toast(r.message); logs.reload(); };
  const sync = async (what?: any) => {
    const url = it.provider === 'shopify' ? '/integrations/shopify/sync' : '/integrations/shiprocket/sync';
    const r = await run(() => api.post(url, { what }));
    if (r) toast(r.message);
    logs.reload();
  };
  return (
    <div className="card mb">
      <div className="card-head">
        <h3>{it.name} <span className="faint small">· {it.category}</span></h3>
        <Badge status={it.enabled ? 'active' : 'inactive'}>{it.enabled ? 'Connected' : 'Off'}</Badge>
        <button type="button" className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : it.enabled ? 'Manage' : 'Set up'}</button>
      </div>
      <div className="card-body">
        <div className="muted">{g.what}</div>
        {it.last_error && <div className="error-box small mt">Last problem: {it.last_error}</div>}
        {it.last_sync_at && <div className="small faint mt">Last automatic sync {dateTime(it.last_sync_at)}</div>}
        {open && (
          <div className="mt">
            <h4 className="mb">How to connect</h4>
            <ol className="small" style={{ paddingLeft: 20, marginTop: 0 }}>{g.steps.map((s) => <li key={s} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
            {it.webhook_url && <div className="info-box small mb" style={{ wordBreak: 'break-all' }}>Webhook URL: <span className="mono">{it.webhook_url}</span><br />It must be reachable from the internet (set APP_URL on the server to your public address).</div>}
            <div className="grid-2">
              {g.fields.map(([key, lbl, kind]) => (
                <Field key={key} label={lbl} hint={kind === 'secret' && it.secrets[key] ? `Saved (${it.secrets[key]}). Leave blank to keep it.` : undefined}>
                  {kind === 'secret'
                    ? <Input type="password" autoComplete="new-password" value={f.secrets[key] || ''} onChange={(v) => setF({ ...f, secrets: { ...f.secrets, [key]: v } })} />
                    : <Input value={f.config[key] || ''} onChange={(v) => setF({ ...f, config: { ...f.config, [key]: v } })} />}
                </Field>
              ))}
              {it.provider === 'shopify' && (
                <>
                  <Field label="Stock comes from warehouse"><Select value={f.config.warehouse_id || ''} onChange={(v) => setF({ ...f, config: { ...f.config, warehouse_id: v } })} options={warehouses.map((w) => [w.id, w.name])} placeholder="All warehouses" /></Field>
                  <div className="stack" style={{ gap: 6, paddingTop: 20 }}>
                    <Checkbox checked={f.config.import_orders !== false} onChange={(v) => setF({ ...f, config: { ...f.config, import_orders: v } })}>Import new orders</Checkbox>
                    <Checkbox checked={f.config.push_stock !== false} onChange={(v) => setF({ ...f, config: { ...f.config, push_stock: v } })}>Update stock on Shopify</Checkbox>
                    <Checkbox checked={!!f.config.auto_sync} onChange={(v) => setF({ ...f, config: { ...f.config, auto_sync: v } })}>Do this automatically every 15 minutes</Checkbox>
                  </div>
                </>
              )}
            </div>
            <div className="mt"><Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })}>Enabled</Checkbox></div>
            {user.is_admin && (
              <div className="row mt wrap">
                <button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button>
                <button type="button" className="btn" disabled={busy} onClick={test}>Test connection</button>
                {it.enabled && it.provider === 'shopify' && <><button type="button" className="btn" disabled={busy} onClick={() => sync('orders')}>Import orders now</button><button type="button" className="btn" disabled={busy} onClick={() => sync('stock')}>Push stock now</button></>}
                {it.enabled && it.provider === 'shiprocket' && <button type="button" className="btn" disabled={busy} onClick={() => sync()}>Update tracking now</button>}
              </div>
            )}
            <h4 className="mt mb">Activity</h4>
            <table className="table compact"><tbody>
              {(logs.data || []).length === 0 && <tr><td className="faint">Nothing yet.</td></tr>}
              {(logs.data || []).slice(0, 15).map((l) => <tr key={l.id}><td className="small nowrap">{dateTime(l.created_at)}</td><td>{label(l.action)}</td><td><Badge status={l.status === 'success' ? 'active' : 'failed'}>{l.status}</Badge></td><td className="small">{l.message}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

export function Integrations() {
  const { refresh } = useAuth();
  const { data, error, reload } = useApi('/integrations');
  const { warehouses } = useLookups('warehouses');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="Integrations" />
      <p className="muted" style={{ marginTop: 0 }}>Connect payment, shipping and online-store services using your own accounts. Keys are stored encrypted. Want to connect something else (Tally, Zapier, your website)? Use <Link to="/settings/developer">API keys & webhooks</Link>.</p>
      {data.map((it) => <IntegrationCard key={it.provider} it={it} warehouses={warehouses} onSaved={() => { reload(); refresh(); }} />)}
    </>
  );
}

// ------------------------------------------------------------------ Developer: API keys & webhooks
export function Developer() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const keys = useApi('/integrations/api-keys');
  const hooks = useApi('/integrations/webhooks');
  const events = useApi('/integrations/webhook-events');
  const users = useApi('/settings/users');
  const [newKey, setNewKey] = useState(null);
  const [keyForm, setKeyForm] = useState(null);
  const [hookForm, setHookForm] = useState(null);
  const [deliveries, setDeliveries] = useState(null);

  const createKey = async () => {
    const r = await run(() => api.post('/integrations/api-keys', keyForm));
    if (r) { setKeyForm(null); setNewKey(r.key); keys.reload(); }
  };
  const revoke = async (k) => {
    if (!(await confirmDialog({ message: `Revoke the API key "${k.name}"? Anything using it stops working immediately.`, danger: true, confirmText: 'Revoke' }))) return;
    if ((await run(() => api.del(`/integrations/api-keys/${k.id}`), 'API key revoked')) !== undefined) keys.reload();
  };
  const saveHook = async () => {
    const r = await run(() => (hookForm.id ? api.put(`/integrations/webhooks/${hookForm.id}`, hookForm) : api.post('/integrations/webhooks', hookForm)), 'Webhook saved');
    if (r) { setHookForm(null); hooks.reload(); }
  };
  const removeHook = async (w) => {
    if (!(await confirmDialog({ message: `Delete the webhook to ${w.url}?`, danger: true, confirmText: 'Delete' }))) return;
    if ((await run(() => api.del(`/integrations/webhooks/${w.id}`), 'Webhook deleted')) !== undefined) hooks.reload();
  };
  const testHook = async (w) => { const r = await run(() => api.post(`/integrations/webhooks/${w.id}/test`)); if (r) toast(r.message); };
  const showDeliveries = async (w) => setDeliveries({ w, rows: await api.get(`/integrations/webhooks/${w.id}/deliveries`) });

  return (
    <>
      <PageHead title="API keys & webhooks" />
      <p className="muted" style={{ marginTop: 0 }}>For developers and automation tools (Zapier, Make, n8n, your website). An <strong>API key</strong> lets another system use this app's API. A <strong>webhook</strong> tells another system the moment something happens here.</p>

      <div className="card mb">
        <div className="card-head"><h3>API keys</h3><button type="button" className="btn sm primary" onClick={() => setKeyForm({ name: '', user_id: '' })}>+ New API key</button></div>
        <div className="card-body small muted">Send the key in the header <span className="mono">Authorization: Bearer &lt;key&gt;</span> to any endpoint under <span className="mono">/api</span> (for example <span className="mono">GET /api/items</span>). The key has the same permissions as the user it acts as.</div>
        <table className="table compact"><tbody>
          {(keys.data || []).length === 0 && <tr><td className="faint">No API keys.</td></tr>}
          {(keys.data || []).map((k) => (
            <tr key={k.id}><td className="bold">{k.name}<div className="small faint mono">{k.prefix}…</div></td><td className="small">acts as {k.user_name} ({k.role_name})</td>
              <td className="small">{k.last_used_at ? `used ${dateTime(k.last_used_at)}` : 'never used'}</td>
              <td className="num"><button type="button" className="btn sm ghost danger" onClick={() => revoke(k)}>Revoke</button></td></tr>
          ))}
        </tbody></table>
      </div>

      <div className="card">
        <div className="card-head"><h3>Webhooks</h3><button type="button" className="btn sm primary" onClick={() => setHookForm({ url: '', events: ['*'], enabled: true })}>+ New webhook</button></div>
        <div className="card-body small muted">We POST a JSON message to your URL for each event. Verify it with the header <span className="mono">X-Inventory-Signature</span> = <span className="mono">sha256=</span>HMAC-SHA256 of the body using the webhook's secret. Failed deliveries are retried for about 9 hours.</div>
        <table className="table compact"><tbody>
          {(hooks.data || []).length === 0 && <tr><td className="faint">No webhooks.</td></tr>}
          {(hooks.data || []).map((w) => (
            <tr key={w.id}>
              <td className="mono small" style={{ wordBreak: 'break-all' }}>{w.url}<div className="faint">{w.events.includes('*') ? 'All events' : w.events.join(', ')}</div></td>
              <td><Badge status={w.enabled ? 'active' : 'inactive'} />{w.failed > 0 && <div className="small" style={{ color: 'var(--red)' }}>{w.failed} failed</div>}</td>
              <td className="small mono">secret: {w.secret.slice(0, 6)}…<button type="button" className="btn link small" onClick={async () => { try { await navigator.clipboard.writeText(w.secret); toast('Secret copied'); } catch { window.prompt('Secret', w.secret); } }}>copy</button></td>
              <td className="num nowrap">
                <button type="button" className="btn sm ghost" onClick={() => testHook(w)}>Send test</button>
                <button type="button" className="btn sm ghost" onClick={() => showDeliveries(w)}>Deliveries</button>
                <button type="button" className="btn sm ghost" onClick={() => setHookForm({ ...w })}>Edit</button>
                <button type="button" className="btn sm ghost danger" onClick={() => removeHook(w)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>

      {keyForm && (
        <Modal title="New API key" onClose={() => setKeyForm(null)} footer={<><button type="button" className="btn" onClick={() => setKeyForm(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={createKey}>Create</button></>}>
          <div className="stack">
            <Field label="Name" hint="What will use it, e.g. Zapier or Website"><Input value={keyForm.name} onChange={(v) => setKeyForm({ ...keyForm, name: v })} autoFocus /></Field>
            <Field label="Acts as user" hint="The key can do exactly what this user's role allows. Tip: create a user with a limited role just for integrations.">
              <Select value={keyForm.user_id} onChange={(v) => setKeyForm({ ...keyForm, user_id: v })} options={(users.data || []).filter((u) => u.status === 'active').map((u) => [u.id, `${u.name} (${u.role_name})`])} placeholder="Me" />
            </Field>
          </div>
        </Modal>
      )}
      {newKey && (
        <Modal title="Copy your API key" onClose={() => setNewKey(null)} footer={<button type="button" className="btn primary" onClick={() => setNewKey(null)}>I have copied it</button>}>
          <div className="warn-box mb">This is the only time the key is shown. Store it somewhere safe.</div>
          <div className="row"><Input value={newKey} readOnly onChange={() => {}} /><button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(newKey); toast('Copied'); } catch { /* select manually */ } }}>Copy</button></div>
        </Modal>
      )}
      {hookForm && (
        <Modal wide title={hookForm.id ? 'Edit webhook' : 'New webhook'} onClose={() => setHookForm(null)} footer={<><button type="button" className="btn" onClick={() => setHookForm(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={saveHook}>Save</button></>}>
          <div className="stack">
            <Field label="URL" required><Input value={hookForm.url} onChange={(v) => setHookForm({ ...hookForm, url: v })} placeholder="https://example.com/hooks/inventory" autoFocus /></Field>
            <Checkbox checked={hookForm.events.includes('*')} onChange={(v) => setHookForm({ ...hookForm, events: v ? ['*'] : [] })}>Send all events</Checkbox>
            {!hookForm.events.includes('*') && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {(events.data || []).map((e) => (
                  <Checkbox key={e} checked={hookForm.events.includes(e)} onChange={(v) => setHookForm({ ...hookForm, events: v ? [...hookForm.events, e] : hookForm.events.filter((x) => x !== e) })}><span className="mono small">{e}</span></Checkbox>
                ))}
              </div>
            )}
            <Checkbox checked={hookForm.enabled} onChange={(v) => setHookForm({ ...hookForm, enabled: v })}>Enabled</Checkbox>
          </div>
        </Modal>
      )}
      {deliveries && (
        <Modal wide title="Recent deliveries" onClose={() => setDeliveries(null)}>
          <table className="table compact"><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Response</th><th>When</th></tr></thead>
            <tbody>{deliveries.rows.map((d) => (
              <tr key={d.id}><td className="mono small">{d.event}</td><td><Badge status={d.status === 'sent' ? 'active' : d.status === 'failed' ? 'failed' : 'pending'}>{d.status}</Badge></td>
                <td>{d.attempts}</td><td className="small">{d.response_status || ''} {d.last_error || ''}</td><td className="small">{dateTime(d.created_at)}</td></tr>
            ))}</tbody></table>
        </Modal>
      )}
    </>
  );
}
