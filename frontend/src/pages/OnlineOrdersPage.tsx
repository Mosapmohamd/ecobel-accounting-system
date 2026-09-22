import { Fragment, useEffect, useState } from 'react';
import { onlineOrdersApi, type OnlineOrder, type OnlineOrderStatus } from '../lib/api';

const statusLabel: Record<OnlineOrderStatus, string> = {
  pending: 'قيد التجهيز',
  shipped: 'في الطريق',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
};
const statuses: OnlineOrderStatus[] = ['pending', 'shipped', 'delivered', 'cancelled'];

export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<OnlineOrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    setLoading(true);
    onlineOrdersApi
      .list(statusFilter || undefined)
      .then(setOrders)
      .catch(() => setError('تعذر تحميل الطلبات'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeStatus(id: string, status: OnlineOrderStatus) {
    try {
      await onlineOrdersApi.updateStatus(id, status);
      load();
    } catch {
      setError('تعذر تحديث حالة الطلب');
    }
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>طلبات الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              طلبات العملاء من الموقع الإلكتروني (كاش عند الاستلام)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 22px 16px', flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => setStatusFilter('')}
            style={{ background: statusFilter === '' ? 'var(--forest)' : 'var(--parchment-2)', color: statusFilter === '' ? 'var(--cream)' : 'var(--forest)' }}
          >
            الكل
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              className="btn"
              onClick={() => setStatusFilter(s)}
              style={{ background: statusFilter === s ? 'var(--forest)' : 'var(--parchment-2)', color: statusFilter === s ? 'var(--cream)' : 'var(--forest)' }}
            >
              {statusLabel[s]}
            </button>
          ))}
        </div>

        {error && <div className="error-banner" style={{ margin: '0 22px 16px' }}>{error}</div>}

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">مفيش طلبات مطابقة.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>العميل</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
                <th>تحديث</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                    <td>
                      {o.customer_name}
                      <br />
                      <span dir="ltr" style={{ color: '#8a8074', fontSize: 12 }}>{o.customer_phone}</span>
                    </td>
                    <td>{o.total_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td>{statusLabel[o.status]}</td>
                    <td>
                      <select
                        value={o.status}
                        onChange={(e) => changeStatus(o.id, e.target.value as OnlineOrderStatus)}
                        style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                      >
                        {statuses.map((s) => (
                          <option key={s} value={s}>{statusLabel[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5 }}
                        onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                      >
                        {expanded === o.id ? 'إخفاء' : 'التفاصيل'}
                      </button>
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--parchment)' }}>
                        <div style={{ padding: 12, fontSize: 13.5 }}>
                          <div style={{ marginBottom: 8 }}>
                            <strong>العنوان:</strong> {o.shipping_address}
                          </div>
                          {o.note && (
                            <div style={{ marginBottom: 8 }}>
                              <strong>ملاحظات:</strong> {o.note}
                            </div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                            {o.items.map((it) => (
                              <div key={it.product_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>{it.product_name} × {it.quantity}</span>
                                <span>{it.line_total.toLocaleString('ar-EG')} ج.م</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#8a8074' }}>
                            <span>الإجمالي الفرعي: {o.subtotal.toLocaleString('ar-EG')} ج.م</span>
                            {o.discount_amount > 0 && <span>الخصم: -{o.discount_amount.toLocaleString('ar-EG')} ج.م</span>}
                            <span>الشحن: {o.shipping_fee === 0 ? 'مجاني' : `${o.shipping_fee} ج.م`}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
