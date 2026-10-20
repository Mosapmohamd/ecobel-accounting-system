import { useEffect, useState } from 'react';
import { apiErrorMessage, productsApi, categoriesApi, inventoryApi, type Product, type Category } from '../lib/api';
import Modal from '../components/Modal';
import { ProductImageCell, ProductPhotos } from '../components/ProductImageManager';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';

const statusLabel: Record<string, string> = { ok: 'متوفر', low: 'منخفض', out: 'نفذ' };
// Same limits as the backend (schemas.SHORT_DESCRIPTION_MAX / DESCRIPTION_MAX).
const SHORT_DESCRIPTION_MAX = 400;
const DESCRIPTION_MAX = 8000;

type ListStatus = 'active' | 'archived';

export default function ProductsPage() {
  const [status, setStatus] = useState<ListStatus>('active');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const confirmDialog = useConfirm();
  const toast = useToast();

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([productsApi.list({ status }), categoriesApi.list()])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch(() => setError('تعذر تحميل المنتجات'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [status]);

  const replaceProduct = (updated: Product) => setProducts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

  function archive(p: Product) {
    confirmDialog.ask({
      title: `حذف «${p.name}»؟`,
      message:
        'المنتج هيختفي من الموقع ومن قوائم البيع، لكن هيتحفظ في «المؤرشفة» — مش هيتمسح نهائيًا، ' +
        'عشان الطلبات وحركات المخزون والتقارير القديمة المرتبطة بيه تفضل سليمة. تقدر ترجّعه في أي وقت.',
      confirmLabel: 'حذف المنتج',
      danger: true,
      action: async () => {
        await productsApi.deactivate(p.id);
        setProducts((prev) => prev.filter((x) => x.id !== p.id));
        toast(`تم حذف «${p.name}» ونقله للمؤرشفة`);
      },
    });
  }

  function restore(p: Product) {
    confirmDialog.ask({
      title: `استرجاع «${p.name}»؟`,
      message: 'المنتج هيرجع للقوائم ويظهر في الموقع تاني لو له كمية في المخزون.',
      confirmLabel: 'استرجاع',
      action: async () => {
        await productsApi.restore(p.id);
        setProducts((prev) => prev.filter((x) => x.id !== p.id));
        toast(`تم استرجاع «${p.name}»`);
      },
    });
  }

  const archived = status === 'archived';
  return (
    <div>
      {confirmDialog.dialog}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>المنتجات والمخزون</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="status-tabs" role="group" aria-label="عرض المنتجات">
              <button type="button" aria-pressed={!archived} onClick={() => setStatus('active')}>النشطة</button>
              <button type="button" aria-pressed={archived} onClick={() => setStatus('archived')}>المؤرشفة</button>
            </div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + منتج جديد
            </button>
          </div>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}
        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            {archived ? 'مفيش منتجات مؤرشفة.' : 'مفيش منتجات مضافة لسه. دوس "منتج جديد" عشان تبدأ.'}
          </div>
        ) : (
          <table className="products-table">
            <thead>
              <tr>
                <th>الصورة</th>
                <th>المنتج</th>
                <th>الفئة</th>
                <th>سعر البيع</th>
                <th>الكمية</th>
                <th>الحالة</th>
                <th><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><ProductImageCell product={p} onChanged={replaceProduct} /></td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td data-label="الفئة">{p.category_name}</td>
                  <td data-label="السعر">{p.sale_price.toLocaleString('ar-EG')} ج.م</td>
                  <td data-label="الكمية">{p.quantity}</td>
                  <td>
                    {archived ? (
                      <span className="status out">مؤرشف</span>
                    ) : (
                      <span className={`status ${p.stock_status}`}>{statusLabel[p.stock_status]}</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditTarget(p)} aria-label={`تعديل ${p.name}`}>
                      تعديل
                    </button>
                    {archived ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => restore(p)} aria-label={`استرجاع ${p.name}`}>
                        استرجاع
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => setAdjustTarget(p)}>
                          تسوية مخزون
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => archive(p)} aria-label={`حذف ${p.name}`}>
                          حذف
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <ProductFormModal
          categories={categories}
          onClose={() => setShowCreate(false)}
          onSaved={(created) => {
            setShowCreate(false);
            load();
            // Straight on to its photos — they can only be added once the product exists.
            setEditTarget(created);
            toast('تمت إضافة المنتج — تقدر تضيف صوره دلوقتي');
          }}
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
      {editTarget && (
        <ProductFormModal
          product={editTarget}
          categories={categories}
          onClose={() => setEditTarget(null)}
          onPhotosChanged={replaceProduct}
          onSaved={() => {
            setEditTarget(null);
            toast('تم حفظ التعديلات');
            load();
          }}
          onCategoryAdded={(c) => setCategories((prev) => [...prev, c])}
        />
      )}
    </div>
  );
}

/** Create (no `product`) or edit a product. Photos are managed inside the
 * edit form and saved immediately; the other fields save with the button. */
function ProductFormModal({
  product: initial,
  categories,
  onClose,
  onSaved,
  onPhotosChanged,
  onCategoryAdded,
}: {
  product?: Product;
  categories: Category[];
  onClose: () => void;
  onSaved: (p: Product) => void;
  onPhotosChanged?: (p: Product) => void;
  onCategoryAdded: (c: Category) => void;
}) {
  const editing = !!initial;
  const [product, setProduct] = useState(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? categories[0]?.id ?? '');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [salePrice, setSalePrice] = useState(initial ? String(initial.sale_price) : '');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState(String(initial?.low_stock_threshold ?? 10));
  const [shortDescription, setShortDescription] = useState(initial?.short_description ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photosBusy, setPhotosBusy] = useState(false);

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
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر إضافة الفئة'));
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('اسم المنتج مطلوب');
      return;
    }
    if (!categoryId) {
      setError('لازم تختار فئة أو تضيف فئة جديدة');
      return;
    }
    const price = Number(salePrice);
    if (salePrice.trim() === '' || !Number.isFinite(price) || price < 0) {
      setError('سعر البيع لازم يكون رقم صفر أو أكتر');
      return;
    }
    setError(null);
    setSaving(true);
    const fields = {
      name: name.trim(),
      category_id: categoryId,
      sale_price: price,
      low_stock_threshold: Number(threshold) || 10,
      short_description: shortDescription.trim() || null,
      description: description.trim() || null,
    };
    try {
      const saved = editing && product
        ? await productsApi.update(product.id, fields)
        : await productsApi.create({ ...fields, quantity: Number(quantity) || 0 });
      onSaved(saved);
    } catch (err) {
      setError(apiErrorMessage(err, editing ? 'حصل خطأ أثناء حفظ التعديلات' : 'حصل خطأ أثناء إضافة المنتج'));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || photosBusy;
  return (
    <Modal title={editing ? `تعديل — ${initial!.name}` : 'منتج جديد'} onClose={() => !busy && onClose()} wide>
      <form onSubmit={handleSubmit} noValidate>
        {error && <div role="alert" className="error-banner">{error}</div>}
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pf-name">اسم المنتج</label>
            <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pf-category">الفئة</label>
            {!addingCategory ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <select id="pf-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ flex: 1 }}>
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
                  aria-label="اسم الفئة الجديدة"
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

          {!editing && (
            <div className="field">
              <label htmlFor="pf-qty">الكمية الحالية</label>
              <input id="pf-qty" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pf-price">سعر البيع (ج.م)</label>
            <input id="pf-price" type="number" min={0} step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pf-threshold">حد التنبيه بانخفاض المخزون</label>
            <input id="pf-threshold" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
          {editing && (
            <div className="field">
              <label>الكمية الحالية</label>
              <div style={{ padding: '9px 0', fontSize: 13.5 }}>
                {initial!.quantity} <span className="field-hint">(بتتغير من «تسوية مخزون»)</span>
              </div>
            </div>
          )}

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pf-short">وصف مختصر</label>
            <textarea
              id="pf-short"
              rows={2}
              maxLength={SHORT_DESCRIPTION_MAX}
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              aria-describedby="pf-short-hint"
            />
            <span id="pf-short-hint" className="field-hint">
              جملة أو تلاتة بيظهروا جنب السعر: المنتج بيعمل إيه وأهم فايدة ليه. ({shortDescription.length.toLocaleString('ar-EG')} / {SHORT_DESCRIPTION_MAX.toLocaleString('ar-EG')})
            </span>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pf-desc">الوصف الكامل</label>
            <textarea
              id="pf-desc"
              rows={8}
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby="pf-desc-hint"
            />
            <span id="pf-desc-hint" className="field-hint">
              بيظهر تحت تفاصيل المنتج. سيبي سطر فاضي بين الفقرات، والسطر اللي يبدأ بـ «## » يبقى عنوان،
              واللي يبدأ بـ «- » يبقى نقطة في قائمة. ({description.length.toLocaleString('ar-EG')} / {DESCRIPTION_MAX.toLocaleString('ar-EG')})
            </span>
          </div>
        </div>

        {editing && product && (
          <section aria-labelledby="pf-photos" style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
            <h3 id="pf-photos" style={{ fontSize: 16, color: 'var(--forest-deep)', margin: '0 0 8px' }}>صور المنتج</h3>
            <ProductPhotos
              product={product}
              onBusyChange={setPhotosBusy}
              onChanged={(p) => {
                setProduct(p);
                onPhotosChanged?.(p);
              }}
            />
          </section>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديلات' : 'حفظ المنتج'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>إلغاء</button>
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
      <p style={{ fontSize: 13.5, color: 'var(--ink-muted)', marginTop: -8 }}>
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
