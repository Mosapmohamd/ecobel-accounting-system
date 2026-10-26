import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import {
  apiErrorMessage, categoriesApi, offersApi, productsApi, promotionsApi, shippingRatesApi,
  type Category, type OfferListType, type Product, type Promotion, type PromotionInput, type PromotionPreview,
  type PromotionSort, type PromotionState, type PromotionStatus, type PromotionType, type ShippingRate,
} from '../lib/api';
import { useConfirm } from '../lib/useConfirm';
import { useToast } from '../lib/toast';

/** The Offers page — every offer in one place: per-product sale prices
 * (offersApi) and the cart offers of the Offer Builder (promotionsApi:
 * bundles, free shipping, discounts, gifts). Every rule (eligibility,
 * amounts, limits) is decided by the backend — this page only edits offers
 * and shows the backend's own preview. */

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<OfferListType, string> = {
  product_price: 'سعر عرض على منتج',
  bundle: 'باقة بسعر ثابت',
  free_shipping: 'شحن مجاني',
  percentage: 'خصم نسبة',
  fixed_amount: 'خصم مبلغ ثابت',
  buy_x_get_y: 'اشتري واحصلي على هدية',
};
const TYPE_HINT: Record<OfferListType, string> = {
  product_price: 'سعر أقل لمنتج واحد، بيظهر على صفحته وفي الكتالوج',
  bundle: 'باقة ثابتة أو «اختاري 3 منتجات بـ 600 ج.م»',
  free_shipping: 'الشحن مجاني لما الطلب يوصل لحد معين',
  percentage: 'مثال: خصم 15% على منتجات البشرة',
  fixed_amount: 'مثال: خصم 100 ج.م على الطلب',
  buy_x_get_y: 'مثال: اشتري 2 وخدي الماسك هدية',
};
const STATE_LABEL: Record<PromotionState, string> = {
  draft: 'مسودة',
  scheduled: 'مجدول',
  active: 'فعّال',
  expired: 'منتهي',
  inactive: 'موقّف',
};
const STATE_CLASS: Record<PromotionState, string> = {
  draft: 'low',
  scheduled: 'low',
  active: 'ok',
  expired: 'out',
  inactive: 'out',
};
const SORT_LABEL: Record<PromotionSort, string> = {
  newest: 'الأحدث',
  oldest: 'الأقدم',
  name: 'الاسم',
  priority: 'الأولوية',
  starts: 'تاريخ البداية',
  ends: 'تاريخ النهاية',
  usage: 'الأكثر استخدامًا',
};

const money = (n: number) => `${n.toLocaleString('ar-EG')} ج.م`;

/** An instant as its Cairo calendar date ("YYYY-MM-DD"). `exclusiveEnd`:
 * the instant is the start of the day after the last day (ends_at). */
function cairoDate(iso: string | null, exclusiveEnd = false): string {
  if (!iso) return '';
  const t = new Date(iso).getTime() - (exclusiveEnd ? 1 : 0);
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}
function dateLabel(day: string): string {
  return day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('ar-EG', { timeZone: 'UTC' }) : '';
}
function datesLabel(p: Promotion): string {
  const start = cairoDate(p.starts_at);
  const end = cairoDate(p.ends_at, true);
  if (!start && !end) return 'بدون تاريخ';
  if (start && end) return `${dateLabel(start)} ← ${dateLabel(end)}`;
  return start ? `من ${dateLabel(start)}` : `حتى ${dateLabel(end)}`;
}
function targetsLabel(p: Promotion): string {
  const fixedBundle = p.type === 'bundle' && p.config.mode === 'combination';
  const eligible = [...p.eligible_categories.map((c) => `فئة ${c.name}`),
    ...p.eligible_products.map((x) => (fixedBundle && x.quantity > 1 ? `${x.quantity} × ${x.name}` : x.name))];
  let text = eligible.length ? eligible.slice(0, 3).join('، ') + (eligible.length > 3 ? ` +${eligible.length - 3}` : '') : 'كل المنتجات';
  const reward = [...p.reward_categories.map((c) => `فئة ${c.name}`), ...p.reward_products.map((x) => x.name)];
  if (reward.length) text += ` — الهدية: ${reward.slice(0, 2).join('، ')}${reward.length > 2 ? ` +${reward.length - 2}` : ''}`;
  return text;
}
function usageLabel(p: Promotion): string {
  if (p.source === 'product_offer') return '—';
  return p.usage_limit ? `${p.used_count} / ${p.usage_limit}` : String(p.used_count);
}
const isProductOffer = (p: Promotion) => p.source === 'product_offer';

type Editing = { kind: 'promotion'; promotion: Promotion | null } | { kind: 'product_offer'; offer: Promotion | null };

export default function OffersPage() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [page, setPage] = useState<{ items: Promotion[]; total: number; counts: Partial<Record<PromotionState | 'total', number>> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<OfferListType | ''>('');
  const [state, setState] = useState<PromotionState | ''>('');
  const [sort, setSort] = useState<PromotionSort>('newest');
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<Promotion | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The offer just created/edited: highlighted in the list for a moment.
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [highlight]);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    promotionsApi
      .list({ q: query || undefined, type: type || undefined, state: state || undefined, sort, limit: PAGE_SIZE, offset })
      .then((r) => { if (live) setPage({ items: r.items, total: r.total, counts: r.counts ?? {} }); })
      .catch((err) => { if (live) setError(apiErrorMessage(err, 'تعذر تحميل العروض')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, type, state, sort, offset, reload]);

  const refresh = () => setReload((n) => n + 1);

  /** Back to the list after a save: a new offer shows first (filters
   * cleared, newest first); an edited one stays where the list is. */
  function saved(id: string, created: boolean) {
    setEditing(null);
    toast(created ? 'العرض اتضاف' : 'التعديلات اتحفظت');
    if (created) {
      setQ(''); setQuery(''); setType(''); setState(''); setSort('newest'); setOffset(0);
    }
    setHighlight(id);
    refresh();
  }

  async function run(p: Promotion, action: () => Promise<unknown>, done: string) {
    setBusyId(p.id);
    try {
      await action();
      toast(done);
      refresh();
    } catch (err) {
      toast(apiErrorMessage(err, 'تعذر تنفيذ العملية'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  function activate(p: Promotion) {
    if (isProductOffer(p)) {
      confirmDialog.ask({
        title: 'تفعيل سعر العرض؟',
        message: 'المنتج هيتباع بسعر العرض على الموقع فورًا. (منتج واحد يقدر يكون عليه عرض سعر واحد شغال.)',
        confirmLabel: 'تفعيل',
        action: async () => {
          await offersApi.update(p.id, { is_active: true });
          toast('العرض اتفعّل');
          refresh();
        },
      });
      return;
    }
    confirmDialog.ask({
      title: 'تفعيل العرض؟',
      message: p.starts_at && new Date(p.starts_at) > new Date()
        ? `العرض هيبدأ يظهر للعملاء من ${dateLabel(cairoDate(p.starts_at))}.`
        : 'العرض هيظهر للعملاء ويتطبّق على السلة والطلبات فورًا. جرّبيه من «معاينة» الأول لو حابة.',
      confirmLabel: 'تفعيل',
      action: async () => {
        await promotionsApi.activate(p.id);
        toast('العرض اتفعّل');
        refresh();
      },
    });
  }

  function remove(p: Promotion) {
    confirmDialog.ask({
      title: `حذف «${p.name}»؟`,
      message: isProductOffer(p)
        ? 'سعر العرض هيتشال والمنتج هيرجع لسعره العادي على الموقع فورًا. (الطلبات القديمة محتفظة بأسعارها.)'
        : 'العرض هيتمسح نهائيًا. (العروض اللي اتستخدمت في طلبات مينفعش تتمسح — بتتوقّف بس.)',
      confirmLabel: 'حذف العرض',
      danger: true,
      action: async () => {
        await (isProductOffer(p) ? offersApi.remove(p.id) : promotionsApi.remove(p.id));
        toast('العرض اتمسح');
        if (page && page.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE));
        refresh();
      },
    });
  }

  const filtered = Boolean(query || type || state);
  const total = page?.total ?? 0;
  const counts = page?.counts ?? {};

  function duplicate(p: Promotion) {
    if (!isProductOffer(p)) {
      run(p, () => promotionsApi.duplicate(p.id), 'اتعملت نسخة (مسودة)');
      return;
    }
    // A product price copy is saved switched off, so it never clashes with
    // the running one; activate it when the old one ends.
    run(p, () => offersApi.create({
      product_id: String(p.config.product_id), title: `${p.name} (نسخة)`.slice(0, 120),
      offer_price: Number(p.config.offer_price), expires_at: cairoDate(p.ends_at, true) || null, is_active: false,
    }), 'اتعملت نسخة (موقّفة)');
  }

  return (
    <div>
      {confirmDialog.dialog}
      {editing?.kind === 'promotion' && (
        <PromotionFormModal
          promotion={editing.promotion}
          onClose={() => setEditing(null)}
          onPickProductPrice={() => setEditing({ kind: 'product_offer', offer: null })}
          onSaved={(p, created) => saved(p.id, created)}
        />
      )}
      {editing?.kind === 'product_offer' && (
        <ProductOfferFormModal
          offer={editing.offer}
          onClose={() => setEditing(null)}
          onBack={editing.offer ? undefined : () => setEditing({ kind: 'promotion', promotion: null })}
          onSaved={(id, created) => saved(id, created)}
        />
      )}
      {viewing && (
        <PromotionDetailsModal
          promotion={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(isProductOffer(viewing) ? { kind: 'product_offer', offer: viewing } : { kind: 'promotion', promotion: viewing });
            setViewing(null);
          }}
        />
      )}

      <div className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2>العروض</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              كل عروض الموقع في مكان واحد: أسعار عروض المنتجات، الباقات، الشحن المجاني، الخصومات والهدايا
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({ kind: 'promotion', promotion: null })}>+ إنشاء عرض</button>
        </div>

        <div role="group" aria-label="ملخص العروض" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, padding: '14px 22px 0' }}>
          {([['total', 'كل العروض'], ['active', 'فعّال'], ['scheduled', 'مجدول'], ['expired', 'منتهي'], ['draft', 'مسودة'], ['inactive', 'موقّف']] as const).map(([k, label]) => {
            const pressed = k === 'total' ? state === '' : state === k;
            return (
              <button key={k} type="button" aria-pressed={pressed} onClick={() => { setState(k === 'total' ? '' : k); setOffset(0); }}
                style={{ textAlign: 'start', border: `1px solid ${pressed ? 'var(--forest)' : 'var(--line)'}`, borderRadius: 8, padding: '10px 12px', background: 'var(--cream)', cursor: 'pointer', font: 'inherit', minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--forest-deep)' }}>{(counts[k] ?? 0).toLocaleString('ar-EG')}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 22px', alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحثي باسم العرض..."
            aria-label="بحث في العروض"
            style={{ flex: '1 1 200px', minWidth: 0 }}
          />
          <select value={type} onChange={(e) => { setType(e.target.value as OfferListType | ''); setOffset(0); }} aria-label="نوع العرض" style={{ minWidth: 0 }}>
            <option value="">كل الأنواع</option>
            {(Object.keys(TYPE_LABEL) as OfferListType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as PromotionSort); setOffset(0); }} aria-label="ترتيب" style={{ minWidth: 0 }}>
            {(Object.keys(SORT_LABEL) as PromotionSort[]).map((s) => <option key={s} value={s}>ترتيب: {SORT_LABEL[s]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '0 22px 12px', alignItems: 'center' }}>
          <label htmlFor="offers-state" style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>الحالة</label>
          <select id="offers-state" value={state} onChange={(e) => { setState(e.target.value as PromotionState | ''); setOffset(0); }} style={{ minWidth: 0 }}>
            <option value="">الكل</option>
            {(Object.keys(STATE_LABEL) as PromotionState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
        </div>

        {error ? (
          <div className="error-banner" style={{ margin: '0 22px 18px' }} role="alert">
            {error}{' '}
            <button className="btn btn-sm" onClick={refresh}>حاولي تاني</button>
          </div>
        ) : loading && !page ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : !page || page.items.length === 0 ? (
          <div className="empty-state">
            {filtered ? 'مفيش عروض بالبحث ده.' : 'مفيش عروض لسه — ابدئي بـ «إنشاء عرض».'}
          </div>
        ) : (
          <div className="table-scroll" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>العرض</th>
                  <th>النوع</th>
                  <th>الحالة</th>
                  <th>المدة</th>
                  <th>القيمة والشروط</th>
                  <th>المنتجات</th>
                  <th>الاستخدام</th>
                  <th><span className="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((p) => (
                  <tr key={`${p.source}-${p.id}`} data-highlight={highlight === p.id || undefined}
                    style={highlight === p.id ? { background: 'var(--ok-tint)', transition: 'background 0.6s' } : undefined}>
                    <td style={{ fontWeight: 600 }}>
                      {p.name}
                      {p.badge_text && <div><span className="pill" style={{ marginTop: 4 }}>{p.badge_text}</span></div>}
                    </td>
                    <td>{TYPE_LABEL[p.type]}</td>
                    <td><span className={`status ${STATE_CLASS[p.state]}`}>{STATE_LABEL[p.state]}</span></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{datesLabel(p)}</td>
                    <td style={{ fontSize: 12.5 }}>
                      {p.summary}
                      {!isProductOffer(p) && (p.per_customer_limit || !p.combinable) && (
                        <div style={{ color: 'var(--ink-muted)' }}>
                          {[p.per_customer_limit ? `${p.per_customer_limit} مرة لكل عميل` : '', p.combinable ? '' : 'ما بيتجمعش'].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, maxWidth: 220 }}>{targetsLabel(p)}</td>
                    <td title={`${p.orders_count} طلب`}>{usageLabel(p)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setViewing(p)} aria-label={`عرض ${p.name}`}>عرض</button>
                        <button className="btn btn-sm" aria-label={`تعديل ${p.name}`}
                          onClick={() => setEditing(isProductOffer(p) ? { kind: 'product_offer', offer: p } : { kind: 'promotion', promotion: p })}>تعديل</button>
                        <button className="btn btn-sm" disabled={busyId === p.id} aria-label={`نسخ ${p.name}`} onClick={() => duplicate(p)}>نسخ</button>
                        {p.status === 'active' ? (
                          <button className="btn btn-sm btn-secondary" disabled={busyId === p.id} aria-label={`إيقاف ${p.name}`}
                            onClick={() => run(p, () => (isProductOffer(p) ? offersApi.update(p.id, { is_active: false }) : promotionsApi.deactivate(p.id)), 'العرض اتوقّف')}>إيقاف</button>
                        ) : (
                          <button className="btn btn-sm btn-primary" disabled={busyId === p.id} aria-label={`تفعيل ${p.name}`}
                            onClick={() => activate(p)}>تفعيل</button>
                        )}
                        {!p.terms_locked && (
                          <button className="btn btn-sm btn-danger" onClick={() => remove(p)} aria-label={`حذف ${p.name}`}>حذف</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {page && total > PAGE_SIZE && (
          <div className="panel-foot" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>السابق</button>
            <span style={{ fontSize: 12.5 }}>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} من {total}</span>
            <button className="btn btn-sm" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>التالي</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- details
function PromotionDetailsModal({ promotion: p, onClose, onEdit }: { promotion: Promotion; onClose: () => void; onEdit: () => void }) {
  const c = p.config as Record<string, unknown>;
  if (isProductOffer(p)) {
    return (
      <Modal title={p.name} onClose={onClose}>
        <dl className="detail-grid" style={{ margin: '14px 0' }}>
          {([['النوع', TYPE_LABEL.product_price], ['الحالة', STATE_LABEL[p.state]], ['المنتج', targetsLabel(p)],
            ['السعر الأصلي', money(Number(c.original_price))], ['سعر العرض', money(Number(c.offer_price))], ['المدة', datesLabel(p)]] as const).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onEdit}>تعديل</button>
          <button className="btn" onClick={onClose}>إغلاق</button>
        </div>
      </Modal>
    );
  }
  const rows: [string, string][] = [
    ['النوع', TYPE_LABEL[p.type]],
    ['الحالة', STATE_LABEL[p.state]],
    ['القيمة', p.summary],
    ['المدة', datesLabel(p)],
    ['المنتجات', targetsLabel(p)],
    ['الحد الأدنى للطلب', p.min_subtotal ? money(p.min_subtotal) : '—'],
    ['الاستخدام', `${usageLabel(p)} (${p.orders_count} طلب قائم)`],
    ['لكل عميل', p.per_customer_limit ? `${p.per_customer_limit} مرة` : 'بدون حد'],
    ['الأولوية', String(p.priority)],
    ['التجميع مع عروض تانية', p.combinable ? 'بيتجمع' : 'ما بيتجمعش'],
  ];
  if (p.type === 'free_shipping') {
    const cities = (c.cities as string[] | undefined) ?? [];
    rows.push(['المحافظات', cities.length ? cities.join('، ') : 'كل المحافظات المتاحة']);
    rows.push(['الحد بيتحسب', c.basis === 'before' ? 'قبل الخصومات' : 'بعد الخصومات']);
  }
  if (p.created_by) rows.push(['أنشأه', p.created_by]);
  if (p.updated_by) rows.push(['آخر تعديل', p.updated_by]);
  return (
    <Modal title={p.name} onClose={onClose} wide>
      {p.badge_text && <span className="pill">{p.badge_text}</span>}
      {p.description && <p style={{ margin: '10px 0' }}>{p.description}</p>}
      <dl className="detail-grid" style={{ margin: '14px 0' }}>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {p.terms_locked && <div className="field-hint">العرض ده اتستخدم في طلبات، فشروطه ثابتة — لتغييرها اعملي نسخة منه.</div>}
      <PreviewPanel build={() => toInput(p)} bundle={p.type === 'bundle'} />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onEdit}>تعديل</button>
        <button className="btn" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  );
}

function toInput(p: Promotion): PromotionInput {
  return {
    name: p.name, description: p.description, badge_text: p.badge_text, type: p.type as PromotionType, status: p.status,
    starts_at: cairoDate(p.starts_at) || null, ends_at: cairoDate(p.ends_at, true) || null,
    priority: p.priority, combinable: p.combinable, min_subtotal: p.min_subtotal, usage_limit: p.usage_limit,
    per_customer_limit: p.per_customer_limit, config: p.config,
    eligible_product_ids: p.eligible_products.map((x) => x.id), eligible_category_ids: p.eligible_categories.map((x) => x.id),
    reward_product_ids: p.reward_products.map((x) => x.id), reward_category_ids: p.reward_categories.map((x) => x.id),
    product_quantities: Object.fromEntries(p.eligible_products.map((x) => [x.id, x.quantity])),
  };
}

// ---------------------------------------------------------------- shared lookups
function useLookups() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([productsApi.list(), categoriesApi.list(), shippingRatesApi.list()])
      .then(([p, c, r]) => { setProducts(p); setCategories(c); setRates(r.filter((x) => x.is_active)); })
      .catch(() => setError('تعذر تحميل المنتجات والفئات'));
  }, []);
  return { products, categories, rates, error };
}

// ---------------------------------------------------------------- preview
function PreviewPanel({ build, bundle = false }: { build: () => PromotionInput; bundle?: boolean }) {
  const { products, rates } = useLookups();
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([{ product_id: '', quantity: '1' }]);
  const [city, setCity] = useState('');
  const [result, setResult] = useState<PromotionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    const items = lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, quantity: Math.max(1, Number(l.quantity) || 1) }));
    if (!items.length) {
      setError('اختاري منتج واحد على الأقل للسلة التجريبية');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await promotionsApi.preview(build(), items, city));
    } catch (err) {
      setResult(null);
      setError(apiErrorMessage(err, 'تعذر تجربة العرض'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="معاينة العرض" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, margin: '14px 0' }}>
      <h3 className="detail-heading">معاينة على سلة تجريبية</h3>
      <div className="field-hint" style={{ marginBottom: 8 }}>
        بنفس قواعد الموقع وبأسعار النهارده — العرض بيتجرّب كأنه شغال، ومفيش حاجة بتتحفظ.
        {bundle && ' في الباقات: المنتجات دي هي محتوى باقة واحدة زي ما العميلة هتضيفها.'}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <select aria-label={`منتج ${i + 1}`} value={l.product_id} style={{ flex: '1 1 180px', minWidth: 0 }}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}>
            <option value="">اختاري منتج...</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.sale_price)})</option>)}
          </select>
          <input aria-label={`كمية ${i + 1}`} type="number" min={1} max={100} value={l.quantity} style={{ width: 80 }}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          {lines.length > 1 && (
            <button type="button" className="btn btn-sm" aria-label={`شيل منتج ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {lines.length < 10 && (
          <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, { product_id: '', quantity: '1' }])}>+ منتج</button>
        )}
        <select aria-label="المحافظة" value={city} onChange={(e) => setCity(e.target.value)} style={{ minWidth: 0 }}>
          <option value="">بدون محافظة</option>
          {rates.map((r) => <option key={r.id} value={r.city}>{r.city} ({money(r.fee)})</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={runPreview} disabled={busy}>{busy ? 'جاري الحساب...' : 'جرّبي العرض'}</button>
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10 }} role="alert">{error}</div>}
      {result && (
        <div style={{ marginTop: 10, fontSize: 13 }} aria-live="polite">
          {result.lines.map((l) => (
            <div key={l.product_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{l.product_name} × {l.quantity}{l.free_units > 0 && <strong> ({l.free_units} هدية)</strong>}</span>
              <span>{money(l.line_total)}{l.discount > 0 && <span style={{ color: 'var(--forest)' }}> −{money(l.discount)}</span>}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6 }}>
            <div>الإجمالي الفرعي: {money(result.subtotal)}</div>
            {result.applied ? (
              <>
                {result.discount > 0 && <div style={{ color: 'var(--forest)' }}>خصم العرض: −{money(result.discount)}</div>}
                {result.shipping_discount > 0 && <div style={{ color: 'var(--forest)' }}>الشحن مجاني (وفّر {money(result.shipping_discount)})</div>}
              </>
            ) : (
              <div style={{ color: 'var(--rose-text)' }}>العرض مش متطبّق: {result.reason}</div>
            )}
            {result.shipping_fee !== null && result.shipping_discount === 0 && <div>الشحن: {money(result.shipping_fee)}</div>}
            <div style={{ fontWeight: 700 }}>الإجمالي: {money(result.total)}</div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- pickers
function ProductPicker({ label, products, selected, onChange, disabled }: {
  label: string; products: Product[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const [term, setTerm] = useState('');
  const chosen = new Set(selected);
  const t = term.trim().toLowerCase();
  const matches = products
    .filter((p) => !chosen.has(p.id) && (!t || p.name.toLowerCase().includes(t) || (p.sku || '').toLowerCase().includes(t)))
    .slice(0, 8);
  const byId = new Map(products.map((p) => [p.id, p]));
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {selected.length === 0 && <span className="field-hint">ولا منتج</span>}
        {selected.map((id) => (
          <span key={id} className="pill" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {byId.get(id)?.name ?? 'منتج'}
            {!disabled && (
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))} aria-label={`شيل ${byId.get(id)?.name ?? 'المنتج'}`}
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>×</button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <>
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ابحثي باسم المنتج أو الكود..." aria-label={`${label} — بحث`} />
          {term.trim() && (
            <div role="listbox" aria-label="نتايج البحث" style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto' }}>
              {matches.length === 0 ? (
                <div className="field-hint" style={{ padding: 8 }}>مفيش نتايج</div>
              ) : matches.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={false}
                  onClick={() => { onChange([...selected, p.id]); setTerm(''); }}
                  style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'start' }}>
                  <span>{p.name}{!p.is_active && ' (موقوف)'}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>{money(p.sale_price)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryPicker({ label, categories, selected, onChange, disabled }: {
  label: string; categories: Category[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  return (
    <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }} disabled={disabled}>
      <legend style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{label}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {categories.length === 0 && <span className="field-hint">مفيش فئات</span>}
        {categories.map((c) => (
          <label key={c.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
            <input type="checkbox" checked={selected.includes(c.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
            {c.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- the form
type Cfg = Record<string, string | boolean | string[]>;

const DEFAULT_CFG: Record<PromotionType, Cfg> = {
  bundle: { mode: 'combination', bundle_quantity: '3', bundle_price: '', distinct_products: false, allow_multiple: true, max_bundles: '' },
  free_shipping: { basis: 'after', cities: [], require_all_eligible: false },
  percentage: { percent: '', max_discount: '', max_quantity: '' },
  fixed_amount: { amount: '', apply_per: 'order', max_quantity: '' },
  buy_x_get_y: { buy_quantity: '2', get_quantity: '1', reward_choice: 'cheapest', allow_multiple: true, max_rewards: '' },
};

function cfgFrom(p: Promotion | null): Cfg {
  if (!p || isProductOffer(p)) return { ...DEFAULT_CFG.percentage };
  const out: Cfg = { ...DEFAULT_CFG[p.type as PromotionType] };
  for (const [k, v] of Object.entries(p.config || {})) {
    if (v === null || v === undefined) out[k] = '';
    else if (typeof v === 'boolean' || Array.isArray(v)) out[k] = v as boolean | string[];
    else out[k] = String(v);
  }
  return out;
}

/** Numbers stay numbers, blanks become null — the backend validates ranges. */
function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function PromotionFormModal({ promotion, onClose, onSaved, onPickProductPrice }: {
  promotion: Promotion | null; onClose: () => void; onSaved: (p: Promotion, created: boolean) => void;
  /** New offers only: the "product price" type has its own form. */
  onPickProductPrice: () => void;
}) {
  const { products, categories, rates, error: lookupError } = useLookups();
  const locked = Boolean(promotion?.terms_locked);
  const [name, setName] = useState(promotion?.name ?? '');
  const [badge, setBadge] = useState(promotion?.badge_text ?? '');
  const [description, setDescription] = useState(promotion?.description ?? '');
  const [type, setType] = useState<PromotionType>((promotion?.type as PromotionType) ?? 'percentage');
  const [status, setStatus] = useState<PromotionStatus>(promotion?.status ?? 'draft');
  const [startsOn, setStartsOn] = useState(cairoDate(promotion?.starts_at ?? null));
  const [endsOn, setEndsOn] = useState(cairoDate(promotion?.ends_at ?? null, true));
  const [priority, setPriority] = useState(String(promotion?.priority ?? 0));
  const [combinable, setCombinable] = useState(promotion?.combinable ?? false);
  const [minSubtotal, setMinSubtotal] = useState(promotion?.min_subtotal != null ? String(promotion.min_subtotal) : '');
  const [usageLimit, setUsageLimit] = useState(promotion?.usage_limit != null ? String(promotion.usage_limit) : '');
  const [perCustomer, setPerCustomer] = useState(promotion?.per_customer_limit != null ? String(promotion.per_customer_limit) : '');
  const [cfg, setCfg] = useState<Cfg>(() => cfgFrom(promotion));
  const [eligibleProducts, setEligibleProducts] = useState<string[]>(promotion?.eligible_products.map((x) => x.id) ?? []);
  // Fixed bundles: units per bundle of each product.
  const [quantities, setQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries((promotion?.eligible_products ?? []).map((x) => [x.id, String(x.quantity || 1)])));
  const [eligibleCategories, setEligibleCategories] = useState<string[]>(promotion?.eligible_categories.map((x) => x.id) ?? []);
  const [rewardProducts, setRewardProducts] = useState<string[]>(promotion?.reward_products.map((x) => x.id) ?? []);
  const [rewardCategories, setRewardCategories] = useState<string[]>(promotion?.reward_categories.map((x) => x.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string | boolean | string[]) => setCfg((c) => ({ ...c, [k]: v }));
  const combination = type === 'bundle' && cfg.mode === 'combination';

  function changeType(t: PromotionType) {
    setType(t);
    setCfg({ ...DEFAULT_CFG[t] });
    if (t !== 'buy_x_get_y') { setRewardProducts([]); setRewardCategories([]); }
  }

  function build(): PromotionInput {
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
      config[k] = typeof v === 'string' && !['mode', 'basis', 'apply_per', 'reward_choice'].includes(k) ? numOrNull(v) : v;
    }
    if (type !== 'bundle' || !combination) delete config.pick;
    return {
      name: name.trim(), badge_text: badge.trim() || null, description: description.trim() || null, type, status,
      starts_at: startsOn || null, ends_at: endsOn || null, priority: Number(priority) || 0, combinable,
      min_subtotal: numOrNull(minSubtotal), usage_limit: numOrNull(usageLimit), per_customer_limit: numOrNull(perCustomer), config,
      eligible_product_ids: eligibleProducts, eligible_category_ids: combination ? [] : eligibleCategories,
      reward_product_ids: type === 'buy_x_get_y' ? rewardProducts : [], reward_category_ids: type === 'buy_x_get_y' ? rewardCategories : [],
      product_quantities: combination
        ? Object.fromEntries(eligibleProducts.map((id) => [id, Math.max(1, Math.floor(Number(quantities[id]) || 1))]))
        : {},
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('اكتبي اسم للعرض'); return; }
    if (startsOn && endsOn && startsOn > endsOn) { setError('تاريخ البداية لازم يكون قبل تاريخ النهاية'); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = promotion ? await promotionsApi.update(promotion.id, build()) : await promotionsApi.create(build());
      onSaved(saved, !promotion);
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر حفظ العرض'));
    } finally {
      setSaving(false);
    }
  }

  const num = (k: string, label: string, hint?: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`pf-${k}`}>{label}</label>
      <input id={`pf-${k}`} type="number" min={0} step="any" value={cfg[k] as string} disabled={locked}
        onChange={(e) => set(k, e.target.value)} {...props} />
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
  const check = (k: string, label: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
      <input type="checkbox" checked={Boolean(cfg[k])} disabled={locked} onChange={(e) => set(k, e.target.checked)} /> {label}
    </label>
  );

  return (
    <Modal title={promotion ? `تعديل «${promotion.name}»` : 'إنشاء عرض'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        {lookupError && <div className="error-banner" role="alert">{lookupError}</div>}
        {locked && (
          <div className="field-hint" style={{ marginBottom: 10 }}>
            العرض ده اتستخدم في {promotion?.orders_count ?? 0} طلب، فنوعه وقيمته ومنتجاته وحدّه الأدنى ثابتين. تقدري تغيّري الاسم والتواريخ والحدود والحالة — ولتغيير الشروط اعملي نسخة.
          </div>
        )}

        <fieldset disabled={locked} style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
          <legend style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>نوع العرض</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            {(Object.keys(TYPE_LABEL) as OfferListType[]).filter((t) => t !== 'product_price' || !promotion).map((t) => (
              <label key={t} style={{ border: `1px solid ${type === t ? 'var(--forest)' : 'var(--line)'}`, borderRadius: 10, padding: 10, cursor: 'pointer', fontWeight: 400 }}>
                <input type="radio" name="promotion-type" value={t} checked={type === t}
                  onChange={() => (t === 'product_price' ? onPickProductPrice() : changeType(t))} />{' '}
                <strong>{TYPE_LABEL[t]}</strong>
                <div className="field-hint">{TYPE_HINT[t]}</div>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-name">اسم العرض</label>
            <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </div>
          <div className="field">
            <label htmlFor="pf-badge">نص الشارة على الموقع (اختياري)</label>
            <input id="pf-badge" value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={40} placeholder="مثال: 3 بـ 600" />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="pf-desc">وصف للعملاء (اختياري)</label>
            <textarea id="pf-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
          </div>
        </div>

        <h3 className="detail-heading" style={{ marginTop: 14 }}>إعدادات {TYPE_LABEL[type]}</h3>
        <div className="form-grid">
          {type === 'bundle' && (
            <>
              <div className="field">
                <label htmlFor="pf-mode">شكل الباقة</label>
                <select id="pf-mode" value={cfg.mode as string} disabled={locked} onChange={(e) => set('mode', e.target.value)} aria-describedby="pf-mode-hint">
                  <option value="combination">باقة ثابتة — منتجات وكميات محددة</option>
                  <option value="any">العميلة تختار — أي عدد من منتجات مختارة</option>
                </select>
                <div id="pf-mode-hint" className="field-hint">
                  {combination
                    ? 'العميلة بتضيف الباقة كاملة للسلة بضغطة واحدة.'
                    : 'العميلة بتختار منتجات الباقة من المجموعة، وبعدين تضيفها كاملة مرة واحدة.'}
                </div>
              </div>
              {num('bundle_price', 'سعر الباقة (ج.م)')}
              {!combination && num('bundle_quantity', 'عدد المنتجات في الباقة', 'مثال: 3 = أي 3 منتجات بسعر الباقة', { min: 2, step: 1 })}
              {num('max_bundles', 'أقصى عدد باقات في الطلب (اختياري)', undefined, { min: 1, step: 1 })}
              <div className="field" style={{ gap: 6, display: 'flex', flexDirection: 'column' }}>
                {!combination && check('distinct_products', 'لازم منتجات مختلفة (من غير تكرار نفس المنتج)')}
                {check('allow_multiple', 'العميلة تقدر تاخد أكتر من باقة في نفس الطلب')}
              </div>
            </>
          )}
          {type === 'percentage' && (
            <>
              {num('percent', 'نسبة الخصم %', undefined, { min: 0, max: 100 })}
              {num('max_discount', 'أقصى خصم بالجنيه (اختياري)')}
              {num('max_quantity', 'أقصى عدد قطع عليها خصم (اختياري)', 'الخصم بيتطبق على الأغلى الأول', { min: 1, step: 1 })}
            </>
          )}
          {type === 'fixed_amount' && (
            <>
              {num('amount', 'مبلغ الخصم (ج.م)')}
              <div className="field">
                <label htmlFor="pf-per">الخصم بيتحسب</label>
                <select id="pf-per" value={cfg.apply_per as string} disabled={locked} onChange={(e) => set('apply_per', e.target.value)}>
                  <option value="order">مرة واحدة على الطلب (على المنتجات المختارة)</option>
                  <option value="item">على كل قطعة من المنتجات المختارة</option>
                </select>
                <div className="field-hint">الخصم عمره ما بيعدّي سعر المنتجات — الإجمالي ما بيبقاش بالسالب.</div>
              </div>
              {cfg.apply_per === 'item' && num('max_quantity', 'أقصى عدد قطع عليها خصم (اختياري)', undefined, { min: 1, step: 1 })}
            </>
          )}
          {type === 'buy_x_get_y' && (
            <>
              {num('buy_quantity', 'اشتري (عدد القطع)', undefined, { min: 1, step: 1 })}
              {num('get_quantity', 'وخدي هدية (عدد القطع)', undefined, { min: 1, step: 1 })}
              <div className="field">
                <label htmlFor="pf-reward">القطعة الهدية</label>
                <select id="pf-reward" value={cfg.reward_choice as string} disabled={locked} onChange={(e) => set('reward_choice', e.target.value)}>
                  <option value="cheapest">الأرخص من منتجات الهدية</option>
                  <option value="most_expensive">الأغلى من منتجات الهدية</option>
                </select>
                <div className="field-hint">العميلة بتضيف الهدية للسلة وسعرها بيتخصم — ولو الهدية خلصت من المخزن الطلب ما بيتأكدش بيها.</div>
              </div>
              {num('max_rewards', 'أقصى عدد هدايا في الطلب (اختياري)', undefined, { min: 1, step: 1 })}
              <div className="field">{check('allow_multiple', 'هدية مع كل مجموعة (مش مرة واحدة بس)')}</div>
            </>
          )}
          {type === 'free_shipping' && (
            <>
              <div className="field">
                <label htmlFor="pf-basis">الحد الأدنى بيتحسب</label>
                <select id="pf-basis" value={cfg.basis as string} disabled={locked} onChange={(e) => set('basis', e.target.value)}>
                  <option value="after">بعد خصومات العروض والكوبون</option>
                  <option value="before">قبل الخصومات</option>
                </select>
              </div>
              <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }} disabled={locked}>
                <legend style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>المحافظات (فاضي = كل المحافظات المتاحة)</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', maxHeight: 140, overflowY: 'auto' }}>
                  {rates.map((r) => (
                    <label key={r.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                      <input type="checkbox" checked={(cfg.cities as string[]).includes(r.city)}
                        onChange={(e) => set('cities', e.target.checked ? [...(cfg.cities as string[]), r.city] : (cfg.cities as string[]).filter((x) => x !== r.city))} />
                      {r.city} <span className="field-hint">({money(r.fee)})</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field">{check('require_all_eligible', 'بس لما كل منتجات السلة تكون من المنتجات المختارة')}</div>
            </>
          )}
        </div>

        <h3 className="detail-heading" style={{ marginTop: 14 }}>
          {type === 'buy_x_get_y' ? 'المنتجات اللي بتتشرى' : combination ? 'منتجات الباقة' : 'المنتجات الداخلة في العرض'}
        </h3>
        {!combination && !eligibleProducts.length && !eligibleCategories.length && (
          <div className="field-hint" style={{ marginBottom: 6 }}>من غير اختيار = كل المنتجات.</div>
        )}
        <div className="form-grid">
          {!combination && <CategoryPicker label="فئات" categories={categories} selected={eligibleCategories} onChange={setEligibleCategories} disabled={locked} />}
          <ProductPicker label="منتجات محددة" products={products} selected={eligibleProducts} onChange={setEligibleProducts} disabled={locked} />
        </div>
        {combination && eligibleProducts.length > 0 && (
          <fieldset disabled={locked} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '10px 0 0' }}>
            <legend style={{ fontSize: 13, fontWeight: 700, padding: '0 6px' }}>محتوى الباقة الواحدة</legend>
            {eligibleProducts.map((id) => {
              const product = products.find((x) => x.id === id);
              const n = Math.max(1, Math.floor(Number(quantities[id]) || 1));
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <label htmlFor={`pf-qty-${id}`} style={{ flex: '1 1 160px', minWidth: 0, fontWeight: 400 }}>{product?.name ?? 'منتج'}</label>
                  <input id={`pf-qty-${id}`} type="number" min={1} max={50} step={1} value={quantities[id] ?? '1'} style={{ width: 80 }}
                    onChange={(e) => setQuantities((q) => ({ ...q, [id]: e.target.value }))} aria-label={`كمية ${product?.name ?? 'المنتج'} في الباقة`} />
                  {product && <span className="field-hint">{money(product.sale_price * n)}</span>}
                </div>
              );
            })}
            <div className="field-hint">
              مجموع الأسعار العادية: {money(eligibleProducts.reduce((sum, id) => sum + (products.find((x) => x.id === id)?.sale_price ?? 0) * Math.max(1, Math.floor(Number(quantities[id]) || 1)), 0))}
            </div>
          </fieldset>
        )}
        {type === 'buy_x_get_y' && (
          <>
            <h3 className="detail-heading" style={{ marginTop: 14 }}>منتجات الهدية</h3>
            <div className="field-hint" style={{ marginBottom: 6 }}>من غير اختيار = الهدية من نفس المنتجات اللي بتتشرى.</div>
            <div className="form-grid">
              <CategoryPicker label="فئات الهدية" categories={categories} selected={rewardCategories} onChange={setRewardCategories} disabled={locked} />
              <ProductPicker label="منتجات الهدية" products={products} selected={rewardProducts} onChange={setRewardProducts} disabled={locked} />
            </div>
          </>
        )}

        <h3 className="detail-heading" style={{ marginTop: 14 }}>المدة والحدود</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-start">أول يوم (اختياري)</label>
            <input id="pf-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-end">آخر يوم (اختياري)</label>
            <input id="pf-end" type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} aria-describedby="pf-end-hint" />
            <div id="pf-end-hint" className="field-hint">العرض شغال طول اليوم ده لحد ١٢ بالليل بتوقيت القاهرة</div>
          </div>
          <div className="field">
            <label htmlFor="pf-min">الحد الأدنى للطلب بالجنيه (اختياري)</label>
            <input id="pf-min" type="number" min={0} step="any" value={minSubtotal} disabled={locked} onChange={(e) => setMinSubtotal(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-usage">أقصى عدد طلبات (اختياري)</label>
            <input id="pf-usage" type="number" min={1} step={1} value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-percust">لكل عميل كام مرة (اختياري)</label>
            <input id="pf-percust" type="number" min={1} step={1} value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-priority">الأولوية</label>
            <input id="pf-priority" type="number" step={1} value={priority} onChange={(e) => setPriority(e.target.value)} aria-describedby="pf-priority-hint" />
            <div id="pf-priority-hint" className="field-hint">الرقم الأكبر بيتطبّق الأول لو في أكتر من عرض على نفس المنتجات.</div>
          </div>
          <div className="field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" checked={combinable} onChange={(e) => setCombinable(e.target.checked)} /> يتجمع مع عروض تانية
            </label>
            <div className="field-hint">حتى لو بيتجمع، القطعة الواحدة ما بتاخدش خصمين. الكوبون بيتطبّق بعد العروض.</div>
          </div>
          <div className="field">
            <label htmlFor="pf-status">الحالة</label>
            <select id="pf-status" value={status} onChange={(e) => setStatus(e.target.value as PromotionStatus)}>
              <option value="draft">مسودة (مش ظاهر)</option>
              <option value="active">مفعّل (أو مجدول لو أول يوم لسه)</option>
              <option value="inactive">موقّف</option>
            </select>
          </div>
        </div>

        <PreviewPanel build={build} bundle={type === 'bundle'} />

        {error && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ العرض'}</button>
          <button type="button" className="btn" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- product price (offersApi)
function ProductOfferFormModal({ offer, onClose, onSaved, onBack }: {
  offer: Promotion | null; onClose: () => void; onSaved: (id: string, created: boolean) => void;
  /** New offers: back to the offer type choice. */
  onBack?: () => void;
}) {
  const { products } = useLookups();
  const c = (offer?.config ?? {}) as Record<string, unknown>;
  const [productId, setProductId] = useState(offer ? String(c.product_id) : '');
  const [title, setTitle] = useState(offer?.name ?? '');
  const [price, setPrice] = useState(offer ? String(c.offer_price) : '');
  const [lastDay, setLastDay] = useState(cairoDate(offer?.ends_at ?? null, true));
  const [active, setActive] = useState(offer ? offer.status === 'active' : true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const product = products.find((p) => p.id === productId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { setError('اختاري المنتج'); return; }
    if (!title.trim()) { setError('اكتبي عنوان للعرض — ده اللي العملاء بيشوفوه جنب السعر'); return; }
    const offerPrice = Number(price);
    if (!(offerPrice > 0)) { setError('اكتبي سعر العرض'); return; }
    setSaving(true);
    setError(null);
    try {
      if (offer) {
        await offersApi.update(offer.id, { title: title.trim(), offer_price: offerPrice, expires_at: lastDay || null, is_active: active });
        onSaved(offer.id, false);
      } else {
        const created = await offersApi.create({ product_id: productId, title: title.trim(), offer_price: offerPrice, expires_at: lastDay || null, is_active: active });
        onSaved(created.id, true);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر حفظ العرض'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={offer ? `تعديل «${offer.name}»` : 'إنشاء عرض — سعر عرض على منتج'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="po-product">المنتج</label>
            <select id="po-product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={Boolean(offer)} style={{ minWidth: 0 }}>
              <option value="">اختاري منتج...</option>
              {products.filter((p) => p.is_active || p.id === productId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({money(p.sale_price)})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="po-title">عنوان العرض</label>
            <input id="po-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="مثال: خصم الصيف" />
          </div>
          <div className="field">
            <label htmlFor="po-price">سعر العرض (ج.م)</label>
            <input id="po-price" type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby="po-price-hint" />
            <div id="po-price-hint" className="field-hint">
              لازم يكون أقل من السعر الأصلي{product ? `: ${money(product.sale_price)}` : offer ? `: ${money(Number(c.original_price))}` : ''}
            </div>
          </div>
          <div className="field">
            <label htmlFor="po-last">آخر يوم (اختياري)</label>
            <input id="po-last" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} aria-describedby="po-last-hint" />
            <div id="po-last-hint" className="field-hint">العرض شغال طول اليوم ده لحد ١٢ بالليل بتوقيت القاهرة</div>
          </div>
          <div className="field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> مفعّل على الموقع
            </label>
          </div>
        </div>
        {error && <div className="error-banner" role="alert" style={{ margin: '10px 0' }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ العرض'}</button>
          {onBack && <button type="button" className="btn" onClick={onBack}>نوع تاني</button>}
          <button type="button" className="btn" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
