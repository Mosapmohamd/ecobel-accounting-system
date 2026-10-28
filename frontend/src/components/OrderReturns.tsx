import { useEffect, useId, useRef, useState } from 'react';
import {
  apiErrorMessage,
  onlineOrdersApi,
  type OnlineOrder,
  type OrderReturnsSummary,
  type ReturnIn,
  type ReturnPreview,
} from '../lib/api';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useToast } from '../lib/toast';

const money = (n: number) => `${n.toLocaleString('ar-EG')} ج.م`;

const REASONS = ['المقاس أو النوع مش مناسب', 'المنتج وصل تالف', 'منتج غلط اتبعت', 'العميلة غيّرت رأيها', 'أخرى'];

/** Today in Cairo, as YYYY-MM-DD (the backend checks the same calendar). */
function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Returns of one order: what's returnable per line, what came back and
 * what went back to stock, every return recorded — and the button that
 * records a new one (delivered orders only). */
export function OrderReturnsPanel({ order, onChanged }: { order: OnlineOrder; onChanged: () => void }) {
  const [summary, setSummary] = useState<OrderReturnsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function load() {
    onlineOrdersApi
      .returns(order.id)
      .then((s) => {
        setSummary(s);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err, 'تعذر تحميل المرتجعات')));
  }
  useEffect(load, [order.id, order.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div style={{ fontSize: 12.5, color: 'var(--rose-text)', marginTop: 10 }}>{error}</div>;
  if (!summary) return <div style={{ fontSize: 12.5, marginTop: 10 }}>جاري تحميل المرتجعات...</div>;

  const anyReturned = summary.lines.some((l) => l.returned > 0);
  return (
    <div style={{ fontSize: 12.5, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>المرتجعات:</strong>
        {summary.returns.length === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>مفيش مرتجعات</span>
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>
            {summary.fully_returned ? 'الطلب رجع كله' : 'مرتجع جزئي'} · قيمة المرتجع {money(summary.merchandise_returned)} من {money(summary.merchandise_total)}
            {summary.revenue_reversed > 0 && ` · اتعكس من الإيراد ${money(summary.revenue_reversed)}`}
          </span>
        )}
        {summary.can_return && (
          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => setOpen(true)}>
            تسجيل مرتجع
          </button>
        )}
      </div>
      {anyReturned && (
        <table style={{ marginTop: 6, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>المطلوب</th>
              <th>رجع</th>
              <th>رجع للمخزون</th>
              <th>متاح للإرجاع</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((l) => (
              <tr key={l.order_item_id}>
                <td>{l.product_name}</td>
                <td>{l.ordered}</td>
                <td>{l.returned}</td>
                <td>{l.restocked}</td>
                <td>{l.returnable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {summary.returns.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, color: 'var(--ink-muted)' }}>
          {summary.returns.map((r) => {
            const units = r.items.reduce((n, i) => n + i.quantity, 0);
            const restocked = r.items.filter((i) => i.restock).reduce((n, i) => n + i.quantity, 0);
            return (
              <li key={r.id}>
                {new Date(`${r.returned_on}T00:00:00`).toLocaleDateString('ar-EG')} — {r.reason} — {units} قطعة (رجع للمخزون {restocked})
                {' '}· قيمة {money(r.merchandise_value)}
                {r.revenue_reversed > 0 ? ` · عكس إيراد ${money(r.revenue_reversed)}` : ' · من غير عكس إيراد'} — {r.processed_by}
                {r.note && ` — ${r.note}`}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <ReturnDialog
          order={order}
          summary={summary}
          onClose={() => setOpen(false)}
          onRecorded={() => {
            setOpen(false);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

type Draft = Record<string, { quantity: string; restock: boolean }>;

function ReturnDialog({ order, summary, onClose, onRecorded }: {
  order: OnlineOrder;
  summary: OrderReturnsSummary;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(summary.lines.map((l) => [l.order_item_id, { quantity: '0', restock: true }])),
  );
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState('');
  const [returnedOn, setReturnedOn] = useState(cairoToday());
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per submission of this form: a retry after a network error
  // reuses it, so the return can't be recorded twice.
  const requestId = useRef(newRequestId());
  useDialogFocus(panelRef, { onClose, canClose: () => !busy });

  function payload(): ReturnIn | string {
    const items = summary.lines
      .map((l) => ({ line: l, d: draft[l.order_item_id] }))
      .filter(({ d }) => Number(d.quantity) > 0);
    if (items.length === 0) return 'اختاري كمية لقطعة واحدة على الأقل';
    for (const { line, d } of items) {
      const q = Number(d.quantity);
      if (!Number.isInteger(q) || q < 0) return `كمية «${line.product_name}» لازم تكون رقم صحيح`;
      if (q > line.returnable) return `«${line.product_name}»: المتاح للإرجاع ${line.returnable} بس`;
    }
    const why = reason === 'أخرى' ? otherReason.trim() : reason;
    if (!why) return 'اكتبي سبب المرتجع';
    if (!returnedOn) return 'اختاري تاريخ المرتجع';
    return {
      items: items.map(({ line, d }) => ({ order_item_id: line.order_item_id, quantity: Number(d.quantity), restock: d.restock })),
      reason: why,
      note: note.trim() || undefined,
      returned_on: returnedOn,
    };
  }

  function edit(update: () => void) {
    update();
    setPreview(null); // anything changed → review again before confirming
    setError(null);
    requestId.current = newRequestId();
  }

  async function review() {
    const p = payload();
    if (typeof p === 'string') return setError(p);
    setBusy(true);
    setError(null);
    try {
      setPreview(await onlineOrdersApi.previewReturn(order.id, p));
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر حساب المرتجع'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const p = payload();
    if (typeof p === 'string') return setError(p);
    setBusy(true);
    setError(null);
    try {
      await onlineOrdersApi.createReturn(order.id, { ...p, request_id: requestId.current });
      toast(`اتسجل مرتجع طلب #${order.order_number}`);
      onRecorded();
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر تسجيل المرتجع، حاولي تاني'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div
        ref={panelRef}
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`}>تسجيل مرتجع — طلب #{order.order_number}</h2>
        <p className="field-hint" style={{ marginTop: 0 }}>
          سجّلي القطع اللي رجعت فعلاً بس. «ترجع للمخزون» للقطع السليمة اللي ينفع تتباع تاني — التالف مش بيرجع للمخزون.
          الشحن مش بيترجع. الطلب نفسه بيفضل «تم التوصيل».
        </p>

        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>متاح للإرجاع</th>
              <th>الكمية الراجعة</th>
              <th>ترجع للمخزون؟</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((l) => (
              <tr key={l.order_item_id}>
                <td>
                  {l.product_name}
                  <br />
                  <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>قيمة القطعة {money(l.unit_value)}</span>
                </td>
                <td>{l.returnable}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={l.returnable}
                    step={1}
                    disabled={l.returnable === 0 || busy}
                    aria-label={`الكمية الراجعة من ${l.product_name}`}
                    value={draft[l.order_item_id].quantity}
                    onChange={(e) => edit(() => setDraft((d) => ({ ...d, [l.order_item_id]: { ...d[l.order_item_id], quantity: e.target.value } })))}
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      disabled={l.returnable === 0 || busy}
                      checked={draft[l.order_item_id].restock}
                      onChange={(e) => edit(() => setDraft((d) => ({ ...d, [l.order_item_id]: { ...d[l.order_item_id], restock: e.target.checked } })))}
                    />
                    سليمة
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`${id}-reason`}>سبب المرتجع</label>
            <select id={`${id}-reason`} value={reason} disabled={busy} onChange={(e) => edit(() => setReason(e.target.value))}>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {reason === 'أخرى' && (
            <div className="field">
              <label htmlFor={`${id}-other`}>السبب</label>
              <input id={`${id}-other`} value={otherReason} maxLength={200} disabled={busy} onChange={(e) => edit(() => setOtherReason(e.target.value))} />
            </div>
          )}
          <div className="field">
            <label htmlFor={`${id}-date`}>تاريخ رجوع البضاعة</label>
            <input id={`${id}-date`} type="date" value={returnedOn} max={cairoToday()} disabled={busy} onChange={(e) => edit(() => setReturnedOn(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-note`}>ملاحظة (اختياري)</label>
            <textarea id={`${id}-note`} value={note} maxLength={1000} rows={2} disabled={busy} onChange={(e) => edit(() => setNote(e.target.value))} />
          </div>
        </div>

        {preview && (
          <div className="panel" style={{ padding: 12, marginTop: 12, fontSize: 13.5, lineHeight: 1.8 }} role="status">
            <strong>مراجعة قبل التأكيد</strong>
            <div>القطع الراجعة: {preview.units} — ترجع للمخزون: {preview.units_restocked} — مش هترجع للمخزون: {preview.units - preview.units_restocked}</div>
            <div>قيمة القطع الراجعة (بعد العروض والكوبون): {money(preview.merchandise_value)}</div>
            <div>
              {preview.revenue_reversed > 0
                ? `هيتسجل عكس إيراد بـ ${money(preview.revenue_reversed)} (قيد الإيراد الأصلي بيفضل في السجل).`
                : 'مش هيتسجل عكس إيراد — إيراد الطلب ده ما اتسجلش (مش دفع عند الاستلام).'}
            </div>
            <div style={{ color: 'var(--ink-muted)' }}>الشحن ({money(summary.shipping_fee)}) مش بيترجع.</div>
          </div>
        )}

        {error && <div role="alert" className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}

        <div className="modal-actions">
          {preview ? (
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy ? 'جاري التسجيل...' : 'تأكيد المرتجع'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={review} disabled={busy}>
              {busy ? 'جاري الحساب...' : 'مراجعة المرتجع'}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            رجوع
          </button>
        </div>
      </div>
    </div>
  );
}
