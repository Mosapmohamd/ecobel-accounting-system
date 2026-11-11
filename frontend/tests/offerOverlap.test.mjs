// Overlap warnings and the engine's processing order (src/pages/offers/overlap.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processedFirst, findWarnings, periodsOverlap, covers, ruleFromForm, ruleFromPromotion } from '../src/pages/offers/overlap.ts';
import { emptyForm, withType } from '../src/pages/offers/offerTypes.ts';

const catalog = [
  { id: 'a', name: 'A', category_id: 'skin' },
  { id: 'b', name: 'B', category_id: 'skin' },
  { id: 'h', name: 'H', category_id: 'hair' },
];
const R = (over) => ({
  id: 'x', kind: 'cart', type: 'percentage', name: 'x', state: 'active', priority: 0, combinable: false, createdAt: 1000,
  start: null, end: null, eligibleProducts: [], eligibleCategories: [], rewardProducts: [], rewardCategories: [], ...over,
});

test('order: group first, then priority, then the original created_at, then id', () => {
  const bundle = R({ id: 'b1', type: 'bundle', priority: -5 });
  const pct = R({ id: 'p1', type: 'percentage', priority: 100 });
  const ship = R({ id: 's1', type: 'free_shipping', priority: 1000 });
  assert.equal(processedFirst(pct, bundle).first.id, 'b1'); // bundles before product offers, whatever the priority
  assert.equal(processedFirst(ship, pct).first.id, 'p1'); // free shipping last
  assert.equal(processedFirst(R({ id: 'q', priority: 2 }), R({ id: 'r', priority: 1 })).reason, 'priority');
  const older = R({ id: 'old', createdAt: 1000 });
  const newer = R({ id: 'new', createdAt: 2000 });
  assert.equal(processedFirst(newer, older).first.id, 'old');
  assert.equal(processedFirst(newer, older).reason, 'older');
  assert.equal(processedFirst(R({ id: 'z', createdAt: 5 }), R({ id: 'y', createdAt: 5 })).first.id, 'y');
});

test('an edited offer keeps its original created_at; a new one is the newest', () => {
  const original = {
    source: 'promotion', id: 'edited', name: 'قديم', type: 'percentage', state: 'active', status: 'active', priority: 0, combinable: false,
    created_at: '2026-01-01T00:00:00Z', starts_at: null, ends_at: null, terms_locked: false, config: { percent: 10 }, min_subtotal: null,
    eligible_products: [{ id: 'a', name: 'A', quantity: 1 }], eligible_categories: [], reward_products: [], reward_categories: [],
  };
  const other = R({ id: 'other', createdAt: Date.parse('2026-06-01T00:00:00Z') });
  const form = { ...withType(emptyForm(), 'percentage'), productIds: ['a'], percent: '10', name: 'x' };
  const edited = ruleFromForm(form, original, '2026-11-11', Date.now());
  assert.equal(processedFirst(edited, other).first.id, 'edited');
  const asNew = ruleFromForm(form, null, '2026-11-11', Date.now());
  assert.equal(processedFirst(asNew, other).first.id, 'other');
  const raised = ruleFromForm({ ...form, priority: '5' }, original, '2026-11-11', Date.now());
  assert.equal(processedFirst(raised, R({ id: 'older', createdAt: 0 })).reason, 'priority');
});

test('a saved offer without created_at is the oldest, like the engine (epoch); only an unsaved one is the newest', () => {
  const p = (id, created_at) => ({ source: 'promotion', id, name: id, type: 'percentage', state: 'active', priority: 0, combinable: false, created_at,
    starts_at: null, ends_at: null, config: {}, eligible_products: [], eligible_categories: [], reward_products: [], reward_categories: [] });
  const noDate = ruleFromPromotion(p('nodate', null));
  const dated = ruleFromPromotion(p('dated', '2026-01-01T00:00:00'));
  assert.equal(noDate.createdAt, 0);
  assert.equal(processedFirst(dated, noDate).first.id, 'nodate');
  const form = { ...withType(emptyForm(), 'percentage'), percent: '5', scope: 'all', name: 'x' };
  assert.equal(ruleFromForm(form, { ...p('edited', null), terms_locked: false }, '2026-11-11', 0).createdAt, 0);
  assert.equal(ruleFromForm(form, null, '2026-11-11', 0).createdAt, null);
  assert.equal(processedFirst(ruleFromForm(form, null, '2026-11-11', 0), noDate).first.id, 'nodate');
});

test('scope follows Rule.matches; gift products count', () => {
  assert.equal(covers(R({}), catalog[2]), true); // unrestricted
  assert.equal(covers(R({ eligibleCategories: ['skin'] }), catalog[2]), false);
  assert.equal(covers(R({ type: 'buy_x_get_y', eligibleProducts: ['a'], rewardProducts: ['h'] }), catalog[2]), true);
});

test('dates: half-open periods; open ends', () => {
  assert.equal(periodsOverlap(R({ start: 0, end: 10 }), R({ start: 10, end: 20 })), false);
  assert.equal(periodsOverlap(R({ start: 0, end: 11 }), R({ start: 10, end: null })), true);
  assert.equal(periodsOverlap(R({ start: null, end: 5 }), R({ start: 6 })), false);
});

test('warnings: conflict, stack, cart-wide, free shipping, sale prices; drafts and other dates ignored', () => {
  const mine = R({ id: null, createdAt: null, eligibleProducts: ['a'], start: 100, end: 200 });
  const existing = [
    R({ id: 'same', eligibleCategories: ['skin'], combinable: true }),
    R({ id: 'elsewhere', eligibleProducts: ['h'] }),
    R({ id: 'draft', state: 'draft', eligibleProducts: ['a'] }),
    R({ id: 'later', eligibleProducts: ['a'], start: 300 }),
    R({ id: 'sale', kind: 'sale', type: 'product_price', saleProductId: 'a', salePrice: 250 }),
  ];
  const w = findWarnings(mine, existing, catalog);
  const kinds = w.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['cart_wide', 'conflict', 'on_sale_price']);
  const conflict = w.find((x) => x.kind === 'conflict');
  assert.equal(conflict.other.id, 'same');
  assert.equal(conflict.first.id, 'same'); // equal priority: the saved (older) one first
  const both = findWarnings({ ...mine, combinable: true }, existing, catalog);
  assert.ok(both.some((x) => x.kind === 'stack'));
  // "elsewhere" is itself non-combinable: it still blocks the cart.
  assert.ok(both.some((x) => x.kind === 'cart_wide'));
  const allCombinable = findWarnings({ ...mine, combinable: true }, existing.map((e) => ({ ...e, combinable: true })), catalog);
  assert.ok(!allCombinable.some((x) => x.kind === 'cart_wide'));
  const ships = findWarnings(R({ id: null, type: 'free_shipping', createdAt: null }), [R({ id: 's', type: 'free_shipping', combinable: true })], catalog);
  assert.equal(ships[0].kind, 'two_free_shipping');
});

test('a new sale price: running sale price on the product, cart offers on it', () => {
  const sale = R({ id: null, kind: 'sale', type: 'product_price', eligibleProducts: ['a', 'h'], start: 0, end: null });
  const w = findWarnings(sale, [
    R({ id: 'run', kind: 'sale', type: 'product_price', saleProductId: 'a' }),
    R({ id: 'off', kind: 'sale', type: 'product_price', state: 'inactive', saleProductId: 'h' }),
    R({ id: 'cat', eligibleCategories: ['hair'] }),
  ], catalog);
  assert.deepEqual(w.filter((x) => x.kind === 'sale_running').map((x) => x.productId), ['a']);
  assert.equal(w.find((x) => x.kind === 'cart_on_sale').others[0].id, 'cat');
  const self = ruleFromPromotion({ source: 'product_offer', id: 'run', name: 's', type: 'product_price', state: 'active', priority: 0, combinable: true, created_at: null, starts_at: null, ends_at: null, config: { product_id: 'a', offer_price: 1 }, eligible_products: [{ id: 'a' }], eligible_categories: [], reward_products: [], reward_categories: [] });
  assert.equal(self.saleProductId, 'a');
});
