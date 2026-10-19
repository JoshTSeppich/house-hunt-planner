// Fetches Weber and Davis County city and county boundaries from UGRC and
// writes a simplified GeoJSON file for the map. Run with:
//   node scripts/build-boundaries.mjs
// Source: Utah Geospatial Resource Center (UGRC), CC BY 4.0.

import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services';
const COUNTIES = { '06': 'Davis', '29': 'Weber' };
const OUT = new URL('../data/boundaries.geojson', import.meta.url);

// ~22 m simplification tolerance in degrees; 5 decimals is ~1 m precision.
const SIMPLIFY = 0.0002;
const PRECISION = 5;

async function query(service, where, outFields) {
  const params = new URLSearchParams({
    where,
    outFields,
    outSR: '4326',
    maxAllowableOffset: String(SIMPLIFY),
    geometryPrecision: String(PRECISION),
    f: 'geojson',
  });
  const res = await fetch(`${BASE}/${service}/FeatureServer/0/query?${params}`);
  if (!res.ok) throw new Error(`${service}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${service}: ${json.error.message}`);
  return json.features;
}

const rings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x, y, poly) {
  return inRing(x, y, poly[0]) && !poly.slice(1).some((hole) => inRing(x, y, hole));
}

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

// Label point: the grid point inside the largest polygon that is farthest
// from any edge, so names sit well inside odd-shaped cities.
function labelPoint(geom) {
  const poly = rings(geom).reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const xs = poly[0].map((p) => p[0]);
  const ys = poly[0].map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const steps = 60;
  let best = null;
  let bestD = -1;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (!inPolygon(x, y, poly)) continue;
      let d = Infinity;
      for (const ring of poly) for (let k = 1; k < ring.length; k++) d = Math.min(d, distToSegment(x, y, ring[k - 1], ring[k]));
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best.map((v) => Number(v.toFixed(PRECISION)));
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const cityFeatures = await query(
  'UtahMunicipalBoundaries',
  `COUNTYNBR IN (${Object.keys(COUNTIES).map((c) => `'${c}'`).join(',')})`,
  'NAME,COUNTYNBR',
);
const countyFeatures = await query(
  'UtahCountyBoundaries',
  `COUNTYNBR IN (${Object.keys(COUNTIES).map((c) => `'${c}'`).join(',')})`,
  'NAME,COUNTYNBR',
);

const features = [];
for (const f of countyFeatures) {
  const name = `${titleCase(f.properties.NAME)} County`;
  features.push({ type: 'Feature', properties: { kind: 'county', name }, geometry: f.geometry });
  features.push({ type: 'Feature', properties: { kind: 'county-label', name }, geometry: { type: 'Point', coordinates: labelPoint(f.geometry) } });
}
for (const f of cityFeatures) {
  const county = COUNTIES[f.properties.COUNTYNBR];
  const props = { name: f.properties.NAME, county };
  features.push({ type: 'Feature', properties: { kind: 'city', ...props }, geometry: f.geometry });
  features.push({ type: 'Feature', properties: { kind: 'city-label', ...props }, geometry: { type: 'Point', coordinates: labelPoint(f.geometry) } });
}
features.sort((a, b) => a.properties.kind.localeCompare(b.properties.kind) || a.properties.name.localeCompare(b.properties.name));

const geojson = {
  type: 'FeatureCollection',
  metadata: {
    source: 'Utah Geospatial Resource Center (UGRC): Utah Municipal Boundaries, Utah County Boundaries',
    license: 'CC BY 4.0',
    retrieved: new Date().toISOString().slice(0, 10),
    simplifyToleranceDeg: SIMPLIFY,
  },
  features,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const text = JSON.stringify(geojson);
await writeFile(OUT, text + '\n');
console.log(`Wrote ${features.length} features (${countyFeatures.length} counties, ${cityFeatures.length} cities), ${(text.length / 1024).toFixed(1)} KB`);
