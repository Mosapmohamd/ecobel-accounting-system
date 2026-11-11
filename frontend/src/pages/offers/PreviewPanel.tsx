import { useState } from 'react';
import { apiErrorMessage, promotionsApi, type PromotionInput, type PromotionPreview } from '../../lib/api';
import { useLookups } from './useOfferData';

const money = (n: number) => `${n.toLocaleString('ar-EG')} ج.م`;

/** The backend's own preview of an offer on a test cart (POST
 * /promotions/preview) — nothing is saved. Moved here unchanged from
 * OffersPage so the offer form can use it too. */
export default function PreviewPanel({ build, bundle = false }: { build: () => PromotionInput; bundle?: boolean }) {
  const { products: all, rates } = useLookups();
  const products = all.filter((p) => p.is_active);
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([{ product_id: '', quantity: '1' }]);
  const [city, setCity] = useState('');
  const [result, setResult] = useState<PromotionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    const items = lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, quantity: Math.max(1, Number(l.quantity) || 1) }));
    if (!items.length) {
      setError('اختاري منتج واحد على الأقل للسلة التجريبية');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await promotionsApi.preview(build(), items, city));
    } catch (err) {
      setResult(null);
      setError(apiErrorMessage(err, 'تعذر تجربة العرض'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="معاينة العرض" style={{ border: '1px solid var(--color-line)', borderRadius: 10, padding: 14, margin: '14px 0' }}>
      <h3 className="detail-heading">معاينة على سلة تجريبية</h3>
      <div className="field-hint" style={{ marginBottom: 8 }}>
        بنفس قواعد الموقع وبأسعار النهارده — العرض بيتجرّب كأنه شغال، ومفيش حاجة بتتحفظ.
        {bundle && ' في الباقات: المنتجات دي هي محتوى باقة واحدة زي ما العميلة هتضيفها.'}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <select aria-label={`منتج ${i + 1}`} value={l.product_id} style={{ flex: '1 1 180px', minWidth: 0 }}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}>
            <option value="">اختاري منتج...</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.sale_price)})</option>)}
          </select>
          <input aria-label={`كمية ${i + 1}`} type="number" min={1} max={100} value={l.quantity} style={{ width: 80 }}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          {lines.length > 1 && (
            <button type="button" className="btn btn-sm" aria-label={`شيل منتج ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {lines.length < 10 && (
          <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, { product_id: '', quantity: '1' }])}>+ منتج</button>
        )}
        <select aria-label="المحافظة" value={city} onChange={(e) => setCity(e.target.value)} style={{ minWidth: 0 }}>
          <option value="">بدون محافظة</option>
          {rates.map((r) => <option key={r.id} value={r.city}>{r.city} ({money(r.fee)})</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={runPreview} disabled={busy}>{busy ? 'جاري الحساب...' : 'جرّبي العرض'}</button>
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10 }} role="alert">{error}</div>}
      {result && (
        <div style={{ marginTop: 10, fontSize: 13 }} aria-live="polite">
          {result.lines.map((l) => (
            <div key={l.product_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{l.product_name} × {l.quantity}{l.free_units > 0 && <strong> ({l.free_units} هدية)</strong>}</span>
              <span>{money(l.line_total)}{l.discount > 0 && <span style={{ color: 'var(--color-primary-ink)' }}> −{money(l.discount)}</span>}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--color-line)', marginTop: 6, paddingTop: 6 }}>
            <div>الإجمالي الفرعي: {money(result.subtotal)}</div>
            {result.applied ? (
              <>
                {result.discount > 0 && <div style={{ color: 'var(--color-primary-ink)' }}>خصم العرض: −{money(result.discount)}</div>}
                {result.shipping_discount > 0 && <div style={{ color: 'var(--color-primary-ink)' }}>الشحن مجاني (وفّر {money(result.shipping_discount)})</div>}
              </>
            ) : (
              <div style={{ color: 'var(--color-error)' }}>العرض مش متطبّق: {result.reason}</div>
            )}
            {result.shipping_fee !== null && result.shipping_discount === 0 && <div>الشحن: {money(result.shipping_fee)}</div>}
            <div style={{ fontWeight: 700 }}>الإجمالي: {money(result.total)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
