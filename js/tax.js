// Pure property-tax helpers. No DOM — safe to import in Node tests.

// Utah taxes a primary residence on 55% of its market value (45% exemption).
export const PRIMARY_RESIDENCE_TAXABLE_SHARE = 0.55;

/** Annual tax as a share of market value for an owner-occupied home. */
export function effectiveResidentialRate(levy) {
  return levy * PRIMARY_RESIDENCE_TAXABLE_SHARE;
}

/**
 * Default tax rate for a city from data/tax-rates.json, as percentages of
 * market value rounded to 3 decimals. Null when the city has no published levy.
 */
export function cityTaxDefault(data, name) {
  const c = data?.cities?.[name];
  if (!c) return null;
  const pct = (levy) => Number((effectiveResidentialRate(levy) * 100).toFixed(3));
  return {
    name,
    county: c.county,
    ratePct: pct(c.medianLevy),
    minPct: pct(c.minLevy),
    maxPct: pct(c.maxLevy),
    taxAreas: c.taxAreas,
    taxYear: data.taxYear,
  };
}
