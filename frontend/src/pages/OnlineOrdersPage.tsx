import { Fragment, useEffect, useState } from 'react';
import { onlineOrdersApi, type OnlineOrder, type OnlineOrderStatus } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';

const statusLabel: Record<OnlineOrderStatus, string> = {
  pending: 'قيد التجهيز',
  shipped: 'في الطريق',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
};
const statuses: OnlineOrderStatus[] = ['pending', 'shipped', 'delivered', 'cancelled'];

// Every move is one-way (the backend allows no going back), so each one
// is confirmed and says what it does.
const transition: Record<Exclude<OnlineOrderStatus, 'pending'>, { action: string; title: string; message: string }> = {
  shipped: {
    action: 'تم الشحن',
    title: 'تسليم الطلب للشحن؟',
    message: 'العميلة مش هتقدر تعدّل الطلب أو تلغيه من الموقع بعد كده.',
  },
  delivered: {
    action: 'تم التوصيل',
    title: 'تأكيد توصيل الطلب؟',
    message: 'الطلب هيتقفل كـ«تم التوصيل» ومينفعش تتغير حالته بعد كده.',
  },
  cancelled: {
    action: 'إلغاء الطلب',
    title: 'إلغاء الطلب؟',
    message: 'الكميات هترجع للمخزون، والكوبون (لو موجود) هيرجع متاح، وهيتسجل عكس للإيراد. الإلغاء نهائي.',
  },
};

export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<OnlineOrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const confirmDialog = useConfirm();

  function load() {
    setLoading(true);
    onlineOrdersApi
      .list(statusFilter || undefined)
      .then(setOrders)
      .catch(() => setError('تعذر تحميل الطلبات'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeStatus(order: OnlineOrder, status: Exclude<OnlineOrderStatus, 'pending'>) {
    const t = transition[status];
    confirmDialog.ask({
      title: `${t.title} (#${order.order_number})`,
      message: t.message,
      confirmLabel: t.action,
      danger: status === 'cancelled',
      action: async () => {
        await onlineOrdersApi.updateStatus(order.id, status);
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
            <h2>طلبات الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
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
                      <span dir="ltr" style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{o.customer_phone}</span>
                    </td>
                    <td>{o.total_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td>{statusLabel[o.status]}</td>
                    <td>
                      {o.next_statuses.length === 0 ? (
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {o.next_statuses.map((s) =>
                            s === 'pending' ? null : (
                              <button
                                key={s}
                                className={`btn ${s === 'cancelled' ? 'btn-danger' : 'btn-secondary'}`}
                                style={{ padding: '5px 10px', fontSize: 12.5 }}
                                onClick={() => changeStatus(o, s)}
                              >
                                {transition[s].action}
                              </button>
                            ),
                          )}
                        </div>
                      )}
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-muted)' }}>
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
