import { useEffect, useState } from 'react';
import { financeApi, type FinanceEntry, type FinanceEntryType, type FinanceSource } from '../lib/api';
import Modal from '../components/Modal';

const TABS: { key: FinanceSource; label: string }[] = [
  { key: 'website', label: 'إيرادات الموقع' },
  { key: 'b2b', label: 'إيرادات ومبيعات B2B' },
  { key: 'spending', label: 'المصروفات العامة' },
];

export default function FinancePage() {
  const [tab, setTab] = useState<FinanceSource>('website');
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    financeApi.list({ source: tab }).then(setEntries).finally(() => setLoading(false));
  }
  useEffect(load, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalIncome = entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className="btn"
            onClick={() => setTab(t.key)}
            style={{ background: tab === t.key ? 'var(--forest)' : 'var(--parchment-2)', color: tab === t.key ? 'var(--cream)' : 'var(--forest)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi-card">
          <div className="label">إجمالي الإيرادات</div>
          <div className="value" style={{ color: 'var(--ok)' }}>{totalIncome.toLocaleString('ar-EG')} ج.م</div>
        </div>
        <div className="kpi-card">
          <div className="label">إجمالي المصروفات</div>
          <div className="value" style={{ color: 'var(--rose)' }}>{totalExpense.toLocaleString('ar-EG')} ج.م</div>
        </div>
        <div className="kpi-card">
          <div className="label">الصافي</div>
          <div className="value">{(totalIncome - totalExpense).toLocaleString('ar-EG')} ج.م</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>الحركات المالية</h2>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ قيد جديد</button>
        </div>
        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">مفيش قيود مسجّلة في القسم ده لسه.</div>
        ) : (
          <table>
            <thead>
              <tr><th>النوع</th><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={`status ${e.type === 'income' ? 'ok' : 'out'}`}>
                      {e.type === 'income' ? 'إيراد' : 'مصروف'}
                    </span>
                  </td>
                  <td>{e.category}</td>
                  <td>{e.description || '—'}</td>
                  <td style={{ fontWeight: 700, color: e.type === 'income' ? 'var(--ok)' : 'var(--rose)' }}>
                    {e.type === 'income' ? '+' : '-'}{e.amount.toLocaleString('ar-EG')} ج.م
                  </td>
                  <td>{new Date(e.entry_date).toLocaleDateString('ar-EG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewEntryModal defaultSource={tab} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewEntryModal({
  defaultSource,
  onClose,
  onCreated,
}: {
  defaultSource: FinanceSource;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<FinanceEntryType>('expense');
  const [source, setSource] = useState<FinanceSource>(defaultSource);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await financeApi.create({ type, category, amount: Number(amount) || 0, description, source });
      onCreated();
    } catch {
      setError('حصل خطأ أثناء إضافة القيد');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="قيد مالي جديد" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <div className="field">
            <label>النوع</label>
            <select value={type} onChange={(e) => setType(e.target.value as FinanceEntryType)}>
              <option value="expense">مصروف</option>
              <option value="income">إيراد</option>
            </select>
          </div>
          <div className="field">
            <label>القسم</label>
            <select value={source} onChange={(e) => setSource(e.target.value as FinanceSource)}>
              <option value="spending">مصروفات عامة</option>
              <option value="website">الموقع</option>
              <option value="b2b">B2B</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>الفئة</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="مواد خام، شحن، ..." required />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>المبلغ (ج.م)</label>
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>وصف (اختياري)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ القيد'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
