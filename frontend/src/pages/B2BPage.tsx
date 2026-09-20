import { useEffect, useState } from 'react';
import { b2bApi, productsApi, type B2BCustomer, type B2BOrder, type Product } from '../lib/api';
import Modal from '../components/Modal';

export default function B2BPage() {
  const [customers, setCustomers] = useState<B2BCustomer[]>([]);
  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);

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
              <tr><th>العميل</th><th>عدد الأصناف</th><th>الإجمالي بعد الخصم</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{customerName(o.customer_id)}</td>
                  <td>{o.items.length}</td>
                  <td>{o.total_amount.toLocaleString('ar-EG')} ج.م</td>
                  <td>{new Date(o.created_at).toLocaleDateString('ar-EG')}</td>
                </tr>
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
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    productsApi.list().then((list) => {
      setProducts(list);
      if (list[0]) setProductId(list[0].id);
    });
  }, []);

  const customer = customers.find((c) => c.id === customerId);
  const product = products.find((p) => p.id === productId);
  const qty = Number(quantity) || 0;
  const lineTotal = product && customer ? product.sale_price * qty * (1 - customer.discount_percentage / 100) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || !customer || qty <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await b2bApi.createOrder({ customer_id: customerId, items: [{ product_id: productId, quantity: qty }] });
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'حصل خطأ أثناء إنشاء الأوردر');
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
              <option key={c.id} value={c.id}>{c.name} — خصم {c.discount_percentage}%</option>
            ))}
          </select>
        </div>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>المنتج</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — متاح {p.quantity}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>الكمية</label>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>

        {product && customer && (
          <div className="pill" style={{ display: 'block', padding: '10px 14px', fontSize: 13.5 }}>
            الإجمالي بعد خصم {customer.discount_percentage}%: <strong>{lineTotal.toLocaleString('ar-EG')} ج.م</strong>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving || !customer}>
            {saving ? 'جاري الحفظ...' : 'تأكيد الأوردر'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
