import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import {
  apiErrorMessage, offersApi, promotionsApi,
  type OfferListType, type Promotion, type PromotionInput, type PromotionSort, type PromotionState, type PromotionType,
} from '../lib/api';
import OfferWizard from './offers/OfferWizard';
import PreviewPanel from './offers/PreviewPanel';
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

/** The offer form is open: a new offer (null) or an existing one. */
type Editing = { offer: Promotion | null };

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
  // The offers just created/edited: highlighted in the list for a moment.
  const [highlight, setHighlight] = useState<string[] | null>(null);
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
  function saved(ids: string[], created: boolean) {
    setEditing(null);
    toast(created ? (ids.length > 1 ? `اتضاف ${ids.length} عرض` : ids.length ? 'العرض اتضاف' : 'ما اتضافش عروض') : 'التعديلات اتحفظت');
    if (created && ids.length) {
      setQ(''); setQuery(''); setType(''); setState(''); setSort('newest'); setOffset(0);
    }
    setHighlight(ids);
    refresh();
  }

  /** A copy of an offer whose terms are locked — opened in the form. */
  async function duplicateAndOpen(p: Promotion) {
    try {
      const copy = await promotionsApi.duplicate(p.id);
      toast('اتعملت نسخة (مسودة) — عدّلي شروطها');
      refresh();
      setEditing({ offer: copy });
    } catch (err) {
      toast(apiErrorMessage(err, 'تعذر عمل نسخة'), 'error');
    }
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
      {editing && (
        <OfferWizard
          key={editing.offer?.id ?? 'new'}
          offer={editing.offer}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onDuplicate={duplicateAndOpen}
        />
      )}
      {viewing && (
        <PromotionDetailsModal
          promotion={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing({ offer: viewing });
            setViewing(null);
          }}
        />
      )}

      <div className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2>العروض</h2>
            <div style={{ fontSize: 12.5, color: 'var(--color-ink-muted)', marginTop: 2 }}>
              كل عروض الموقع في مكان واحد: أسعار عروض المنتجات، الباقات، الشحن المجاني، الخصومات والهدايا
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({ offer: null })}>+ إنشاء عرض</button>
        </div>

        <div role="group" aria-label="ملخص العروض" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, padding: '14px 22px 0' }}>
          {([['total', 'كل العروض'], ['active', 'فعّال'], ['scheduled', 'مجدول'], ['expired', 'منتهي'], ['draft', 'مسودة'], ['inactive', 'موقّف']] as const).map(([k, label]) => {
            const pressed = k === 'total' ? state === '' : state === k;
            return (
              <button key={k} type="button" aria-pressed={pressed} onClick={() => { setState(k === 'total' ? '' : k); setOffset(0); }}
                style={{ textAlign: 'start', border: `1px solid ${pressed ? 'var(--color-primary-dark)' : 'var(--color-line)'}`, borderRadius: 8, padding: '10px 12px', background: 'var(--color-surface)', cursor: 'pointer', font: 'inherit', minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-ink)' }}>{(counts[k] ?? 0).toLocaleString('ar-EG')}</div>
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
          <label htmlFor="offers-state" style={{ fontSize: 12.5, color: 'var(--color-ink-muted)' }}>الحالة</label>
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
                  <tr key={`${p.source}-${p.id}`} data-highlight={highlight?.includes(p.id) || undefined}
                    style={highlight?.includes(p.id) ? { background: 'var(--color-success-tint)', transition: 'background 0.6s' } : undefined}>
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
                        <div style={{ color: 'var(--color-ink-muted)' }}>
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
                          onClick={() => setEditing({ offer: p })}>تعديل</button>
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
