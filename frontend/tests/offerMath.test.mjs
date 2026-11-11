// Offer form calculations (src/pages/offers/offerMath.ts, dates.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFromPercent, percentOff, fixedBundleSummary, chooseBundleRange, giftValue, shippingRange, percentageRow, fixedItemRow } from '../src/pages/offers/offerMath.ts';
import { addDays, cairoDate, cairoMidnightUtc, parseInstant } from '../src/pages/offers/dates.ts';

const P = (id, regular, current = regular) => ({ id, name: id, regular, current });

test('a sale price from a percentage is rounded to the nearest whole pound', () => {
  assert.equal(priceFromPercent(320, 15), 272);
  assert.equal(priceFromPercent(230, 15), 196); // 195.5 → 196
  assert.equal(priceFromPercent(99, 10), 89); // 89.1 → 89
  assert.equal(percentOff(320, 272), 15);
  assert.equal(percentOff(230, 196), 14.8);
});

test('percentage and per-item amounts never go below zero', () => {
  assert.equal(percentageRow(P('a', 100), 15).after, 85);
  assert.equal(percentageRow(P('a', 100, 80), 50).after, 40); // on today's (sale) price
  assert.equal(fixedItemRow(P('a', 30), 50).after, 0);
});

test('fixed bundle: regular total (the server rule) and the real saving at today\'s prices', () => {
  const s = fixedBundleSummary([{ product: P('a', 300, 250), quantity: 2 }, { product: P('b', 240), quantity: 1 }], 720);
  assert.equal(s.units, 3);
  assert.equal(s.regularTotal, 840);
  assert.equal(s.currentTotal, 740);
  assert.equal(s.priceOk, true);
  assert.equal(s.savingsRegular, 120);
  assert.equal(s.savingsCurrent, 20);
  assert.equal(s.discountedInside, true);
  assert.equal(fixedBundleSummary([{ product: P('a', 300), quantity: 2 }], 600).priceOk, false);
});

test('choose bundle range without distinct products: one product can fill the bundle', () => {
  const r = chooseBundleRange([P('a', 100), P('b', 200), P('c', 400)], 3, 600, false);
  assert.equal(r.cheapest, 300);
  assert.equal(r.dearest, 1200);
  assert.equal(r.minSaving, -300);
  assert.equal(r.maxSaving, 600);
  assert.equal(r.cheapestNotWorth, true);
});

test('choose bundle range with distinct products uses N different products', () => {
  const r = chooseBundleRange([P('a', 100), P('b', 200), P('c', 400), P('d', 500)], 3, 600, true);
  assert.equal(r.cheapest, 700);
  assert.equal(r.dearest, 1100);
  assert.equal(r.cheapestNotWorth, false);
  const few = chooseBundleRange([P('a', 100), P('b', 200)], 3, 600, true);
  assert.equal(few.possible, false);
  assert.equal(few.reason, 'too_few');
});

test('gift value and shipping range', () => {
  assert.deepEqual(giftValue([P('a', 80), P('b', 120)], 1, 'cheapest'), { typical: 80, lo: 80, hi: 120 });
  assert.equal(giftValue([P('a', 80), P('b', 120)], 1, 'most_expensive').typical, 120);
  assert.deepEqual(shippingRange([90, 30, 50]), { lo: 30, hi: 90 });
  assert.equal(shippingRange([]), null);
});

test('Cairo days: naive timestamps are UTC, midnight follows the Cairo offset', () => {
  assert.equal(parseInstant('2026-11-10T22:00:00'), Date.UTC(2026, 10, 10, 22));
  assert.equal(cairoDate('2026-11-10T22:00:00Z'), '2026-11-11'); // winter UTC+2
  assert.equal(cairoDate('2026-11-11T22:00:00Z', true), '2026-11-11');
  assert.equal(cairoMidnightUtc('2026-11-11'), Date.UTC(2026, 10, 10, 22));
  assert.equal(cairoMidnightUtc('2026-07-01'), Date.UTC(2026, 5, 30, 21)); // summer UTC+3
  assert.equal(addDays('2026-11-28', 6), '2026-12-04');
});
