// Weber and Davis County base map. MapLibre loads only when the map scrolls
// near the viewport, so the calculator never waits on (or depends on) it.

const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_BASE = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
// Roughly Ogden to Kaysville, so both counties fit on first view.
const CENTER = [-111.96, 41.1];
const ZOOM = 9.4;
const LOAD_TIMEOUT_MS = 15000;

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

async function init() {
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

  let loaded = false;
  const timer = setTimeout(() => { if (!loaded) { map.remove(); fail('map tiles timed out'); } }, LOAD_TIMEOUT_MS);
  map.once('load', () => { loaded = true; clearTimeout(timer); status.hidden = true; });
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
    if (next !== current && loaded) { current = next; map.setStyle(STYLES[next]); }
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
