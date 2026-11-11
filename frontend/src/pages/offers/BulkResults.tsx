import { useState } from 'react';
import type { BulkItem } from './bulkSalePrice';
import { cairoDate, dateLabel, parseInstant } from './dates';
import { money } from './offerMath';

const ICON: Record<BulkItem['status'], string> = {
  pending: '…', saving: '…', checking: '…', created: '✓', rejected: '✗', not_created: '✗', unresolved: '?',
};
const time = (iso: string | null) => (iso ? new Date(parseInstant(iso)).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }) : '');

/** What happened to each product of a multi-product sale price. Created
 * ones are never resent; unresolved ones wait for the employee. */
export default function BulkResults({ items, busy, onConfirmCreated, onConfirmNotCreated }: {
  items: BulkItem[];
  busy: boolean;
  onConfirmCreated: (productId: string, offerId?: string) => void;
  onConfirmNotCreated: (productId: string) => void;
}) {
  const [doubting, setDoubting] = useState<string | null>(null);
  const created = items.filter((i) => i.status === 'created').length;
  return (
    <div className="bulk">
      <p className="review-summary" aria-live="polite">
        {busy ? `جاري الحفظ... ${items.filter((i) => !['pending', 'saving', 'checking'].includes(i.status)).length.toLocaleString('ar-EG')} من ${items.length.toLocaleString('ar-EG')}`
          : `اتعمل ${created.toLocaleString('ar-EG')} من ${items.length.toLocaleString('ar-EG')}`}
      </p>
      <ul className="bulk-list">
        {items.map((i) => (
          <li key={i.productId} data-status={i.status}>
            <span className="bulk-icon" aria-hidden="true">{ICON[i.status]}</span>
            <span className="bulk-body">
              <strong>{i.productName}</strong> — {money(i.payload.offer_price)}
              {i.status === 'created' && <span className="field-hint"> · {i.payload.is_active ? 'اتفعّل' : 'اتحفظ من غير تفعيل — مش ظاهر على الموقع'}</span>}
              {(i.status === 'saving' || i.status === 'checking') && <span className="field-hint"> · {i.status === 'saving' ? 'جاري الحفظ' : 'بنتأكد اتعمل ولا لأ'}</span>}
              {i.message && i.status !== 'created' && <div className={i.status === 'unresolved' ? 'warn' : 'field-error'}>{i.message}</div>}
              {i.status === 'unresolved' && (
                <div className="bulk-resolve">
                  {i.candidates && i.candidates.length > 0 ? (
                    <>
                      <div className="field-hint">لقينا العرض ده (أو أكتر) اتعمل للمنتج بعد ما بدأتي الحفظ — افتحي قائمة العروض واتأكدي:</div>
                      <ul>
                        {i.candidates.map((c) => (
                          <li key={c.id}>
                            «{c.name}» — {money(Number((c.config as Record<string, unknown>).offer_price))} · {c.status === 'active' ? 'مفعّل' : 'مش مفعّل'}
                            {c.created_at && ` · اتعمل ${time(c.created_at)}`}{c.ends_at && ` · لحد ${dateLabel(cairoDate(c.ends_at, true))}`}
                            {' '}<button type="button" className="btn btn-sm" disabled={busy} onClick={() => onConfirmCreated(i.productId, c.id)}>أيوه، ده اللي اتعمل</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="field-hint">ما قدرناش نتأكد — راجعي قائمة العروض (نوع «سعر عرض على منتج») للمنتج ده.</div>
                  )}
                  {doubting === i.productId || !(i.candidates && i.candidates.length) ? (
                    <span className="bulk-confirm">
                      {i.candidates && i.candidates.length > 0 && <span>متأكدة إن ده مش العرض بتاعك؟ </span>}
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setDoubting(null); onConfirmNotCreated(i.productId); }}>لأ، ما اتعملش — ابعتيه تاني</button>
                      {!(i.candidates && i.candidates.length) && (
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onConfirmCreated(i.productId)}>أيوه، اتعمل</button>
                      )}
                    </span>
                  ) : (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setDoubting(i.productId)}>مش ده</button>
                  )}
                </div>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
