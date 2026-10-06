// Sends email through the organization's own SMTP account (Gmail, Zoho Mail, Outlook, SES…).
import nodemailer from 'nodemailer';
import { query } from '../db.js';
import { badRequest } from './errors.js';
import { decrypt } from './secrets.js';

export const appUrl = () => (process.env.APP_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0]).replace(/\/$/, '');

export async function smtpSettings(orgId) {
  const { rows } = await query('SELECT name, smtp FROM organizations WHERE id = $1', [orgId]);
  const s = rows[0]?.smtp;
  if (!s?.host) return null;
  return { ...s, org_name: rows[0].name, pass: decrypt(s.pass_enc) };
}

export async function isEmailConfigured(orgId) {
  return !!(await smtpSettings(orgId));
}

/** Send one email. Throws a friendly error when SMTP is not set up or the server rejects it. */
export async function sendMail(orgId: any, opts: any) {
  const { to, cc, subject, html, text, replyTo } = opts || {};
  const s = await smtpSettings(orgId);
  if (!s) throw badRequest('Email is not set up yet. An administrator can add the email account in Settings → Email.');
  const transport = nodemailer.createTransport({
    host: s.host, port: Number(s.port) || 587, secure: !!s.secure,
    auth: s.user ? { user: s.user, pass: s.pass || '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  try {
    return await transport.sendMail({
      from: { name: s.from_name || s.org_name, address: s.from_email || s.user },
      to, cc: cc || undefined, subject, html, text, replyTo: replyTo || undefined,
    });
  } catch (err) {
    throw badRequest(`The email server rejected the message: ${err.message}`);
  }
}

export async function logEmail(orgId: any, opts: any = {}) {
  const { entityType, entityId, to, subject, status, error, userId } = opts;
  await query(
    'INSERT INTO email_log (org_id, entity_type, entity_id, to_addr, subject, status, error, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [orgId, entityType || null, entityId || null, Array.isArray(to) ? to.join(', ') : to, subject, status, error || null, userId || null],
  );
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export { esc };

/** A simple, email-client-safe HTML wrapper. */
export function emailLayout({ orgName, title, intro, bodyHtml, button }: any) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f8;font-family:Segoe UI,Arial,sans-serif;color:#21263c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;border:1px solid #e3e6ec">
    <tr><td style="padding:22px 28px;border-bottom:1px solid #e3e6ec;font-size:18px;font-weight:600">${esc(orgName)}</td></tr>
    <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6">
      ${title ? `<h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>` : ''}
      ${intro ? `<p style="margin:0 0 16px;white-space:pre-line">${esc(intro)}</p>` : ''}
      ${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#408dfb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:600">${esc(button.label)}</a></p>` : ''}
      ${bodyHtml || ''}
    </td></tr>
    <tr><td style="padding:14px 28px;border-top:1px solid #e3e6ec;font-size:12px;color:#8a91a3">Sent by ${esc(orgName)}</td></tr>
  </table></td></tr></table></body></html>`;
}
