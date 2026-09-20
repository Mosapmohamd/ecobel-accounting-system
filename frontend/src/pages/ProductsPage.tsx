import { useEffect, useState } from 'react';
import { productsApi, categoriesApi, inventoryApi, type Product, type Category } from '../lib/api';
import Modal from '../components/Modal';

const statusLabel: Record<string, string> = { ok: 'متوفر', low: 'منخفض', out: 'نفذ' };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);

  function load() {
    setLoading(true);
    Promise.all([productsApi.list(), categoriesApi.list()])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch(() => setError('تعذر تحميل المنتجات'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>المنتجات والمخزون</h2>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + منتج جديد
          </button>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}
        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : products.length === 0 ? (
          <div className="empty-state">مفيش منتجات مضافة لسه. دوس "منتج جديد" عشان تبدأ.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الفئة</th>
                <th>سعر البيع</th>
                <th>الكمية</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.category_name}</td>
                  <td>{p.sale_price.toLocaleString('ar-EG')} ج.م</td>
                  <td>{p.quantity}</td>
                  <td>
                    <span className={`status ${p.stock_status}`}>{statusLabel[p.stock_status]}</span>
                  </td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => setAdjustTarget(p)}>
                      تسوية مخزون
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateProductModal
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
          onCategoryAdded={(c) => setCategories((prev) => [...prev, c])}
        />
      )}
      {adjustTarget && (
        <AdjustStockModal
          product={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onAdjusted={() => { setAdjustTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function CreateProductModal({
  categories,
  onClose,
  onCreated,
  onCategoryAdded,
}: {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
  onCategoryAdded: (c: Category) => void;
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [salePrice, setSalePrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setSavingCategory(true);
    try {
      const category = await categoriesApi.create(trimmed);
      onCategoryAdded(category);
      setCategoryId(category.id);
      setNewCategoryName('');
      setAddingCategory(false);
    } catch {
      setError('تعذر إضافة الفئة');
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError('لازم تختار فئة أو تضيف فئة جديدة');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await productsApi.create({
        name,
        category_id: categoryId,
        sale_price: Number(salePrice) || 0,
        cost_price: Number(costPrice) || 0,
        quantity: Number(quantity) || 0,
        low_stock_threshold: Number(threshold) || 10,
      });
      onCreated();
    } catch {
      setError('حصل خطأ أثناء إضافة المنتج');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="منتج جديد" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>اسم المنتج</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>الفئة</label>
            {!addingCategory ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ flex: 1 }}>
                  {categories.length === 0 && <option value="">لا توجد فئات بعد</option>}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => setAddingCategory(true)}>
                  + فئة جديدة
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="اسم الفئة الجديدة"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button type="button" className="btn btn-primary" onClick={handleAddCategory} disabled={savingCategory}>
                  {savingCategory ? '...' : 'إضافة'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setAddingCategory(false)}>
                  إلغاء
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label>الكمية الحالية</label>
            <input type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <div className="field">
            <label>سعر البيع (ج.م)</label>
            <input type="number" min={0} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required />
          </div>
          <div className="field">
            <label>سعر التكلفة (ج.م)</label>
            <input type="number" min={0} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>حد التنبيه بانخفاض المخزون</label>
            <input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ المنتج'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustStockModal({
  product,
  onClose,
  onAdjusted,
}: {
  product: Product;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [change, setChange] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(change);
    if (!value) {
      setError('اكتب رقم موجب للإضافة أو سالب للخصم');
      return;
    }
    setSaving(true);
    try {
      await inventoryApi.adjust({ product_id: product.id, quantity_change: value, note });
      onAdjusted();
    } catch {
      setError('حصل خطأ أثناء تسوية المخزون');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`تسوية مخزون — ${product.name}`} onClose={onClose}>
      <p style={{ fontSize: 13.5, color: '#8a8074', marginTop: -8 }}>
        الكمية الحالية: <strong>{product.quantity}</strong>
      </p>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>الكمية (رقم موجب = وارد جديد، سالب = خصم/تصحيح)</label>
          <input type="number" value={change} onChange={(e) => setChange(e.target.value)} placeholder="مثال: 20 أو -5" autoFocus />
        </div>
        <div className="field">
          <label>ملاحظة (اختياري)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب التسوية" />
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'تطبيق'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
