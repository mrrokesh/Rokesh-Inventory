import { Router } from 'express';
import { query, tx } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { str, num, int, id, bool, email, obj, oneOf, listParams } from '../lib/validate.js';
import { cfInput, parseCustomFields } from '../lib/customFields.js';
import { assertCurrencyAllowed } from '../lib/currency.js';

/** Never send portal credentials to the browser. */
const safe = ({ portal_password_hash: _h, portal_token: _t, ...rest }: any) => rest;

const GST_TREATMENTS = ['registered', 'registered_composition', 'unregistered', 'consumer', 'overseas', 'sez', 'deemed_export'];

/** Router for /customers or /vendors. */
export function contactsRouter(type) {
  const r = Router();
  const M = type === 'customer' ? 'customers' : 'vendors';
  const label = type === 'customer' ? 'Customer' : 'Vendor';

  const balanceSql = type === 'customer'
    ? `(SELECT COALESCE(SUM(balance),0) FROM invoices WHERE contact_id = c.id AND status IN ('sent','partially_paid')) AS receivables,
       (SELECT COALESCE(SUM(balance),0) FROM credit_notes WHERE contact_id = c.id AND status = 'open')
         + (SELECT COALESCE(SUM(unused_amount),0) FROM payments_received WHERE contact_id = c.id) AS unused_credits`
    : `(SELECT COALESCE(SUM(balance),0) FROM bills WHERE contact_id = c.id AND status IN ('open','partially_paid')) AS payables,
       (SELECT COALESCE(SUM(balance),0) FROM vendor_credits WHERE contact_id = c.id AND status = 'open')
         + (SELECT COALESCE(SUM(unused_amount),0) FROM payments_made WHERE contact_id = c.id) AS unused_credits`;

  r.get('/', can(M, 'view'), async (req, res) => {
    const p = listParams(req.query, { name: 'c.display_name', company: 'c.company_name', created: 'c.created_at', email: 'c.email' }, 'name');
    if (!req.query.dir && !req.query.sort) p.orderBy = 'c.display_name ASC';
    const params = [req.orgId, type];
    const where = ['c.org_id = $1', 'c.contact_type = $2'];
    if (req.query.status) { params.push(req.query.status); where.push(`c.status = $${params.length}`); }
    if (p.search) {
      params.push(`%${p.search}%`);
      const n = `$${params.length}`;
      where.push(`(c.display_name ILIKE ${n} OR c.company_name ILIKE ${n} OR c.email ILIKE ${n} OR c.phone ILIKE ${n} OR c.mobile ILIKE ${n} OR c.gstin ILIKE ${n})`);
    }
    const w = where.join(' AND ');
    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      query(`SELECT c.*, ${balanceSql} FROM contacts c WHERE ${w} ORDER BY ${p.orderBy}, c.id LIMIT ${p.perPage} OFFSET ${p.offset}`, params),
      query(`SELECT COUNT(*)::int AS n FROM contacts c WHERE ${w}`, params),
    ]);
    res.json({ data: rows.map(safe), total: cnt.n, page: p.page, per_page: p.perPage });
  });

  r.get('/:id', can(M, 'view'), async (req, res) => {
    const { rows } = await query(
      `SELECT c.*, ${balanceSql}, pl.name AS price_list_name FROM contacts c
         LEFT JOIN price_lists pl ON pl.id = c.price_list_id
        WHERE c.org_id = $1 AND c.id = $2 AND c.contact_type = $3`,
      [req.orgId, Number(req.params.id), type],
    );
    if (!rows[0]) throw notFound(label);
    const { rows: persons } = await query('SELECT * FROM contact_persons WHERE contact_id = $1 ORDER BY id', [rows[0].id]);
    res.json({ ...safe(rows[0]), contact_persons: persons });
  });

  async function parse(b, req, existing = null) {
    const gstTreatment = b.gst_treatment ? oneOf(b.gst_treatment, GST_TREATMENTS, { field: 'GST treatment' }) : null;
    const gstin = str(b.gstin, { field: 'GSTIN', max: 15 });
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin.toUpperCase())) throw badRequest('GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)');
    if (['registered', 'registered_composition', 'sez'].includes(gstTreatment) && !gstin) throw badRequest('GSTIN is required for this GST treatment');
    const pan = str(b.pan, { field: 'PAN', max: 10 });
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) throw badRequest('PAN must be in the format ABCDE1234F');
    const priceListId = id(b.price_list_id, { field: 'Price list' });
    if (priceListId) {
      const { rows } = await query('SELECT 1 FROM price_lists WHERE org_id = $1 AND id = $2', [req.orgId, priceListId]);
      if (!rows[0]) throw badRequest('Select a valid price list');
    }
    const company = str(b.company_name, { field: 'Company name', max: 200 });
    const first = str(b.first_name, { field: 'First name', max: 100 });
    const last = str(b.last_name, { field: 'Last name', max: 100 });
    const display = str(b.display_name, { field: 'Display name', max: 200 }) || company || [first, last].filter(Boolean).join(' ');
    if (!display) throw badRequest('Display name is required');
    // MSME / Udyam registration (vendors): payments to MSMEs are due within 45 days under the MSMED Act.
    const msme = type === 'vendor' && bool(b.msme_registered);
    const udyam = msme ? (str(b.udyam_number, { field: 'Udyam registration number', max: 30 }) || '').toUpperCase() : null;
    if (msme && udyam && !/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(udyam)) throw badRequest('Udyam number must look like UDYAM-TN-02-0012345');
    return {
      msme_registered: msme,
      msme_type: msme ? oneOf(b.msme_type, ['micro', 'small', 'medium'], { field: 'MSME type', def: 'micro' }) : null,
      udyam_number: udyam || null,
      customer_type: oneOf(b.customer_type, ['business', 'individual'], { field: 'Customer type', def: 'business' }),
      salutation: str(b.salutation, { field: 'Salutation', max: 10 }),
      first_name: first, last_name: last, company_name: company, display_name: display,
      email: email(b.email),
      phone: str(b.phone, { field: 'Phone', max: 30 }),
      mobile: str(b.mobile, { field: 'Mobile', max: 30 }),
      website: str(b.website, { field: 'Website', max: 200 }),
      pan: pan ? pan.toUpperCase() : null,
      gst_treatment: gstTreatment,
      gstin: gstin ? gstin.toUpperCase() : null,
      place_of_supply: str(b.place_of_supply, { field: 'Place of supply', max: 60 }),
      currency: await assertCurrencyAllowed({ query }, req.orgId, str(b.currency, { field: 'Currency', max: 3 })),
      payment_terms: int(b.payment_terms, { field: 'Payment terms', min: 0, max: 365, def: 0 }),
      credit_limit: num(b.credit_limit, { field: 'Credit limit', min: 0 }),
      price_list_id: priceListId,
      billing_address: JSON.stringify(obj(b.billing_address)),
      shipping_address: JSON.stringify(obj(b.shipping_address)),
      notes: str(b.notes, { field: 'Remarks', max: 5000 }),
      status: oneOf(b.status, ['active', 'inactive'], { field: 'Status', def: 'active' }),
      custom_fields: JSON.stringify(await parseCustomFields({ query }, req.orgId, type, cfInput(b), existing?.custom_fields)),
    };
  }

  async function savePersons(client, contactId, persons) {
    await client.query('DELETE FROM contact_persons WHERE contact_id = $1', [contactId]);
    for (const p of Array.isArray(persons) ? persons : []) {
      const name = str(p.name, { field: 'Contact person name', max: 120 });
      if (!name) continue;
      await client.query(
        'INSERT INTO contact_persons (contact_id, name, email, phone, designation) VALUES ($1, $2, $3, $4, $5)',
        [contactId, name, email(p.email, { field: 'Contact person email' }), str(p.phone, { field: 'Phone', max: 30 }), str(p.designation, { field: 'Designation', max: 100 })],
      );
    }
  }

  r.post('/', can(M, 'create'), async (req, res) => {
    const v = await parse(req.body || {}, req);
    const created = await tx(async (client) => {
      const keys = Object.keys(v);
      const { rows } = await client.query(
        `INSERT INTO contacts (org_id, contact_type, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
        [req.orgId, type, ...keys.map((k) => v[k])],
      );
      await savePersons(client, rows[0].id, req.body.contact_persons);
      await audit(client, req, 'create', type, rows[0].id, `${label} ${rows[0].display_name} created`);
      return rows[0];
    });
    res.status(201).json(safe(created));
  });

  r.put('/:id', can(M, 'edit'), async (req, res) => {
    const { rows: [current] } = await query('SELECT custom_fields, currency FROM contacts WHERE org_id = $1 AND id = $2', [req.orgId, Number(req.params.id)]);
    const v = await parse(req.body || {}, req, current);
    if (current && v.currency !== current.currency) {
      // Changing currency would mix currencies on one contact's invoices, payments and credits.
      const { rows: used } = await query(
        `SELECT 1 FROM (SELECT contact_id FROM invoices UNION ALL SELECT contact_id FROM bills UNION ALL SELECT contact_id FROM sales_orders
           UNION ALL SELECT contact_id FROM purchase_orders UNION ALL SELECT contact_id FROM estimates UNION ALL SELECT contact_id FROM credit_notes
           UNION ALL SELECT contact_id FROM vendor_credits UNION ALL SELECT contact_id FROM payments_received UNION ALL SELECT contact_id FROM payments_made) x
          WHERE contact_id = $1 LIMIT 1`, [Number(req.params.id)]);
      if (used.length) throw conflict(`The currency can't be changed because ${current.currency} transactions exist for this contact. Create a new contact for ${v.currency}.`);
    }
    const updated = await tx(async (client) => {
      const keys = Object.keys(v);
      const { rows } = await client.query(
        `UPDATE contacts SET ${keys.map((k, i) => `${k} = $${i + 4}`).join(', ')}, updated_at = now()
          WHERE org_id = $1 AND id = $2 AND contact_type = $3 RETURNING *`,
        [req.orgId, Number(req.params.id), type, ...keys.map((k) => v[k])],
      );
      if (!rows[0]) throw notFound(label);
      if (req.body.contact_persons !== undefined) await savePersons(client, rows[0].id, req.body.contact_persons);
      await audit(client, req, 'update', type, rows[0].id, `${label} ${rows[0].display_name} updated`);
      return rows[0];
    });
    res.json(safe(updated));
  });

  r.post('/:id/status', can(M, 'edit'), async (req, res) => {
    const status = oneOf(req.body?.status, ['active', 'inactive'], { field: 'Status' });
    const { rows } = await query(
      'UPDATE contacts SET status = $4, updated_at = now() WHERE org_id = $1 AND id = $2 AND contact_type = $3 RETURNING id, display_name, status',
      [req.orgId, Number(req.params.id), type, status],
    );
    if (!rows[0]) throw notFound(label);
    await audit({ query }, req, 'update', type, rows[0].id, `${label} ${rows[0].display_name} marked ${status}`);
    res.json(rows[0]);
  });

  r.delete('/:id', can(M, 'delete'), async (req, res) => {
    const cid = Number(req.params.id);
    const tables = ['sales_orders', 'invoices', 'payments_received', 'credit_notes', 'purchase_orders', 'bills', 'payments_made', 'vendor_credits', 'packages', 'sales_returns', 'purchase_receives'];
    for (const t of tables) {
      const { rows } = await query(`SELECT 1 FROM ${t} WHERE contact_id = $1 LIMIT 1`, [cid]);
      if (rows.length) throw conflict(`This ${label.toLowerCase()} has transactions and cannot be deleted. Mark it inactive instead.`);
    }
    const { rows } = await query('DELETE FROM contacts WHERE org_id = $1 AND id = $2 AND contact_type = $3 RETURNING display_name', [req.orgId, cid, type]);
    if (!rows[0]) throw notFound(label);
    await query('DELETE FROM documents WHERE org_id = $1 AND entity_type = $2 AND entity_id = $3', [req.orgId, type, cid]);
    await audit({ query }, req, 'delete', type, cid, `${label} ${rows[0].display_name} deleted`);
    res.status(204).end();
  });

  // Bulk import: body { rows: [{ display_name, company_name, email, ... }] }
  r.post('/import', can(M, 'import'), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) throw badRequest('No rows to import');
    if (rows.length > 5000) throw badRequest('Import at most 5000 rows at a time');
    const errors = [];
    let imported = 0;
    await tx(async (client) => {
      for (const [i, raw] of rows.entries()) {
        await client.query('SAVEPOINT row_sp');
        try {
          const b = {
            ...raw,
            billing_address: { attention: raw.billing_attention, street1: raw.billing_street1, street2: raw.billing_street2, city: raw.billing_city, state: raw.billing_state, zip: raw.billing_zip, country: raw.billing_country, phone: raw.billing_phone },
            shipping_address: { attention: raw.shipping_attention, street1: raw.shipping_street1, street2: raw.shipping_street2, city: raw.shipping_city, state: raw.shipping_state, zip: raw.shipping_zip, country: raw.shipping_country, phone: raw.shipping_phone },
          };
          const v = await parse(b, req);
          const keys = Object.keys(v);
          await client.query(
            `INSERT INTO contacts (org_id, contact_type, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, k) => `$${k + 3}`).join(', ')})`,
            [req.orgId, type, ...keys.map((k) => v[k])],
          );
          await client.query('RELEASE SAVEPOINT row_sp');
          imported += 1;
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT row_sp');
          errors.push({ row: i + 2, error: err.message });
        }
      }
      await audit(client, req, 'import', type, null, `${imported} ${label.toLowerCase()}s imported`);
    });
    res.json({ imported, errors });
  });

  return r;
}
