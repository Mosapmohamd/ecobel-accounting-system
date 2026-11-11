import type { ReactNode } from 'react';
import CalcPreview from './CalcPreview';
import { addDays, dateLabel } from './dates';
import { money, percentOff } from './offerMath';
import { lastDay, type OfferForm } from './offerTypes';
import type { WizardCtx } from './wizardContext';

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
      {error && <div id={`${id}-err`} className="field-error" role="alert">{error}</div>}
    </div>
  );
}

/** A number input bound to one string field of the form. */
function Num({ w, k, label, hint, min = 0, step = 'any', suffix }: {
  w: WizardCtx; k: keyof OfferForm; label: string; hint?: ReactNode; min?: number; step?: number | 'any'; suffix?: string;
}) {
  const id = `of-${String(k)}`;
  const err = w.errors[k as string];
  return (
    <Field id={id} label={label} error={err} hint={hint}>
      <span className="num-wrap">
        <input id={id} type="number" inputMode="decimal" min={min} step={step} value={w.form[k] as string}
          aria-invalid={err ? true : undefined}
          aria-describedby={[hint ? `${id}-hint` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
          onChange={(e) => w.update({ [k]: e.target.value } as Partial<OfferForm>)} />
        {suffix && <span className="num-suffix">{suffix}</span>}
      </span>
    </Field>
  );
}

function Check({ w, k, label, hint }: { w: WizardCtx; k: keyof OfferForm; label: string; hint?: string }) {
  return (
    <div className="field">
      <label className="pick-check">
        <input type="checkbox" checked={Boolean(w.form[k])} onChange={(e) => w.update({ [k]: e.target.checked } as Partial<OfferForm>)} /> {label}
      </label>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

/** Step 3 — only the selected type's fields, the name and the dates; the
 * rest in «إعدادات إضافية». */
export default function StepDetails({ w }: { w: WizardCtx }) {
  const { form: f, update, errors, locked, today, original } = w;
  const sale = f.type === 'product_price';
  const ADV_KEYS = ['badge', 'description', 'minSubtotal', 'usageLimit', 'perCustomer', 'priority', 'maxDiscount', 'maxQuantity', 'maxBundles', 'maxRewards'];
  const advancedHasError = ADV_KEYS.some((k) => errors[k] && !(k === 'minSubtotal' && f.type === 'free_shipping'));
  const last = lastDay(f, today);
  const setDates = (patch: Partial<OfferForm>) => update({ ...patch, datesTouched: true });

  return (
    <div className="details">
      {locked && <p className="notice-locked">العرض ده اتستخدم في {original?.orders_count ?? 0} طلب، فقيمته وإعداداته ثابتة. تقدري تغيّري الاسم والتواريخ والحدود والحالة — ولتغيير الشروط اعملي نسخة.</p>}

      <fieldset disabled={locked} className="plain">
        <legend className="sr-only">إعدادات العرض</legend>
        {sale && (
          <div>
            <div className="form-grid">
              <Num w={w} k="salePercent" label="نسبة الخصم (لكل المنتجات)" suffix="٪" min={1}
                hint="بتحسب سعر كل منتج تلقائيًا ومقرّب لأقرب جنيه — وتقدري تعدّلي أي سعر تحت." />
            </div>
            <table className="calc-table sale-table">
              <thead><tr><th>المنتج</th><th>السعر الأصلي</th><th>الخصم</th><th>السعر بعد الخصم</th></tr></thead>
              <tbody>
                {f.productIds.map((id) => {
                  const p = w.priced(id);
                  const price = Number(f.salePrices[id]);
                  const err = errors[`sale:${id}`];
                  return (
                    <tr key={id}>
                      <td>{p?.name ?? 'منتج'}</td>
                      <td>{p ? money(p.regular) : '—'}</td>
                      <td>{p && price > 0 && price < p.regular ? `${percentOff(p.regular, price).toLocaleString('ar-EG')}٪` : '—'}</td>
                      <td>
                        <span className="num-wrap">
                          <input type="number" min={1} step="any" value={f.salePrices[id] ?? ''} aria-label={`سعر العرض — ${p?.name ?? ''}`}
                            aria-invalid={err ? true : undefined} aria-describedby={err ? `sp-${id}` : undefined}
                            onChange={(e) => update({ salePrices: { ...f.salePrices, [id]: e.target.value } })} />
                          <span className="num-suffix">ج.م</span>
                        </span>
                        {err && <div id={`sp-${id}`} className="field-error" role="alert">{err}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {f.type === 'percentage' && <div className="form-grid"><Num w={w} k="percent" label="نسبة الخصم" suffix="٪" /></div>}
        {f.type === 'fixed_amount' && (
          <div className="form-grid">
            <Num w={w} k="amount" label="مبلغ الخصم" suffix="ج.م" />
            <Field id="of-applyPer" label="الخصم بيتحسب">
              <select id="of-applyPer" value={f.applyPer} onChange={(e) => update({ applyPer: e.target.value as 'order' | 'item' })}>
                <option value="order">مرة واحدة على الطلب</option>
                <option value="item">على كل قطعة</option>
              </select>
            </Field>
          </div>
        )}
        {(f.type === 'bundle_fixed' || f.type === 'bundle_choose') && (
          <div className="form-grid">
            {f.type === 'bundle_choose' && <Num w={w} k="bundleQuantity" label="عدد المنتجات في الباقة" min={2} step={1} hint="مثال: 3 = أي 3 منتجات بسعر الباقة" />}
            <Num w={w} k="bundlePrice" label="سعر الباقة" suffix="ج.م" />
          </div>
        )}
        {f.type === 'buy_x_get_y' && (
          <div className="form-grid">
            <Num w={w} k="buyQuantity" label="اشتري (عدد القطع)" min={1} step={1} />
            <Num w={w} k="getQuantity" label="وخدي هدية (عدد القطع)" min={1} step={1} />
          </div>
        )}
        {f.type === 'free_shipping' && (
          <div className="form-grid">
            <Num w={w} k="minSubtotal" label="الحد الأدنى للطلب (اختياري)" suffix="ج.م" hint="فاضي = شحن مجاني على أي طلب" />
          </div>
        )}
      </fieldset>

      <CalcPreview w={w} />

      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field id="of-name" label={sale ? 'عنوان العرض (بيظهر جنب السعر)' : 'اسم العرض'} error={errors.name}
          hint={f.nameEdited ? undefined : 'مقترح من إعداداتك — تقدري تغيّريه'}>
          <input id="of-name" value={f.name} maxLength={120} aria-invalid={errors.name ? true : undefined}
            onChange={(e) => update({ name: e.target.value, nameEdited: true })} />
        </Field>
      </div>

      <fieldset className="dates plain">
        <legend className="pick-legend">المدة</legend>
        {!sale && (
          <div className="date-row">
            <span className="date-label">يبدأ</span>
            <div className="seg">
              {([['now', 'من النهارده'], ['date', 'من يوم...']] as const).map(([v, l]) => (
                <label key={v} className="seg-item" data-checked={f.startMode === v || undefined}>
                  <input type="radio" name="of-start" checked={f.startMode === v} onChange={() => setDates({ startMode: v, startDate: v === 'date' ? f.startDate || today : f.startDate })} />{l}
                </label>
              ))}
            </div>
            {f.startMode === 'date' && (
              <input type="date" aria-label="أول يوم" value={f.startDate} min={original ? undefined : today}
                aria-invalid={errors.startDate ? true : undefined} onChange={(e) => setDates({ startDate: e.target.value })} />
            )}
            {errors.startDate && <div className="field-error" role="alert">{errors.startDate}</div>}
          </div>
        )}
        <div className="date-row">
          <span className="date-label">ينتهي</span>
          <div className="seg">
            {([['none', 'بدون نهاية'], ['week', 'أسبوع'], ['month', 'شهر'], ['date', 'لحد يوم...']] as const).map(([v, l]) => (
              <label key={v} className="seg-item" data-checked={f.endMode === v || undefined}>
                <input type="radio" name="of-end" checked={f.endMode === v}
                  onChange={() => setDates({ endMode: v, endDate: v === 'date' ? f.endDate || addDays(today, 6) : f.endDate })} />{l}
              </label>
            ))}
          </div>
          {f.endMode === 'date' && (
            <input type="date" aria-label="آخر يوم" value={f.endDate} min={f.startMode === 'date' && f.startDate ? f.startDate : undefined}
              aria-invalid={errors.endDate ? true : undefined} onChange={(e) => setDates({ endDate: e.target.value })} />
          )}
          {errors.endDate && <div className="field-error" role="alert">{errors.endDate}</div>}
        </div>
        <p className="field-hint">
          {last ? `آخر يوم: ${dateLabel(last, true)} — العرض شغال لحد ١٢ بالليل بتوقيت القاهرة.` : 'العرض شغال لحد ما توقّفيه.'}
        </p>
      </fieldset>

      {!sale && (
        <details className="more advanced" open={advancedHasError || undefined}>
          <summary>إعدادات إضافية (اختياري)</summary>
          <div className="plain">
            <div className="form-grid">
              <fieldset disabled={locked} className="plain span-2 form-grid">
                <legend className="sr-only">إعدادات النوع</legend>
                {f.type === 'percentage' && (
                  <>
                    <Num w={w} k="maxDiscount" label="أقصى خصم على الطلب (اختياري)" suffix="ج.م" />
                    <Num w={w} k="maxQuantity" label="أقصى عدد قطع عليها خصم (اختياري)" step={1} min={1} hint="الخصم بيتطبّق على الأغلى الأول" />
                  </>
                )}
                {f.type === 'fixed_amount' && f.applyPer === 'item' && <Num w={w} k="maxQuantity" label="أقصى عدد قطع عليها خصم (اختياري)" step={1} min={1} />}
                {(f.type === 'bundle_fixed' || f.type === 'bundle_choose') && (
                  <>
                    {f.type === 'bundle_choose' && <Check w={w} k="distinct" label="لازم منتجات مختلفة (من غير تكرار نفس المنتج)" />}
                    <Check w={w} k="allowMultiple" label="العميلة تقدر تاخد أكتر من باقة في نفس الطلب" />
                    <Num w={w} k="maxBundles" label="أقصى عدد باقات في الطلب (اختياري)" step={1} min={1} />
                  </>
                )}
                {f.type === 'buy_x_get_y' && (
                  <>
                    <Field id="of-rewardChoice" label="القطعة الهدية">
                      <select id="of-rewardChoice" value={f.rewardChoice} onChange={(e) => update({ rewardChoice: e.target.value as 'cheapest' | 'most_expensive' })}>
                        <option value="cheapest">الأرخص من منتجات الهدية</option>
                        <option value="most_expensive">الأغلى من منتجات الهدية</option>
                      </select>
                    </Field>
                    <Check w={w} k="giftAllowMultiple" label="هدية مع كل مجموعة (مش مرة واحدة بس)" />
                    <Num w={w} k="maxRewards" label="أقصى عدد هدايا في الطلب (اختياري)" step={1} min={1} />
                  </>
                )}
                {f.type === 'free_shipping' && (
                  <>
                    <fieldset className="field span-2 plain">
                      <legend className="pick-legend">المحافظات (فاضي = كل المحافظات المتاحة)</legend>
                      <div className="pick-cats">
                        {w.rates.map((r) => (
                          <label key={r.id} className="pick-check">
                            <input type="checkbox" checked={f.cities.includes(r.city)}
                              onChange={(e) => update({ cities: e.target.checked ? [...f.cities, r.city] : f.cities.filter((x) => x !== r.city) })} />
                            {r.city} <span className="field-hint">({money(r.fee)})</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Field id="of-basis" label="الحد الأدنى بيتحسب">
                      <select id="of-basis" value={f.basis} onChange={(e) => update({ basis: e.target.value as 'after' | 'before' })}>
                        <option value="after">بعد خصومات العروض والكوبون</option>
                        <option value="before">قبل الخصومات</option>
                      </select>
                    </Field>
                    {f.scope !== 'all' && <Check w={w} k="requireAll" label="بس لما كل منتجات السلة تكون من المنتجات المختارة" />}
                  </>
                )}
                {f.type !== 'free_shipping' && <Num w={w} k="minSubtotal" label="الحد الأدنى للطلب (اختياري)" suffix="ج.م" />}
              </fieldset>
              <Field id="of-badge" label="نص الشارة على الموقع (اختياري)" error={errors.badge} hint="فاضي = الموقع بيكتب وصف العرض لوحده">
                <input id="of-badge" value={f.badge} maxLength={40} onChange={(e) => update({ badge: e.target.value })} placeholder="مثال: 3 بـ 600" />
              </Field>
              <Num w={w} k="usageLimit" label="أقصى عدد طلبات (اختياري)" step={1} min={1} />
              <Num w={w} k="perCustomer" label="لكل عميل كام مرة (اختياري)" step={1} min={1} />
              <Num w={w} k="priority" label="الأولوية" step={1} min={-1000}
                hint="لو في أكتر من عرض من نفس النوع، الأعلى بيتحسب الأول. الباقات دايمًا قبل الخصومات، والشحن المجاني في الآخر." />
              <Check w={w} k="combinable" label="يتجمع مع عروض تانية"
                hint="مقفول: لو اتطبّق عرض تاني على السلة، العرض ده ما بيتطبّقش — ولو اتطبّق هو، بيوقّف أي عرض بعده في نفس السلة. حتى لو بيتجمع، القطعة الواحدة ما بتاخدش خصمين." />
              <Field id="of-desc" label="وصف للعملاء (اختياري)" error={errors.description}>
                <textarea id="of-desc" rows={2} maxLength={1000} value={f.description} onChange={(e) => update({ description: e.target.value })} />
              </Field>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

