// The offer form's model: the seven offer types, the form state, defaults,
// conversion to and from the existing API payloads (PromotionInput for cart
// offers, /offers for sale prices) and client-side checks that mirror the
// backend's (routers/promotions.py _clean_config/_validate, routers/offers.py,
// schemas.PromotionIn / OfferCreate). The backend stays the authority.
// Only type imports from the API module, so it runs under `node --test`.
import type { Promotion, PromotionInput, PromotionStatus, PromotionType } from '../../lib/api';
import { addDays, cairoDate, isDay } from './dates.ts';
import { priceFromPercent, percentOff } from './offerMath.ts';

export type WizardType = 'product_price' | 'percentage' | 'fixed_amount' | 'bundle_fixed' | 'bundle_choose' | 'buy_x_get_y' | 'free_shipping';

export const WIZARD_TYPES: WizardType[] = ['product_price', 'percentage', 'fixed_amount', 'bundle_fixed', 'bundle_choose', 'buy_x_get_y', 'free_shipping'];

export const TYPE_META: Record<WizardType, { label: string; hint: string }> = {
  product_price: { label: 'سعر مخفّض لمنتج', hint: 'سعر أقل لمنتج أو أكتر، بيظهر على صفحة المنتج' },
  percentage: { label: 'خصم نسبة', hint: 'مثال: خصم 15% على منتجات البشرة' },
  fixed_amount: { label: 'خصم مبلغ', hint: 'مثال: خصم 100 ج.م من الطلب' },
  bundle_fixed: { label: 'باقة ثابتة', hint: 'منتجات محددة مع بعض بسعر واحد' },
  bundle_choose: { label: 'باقة «اختاري»', hint: 'مثال: اختاري 3 منتجات بـ 600 ج.م' },
  buy_x_get_y: { label: 'اشتري وخدي هدية', hint: 'مثال: اشتري 2 وخدي 1 هدية' },
  free_shipping: { label: 'شحن مجاني', hint: 'الشحن مجاني لما الطلب يوصل لمبلغ معين' },
};

/** The API type a form type is saved as. */
export function apiType(t: WizardType): PromotionType | 'product_price' {
  return t === 'bundle_fixed' || t === 'bundle_choose' ? 'bundle' : t;
}

export type Scope = 'products' | 'categories' | 'all';

export interface OfferForm {
  type: WizardType | null;
  name: string;
  /** The employee typed a name — stop suggesting one. */
  nameEdited: boolean;
  scope: Scope;
  productIds: string[];
  categoryIds: string[];
  /** Fixed bundle: units of each product in one bundle. */
  quantities: Record<string, number>;
  rewardMode: 'same' | 'custom';
  rewardProductIds: string[];
  rewardCategoryIds: string[];
  /** Sale price: the shared percentage (a helper that fills the rows). */
  salePercent: string;
  /** Sale price: the final price of each product. */
  salePrices: Record<string, string>;
  percent: string;
  maxDiscount: string;
  maxQuantity: string;
  amount: string;
  applyPer: 'order' | 'item';
  bundlePrice: string;
  bundleQuantity: string;
  distinct: boolean;
  allowMultiple: boolean;
  maxBundles: string;
  buyQuantity: string;
  getQuantity: string;
  rewardChoice: 'cheapest' | 'most_expensive';
  giftAllowMultiple: boolean;
  maxRewards: string;
  basis: 'after' | 'before';
  cities: string[];
  requireAll: boolean;
  minSubtotal: string;
  usageLimit: string;
  perCustomer: string;
  priority: string;
  combinable: boolean;
  badge: string;
  description: string;
  startMode: 'now' | 'date';
  startDate: string;
  endMode: 'none' | 'week' | 'month' | 'date';
  endDate: string;
  /** Editing: the dates were changed (otherwise the stored instants are sent back as they are). */
  datesTouched: boolean;
}

export function emptyForm(): OfferForm {
  return {
    type: null, name: '', nameEdited: false, scope: 'products', productIds: [], categoryIds: [], quantities: {},
    rewardMode: 'same', rewardProductIds: [], rewardCategoryIds: [], salePercent: '', salePrices: {},
    percent: '', maxDiscount: '', maxQuantity: '', amount: '', applyPer: 'order', bundlePrice: '', bundleQuantity: '3',
    distinct: false, allowMultiple: true, maxBundles: '', buyQuantity: '2', getQuantity: '1', rewardChoice: 'cheapest',
    giftAllowMultiple: true, maxRewards: '', basis: 'after', cities: [], requireAll: false, minSubtotal: '', usageLimit: '',
    perCustomer: '', priority: '0', combinable: false, badge: '', description: '', startMode: 'now', startDate: '',
    endMode: 'none', endDate: '', datesTouched: false,
  };
}

/** A new type keeps what still makes sense (products, name, dates and the
 * shared settings) and resets the type's own settings. */
export function withType(form: OfferForm, t: WizardType): OfferForm {
  const base = emptyForm();
  const keep: Partial<OfferForm> = {
    name: form.name, nameEdited: form.nameEdited, productIds: form.productIds, categoryIds: form.categoryIds,
    scope: form.scope, startMode: form.startMode, startDate: form.startDate, endMode: form.endMode, endDate: form.endDate,
    datesTouched: form.datesTouched, usageLimit: form.usageLimit, perCustomer: form.perCustomer, priority: form.priority,
    combinable: form.combinable, badge: form.badge, description: form.description,
  };
  const next: OfferForm = { ...base, ...keep, type: t };
  if (t === 'product_price' || t === 'bundle_fixed') {
    next.scope = 'products';
    next.categoryIds = [];
  }
  if (t === 'bundle_fixed') next.quantities = Object.fromEntries(next.productIds.map((id) => [id, 1]));
  if (t === 'free_shipping' && form.type === null) next.scope = 'all';
  return next;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The form for an existing cart offer (as the API returns it). */
export function formFromPromotion(p: Promotion): OfferForm {
  const c = (p.config ?? {}) as Record<string, unknown>;
  const f = emptyForm();
  const t: WizardType = p.type === 'bundle' ? (c.mode === 'combination' ? 'bundle_fixed' : 'bundle_choose') : (p.type as WizardType);
  f.type = t;
  f.name = p.name;
  f.nameEdited = true;
  f.productIds = p.eligible_products.map((x) => x.id);
  f.categoryIds = p.eligible_categories.map((x) => x.id);
  f.scope = f.categoryIds.length ? 'categories' : f.productIds.length ? 'products' : 'all';
  f.quantities = Object.fromEntries(p.eligible_products.map((x) => [x.id, x.quantity || 1]));
  f.rewardProductIds = p.reward_products.map((x) => x.id);
  f.rewardCategoryIds = p.reward_categories.map((x) => x.id);
  f.rewardMode = f.rewardProductIds.length || f.rewardCategoryIds.length ? 'custom' : 'same';
  f.percent = str(c.percent);
  f.maxDiscount = str(c.max_discount);
  f.maxQuantity = str(c.max_quantity);
  f.amount = str(c.amount);
  f.applyPer = c.apply_per === 'item' ? 'item' : 'order';
  f.bundlePrice = str(c.bundle_price);
  f.bundleQuantity = str(c.bundle_quantity) || '3';
  f.distinct = Boolean(c.distinct_products);
  f.allowMultiple = c.allow_multiple !== false;
  f.maxBundles = str(c.max_bundles);
  f.buyQuantity = str(c.buy_quantity) || '2';
  f.getQuantity = str(c.get_quantity) || '1';
  f.rewardChoice = c.reward_choice === 'most_expensive' ? 'most_expensive' : 'cheapest';
  f.giftAllowMultiple = c.allow_multiple !== false;
  f.maxRewards = str(c.max_rewards);
  f.basis = c.basis === 'before' ? 'before' : 'after';
  f.cities = Array.isArray(c.cities) ? (c.cities as string[]) : [];
  f.requireAll = Boolean(c.require_all_eligible);
  f.minSubtotal = str(p.min_subtotal);
  f.usageLimit = str(p.usage_limit);
  f.perCustomer = str(p.per_customer_limit);
  f.priority = String(p.priority ?? 0);
  f.combinable = Boolean(p.combinable);
  f.badge = p.badge_text ?? '';
  f.description = p.description ?? '';
  const start = cairoDate(p.starts_at);
  const end = cairoDate(p.ends_at, true);
  f.startMode = start ? 'date' : 'now';
  f.startDate = start;
  f.endMode = end ? 'date' : 'none';
  f.endDate = end;
  return f;
}

/** The form for an existing sale price (a "product_offer" row of the list). */
export function formFromSaleOffer(p: Promotion): OfferForm {
  const c = (p.config ?? {}) as Record<string, unknown>;
  const f = emptyForm();
  const productId = String(c.product_id);
  const price = Number(c.offer_price);
  f.type = 'product_price';
  f.name = p.name;
  f.nameEdited = true;
  f.productIds = [productId];
  f.salePrices = { [productId]: str(price) };
  f.salePercent = String(percentOff(Number(c.original_price), price));
  const end = cairoDate(p.ends_at, true);
  f.endMode = end ? 'date' : 'none';
  f.endDate = end;
  return f;
}

/** Last day the offer runs ("YYYY-MM-DD") or null (no end). */
export function lastDay(f: OfferForm, today: string): string | null {
  if (f.endMode === 'week') return addDays(today, 6);
  if (f.endMode === 'month') return addDays(today, 29);
  if (f.endMode === 'date') return f.endDate || null;
  return null;
}

/** First day ("YYYY-MM-DD") or null (from now). Sale prices have none. */
export function firstDay(f: OfferForm): string | null {
  return f.type !== 'product_price' && f.startMode === 'date' ? f.startDate || null : null;
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** Targets the form sends for its type and scope. */
export function targetsOf(f: OfferForm) {
  const scoped = f.scope === 'all' ? { p: [], c: [] } : f.scope === 'categories' ? { p: f.productIds, c: f.categoryIds } : { p: f.productIds, c: [] };
  const fixed = f.type === 'bundle_fixed';
  const gift = f.type === 'buy_x_get_y' && f.rewardMode === 'custom';
  return {
    eligible_product_ids: fixed ? f.productIds : scoped.p,
    eligible_category_ids: fixed ? [] : scoped.c,
    reward_product_ids: gift ? f.rewardProductIds : [],
    reward_category_ids: gift ? f.rewardCategoryIds : [],
    product_quantities: fixed ? Object.fromEntries(f.productIds.map((id) => [id, Math.max(1, Math.floor(f.quantities[id] || 1))])) : {},
  };
}

/** Only the known settings of the type (the server cleans them again). */
export function configOf(f: OfferForm): Record<string, unknown> {
  switch (f.type) {
    case 'percentage':
      return { percent: num(f.percent), max_discount: num(f.maxDiscount), max_quantity: num(f.maxQuantity) };
    case 'fixed_amount':
      return { amount: num(f.amount), apply_per: f.applyPer, max_quantity: f.applyPer === 'item' ? num(f.maxQuantity) : null };
    case 'bundle_fixed':
      return { mode: 'combination', bundle_price: num(f.bundlePrice), allow_multiple: f.allowMultiple, max_bundles: num(f.maxBundles) };
    case 'bundle_choose':
      return {
        mode: 'any', bundle_quantity: num(f.bundleQuantity), bundle_price: num(f.bundlePrice), distinct_products: f.distinct,
        allow_multiple: f.allowMultiple, max_bundles: num(f.maxBundles),
      };
    case 'buy_x_get_y':
      return {
        buy_quantity: num(f.buyQuantity), get_quantity: num(f.getQuantity), reward_choice: f.rewardChoice,
        allow_multiple: f.giftAllowMultiple, max_rewards: num(f.maxRewards),
      };
    case 'free_shipping':
      return { basis: f.basis, cities: f.cities, require_all_eligible: f.scope !== 'all' && f.requireAll };
    default:
      return {};
  }
}

/** The PromotionInput for a cart offer. An offer an order already used
 * (`terms_locked`) sends its stored terms back exactly as loaded — the
 * server compares them (update_promotion → _terms) and only name,
 * description, badge, status, dates, priority, combining and limits may
 * change. Untouched dates of an edited offer are sent back as stored. */
export function toPromotionInput(f: OfferForm, opts: { status: PromotionStatus; original: Promotion | null; today: string }): PromotionInput {
  const { status, original, today } = opts;
  const keepDates = original && !f.datesTouched;
  const common = {
    name: f.name.trim(),
    description: f.description.trim() || null,
    badge_text: f.badge.trim() || null,
    status,
    starts_at: keepDates ? original!.starts_at : firstDay(f),
    ends_at: keepDates ? original!.ends_at : lastDay(f, today),
    priority: Number(f.priority) || 0,
    combinable: f.combinable,
    usage_limit: num(f.usageLimit),
    per_customer_limit: num(f.perCustomer),
  };
  if (original?.terms_locked) {
    return {
      ...common,
      type: original.type as PromotionType,
      config: original.config,
      min_subtotal: original.min_subtotal,
      eligible_product_ids: original.eligible_products.map((x) => x.id),
      eligible_category_ids: original.eligible_categories.map((x) => x.id),
      reward_product_ids: original.reward_products.map((x) => x.id),
      reward_category_ids: original.reward_categories.map((x) => x.id),
      product_quantities: Object.fromEntries(original.eligible_products.map((x) => [x.id, x.quantity || 1])),
    };
  }
  return { ...common, type: apiType(f.type!) as PromotionType, config: configOf(f), min_subtotal: num(f.minSubtotal), ...targetsOf(f) };
}

/** The final sale price of a product, or NaN when not a valid number. */
export function salePriceOf(f: OfferForm, productId: string): number {
  const s = (f.salePrices[productId] ?? '').trim();
  return s === '' ? NaN : Number(s);
}

/** Fill every row from the shared percentage (rounded to whole pounds). */
export function applySalePercent(f: OfferForm, regularOf: (id: string) => number | undefined, percent: string): OfferForm {
  const p = Number(percent);
  const prices = { ...f.salePrices };
  if (percent.trim() !== '' && p > 0 && p < 100) {
    for (const id of f.productIds) {
      const regular = regularOf(id);
      if (regular !== undefined) prices[id] = String(priceFromPercent(regular, p));
    }
  }
  return { ...f, salePercent: percent, salePrices: prices };
}

// ---------------------------------------------------------------- checks
export type Errors = Record<string, string>;

const isNum = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
function positive(e: Errors, key: string, s: string, label: string, opts: { max?: number; required?: boolean } = {}) {
  const { max = 10_000_000, required = true } = opts;
  if (s.trim() === '') {
    if (required) e[key] = `اكتبي ${label}`;
    return;
  }
  const n = Number(s);
  if (!isNum(s) || !(n > 0) || n > max) e[key] = `${label} لازم يكون أكبر من 0${max < 10_000_000 ? ` ومش أكتر من ${max}` : ''}`;
}
function whole(e: Errors, key: string, s: string, label: string, lo: number, hi: number, required = true) {
  if (s.trim() === '') {
    if (required) e[key] = `اكتبي ${label}`;
    return;
  }
  const n = Number(s);
  if (!isNum(s) || !Number.isInteger(n) || n < lo || n > hi) e[key] = `${label} لازم يكون رقم صحيح من ${lo} لـ ${hi}`;
}

export interface CheckContext {
  /** Regular price of a product (products.sale_price), by id. */
  regularOf: (id: string) => number | undefined;
  today: string;
  /** Terms of an offer an order already used can't change (not checked). */
  locked: boolean;
}

/** Step 2 — what the offer covers. */
export function checkProducts(f: OfferForm, ctx: CheckContext): Errors {
  const e: Errors = {};
  if (ctx.locked) return e;
  if (f.type === 'product_price') {
    if (!f.productIds.length) e.products = 'اختاري منتج واحد على الأقل';
  } else if (f.type === 'bundle_fixed') {
    if (!f.productIds.length) e.products = 'اختاري منتجات الباقة';
    else {
      const bad = f.productIds.some((id) => !Number.isInteger(f.quantities[id] ?? 1) || (f.quantities[id] ?? 1) < 1 || (f.quantities[id] ?? 1) > 50);
      const units = f.productIds.reduce((s, id) => s + (f.quantities[id] ?? 1), 0);
      if (bad) e.quantities = 'الكمية من كل منتج في الباقة لازم تكون من 1 لـ 50';
      else if (units < 2) e.quantities = 'الباقة لازم يكون فيها قطعتين على الأقل';
    }
  } else if (f.scope === 'products' && !f.productIds.length) {
    e.products = 'اختاري منتج واحد على الأقل — أو اختاري «كل المنتجات»';
  } else if (f.scope === 'categories' && !f.categoryIds.length) {
    e.categories = 'اختاري فئة واحدة على الأقل';
  }
  if (f.productIds.length > 500) e.products = 'أقصى عدد 500 منتج';
  if (f.categoryIds.length > 200) e.categories = 'أقصى عدد 200 فئة';
  if (f.type === 'buy_x_get_y' && f.rewardMode === 'custom' && !f.rewardProductIds.length && !f.rewardCategoryIds.length) {
    e.rewards = 'اختاري منتجات أو فئات الهدية — أو «نفس المنتجات اللي بتتشرى»';
  }
  return e;
}

/** Step 3 — the type's settings, the name and the dates. */
export function checkDetails(f: OfferForm, ctx: CheckContext): Errors {
  const e: Errors = {};
  const name = f.name.trim();
  if (!name) e.name = f.type === 'product_price' ? 'اكتبي عنوان العرض — ده اللي العملاء بيشوفوه جنب السعر' : 'اكتبي اسم للعرض';
  else if (name.length > 120) e.name = 'الاسم مش أكتر من 120 حرف';
  if (f.badge.length > 40) e.badge = 'نص الشارة مش أكتر من 40 حرف';
  if (f.description.length > 1000) e.description = 'الوصف مش أكتر من 1000 حرف';

  if (f.type !== 'product_price' && f.startMode === 'date' && !isDay(f.startDate)) e.startDate = 'اختاري أول يوم';
  if (f.endMode === 'date' && !isDay(f.endDate)) e.endDate = 'اختاري آخر يوم';
  const first = firstDay(f);
  const last = lastDay(f, ctx.today);
  if (first && last && isDay(first) && isDay(last) && first > last) e.endDate = 'آخر يوم لازم يكون بعد أول يوم';

  if (f.type === 'product_price') {
    for (const id of f.productIds) {
      const price = salePriceOf(f, id);
      const regular = ctx.regularOf(id);
      if (!Number.isFinite(price) || !(price > 0)) e[`sale:${id}`] = 'اكتبي سعر العرض';
      else if (regular !== undefined && price >= regular) e[`sale:${id}`] = 'سعر العرض لازم يكون أقل من السعر الأصلي';
    }
    if (f.salePercent.trim() !== '' && !(Number(f.salePercent) > 0 && Number(f.salePercent) < 100)) e.salePercent = 'النسبة من 1 لـ 99';
    return e;
  }

  if (!ctx.locked) {
    switch (f.type) {
      case 'percentage':
        positive(e, 'percent', f.percent, 'نسبة الخصم', { max: 100 });
        positive(e, 'maxDiscount', f.maxDiscount, 'أقصى خصم', { required: false });
        whole(e, 'maxQuantity', f.maxQuantity, 'أقصى عدد قطع', 1, 1000, false);
        break;
      case 'fixed_amount':
        positive(e, 'amount', f.amount, 'مبلغ الخصم');
        if (f.applyPer === 'item') whole(e, 'maxQuantity', f.maxQuantity, 'أقصى عدد قطع', 1, 1000, false);
        break;
      case 'bundle_fixed': {
        positive(e, 'bundlePrice', f.bundlePrice, 'سعر الباقة');
        const regular = f.productIds.reduce((s, id) => s + (ctx.regularOf(id) ?? 0) * (f.quantities[id] ?? 1), 0);
        if (!e.bundlePrice && Number(f.bundlePrice) >= regular) e.bundlePrice = 'سعر الباقة لازم يكون أقل من مجموع أسعار منتجاتها';
        whole(e, 'maxBundles', f.maxBundles, 'أقصى عدد باقات', 1, 100, false);
        break;
      }
      case 'bundle_choose':
        whole(e, 'bundleQuantity', f.bundleQuantity, 'عدد منتجات الباقة', 2, 50);
        positive(e, 'bundlePrice', f.bundlePrice, 'سعر الباقة');
        whole(e, 'maxBundles', f.maxBundles, 'أقصى عدد باقات', 1, 100, false);
        break;
      case 'buy_x_get_y':
        whole(e, 'buyQuantity', f.buyQuantity, 'عدد القطع اللي بتتشرى', 1, 50);
        whole(e, 'getQuantity', f.getQuantity, 'عدد القطع الهدية', 1, 50);
        whole(e, 'maxRewards', f.maxRewards, 'أقصى عدد هدايا', 1, 100, false);
        break;
      default:
        break;
    }
    if (f.minSubtotal.trim() !== '' && (!isNum(f.minSubtotal) || Number(f.minSubtotal) < 0 || Number(f.minSubtotal) > 10_000_000)) {
      e.minSubtotal = 'الحد الأدنى للطلب لازم يكون رقم من 0';
    }
  }
  whole(e, 'usageLimit', f.usageLimit, 'أقصى عدد طلبات', 1, 10_000_000, false);
  whole(e, 'perCustomer', f.perCustomer, 'عدد المرات لكل عميل', 1, 10_000, false);
  whole(e, 'priority', f.priority.trim() === '' ? '0' : f.priority, 'الأولوية', -1000, 1000);
  return e;
}

/** Publishing (or keeping live) an offer whose last day has passed — the
 * server refuses it too (_check_can_go_live). */
export function checkPublish(f: OfferForm, ctx: CheckContext, original: Promotion | null): Errors {
  const e: Errors = {};
  const keepDates = original && !f.datesTouched;
  const last = keepDates ? (original!.ends_at ? cairoDate(original!.ends_at, true) : null) : lastDay(f, ctx.today);
  if (last && last < ctx.today) e.endDate = 'آخر يوم للعرض فات — غيّريه قبل النشر';
  return e;
}

/** Which step a field lives on (to send the employee back to it). */
export function stepOfField(key: string): 1 | 2 | 3 {
  if (key === 'type') return 1;
  if (['products', 'categories', 'quantities', 'rewards'].includes(key)) return 2;
  return 3;
}

/** Known backend messages → the step that fixes them. */
export function stepOfServerMessage(message: string): 1 | 2 | 3 | 4 {
  if (/منتج مختار|فئة مختارة|الباقة الثابتة|قطعتين|الكمية من كل منتج|منتجات الهدية|المنتج غير موجود/.test(message)) return 2;
  if (/اسم|عنوان|تاريخ|نسبة|مبلغ|سعر|عدد|أقصى|محافظات|الحد|الأولوية/.test(message)) return 3;
  return 4;
}

// ---------------------------------------------------------------- names
export interface NameContext {
  productName: (id: string) => string | undefined;
  categoryName: (id: string) => string | undefined;
}

function scopeLabel(f: OfferForm, n: NameContext): string {
  if (f.scope === 'all') return 'كل المنتجات';
  if (f.scope === 'categories') {
    if (f.categoryIds.length === 1 && !f.productIds.length) return n.categoryName(f.categoryIds[0]) ?? 'فئة';
    return `${f.categoryIds.length} فئات`;
  }
  if (f.productIds.length === 1) return n.productName(f.productIds[0]) ?? 'منتج';
  return `${f.productIds.length} منتجات`;
}

/** A name that says what the offer gives (the employee can change it). */
export function suggestName(f: OfferForm, n: NameContext): string {
  const v = (s: string) => (isNum(s) ? String(Number(s)) : '');
  switch (f.type) {
    case 'product_price':
      return v(f.salePercent) ? `خصم ${v(f.salePercent)}%` : 'سعر عرض';
    case 'percentage':
      return v(f.percent) ? `خصم ${v(f.percent)}% على ${scopeLabel(f, n)}` : `خصم على ${scopeLabel(f, n)}`;
    case 'fixed_amount':
      return v(f.amount) ? `خصم ${v(f.amount)} ج.م على ${scopeLabel(f, n)}` : `خصم على ${scopeLabel(f, n)}`;
    case 'bundle_fixed': {
      const names = f.productIds.slice(0, 3).map((id) => n.productName(id) ?? 'منتج');
      return `باقة ${names.join(' + ')}${f.productIds.length > 3 ? ' +' : ''}`.slice(0, 120);
    }
    case 'bundle_choose':
      return v(f.bundlePrice) ? `اختاري ${v(f.bundleQuantity) || 'N'} منتجات بـ ${v(f.bundlePrice)} ج.م` : `اختاري ${v(f.bundleQuantity) || 'N'} منتجات`;
    case 'buy_x_get_y':
      return `اشتري ${v(f.buyQuantity) || 'X'} وخدي ${v(f.getQuantity) || 'Y'} هدية`;
    case 'free_shipping':
      return v(f.minSubtotal) && Number(f.minSubtotal) > 0 ? `شحن مجاني فوق ${v(f.minSubtotal)} ج.م` : 'شحن مجاني';
    default:
      return '';
  }
}
