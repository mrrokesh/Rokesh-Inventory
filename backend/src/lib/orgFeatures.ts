import { query } from '../db.js';
import { forbidden } from './errors.js';

/** Optional modules an organization can turn on or off (Configure Features). */
export const ORG_FEATURES = [
  { key: 'retainer_invoices', name: 'Retainer Invoices', blurb: 'Collect advances from customers and apply unused amounts to invoices later.' },
  { key: 'picklists', name: 'Picklists', blurb: 'Create picklists from sales orders so warehouse staff can pick items before packing.' },
  { key: 'stock_counts', name: 'Stock Counts', blurb: 'Count physical stock and post the difference as an inventory adjustment.' },
  { key: 'price_lists', name: 'Price List', blurb: 'Maintain customer or volume price lists instead of a single selling price.' },
  { key: 'delivery_challans', name: 'Delivery Challans', blurb: 'Dispatch goods on approval or for job work before you raise an invoice.' },
  { key: 'locations', name: 'Locations', blurb: 'Track stock across warehouses (locations) and move goods with transfer orders.' },
];

export const DEFAULT_ORG_FEATURES = Object.fromEntries(ORG_FEATURES.map((f) => [f.key, true]));

export function mergeFeatures(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_ORG_FEATURES };
  for (const f of ORG_FEATURES) {
    if (src[f.key] === false) out[f.key] = false;
    else if (src[f.key] === true) out[f.key] = true;
  }
  return out;
}

export function featureOn(raw, key) {
  return mergeFeatures(raw)[key] !== false;
}

export function requireFeature(key) {
  return async (req, _res, next) => {
    try {
      const { rows } = await query('SELECT features FROM organizations WHERE id = $1', [req.orgId]);
      if (!featureOn(rows[0]?.features, key)) {
        throw forbidden('This feature is turned off. Enable it in Settings → Features.');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
