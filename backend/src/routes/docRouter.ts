// Generic router for priced documents (sales orders, invoices, credit notes,
// purchase orders, bills, vendor credits). Modules add their own actions on top.
import { Router } from 'express';
import { tx, query } from '../db.js';
import { can } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict } from '../lib/errors.js';
import { peekNumber, takeNumber } from '../lib/numbering.js';
import { parseLines, loadTaxRates, computeTotals, insertLines, fetchDoc, getContact, getWarehouse } from '../lib/documents.js';
import { str, num, id, date, today, listParams } from '../lib/validate.js';
import { loadItems } from '../lib/stock.js';
import { cfInput, parseCustomFields } from '../lib/customFields.js';

export function createDocRouter(cfg) {
  const r = Router();
  const M = cfg.module;

  r.get('/', can(M, 'view'), async (req, res) => {
    const p = listParams(req.query, {
      number: 'd.number', date: 'd.doc_date', contact: 'c.display_name', total: 'd.total', status: 'd.status',
      created: 'd.created_at', ...(cfg.hasBalance ? { balance: 'd.balance', due: 'd.due_date' } : {}),
    }, 'created');
    const where = ['d.org_id = $1'];
    const params = [req.orgId];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    const status = req.query.status;
    if (status === 'overdue' && cfg.hasBalance) {
      where.push(`d.status IN ('sent','open','partially_paid') AND d.due_date < CURRENT_DATE`);
    } else if (status === 'unpaid' && cfg.hasBalance) {
      where.push(`d.status IN ('sent','open','partially_paid')`);
    } else if (status) add('d.status = ?', status);
    if (req.query.contact_id) add('d.contact_id = ?', Number(req.query.contact_id));
    if (req.query.from) add('d.doc_date >= ?', req.query.from);
    if (req.query.to) add('d.doc_date <= ?', req.query.to);
    for (const col of cfg.filterCols || []) if (req.query[col]) add(`d.${col} = ?`, Number(req.query[col]));
    if (p.search) {
      params.push(`%${p.search}%`);
      const n = `$${params.length}`;
      where.push(`(d.number ILIKE ${n} OR d.reference ILIKE ${n} OR c.display_name ILIKE ${n})`);
    }
    const whereSql = where.join(' AND ');
    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      query(
        `SELECT d.*, c.display_name AS contact_name ${cfg.listExtraSelect ? `, ${cfg.listExtraSelect}` : ''}
           FROM ${cfg.table} d JOIN contacts c ON c.id = d.contact_id
          WHERE ${whereSql} ORDER BY ${p.orderBy}, d.id DESC LIMIT ${p.perPage} OFFSET ${p.offset}`,
        params,
      ),
      query(`SELECT COUNT(*)::int AS n FROM ${cfg.table} d JOIN contacts c ON c.id = d.contact_id WHERE ${whereSql}`, params),
    ]);
    res.json({ data: rows, total: cnt.n, page: p.page, per_page: p.perPage });
  });

  r.get('/next-number', can(M, 'create'), async (req, res) => {
    res.json({ number: cfg.numberType ? await peekNumber({ query }, req.orgId, cfg.numberType) : '' });
  });

  r.get('/:id', can(M, 'view'), async (req, res) => {
    const doc = await fetchDoc({ query }, cfg, req.orgId, Number(req.params.id));
    if (cfg.enrich) await cfg.enrich({ query }, req, doc);
    res.json(doc);
  });

  async function prepare(client: any, req: any, existing?: any) {
    const b = req.body || {};
    const contactId = id(b.contact_id, { field: cfg.contactType === 'customer' ? 'Customer' : 'Vendor', required: true });
    const contact = await getContact(client, req.orgId, contactId, cfg.contactType);
    const warehouse = await getWarehouse(client, req.orgId, id(b.warehouse_id, { field: 'Warehouse' }));
    const header = {
      contact_id: contactId,
      warehouse_id: warehouse.id,
      reference: str(b.reference, { field: 'Reference', max: 100 }),
      doc_date: date(b.doc_date, { field: 'Date' }) || today(),
      discount_percent: num(b.discount_percent, { field: 'Discount', min: 0, max: 100, def: 0 }),
      shipping_charge: num(b.shipping_charge, { field: 'Shipping charge', min: 0, def: 0 }),
      adjustment: num(b.adjustment, { field: 'Adjustment', def: 0 }),
      place_of_supply: str(b.place_of_supply, { field: 'Place of supply', max: 60 }) || contact.place_of_supply || null,
      notes: str(b.notes, { field: 'Notes', max: 5000 }),
      terms: str(b.terms, { field: 'Terms & Conditions', max: 5000 }),
      ...(cfg.header ? cfg.header(b, contact, existing) : {}),
      custom_fields: await parseCustomFields(client, req.orgId, cfg.entity, cfInput(b), existing?.custom_fields),
    };
    const lines = parseLines(b.lines, { allowNoItem: cfg.allowNoItem !== false, extra: cfg.lineExtra || [] });
    const items = await loadItems(client, req.orgId, lines.map((l) => l.item_id));
    for (const l of lines) {
      const it = l.item_id && items.get(l.item_id);
      if (it && !l.description) l.description = null;
      if (it && it.status !== 'active' && !existing) throw badRequest(`${it.name} is inactive`);
    }
    const taxes = await loadTaxRates(client, req.orgId, lines);
    Object.assign(header, computeTotals(lines, taxes, header));
    if (cfg.hasBalance) header.balance = header.total;
    if (cfg.hasCreditBalance) header.balance = header.total;
    if (cfg.validate) await cfg.validate(client, req, { header, lines, items, contact, existing });
    return { header, lines, contact };
  }

  r.post('/', can(M, 'create'), async (req, res) => {
    const doc = await tx(async (client) => {
      const { header, lines } = await prepare(client, req);
      let number;
      if (cfg.numberType) number = await takeNumber(client, req.orgId, cfg.numberType, req.body.number);
      else number = str(req.body.number, { field: `${cfg.label}#`, required: true, max: 50 });
      const cols = { org_id: req.orgId, number, created_by: req.user.id, ...header };
      const keys = Object.keys(cols);
      const { rows } = await client.query(
        `INSERT INTO ${cfg.table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        keys.map((k) => (typeof cols[k] === 'object' && cols[k] !== null ? JSON.stringify(cols[k]) : cols[k])),
      );
      const docId = rows[0].id;
      await insertLines(client, cfg.linesTable, docId, lines, cfg.lineExtra || []);
      await audit(client, req, 'create', cfg.entity, docId, `${cfg.label} ${number} created`);
      if (cfg.afterCreate) await cfg.afterCreate(client, req, docId, req.body);
      return fetchDoc(client, cfg, req.orgId, docId);
    });
    res.status(201).json(doc);
  });

  r.put('/:id', can(M, 'edit'), async (req, res) => {
    const doc = await tx(async (client) => {
      const existing = await fetchDoc(client, cfg, req.orgId, Number(req.params.id), { lock: true });
      if (existing.status !== 'draft') throw conflict(`Only draft ${cfg.label.toLowerCase()}s can be edited. Void it and create a new one instead.`);
      const { header, lines } = await prepare(client, req, existing);
      if (req.body.number && String(req.body.number).trim() !== existing.number) header.number = String(req.body.number).trim();
      const keys = Object.keys(header);
      await client.query(
        `UPDATE ${cfg.table} SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [req.orgId, existing.id, ...keys.map((k) => (typeof header[k] === 'object' && header[k] !== null ? JSON.stringify(header[k]) : header[k]))],
      );
      await client.query(`DELETE FROM ${cfg.linesTable} WHERE doc_id = $1`, [existing.id]);
      await insertLines(client, cfg.linesTable, existing.id, lines, cfg.lineExtra || []);
      await audit(client, req, 'update', cfg.entity, existing.id, `${cfg.label} ${existing.number} updated`);
      return fetchDoc(client, cfg, req.orgId, existing.id);
    });
    res.json(doc);
  });

  r.delete('/:id', can(M, 'delete'), async (req, res) => {
    await tx(async (client) => {
      const existing = await fetchDoc(client, cfg, req.orgId, Number(req.params.id), { lock: true });
      if (existing.status !== 'draft') throw conflict(`Only draft ${cfg.label.toLowerCase()}s can be deleted. Use Void instead.`);
      await client.query(`DELETE FROM ${cfg.table} WHERE id = $1`, [existing.id]);
      await client.query('DELETE FROM documents WHERE org_id = $1 AND entity_type = $2 AND entity_id = $3', [req.orgId, cfg.entity, existing.id]);
      await audit(client, req, 'delete', cfg.entity, existing.id, `${cfg.label} ${existing.number} deleted`);
    });
    res.status(204).end();
  });

  return r;
}
