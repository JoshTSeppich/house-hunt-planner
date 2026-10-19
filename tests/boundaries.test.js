import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const FILE = new URL('../data/boundaries.geojson', import.meta.url);
const data = JSON.parse(await readFile(FILE, 'utf8'));
const byKind = (k) => data.features.filter((f) => f.properties.kind === k);

test('boundaries file stays at or under 300 KB', async () => {
  const { size } = await stat(FILE);
  assert.ok(size <= 300 * 1024, `boundaries.geojson is ${(size / 1024).toFixed(1)} KB`);
});

test('records its source and license', () => {
  assert.match(data.metadata.source, /UGRC/);
  assert.equal(data.metadata.license, 'CC BY 4.0');
});

test('has both counties with polygon geometry', () => {
  const counties = byKind('county');
  assert.deepEqual(counties.map((f) => f.properties.name).sort(), ['Davis County', 'Weber County']);
  for (const f of counties) assert.match(f.geometry.type, /^(Multi)?Polygon$/);
  assert.equal(byKind('county-label').length, 2);
});

test('every city has a polygon, a county and exactly one label point', () => {
  const cities = byKind('city');
  const labels = byKind('city-label');
  assert.ok(cities.length >= 25, `only ${cities.length} cities`);
  for (const c of cities) {
    assert.match(c.geometry.type, /^(Multi)?Polygon$/);
    assert.ok(['Davis', 'Weber'].includes(c.properties.county), `${c.properties.name} has county ${c.properties.county}`);
    assert.equal(labels.filter((l) => l.properties.name === c.properties.name).length, 1, `${c.properties.name} label count`);
  }
});

test('all coordinates fall inside a Weber/Davis bounding box', () => {
  const inBox = ([x, y]) => x > -113 && x < -111.3 && y > 40.7 && y < 41.7;
  for (const f of data.features) {
    const pts = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2);
    assert.ok(pts.every(inBox), `${f.properties.kind} ${f.properties.name} has out-of-area coordinates`);
  }
});
