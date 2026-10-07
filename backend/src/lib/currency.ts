// Multi-currency helpers. Amounts on a transaction are in its own currency; `exchange_rate` converts
// them to the organization's base currency (base amount = amount × exchange_rate).
import { badRequest } from './errors.js';

export const CURRENCY_NAMES: Record<string, string> = {
  INR: 'Indian Rupee', USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', AED: 'UAE Dirham', SAR: 'Saudi Riyal', QAR: 'Qatari Riyal',
  OMR: 'Omani Rial', KWD: 'Kuwaiti Dinar', BHD: 'Bahraini Dinar', SGD: 'Singapore Dollar', MYR: 'Malaysian Ringgit', AUD: 'Australian Dollar',
  NZD: 'New Zealand Dollar', CAD: 'Canadian Dollar', JPY: 'Japanese Yen', CNY: 'Chinese Yuan', HKD: 'Hong Kong Dollar', CHF: 'Swiss Franc',
  SEK: 'Swedish Krona', NOK: 'Norwegian Krone', DKK: 'Danish Krone', ZAR: 'South African Rand', LKR: 'Sri Lankan Rupee', NPR: 'Nepalese Rupee',
  BDT: 'Bangladeshi Taka', PKR: 'Pakistani Rupee', THB: 'Thai Baht', IDR: 'Indonesian Rupiah', PHP: 'Philippine Peso', KRW: 'South Korean Won',
  BRL: 'Brazilian Real', MXN: 'Mexican Peso', RUB: 'Russian Ruble', TRY: 'Turkish Lira', KES: 'Kenyan Shilling', NGN: 'Nigerian Naira',
};

export async function baseCurrency(db, orgId) {
  const { rows: [o] } = await db.query('SELECT currency FROM organizations WHERE id = $1', [orgId]);
  return (o?.currency || 'INR').toUpperCase();
}

/**
 * Currency and rate for a transaction with a contact. The transaction uses the contact's currency;
 * the rate comes from the request (if given) or the currency's saved rate.
 */
export async function resolveCurrency(db, orgId, contactCurrency, requestedRate?: any, existing?: any) {
  const base = await baseCurrency(db, orgId);
  const currency = (contactCurrency || base).toUpperCase();
  if (currency === base) return { currency: base, exchange_rate: 1 };
  let rate = requestedRate !== undefined && requestedRate !== null && requestedRate !== '' ? Number(requestedRate) : null;
  if (rate === null && existing && (existing.currency || base) === currency) rate = Number(existing.exchange_rate);
  if (rate === null) {
    const { rows: [c] } = await db.query('SELECT exchange_rate FROM currencies WHERE org_id = $1 AND code = $2', [orgId, currency]);
    if (!c) throw badRequest(`${currency} is not set up. Add it under Settings → Currencies with its exchange rate.`);
    rate = Number(c.exchange_rate);
  }
  if (!(rate > 0) || !Number.isFinite(rate)) throw badRequest('Exchange rate must be more than 0');
  return { currency, exchange_rate: Math.round(rate * 1e6) / 1e6 };
}

/** A contact may only use the base currency or one set up under Settings → Currencies. */
export async function assertCurrencyAllowed(db, orgId, code) {
  const base = await baseCurrency(db, orgId);
  const c = (code || base).toUpperCase();
  if (c === base) return c;
  const { rows } = await db.query('SELECT 1 FROM currencies WHERE org_id = $1 AND code = $2', [orgId, c]);
  if (!rows.length) throw badRequest(`${c} is not set up. Add it under Settings → Currencies first.`);
  return c;
}
