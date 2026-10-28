import { Fragment, useEffect, useState } from 'react';
import { onlineOrdersApi, type OnlineOrder, type OnlineOrderStatus, type OrderStatusChange } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';
import { OrderReturnsPanel } from '../components/OrderReturns';

const statusLabel: Record<OnlineOrderStatus, string> = {
  pending: 'قيد التجهيز',
  shipped: 'في الطريق',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
};
const statuses: OnlineOrderStatus[] = ['pending', 'shipped', 'delivered', 'cancelled'];

// The dropdown offers only the statuses the backend allows from the current
// one (`next_statuses`); every change is confirmed and says what it does.
function changeMessage(from: OnlineOrderStatus, to: OnlineOrderStatus): string {
  if (to === 'pending') return 'الطلب هيرجع «قيد التجهيز» — العميلة هتقدر تعدّله أو تلغيه من الموقع تاني.';
  if (to === 'shipped') return 'العميلة مش هتقدر تعدّل الطلب أو تلغيه من الموقع بعد كده.';
  if (to === 'delivered')
    return 'الدفع عند الاستلام: التوصيل معناه إن المبلغ اتحصّل، فإيراد الطلب هيتسجل. بعد كده الحالة الوحيدة المسموحة هي الإلغاء.';
  if (from === 'delivered')
    return 'الطلب اتسلّم قبل كده: هيتسجل قيد عكس لإيراده كله (القيد الأصلي بيفضل في السجل)، وكل كمياته هترجع للمخزون، والكوبون (لو موجود) هيرجع متاح. لو العميلة رجّعت قطع بس (أو فيه قطع تالفة)، استخدمي «تسجيل مرتجع» من التفاصيل بدل الإلغاء. الإلغاء نهائي.';
  return 'الكميات هترجع للمخزون، والكوبون (لو موجود) هيرجع متاح، ولو كان اتسجل إيراد هيتعكس. الإلغاء نهائي.';
}

function money(n: number): string {
  return `${n.toLocaleString('ar-EG')} ج.م`;
}

export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<OnlineOrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // the status picked in each row's dropdown, until it's saved
  const [picked, setPicked] = useState<Record<string, OnlineOrderStatus>>({});
  const [history, setHistory] = useState<Record<string, OrderStatusChange[] | 'error'>>({});
  const confirmDialog = useConfirm();
  const toast = useToast();

  function load() {
    setLoading(true);
    onlineOrdersApi
      .list(statusFilter || undefined)
      .then(setOrders)
      .catch(() => setError('تعذر تحميل الطلبات'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadHistory(orderId: string) {
    onlineOrdersApi
      .statusHistory(orderId)
      .then((h) => setHistory((prev) => ({ ...prev, [orderId]: h })))
      .catch(() => setHistory((prev) => ({ ...prev, [orderId]: 'error' })));
  }

  function toggleDetails(orderId: string) {
    const open = expanded === orderId ? null : orderId;
    setExpanded(open);
    if (open) loadHistory(open);
  }

  function saveStatus(order: OnlineOrder, status: OnlineOrderStatus) {
    confirmDialog.ask({
      title: `تغيير حالة الطلب #${order.order_number}: ${statusLabel[order.status]} ← ${statusLabel[status]}؟`,
      message: changeMessage(order.status, status),
      confirmLabel: status === 'cancelled' ? 'إلغاء الطلب' : 'حفظ الحالة',
      danger: status === 'cancelled',
      action: async () => {
        const updated = await onlineOrdersApi.updateStatus(order.id, status);
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        setPicked((prev) => {
          const next = { ...prev };
          delete next[order.id];
          return next;
        });
        toast(`طلب #${order.order_number}: ${statusLabel[updated.status]}`);
        if (expanded === order.id) loadHistory(order.id);
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
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>— (حالة نهائية)</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            aria-label={`حالة الطلب ${o.order_number}`}
                            value={picked[o.id] ?? o.status}
                            onChange={(e) => {
                              const v = e.target.value as OnlineOrderStatus;
                              setPicked((prev) => ({ ...prev, [o.id]: v }));
                            }}
                            style={{ padding: '5px 8px', fontSize: 12.5 }}
                          >
                            <option value={o.status}>{statusLabel[o.status]} (الحالية)</option>
                            {o.next_statuses.map((s) => (
                              <option key={s} value={s}>
                                {statusLabel[s]}
                              </option>
                            ))}
                          </select>
                          {picked[o.id] && picked[o.id] !== o.status && (
                            <button
                              className={`btn ${picked[o.id] === 'cancelled' ? 'btn-danger' : 'btn-secondary'}`}
                              style={{ padding: '5px 10px', fontSize: 12.5 }}
                              onClick={() => saveStatus(o, picked[o.id])}
                            >
                              حفظ
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5 }}
                        onClick={() => toggleDetails(o.id)}
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
                            {o.promotion_discount > 0 && <span>خصم العروض: -{o.promotion_discount.toLocaleString('ar-EG')} ج.م</span>}
                            {o.discount_amount > 0 && <span>الخصم: -{o.discount_amount.toLocaleString('ar-EG')} ج.م</span>}
                            <span>الشحن: {o.shipping_fee === 0 ? 'مجاني' : `${o.shipping_fee} ج.م`}</span>
                          </div>
                          {o.applied_promotions.length > 0 && (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 6 }}>
                              العروض المطبّقة:{' '}
                              {o.applied_promotions.map((p) => (
                                `${p.name} (${p.shipping_discount > 0 ? `شحن مجاني -${p.shipping_discount.toLocaleString('ar-EG')}` : `-${p.discount.toLocaleString('ar-EG')}`} ج.م)`
                              )).join('، ')}
                            </div>
                          )}
                          {o.status === 'delivered' && <OrderReturnsPanel order={o} onChanged={load} />}
                          <div style={{ fontSize: 12.5, marginTop: 10 }}>
                            <strong>سجل تغيير الحالة:</strong>{' '}
                            {history[o.id] === undefined ? (
                              'جاري التحميل...'
                            ) : history[o.id] === 'error' ? (
                              <span style={{ color: 'var(--rose-text)' }}>تعذر تحميل السجل</span>
                            ) : (history[o.id] as OrderStatusChange[]).length === 0 ? (
                              <span style={{ color: 'var(--ink-muted)' }}>مفيش تغييرات مسجّلة</span>
                            ) : (
                              <ul style={{ margin: '4px 0 0', paddingInlineStart: 18, color: 'var(--ink-muted)' }}>
                                {(history[o.id] as OrderStatusChange[]).map((h) => (
                                  <li key={h.created_at + h.to_status}>
                                    {new Date(h.created_at).toLocaleString('ar-EG')} — {statusLabel[h.from_status]} ← {statusLabel[h.to_status]} — {h.changed_by}
                                    {h.revenue_change !== 0 && ` · ${h.revenue_change > 0 ? 'إيراد' : 'عكس إيراد'} ${money(Math.abs(h.revenue_change))}`}
                                    {h.units_restored > 0 && ` · رجوع ${h.units_restored} قطعة للمخزون`}
                                  </li>
                                ))}
                              </ul>
                            )}
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
