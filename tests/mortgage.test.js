import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amortizedPayment,
  estimatePMI,
  fhaMIP,
  totalMonthlyCost,
  equitySchedule,
  maxPriceForPayment,
  budgetTiers,
  rateForCredit,
} from '../js/mortgage.js';

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} to be within ${tol} of ${expected}`);

// Closed-form remaining balance after k payments, used as an independent check.
const balanceAfter = (P, rate, years, k) => {
  const r = rate / 12;
  const pmt = amortizedPayment(P, rate, years);
  return P * Math.pow(1 + r, k) - (pmt * (Math.pow(1 + r, k) - 1)) / r;
};

test('amortizedPayment matches published reference values', () => {
  near(amortizedPayment(300_000, 0.065, 30), 1896.2);
  near(amortizedPayment(200_000, 0.05, 30), 1073.64);
  near(amortizedPayment(250_000, 0.06, 15), 2109.64);
});

test('amortizedPayment handles zero rate and zero principal', () => {
  assert.equal(amortizedPayment(360_000, 0, 30), 1000);
  assert.equal(amortizedPayment(0, 0.07, 30), 0);
});

test('estimatePMI is zero at 80% LTV and rises with LTV and weaker credit', () => {
  assert.equal(estimatePMI(320_000, 400_000), 0);
  const ltv90 = estimatePMI(360_000, 400_000);
  const ltv97 = estimatePMI(388_000, 400_000);
  assert.ok(ltv90 > 0);
  assert.ok(ltv97 > ltv90);
  assert.ok(estimatePMI(388_000, 400_000, 'fair') > estimatePMI(388_000, 400_000, 'excellent'));
});

test('fhaMIP uses 1.75% upfront and 0.55%/0.50% annual for 30-year loans', () => {
  const high = fhaMIP(386_000, 400_000, 30); // 96.5% LTV
  near(high.upfront, 6755);
  assert.equal(high.annualRate, 0.0055);
  near(high.monthly, (386_000 * 0.0055) / 12);
  assert.equal(fhaMIP(360_000, 400_000, 30).annualRate, 0.005);
});

test('totalMonthlyCost sums its parts and splits first-month P&I', () => {
  const c = totalMonthlyCost({ price: 375_000, downPayment: 75_000, rate: 0.065, taxRate: 0.006, insuranceRate: 0.0035 });
  near(c.principalAndInterest, 1896.2);
  near(c.interest, 300_000 * 0.065 / 12);
  near(c.principal + c.interest, c.principalAndInterest, 1e-9);
  near(c.tax, 187.5);
  near(c.insurance, 109.375);
  assert.equal(c.pmi, 0); // exactly 80% LTV
  near(c.total, c.principalAndInterest + c.tax + c.insurance + c.pmi + c.hoa, 1e-9);
});

test('totalMonthlyCost finances FHA upfront MIP into the loan', () => {
  const c = totalMonthlyCost({ price: 400_000, downPayment: 14_000, rate: 0.065, loanType: 'fha' });
  near(c.loan, 386_000 * 1.0175);
  assert.ok(c.pmi > 0);
});

test('equitySchedule pays off the loan and agrees with closed-form balances', () => {
  const { points } = equitySchedule({ price: 375_000, downPayment: 75_000, rate: 0.065, appreciation: 0 });
  assert.equal(points.length, 31);
  near(points[5].balance, balanceAfter(300_000, 0.065, 30, 60), 0.5);
  near(points[10].balance, balanceAfter(300_000, 0.065, 30, 120), 0.5);
  near(points[30].balance, 0, 0.5);
  near(points[30].equity, 375_000, 0.5);
});

test('equitySchedule finds the month conventional PMI auto-terminates at 78% LTV', () => {
  const price = 400_000;
  const loan = 360_000;
  const { pmiDropMonth } = equitySchedule({ price, downPayment: price - loan, rate: 0.065 });
  assert.ok(pmiDropMonth > 0);
  assert.ok(balanceAfter(loan, 0.065, 30, pmiDropMonth) <= price * 0.78 + 0.01);
  assert.ok(balanceAfter(loan, 0.065, 30, pmiDropMonth - 1) > price * 0.78);
});

test('equitySchedule: no PMI at 20% down; FHA under 10% down keeps MIP for life', () => {
  assert.equal(equitySchedule({ price: 400_000, downPayment: 80_000, rate: 0.065 }).pmiDropMonth, 0);
  assert.equal(equitySchedule({ price: 400_000, downPayment: 14_000, rate: 0.065, loanType: 'fha' }).pmiDropMonth, null);
  assert.equal(equitySchedule({ price: 400_000, downPayment: 40_000, rate: 0.065, loanType: 'fha' }).pmiDropMonth, 132);
});

test('maxPriceForPayment round-trips through totalMonthlyCost', () => {
  const opts = { savings: 40_000, rate: 0.07 };
  const price = maxPriceForPayment(2500, opts);
  const cost = totalMonthlyCost({ ...opts, price, downPayment: 40_000 - price * 0.03 }).total;
  near(cost, 2500, 0.05);
  const slightlyMore = totalMonthlyCost({ ...opts, price: price + 500, downPayment: 40_000 - (price + 500) * 0.03 }).total;
  assert.ok(slightlyMore > 2500);
});

test('budgetTiers are ordered and debts shrink the budget', () => {
  const base = { takeHome: 7000, savings: 50_000, rate: 0.07 };
  const tiers = budgetTiers(base);
  assert.deepEqual(tiers.map((t) => t.key), ['comfortable', 'stretch', 'risky']);
  assert.ok(tiers[0].price < tiers[1].price && tiers[1].price < tiers[2].price);
  near(tiers[0].monthly, 7000 * 0.3, 0.05);
  const withDebt = budgetTiers({ ...base, debts: 600 });
  assert.ok(withDebt[0].price < tiers[0].price);
  assert.equal(budgetTiers({ ...base, debts: 5000 })[0].price, 0);
});

test('rateForCredit adds the band adjustment', () => {
  assert.equal(rateForCredit(0.07, 'excellent'), 0.07);
  near(rateForCredit(0.07, 'fair'), 0.0775, 1e-12);
});
