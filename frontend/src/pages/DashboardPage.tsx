import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { reportsApi, productsApi, type DashboardSummary, type MonthlySalesPoint, type Product } from '../lib/api';

function money(n: number) {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج.م';
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlySalesPoint[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([reportsApi.dashboard(), reportsApi.monthlySales(6), productsApi.list({ low_stock_only: true })])
      .then(([s, m, p]) => {
        setSummary(s);
        setMonthly(m);
        setLowStock(p);
      })
      .catch(() => setError('تعذر تحميل بيانات الداشبورد'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">جاري التحميل...</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!summary) return null;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">عدد المنتجات النشطة</div>
          <div className="value">{summary.total_products}</div>
        </div>
        <div className="kpi-card">
          <div className="label">منتجات قاربت على النفاد</div>
          <div className="value">{summary.low_stock_count + summary.out_of_stock_count}</div>
        </div>
        <div className="kpi-card">
          <div className="label">إيرادات الشهر</div>
          <div className="value">{money(summary.month_income)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">مصروفات الشهر</div>
          <div className="value">{money(summary.month_expense)}</div>
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
    </div>
  );
}
