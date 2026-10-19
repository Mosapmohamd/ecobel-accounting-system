import { useEffect, useState } from 'react';
import { shippingRatesApi, type ShippingRate } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';

export default function ShippingRatesPage() {
  const confirmDialog = useConfirm();
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    shippingRatesApi.list().then(setRates).catch(() => setError('تعذر تحميل أسعار الشحن')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await shippingRatesApi.create({ city, fee: Number(fee) || 0 });
      setCity(''); setFee('');
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'تعذر إضافة سعر الشحن');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateFee(rate: ShippingRate, newFee: number) {
    await shippingRatesApi.update(rate.id, { fee: newFee });
    load();
  }

  async function toggleActive(rate: ShippingRate) {
    await shippingRatesApi.update(rate.id, { is_active: !rate.is_active });
    load();
  }

  function handleDelete(id: string) {
    confirmDialog.ask({
      title: 'حذف المحافظة؟',
      message: 'العملاء مش هيقدروا يطلبوا توصيل للمحافظة دي من الموقع لحد ما تضيفها تاني.',
      confirmLabel: 'حذف المحافظة',
      danger: true,
      action: async () => {
        await shippingRatesApi.remove(id);
        load();
      },
    });
  }

  return (
    <div>
      {confirmDialog.dialog}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>أسعار الشحن</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              رسوم التوصيل حسب المحافظة — الموقع بيوصّل بس للمحافظات المفعّلة هنا
            </div>
          </div>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}

        <form onSubmit={handleAdd} style={{ padding: '0 22px 22px', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>المدينة</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} required />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>رسوم الشحن (ج.م)</label>
            <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} required />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : '+ إضافة'}</button>
        </form>

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : rates.length === 0 ? (
          <div className="empty-state">مفيش مدن مضافة لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>المدينة</th><th>رسوم الشحن</th><th>الحالة</th><th></th></tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{r.city}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      defaultValue={r.fee}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== r.fee) handleUpdateFee(r, v);
                      }}
                      style={{ width: 90, border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                    />
                    {' ج.م'}
                  </td>
                  <td>{r.is_active ? 'فعّال' : 'موقّف'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => toggleActive(r)}>
                        {r.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5, background: 'var(--rose-tint)', color: 'var(--rose-text)' }}
                        onClick={() => handleDelete(r.id)}
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
