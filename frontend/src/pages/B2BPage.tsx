import { Fragment, useEffect, useState } from 'react';
import { b2bApi, productsApi, type B2BCustomer, type B2BOrder, type Product } from '../lib/api';
import Modal from '../components/Modal';

export default function B2BPage() {
  const [customers, setCustomers] = useState<B2BCustomer[]>([]);
  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([b2bApi.listCustomers(), b2bApi.listOrders()])
      .then(([c, o]) => {
        setCustomers(c);
        setOrders(o);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const customerName = (id: string) => customers.find((c) => c.id === id)?.name || '—';

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>عملاء الجملة B2B</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              نسبة الخصم ثابتة لكل عميل وتُحسب تلقائيًا على كل أوردر
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNewCustomer(true)}>+ عميل جديد</button>
        </div>
        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : customers.length === 0 ? (
          <div className="empty-state">مفيش عملاء جملة مضافين لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>العميل</th><th>التليفون</th><th>نسبة الخصم</th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.phone || '—'}</td>
                  <td><span className="pill">{c.discount_percentage}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>أوردرات الجملة</h2>
          <button
            className="btn btn-primary"
            onClick={() => setShowNewOrder(true)}
            disabled={customers.length === 0}
          >
            + أوردر جديد
          </button>
        </div>
        {orders.length === 0 ? (
          <div className="empty-state">مفيش أوردرات جملة مسجّلة لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>العميل</th><th>عدد الأصناف</th><th>خصم إضافي</th><th>الإجمالي بعد الخصم</th><th>التاريخ</th><th></th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{customerName(o.customer_id)}</td>
                    <td>{o.items.length}</td>
                    <td>{o.extra_discount_percentage ? `${o.extra_discount_percentage}%` : '—'}</td>
                    <td>{o.total_amount.toLocaleString('ar-EG')} ج.م</td>
                    <td>{new Date(o.created_at).toLocaleDateString('ar-EG')}</td>
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
                          {o.note && <div style={{ marginBottom: 8 }}><strong>ملاحظات:</strong> {o.note}</div>}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {o.items.map((it) => (
                              <div key={it.product_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>{it.quantity} × {it.unit_price.toLocaleString('ar-EG')} ج.م (خصم {it.discount_percentage}%)</span>
                                <span style={{ fontWeight: 700 }}>{it.line_total.toLocaleString('ar-EG')} ج.م</span>
                              </div>
                            ))}
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

      {showNewCustomer && (
        <NewCustomerModal onClose={() => setShowNewCustomer(false)} onCreated={() => { setShowNewCustomer(false); load(); }} />
      )}
      {showNewOrder && (
        <NewOrderModal
          customers={customers}
          onClose={() => setShowNewOrder(false)}
          onCreated={() => { setShowNewOrder(false); load(); }}
        />
      )}
    </div>
  );
}

function NewCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [discount, setDiscount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await b2bApi.createCustomer({ name, phone, discount_percentage: Number(discount) || 0 });
      onCreated();
    } catch {
      setError('حصل خطأ أثناء إضافة العميل');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="عميل جملة جديد" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>اسم العميل (صيدلية / مركز)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>رقم التليفون (اختياري)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>نسبة الخصم الثابتة (%)</label>
          <input type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} required />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ العميل'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

interface OrderLine {
  product_id: string;
  quantity: number;
}

function NewOrderModal({
  customers,
  onClose,
  onCreated,
}: {
  customers: B2BCustomer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [addProductId, setAddProductId] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');
  const [extraDiscount, setExtraDiscount] = useState('0');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productsApi.list().then((list) => {
      setProducts(list);
      if (list[0]) setAddProductId(list[0].id);
    });
  }, []);

  const customer = customers.find((c) => c.id === customerId);
  const combinedDiscount = Math.min(100, (customer?.discount_percentage || 0) + (Number(extraDiscount) || 0));

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

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name || id;
  const productPrice = (id: string) => products.find((p) => p.id === id)?.sale_price || 0;
  const total = lines.reduce((sum, l) => sum + productPrice(l.product_id) * l.quantity * (1 - combinedDiscount / 100), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer || lines.length === 0) {
      setError('اختاري عميل وأضيفي منتج واحد على الأقل');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await b2bApi.createOrder({
        customer_id: customerId,
        items: lines,
        note: note || undefined,
        extra_discount_percentage: Number(extraDiscount) || 0,
      });
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'حصل خطأ أثناء إنشاء الأوردر');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="أوردر جملة جديد" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>العميل</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — خصم ثابت {c.discount_percentage}%</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>خصم إضافي لمرة واحدة (%) — اختياري، بيتحسب فوق خصم العميل الثابت</label>
          <input type="number" min={0} max={100} value={extraDiscount} onChange={(e) => setExtraDiscount(e.target.value)} />
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>إضافة منتجات</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} style={{ flex: 1 }}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — متاح {p.quantity}</option>
              ))}
            </select>
            <input
              type="number" min={1} value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)}
              style={{ width: 80, border: '1px solid var(--line)', borderRadius: 6, padding: '8px' }}
            />
            <button type="button" className="btn btn-secondary" onClick={addLine}>+ إضافة</button>
          </div>
        </div>

        {lines.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lines.map((l) => (
              <div key={l.product_id} className="pill" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
                <span>{productName(l.product_id)} × {l.quantity}</span>
                <button type="button" onClick={() => removeLine(l.product_id)} style={{ color: 'var(--rose)' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="field" style={{ marginBottom: 14 }}>
          <label>ملاحظات (اختياري)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {customer && lines.length > 0 && (
          <div className="pill" style={{ display: 'block', padding: '10px 14px', fontSize: 13.5 }}>
            الإجمالي بعد خصم {combinedDiscount}% (ثابت {customer.discount_percentage}% + إضافي {extraDiscount || 0}%): <strong>{total.toLocaleString('ar-EG')} ج.م</strong>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving || !customer || lines.length === 0}>
            {saving ? 'جاري الحفظ...' : 'تأكيد الأوردر'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
