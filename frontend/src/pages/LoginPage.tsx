import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch {
      setError('اسم المستخدم أو كلمة المرور غير صحيحة');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--forest) 0%, var(--forest-deep) 100%)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--cream)',
          borderRadius: 12,
          padding: '40px 36px',
          width: '100%',
          maxWidth: 380,
        }}
      >
        <div style={{ marginBottom: 28 }}>
          <div style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Eco Bel</div>
          <h1 style={{ fontSize: 26, color: 'var(--forest-deep)' }}>سيستم الحسابات والمخزون</h1>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="username">اسم المستخدم</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="field" style={{ marginBottom: 22 }}>
          <label htmlFor="password">كلمة المرور</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
        </button>
      </form>
    </div>
  );
}
