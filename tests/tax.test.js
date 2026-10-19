import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectiveResidentialRate, cityTaxDefault } from '../js/tax.js';

const data = JSON.parse(await readFile(new URL('../data/tax-rates.json', import.meta.url), 'utf8'));
const boundaries = JSON.parse(await readFile(new URL('../data/boundaries.geojson', import.meta.url), 'utf8'));

test('effectiveResidentialRate applies the 45% primary-residence exemption', () => {
  // Bountiful tax area 001, 2025 final adopted total levy.
  assert.ok(Math.abs(effectiveResidentialRate(0.010043) - 0.00552365) < 1e-12);
  assert.equal(effectiveResidentialRate(0), 0);
});

test('cityTaxDefault converts levies to percent of market value', () => {
  const fixture = { taxYear: 2025, cities: { Testville: { county: 'Davis', taxAreas: 3, medianLevy: 0.01, minLevy: 0.009, maxLevy: 0.0112 } } };
  assert.deepEqual(cityTaxDefault(fixture, 'Testville'), {
    name: 'Testville', county: 'Davis', ratePct: 0.55, minPct: 0.495, maxPct: 0.616, taxAreas: 3, taxYear: 2025,
  });
  assert.equal(cityTaxDefault(fixture, 'Nowhere'), null);
  assert.equal(cityTaxDefault(null, 'Testville'), null);
});

test('tax data records its source and year', () => {
  assert.match(data.source, /Utah State Tax Commission/);
  assert.match(data.sourceUrl, /^https:\/\/files\.tax\.utah\.gov\//);
  assert.equal(typeof data.taxYear, 'number');
});

test('every map city has a rate or is listed as having no city levy', () => {
  const names = boundaries.features.filter((f) => f.properties.kind === 'city').map((f) => f.properties.name);
  for (const n of names) {
    assert.ok(n in data.cities || data.noCityLevy.some((m) => m.name === n), `${n} missing from tax data`);
  }
});

test('city rates are internally consistent and plausible for Utah', () => {
  for (const [name, c] of Object.entries(data.cities)) {
    assert.ok(c.minLevy <= c.medianLevy && c.medianLevy <= c.maxLevy, `${name} median outside its range`);
    const d = cityTaxDefault(data, name);
    assert.ok(d.ratePct > 0.3 && d.ratePct < 1, `${name} effective rate ${d.ratePct}% looks wrong`);
  }
});
