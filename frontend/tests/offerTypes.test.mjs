// Offer form ↔ API payloads (src/pages/offers/offerTypes.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyForm, withType, formFromPromotion, formFromSaleOffer, toPromotionInput, applySalePercent, checkProducts, checkDetails,
  checkPublish, suggestName, lastDay,
} from '../src/pages/offers/offerTypes.ts';

const today = '2026-11-11';
const ctx = { regularOf: (id) => ({ a: 300, b: 240, c: 100 })[id], today, locked: false };
const T = (id, quantity = 1) => ({ id, name: id, quantity });

function promo(over = {}) {
  return {
    source: 'promotion', id: 'p1', name: 'عرض', description: null, badge_text: null, type: 'percentage', status: 'active', state: 'active',
    summary: '', starts_at: null, ends_at: null, priority: 0, combinable: false, min_subtotal: null, usage_limit: null,
    per_customer_limit: null, used_count: 0, orders_count: 0, terms_locked: false, config: { percent: 15, max_discount: null, max_quantity: null },
    eligible_products: [], eligible_categories: [], reward_products: [], reward_categories: [], created_by: null, updated_by: null,
    created_at: '2026-11-01T10:00:00Z', updated_at: null, ...over,
  };
}

const roundTrip = (p) => toPromotionInput(formFromPromotion(p), { status: p.status, original: null, today });
const pick = (x) => ({
  type: x.type, config: x.config, min_subtotal: x.min_subtotal, eligible_product_ids: x.eligible_product_ids,
  eligible_category_ids: x.eligible_category_ids, reward_product_ids: x.reward_product_ids, reward_category_ids: x.reward_category_ids,
});

test('every cart type survives load → form → payload unchanged', () => {
  const cases = [
    promo({ type: 'percentage', config: { percent: 15, max_discount: 100, max_quantity: 3 }, eligible_categories: [T('skin')], eligible_products: [T('a')] }),
    promo({ type: 'fixed_amount', config: { amount: 50, apply_per: 'item', max_quantity: 2 }, eligible_products: [T('a'), T('b')] }),
    promo({ type: 'fixed_amount', config: { amount: 100, apply_per: 'order', max_quantity: null } }),
    promo({ type: 'bundle', config: { mode: 'combination', bundle_price: 600, allow_multiple: false, max_bundles: null, bundle_quantity: 3 }, eligible_products: [T('a', 2), T('b')] }),
    promo({ type: 'bundle', config: { mode: 'any', bundle_quantity: 3, bundle_price: 650, distinct_products: true, allow_multiple: true, max_bundles: 2 }, eligible_categories: [T('skin')] }),
    promo({ type: 'buy_x_get_y', config: { buy_quantity: 2, get_quantity: 1, reward_choice: 'most_expensive', allow_multiple: false, max_rewards: 3 }, eligible_products: [T('a')], reward_products: [T('c')] }),
    promo({ type: 'buy_x_get_y', config: { buy_quantity: 3, get_quantity: 1, reward_choice: 'cheapest', allow_multiple: true, max_rewards: null }, eligible_categories: [T('hair')] }),
    promo({ type: 'free_shipping', config: { basis: 'before', cities: ['القاهرة'], require_all_eligible: true }, min_subtotal: 800, eligible_products: [T('a')] }),
    promo({ type: 'free_shipping', config: { basis: 'after', cities: [], require_all_eligible: false }, min_subtotal: null }),
  ];
  for (const p of cases) {
    const got = pick(roundTrip(p));
    const want = {
      type: p.type, config: (({ bundle_quantity, ...rest }) => (p.config.mode === 'combination' ? rest : p.config))(p.config),
      min_subtotal: p.min_subtotal, eligible_product_ids: p.eligible_products.map((x) => x.id), eligible_category_ids: p.eligible_categories.map((x) => x.id),
      reward_product_ids: p.reward_products.map((x) => x.id), reward_category_ids: p.reward_categories.map((x) => x.id),
    };
    assert.deepEqual(got, want, `${p.type} ${JSON.stringify(p.config)}`);
  }
  const fixed = roundTrip(cases[3]);
  assert.deepEqual(fixed.product_quantities, { a: 2, b: 1 });
});

test('a locked offer sends its stored terms exactly; only the open fields change', () => {
  const p = promo({ terms_locked: true, config: { percent: 15, max_discount: null, max_quantity: null }, eligible_products: [T('a')], min_subtotal: 300 });
  const f = { ...formFromPromotion(p), percent: '99', productIds: ['b'], minSubtotal: '1', name: 'اسم جديد', usageLimit: '5', priority: '3', combinable: true };
  const body = toPromotionInput(f, { status: 'inactive', original: p, today });
  assert.equal(body.type, 'percentage');
  assert.deepEqual(body.config, p.config);
  assert.equal(body.min_subtotal, 300);
  assert.deepEqual(body.eligible_product_ids, ['a']);
  assert.deepEqual(body.product_quantities, { a: 1 });
  assert.equal(body.name, 'اسم جديد');
  assert.equal(body.usage_limit, 5);
  assert.equal(body.priority, 3);
  assert.equal(body.combinable, true);
  assert.equal(body.status, 'inactive');
});

test('untouched dates of an edited offer are sent back as stored; changed ones as days', () => {
  const p = promo({ starts_at: '2026-11-01T08:30:00Z', ends_at: '2026-12-01T22:00:00Z' });
  const f = formFromPromotion(p);
  assert.equal(toPromotionInput(f, { status: 'active', original: p, today }).starts_at, '2026-11-01T08:30:00Z');
  const changed = { ...f, datesTouched: true, endMode: 'week' };
  const body = toPromotionInput(changed, { status: 'active', original: p, today });
  assert.equal(body.starts_at, '2026-11-01');
  assert.equal(body.ends_at, '2026-11-17');
});

test('new offers: date presets, scope "all" sends no targets, defaults', () => {
  const f = { ...withType(emptyForm(), 'percentage'), percent: '10', scope: 'all', productIds: ['a'], endMode: 'month', name: 'x' };
  const body = toPromotionInput(f, { status: 'draft', original: null, today });
  assert.deepEqual(body.eligible_product_ids, []);
  assert.deepEqual(body.eligible_category_ids, []);
  assert.equal(body.starts_at, null);
  assert.equal(body.ends_at, '2026-12-10');
  assert.equal(body.combinable, false);
  assert.equal(body.priority, 0);
  assert.equal(lastDay({ ...f, endMode: 'none' }, today), null);
});

test('sale price: percentage fills every row, rounded; rows can be edited', () => {
  let f = { ...withType(emptyForm(), 'product_price'), productIds: ['a', 'b'] };
  f = applySalePercent(f, ctx.regularOf, '15');
  assert.deepEqual(f.salePrices, { a: '255', b: '204' });
  f = { ...f, salePrices: { ...f.salePrices, b: '240' }, name: 'خصم 15%' };
  assert.equal(checkDetails(f, ctx)['sale:b'], 'سعر العرض لازم يكون أقل من السعر الأصلي');
  assert.equal(checkDetails(f, ctx)['sale:a'], undefined);
  const edit = formFromSaleOffer(promo({ source: 'product_offer', type: 'product_price', name: 'خصم', config: { product_id: 'a', offer_price: 255, original_price: 300 } }));
  assert.deepEqual(edit.productIds, ['a']);
  assert.equal(edit.salePercent, '15');
});

test('checks mirror the server', () => {
  const fixed = { ...withType(emptyForm(), 'bundle_fixed'), productIds: ['a'], quantities: { a: 1 }, name: 'b', bundlePrice: '300' };
  assert.equal(checkProducts(fixed, ctx).quantities, 'الباقة لازم يكون فيها قطعتين على الأقل');
  const two = { ...fixed, quantities: { a: 2 } };
  assert.deepEqual(checkProducts(two, ctx), {});
  assert.equal(checkDetails({ ...two, bundlePrice: '600' }, ctx).bundlePrice, 'سعر الباقة لازم يكون أقل من مجموع أسعار منتجاتها');
  assert.equal(checkDetails({ ...two, bundlePrice: '599' }, ctx).bundlePrice, undefined);
  const pct = { ...withType(emptyForm(), 'percentage'), scope: 'products', name: 'x', percent: '150' };
  assert.ok(checkProducts(pct, ctx).products);
  assert.ok(checkDetails(pct, ctx).percent);
  const choose = { ...withType(emptyForm(), 'bundle_choose'), name: 'x', bundleQuantity: '1', bundlePrice: '100' };
  assert.ok(checkDetails(choose, ctx).bundleQuantity);
  const dates = { ...pct, percent: '10', startMode: 'date', startDate: '2026-11-20', endMode: 'date', endDate: '2026-11-19' };
  assert.equal(checkDetails(dates, ctx).endDate, 'آخر يوم لازم يكون بعد أول يوم');
  const past = { ...pct, endMode: 'date', endDate: '2026-11-10' };
  assert.ok(checkPublish(past, ctx, null).endDate);
  assert.deepEqual(checkPublish({ ...past, endDate: today }, ctx, null), {});
  const gift = { ...withType(emptyForm(), 'buy_x_get_y'), scope: 'all', rewardMode: 'custom' };
  assert.ok(checkProducts(gift, ctx).rewards);
  assert.deepEqual(checkProducts({ ...gift, rewardProductIds: ['c'] }, ctx), {});
});

test('a locked offer skips term checks; names are suggested from the form', () => {
  const p = promo({ terms_locked: true });
  const f = { ...formFromPromotion(p), percent: '' };
  assert.deepEqual(checkDetails(f, { ...ctx, locked: true }), {});
  const n = { productName: (id) => ({ a: 'سيروم' })[id], categoryName: (id) => ({ skin: 'البشرة' })[id] };
  assert.equal(suggestName({ ...withType(emptyForm(), 'percentage'), percent: '15', scope: 'categories', categoryIds: ['skin'] }, n), 'خصم 15% على البشرة');
  assert.equal(suggestName({ ...withType(emptyForm(), 'free_shipping'), minSubtotal: '800' }, n), 'شحن مجاني فوق 800 ج.م');
  assert.equal(suggestName({ ...withType(emptyForm(), 'bundle_choose'), bundlePrice: '600' }, n), 'اختاري 3 منتجات بـ 600 ج.م');
});
