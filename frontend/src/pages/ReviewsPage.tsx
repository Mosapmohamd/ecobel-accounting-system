import { useEffect, useState } from 'react';
import { reviewsApi, type Review } from '../lib/api';

const STARS = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const isApproved = filter === 'pending' ? false : filter === 'approved' ? true : undefined;
    reviewsApi.list(isApproved).then(setReviews).finally(() => setLoading(false));
  }
  useEffect(load, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove(id: string) {
    await reviewsApi.approve(id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('متأكد إنك عايز تحذف التقييم ده؟')) return;
    await reviewsApi.remove(id);
    load();
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>تقييمات المنتجات</h2>
            <div className="sub" style={{ fontSize: 12.5, color: '#8a8074', marginTop: 2 }}>
              التقييم مايظهرش للعملاء إلا بعد الموافقة عليه من هنا
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 22px 16px' }}>
          {(['pending', 'approved', 'all'] as const).map((f) => (
            <button
              key={f}
              className="btn"
              onClick={() => setFilter(f)}
              style={{ background: filter === f ? 'var(--forest)' : 'var(--parchment-2)', color: filter === f ? 'var(--cream)' : 'var(--forest)' }}
            >
              {f === 'pending' ? 'في انتظار الموافقة' : f === 'approved' ? 'معتمدة' : 'الكل'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty-state">جاري التحميل...</div>
        ) : reviews.length === 0 ? (
          <div className="empty-state">مفيش تقييمات في القسم ده.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>العميل</th>
                <th>التقييم</th>
                <th>التعليق</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} style={{ opacity: r.is_approved ? 1 : 0.85 }}>
                  <td style={{ fontWeight: 600 }}>{r.product_name}</td>
                  <td>{r.customer_name}</td>
                  <td style={{ color: 'var(--gold)', letterSpacing: 1 }}>{STARS(r.rating)}</td>
                  <td style={{ maxWidth: 280, fontSize: 13 }}>{r.comment || '—'}</td>
                  <td>{new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!r.is_approved && (
                        <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={() => handleApprove(r.id)}>
                          موافقة
                        </button>
                      )}
                      <button
                        className="btn"
                        style={{ padding: '5px 10px', fontSize: 12.5, background: 'rgba(201,123,138,0.15)', color: 'var(--rose)' }}
                        onClick={() => handleDelete(r.id)}
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
