import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiErrorMessage, merchandisingApi, productsApi, routinesApi,
  FEATURED_PRODUCTS_MAX, FEATURED_ROUTINES_MAX,
  type Product, type Routine,
} from '../lib/api';

/** One row in a homepage section: what staff picked, and whether the
 * storefront can currently show it. */
interface SlotItem {
  id: string;
  label: string;
  meta: string;
  issue: string | null;
}

/** Ordered homepage slots for one section: add, remove, move up/down,
 * then save the whole order at once. */
function SlotEditor({
  title,
  description,
  max,
  saved,
  candidates,
  addLabel,
  onSave,
}: {
  title: string;
  description: string;
  max: number;
  saved: SlotItem[];
  candidates: SlotItem[];
  addLabel: string;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SlotItem[]>(saved);
  // A new saved selection (after a save or reload) replaces the draft.
  const [prevSaved, setPrevSaved] = useState(saved);
  if (saved !== prevSaved) {
    setPrevSaved(saved);
    setDraft(saved);
  }
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = draft.map((d) => d.id).join() !== saved.map((s) => s.id).join();
  const available = candidates.filter((c) => !draft.some((d) => d.id === c.id));
  const full = draft.length >= max;

  function move(index: number, delta: number) {
    setDraft((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
    setNotice(null);
  }

  function add() {
    const item = candidates.find((c) => c.id === adding);
    if (!item || full) return;
    setDraft((prev) => [...prev, item]);
    setAdding('');
    setNotice(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.map((d) => d.id));
      setNotice('تم الحفظ — الصفحة الرئيسية للموقع اتحدثت');
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر الحفظ'));
    } finally {
      setSaving(false);
    }
  }

  const visibleCount = draft.filter((d) => !d.issue).length;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <div style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>{description}</div>
        </div>
        <span className="pill" style={{ background: 'var(--parchment-2)', color: 'var(--forest)', fontWeight: 700 }}>
          {draft.length} / {max}
        </span>
      </div>

      <div style={{ padding: '0 22px 22px' }}>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
        {notice && !dirty && (
          <div role="status" style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(107,156,108,0.12)', color: '#3f6b40', fontSize: 13 }}>
            {notice}
          </div>
        )}

        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: max }, (_, i) => {
            const item = draft[i];
            if (!item) {
              return (
                <li key={`empty-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: '1px dashed var(--line)', borderRadius: 8, color: '#a39a90', fontSize: 13 }}>
                  <span style={{ width: 26, textAlign: 'center', fontWeight: 700 }}>{i + 1}</span>
                  خانة فاضية — مش هيظهر حاجة مكانها
                </li>
              );
            }
            return (
              <li
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8,
                  border: `1px solid ${item.issue ? 'rgba(220,76,100,0.45)' : 'var(--line)'}`, background: 'var(--cream)',
                }}
              >
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--forest)', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: 'none' }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{item.label}</div>
                  <div style={{ fontSize: 12.5, color: '#8a8074' }}>{item.meta}</div>
                  {item.issue && (
                    <div style={{ fontSize: 12.5, color: 'var(--rose)', marginTop: 2 }}>
                      مخفي حاليًا من الموقع: {item.issue}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`نقل ${item.label} لفوق`}>↑</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px' }} disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={`نقل ${item.label} لتحت`}>↓</button>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '5px 10px', background: 'rgba(201,123,138,0.15)', color: 'var(--rose)' }}
                    onClick={() => { setDraft((prev) => prev.filter((d) => d.id !== item.id)); setNotice(null); }}
                  >
                    إزالة
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            disabled={full || available.length === 0}
            aria-label={addLabel}
            style={{ flex: 1, minWidth: 240, padding: '9px 12px', borderRadius: 6, border: '1px solid var(--line)', fontFamily: 'inherit' }}
          >
            <option value="">{full ? `القائمة كاملة (${max})` : available.length === 0 ? 'مفيش عناصر متاحة للإضافة' : addLabel}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.label} — {c.meta}</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={add} disabled={!adding || full}>+ إضافة</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: dirty ? 'var(--rose)' : '#8a8074' }}>
            {dirty ? 'في تعديلات مش محفوظة — الموقع لسه بيعرض الاختيار القديم.' : `الموقع بيعرض ${visibleCount} من ${max} حاليًا.`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" disabled={!dirty || saving} onClick={() => { setDraft(saved); setError(null); }}>
              تراجع
            </button>
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
              {saving ? 'جاري الحفظ...' : 'حفظ الترتيب'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const productSlot = (p: Product, issue: string | null = null): SlotItem => ({
  id: p.id,
  label: p.name,
  meta: `${p.category_name} · ${p.sale_price.toLocaleString('ar-EG')} ج.م`,
  issue,
});

const routineSlot = (r: Routine, issue: string | null = null): SlotItem => ({
  id: r.id,
  label: r.name,
  meta: r.items.map((it) => it.product_name).join(' + '),
  issue,
});

export default function MerchandisingPage() {
  const [savedProducts, setSavedProducts] = useState<SlotItem[] | null>(null);
  const [savedRoutines, setSavedRoutines] = useState<SlotItem[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([merchandisingApi.featuredProducts(), merchandisingApi.featuredRoutines(), productsApi.list(), routinesApi.list()])
      .then(([fp, fr, p, r]) => {
        setSavedProducts(fp.map((s) => productSlot(s.product, s.issue)));
        setSavedRoutines(fr.map((s) => routineSlot(s.routine, s.issue)));
        setProducts(p);
        setRoutines(r);
        setError(null);
      })
      .catch(() => setError('تعذر تحميل اختيارات الصفحة الرئيسية'));
  }, []);
  useEffect(load, [load]);

  // Only items the storefront can actually show are offered for featuring.
  const productCandidates = useMemo(
    () => products.filter((p) => p.is_active && p.quantity > 0).map((p) => productSlot(p)),
    [products],
  );
  const routineCandidates = useMemo(
    () => routines
      .filter((r) => r.is_active && r.items.length > 0 && r.items.every((it) => products.some((p) => p.id === it.product_id && p.quantity > 0)))
      .map((r) => routineSlot(r)),
    [routines, products],
  );

  if (error) return <div className="error-banner">{error}</div>;
  if (!savedProducts || !savedRoutines) return <div className="empty-state">جاري التحميل...</div>;

  return (
    <div>
      <SlotEditor
        title="منتجات مختارة لكِ"
        description={`المنتجات اللي هتظهر في قسم «منتجات مختارة لكِ» بالصفحة الرئيسية، بالترتيب ده (أقصى عدد ${FEATURED_PRODUCTS_MAX}). مش بتأثر على صفحة كل المنتجات.`}
        max={FEATURED_PRODUCTS_MAX}
        saved={savedProducts}
        candidates={productCandidates}
        addLabel="اختاري منتج لإضافته..."
        onSave={async (ids) => {
          const res = await merchandisingApi.setFeaturedProducts(ids);
          setSavedProducts(res.map((s) => productSlot(s.product, s.issue)));
        }}
      />
      <SlotEditor
        title="روتينات الصفحة الرئيسية"
        description={`الروتينات اللي هتظهر في قسم «روتين العناية المتكامل» بالصفحة الرئيسية، بالترتيب ده (أقصى عدد ${FEATURED_ROUTINES_MAX}). كل الروتينات المفعّلة بتفضل ظاهرة في صفحة الروتينات.`}
        max={FEATURED_ROUTINES_MAX}
        saved={savedRoutines}
        candidates={routineCandidates}
        addLabel="اختاري روتين لإضافته..."
        onSave={async (ids) => {
          const res = await merchandisingApi.setFeaturedRoutines(ids);
          setSavedRoutines(res.map((s) => routineSlot(s.routine, s.issue)));
        }}
      />
    </div>
  );
}
