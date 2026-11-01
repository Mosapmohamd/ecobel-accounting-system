import { useEffect, useState } from 'react';
import { apiErrorMessage, categoriesApi, type Category } from '../lib/api';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';

/** Product categories: add, rename, and delete one nothing uses. Products
 * refer to a category by id, so renaming keeps every product in it; the
 * storefront shows the new name on its next page load. */
export default function CategoriesPage() {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Reloads in place (no loading flash after a change); `loading` only
  // covers the first load.
  function load() {
    categoriesApi
      .list()
      .then((list) => {
        setCategories(list);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err, 'تعذر تحميل الفئات')))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const before = new Set(categories.map((c) => c.id));
      const created = await categoriesApi.create(name);
      toast(before.has(created.id) ? `الفئة «${created.name}» موجودة بالفعل` : `اتضافت فئة «${created.name}»`);
      setName('');
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر إضافة الفئة'));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditName(c.name);
    setError(null);
  }

  async function saveEdit(c: Category) {
    if (editName.trim() === c.name) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await categoriesApi.rename(c.id, editName);
      toast(`الفئة بقى اسمها «${updated.name}»`);
      setEditingId(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر تعديل اسم الفئة'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(c: Category) {
    confirmDialog.ask({
      title: `حذف فئة «${c.name}»؟`,
      message: 'الفئة هتتشال نهائيًا. ينفع تتمسح بس لو مفيش عليها منتجات (ولا مؤرشفة) ولا عروض.',
      confirmLabel: 'حذف الفئة',
      danger: true,
      action: async () => {
        await categoriesApi.remove(c.id);
        toast(`اتمسحت فئة «${c.name}»`);
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
            <h2>الفئات</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--color-ink-muted)', marginTop: 2 }}>
              فئات المنتجات اللي بتظهر في الموقع. تغيير الاسم بيفضّل كل المنتجات في الفئة.
            </div>
          </div>
        </div>

        {error && <div className="error-banner" role="alert" style={{ margin: '0 22px 16px' }}>{error}</div>}

        <form onSubmit={handleAdd} style={{ padding: '0 22px 22px', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="new-category">اسم الفئة الجديدة</label>
            <input id="new-category" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : '+ إضافة'}</button>
        </form>

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : categories.length === 0 ? (
          <div className="empty-state">مفيش فئات لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>الفئة</th><th>منتجات ظاهرة</th><th>منتجات مؤرشفة</th><th></th></tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {editingId === c.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveEdit(c);
                        }}
                        style={{ display: 'flex', gap: 6 }}
                      >
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={100}
                          required
                          autoFocus
                          aria-label={`اسم جديد لفئة ${c.name}`}
                          style={{ flex: 1, border: '1px solid var(--color-line)', borderRadius: 6, padding: '5px 8px', fontSize: 13 }}
                        />
                        <button className="btn btn-primary btn-sm" disabled={saving}>حفظ</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>إلغاء</button>
                      </form>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td>{c.product_count.toLocaleString('ar-EG')}</td>
                  <td>{c.archived_product_count.toLocaleString('ar-EG')}</td>
                  <td>
                    {editingId !== c.id && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(c)}>تعديل الاسم</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>حذف</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
