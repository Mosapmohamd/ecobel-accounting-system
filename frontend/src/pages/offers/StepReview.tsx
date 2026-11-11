import CalcPreview from './CalcPreview';
import { cairoDate, dateLabel } from './dates';
import { money } from './offerMath';
import { TYPE_META, firstDay, lastDay, toPromotionInput } from './offerTypes';
import type { OrderReason, RuleLike, Warning } from './overlap';
import PreviewPanel from './PreviewPanel';
import { STATE_NAME, TYPE_NAME, type WizardCtx } from './wizardContext';

const v = (s: string) => Number(s).toLocaleString('ar-EG');

function whatItGives(w: WizardCtx): string {
  const f = w.form;
  if (w.locked && w.original) return w.original.summary;
  switch (f.type) {
    case 'product_price': return f.productIds.length > 1 ? `سعر عرض على ${f.productIds.length.toLocaleString('ar-EG')} منتجات (عرض منفصل لكل منتج)` : 'سعر عرض على منتج';
    case 'percentage': return `خصم ${v(f.percent)}٪`;
    case 'fixed_amount': return `خصم ${money(Number(f.amount))} ${f.applyPer === 'item' ? 'على كل قطعة' : 'مرة واحدة على الطلب'}`;
    case 'bundle_fixed': return `باقة ${f.productIds.reduce((s, id) => s + (f.quantities[id] ?? 1), 0).toLocaleString('ar-EG')} قطع بـ ${money(Number(f.bundlePrice))}`;
    case 'bundle_choose': return `اختاري ${v(f.bundleQuantity)} منتجات بـ ${money(Number(f.bundlePrice))}${f.distinct ? ' (منتجات مختلفة)' : ''}`;
    case 'buy_x_get_y': return `اشتري ${v(f.buyQuantity)} وخدي ${v(f.getQuantity)} هدية`;
    case 'free_shipping': return Number(f.minSubtotal) > 0 ? `شحن مجاني للطلبات من ${money(Number(f.minSubtotal))}` : 'شحن مجاني على أي طلب';
    default: return '';
  }
}

function onWhat(w: WizardCtx): string {
  const f = w.form;
  const names = (ids: string[]) => ids.slice(0, 3).map((id) => w.byId.get(id)?.name ?? 'منتج').join('، ') + (ids.length > 3 ? ` و${(ids.length - 3).toLocaleString('ar-EG')} كمان` : '');
  const cats = (ids: string[]) => ids.map((id) => w.categories.find((c) => c.id === id)?.name ?? 'فئة').join('، ');
  if (f.type === 'product_price' || f.type === 'bundle_fixed' || f.scope === 'products') return f.productIds.length ? `على ${names(f.productIds)}` : '';
  if (f.scope === 'all') return 'على كل المنتجات';
  return `على فئة ${cats(f.categoryIds)}${f.productIds.length ? ` + ${names(f.productIds)}` : ''}`;
}

function when(w: WizardCtx): string {
  const { form: f, original, today } = w;
  let first: string | null;
  let last: string | null;
  if (original && !f.datesTouched) {
    first = cairoDate(original.starts_at) || null;
    last = cairoDate(original.ends_at, true) || null;
  } else {
    first = firstDay(f);
    last = lastDay(f, today);
  }
  const from = f.type === 'product_price' ? '' : first ? `من ${dateLabel(first)}` : original && !f.datesTouched ? 'من غير تاريخ بداية' : 'من النهارده';
  const to = last ? `لحد ${dateLabel(last)}` : 'من غير تاريخ نهاية';
  return [from, to].filter(Boolean).join(' ');
}

const REASON: Record<OrderReason, (first: RuleLike) => string> = {
  group: (first) => (first.type === 'bundle' ? 'الباقات بتتحسب قبل باقي العروض' : 'الشحن المجاني بيتحسب بعد خصومات المنتجات'),
  priority: () => 'أولويته أعلى',
  older: () => 'نفس الأولوية واتعمل قبله',
  id: () => 'نفس الأولوية ونفس وقت الإنشاء',
};

const label = (r: RuleLike) => `«${r.name}» (${TYPE_NAME[r.type] ?? r.type}${r.state ? ` · ${STATE_NAME[r.state] ?? r.state}` : ''})`;
/** The offer in the form is the only rule without a stored state. */
const who = (r: RuleLike) => (r.state === null ? 'العرض ده' : `«${r.name}»`);

/** The overlap warnings — never blocking. */
function OverlapWarnings({ w }: { w: WizardCtx }) {
  const items = w.warnings;
  if (w.marketLoading) return <p className="field-hint">جاري مراجعة العروض الحالية...</p>;
  if (w.marketError) return <p className="note">{w.marketError}</p>;
  if (!items.length) return <p className="ok-line">مفيش عروض تانية شغالة في نفس الفترة على نفس المنتجات.</p>;
  const line = (x: Warning, i: number) => {
    switch (x.kind) {
      case 'conflict':
        return (
          <li key={i} className="warn">
            <strong>تعارض مع {label(x.other)}</strong> — {x.shared.toLocaleString('ar-EG')} منتج مشترك وفي نفس الفترة، وواحد منهم على الأقل ما بيتجمعش.
            لو الاتنين في نفس السلة، اللي بيتحسب الأول بيتطبّق والتاني لأ: هنا {who(x.first)} بيتحسب الأول ({REASON[x.reason](x.first)}).
            {(x.first.type === 'bundle' || x.other.type === 'bundle') && ' (الباقة بتتحسب بس لما العميلة تضيفها كباقة.)'}
          </li>
        );
      case 'stack':
        return (
          <li key={i} className="note">
            بيتقاطع مع {label(x.other)} على {x.shared.toLocaleString('ar-EG')} منتج — الاتنين بيتجمعوا، بس القطعة الواحدة بتاخد خصم واحد بس.
            {' '}{who(x.first)} بيتحسب الأول ({REASON[x.reason](x.first)}).
          </li>
        );
      case 'two_free_shipping':
        return (
          <li key={i} className="note">
            في عرض شحن مجاني تاني في نفس الفترة: {label(x.other)} — الطلب بياخد شحن مجاني مرة واحدة بس، و{who(x.first)} بيتحسب الأول ({REASON[x.reason](x.first)}).
          </li>
        );
      case 'cart_wide':
        return (
          <li key={i} className="note">
            <details>
              <summary>{x.others.length.toLocaleString('ar-EG')} عرض تاني شغال في نفس الفترة على منتجات مختلفة — وفي عرض منهم أو العرض ده ما بيتجمعش</summary>
              العرض اللي ما بيتجمعش بيوقّف أي عرض تاني في نفس السلة، حتى لو على منتجات مختلفة. لو العميلة جمعت منتجاتهم في سلة واحدة، مش كله هيتطبّق:
              <ul>{x.others.map((o) => <li key={o.id ?? o.name}>{label(o)}{o.combinable ? '' : ' — ما بيتجمعش'}</li>)}</ul>
            </details>
          </li>
        );
      case 'on_sale_price':
        return (
          <li key={i} className="note">
            منتجات عليها سعر عرض دلوقتي — الخصم بيتحسب على سعر العرض مش السعر الأصلي:{' '}
            {x.items.slice(0, 4).map(({ product, sale }) => `${product.name} (${money(sale.salePrice ?? 0)})`).join('، ')}
            {x.items.length > 4 && ` و${(x.items.length - 4).toLocaleString('ar-EG')} كمان`}
          </li>
        );
      case 'cart_on_sale':
        return (
          <li key={i} className="note">
            عروض السلة دي بتشمل المنتجات دي، وهتتحسب على سعر العرض الجديد: {x.others.map((o) => label(o)).join('، ')}
          </li>
        );
      case 'sale_running':
        return (
          <li key={i} className="warn">
            «{w.byId.get(x.productId)?.name}» عليه سعر عرض شغال «{x.other.name}» — التفعيل هيفشل للمنتج ده (الحفظ من غير تفعيل ينفع).
          </li>
        );
    }
  };
  return <ul className="warn-list">{items.map(line)}</ul>;
}

/** Step 4 — a plain summary, the figures, the warnings and an optional test cart. */
export default function StepReview({ w, goTo }: { w: WizardCtx; goTo: (step: 1 | 2 | 3) => void }) {
  const f = w.form;
  const sale = f.type === 'product_price';
  return (
    <div className="review">
      <p className="review-summary">
        <strong>{f.name || '—'}</strong>
        <br />
        {whatItGives(w)} {onWhat(w)} — {when(w)}.
      </p>
      {w.locked && <p className="notice-locked">العرض ده اتستخدم في {w.original?.orders_count ?? 0} طلب، فشروطه ثابتة — اللي بيتحفظ: الاسم والتواريخ والحدود والأولوية والتجميع والحالة.</p>}
      <CalcPreview w={w} />
      <ul className="review-links">
        <li>النوع: {f.type ? TYPE_META[f.type].label : '—'} <button type="button" className="link-btn" onClick={() => goTo(1)}>تعديل</button></li>
        <li>المنتجات <button type="button" className="link-btn" onClick={() => goTo(2)}>تعديل</button></li>
        <li>التفاصيل والمدة <button type="button" className="link-btn" onClick={() => goTo(3)}>تعديل</button></li>
      </ul>
      <h3 className="detail-heading">عروض تانية ممكن تأثّر</h3>
      <OverlapWarnings w={w} />
      {!sale && (
        <details className="more">
          <summary>جرّبي العرض على سلة تجريبية (اختياري)</summary>
          <PreviewPanel build={() => toPromotionInput(f, { status: 'active', original: w.original, today: w.today })} bundle={f.type === 'bundle_fixed' || f.type === 'bundle_choose'} />
        </details>
      )}
    </div>
  );
}
