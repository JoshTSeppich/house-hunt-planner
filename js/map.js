// Weber and Davis County base map. MapLibre loads only when the map scrolls
// near the viewport, so the calculator never waits on (or depends on) it.

const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_BASE = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
// Fallback view (roughly Ogden to Kaysville) until the county outlines load.
const CENTER = [-111.96, 41.1];
const ZOOM = 9.4;
const LOAD_TIMEOUT_MS = 15000;
const BOUNDARIES_URL = 'data/boundaries.geojson';
const BOUNDARIES_ATTRIBUTION = 'Boundaries © <a href="https://gis.utah.gov/">UGRC</a>, CC BY 4.0';

const container = document.getElementById('area-map');
const status = document.getElementById('map-status');

const theme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function fail(reason) {
  container.hidden = true;
  status.hidden = false;
  status.textContent = `The map couldn't load (${reason}). Everything else on this page still works.`;
}

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error(`could not fetch ${attrs.src || attrs.href}`));
    document.head.append(el);
  });
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// City and county outlines plus names, all in one neutral style. Base-map
// place labels inside the two counties are hidden so names don't double up.
function addBoundaries(map, data) {
  const line = cssVar('--muted');
  const text = cssVar('--text');
  const halo = cssVar('--surface');
  const kind = (k) => ['==', ['get', 'kind'], k];

  map.addSource('boundaries', { type: 'geojson', data, attribution: BOUNDARIES_ATTRIBUTION });
  map.addLayer({ id: 'county-line', type: 'line', source: 'boundaries', filter: kind('county'), paint: { 'line-color': line, 'line-width': 2.5, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'city-line', type: 'line', source: 'boundaries', filter: kind('city'), paint: { 'line-color': line, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 1.6], 'line-dasharray': [3, 2] } });
  map.addLayer({
    id: 'city-label', type: 'symbol', source: 'boundaries', filter: kind('city-label'),
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 15], 'text-max-width': 7 },
    paint: { 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  });
  map.addLayer({
    id: 'county-label', type: 'symbol', source: 'boundaries', filter: kind('county-label'), maxzoom: 11,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 14, 'text-letter-spacing': 0.08, 'text-transform': 'uppercase' },
    paint: { 'text-color': line, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  });

  const counties = {
    type: 'MultiPolygon',
    coordinates: data.features
      .filter((f) => f.properties.kind === 'county')
      .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)),
  };
  for (const layer of map.getStyle().layers) {
    if (layer['source-layer'] !== 'place' || !/city|town|village/.test(layer.id)) continue;
    const outside = ['!', ['within', counties]];
    map.setFilter(layer.id, layer.filter ? ['all', layer.filter, outside] : outside);
  }
}

function countyBounds(data) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of data.features) {
    if (f.properties.kind !== 'county') continue;
    for (const [x, y] of f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2)) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return [[minX, minY], [maxX, maxY]];
}

async function init() {
  const boundaries = fetch(BOUNDARIES_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    await Promise.all([
      loadAsset('link', { rel: 'stylesheet', href: `${MAPLIBRE_BASE}/maplibre-gl.css` }),
      loadAsset('script', { src: `${MAPLIBRE_BASE}/maplibre-gl.js` }),
    ]);
  } catch (e) {
    fail('map library unavailable');
    return;
  }

  let map;
  try {
    map = new window.maplibregl.Map({
      container,
      style: STYLES[theme()],
      center: CENTER,
      zoom: ZOOM,
      minZoom: 7,
      maxZoom: 16,
      attributionControl: false,
      cooperativeGestures: true,
    });
  } catch (e) {
    fail('your browser may not support WebGL');
    return;
  }

  map.addControl(new window.maplibregl.AttributionControl({ compact: false }), 'bottom-right');
  map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Map of Weber and Davis County. Use arrow keys to pan and plus or minus to zoom.');

  let fitted = false;
  map.on('style.load', async () => {
    const data = await boundaries;
    if (!data || map.getSource('boundaries')) return;
    addBoundaries(map, data);
    if (!fitted) {
      fitted = true;
      map.fitBounds(countyBounds(data), { padding: 12, animate: false });
    }
  });

  let loaded = false;
  const timer = setTimeout(() => { if (!loaded) { map.remove(); fail('map tiles timed out'); } }, LOAD_TIMEOUT_MS);
  map.once('load', async () => {
    loaded = true;
    clearTimeout(timer);
    if (await boundaries) status.hidden = true;
    else status.textContent = "City boundaries couldn't load. The base map still works.";
  });
  map.on('error', () => {
    if (loaded) return; // a single missing tile after load isn't worth a banner
    clearTimeout(timer);
    map.remove();
    fail('map tiles unavailable');
  });

  // Follow the page theme.
  let current = theme();
  const sync = () => {
    const next = theme();
    if (next !== current && loaded) { current = next; map.setStyle(STYLES[next], { diff: false }); }
  };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
}

if (container) {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); init(); }
  }, { rootMargin: '300px' });
  io.observe(container);
}
