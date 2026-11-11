// Display-only calculations for the offer form. The backend prices every
// cart and checks every rule; nothing here is sent as a price except the
// sale price the employee approves (offer_price). No runtime imports, so it
// runs under `node --test`.

/** Money to the piastre, like the engine (_r). */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** A sale price from a discount percentage, rounded to the nearest whole
 * Egyptian pound (approved rule). */
export function priceFromPercent(regular: number, percent: number): number {
  return Math.round(regular * (1 - percent / 100));
}

/** The discount a price gives, in percent, to one decimal. */
export function percentOff(regular: number, price: number): number {
  if (!(regular > 0)) return 0;
  return Math.round(((regular - price) / regular) * 1000) / 10;
}

export interface PricedProduct {
  id: string;
  name: string;
  /** Regular price (products.sale_price). */
  regular: number;
  /** What the customer pays today: a running sale price, else `regular`.
   * The engine discounts this price (Line.unit_price). */
  current: number;
}

/** Before/after one unit for a percentage offer (per unit, before any
 * max_discount cap, which applies to the whole order). */
export function percentageRow(p: PricedProduct, percent: number) {
  return { ...p, after: r2(Math.max(0, p.current * (1 - percent / 100))) };
}

/** Before/after one unit for a fixed amount taken off every unit. */
export function fixedItemRow(p: PricedProduct, amount: number) {
  return { ...p, after: r2(Math.max(0, p.current - amount)) };
}

/** A fixed bundle: the regular total the server checks the price against,
 * the total at today's prices, and what the customer saves. */
export function fixedBundleSummary(items: { product: PricedProduct; quantity: number }[], bundlePrice: number) {
  const regularTotal = r2(items.reduce((s, i) => s + i.product.regular * i.quantity, 0));
  const currentTotal = r2(items.reduce((s, i) => s + i.product.current * i.quantity, 0));
  const units = items.reduce((s, i) => s + i.quantity, 0);
  return {
    units,
    regularTotal,
    currentTotal,
    /** Below the regular total — the server's own rule. */
    priceOk: bundlePrice > 0 && bundlePrice < regularTotal,
    savingsRegular: r2(regularTotal - bundlePrice),
    savingsCurrent: r2(currentTotal - bundlePrice),
    percentRegular: percentOff(regularTotal, bundlePrice),
    /** Some product already sells below its regular price. */
    discountedInside: items.some((i) => i.product.current < i.product.regular),
  };
}

/** A choose-your-own bundle (N units from a pool, at today's prices): the
 * cheapest and the most expensive set the customer could pick. With
 * `distinct` every unit is a different product; otherwise one product can
 * fill the bundle. An ESTIMATE — stock isn't considered. */
export function chooseBundleRange(pool: PricedProduct[], size: number, bundlePrice: number, distinct: boolean) {
  const prices = pool.map((p) => p.current).filter((x) => x > 0).sort((a, b) => a - b);
  const n = Math.max(0, Math.floor(size));
  if (!prices.length || n < 1) return { possible: false as const, reason: 'empty' as const };
  if (distinct && prices.length < n) return { possible: false as const, reason: 'too_few' as const, available: prices.length };
  const cheapest = distinct ? prices.slice(0, n).reduce((s, x) => s + x, 0) : prices[0] * n;
  const dearest = distinct ? prices.slice(-n).reduce((s, x) => s + x, 0) : prices[prices.length - 1] * n;
  return {
    possible: true as const,
    cheapest: r2(cheapest),
    dearest: r2(dearest),
    minSaving: r2(cheapest - bundlePrice),
    maxSaving: r2(dearest - bundlePrice),
    /** The cheapest set costs no more than the bundle — buying it as a
     * bundle saves nothing (a warning, never a block). */
    cheapestNotWorth: cheapest <= bundlePrice,
  };
}

/** What one round of gifts is worth: `get` gift units, the cheapest or the
 * dearest of the gift pool (reward_choice). */
export function giftValue(pool: PricedProduct[], get: number, choice: 'cheapest' | 'most_expensive') {
  const prices = pool.map((p) => p.current).filter((x) => x > 0).sort((a, b) => a - b);
  if (!prices.length || !(get > 0)) return null;
  const pick = choice === 'cheapest' ? prices.slice(0, get) : prices.slice(-get);
  // Fewer distinct prices than gifts: the same product can be given again.
  while (pick.length < get) pick.push(choice === 'cheapest' ? prices[0] : prices[prices.length - 1]);
  const lo = prices[0] * get;
  const hi = prices[prices.length - 1] * get;
  return { typical: r2(pick.reduce((s, x) => s + x, 0)), lo: r2(lo), hi: r2(hi) };
}

/** Free shipping saves the delivery fee: its range over the cities offered. */
export function shippingRange(fees: number[]) {
  const f = fees.filter((x) => x >= 0).sort((a, b) => a - b);
  return f.length ? { lo: f[0], hi: f[f.length - 1] } : null;
}

export const money = (n: number) => `${n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
