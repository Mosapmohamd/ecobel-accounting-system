import { useEffect, useState } from 'react';
import { freeDistributionApi, productsApi, type FreeDistribution, type Product, type RecipientType } from '../lib/api';
import Modal from '../components/Modal';

const typeLabel: Record<RecipientType, string> = {
  pharmacy: 'صيدلية',
  potential_customer: 'عميل محتمل',
};

export default function FreeDistributionPage() {
  const [items, setItems] = useState<FreeDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    freeDistributionApi.list().then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const totalPieces = (d: FreeDistribution) => d.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>التوزيع المجاني (عينات)</h2>
            <div style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              خصم مباشر من المخزون بدون قيمة بيعية — للصيدليات والعملاء المحتملين
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ تسجيل توزيع</button>
        </div>
        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">مفيش عينات مسجّلة لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>الجهة</th><th>النوع</th><th>عدد القطع</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.recipient_name}</td>
                  <td>{typeLabel[d.recipient_type]}</td>
                  <td>{totalPieces(d)}</td>
                  <td>{new Date(d.created_at).toLocaleDateString('ar-EG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewDistributionModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewDistributionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipientName, setRecipientName] = useState('');
  const [recipientType, setRecipientType] = useState<RecipientType>('pharmacy');
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity) || 0;
    if (!productId || qty <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await freeDistributionApi.create({
        recipient_name: recipientName,
        recipient_type: recipientType,
        items: [{ product_id: productId, quantity: qty }],
      });
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'حصل خطأ أثناء التسجيل');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="تسجيل توزيع مجاني" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>اسم الجهة</label>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required autoFocus />
        </div>
        <div className="form-grid">
          <div className="field">
            <label>النوع</label>
            <select value={recipientType} onChange={(e) => setRecipientType(e.target.value as RecipientType)}>
              <option value="pharmacy">صيدلية</option>
              <option value="potential_customer">عميل محتمل</option>
            </select>
          </div>
          <div className="field">
            <label>المنتج</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — متاح {p.quantity}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>الكمية</label>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'تسجيل'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
