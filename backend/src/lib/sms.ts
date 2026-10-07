// Text messages (SMS) through the organization's own provider account:
//  - Twilio: account SID + auth token + sender number. Works worldwide.
//  - MSG91 (India): auth key + DLT-approved template with one variable that carries the message text.
import { query } from '../db.js';
import { badRequest } from './errors.js';
import { getIntegration, logIntegration } from './integrations.js';

export const SMS_PROVIDERS = ['twilio', 'msg91'];

/** Normalise a phone number to digits with country code (default India, 91). */
export function normalisePhone(raw, defaultCountry = '91') {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return defaultCountry + d;
  return d;
}

export async function smsProvider(orgId) {
  for (const p of SMS_PROVIDERS) {
    const it = await getIntegration(orgId, p);
    if (it?.enabled) return it;
  }
  return null;
}

async function post(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw badRequest(`Could not reach the SMS service: ${err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok || data?.type === 'error') {
    throw badRequest(`The SMS service said: ${data?.message || data?.raw || `HTTP ${res.status}`}`);
  }
  return data;
}

async function sendVia(it, to, message) {
  if (it.provider === 'twilio') {
    const sid = it.config.account_sid;
    const auth = Buffer.from(`${sid}:${it.secret.auth_token || ''}`).toString('base64');
    const body = new URLSearchParams({ To: `+${to}`, From: it.config.from_number || '', Body: message });
    const data = await post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    return data?.sid || null;
  }
  // MSG91 flow API: the DLT template's variable (default "message") carries the text.
  const variable = it.config.variable_name || 'message';
  const data = await post('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: it.secret.auth_key || '', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ template_id: it.config.template_id, short_url: '0', recipients: [{ mobiles: to, [variable]: message }] }),
  });
  return data?.message || null;
}

/** Send one SMS and log it. Throws a readable error if it could not be sent. */
export async function sendSms(orgId, rawTo, message, ctx: any = {}) {
  const text = String(message || '').trim();
  if (!text) throw badRequest('Write the message');
  if (text.length > 1000) throw badRequest('The message is too long (1000 characters at most)');
  const to = normalisePhone(rawTo);
  if (!/^\d{8,15}$/.test(to)) throw badRequest(`“${rawTo}” is not a valid mobile number`);
  const it = await smsProvider(orgId);
  if (!it) throw badRequest('SMS is not set up yet. An administrator can connect Twilio or MSG91 in Settings → Integrations.');
  const log = (status, extra) => query(
    `INSERT INTO sms_log (org_id, provider, to_number, message, status, error, provider_id, entity_type, entity_id, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [orgId, it.provider, `+${to}`, text, status, extra.error || null, extra.providerId || null, ctx.entityType || null, ctx.entityId || null, ctx.userId || null],
  );
  try {
    const providerId = await sendVia(it, to, text);
    await log('sent', { providerId });
    return { to: `+${to}`, provider: it.provider };
  } catch (err) {
    await log('failed', { error: err.message });
    await logIntegration(orgId, it.provider, 'send_sms', 'error', err.message).catch(() => {});
    throw err;
  }
}

export async function twilioTest(orgId) {
  const it = await getIntegration(orgId, 'twilio');
  if (!it?.config?.account_sid || !it?.secret?.auth_token) throw badRequest('Enter the Account SID and Auth Token first');
  const auth = Buffer.from(`${it.config.account_sid}:${it.secret.auth_token}`).toString('base64');
  let res;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(it.config.account_sid)}.json`, {
      headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw badRequest(`Could not reach Twilio: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw badRequest(`Twilio said: ${data?.message || `HTTP ${res.status}`}`);
  return `Connected to Twilio account “${data.friendly_name || it.config.account_sid}”. Send a test message from any invoice to check delivery.`;
}

export async function msg91Test(orgId) {
  const it = await getIntegration(orgId, 'msg91');
  if (!it?.secret?.auth_key || !it?.config?.template_id) throw badRequest('Enter the Auth Key and the DLT template ID first');
  return 'Details saved. MSG91 has no harmless test call, so send a test message from any invoice (More → Send SMS) to check delivery.';
}
