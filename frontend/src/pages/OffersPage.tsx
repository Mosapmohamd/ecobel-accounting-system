import { useEffect, useState } from 'react';
import { offersApi, productsApi, type Offer, type Product } from '../lib/api';

export default function OffersPage() {
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
    setSaving(true);
    setError(null);
    try {
      await offersApi.create({
        product_id: productId,
        title,
        offer_price: Number(offerPrice) || 0,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
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

  async function handleDelete(id: string) {
    if (!confirm('متأكد إنك عايز تحذف العرض ده؟')) return;
    await offersApi.remove(id);
    load();
  }

  async function toggleActive(o: Offer) {
    await offersApi.update(o.id, { is_active: !o.is_active });
    load();
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>عروض الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
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
                <label>تاريخ الانتهاء (اختياري)</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
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
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} style={{ opacity: o.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{productName(o.product_id)}</td>
                  <td>{o.title}</td>
                  <td style={{ textDecoration: 'line-through', color: '#8a8074' }}>{productPrice(o.product_id).toLocaleString('ar-EG')} ج.م</td>
                  <td style={{ fontWeight: 600, color: 'var(--rose)' }}>{o.offer_price.toLocaleString('ar-EG')} ج.م</td>
                  <td>{o.is_active ? 'فعّال' : 'موقّف'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => toggleActive(o)}>
                        {o.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5, background: 'rgba(201,123,138,0.15)', color: 'var(--rose)' }}
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
