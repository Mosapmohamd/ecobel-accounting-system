import { useEffect, useState } from 'react';
import { couponsApi, type Coupon, type CouponDiscountType, type CouponLimitType } from '../lib/api';

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrder, setMinOrder] = useState('0');
  const [limitType, setLimitType] = useState<CouponLimitType>('unlimited');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    couponsApi.list().then(setCoupons).catch(() => setError('تعذر تحميل الكوبونات')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await couponsApi.create({
        code,
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        min_order_amount: Number(minOrder) || 0,
        limit_type: limitType,
        max_uses: limitType === 'count' ? Number(maxUses) || undefined : undefined,
        expires_at: limitType === 'duration' && expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setCode(''); setDiscountValue(''); setMinOrder('0'); setMaxUses(''); setExpiresAt(''); setLimitType('unlimited');
      setShowNew(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'تعذر إضافة الكوبون');
    } finally {
      setSaving(false);
    }
  }

  async function handleRenew(id: string) {
    await couponsApi.renew(id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('متأكد إنك عايز تحذف الكوبون ده؟')) return;
    await couponsApi.remove(id);
    load();
  }

  function limitLabel(c: Coupon) {
    if (c.max_uses !== null) return `عدد: ${c.used_count}/${c.max_uses}`;
    if (c.expires_at) return `مدة: تنتهي ${new Date(c.expires_at).toLocaleDateString('ar-EG')}`;
    return 'غير محدود';
  }

  function isExhausted(c: Coupon) {
    if (c.max_uses !== null && c.used_count >= c.max_uses) return true;
    if (c.expires_at && new Date(c.expires_at) < new Date()) return true;
    return false;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>كوبونات الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              العميل بيدخل الكود ده وقت الـ checkout على الموقع
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'إلغاء' : '+ كوبون جديد'}
          </button>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}

        {showNew && (
          <form onSubmit={handleCreate} style={{ padding: '0 22px 22px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <div className="field">
                <label>الكود</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} required dir="ltr" />
              </div>
              <div className="field">
                <label>نوع الخصم</label>
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as CouponDiscountType)}>
                  <option value="percentage">نسبة %</option>
                  <option value="fixed">مبلغ ثابت</option>
                </select>
              </div>
              <div className="field">
                <label>القيمة</label>
                <input type="number" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} required />
              </div>
              <div className="field">
                <label>الحد الأدنى للطلب (ج.م)</label>
                <input type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
              </div>
              <div className="field">
                <label>نوع التحديد</label>
                <select value={limitType} onChange={(e) => setLimitType(e.target.value as CouponLimitType)}>
                  <option value="unlimited">غير محدود</option>
                  <option value="duration">محدد بمدة</option>
                  <option value="count">محدد بعدد استخدامات</option>
                </select>
              </div>
              {limitType === 'count' && (
                <div className="field">
                  <label>عدد مرات الاستخدام</label>
                  <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} required />
                </div>
              )}
              {limitType === 'duration' && (
                <div className="field">
                  <label>تاريخ الانتهاء</label>
                  <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required />
                </div>
              )}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ الكوبون'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : coupons.length === 0 ? (
          <div className="empty-state">مفيش كوبونات مضافة لسه.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>الخصم</th>
                <th>الحد الأدنى</th>
                <th>التحديد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} style={{ opacity: isExhausted(c) ? 0.55 : 1 }}>
                  <td style={{ fontWeight: 600 }} dir="ltr">{c.code}</td>
                  <td>{c.discount_type === 'percentage' ? `${c.discount_value}%` : `${c.discount_value} ج.م`}</td>
                  <td>{c.min_order_amount.toLocaleString('ar-EG')} ج.م</td>
                  <td>
                    {limitLabel(c)}
                    {isExhausted(c) && <span style={{ color: 'var(--rose)', fontSize: 11 }}> (منتهي)</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {isExhausted(c) && (
                        <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => handleRenew(c.id)}>
                          تجديد
                        </button>
                      )}
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5, background: 'rgba(201,123,138,0.15)', color: 'var(--rose)' }}
                        onClick={() => handleDelete(c.id)}
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
