import {
  CREDIT_BANDS,
  budgetTiers,
  equitySchedule,
  rateForCredit,
  totalMonthlyCost,
} from './mortgage.js';
import { cityTaxDefault } from './tax.js';

// Editable default. Update both values together.
const MARKET_RATE = 7.4; // Freddie Mac PMMS 30-year fixed average
const MARKET_RATE_DATE = 'Oct 15, 2026';
const CLOSING_COST_RATE = 0.03;
const STORAGE_KEY = 'hhp-state-v1';
const TAX_DATA_URL = 'data/tax-rates.json';

const DEFAULTS = {
  takeHome: 6000,
  savings: 40000,
  debts: 400,
  credit: 'good',
  tier: 'comfortable',
  rate: null, // null = follow market rate + credit adjustment
  price: null,
  down: null,
  loanType: 'conventional',
  taxRate: 0.6,
  taxCity: '', // city whose published rate set taxRate
  taxCustom: false, // true once the user edits taxRate by hand
  insRate: 0.35,
  hoa: 0,
  appreciation: 3,
};

const $ = (id) => document.getElementById(id);
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (n, d = 0) => `${(n * 100).toFixed(d)}%`;

let state = load();
let taxData = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved };
  } catch (e) { /* storage unavailable */ }
  return { ...DEFAULTS };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

const effectiveRate = () => (state.rate ?? rateForCredit(MARKET_RATE / 100, state.credit) * 100);

function loanOpts() {
  return {
    rate: effectiveRate() / 100,
    taxRate: state.taxRate / 100,
    insuranceRate: state.insRate / 100,
    hoa: state.hoa,
    creditBand: state.credit,
    loanType: state.loanType,
    closingCostRate: CLOSING_COST_RATE,
  };
}

function computeTiers() {
  return budgetTiers({ takeHome: state.takeHome, savings: state.savings, debts: state.debts, ...loanOpts() });
}

// Snap the scenario to the selected tier's price and down payment.
function applyTier(tiers) {
  const t = tiers.find((x) => x.key === state.tier) || tiers[0];
  state.price = Math.max(50000, Math.floor(t.price / 1000) * 1000);
  state.down = Math.min(state.price, Math.floor(Math.max(0, state.savings - state.price * CLOSING_COST_RATE) / 1000) * 1000);
}

function renderTiers(tiers) {
  $('tiers').replaceChildren(...tiers.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.key = t.key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(t.key === state.tier));
    b.tabIndex = t.key === state.tier ? 0 : -1;
    b.innerHTML = `
      <span class="tier-label">${t.label}</span>
      <span class="tier-price">${t.price > 0 ? usd(Math.floor(t.price / 1000) * 1000) : '—'}</span>
      <span class="tier-meta">${t.price > 0 ? `${usd(t.monthly)}/mo · ${pct(t.pctOfTakeHome)} of take-home` : 'Debts already use this share of take-home'}</span>`;
    b.addEventListener('click', () => selectTier(t.key));
    return b;
  }));
}

function selectTier(key) {
  state.tier = key;
  const tiers = computeTiers();
  applyTier(tiers);
  render(tiers);
  $('tiers').querySelector(`[data-key="${key}"]`)?.focus();
}

// Arrow keys move between tiers, per the ARIA radio group pattern.
$('tiers').addEventListener('keydown', (e) => {
  const keys = ['comfortable', 'stretch', 'risky'];
  const i = keys.indexOf(state.tier);
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selectTier(keys[(i + 1) % 3]); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selectTier(keys[(i + 2) % 3]); }
});

const SEGMENTS = [
  ['principal', 'Principal', '--seg-principal'],
  ['interest', 'Interest', '--seg-interest'],
  ['tax', 'Property tax', '--seg-tax'],
  ['insurance', 'Insurance', '--seg-insurance'],
  ['pmi', 'PMI / MIP', '--seg-pmi'],
  ['hoa', 'HOA', '--muted'],
];

function renderPayment(cost) {
  $('hero-total').textContent = `${usd(cost.total)}/mo`;
  const share = state.takeHome > 0 ? (cost.total + state.debts) / state.takeHome : 0;
  $('hero-sub').textContent = `${pct(cost.total / (state.takeHome || 1))} of take-home · ${pct(share)} with your other debts`;

  const parts = SEGMENTS.filter(([k]) => cost[k] > 0.5);
  $('bar').replaceChildren(...parts.map(([k, , v]) => {
    const s = document.createElement('span');
    s.style.flexBasis = `${(cost[k] / cost.total) * 100}%`;
    s.style.background = `var(${v})`;
    return s;
  }));
  $('bar').setAttribute('aria-label', 'Payment breakdown: ' + parts.map(([k, label]) => `${label} ${usd(cost[k])}`).join(', '));

  $('legend').replaceChildren(...SEGMENTS.filter(([k]) => k !== 'hoa' || cost.hoa > 0).map(([k, label, v]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:var(${v})"></span>${label}<span class="value">${usd(cost[k])}</span>`;
    return li;
  }));
}

function renderSliders(cost) {
  const rate = effectiveRate();
  $('rate').value = rate;
  $('rate-out').textContent = `${rate.toFixed(2)}%`;
  $('rate').setAttribute('aria-valuetext', `${rate.toFixed(2)} percent`);
  const adj = CREDIT_BANDS[state.credit].rateAdjust * 100;
  $('rate-note').textContent = state.rate == null
    ? `Market average ${MARKET_RATE.toFixed(2)}% (Freddie Mac, rate as of ${MARKET_RATE_DATE})${adj ? `, plus ${adj.toFixed(2)}% for your credit range` : ''}.`
    : `You set this. Market average was ${MARKET_RATE.toFixed(2)}% (rate as of ${MARKET_RATE_DATE}).`;
  $('rate-reset').hidden = state.rate == null;

  $('price').max = Math.max(1200000, state.price);
  $('price').value = state.price;
  $('price-out').textContent = usd(state.price);
  $('price').setAttribute('aria-valuetext', usd(state.price));

  $('down').max = state.price;
  $('down').value = state.down;
  const downPct = state.down / state.price;
  $('down-out').textContent = `${usd(state.down)} (${pct(downPct, 1)})`;
  $('down').setAttribute('aria-valuetext', `${usd(state.down)}, ${pct(downPct, 1)} of price`);

  const cashNeeded = state.down + state.price * CLOSING_COST_RATE;
  const min = state.loanType === 'fha' ? 0.035 : 0.03;
  const notes = [];
  if (downPct < min) notes.push(`${state.loanType === 'fha' ? 'FHA' : 'Conventional'} loans usually need at least ${pct(min, 1)} down.`);
  if (cashNeeded > state.savings) notes.push(`With ~3% closing costs you'd need ${usd(cashNeeded)}, more than your ${usd(state.savings)} savings.`);
  if (state.loanType === 'conventional' && cost.pmi > 0) notes.push('Under 20% down adds PMI until you reach 78% of the original price.');
  $('down-note').textContent = notes.join(' ');
  $('down-note').classList.toggle('note-warn', notes.length > 0 && (downPct < min || cashNeeded > state.savings));

  document.querySelectorAll('input[name="loanType"]').forEach((r) => { r.checked = r.value === state.loanType; });
}

function renderEquity() {
  const { points, pmiDropMonth } = equitySchedule({
    price: state.price,
    downPayment: state.down,
    rate: effectiveRate() / 100,
    appreciation: state.appreciation / 100,
    loanType: state.loanType,
  });
  const chart = $('equity-chart');
  const W = Math.round(Math.max(320, Math.min(640, chart.clientWidth || 640)));
  const H = W < 480 ? 260 : 300, L = 56, R = 12, T = 16, B = 36;
  chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const maxY = Math.max(...points.map((p) => p.homeValue)) * 1.05;
  const x = (yr) => L + (yr / 30) * (W - L - R);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  const line = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const area = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)},${y(p.homeValue).toFixed(1)}`).join('')
    + [...points].reverse().map((p) => `L${x(p.year).toFixed(1)},${y(p.balance).toFixed(1)}`).join('') + 'Z';

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const short = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`);
  let svg = ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`).join('');
  svg += (W < 480 ? [0, 10, 20, 30] : [0, 5, 10, 15, 20, 25, 30]).map((yr) => `<text x="${x(yr)}" y="${H - 12}" text-anchor="${yr === 30 ? 'end' : yr === 0 ? 'start' : 'middle'}">${yr === 0 ? 'Now' : `Yr ${yr}`}</text>`).join('');
  svg += `<path class="equity-area" d="${area}"/><path class="value-line" d="${line('homeValue')}"/><path class="balance-line" d="${line('balance')}"/>`;
  for (const yr of [5, 10]) {
    const p = points[yr];
    svg += `<line class="marker" x1="${x(yr)}" x2="${x(yr)}" y1="${T}" y2="${H - B}"/><text class="marker-label" x="${x(yr) + 4}" y="${T + 12 + (yr === 10 ? 16 : 0)}">${short(p.equity)} equity</text>`;
  }
  let pmiText = '';
  if (pmiDropMonth > 0) {
    const yr = pmiDropMonth / 12;
    svg += `<line class="pmi-marker" x1="${x(yr)}" x2="${x(yr)}" y1="${T + 44}" y2="${H - B}"/><text class="pmi-label" x="${x(yr) + 4}" y="${T + 58}">${state.loanType === 'fha' ? 'MIP' : 'PMI'} ends</text>`;
    pmiText = ` ${state.loanType === 'fha' ? 'FHA MIP' : 'PMI'} ends after about ${yr.toFixed(1)} years.`;
  } else if (pmiDropMonth === null) {
    pmiText = ' With under 10% down, FHA MIP stays for the life of the loan unless you refinance.';
  }
  chart.innerHTML = svg;
  $('equity-summary').textContent = `If the home grows ${state.appreciation}% a year: about ${usd(points[5].equity)} equity at 5 years and ${usd(points[10].equity)} at 10 years.${pmiText} Selling costs (often 6–8%) would come out of that.`;
}

function render(tiers = computeTiers()) {
  if (state.price == null || state.down == null) applyTier(tiers);
  const cost = totalMonthlyCost({ ...loanOpts(), price: state.price, downPayment: state.down });
  renderTiers(tiers);
  renderPayment(cost);
  renderSliders(cost);
  renderEquity();
  renderTaxNotes();
  save();
}

function initInputs() {
  const fields = { takeHome: 'takeHome', savings: 'savings', debts: 'debts', taxRate: 'taxRate', insRate: 'insRate', hoa: 'hoa', appreciation: 'appreciation' };
  const profileFields = new Set(['takeHome', 'savings', 'debts']);
  for (const [key, id] of Object.entries(fields)) {
    const el = $(id);
    el.value = state[key];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      state[key] = Number.isFinite(v) ? Math.max(key === 'appreciation' ? -20 : 0, v) : 0;
      if (key === 'taxRate' && state.taxCity) state.taxCustom = true;
      const tiers = computeTiers();
      if (profileFields.has(key)) applyTier(tiers);
      render(tiers);
    });
  }
  $('credit').value = state.credit;
  $('credit').addEventListener('change', () => {
    state.credit = $('credit').value;
    state.rate = null;
    const tiers = computeTiers();
    applyTier(tiers);
    render(tiers);
  });
  $('rate').addEventListener('input', () => { state.rate = parseFloat($('rate').value); render(); });
  $('rate-reset').addEventListener('click', () => { state.rate = null; render(); $('rate').focus(); });
  $('price').addEventListener('input', () => {
    state.price = parseFloat($('price').value);
    state.down = Math.min(state.down, state.price);
    render();
  });
  $('down').addEventListener('input', () => { state.down = parseFloat($('down').value); render(); });
  document.querySelectorAll('input[name="loanType"]').forEach((r) => r.addEventListener('change', () => {
    state.loanType = r.value;
    render();
  }));
}

function renderTaxNotes() {
  const cityNote = $('city-tax-note');
  const taxNote = $('tax-note');
  const d = taxData && state.taxCity ? cityTaxDefault(taxData, state.taxCity) : null;
  $('taxCity').value = state.taxCity;
  if (!state.taxCity) {
    cityNote.textContent = '';
    taxNote.textContent = 'Weber and Davis County homes often land near 0.5–0.7%. Pick a city in section 6 to use its rate.';
    return;
  }
  if (!taxData) {
    cityNote.textContent = "City tax rates couldn't load, so your own rate is used.";
    taxNote.textContent = cityNote.textContent;
    return;
  }
  if (!d) {
    cityNote.textContent = `${state.taxCity} isn't in the ${taxData.taxYear} state tax-rate report, so the current rate (${state.taxRate}%) stays. You can edit it under Assumptions.`;
    taxNote.textContent = cityNote.textContent;
    return;
  }
  const range = d.minPct === d.maxPct ? '' : ` It ranges from ${d.minPct}% to ${d.maxPct}% depending on the exact address.`;
  const source = `Typical ${d.taxYear} rate across ${d.taxAreas} tax area${d.taxAreas === 1 ? '' : 's'}, from the Utah State Tax Commission. Homes you live in are taxed on 55% of value.`;
  if (state.taxCustom) {
    cityNote.innerHTML = `You set property tax to ${state.taxRate}%. ${state.taxCity}'s typical rate is ${d.ratePct}%. <button type="button" class="link" id="tax-use-city">Use ${d.ratePct}%</button>`;
    $('tax-use-city').addEventListener('click', () => selectTaxCity(state.taxCity));
  } else {
    cityNote.textContent = `Property tax set to ${d.ratePct}% of price for ${d.name}.${range} ${source}`;
  }
  taxNote.textContent = state.taxCustom ? `Your own rate. ${state.taxCity}'s typical rate is ${d.ratePct}%.` : `From ${d.name} (${d.taxYear} rates). Edit to override.`;
}

function selectTaxCity(name) {
  state.taxCity = name;
  state.taxCustom = false;
  const d = taxData && name ? cityTaxDefault(taxData, name) : null;
  if (d) {
    state.taxRate = d.ratePct;
    $('taxRate').value = d.ratePct;
  }
  const tiers = computeTiers();
  render(tiers);
  document.dispatchEvent(new CustomEvent('hhp:tax-city', { detail: { name } }));
}

async function initTaxCities() {
  try {
    const res = await fetch(TAX_DATA_URL);
    if (res.ok) taxData = await res.json();
  } catch (e) { /* offline or missing: fall back to the user's own rate */ }
  const select = $('taxCity');
  if (taxData) {
    const byCounty = {};
    for (const [name, c] of Object.entries(taxData.cities)) (byCounty[c.county] ??= []).push(name);
    for (const { name, county } of taxData.noCityLevy || []) (byCounty[county] ??= []).push(name);
    for (const county of Object.keys(byCounty).sort()) {
      const group = document.createElement('optgroup');
      group.label = `${county} County`;
      for (const name of byCounty[county].sort()) group.append(new Option(name, name));
      select.append(group);
    }
  } else {
    select.disabled = true;
  }
  select.addEventListener('change', () => selectTaxCity(select.value));
  // Refresh a saved city's rate in case the data was updated since.
  if (state.taxCity && !state.taxCustom) selectTaxCity(state.taxCity);
  else { renderTaxNotes(); document.dispatchEvent(new CustomEvent('hhp:tax-city', { detail: { name: state.taxCity } })); }
}

function initTheme() {
  const btn = $('theme-toggle');
  const current = () => document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => { btn.textContent = current() === 'dark' ? 'Light mode' : 'Dark mode'; };
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hhp-theme', next); } catch (e) { /* ignore */ }
    label();
  });
  label();
}

initTheme();
initInputs();
render();
initTaxCities();

let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderEquity, 150); });
