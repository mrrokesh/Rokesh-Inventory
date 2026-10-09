import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see backend/.env.example)`);
  return value;
}

const signupMode = (process.env.SIGNUP_MODE || 'invite_only').toLowerCase();
if (!['open', 'invite_only', 'closed'].includes(signupMode)) {
  throw new Error('SIGNUP_MODE must be open, invite_only, or closed');
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  port: Number(process.env.PORT || 4000),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  /** open = public self-serve (trial); invite_only/closed = only platform creates orgs */
  signupMode: signupMode as 'open' | 'invite_only' | 'closed',
  platformAdminEmail: process.env.PLATFORM_ADMIN_EMAIL || '',
  platformAdminPassword: process.env.PLATFORM_ADMIN_PASSWORD || '',
  platformAdminName: process.env.PLATFORM_ADMIN_NAME || 'Platform Admin',
  trialDays: Number(process.env.TRIAL_DAYS || 14),
  supportEmail: process.env.SUPPORT_EMAIL || 'support@rokesh.com',
  /** Platform SaaS billing (charges your clients) — separate from per-org invoice Razorpay */
  platformRazorpayKeyId: process.env.PLATFORM_RAZORPAY_KEY_ID || '',
  platformRazorpayKeySecret: process.env.PLATFORM_RAZORPAY_KEY_SECRET || '',
  platformRazorpayWebhookSecret: process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET || '',
};
