import OfferIcon from './OfferIcons';
import { TYPE_META, WIZARD_TYPES, type WizardType } from './offerTypes';
import type { WizardCtx } from './wizardContext';

/** Step 1 — seven visual choices. */
export default function StepType({ w, onPick }: { w: WizardCtx; onPick: (t: WizardType) => void }) {
  const { form, original, locked } = w;
  const sale = original?.source === 'product_offer';
  // A sale price stays a sale price; a cart offer can't become one (different API).
  const types = original ? WIZARD_TYPES.filter((t) => (sale ? t === 'product_price' : t !== 'product_price')) : WIZARD_TYPES;
  const fixed = locked || sale;
  return (
    <fieldset className="type-grid-wrap" disabled={fixed}>
      <legend className="sr-only">نوع العرض</legend>
      {fixed && (
        <p className="field-hint" style={{ marginBottom: 10 }}>
          {sale ? 'سعر العرض بيفضل سعر عرض — لنوع تاني اعملي عرض جديد.' : 'العرض ده اتستخدم في طلبات، فنوعه ثابت.'}
        </p>
      )}
      {original && !fixed && <p className="field-hint" style={{ marginBottom: 10 }}>تغيير النوع بيرجّع إعدادات النوع الجديد للبداية (المنتجات والتواريخ بتفضل).</p>}
      <div className="type-grid">
        {types.map((t) => (
          <label key={t} className="type-card" data-checked={form.type === t || undefined}>
            <input type="radio" name="offer-type" value={t} checked={form.type === t} onChange={() => onPick(t)}
              onClick={() => form.type === t && onPick(t)} />
            <span className="type-icon"><OfferIcon type={t} /></span>
            <strong>{TYPE_META[t].label}</strong>
            <span className="field-hint">{TYPE_META[t].hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
