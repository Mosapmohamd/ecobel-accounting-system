import { useEffect, useState } from 'react';
import { apiErrorMessage, integrationsApi, type MetaPixelStatus, type StorefrontCheck } from '../lib/api';

const money = (n: number) => `${n.toLocaleString('ar-EG')} ج.م`;
const when = (iso: string) => new Date(iso).toLocaleString('ar-EG');

const statusMark: Record<StorefrontCheck['checks'][number]['status'], { icon: string; color: string }> = {
  ok: { icon: '✓', color: 'var(--ok-strong)' },
  warn: { icon: '!', color: 'var(--ink)' },
  fail: { icon: '✕', color: 'var(--rose-text)' },
  info: { icon: 'i', color: 'var(--ink-muted)' },
};

/** Settings → Integrations: what can be VERIFIED about the storefront's Meta
 * Pixel from here, and plainly what can't (docs/INTEGRATIONS.md). Nothing on
 * this page is an estimate. */
export default function IntegrationsPage() {
  const [data, setData] = useState<MetaPixelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    integrationsApi
      .metaPixel()
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, 'تعذر تحميل حالة التكاملات')));
  }, []);

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      const last_check = await integrationsApi.checkMetaPixel();
      setData((d) => (d ? { ...d, last_check } : d));
    } catch (err) {
      setCheckError(apiErrorMessage(err, 'تعذر تشغيل الفحص'));
    } finally {
      setChecking(false);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">جاري التحميل...</div>;

  const check = data.last_check;
  const pe = data.purchase_eligible;
  const pixelState = !check
    ? { label: 'لسه ما اتفحصش', tone: 'var(--ink-muted)' }
    : check.pixel_id
      ? { label: `شغّال على المتجر — ${check.pixel_id}`, tone: 'var(--ok-strong)' }
      : check.reachable
        ? { label: 'مقفول على المتجر (مفيش Pixel ID)', tone: 'var(--ink)' }
        : { label: 'المتجر مش متاح للفحص', tone: 'var(--rose-text)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Meta Pixel</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              تتبع إعلانات Meta على المتجر الجديد. الصفحة دي بتعرض اللي نقدر نتأكد منه بس — تقارير الإعلانات الكاملة في Meta.
            </div>
          </div>
          <a className="btn btn-secondary" href={data.events_manager_url} target="_blank" rel="noopener noreferrer">
            فتح Meta Events Manager ↗
          </a>
        </div>

        <div className="kpi-grid" style={{ padding: '0 22px 18px' }}>
          <div className="kpi-card">
            <div className="label">حالة الـ Pixel على المتجر</div>
            <div className="value" style={{ fontSize: 16, color: pixelState.tone }}>{pixelState.label}</div>
            {check && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>آخر فحص: {when(check.checked_at)}</div>}
          </div>
          <div className="kpi-card">
            <div className="label">عنوان المتجر اللي بيتفحص</div>
            <div className="value" style={{ fontSize: 14 }} dir="ltr">{data.storefront_url ?? '— مش متظبط (STOREFRONT_URL)'}</div>
          </div>
          <div className="kpi-card" title="أحداث المتصفح بتروح من متصفح العميلة لـ Meta على طول — السيستم ده مش بيشوفها">
            <div className="label">أحداث اتبعتت من المتصفح</div>
            <div className="value" style={{ fontSize: 16, color: 'var(--ink-muted)' }}>مش بتتقاس هنا</div>
          </div>
          <div className="kpi-card" title="محتاج Meta API بتوكن — مش متظبط">
            <div className="label">أحداث وصلت لـ Meta فعلاً</div>
            <div className="value" style={{ fontSize: 16, color: 'var(--ink-muted)' }}>في Events Manager بس</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>طلبات مؤهلة لحدث Purchase</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              من قاعدة البيانات: طلبات اتسلّمت ودفع عند الاستلام (مكتملة ومدفوعة). ده عدد الطلبات اللي تستاهل Purchase —
              مش عدد الأحداث اللي Meta استلمتها.
            </div>
          </div>
        </div>
        <div className="kpi-grid" style={{ padding: '0 22px 18px' }}>
          <div className="kpi-card">
            <div className="label">آخر 7 أيام</div>
            <div className="value">{pe.last_7_days.orders.toLocaleString('ar-EG')} طلب</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{money(pe.last_7_days.value)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">آخر 30 يوم</div>
            <div className="value">{pe.last_30_days.orders.toLocaleString('ar-EG')} طلب</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{money(pe.last_30_days.value)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">آخر توصيل</div>
            <div className="value" style={{ fontSize: 15 }}>{pe.last_delivered_at ? when(pe.last_delivered_at) : '—'}</div>
            {pe.undated > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                {pe.undated} طلب اتسلّم قبل سجل الحالات — متأرخ بآخر تعديل عليه
              </div>
            )}
          </div>
        </div>
        <p className="field-hint" style={{ padding: '0 22px 18px', margin: 0 }}>
          المتصفح بيبعت Purchase بس لما العميلة المسجّلة تفتح حسابها وتلاقي الطلب «تم التوصيل» — طلبات الضيوف مش بتتبعت من المتصفح.
          الطريقة المضمونة هي حدث من السيرفر (Meta Conversions API) وقت التوصيل، ودي محتاجة موافقة ومراجعة أمان وخصوصية قبل تفعيلها.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>الأحداث المدعومة</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>الحدث</th>
              <th>بيتبعت إمتى</th>
              <th>بيانات هنا</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.name}>
                <td dir="ltr" style={{ fontWeight: 600, textAlign: 'start' }}>{e.name}</td>
                <td>{e.trigger}</td>
                <td style={{ color: 'var(--ink-muted)', fontSize: 12.5 }}>
                  {e.server_side_data ? 'الطلبات المؤهلة (فوق)' : 'مفيش — من المتصفح لـ Meta على طول'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>فحص وتشخيص</h2>
            <div className="sub" style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
              بيفتح الصفحة الرئيسية للمتجر مرة واحدة ويتأكد من الـ Pixel ID وإعدادات الأمان. مش بيبعت أي حدث لـ Meta.
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={runCheck} disabled={checking}>
            {checking ? 'جاري الفحص...' : 'فحص المتجر الآن'}
          </button>
        </div>
        {checkError && <div className="error-banner" style={{ margin: '0 22px 16px' }}>{checkError}</div>}
        {check ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 22px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {check.checks.map((c) => (
              <li key={c.name} style={{ display: 'flex', gap: 10, fontSize: 13.5 }}>
                <span aria-hidden="true" style={{ color: statusMark[c.status].color, fontWeight: 700, width: 14 }}>{statusMark[c.status].icon}</span>
                <span><strong>{c.name}:</strong> {c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">لسه ما اتعملش فحص من ساعة ما السيرفر اشتغل.</div>
        )}
        <p className="field-hint" style={{ padding: '0 22px 18px', margin: 0 }}>
          للتأكد إن الأحداث بتوصل Meta فعلاً: Events Manager ← Test Events، أو إضافة Meta Pixel Helper في المتصفح، على نسخة تجريبية من المتجر.
        </p>
      </div>
    </div>
  );
}
