// Pure mortgage math. No DOM, no side effects — safe to import in Node tests.
// All rates are annual decimals (0.065 = 6.5%). All money is in dollars.

export const CREDIT_BANDS = {
  excellent: { label: '760+', rateAdjust: 0, pmiFactor: 0.6 },
  good: { label: '700–759', rateAdjust: 0.0025, pmiFactor: 1 },
  fair: { label: '640–699', rateAdjust: 0.0075, pmiFactor: 1.6 },
  building: { label: '580–639', rateAdjust: 0.015, pmiFactor: 2.2 },
};

/** Monthly principal + interest for a fully amortizing fixed-rate loan. */
export function amortizedPayment(principal, annualRate, years) {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = annualRate / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * Conventional PMI estimate, monthly. Zero at or below 80% LTV.
 * Base annual rates are typical mid-market figures for a 700–759 score,
 * scaled by the credit band's pmiFactor.
 */
export function estimatePMI(loanAmount, homeValue, creditBand = 'good') {
  if (loanAmount <= 0 || homeValue <= 0) return 0;
  const ltv = loanAmount / homeValue;
  if (ltv <= 0.8) return 0;
  let base;
  if (ltv > 0.95) base = 0.0062;
  else if (ltv > 0.9) base = 0.0045;
  else if (ltv > 0.85) base = 0.003;
  else base = 0.0019;
  const factor = (CREDIT_BANDS[creditBand] || CREDIT_BANDS.good).pmiFactor;
  return (loanAmount * base * factor) / 12;
}

/**
 * FHA mortgage insurance. Upfront MIP is 1.75% of the base loan (usually
 * financed). Annual MIP for terms over 15 years: 0.55% above 95% LTV,
 * 0.50% otherwise; 15-year-or-less terms: 0.40% / 0.15%.
 */
export function fhaMIP(baseLoan, homeValue, years = 30) {
  if (baseLoan <= 0 || homeValue <= 0) return { upfront: 0, monthly: 0, annualRate: 0 };
  const ltv = baseLoan / homeValue;
  const annualRate = years > 15 ? (ltv > 0.95 ? 0.0055 : 0.005) : (ltv > 0.9 ? 0.004 : 0.0015);
  return {
    upfront: baseLoan * 0.0175,
    monthly: (baseLoan * annualRate) / 12,
    annualRate,
  };
}

/**
 * Full monthly housing cost, split into the first month's principal and
 * interest plus escrow items.
 */
export function totalMonthlyCost({
  price,
  downPayment,
  rate,
  years = 30,
  taxRate = 0.006,
  insuranceRate = 0.0035,
  hoa = 0,
  creditBand = 'good',
  loanType = 'conventional',
}) {
  const down = Math.min(Math.max(downPayment, 0), price);
  const baseLoan = price - down;
  let loan = baseLoan;
  let mi = 0;
  if (loanType === 'fha') {
    const m = fhaMIP(baseLoan, price, years);
    loan = baseLoan + m.upfront;
    mi = m.monthly;
  } else {
    mi = estimatePMI(baseLoan, price, creditBand);
  }
  const pi = amortizedPayment(loan, rate, years);
  const interest = loan * (rate / 12);
  const principal = pi - interest;
  const tax = (price * taxRate) / 12;
  const insurance = (price * insuranceRate) / 12;
  return {
    loan,
    principalAndInterest: pi,
    principal,
    interest,
    tax,
    insurance,
    pmi: mi,
    hoa,
    total: pi + tax + insurance + mi + hoa,
  };
}

/**
 * Yearly equity schedule. Conventional PMI ends when the balance reaches
 * 78% of the original price (automatic termination under the Homeowners
 * Protection Act). FHA MIP with under 10% down lasts the life of the loan;
 * with 10%+ down it ends after 11 years.
 */
export function equitySchedule({
  price,
  downPayment,
  rate,
  years = 30,
  appreciation = 0.03,
  loanType = 'conventional',
}) {
  const down = Math.min(Math.max(downPayment, 0), price);
  const baseLoan = price - down;
  const loan = loanType === 'fha' ? baseLoan + fhaMIP(baseLoan, price, years).upfront : baseLoan;
  const pi = amortizedPayment(loan, rate, years);
  const r = rate / 12;

  let pmiDropMonth = null;
  if (loanType === 'fha') {
    if (down / price >= 0.1) pmiDropMonth = Math.min(132, years * 12);
  } else if (baseLoan / price > 0.8) {
    // found during the walk below
  } else {
    pmiDropMonth = 0;
  }

  const points = [{ year: 0, balance: loan, homeValue: price, equity: price - loan }];
  let balance = loan;
  for (let m = 1; m <= years * 12; m++) {
    balance = Math.max(0, balance * (1 + r) - pi);
    if (pmiDropMonth === null && loanType !== 'fha' && balance <= price * 0.78) pmiDropMonth = m;
    if (m % 12 === 0) {
      const year = m / 12;
      const homeValue = price * Math.pow(1 + appreciation, year);
      points.push({ year, balance, homeValue, equity: homeValue - balance });
    }
  }
  return { points, pmiDropMonth };
}

/**
 * Highest price whose total monthly cost fits `maxPayment`, given savings.
 * Down payment = savings minus estimated closing costs, floored at zero.
 * Bisection, since PMI makes cost piecewise in price.
 */
export function maxPriceForPayment(maxPayment, { savings, closingCostRate = 0.03, ...opts }) {
  if (maxPayment <= 0) return 0;
  const costAt = (price) =>
    totalMonthlyCost({ ...opts, price, downPayment: Math.max(0, savings - price * closingCostRate) }).total;
  let lo = 0;
  let hi = 5_000_000;
  if (costAt(hi) <= maxPayment) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (costAt(mid) <= maxPayment) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Share of take-home pay that housing + other debts may use, per tier. */
export const TIERS = [
  { key: 'comfortable', label: 'Comfortable', share: 0.3 },
  { key: 'stretch', label: 'Stretch', share: 0.38 },
  { key: 'risky', label: 'Risky', share: 0.45 },
];

/** Price tiers from take-home pay, savings and existing monthly debts. */
export function budgetTiers({ takeHome, savings, debts = 0, ...opts }) {
  return TIERS.map((t) => {
    const maxPayment = Math.max(0, takeHome * t.share - debts);
    const price = maxPriceForPayment(maxPayment, { savings, ...opts });
    const downPayment = Math.max(0, savings - price * (opts.closingCostRate ?? 0.03));
    const cost = totalMonthlyCost({ ...opts, price, downPayment });
    return {
      ...t,
      price,
      downPayment,
      monthly: cost.total,
      pctOfTakeHome: takeHome > 0 ? cost.total / takeHome : 0,
    };
  });
}

/** Market rate adjusted for the borrower's credit band. */
export function rateForCredit(baseRate, creditBand = 'good') {
  return baseRate + (CREDIT_BANDS[creditBand] || CREDIT_BANDS.good).rateAdjust;
}
