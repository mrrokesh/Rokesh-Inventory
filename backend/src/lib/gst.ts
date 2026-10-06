// GST helpers. Intra-state supply (same state as the organization) → CGST + SGST (half each);
// inter-state supply → IGST.
export function isInterState(orgState, placeOfSupply) {
  if (!orgState || !placeOfSupply) return false;
  return orgState.trim().toLowerCase() !== placeOfSupply.trim().toLowerCase();
}

/** Split a document's tax by rate: [{ rate, taxable, igst, cgst, sgst }] */
export function taxBreakdown(doc, orgState) {
  const inter = isInterState(orgState, doc.place_of_supply);
  const byRate = new Map();
  for (const l of doc.lines || []) {
    const rate = Number(l.tax_rate) || 0;
    if (!rate) continue;
    const taxable = Number(l.amount) * (1 - (Number(doc.discount_percent) || 0) / 100);
    const tax = (taxable * rate) / 100;
    const cur = byRate.get(rate) || { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    cur.taxable += taxable;
    if (inter) cur.igst += tax; else { cur.cgst += tax / 2; cur.sgst += tax / 2; }
    byRate.set(rate, cur);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { inter, rows: [...byRate.values()].map((x) => ({ rate: x.rate, taxable: r2(x.taxable), igst: r2(x.igst), cgst: r2(x.cgst), sgst: r2(x.sgst) })) };
}
