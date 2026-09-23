import { useState } from 'react';
import { reportExportsApi, type FinanceSource } from '../lib/api';

export default function ReportsPage() {
  const [financeSource, setFinanceSource] = useState<FinanceSource | ''>('');

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <h2>التقارير</h2>
        </div>
        <div style={{ padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ReportRow
            title="التقرير المالي"
            description="كل الحركات المالية — إيرادات ومصروفات، بإمكانية الفلترة حسب المصدر"
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={financeSource}
                  onChange={(e) => setFinanceSource(e.target.value as FinanceSource | '')}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontSize: 13 }}
                >
                  <option value="">كل المصادر</option>
                  <option value="website">إيرادات الموقع</option>
                  <option value="b2b">إيرادات B2B</option>
                  <option value="spending">المصروفات العامة</option>
                </select>
                <button className="btn btn-primary" onClick={() => reportExportsApi.finance(financeSource ? { source: financeSource } : undefined)}>
                  تصدير Excel
                </button>
              </div>
            }
          />
          <ReportRow
            title="طلبات الموقع"
            description="كل طلبات العملاء أونلاين — الاسم، العنوان، المنتجات، الحالة"
            action={<button className="btn btn-primary" onClick={() => reportExportsApi.onlineOrders()}>تصدير Excel</button>}
          />
          <ReportRow
            title="أوردرات B2B"
            description="كل أوردرات عملاء الجملة مع الخصومات المطبّقة"
            action={<button className="btn btn-primary" onClick={() => reportExportsApi.b2bOrders()}>تصدير Excel</button>}
          />
          <ReportRow
            title="تقرير المخزون"
            description="كل المنتجات — الكمية الحالية، حد إعادة الطلب، الحالة"
            action={<button className="btn btn-primary" onClick={() => reportExportsApi.inventory()}>تصدير Excel</button>}
          />
        </div>
      </div>
    </div>
  );
}

function ReportRow({ title, description, action }: { title: string; description: string; action: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--cream)',
      }}
    >
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: '#8a8074' }}>{description}</div>
      </div>
      {action}
    </div>
  );
}
