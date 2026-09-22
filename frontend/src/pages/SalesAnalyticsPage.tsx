import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { salesAnalyticsApi, type SalesAnalytics, type SalesSource } from '../lib/api';

function money(n: number) {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج.م';
}

const statusLabel: Record<string, string> = {
  pending: 'قيد التجهيز',
  shipped: 'في الطريق',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
  b2b: 'أوردرات جملة',
};

const sources: { value: SalesSource; label: string }[] = [
  { value: 'all', label: 'الكل (موقع + جملة)' },
  { value: 'online', label: 'الموقع فقط' },
  { value: 'b2b', label: 'الجملة B2B فقط' },
];

export default function SalesAnalyticsPage() {
  const [source, setSource] = useState<SalesSource>('all');
  const [data, setData] = useState<SalesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    salesAnalyticsApi
      .get(source)
      .then(setData)
      .catch(() => setError('تعذر تحميل التحليلات'))
      .finally(() => setLoading(false));
  }, [source]);

  const chartData = (data?.revenue_last_30_days || []).map((p) => ({
    day: new Date(p.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }),
    total: p.total,
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 18 }}>
        {sources.map((s) => (
          <button
            key={s.value}
            className="btn"
            onClick={() => setSource(s.value)}
            style={{
              background: source === s.value ? 'var(--forest)' : 'var(--parchment-2)',
              color: source === s.value ? 'var(--cream)' : 'var(--forest)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading || !data ? (
        <div className="empty-state">جاري التحميل...</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">إجمالي الإيرادات</div>
              <div className="value">{money(data.total_revenue)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">إجمالي الطلبات</div>
              <div className="value">{data.total_orders}</div>
            </div>
            {Object.entries(data.orders_by_status).map(([status, count]) => (
              <div className="kpi-card" key={status}>
                <div className="label">{statusLabel[status] || status}</div>
                <div className="value">{count}</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>الإيرادات — آخر 30 يوم</h2>
            </div>
            <div className="panel-body" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="day" stroke="#8a8074" fontSize={11} />
                  <YAxis stroke="#8a8074" fontSize={11} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Bar dataKey="total" fill="#c9a227" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>الأكثر مبيعًا</h2>
            </div>
            {data.top_products.length === 0 ? (
              <div className="empty-state">مفيش مبيعات في النطاق ده لسه.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>القطع المباعة</th>
                    <th>الإيراد</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.map((p) => (
                    <tr key={p.product_name}>
                      <td style={{ fontWeight: 600 }}>{p.product_name}</td>
                      <td>{p.quantity_sold}</td>
                      <td>{money(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
