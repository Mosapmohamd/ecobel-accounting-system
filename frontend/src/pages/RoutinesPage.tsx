import { useEffect, useState } from 'react';
import { routinesApi, productsApi, type Routine, type Product } from '../lib/api';

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([routinesApi.list(), productsApi.list()])
      .then(([r, p]) => { setRoutines(r); setProducts(p); })
      .catch(() => setError('تعذر تحميل الروتينات'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function toggleProduct(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length < 2) {
      setError('اختاري منتجين أو تلاتة على الأقل');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await routinesApi.create({ name, description: description || undefined, product_ids: selected });
      setName(''); setDescription(''); setSelected([]);
      setShowNew(false);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'تعذر إضافة الروتين');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('متأكد إنك عايز تحذف الروتين ده؟')) return;
    await routinesApi.remove(id);
    load();
  }

  async function toggleActive(r: Routine) {
    await routinesApi.update(r.id, { is_active: !r.is_active });
    load();
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>روتينات الموقع</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              مجموعة من 2 أو 3 منتجات من نفس النوع، تظهر كباقة في قسم "الروتين" بالصفحة الرئيسية
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew((s) => !s)}>
            {showNew ? 'إلغاء' : '+ روتين جديد'}
          </button>
        </div>

        {error && <div className="error-banner" style={{ margin: '16px 22px' }}>{error}</div>}

        {showNew && (
          <form onSubmit={handleCreate} style={{ padding: '0 22px 22px' }}>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>اسم الروتين</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: روتين العناية الصباحي" required />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>وصف مختصر (اختياري)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>المنتجات (اختاري 2 أو 3)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {products.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className="btn"
                    style={{
                      background: selected.includes(p.id) ? 'var(--forest)' : 'var(--parchment-2)',
                      color: selected.includes(p.id) ? 'var(--cream)' : 'var(--forest)',
                      fontSize: 12.5, padding: '6px 12px',
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="sub" style={{ fontSize: 12, color: '#8a8074', marginTop: 6 }}>
                {selected.length}/3 منتجات مختارة
              </div>
            </div>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ الروتين'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : routines.length === 0 ? (
          <div className="empty-state">مفيش روتينات مضافة لسه.</div>
        ) : (
          <div style={{ padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {routines.map((r) => (
              <div
                key={r.id}
                style={{
                  border: '1px solid var(--line)', borderRadius: 10, padding: 16,
                  opacity: r.is_active ? 1 : 0.55, background: 'var(--cream)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    {r.description && <div style={{ fontSize: 12.5, color: '#8a8074' }}>{r.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => toggleActive(r)}>
                      {r.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '5px 10px', fontSize: 12.5, background: 'rgba(201,123,138,0.15)', color: 'var(--rose)' }}
                      onClick={() => handleDelete(r.id)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#8a8074' }}>
                  {r.items.map((it) => it.product_name).join(' + ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
