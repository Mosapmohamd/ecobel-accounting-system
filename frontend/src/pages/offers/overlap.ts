// Overlap warnings for the offer form — they never block saving and change
// no rule. They follow the pricing engine (backend app/promotions.py, kept
// identical in both backends):
//
// * An offer can apply while it's active and now is in [starts_at, ends_at).
// * Offers are processed in GROUPS: 1) bundles the customer added,
//   2) percentage / fixed_amount / buy_x_get_y, 3) (the coupon), 4) free
//   shipping. Inside a group: higher priority first, then the oldest
//   created_at, then id (order_rules). Priority never moves an offer to
//   another group.
// * A non-combinable offer is skipped when any offer already applied to the
//   cart, and once it applies every later offer in the cart is skipped —
//   for the whole cart, not per product (evaluate_products / _shipping).
// * Combinable offers apply together, but a unit gets one discount (_take).
// * One free-shipping waiver per order.
// * Sale prices (table `offers`) aren't engine rules: they are the unit
//   price cart offers start from (Line.unit_price).
// * Scope: no products and no categories = every product (Rule.matches);
//   a gift offer also covers its gift products.
//
// Only type imports from the API module, so it runs under `node --test`.
import type { Promotion } from '../../lib/api';
import { addDays, cairoMidnightUtc, parseInstant } from './dates.ts';
import { apiType, firstDay, lastDay, targetsOf, type OfferForm } from './offerTypes.ts';

export interface CatalogProduct {
  id: string;
  name: string;
  category_id: string;
}

export interface RuleLike {
  /** null: not saved yet. */
  id: string | null;
  kind: 'cart' | 'sale';
  type: string;
  name: string;
  state: string | null;
  priority: number;
  combinable: boolean;
  /** Epoch ms (a saved offer without one: 0, the oldest — like the engine);
   * null: a new, unsaved offer (it will be the newest). */
  createdAt: number | null;
  /** Epoch ms; null = open-ended. */
  start: number | null;
  end: number | null;
  eligibleProducts: string[];
  eligibleCategories: string[];
  rewardProducts: string[];
  rewardCategories: string[];
  /** Sale prices: the product and its price. */
  saleProductId?: string;
  salePrice?: number;
}

const ms = (iso: string | null | undefined) => (iso ? parseInstant(iso) : null);
/** A SAVED offer's created_at as the engine orders it: a missing one counts
 * as the epoch, i.e. the oldest (order_rules: `_aware(created_at) or epoch`). */
const savedCreatedAt = (iso: string | null | undefined) => ms(iso) ?? 0;

export function ruleFromPromotion(p: Promotion): RuleLike {
  const sale = p.source === 'product_offer';
  const c = (p.config ?? {}) as Record<string, unknown>;
  return {
    id: p.id, kind: sale ? 'sale' : 'cart', type: p.type, name: p.name, state: p.state,
    priority: p.priority ?? 0, combinable: Boolean(p.combinable), createdAt: savedCreatedAt(p.created_at),
    start: ms(p.starts_at), end: ms(p.ends_at),
    eligibleProducts: p.eligible_products.map((x) => x.id), eligibleCategories: p.eligible_categories.map((x) => x.id),
    rewardProducts: p.reward_products.map((x) => x.id), rewardCategories: p.reward_categories.map((x) => x.id),
    ...(sale ? { saleProductId: String(c.product_id), salePrice: Number(c.offer_price) } : {}),
  };
}

/** The offer being created or edited, as the engine would see it. An
 * edited offer keeps its own created_at and id (its place among equal
 * priorities); a new one is the newest. */
export function ruleFromForm(f: OfferForm, original: Promotion | null, today: string, now: number): RuleLike {
  const keepDates = original && !f.datesTouched;
  const first = firstDay(f);
  const last = lastDay(f, today);
  const start = keepDates ? ms(original!.starts_at) : first ? cairoMidnightUtc(first) : now;
  const end = keepDates ? ms(original!.ends_at) : last ? cairoMidnightUtc(addDays(last, 1)) : null;
  const locked = Boolean(original?.terms_locked);
  const t = locked
    ? {
      eligible_product_ids: original!.eligible_products.map((x) => x.id), eligible_category_ids: original!.eligible_categories.map((x) => x.id),
      reward_product_ids: original!.reward_products.map((x) => x.id), reward_category_ids: original!.reward_categories.map((x) => x.id),
    }
    : targetsOf(f);
  return {
    id: original?.id ?? null, kind: f.type === 'product_price' ? 'sale' : 'cart',
    type: locked ? original!.type : apiType(f.type!), name: f.name.trim() || 'العرض ده', state: null,
    priority: Number(f.priority) || 0, combinable: f.combinable, createdAt: original ? savedCreatedAt(original.created_at) : null,
    start, end,
    eligibleProducts: t.eligible_product_ids, eligibleCategories: t.eligible_category_ids,
    rewardProducts: t.reward_product_ids, rewardCategories: t.reward_category_ids,
  };
}

/** The engine's processing group: bundles, then product offers, then free shipping. */
export function groupOf(type: string): number {
  if (type === 'bundle') return 0;
  if (type === 'free_shipping') return 2;
  return 1;
}

export type OrderReason = 'group' | 'priority' | 'older' | 'id';

/** Which of two cart offers the engine looks at first, and why. */
export function processedFirst(a: RuleLike, b: RuleLike): { first: RuleLike; second: RuleLike; reason: OrderReason } {
  const ga = groupOf(a.type);
  const gb = groupOf(b.type);
  if (ga !== gb) return ga < gb ? { first: a, second: b, reason: 'group' } : { first: b, second: a, reason: 'group' };
  if (a.priority !== b.priority) return a.priority > b.priority ? { first: a, second: b, reason: 'priority' } : { first: b, second: a, reason: 'priority' };
  const ca = a.createdAt ?? Number.POSITIVE_INFINITY;
  const cb = b.createdAt ?? Number.POSITIVE_INFINITY;
  if (ca !== cb) return ca < cb ? { first: a, second: b, reason: 'older' } : { first: b, second: a, reason: 'older' };
  // Same instant: the engine falls back to the id (a new offer has none yet → after).
  if (a.id === null) return { first: b, second: a, reason: 'id' };
  if (b.id === null) return { first: a, second: b, reason: 'id' };
  return a.id < b.id ? { first: a, second: b, reason: 'id' } : { first: b, second: a, reason: 'id' };
}

/** Rule.matches, eligible side — plus the gift side for gift offers. */
export function covers(r: RuleLike, p: CatalogProduct): boolean {
  if (r.kind === 'sale') return r.saleProductId === p.id;
  const unrestricted = !r.eligibleProducts.length && !r.eligibleCategories.length;
  const eligible = unrestricted || r.eligibleProducts.includes(p.id) || r.eligibleCategories.includes(p.category_id);
  const reward = r.rewardProducts.includes(p.id) || r.rewardCategories.includes(p.category_id);
  return eligible || reward;
}

export function periodsOverlap(a: RuleLike, b: RuleLike): boolean {
  const as = a.start ?? Number.NEGATIVE_INFINITY;
  const ae = a.end ?? Number.POSITIVE_INFINITY;
  const bs = b.start ?? Number.NEGATIVE_INFINITY;
  const be = b.end ?? Number.POSITIVE_INFINITY;
  return as < be && bs < ae;
}

export function sharedProducts(a: RuleLike, b: RuleLike, catalog: CatalogProduct[]): CatalogProduct[] {
  return catalog.filter((p) => covers(a, p) && covers(b, p));
}

export type Warning =
  | { kind: 'conflict'; other: RuleLike; first: RuleLike; reason: OrderReason; shared: number }
  | { kind: 'stack'; other: RuleLike; first: RuleLike; reason: OrderReason; shared: number }
  | { kind: 'two_free_shipping'; other: RuleLike; first: RuleLike; reason: OrderReason }
  | { kind: 'cart_wide'; others: RuleLike[] }
  | { kind: 'on_sale_price'; items: { product: CatalogProduct; sale: RuleLike }[] }
  | { kind: 'cart_on_sale'; others: RuleLike[] }
  | { kind: 'sale_running'; productId: string; other: RuleLike };

/** What could interact with `rule` — running or scheduled cart offers and
 * running sale prices whose dates meet its dates. The offer being edited
 * is left out. */
export function findWarnings(rule: RuleLike, existing: RuleLike[], catalog: CatalogProduct[]): Warning[] {
  const others = existing.filter((e) => e.id !== rule.id || rule.id === null);
  const cart = others.filter((e) => e.kind === 'cart' && (e.state === 'active' || e.state === 'scheduled') && periodsOverlap(rule, e));
  const sales = others.filter((e) => e.kind === 'sale' && e.state === 'active');
  const out: Warning[] = [];

  if (rule.kind === 'sale') {
    for (const pid of rule.eligibleProducts) {
      const running = sales.find((s) => s.saleProductId === pid);
      if (running) out.push({ kind: 'sale_running', productId: pid, other: running });
    }
    const chosen = catalog.filter((p) => rule.eligibleProducts.includes(p.id));
    const touching = cart.filter((e) => chosen.some((p) => covers(e, p)));
    if (touching.length) out.push({ kind: 'cart_on_sale', others: touching });
    return out;
  }

  const cartWide: RuleLike[] = [];
  for (const e of cart) {
    const shared = sharedProducts(rule, e, catalog).length;
    const order = processedFirst(rule, e);
    if (shared > 0) {
      if (rule.type === 'free_shipping' && e.type === 'free_shipping') {
        out.push({ kind: 'two_free_shipping', other: e, first: order.first, reason: order.reason });
      } else if (!rule.combinable || !e.combinable) {
        out.push({ kind: 'conflict', other: e, first: order.first, reason: order.reason, shared });
      } else {
        out.push({ kind: 'stack', other: e, first: order.first, reason: order.reason, shared });
      }
    } else if (!rule.combinable || !e.combinable) {
      cartWide.push(e);
    }
  }
  if (cartWide.length) out.push({ kind: 'cart_wide', others: cartWide });

  const items = sales
    .filter((s) => periodsOverlap(rule, s))
    .flatMap((s) => {
      const product = catalog.find((p) => p.id === s.saleProductId);
      return product && covers(rule, product) ? [{ product, sale: s }] : [];
    });
  if (items.length) out.push({ kind: 'on_sale_price', items });
  return out;
}
