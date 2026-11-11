import { useId, useMemo, useState } from 'react';
import type { Category, Product } from '../../lib/api';
import { money } from './offerMath';

const STOCK: Record<Product['stock_status'], string> = { ok: 'متاح', low: 'قليل', out: 'نفد' };

/** Search-and-tick product list: photo, name, category, price and stock on
 * every row; the whole row toggles. Archived products only on request. */
export default function ProductSelect({
  label, products, categories, selected, onChange, currentPrice, error, disabled = false, single = false,
}: {
  label: string;
  products: Product[];
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Today's price when it differs from the regular one (a running sale price). */
  currentPrice?: (id: string) => number | undefined;
  error?: string;
  disabled?: boolean;
  /** Only one product (editing a sale price). */
  single?: boolean;
}) {
  const id = useId();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const t = term.trim().toLowerCase();
  const rows = products.filter((p) => (showArchived || p.is_active || chosen.has(p.id))
    && (!category || p.category_id === category)
    && (!t || p.name.toLowerCase().includes(t) || (p.sku || '').toLowerCase().includes(t)));

  const toggle = (pid: string) => onChange(chosen.has(pid) ? selected.filter((x) => x !== pid) : [...selected, pid]);
  const addAll = () => onChange([...selected, ...rows.filter((p) => !chosen.has(p.id) && p.is_active).map((p) => p.id)]);

  return (
    <fieldset className="pick" disabled={disabled} aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="pick-legend">{label}</legend>
      <div className="pick-tray" aria-live="polite">
        {selected.length === 0 ? <span className="field-hint">ولا منتج متختار</span> : (
          <>
            <span className="field-hint">مختار: {selected.length.toLocaleString('ar-EG')}</span>
            {selected.map((pid) => (
              <span key={pid} className="pill pick-chip">
                {byId.get(pid)?.name ?? 'منتج'}
                {!disabled && !single && (
                  <button type="button" onClick={() => toggle(pid)} aria-label={`شيلي ${byId.get(pid)?.name ?? 'المنتج'}`}>×</button>
                )}
              </span>
            ))}
          </>
        )}
      </div>
      {!disabled && !single && (
        <>
          <div className="pick-filters">
            <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ابحثي باسم المنتج أو الكود..." aria-label={`${label} — بحث`} />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="الفئة">
              <option value="">كل الفئات</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="pick-check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> اظهري الموقوفة
            </label>
          </div>
          <div className="pick-list" role="group" aria-label={`${label} — النتايج`}>
            {rows.length === 0 && <div className="field-hint" style={{ padding: 10 }}>مفيش منتجات بالبحث ده</div>}
            {rows.map((p) => {
              const now = currentPrice?.(p.id);
              return (
                <label key={p.id} className="pick-row" data-checked={chosen.has(p.id) || undefined}>
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                  {p.image_url ? <img className="pick-thumb" src={p.image_url} alt="" loading="lazy" /> : <span className="pick-thumb" aria-hidden="true" />}
                  <span className="pick-name">
                    {p.name}
                    <span className="field-hint"> · {p.category_name}{!p.is_active && ' · موقوف'}</span>
                  </span>
                  <span className="pick-price">
                    {now !== undefined && now < p.sale_price ? (
                      <><s className="field-hint">{money(p.sale_price)}</s> {money(now)}</>
                    ) : money(p.sale_price)}
                  </span>
                  <span className={`status ${p.stock_status}`}>{STOCK[p.stock_status]}</span>
                </label>
              );
            })}
          </div>
          {rows.some((p) => !chosen.has(p.id) && p.is_active) && (
            <button type="button" className="btn btn-sm" onClick={addAll}>تحديد كل النتايج ({rows.filter((p) => !chosen.has(p.id) && p.is_active).length.toLocaleString('ar-EG')})</button>
          )}
        </>
      )}
      {error && <div id={`${id}-err`} className="field-error" role="alert">{error}</div>}
    </fieldset>
  );
}

/** Category checkboxes. */
export function CategoryChecks({ label, categories, selected, onChange, error, disabled = false }: {
  label: string; categories: Category[]; selected: string[]; onChange: (ids: string[]) => void; error?: string; disabled?: boolean;
}) {
  return (
    <fieldset className="pick" disabled={disabled}>
      <legend className="pick-legend">{label}</legend>
      <div className="pick-cats">
        {categories.length === 0 && <span className="field-hint">مفيش فئات</span>}
        {categories.map((c) => (
          <label key={c.id} className="pick-check">
            <input type="checkbox" checked={selected.includes(c.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
            {c.name} <span className="field-hint">({c.product_count.toLocaleString('ar-EG')})</span>
          </label>
        ))}
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}
    </fieldset>
  );
}
