import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import { api, apiErrorMessage, offersApi, promotionsApi, type Offer, type Promotion, type PromotionStatus } from '../../lib/api';
import BulkResults from './BulkResults';
import {
  IncompleteSnapshot, confirmCreated, confirmNotCreated, knownFrom, loadSaleSnapshot, runBulk, type BulkDeps, type BulkItem,
} from './bulkSalePrice';
import { cairoToday } from './dates';
import type { PricedProduct } from './offerMath';
import {
  applySalePercent, checkDetails, checkProducts, checkPublish, emptyForm, formFromPromotion, formFromSaleOffer, lastDay,
  salePriceOf, stepOfField, stepOfServerMessage, suggestName, toPromotionInput, withType, type Errors, type OfferForm, type WizardType,
} from './offerTypes';
import { findWarnings, ruleFromForm, ruleFromPromotion } from './overlap';
import StepDetails from './StepDetails';
import StepProducts from './StepProducts';
import StepReview from './StepReview';
import StepType from './StepType';
import { useLookups, useMarket } from './useOfferData';
import type { WizardCtx } from './wizardContext';

type Step = 1 | 2 | 3 | 4;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'النوع' }, { n: 2, label: 'المنتجات' }, { n: 3, label: 'التفاصيل والمدة' }, { n: 4, label: 'المراجعة' },
];

/** One request per product, with a timeout so a lost answer is noticed
 * (POST /offers — the same endpoint as offersApi.create). */
const createSaleOffer = (payload: BulkItem['payload']) => api.post<Offer>('/offers/', payload, { timeout: 20_000 }).then((r) => r.data);
const listSalePage = (offset: number, limit: number) =>
  promotionsApi.list({ type: 'product_price', sort: 'oldest', limit, offset }).then((r) => ({ items: r.items, total: r.total }));

/**
 * The offer form: one modal, four short steps (type → products → details
 * and dates → review). New offers start at step 1, existing ones at the
 * review. Cart offers save through /promotions, sale prices through /offers
 * (several products: one offer each — bulkSalePrice.ts).
 */
export default function OfferWizard({ offer, onClose, onSaved, onDuplicate }: {
  offer: Promotion | null;
  onClose: () => void;
  onSaved: (ids: string[], created: boolean) => void;
  /** Copy an offer whose terms are locked (it opens the copy). */
  onDuplicate: (p: Promotion) => Promise<void>;
}) {
  const today = useMemo(() => cairoToday(), []);
  const saleEdit = offer?.source === 'product_offer';
  const locked = Boolean(offer?.terms_locked);
  const initial = useMemo<OfferForm>(() => (offer ? (saleEdit ? formFromSaleOffer(offer) : formFromPromotion(offer)) : emptyForm()), [offer, saleEdit]);
  const [form, setForm] = useState<OfferForm>(initial);
  const [step, setStep] = useState<Step>(offer ? 4 : 1);
  const [reached, setReached] = useState<Step>(offer ? 4 : 1);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; step: Step; locked409?: boolean } | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<boolean | null>(null); // is_active of the pending multi-product save
  const [bulk, setBulk] = useState<{ items: BulkItem[]; busy: boolean } | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const known = useRef<Map<string, Set<string>>>(new Map());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const lookups = useLookups();
  const market = useMarket();
  const byId = useMemo(() => new Map(lookups.products.map((p) => [p.id, p])), [lookups.products]);
  const runningSale = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of market.offers ?? []) {
      if (o.source === 'product_offer' && o.state === 'active' && o.id !== offer?.id) m.set(String(o.config.product_id), Number(o.config.offer_price));
    }
    return m;
  }, [market.offers, offer]);
  const priced = useCallback((id: string): PricedProduct | undefined => {
    const p = byId.get(id);
    if (!p) return undefined;
    const sale = runningSale.get(id);
    return { id, name: p.name, regular: p.sale_price, current: sale !== undefined && sale < p.sale_price ? sale : p.sale_price };
  }, [byId, runningSale]);
  // "From today" starts when the form was opened (overlap dates only).
  const [openedAt] = useState(() => Date.now());
  const regularOf = (id: string) => byId.get(id)?.sale_price;
  const nameCtx = { productName: (id: string) => byId.get(id)?.name, categoryName: (id: string) => lookups.categories.find((c) => c.id === id)?.name };

  function update(patch: Partial<OfferForm>) {
    setServerError(null);
    setForm((prev) => {
      let next: OfferForm = { ...prev, ...patch };
      if ('salePercent' in patch) next = applySalePercent(next, regularOf, patch.salePercent ?? '');
      if ('productIds' in patch && next.type === 'product_price') {
        const pct = Number(next.salePercent);
        const fill = { ...next.salePrices };
        for (const id of next.productIds) {
          const regular = regularOf(id);
          if (fill[id] === undefined && regular !== undefined && pct > 0 && pct < 100) fill[id] = String(Math.round(regular * (1 - pct / 100)));
        }
        next = { ...next, salePrices: fill };
      }
      if (!next.nameEdited) next = { ...next, name: suggestName(next, nameCtx) };
      return next;
    });
  }

  function pickType(t: WizardType) {
    setServerError(null);
    setForm((prev) => {
      if (prev.type === t) return prev;
      const next = withType(prev, t);
      return next.nameEdited ? next : { ...next, name: suggestName(next, nameCtx) };
    });
    if (!offer) go(2);
  }

  const ctx = { regularOf, today, locked };
  const e2 = checkProducts(form, ctx);
  const e3 = checkDetails(form, ctx);
  const errors: Errors = { ...(shown.has(2) ? e2 : {}), ...(shown.has(3) ? e3 : {}), ...(shown.has(4) ? publishErrors() : {}) };
  function publishErrors(): Errors {
    return checkPublish(form, ctx, offer);
  }

  // Archived products can't be bought, so they never make offers meet.
  const catalog = useMemo(() => lookups.products.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, category_id: p.category_id })), [lookups.products]);
  const existing = useMemo(() => (market.offers ?? []).map(ruleFromPromotion), [market.offers]);
  const warnings = useMemo(() => {
    if (!market.offers || !form.type) return [];
    return findWarnings(ruleFromForm(form, offer, today, openedAt), existing, catalog);
  }, [form, offer, today, existing, catalog, market.offers, openedAt]);

  const pool = useMemo(() => {
    const inScope = (p: { id: string; category_id: string; is_active: boolean }) => {
      if (!p.is_active) return false;
      if (form.type === 'product_price' || form.type === 'bundle_fixed' || form.scope === 'products') return form.productIds.includes(p.id);
      if (form.scope === 'categories') return form.categoryIds.includes(p.category_id) || form.productIds.includes(p.id);
      return true;
    };
    return lookups.products.filter(inScope).flatMap((p) => { const x = priced(p.id); return x ? [x] : []; });
  }, [lookups.products, form.type, form.scope, form.productIds, form.categoryIds, priced]);

  const w: WizardCtx = {
    form, update, errors, products: lookups.products, categories: lookups.categories, rates: lookups.rates, byId, priced, pool,
    original: offer, locked, today, warnings, marketError: market.error, marketLoading: !market.offers && !market.error,
  };

  const bulkOpen = bulk !== null;
  useEffect(() => { headingRef.current?.focus(); }, [step, bulkOpen]);

  function go(s: Step) {
    setStep(s);
    setReached((r) => (s > r ? s : r));
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('.wizard [aria-invalid="true"], .wizard .field-error');
      el?.scrollIntoView({ block: 'center' });
      if (el && el.matches('input, select, textarea')) el.focus();
    });
  }

  /** Forward to `target` (default: the next step) — every step on the way
   * must be complete; the first one that isn't is shown with its problems. */
  function next(target: Step = (step + 1) as Step) {
    if (!form.type) return;
    for (let s = step; s < target; s++) {
      const errs = s === 2 ? e2 : s === 3 ? e3 : {};
      if (Object.keys(errs).length) {
        if (s !== step) go(s as Step);
        setShown((prev) => new Set(prev).add(s));
        focusFirstError();
        return;
      }
    }
    go(target);
  }

  /** Everything checked before a save; false (and the step shown) on a problem. */
  function readyToSave(publishing: boolean): boolean {
    const all: Errors = { ...e2, ...e3, ...(publishing ? publishErrors() : {}) };
    const keys = Object.keys(all);
    if (!keys.length) return true;
    setShown(new Set([2, 3, 4]));
    go(stepOfField(keys[0]) as Step);
    focusFirstError();
    return false;
  }

  async function saveCart(status: PromotionStatus) {
    if (!readyToSave(status === 'active')) return;
    setSaving(true);
    setServerError(null);
    try {
      const body = toPromotionInput(form, { status, original: offer, today });
      const saved = offer ? await promotionsApi.update(offer.id, body) : await promotionsApi.create(body);
      onSaved([saved.id], !offer);
    } catch (err) {
      const status409 = (err as { response?: { status?: number } })?.response?.status === 409;
      const message = apiErrorMessage(err, 'تعذر حفظ العرض — حاولي تاني');
      setServerError({ message, step: status409 ? 4 : stepOfServerMessage(message), locked409: status409 });
    } finally {
      setSaving(false);
    }
  }

  async function saveSaleEdit(active: boolean) {
    if (!offer || !readyToSave(active)) return;
    const pid = form.productIds[0];
    setSaving(true);
    setServerError(null);
    try {
      await offersApi.update(offer.id, {
        title: form.name.trim(), offer_price: salePriceOf(form, pid), is_active: active,
        ...(form.datesTouched ? { expires_at: lastDay(form, today) } : {}),
      });
      onSaved([offer.id], false);
    } catch (err) {
      const message = apiErrorMessage(err, 'تعذر حفظ العرض — حاولي تاني');
      setServerError({ message, step: stepOfServerMessage(message) });
    } finally {
      setSaving(false);
    }
  }

  const deps: BulkDeps = { create: createSaleOffer, listPage: listSalePage, messageOf: (e) => apiErrorMessage(e, 'تعذر حفظ العرض') };

  async function startBulk(active: boolean) {
    setConfirmBulk(null);
    if (!readyToSave(active)) return;
    const end = lastDay(form, today);
    const items: BulkItem[] = form.productIds.map((pid) => ({
      productId: pid, productName: byId.get(pid)?.name ?? 'منتج', status: 'pending',
      payload: { product_id: pid, title: form.name.trim(), offer_price: salePriceOf(form, pid), expires_at: end, is_active: active },
    }));
    setSnapshotError(null);
    setBulk({ items, busy: true });
    try {
      known.current = knownFrom(await loadSaleSnapshot(listSalePage));
    } catch (err) {
      setBulk(null);
      setSnapshotError(err instanceof IncompleteSnapshot
        ? 'ما قدرناش نحمّل كل أسعار العروض الموجودة عشان نتأكد من الحفظ — ما اتبعتش ولا عرض. حاولي تاني.'
        : 'تعذر الحفظ — ما اتبعتش ولا عرض. حاولي تاني.');
      return;
    }
    const done = await runBulk(items, deps, known.current, (list) => setBulk({ items: list, busy: true }));
    setBulk({ items: done, busy: false });
    if (done.length === 1 && done[0].status === 'created') onSaved([done[0].offerId!], true);
  }

  async function retryBulk() {
    if (!bulk) return;
    setBulk({ ...bulk, busy: true });
    const done = await runBulk(bulk.items, deps, known.current, (list) => setBulk({ items: list, busy: true }));
    setBulk({ items: done, busy: false });
  }

  function finishBulk() {
    if (!bulk || bulk.busy) return;
    const ids = bulk.items.filter((i) => i.status === 'created' && i.offerId).map((i) => i.offerId!);
    onSaved(ids, true);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  function requestClose() {
    if (saving) return;
    if (bulk) {
      if (!bulk.busy) finishBulk();
      return;
    }
    if (dirty) setAskDiscard(true);
    else onClose();
  }

  // ---------------------------------------------------------------- footer buttons
  function saveButtons() {
    const sale = form.type === 'product_price';
    if (sale && !saleEdit) {
      const n = form.productIds.length;
      const save = (active: boolean) => (n > 1 ? setConfirmBulk(active) : startBulk(active));
      return (
        <>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(true)}>تفعيل ونشر</button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => save(false)}>حفظ من غير تفعيل</button>
        </>
      );
    }
    if (saleEdit) {
      return offer?.status === 'active' ? (
        <>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveSaleEdit(true)}>حفظ التعديلات</button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveSaleEdit(false)}>حفظ وإيقاف</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveSaleEdit(true)}>تفعيل ونشر</button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveSaleEdit(false)}>حفظ من غير تفعيل</button>
        </>
      );
    }
    if (!offer) {
      return (
        <>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveCart('active')}>نشر العرض</button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveCart('draft')}>حفظ كمسودة</button>
        </>
      );
    }
    return offer.status === 'active' ? (
      <>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveCart('active')}>حفظ التعديلات</button>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveCart('inactive')}>حفظ وإيقاف</button>
      </>
    ) : (
      <>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveCart('active')}>نشر العرض</button>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => saveCart(offer.status)}>{offer.status === 'draft' ? 'حفظ كمسودة' : 'حفظ (موقّف)'}</button>
      </>
    );
  }

  const title = offer ? `تعديل «${offer.name}»` : 'إنشاء عرض';
  const canRetry = bulk && !bulk.busy && bulk.items.some((i) => i.status === 'rejected' || i.status === 'not_created');
  const unresolved = bulk ? bulk.items.filter((i) => i.status === 'unresolved').length : 0;

  return (
    <Modal title={title} onClose={requestClose} wide>
      <div className="wizard">
        {!bulk && (
          <ol className="wiz-steps" aria-label="خطوات العرض">
            {STEPS.map((s) => (
              <li key={s.n}>
                <button type="button" aria-current={step === s.n ? 'step' : undefined} disabled={s.n > reached || saving}
                  onClick={() => (s.n < step ? go(s.n) : s.n > step ? next(s.n) : undefined)}>
                  <span className="wiz-num">{s.n.toLocaleString('ar-EG')}</span> {s.label}
                </button>
              </li>
            ))}
          </ol>
        )}

        {askDiscard && (
          <div className="discard" role="alertdialog" aria-label="تجاهل التغييرات">
            <span>تجاهلي التغييرات اللي عملتيها؟</span>
            <button type="button" className="btn btn-sm btn-danger" onClick={onClose}>أيوه، اقفلي</button>
            <button type="button" className="btn btn-sm" onClick={() => setAskDiscard(false)} autoFocus>كمّلي</button>
          </div>
        )}

        <h3 ref={headingRef} tabIndex={-1} className="wiz-heading">
          {bulk ? 'نتيجة الحفظ' : step === 1 ? 'اختاري نوع العرض' : step === 2 ? 'اختاري المنتجات' : step === 3 ? 'التفاصيل والمدة' : 'راجعي العرض'}
        </h3>

        {lookups.error && (
          <div className="error-banner" role="alert">{lookups.error} <button type="button" className="btn btn-sm" onClick={lookups.retry}>حاولي تاني</button></div>
        )}

        {bulk ? (
          <BulkResults items={bulk.items} busy={bulk.busy}
            onConfirmCreated={(pid, id) => setBulk({ ...bulk, items: confirmCreated(bulk.items, pid, id) })}
            onConfirmNotCreated={(pid) => setBulk({ ...bulk, items: confirmNotCreated(bulk.items, pid, known.current) })} />
        ) : step === 1 ? (
          <StepType w={w} onPick={pickType} />
        ) : !lookups.loaded && !lookups.error ? (
          <div className="empty-state" role="status">جاري التحميل...</div>
        ) : (
          <>
            {step === 2 && <StepProducts w={w} />}
            {step === 3 && <StepDetails w={w} />}
            {step === 4 && <StepReview w={w} goTo={(s) => go(s)} />}
          </>
        )}

        {snapshotError && <div className="error-banner" role="alert" style={{ marginTop: 10 }}>{snapshotError}</div>}
        {serverError && (
          <div className="error-banner" role="alert" style={{ marginTop: 10 }}>
            {serverError.message}
            {serverError.step !== step && serverError.step < 4 && (
              <> <button type="button" className="btn btn-sm" onClick={() => go(serverError.step)}>ارجعي للخطوة {serverError.step.toLocaleString('ar-EG')}</button></>
            )}
            {serverError.locked409 && offer && <> <button type="button" className="btn btn-sm" onClick={() => onDuplicate(offer)}>اعملي نسخة</button></>}
          </div>
        )}
        {locked && step === 4 && !serverError && offer && (
          <p className="field-hint">لتغيير شروط العرض: <button type="button" className="link-btn" onClick={() => onDuplicate(offer)}>اعملي نسخة منه</button></p>
        )}

        {confirmBulk !== null && !bulk && (
          <div className="confirm-bulk" role="alertdialog" aria-label="تأكيد">
            <p>هيتعمل {form.productIds.length.toLocaleString('ar-EG')} عرض منفصل — عرض لكل منتج، وكل واحد بيتحفظ لوحده{confirmBulk ? ' ويتفعّل' : ' من غير تفعيل'}.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => startBulk(confirmBulk)}>أيوه، ابدئي</button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmBulk(null)}>رجوع</button>
          </div>
        )}

        <div className="wiz-footer">
          {bulk ? (
            <>
              <button type="button" className="btn btn-primary" disabled={bulk.busy} onClick={finishBulk}>تمام</button>
              {canRetry && <button type="button" className="btn btn-secondary" onClick={retryBulk}>حاولي تاني للمنتجات اللي فشلت</button>}
              {unresolved > 0 && !bulk.busy && (
                <span className="field-hint">فيه {unresolved.toLocaleString('ar-EG')} منتج مش متأكدين منه — مش هيتبعت تاني إلا لما تقرري.</span>
              )}
            </>
          ) : (
            <>
              {step === 4 ? saveButtons() : (
                <button type="button" className="btn btn-primary" onClick={() => next()} disabled={step === 1 && !form.type}>التالي</button>
              )}
              {step > 1 && <button type="button" className="btn" disabled={saving} onClick={() => go((step - 1) as Step)}>رجوع</button>}
              <button type="button" className="btn" disabled={saving} onClick={requestClose}>إلغاء</button>
              {saving && <span className="field-hint" role="status">جاري الحفظ...</span>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
