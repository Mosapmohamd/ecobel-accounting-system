import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  reportsApi,
  productsApi,
  type DashboardSummary,
  type DashboardPeriod,
  type MonthlySalesPoint,
  type Product,
} from '../lib/api';

function money(n: number) {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج.م';
}

const periods: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'month', label: 'الشهر' },
  { value: 'quarter', label: 'الربع' },
  { value: 'year', label: 'السنة' },
];

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('today');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlySalesPoint[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([reportsApi.dashboard(period), reportsApi.monthlySales(6), productsApi.list({ low_stock_only: true })])
      .then(([s, m, p]) => {
        setSummary(s);
        setMonthly(m);
        setLowStock(p);
      })
      .catch(() => setError('تعذر تحميل بيانات الداشبورد'))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 18 }}>
        {periods.map((p) => (
          <button
            key={p.value}
            className="btn"
            onClick={() => setPeriod(p.value)}
            style={{
              background: period === p.value ? 'var(--forest)' : 'var(--parchment-2)',
              color: period === p.value ? 'var(--cream)' : 'var(--forest)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading || !summary ? (
        <div className="empty-state">جاري التحميل...</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">إيرادات {periodNoun(period)}</div>
              <div className="value">{money(summary.period_income)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">مصروفات {periodNoun(period)}</div>
              <div className="value">{money(summary.period_expense)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">مبيعات الجملة B2B</div>
              <div className="value" style={{ color: 'var(--ok)' }}>{money(summary.period_b2b_sales)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">منتجات محتاجة انتباه</div>
              <div className="value">{summary.low_stock_count + summary.out_of_stock_count}</div>
            </div>
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="kpi-card">
              <div className="label">عدد المنتجات النشطة</div>
              <div className="value">{summary.total_products}</div>
            </div>
            <div className="kpi-card">
              <div className="label">عمليات توزيع مجاني {periodNoun(period)}</div>
              <div className="value">{summary.free_distribution_events}</div>
            </div>
            <div className="kpi-card">
              <div className="label">قطع موزَّعة مجانًا {periodNoun(period)}</div>
              <div className="value" style={{ color: 'var(--rose)' }}>{summary.free_distribution_pieces}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>المبيعات — آخر 6 شهور</h2>
            </div>
            <div className="panel-body" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <XAxis dataKey="month" stroke="#8a8074" fontSize={12} />
                  <YAxis stroke="#8a8074" fontSize={12} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Bar dataKey="total" fill="#c9a227" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>منتجات محتاجة إعادة طلب</h2>
            </div>
            {lowStock.length === 0 ? (
              <div className="empty-state">مفيش منتجات قاربت على النفاد دلوقتي.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>الكمية المتاحة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{p.quantity}</td>
                      <td>
                        <span className={`status ${p.stock_status}`}>
                          {p.stock_status === 'out' ? 'نفذ' : 'منخفض'}
                        </span>
                      </td>
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

function periodNoun(p: DashboardPeriod) {
  return { today: 'اليوم', month: 'الشهر', quarter: 'الربع', year: 'السنة' }[p];
}
