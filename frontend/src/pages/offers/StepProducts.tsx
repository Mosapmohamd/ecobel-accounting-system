import ProductSelect, { CategoryChecks } from './ProductSelect';
import { money } from './offerMath';
import type { Scope } from './offerTypes';
import type { WizardCtx } from './wizardContext';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'products', label: 'منتجات محددة' },
  { value: 'categories', label: 'فئات كاملة' },
  { value: 'all', label: 'كل المنتجات' },
];

/** Step 2 — what the offer covers. Choosing "all products" is always
 * explicit: an empty selection never means "everything". */
export default function StepProducts({ w }: { w: WizardCtx }) {
  const { form, update, errors, products, categories, byId, priced, locked, original } = w;
  const t = form.type;
  const current = (id: string) => priced(id)?.current;

  if (locked) {
    const names = (ids: string[], f: (id: string) => string | undefined) => ids.map((id) => f(id) ?? '—').join('، ');
    const catName = (id: string) => categories.find((c) => c.id === id)?.name;
    return (
      <div>
        <p className="notice-locked">العرض ده اتستخدم في {original?.orders_count ?? 0} طلب، فمنتجاته ثابتة. لتغييرها اعملي نسخة من العرض.</p>
        <dl className="detail-grid">
          <div><dt>المنتجات</dt><dd>{form.productIds.length ? names(form.productIds, (id) => byId.get(id)?.name) : form.categoryIds.length ? '—' : 'كل المنتجات'}</dd></div>
          {form.categoryIds.length > 0 && <div><dt>الفئات</dt><dd>{names(form.categoryIds, catName)}</dd></div>}
          {(form.rewardProductIds.length > 0 || form.rewardCategoryIds.length > 0) && (
            <div><dt>الهدية</dt><dd>{[names(form.rewardProductIds, (id) => byId.get(id)?.name), names(form.rewardCategoryIds, catName)].filter(Boolean).join('، ')}</dd></div>
          )}
        </dl>
      </div>
    );
  }

  if (t === 'product_price') {
    const sale = original?.source === 'product_offer';
    const running = w.warnings.filter((x) => x.kind === 'sale_running');
    return (
      <div>
        <ProductSelect label={sale ? 'المنتج' : 'المنتجات اللي هيتعمل لها سعر عرض'} products={products} categories={categories}
          selected={form.productIds} single={sale} currentPrice={current} error={errors.products}
          onChange={(ids) => update({ productIds: ids })} />
        {!sale && form.productIds.length > 1 && (
          <p className="field-hint">هيتعمل عرض منفصل لكل منتج — كل واحد بيتحفظ لوحده.</p>
        )}
        {running.length > 0 && (
          <ul className="warn-list">
            {running.map((x) => x.kind === 'sale_running' && (
              <li key={x.productId} className="warn">
                «{byId.get(x.productId)?.name}» عليه سعر عرض شغال: «{x.other.name}» — لو فعّلتي العرض الجديد هيفشل للمنتج ده. وقّفي القديم الأول، أو احفظي الجديد من غير تفعيل.
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (t === 'bundle_fixed') {
    const units = form.productIds.reduce((s, id) => s + (form.quantities[id] ?? 1), 0);
    const total = form.productIds.reduce((s, id) => s + (byId.get(id)?.sale_price ?? 0) * (form.quantities[id] ?? 1), 0);
    return (
      <div>
        <ProductSelect label="منتجات الباقة" products={products} categories={categories} selected={form.productIds}
          currentPrice={current} error={errors.products}
          onChange={(ids) => update({ productIds: ids, quantities: Object.fromEntries(ids.map((id) => [id, form.quantities[id] ?? 1])) })} />
        {form.productIds.length > 0 && (
          <fieldset className="bundle-box" aria-describedby={errors.quantities ? 'bq-err' : undefined}>
            <legend>محتوى الباقة الواحدة</legend>
            {form.productIds.map((id) => {
              const n = form.quantities[id] ?? 1;
              const name = byId.get(id)?.name ?? 'منتج';
              return (
                <div key={id} className="bundle-row">
                  <span className="pick-name">{name}</span>
                  <span className="stepper" role="group" aria-label={`كمية ${name} في الباقة`}>
                    <button type="button" className="btn btn-sm" aria-label={`قلّلي ${name}`} disabled={n <= 1}
                      onClick={() => update({ quantities: { ...form.quantities, [id]: n - 1 } })}>−</button>
                    <output aria-live="polite">{n.toLocaleString('ar-EG')}</output>
                    <button type="button" className="btn btn-sm" aria-label={`زوّدي ${name}`} disabled={n >= 50}
                      onClick={() => update({ quantities: { ...form.quantities, [id]: n + 1 } })}>+</button>
                  </span>
                  <span className="field-hint">{money((byId.get(id)?.sale_price ?? 0) * n)}</span>
                </div>
              );
            })}
            <div className="field-hint">الباقة فيها {units.toLocaleString('ar-EG')} قطعة — مجموع أسعارها العادية {money(total)}</div>
            {errors.quantities && <div id="bq-err" className="field-error" role="alert">{errors.quantities}</div>}
          </fieldset>
        )}
      </div>
    );
  }

  return (
    <div>
      <fieldset className="scope-choice">
        <legend className="pick-legend">{t === 'buy_x_get_y' ? 'المنتجات اللي بتتشرى' : t === 'free_shipping' ? 'الشحن المجاني على' : 'العرض على'}</legend>
        <div className="seg">
          {SCOPES.map((s) => (
            <label key={s.value} className="seg-item" data-checked={form.scope === s.value || undefined}>
              <input type="radio" name="offer-scope" value={s.value} checked={form.scope === s.value} onChange={() => update({ scope: s.value })} />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {form.scope === 'all' && <p className="field-hint">العرض على كل منتجات المتجر.</p>}
      {form.scope === 'products' && (
        <ProductSelect label="المنتجات" products={products} categories={categories} selected={form.productIds}
          currentPrice={current} error={errors.products} onChange={(ids) => update({ productIds: ids })} />
      )}
      {form.scope === 'categories' && (
        <>
          <CategoryChecks label="الفئات" categories={categories} selected={form.categoryIds} error={errors.categories}
            onChange={(ids) => update({ categoryIds: ids })} />
          <details className="more" open={form.productIds.length > 0}>
            <summary>+ منتجات إضافية من فئات تانية (اختياري)</summary>
            <ProductSelect label="منتجات إضافية" products={products} categories={categories} selected={form.productIds}
              currentPrice={current} onChange={(ids) => update({ productIds: ids })} />
          </details>
        </>
      )}
      {t === 'buy_x_get_y' && (
        <fieldset className="scope-choice" style={{ marginTop: 18 }}>
          <legend className="pick-legend">الهدية</legend>
          <div className="seg">
            {([['same', 'نفس المنتجات اللي بتتشرى'], ['custom', 'منتجات أو فئات تانية']] as const).map(([v, l]) => (
              <label key={v} className="seg-item" data-checked={form.rewardMode === v || undefined}>
                <input type="radio" name="offer-reward" value={v} checked={form.rewardMode === v} onChange={() => update({ rewardMode: v })} />
                {l}
              </label>
            ))}
          </div>
          {form.rewardMode === 'custom' && (
            <>
              <CategoryChecks label="فئات الهدية" categories={categories} selected={form.rewardCategoryIds}
                onChange={(ids) => update({ rewardCategoryIds: ids })} />
              <ProductSelect label="منتجات الهدية" products={products} categories={categories} selected={form.rewardProductIds}
                currentPrice={current} onChange={(ids) => update({ rewardProductIds: ids })} />
            </>
          )}
          {errors.rewards && <div className="field-error" role="alert">{errors.rewards}</div>}
          {form.rewardMode === 'custom' && form.rewardProductIds.some((id) => byId.get(id)?.stock_status === 'out') && (
            <p className="warn">في منتج هدية نفد من المخزن — الطلب ما بيتأكدش بهدية مش موجودة.</p>
          )}
        </fieldset>
      )}
    </div>
  );
}
