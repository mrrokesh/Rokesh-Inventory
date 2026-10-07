import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../db.js';

/** Creates the first platform admin from env when the table is empty. */
export async function bootstrapPlatformAdmin({ log = console.log } = {}) {
  const email = (config.platformAdminEmail || '').trim().toLowerCase();
  const password = config.platformAdminPassword || '';
  if (!email || !password) {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM platform_admins');
    if (rows[0].n === 0) {
      log('No platform admins yet. Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD to create the first one.');
    }
    return;
  }
  if (password.length < 8) {
    log('PLATFORM_ADMIN_PASSWORD must be at least 8 characters — skipping bootstrap.');
    return;
  }
  const { rows } = await query('SELECT id FROM platform_admins WHERE lower(email) = $1', [email]);
  if (rows[0]) return;
  const hash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO platform_admins (name, email, password_hash) VALUES ($1, $2, $3)',
    [config.platformAdminName, email, hash],
  );
  log(`Platform admin created for ${email}`);
}
