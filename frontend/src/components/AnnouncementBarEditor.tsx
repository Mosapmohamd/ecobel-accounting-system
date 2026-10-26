import { useEffect, useState, type CSSProperties } from 'react';
import { announcementBarApi, apiErrorMessage, type AnnouncementBarSettings } from '../lib/api';
import { useToast } from '../lib/toast';

/** The storefront's top announcement bar: text (Arabic and/or English),
 * motion, where it shows, colours and an optional link. Saved as
 * structured settings (backend validates: plain text, named themes, safe
 * links); the storefront picks changes up within a minute, no rebuild. */

const MAX_TEXT = 200;

// The storefront's own colour tokens (ecobel-website globals.css) — named
// themes only, never free CSS.
const THEMES: Record<AnnouncementBarSettings['theme'], { label: string; style: CSSProperties }> = {
  default: { label: 'التدرج الأساسي (أسود ← رمادي)', style: { background: 'linear-gradient(to right, #231f20, #615e5f)', color: '#f2f2f2' } },
  brand: { label: 'أسود', style: { background: '#231f20', color: '#ffffff' } },
  accent: { label: 'رمادي غامق', style: { background: '#4c494a', color: '#ffffff' } },
  light: { label: 'فاتح', style: { background: '#f2f2f2', color: '#231f20', borderBottom: '1px solid #e3e3e3' } },
};
const SPEED_SECONDS: Record<AnnouncementBarSettings['speed'], number> = { slow: 48, normal: 32, fast: 20 };

/** Which way the text moves — "auto": Arabic moves right (it enters where
 * Arabic reading starts), English-only moves left. Same rule as the storefront. */
function barMotion(s: AnnouncementBarSettings): 'right' | 'left' {
  if (s.direction !== 'auto') return s.direction;
  return (s.text_ar ?? '').trim() ? 'right' : 'left';
}

function linkError(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/\s/.test(t) || /[<>"'`\\]/.test(t)) return 'الرابط فيه مسافات أو رموز مش مسموحة';
  if (t.startsWith('/') && !t.startsWith('//')) return null;
  if (/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?(\/\S*)?$/.test(t)) return null;
  return 'الرابط لازم يبدأ بـ / (صفحة في الموقع) أو https://';
}

function BarPreview({ s, width }: { s: AnnouncementBarSettings; width: number }) {
  const texts = [
    s.text_ar?.trim() ? { text: s.text_ar.trim(), dir: 'rtl' as const } : null,
    s.text_en?.trim() ? { text: s.text_en.trim(), dir: 'ltr' as const } : null,
  ].filter(Boolean) as { text: string; dir: 'rtl' | 'ltr' }[];
  if (!s.enabled) return <div className="field-hint">الشريط مقفول — مش هيظهر على الموقع.</div>;
  if (!texts.length) return <div className="field-hint">مفيش نص — الشريط مش هيظهر لحد ما تكتبي نص.</div>;
  const motion = barMotion(s);
  const half = (
    <span className="ab-preview-half">
      {Array.from({ length: 3 }).flatMap((_, i) => texts.map((t, j) => (
        <span key={`${i}-${j}`} dir={t.dir} className="ab-preview-item">{t.text}</span>
      )))}
    </span>
  );
  return (
    <div className="ab-preview" style={{ ...THEMES[s.theme].style, width, maxWidth: '100%' }}>
      {s.scrolling ? (
        <div className="ab-preview-viewport" dir={motion === 'right' ? 'rtl' : 'ltr'}>
          <div className="ab-preview-track" data-motion={motion} style={{ animationDuration: `${SPEED_SECONDS[s.speed] * (width / 1200)}s` }}>
            {half}
            {half}
          </div>
        </div>
      ) : (
        <div className="ab-preview-static">
          {texts.map((t, i) => <span key={i} dir={t.dir} style={{ marginInline: 12 }}>{t.text}</span>)}
        </div>
      )}
    </div>
  );
}

export default function AnnouncementBarEditor() {
  const toast = useToast();
  const [saved, setSaved] = useState<AnnouncementBarSettings | null>(null);
  const [draft, setDraft] = useState<AnnouncementBarSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    announcementBarApi.get()
      .then((s) => { if (live) { setSaved(s); setDraft(s); setLoadError(null); } })
      .catch((err) => { if (live) setLoadError(apiErrorMessage(err, 'تعذر تحميل إعدادات شريط الإعلان')); });
    return () => { live = false; };
  }, [attempt]);

  // Any edit clears the last save error (it was about the previous values).
  const set = <K extends keyof AnnouncementBarSettings>(k: K, v: AnnouncementBarSettings[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setError(null);
  };
  const changed = JSON.stringify(saved) !== JSON.stringify(draft);
  const urlProblem = draft ? linkError(draft.link_url ?? '') : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const payload: AnnouncementBarSettings = {
      ...draft,
      text_ar: draft.text_ar?.trim() || null,
      text_en: draft.text_en?.trim() || null,
      link_url: draft.link_url?.trim() || null,
    };
    if (payload.enabled && !payload.text_ar && !payload.text_en) { setError('اكتبي نص الإعلان قبل ما تفعّلي الشريط'); return; }
    if (urlProblem) { setError(urlProblem); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await announcementBarApi.save(payload);
      setSaved(res);
      setDraft(res);
      toast('شريط الإعلان اتحفظ — هيظهر على الموقع خلال دقيقة');
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر حفظ شريط الإعلان'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <div>
          <h2>شريط الإعلان</h2>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
            الشريط المتحرك أعلى كل صفحات الموقع — التعديل بيظهر على الموقع خلال دقيقة من غير تحديث للكود.
          </div>
        </div>
      </div>
      {loadError ? (
        <div className="error-banner" role="alert" style={{ margin: '0 22px 18px' }}>
          {loadError} <button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>حاولي تاني</button>
        </div>
      ) : !draft ? (
        <div className="empty-state">جاري التحميل...</div>
      ) : (
        <form onSubmit={save} noValidate style={{ padding: '0 22px 22px' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700, marginBottom: 12 }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} /> إظهار الشريط على الموقع
          </label>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ab-ar">النص بالعربي</label>
              <input id="ab-ar" dir="rtl" value={draft.text_ar ?? ''} maxLength={MAX_TEXT} onChange={(e) => set('text_ar', e.target.value)}
                placeholder="مثال: شحن مجاني للطلبات فوق ١٠٠٠ ج.م" aria-describedby="ab-ar-hint" />
              <div id="ab-ar-hint" className="field-hint">{(draft.text_ar ?? '').length}/{MAX_TEXT} — كلام عادي بس (من غير رموز &lt; أو &gt;)</div>
            </div>
            <div className="field">
              <label htmlFor="ab-en">النص بالإنجليزي (اختياري)</label>
              <input id="ab-en" dir="ltr" value={draft.text_en ?? ''} maxLength={MAX_TEXT} onChange={(e) => set('text_en', e.target.value)}
                placeholder="e.g. Free shipping over EGP 1000" aria-describedby="ab-en-hint" />
              <div id="ab-en-hint" className="field-hint">بيظهر جنب النص العربي، كل نص باتجاهه الصح.</div>
            </div>
            <div className="field">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
                <input type="checkbox" checked={draft.scrolling} onChange={(e) => set('scrolling', e.target.checked)} /> النص يتحرك
              </label>
              <div className="field-hint">لو مقفول، النص بيظهر ثابت في النص. واللي مفعّلين «تقليل الحركة» على أجهزتهم بيشوفوه ثابت دايمًا.</div>
            </div>
            <div className="field">
              <label htmlFor="ab-dir">اتجاه الحركة</label>
              <select id="ab-dir" value={draft.direction} disabled={!draft.scrolling} onChange={(e) => set('direction', e.target.value as AnnouncementBarSettings['direction'])}>
                <option value="auto">تلقائي حسب اللغة (العربي يتحرك ناحية اليمين)</option>
                <option value="right">ناحية اليمين</option>
                <option value="left">ناحية الشمال</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ab-speed">السرعة</label>
              <select id="ab-speed" value={draft.speed} disabled={!draft.scrolling} onChange={(e) => set('speed', e.target.value as AnnouncementBarSettings['speed'])}>
                <option value="slow">بطيئة</option>
                <option value="normal">عادية</option>
                <option value="fast">سريعة</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ab-vis">يظهر على</label>
              <select id="ab-vis" value={draft.visibility} onChange={(e) => set('visibility', e.target.value as AnnouncementBarSettings['visibility'])}>
                <option value="all">الكمبيوتر والموبايل</option>
                <option value="desktop">الكمبيوتر بس</option>
                <option value="mobile">الموبايل بس</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ab-theme">الألوان</label>
              <select id="ab-theme" value={draft.theme} onChange={(e) => set('theme', e.target.value as AnnouncementBarSettings['theme'])}>
                {(Object.keys(THEMES) as AnnouncementBarSettings['theme'][]).map((t) => <option key={t} value={t}>{THEMES[t].label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ab-link">رابط عند الضغط (اختياري)</label>
              <input id="ab-link" dir="ltr" value={draft.link_url ?? ''} onChange={(e) => set('link_url', e.target.value)} placeholder="/products?offers=1"
                aria-invalid={Boolean(urlProblem)} aria-describedby="ab-link-hint" />
              <div id="ab-link-hint" className="field-hint" style={urlProblem ? { color: 'var(--rose-text)' } : undefined}>
                {urlProblem ?? 'صفحة في الموقع (تبدأ بـ /) أو عنوان يبدأ بـ https://'}
              </div>
            </div>
          </div>

          <h3 className="detail-heading" style={{ marginTop: 16 }}>معاينة</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {draft.visibility !== 'mobile' && (
              <div><div className="field-hint" style={{ marginBottom: 4 }}>الكمبيوتر</div><BarPreview s={draft} width={1200} /></div>
            )}
            {draft.visibility !== 'desktop' && (
              <div><div className="field-hint" style={{ marginBottom: 4 }}>الموبايل</div><BarPreview s={draft} width={375} /></div>
            )}
          </div>

          {error && <div className="error-banner" role="alert" style={{ margin: '12px 0 0' }}>{error}</div>}
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={saving || !changed}>{saving ? 'جاري الحفظ...' : 'حفظ الشريط'}</button>
            {changed && <button type="button" className="btn" onClick={() => { setDraft(saved); setError(null); }}>تراجع عن التعديلات</button>}
          </div>
        </form>
      )}
    </div>
  );
}
