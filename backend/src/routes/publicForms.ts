// Public web forms: anyone with the link can submit. Each submission creates a customer or a
// custom-module record. Protected by a hidden "website" trap field and a per-visitor rate limit.
import { Router } from 'express';
import { query, tx } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { parseCustomFields } from '../lib/customFields.js';
import { baseCurrency } from '../lib/currency.js';
import { emailLayout, esc, sendMail } from '../lib/mailer.js';
import { createRecord, parseRecordData, targetFields } from './customModules.js';

const r = Router();
const hits = new Map();

async function formByToken(token) {
  const { rows: [f] } = await query(
    `SELECT w.*, o.name AS org_name, o.logo_path FROM web_forms w JOIN organizations o ON o.id = w.org_id
      WHERE w.token = $1 AND w.enabled AND o.status IN ('trial', 'active')`,
    [String(token)],
  );
  if (!f) throw notFound('Form');
  return f;
}

r.get('/forms/:token', async (req, res) => {
  const f = await formByToken(req.params.token);
  const available = new Map<string, any>((await targetFields(f.org_id, f.target)).map((x) => [x.key, x]));
  res.json({
    title: f.title || f.name, intro: f.intro, org: { name: f.org_name, logo_path: f.logo_path },
    fields: (f.fields || []).filter((x) => available.has(x.key)).map((x) => ({ ...x, type: available.get(x.key).type, options: available.get(x.key).options || [] })),
  });
});

r.post('/forms/:token', async (req, res) => {
  const f = await formByToken(req.params.token);
  const b = req.body || {};
  // Bots fill every box; people never see this one.
  if (b.website) return res.json({ ok: true, message: f.success_message });
  const key = `${req.ip}:${f.id}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 10 * 60000);
  if (recent.length >= 5) throw new HttpError(429, 'Too many submissions. Please try again in a few minutes.');
  hits.set(key, [...recent, now]);
  if (hits.size > 5000) hits.clear();

  const values = b.values && typeof b.values === 'object' ? b.values : {};
  const fields = f.fields || [];
  const clean = {};
  for (const x of fields) {
    const v = values[x.key];
    const s = typeof v === 'boolean' ? v : String(v ?? '').trim().slice(0, 2000);
    if (x.required && (s === '' || s === false)) throw badRequest(`${x.label} is required`);
    if (s !== '') clean[x.key] = s;
  }

  const created = await tx(async (client) => {
    if (f.target === 'customer') {
      const email = clean['email'] ? String(clean['email']) : null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address');
      const gstin = clean['gstin'] ? String(clean['gstin']).toUpperCase() : null;
      if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw badRequest('GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)');
      const cfInput = Object.fromEntries(Object.entries(clean).filter(([k]) => k.startsWith('cf_')).map(([k, v]) => [k.slice(3), v]));
      const custom = await parseCustomFields(client, f.org_id, 'customer', cfInput);
      const name = String(clean['display_name'] || clean['company_name'] || email || 'Web form enquiry').slice(0, 200);
      const note = [`Submitted through the web form “${f.name}” on ${new Date().toLocaleString('en-IN')}.`, clean['message'] ? `Message: ${clean['message']}` : ''].filter(Boolean).join('\n');
      const { rows: [c] } = await client.query(
        `INSERT INTO contacts (org_id, contact_type, display_name, company_name, email, mobile, gstin, gst_treatment, place_of_supply, currency, billing_address, notes, custom_fields)
         VALUES ($1, 'customer', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, display_name`,
        [f.org_id, name, clean['company_name'] || null, email, clean['mobile'] || null, gstin, gstin ? 'registered' : null, clean['state'] || null,
          await baseCurrency(client, f.org_id), JSON.stringify({ city: clean['city'] || '', state: clean['state'] || '' }), note, JSON.stringify(custom)],
      );
      await audit(client, { orgId: f.org_id, user: null }, 'create', 'customer', c.id, `Customer ${c.display_name} added from the web form “${f.name}”`);
      return { kind: 'customer', id: c.id, label: c.display_name, path: `/customers/${c.id}` };
    }
    const id = Number(/^module:(\d+)$/.exec(f.target)?.[1]);
    const { rows: [mod] } = await client.query('SELECT * FROM custom_modules WHERE org_id = $1 AND id = $2', [f.org_id, id]);
    if (!mod) throw notFound('Form');
    const data = await parseRecordData(client, f.org_id, mod, clean);
    const rec = await createRecord(client, f.org_id, mod, data, { source: 'web_form' });
    await audit(client, { orgId: f.org_id, user: null }, 'create', `cm_${mod.slug}`, rec.id, `${mod.singular} ${rec.number} received from the web form “${f.name}”`);
    return { kind: mod.singular, id: rec.id, label: rec.number, path: `/m/${mod.slug}/${rec.id}` };
  });
  await query('UPDATE web_forms SET submissions = submissions + 1, last_submitted_at = now() WHERE id = $1', [f.id]);

  if (f.notify_email) {
    const rows = fields.filter((x) => clean[x.key] !== undefined).map((x) => `<tr><td style="padding:4px 8px;color:#5a6276">${esc(x.label)}</td><td style="padding:4px 8px">${esc(String(clean[x.key]))}</td></tr>`).join('');
    const { appUrl } = await import('../lib/mailer.js');
    sendMail(f.org_id, {
      to: f.notify_email, subject: `New submission: ${f.name}`,
      html: emailLayout({ orgName: f.org_name, title: `New ${created.kind}: ${created.label}`, intro: `Someone filled in the web form “${f.name}”.`, bodyHtml: `<table>${rows}</table>`, button: { label: 'Open it', url: `${appUrl()}${created.path}` } }),
    }).catch(() => { /* email not set up: the submission is still saved */ });
  }
  res.status(201).json({ ok: true, message: f.success_message });
});

export default r;
