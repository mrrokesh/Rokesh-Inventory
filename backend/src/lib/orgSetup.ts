import crypto from 'node:crypto';
import { DEFAULT_ROLES } from './permissions.js';
import { DEFAULT_SERIES } from './numbering.js';

const DEFAULT_UNITS = ['pcs', 'nos', 'box', 'set', 'kg', 'g', 'ltr', 'm', 'cm', 'dozen', 'pack', 'licence', 'hrs', 'month', 'year'];

/** Creates the configuration every new organization needs. Returns the admin role id. */
export async function setupOrganization(client, orgId, { warehouseName = 'Primary Warehouse', address = {} } = {}) {
  let adminRoleId = null;
  for (const role of DEFAULT_ROLES) {
    const { rows } = await client.query(
      'INSERT INTO roles (org_id, name, description, is_admin, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [orgId, role.name, role.description, role.is_admin, JSON.stringify(role.permissions)],
    );
    if (role.is_admin) adminRoleId = rows[0].id;
  }
  for (const [docType, prefix, padding] of DEFAULT_SERIES) {
    await client.query(
      'INSERT INTO number_series (org_id, doc_type, prefix, padding) VALUES ($1, $2, $3, $4)',
      [orgId, docType, prefix, padding],
    );
  }
  for (const name of DEFAULT_UNITS) {
    await client.query('INSERT INTO units (org_id, name) VALUES ($1, $2)', [orgId, name]);
  }
  await client.query(
    'INSERT INTO warehouses (org_id, name, address, is_primary) VALUES ($1, $2, $3, TRUE)',
    [orgId, warehouseName, JSON.stringify(address)],
  );
  const slug = crypto.randomBytes(6).toString('hex');
  await client.query('UPDATE organizations SET portal_slug = $2 WHERE id = $1', [orgId, slug]);
  return adminRoleId;
}
