// Encrypts stored credentials (SMTP password, integration API keys) with AES-256-GCM.
// The key comes from APP_SECRET (falls back to JWT_SECRET). Changing it makes stored secrets unreadable.
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(`${process.env.APP_SECRET || config.jwtSecret}::stored-secrets`).digest();

export function encrypt(value) {
  if (value === null || value === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(stored) {
  if (!stored) return null;
  try {
    const [v, iv, tag, data] = stored.split(':');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

/** Show only the last 4 characters of a secret. */
export const mask = (s) => (s ? `••••${String(s).slice(-4)}` : '');
