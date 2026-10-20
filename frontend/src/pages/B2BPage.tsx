import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, b2bApi, productsApi, type B2BCustomer, type B2BOrder, type Product } from '../lib/api';
import Modal from '../components/Modal';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';

/** Rows each list shows until "عرض الكل" is pressed. */
const PREVIEW = 5;

// Stable fetchers (module level, so the lists don't refetch on every render).
const latestOrders = (limit?: number) => b2bApi.listOrders(limit ? { limit } : undefined);
const newestCustomers = (limit?: number) => b2bApi.listCustomers({ order: 'newest', ...(limit ? { limit } : {}) });

const money = (n: number) => `${n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const shortId = (id: string) => `#${id.slice(0, 8)}`;
const dateTime = (iso: string) => new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

/** A list shown as its first PREVIEW rows, with "عرض الكل" / "عرض أقل".
 * The preview asks the API for PREVIEW + 1 rows — the extra one only tells
 * whether there are more; the complete list is fetched once, on the first
 * "عرض الكل", and reused when collapsing and expanding again. */
function usePreviewList<T>(fetch: (limit?: number) => Promise<T[]>) {
  const [first, setFirst] = useState<T[] | null>(null);
  const [all, setAll] = useState<T[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirst = useCallback(
    () => fetch(PREVIEW + 1).then(setFirst, () => setError('تعذر تحميل البيانات')),
    [fetch],
  );
  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  /** After a change: back to a fresh preview (the cached full list is stale). */
  function reload() {
    setAll(null);
    setExpanded(false);
    setError(null);
    loadFirst();
  }

  function retry() {
    setFirst(null);
    reload();
  }

  async function showAll() {
    if (all) {
      setExpanded(true);
      return;
    }
    setLoadingAll(true);
    try {
      setAll(await fetch());
      setExpanded(true);
    } catch {
      setError('تعذر تحميل القائمة كاملة');
    } finally {
      setLoadingAll(false);
    }
  }

  return {
    rows: expanded && all ? all : (first ?? []).slice(0, PREVIEW),
    loading: first === null && !error,
    error,
    hasMore: (first?.length ?? 0) > PREVIEW,
    expanded,
    loadingAll,
    showAll,
    showLess: () => setExpanded(false),
    reload,
    retry,
  };
}

type PreviewList = ReturnType<typeof usePreviewList<unknown>>;

function ListToggle({ list, label }: { list: PreviewList; label: string }) {
  if (!list.hasMore) return null;
  return (
    <div className="panel-foot">
      {list.expanded ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={list.showLess} aria-label={`عرض أقل — ${label}`}>
          عرض أقل
        </button>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={list.showAll} disabled={list.loadingAll} aria-label={`عرض الكل — ${label}`}>
          {list.loadingAll ? 'جاري التحميل...' : 'عرض الكل'}
        </button>
      )}
    </div>
  );
}

function ListError({ list }: { list: PreviewList }) {
  if (!list.error) return null;
  return (
    <div className="error-banner" role="alert" style={{ margin: '16px 22px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {list.error}
      <button type="button" className="btn btn-secondary btn-sm" onClick={list.retry}>حاول تاني</button>
    </div>
  );
}

export default function B2BPage() {
  const orders = usePreviewList<B2BOrder>(latestOrders);
  const customers = usePreviewList<B2BCustomer>(newestCustomers);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);

  // Any order or customer change can affect both lists (names, history).
  const refreshAll = () => {
    orders.reload();
    customers.reload();
  };

  return (
    <div>
      <section className="panel" aria-labelledby="b2b-orders-title">
        <div className="panel-head">
          <div>
            <h2 id="b2b-orders-title">أوردرات الجملة</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>الأحدث أولًا</div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowNewOrder(true)}
            disabled={customers.loading || customers.rows.length === 0}
          >
            + أوردر جديد
          </button>
        </div>
        <ListError list={orders} />
        {orders.loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : orders.rows.length === 0 ? (
          !orders.error && <div className="empty-state">مفيش أوردرات جملة مسجّلة لسه.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>العميل</th><th>عدد الأصناف</th><th>خصم إضافي</th><th>الإجمالي بعد الخصم</th><th>التاريخ</th><th><span className="sr-only">إجراءات</span></th></tr>
            </thead>
            <tbody>
              {orders.rows.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.customer_name || '—'}</td>
                  <td>{o.items.length}</td>
                  <td>{o.extra_discount_percentage ? `${o.extra_discount_percentage}%` : '—'}</td>
                  <td>{money(o.total_amount)}</td>
                  <td>{new Date(o.created_at).toLocaleDateString('ar-EG')}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenOrder(o.id)} aria-label={`التفاصيل — أوردر ${shortId(o.id)} ${o.customer_name ?? ''}`}>
                      التفاصيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <ListToggle list={orders} label="الأوردرات" />
      </section>

      <section className="panel" aria-labelledby="b2b-customers-title">
        <div className="panel-head">
          <div>
            <h2 id="b2b-customers-title">عملاء الجملة B2B</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              نسبة الخصم ثابتة لكل عميل وتُحسب تلقائيًا على كل أوردر — الأحدث إضافة أولًا
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNewCustomer(true)}>+ عميل جديد</button>
        </div>
        <ListError list={customers} />
        {customers.loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : customers.rows.length === 0 ? (
          !customers.error && <div className="empty-state">مفيش عملاء جملة مضافين لسه.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>العميل</th><th>التليفون</th><th>نسبة الخصم</th><th><span className="sr-only">إجراءات</span></th></tr>
            </thead>
            <tbody>
              {customers.rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.phone || '—'}</td>
                  <td><span className="pill">{c.discount_percentage}%</span></td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenCustomer(c.id)} aria-label={`التفاصيل — ${c.name}`}>
                      التفاصيل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <ListToggle list={customers} label="العملاء" />
      </section>

      {showNewCustomer && (
        <CustomerFormModal onClose={() => setShowNewCustomer(false)} onSaved={() => { setShowNewCustomer(false); customers.reload(); }} />
      )}
      {showNewOrder && (
        <OrderFormModal onClose={() => setShowNewOrder(false)} onSaved={() => { setShowNewOrder(false); orders.reload(); }} />
      )}
      {openOrder && (
        <OrderDetailsModal orderId={openOrder} onClose={() => setOpenOrder(null)} onChanged={refreshAll} />
      )}
      {openCustomer && (
        <CustomerDetailsModal customerId={openCustomer} onClose={() => setOpenCustomer(null)} onChanged={refreshAll} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- customers

/** Create (no `customer`) or edit a customer. */
function CustomerFormModal({ customer, onClose, onSaved }: { customer?: B2BCustomer; onClose: () => void; onSaved: (c: B2BCustomer) => void }) {
  const editing = !!customer;
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [discount, setDiscount] = useState(customer ? String(customer.discount_percentage) : '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(discount);
    if (!name.trim()) {
      setError('اسم العميل مطلوب');
      return;
    }
    if (discount.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('نسبة الخصم لازم تكون رقم من ٠ لـ ١٠٠');
      return;
    }
    setSaving(true);
    setError(null);
    const fields = { name: name.trim(), phone: phone.trim() || null, discount_percentage: pct, notes: notes.trim() || null };
    try {
      onSaved(editing ? await b2bApi.updateCustomer(customer.id, fields) : await b2bApi.createCustomer(fields));
    } catch (err) {
      setError(apiErrorMessage(err, editing ? 'حصل خطأ أثناء حفظ بيانات العميل' : 'حصل خطأ أثناء إضافة العميل'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? `تعديل — ${customer.name}` : 'عميل جملة جديد'} onClose={() => !saving && onClose()}>
      <form onSubmit={handleSubmit} noValidate>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="cf-name">اسم العميل (صيدلية / مركز)</label>
          <input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="cf-phone">رقم التليفون (اختياري)</label>
          <input id="cf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="cf-discount">نسبة الخصم الثابتة (%)</label>
          <input id="cf-discount" type="number" min={0} max={100} step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} required
            aria-describedby={editing ? 'cf-discount-hint' : undefined} />
          {editing && (
            <span id="cf-discount-hint" className="field-hint">الخصم الجديد بيتطبق على الأوردرات الجاية بس — الأوردرات القديمة بتفضل بخصمها.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="cf-notes">ملاحظات (اختياري)</label>
          <textarea id="cf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'حفظ العميل'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={saving}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDetailsModal({ customerId, onClose, onChanged }: { customerId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [customer, setCustomer] = useState<B2BCustomer | null>(null);
  const [history, setHistory] = useState<B2BOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const load = useCallback(
    () => Promise.all([b2bApi.getCustomer(customerId), b2bApi.listOrders({ customer_id: customerId })]).then(
      ([c, o]) => {
        setCustomer(c);
        setHistory(o);
        setError(null);
      },
      (err) => setError(apiErrorMessage(err, 'تعذر تحميل بيانات العميل')),
    ),
    [customerId],
  );
  useEffect(() => {
    load();
  }, [load]);

  function remove() {
    if (!customer) return;
    confirmDialog.ask({
      title: `حذف «${customer.name}»؟`,
      message: 'العميل هيتمسح نهائيًا. ده مسموح بس لو مفيش عليه أوردرات.',
      confirmLabel: 'حذف العميل',
      danger: true,
      action: async () => {
        await b2bApi.deleteCustomer(customer.id);
        toast(`تم حذف «${customer.name}»`);
        onChanged();
        onClose();
      },
    });
  }

  const orderCount = history?.length ?? 0;
  return (
    <Modal title={customer ? customer.name : 'تفاصيل العميل'} onClose={onClose} wide>
      {confirmDialog.dialog}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!customer || !history ? (
        !error && <div className="empty-state" role="status">جاري التحميل...</div>
      ) : (
        <>
          <dl className="detail-grid">
            <div><dt>التليفون</dt><dd>{customer.phone || '—'}</dd></div>
            <div><dt>نسبة الخصم الثابتة</dt><dd><span className="pill">{customer.discount_percentage}%</span></dd></div>
            <div><dt>عميل من</dt><dd>{new Date(customer.created_at).toLocaleDateString('ar-EG')}</dd></div>
            <div><dt>عدد الأوردرات</dt><dd>{orderCount.toLocaleString('ar-EG')}</dd></div>
            {customer.notes && <div style={{ gridColumn: '1 / -1' }}><dt>ملاحظات</dt><dd>{customer.notes}</dd></div>}
          </dl>

          <h3 className="detail-heading">سجل الأوردرات</h3>
          {history.length === 0 ? (
            <div className="photo-empty">مفيش أوردرات لسه للعميل ده.</div>
          ) : (
            <ul className="record-list" aria-label={`أوردرات ${customer.name}`}>
              {history.map((o) => (
                <li key={o.id}>
                  <div>
                    <strong>{shortId(o.id)}</strong> · {dateTime(o.created_at)}
                    <div className="field-hint">
                      {o.items.length.toLocaleString('ar-EG')} صنف · خصم {o.items[0]?.discount_percentage ?? 0}%
                      {o.extra_discount_percentage ? ` (منه إضافي ${o.extra_discount_percentage}%)` : ''}
                    </div>
                  </div>
                  <div className="record-end">
                    <strong>{money(o.total_amount)}</strong>
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenOrder(o.id)} aria-label={`التفاصيل — أوردر ${shortId(o.id)}`}>
                      التفاصيل
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {orderCount > 0 && (
            <p id="cd-delete-hint" className="field-hint" style={{ marginTop: 14 }}>
              مينفعش تمسح العميل ده عشان عليه {orderCount.toLocaleString('ar-EG')} أوردر — الأوردرات جزء من سجل المبيعات والمخزون والحسابات.
            </p>
          )}
          <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>تعديل العميل</button>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={orderCount > 0}
              aria-describedby={orderCount > 0 ? 'cd-delete-hint' : undefined}>
              حذف العميل
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginInlineStart: 'auto' }}>إغلاق</button>
          </div>
        </>
      )}
      {editing && customer && (
        <CustomerFormModal
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={(c) => {
            setEditing(false);
            setCustomer(c);
            toast('تم حفظ بيانات العميل');
            onChanged();
          }}
        />
      )}
      {openOrder && (
        <OrderDetailsModal
          orderId={openOrder}
          onClose={() => setOpenOrder(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- orders

function OrderDetailsModal({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [order, setOrder] = useState<B2BOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    b2bApi.getOrder(orderId).then(setOrder, (err) => setError(apiErrorMessage(err, 'تعذر تحميل الأوردر')));
  }, [orderId]);

  function remove() {
    if (!order) return;
    confirmDialog.ask({
      title: `حذف الأوردر ${shortId(order.id)}؟`,
      message:
        `أوردر «${order.customer_name ?? ''}» بإجمالي ${money(order.total_amount)}. ` +
        'الكميات هترجع للمخزون، وهيتسجل مصروف بنفس المبلغ يلغي الإيراد — وسجل البيع الأصلي بيفضل في الحسابات وحركة المخزون.',
      confirmLabel: 'حذف الأوردر',
      danger: true,
      action: async () => {
        await b2bApi.deleteOrder(order.id);
        toast(`تم حذف الأوردر ${shortId(order.id)}`);
        onChanged();
        onClose();
      },
    });
  }

  const combined = order?.items[0]?.discount_percentage ?? 0;
  const extra = order?.extra_discount_percentage ?? 0;
  return (
    <Modal title={order ? `أوردر ${shortId(order.id)}` : 'تفاصيل الأوردر'} onClose={onClose} wide>
      {confirmDialog.dialog}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!order ? (
        !error && <div className="empty-state" role="status">جاري التحميل...</div>
      ) : (
        <>
          <dl className="detail-grid">
            <div><dt>العميل</dt><dd>{order.customer_name || '—'}</dd></div>
            <div><dt>التاريخ</dt><dd>{dateTime(order.created_at)}</dd></div>
            <div><dt>خصم العميل</dt><dd>{Math.max(0, combined - extra)}%</dd></div>
            <div><dt>خصم إضافي</dt><dd>{extra ? `${extra}%` : '—'}</dd></div>
            {order.note && <div style={{ gridColumn: '1 / -1' }}><dt>ملاحظات</dt><dd>{order.note}</dd></div>}
          </dl>
          <h3 className="detail-heading">المنتجات</h3>
          <ul className="record-list" aria-label="منتجات الأوردر">
            {order.items.map((it) => (
              <li key={it.product_id}>
                <div>
                  <strong>{it.product_name || it.product_id}</strong>
                  <div className="field-hint">
                    {it.quantity.toLocaleString('ar-EG')} × {money(it.unit_price)} · خصم {it.discount_percentage}%
                  </div>
                </div>
                <div className="record-end"><strong>{money(it.line_total)}</strong></div>
              </li>
            ))}
          </ul>
          <div className="pill" style={{ display: 'block', padding: '10px 14px', fontSize: 14, marginTop: 12 }}>
            الإجمالي بعد الخصم: <strong>{money(order.total_amount)}</strong>
          </div>
          <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>تعديل الأوردر</button>
            <button type="button" className="btn btn-danger" onClick={remove}>حذف الأوردر</button>
            <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginInlineStart: 'auto' }}>إغلاق</button>
          </div>
        </>
      )}
      {editing && order && (
        <OrderFormModal
          order={order}
          onClose={() => setEditing(false)}
          onSaved={(o) => {
            setEditing(false);
            setOrder(o);
            toast('تم حفظ تعديلات الأوردر');
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}

interface OrderLine {
  product_id: string;
  quantity: number;
}

/** Create an order, or edit one (`order`). Editing follows the backend's
 * rules (routers/b2b.py update_order): the customer is fixed, lines already
 * in the order keep their sale price, the customer's discount stays what it
 * was when the order was placed, and stock and finance are reconciled by
 * the server. */
function OrderFormModal({ order, onClose, onSaved }: { order?: B2BOrder; onClose: () => void; onSaved: (o: B2BOrder) => void }) {
  const editing = !!order;
  // Every customer, by name, for the picker (the page itself only loads the newest few).
  const [customers, setCustomers] = useState<B2BCustomer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState(order?.customer_id ?? '');
  const [lines, setLines] = useState<OrderLine[]>(order ? order.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })) : []);
  const [addProductId, setAddProductId] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');
  const [extraDiscount, setExtraDiscount] = useState(order ? String(order.extra_discount_percentage) : '0');
  const [note, setNote] = useState(order?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productsApi.list().then((list) => {
      setProducts(list);
      if (list[0]) setAddProductId(list[0].id);
    });
    if (!order) {
      b2bApi.listCustomers().then(
        (list) => {
          setCustomers(list);
          if (list[0]) setCustomerId(list[0].id);
        },
        () => setError('تعذر تحميل العملاء'),
      );
    }
  }, [order]);

  const storedDiscount = order?.items[0]?.discount_percentage ?? 0;
  const extraLocked = editing && storedDiscount >= 100;
  const customer = customers.find((c) => c.id === customerId);
  // The customer part: when the order was placed (editing) or today's (new order).
  const customerPart = order ? storedDiscount - order.extra_discount_percentage : customer?.discount_percentage ?? 0;
  const extraChanged = order ? (Number(extraDiscount) || 0) !== order.extra_discount_percentage : true;
  const combinedDiscount = editing && !extraChanged ? storedDiscount : Math.min(100, customerPart + (Number(extraDiscount) || 0));

  function addLine() {
    if (!addProductId) return;
    const qty = Number(addQuantity) || 0;
    if (qty <= 0) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.product_id === addProductId);
      if (existing) {
        return prev.map((l) => (l.product_id === addProductId ? { ...l, quantity: l.quantity + qty } : l));
      }
      return [...prev, { product_id: addProductId, quantity: qty }];
    });
    setAddQuantity('1');
  }

  function setLineQuantity(productId: string, value: string) {
    const qty = Math.max(1, Math.floor(Number(value) || 1));
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, quantity: qty } : l)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name || order?.items.find((i) => i.product_id === id)?.product_name || id;
  // Lines already in the order keep the price they were sold at.
  const unitPrice = (id: string) => order?.items.find((i) => i.product_id === id)?.unit_price ?? products.find((p) => p.id === id)?.sale_price ?? 0;
  const total = lines.reduce((sum, l) => sum + unitPrice(l.product_id) * l.quantity * (1 - combinedDiscount / 100), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!editing && !customer) || lines.length === 0) {
      setError('اختاري عميل وأضيفي منتج واحد على الأقل');
      return;
    }
    const extra = Number(extraDiscount) || 0;
    if (extra < 0 || extra > 100) {
      setError('الخصم الإضافي لازم يكون من ٠ لـ ١٠٠');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = order
        ? await b2bApi.updateOrder(order.id, { items: lines, note: note.trim() || null, extra_discount_percentage: extra })
        : await b2bApi.createOrder({ customer_id: customerId, items: lines, note: note || undefined, extra_discount_percentage: extra });
      onSaved(saved);
    } catch (err: unknown) {
      setError(apiErrorMessage(err, editing ? 'حصل خطأ أثناء حفظ التعديلات' : 'حصل خطأ أثناء إنشاء الأوردر'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={order ? `تعديل الأوردر ${shortId(order.id)}` : 'أوردر جملة جديد'} onClose={() => !saving && onClose()}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {order ? (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>العميل</label>
            <div>{order.customer_name || '—'} — خصم وقت الأوردر {customerPart}%</div>
            <span className="field-hint">
              العميل مينفعش يتغير في أوردر متسجّل. الأصناف الموجودة بتفضل بسعر بيعها الأصلي، والصنف الجديد بيتسعّر بسعر النهارده؛
              المخزون والحسابات بيتظبطوا تلقائيًا بالفرق.
            </span>
          </div>
        ) : (
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="of-customer">العميل</label>
            <select id="of-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — خصم ثابت {c.discount_percentage}%</option>
              ))}
            </select>
          </div>
        )}

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="of-extra">خصم إضافي لمرة واحدة (%) — اختياري، بيتحسب فوق خصم العميل الثابت</label>
          <input id="of-extra" type="number" min={0} max={100} value={extraDiscount} onChange={(e) => setExtraDiscount(e.target.value)}
            disabled={extraLocked} aria-describedby={extraLocked ? 'of-extra-hint' : undefined} />
          {extraLocked && (
            <span id="of-extra-hint" className="field-hint">الخصم الكلي وصل ١٠٠٪ فمينفعش تعديل الخصم الإضافي هنا — تقدر تعدّل المنتجات والكميات.</span>
          )}
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="of-product">إضافة منتجات</label>
          {/* min-width 0: a select is otherwise at least as wide as its longest
              option (long product names), which pushed the row — and the
              modal — wider than the screen. Wraps on narrow screens. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select id="of-product" value={addProductId} onChange={(e) => setAddProductId(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0 }}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — متاح {p.quantity}</option>
              ))}
            </select>
            <input
              type="number" min={1} value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} aria-label="الكمية"
              style={{ width: 80, border: '1px solid var(--line)', borderRadius: 6, padding: '8px' }}
            />
            <button type="button" className="btn btn-secondary" onClick={addLine}>+ إضافة</button>
          </div>
        </div>

        {lines.length > 0 && (
          <ul className="record-list" aria-label="منتجات الأوردر" style={{ marginBottom: 14 }}>
            {lines.map((l) => (
              <li key={l.product_id}>
                <div style={{ minWidth: 0 }}>
                  <strong>{productName(l.product_id)}</strong>
                  <div className="field-hint">{money(unitPrice(l.product_id))} للوحدة</div>
                </div>
                <div className="record-end">
                  <input type="number" min={1} value={l.quantity} onChange={(e) => setLineQuantity(l.product_id, e.target.value)}
                    aria-label={`كمية ${productName(l.product_id)}`}
                    style={{ width: 70, border: '1px solid var(--line)', borderRadius: 6, padding: '6px' }} />
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(l.product_id)} aria-label={`إزالة ${productName(l.product_id)}`}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="of-note">ملاحظات (اختياري)</label>
          <input id="of-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </div>

        {(editing || customer) && lines.length > 0 && (
          <div className="pill" style={{ display: 'block', padding: '10px 14px', fontSize: 13.5 }}>
            الإجمالي بعد خصم {combinedDiscount}% (العميل {customerPart}% + إضافي {extraDiscount || 0}%): <strong>{money(total)}</strong>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving || (!editing && !customer) || lines.length === 0}>
            {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'تأكيد الأوردر'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={saving}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
