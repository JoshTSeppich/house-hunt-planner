// Builds per-city property tax defaults for Weber and Davis County from the
// Utah State Tax Commission's "Tax Rates by Tax Area" report (Report 600).
// Requires pdftotext (poppler: `brew install poppler`). Run with:
//   node scripts/build-tax-rates.mjs
//
// Each city spans several tax areas (unique mixes of school, fire, water and
// other districts). For each city we keep the median, min and max of the final
// adopted total levy across the tax areas that include that city's levy.

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const YEAR = 2025;
const REPORT_URL = `https://files.tax.utah.gov/propertytax/tax-rates/area-rates/taxarearates${YEAR}.pdf`;
const COUNTIES = ['DAVIS', 'WEBER'];
const OUT = new URL('../data/tax-rates.json', import.meta.url);
const BOUNDARIES = new URL('../data/boundaries.geojson', import.meta.url);

const res = await fetch(REPORT_URL);
if (!res.ok) throw new Error(`Report download failed: HTTP ${res.status}`);
const dir = await mkdtemp(join(tmpdir(), 'hhp-tax-'));
const pdf = join(dir, 'report.pdf');
await writeFile(pdf, Buffer.from(await res.arrayBuffer()));
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();

const reportDate = text.match(/^(\w+ \d{2}, \d{4})\s+Report 600/m)?.[1];

// Parse tax areas: entity lines carry certified, proposed and final rates.
const areas = [];
let county = null;
let area = null;
for (const line of text.split('\n')) {
  const c = line.match(/^\s{20,}([A-Z ]+) COUNTY\s*$/);
  if (c) { county = c[1].trim(); continue; }
  if (!COUNTIES.includes(county)) continue;
  const start = line.match(/^Tax Area (\d+) - (\d+)/);
  if (start) { area = { county, id: `${start[1]}-${start[2]}`, entities: [] }; continue; }
  // Long entity names wrap their rates onto the next line, and a blank
  // certified rate leaves only two numbers. The final rate is always last.
  const rates = (str) => str.match(/\d+\.\d{6}/g) || [];
  const ent = line.match(/^\s+(\d{4})\s+(.+?)((?:\s{2,}\d+\.\d{6})*)\s*$/);
  if (ent && area) {
    const nums = rates(ent[3]);
    const e = { code: ent[1], name: ent[2].trim(), final: nums.length ? Number(nums.at(-1)) : null };
    area.entities.push(e);
    continue;
  }
  const pending = area?.entities.at(-1);
  if (pending && pending.final === null && /^\s+(\d+\.\d{6}\s*)+$/.test(line)) {
    pending.final = Number(rates(line).at(-1));
    continue;
  }
  const total = line.match(/^Total for Tax Area (\d+) - (\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/);
  if (total && area) {
    area.total = Number(total[5]);
    // Some districts are listed with no levy at all; the sum check below
    // still catches any wrapped rate we failed to attach.
    for (const e of area.entities) if (e.final === null) e.final = 0;
    const sum = area.entities.reduce((s, e) => s + e.final, 0);
    if (Math.abs(sum - area.total) > 2e-6) throw new Error(`${county} ${area.id}: levies sum to ${sum}, total says ${area.total}`);
    areas.push(area);
    area = null;
  }
}
if (areas.length < 100) throw new Error(`Only parsed ${areas.length} tax areas; report format may have changed`);

// Match city levies (codes 3xxx) to the city names used on the map.
const boundaries = JSON.parse(await readFile(BOUNDARIES, 'utf8'));
const mapCities = boundaries.features.filter((f) => f.properties.kind === 'city').map((f) => f.properties);
const levyNameFor = (name) => {
  const n = name.toUpperCase();
  return [n, `${n} CITY`, `${n} TOWN`, `CITY OF ${n}`];
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const cities = {};
const missing = [];
for (const { name, county: cty } of mapCities) {
  const candidates = levyNameFor(name);
  const matched = areas.filter((a) => a.county === cty.toUpperCase()
    && a.entities.some((e) => e.code.startsWith('3') && candidates.includes(e.name)));
  if (!matched.length) { missing.push({ name, county: cty }); continue; }
  const totals = matched.map((a) => a.total);
  cities[name] = {
    county: cty,
    taxAreas: matched.length,
    medianLevy: Number(median(totals).toFixed(6)),
    minLevy: Math.min(...totals),
    maxLevy: Math.max(...totals),
  };
}

const out = {
  source: 'Utah State Tax Commission, Property Tax Division: Report 600, Tax Rates by Tax Area',
  sourceUrl: REPORT_URL,
  taxYear: YEAR,
  reportDate,
  note: 'Levies are final adopted totals applied to taxable value. Primary residences are taxed on 55% of market value.',
  cities: Object.fromEntries(Object.entries(cities).sort(([a], [b]) => a.localeCompare(b))),
  noCityLevy: missing.sort((a, b) => a.name.localeCompare(b.name)),
};
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Parsed ${areas.length} tax areas. Wrote ${Object.keys(cities).length} cities.`);
if (missing.length) console.log(`No city levy found for: ${missing.map((m) => m.name).join(', ')}`);
