import { useEffect, useState } from 'react';
import { offersApi, productsApi, type Offer, type Product } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';

export default function OffersPage() {
  const confirmDialog = useConfirm();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [productId, setProductId] = useState('');
  const [title, setTitle] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([offersApi.list(), productsApi.list()])
      .then(([o, p]) => { setOffers(o); setProducts(p); })
      .catch(() => setError('تعذر تحميل العروض'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const productName = (id: string) => products.find((p) => p.id === id)?.name || '—';
  const productPrice = (id: string) => products.find((p) => p.id === id)?.sale_price || 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('اكتبي عنوان للعرض — ده اللي العملاء بيشوفوه جنب السعر');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await offersApi.create({
        product_id: productId,
        title: title.trim(),
        offer_price: Number(offerPrice) || 0,
        // The picked date itself — the backend makes it "through the end of
        // that day, Cairo time" (app/cairo_time.py).
        expires_at: expiresAt || undefined,
      });
      setProductId(''); setTitle(''); setOfferPrice(''); setExpiresAt('');
      setShowNew(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'تعذر إضافة العرض');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string) {
    confirmDialog.ask({
      title: 'حذف العرض؟',
      message: 'سعر العرض هيتشال والمنتج هيرجع لسعره العادي على الموقع فورًا.',
      confirmLabel: 'حذف العرض',
      danger: true,
      action: async () => {
        await offersApi.remove(id);
        load();
      },
    });
  }

  /** `is_running` comes from the backend, with the storefront's own rule:
   * an offer past its end isn't shown there any more, whatever its switch says. */
  function offerState(o: Offer): 'live' | 'expired' | 'paused' {
    if (!o.is_active) return 'paused';
    return o.is_running ? 'live' : 'expired';
  }
  function endLabel(o: Offer): string {
    if (!o.ends_on || !o.expires_at) return '—';
    if (o.ends_at_day_end) {
      // ends_on is a calendar date: format it as is, without shifting time zones.
      return `حتى نهاية ${new Date(`${o.ends_on}T00:00:00Z`).toLocaleDateString('ar-EG', { timeZone: 'UTC' })}`;
    }
    return new Date(o.expires_at).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });
  }
  const STATE_LABEL = { live: 'فعّال', expired: 'منتهي', paused: 'موقّف' } as const;

  async function toggleActive(o: Offer) {
    await offersApi.update(o.id, { is_active: !o.is_active });
    load();
  }

  return (
    <div>
      {confirmDialog.dialog}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>عروض الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              خصم مباشر على منتج معين، يظهر في قسم "العروض" بالصفحة الرئيسية
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'إلغاء' : '+ عرض جديد'}
          </button>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}

        {showNew && (
          <form onSubmit={handleCreate} style={{ padding: '0 22px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <div className="field">
                <label>المنتج</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                  <option value="">اختاري منتج...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sale_price.toLocaleString('ar-EG')} ج.م)</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>عنوان العرض</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: خصم الصيف" required />
              </div>
              <div className="field">
                <label>سعر العرض (لازم أقل من السعر الأصلي{productId ? `: ${productPrice(productId).toLocaleString('ar-EG')} ج.م` : ''})</label>
                <input type="number" min={0} value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="offer-last-day">آخر يوم للعرض (اختياري)</label>
                <input id="offer-last-day" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-describedby="offer-last-day-hint" />
                <div id="offer-last-day-hint" style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                  العرض يفضل شغال طول اليوم ده، لحد ١٢ بالليل بتوقيت القاهرة
                </div>
              </div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ العرض'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : offers.length === 0 ? (
          <div className="empty-state">مفيش عروض مضافة لسه.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>العنوان</th>
                <th>السعر الأصلي</th>
                <th>سعر العرض</th>
                <th>ينتهي</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} style={{ opacity: offerState(o) === 'live' ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{productName(o.product_id)}</td>
                  <td>{o.title}</td>
                  <td style={{ textDecoration: 'line-through', color: 'var(--ink-muted)' }}>{productPrice(o.product_id).toLocaleString('ar-EG')} ج.م</td>
                  <td style={{ fontWeight: 600, color: 'var(--forest)' }}>{o.offer_price.toLocaleString('ar-EG')} ج.م</td>
                  <td>{endLabel(o)}</td>
                  <td>{STATE_LABEL[offerState(o)]}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => toggleActive(o)}>
                        {o.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5, background: 'var(--rose-tint)', color: 'var(--rose-text)' }}
                        onClick={() => handleDelete(o.id)}
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
