import { useEffect, useState } from 'react';
import { financeApi, type FinanceEntry, type FinanceEntryType } from '../lib/api';
import Modal from '../components/Modal';

export default function FinancePage() {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  function load() {
    setLoading(true);
    financeApi.list().then(setEntries).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const totalIncome = entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

  return (
    <div>
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
          <div className="empty-state">مفيش قيود مسجّلة لسه.</div>
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
        <NewEntryModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function NewEntryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<FinanceEntryType>('expense');
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
      await financeApi.create({ type, category, amount: Number(amount) || 0, description });
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
