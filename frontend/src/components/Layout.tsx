import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  {
    group: null,
    items: [{ to: '/', label: 'لوحة التحكم', icon: DashboardIcon, end: true }],
  },
  {
    group: 'المخزون والمبيعات',
    items: [
      { to: '/products', label: 'المنتجات والمخزون', icon: BoxIcon },
      { to: '/b2b', label: 'مبيعات الجملة B2B', icon: CartIcon },
      { to: '/free-distribution', label: 'التوزيع المجاني', icon: GiftIcon },
    ],
  },
  {
    group: 'الحسابات',
    items: [
      { to: '/finance', label: 'المصروفات والإيرادات', icon: MoneyIcon },
    ],
  },
];

export default function Layout() {
  const { username, logout } = useAuth();
  const initial = (username || 'M').charAt(0).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <LeafIcon /> Eco Bel
        </div>
        {navItems.map((section, i) => (
          <div className="nav-group" key={i}>
            {section.group && <div className="nav-label">{section.group}</div>}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
              >
                <item.icon /> {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>لوحة التحكم</h1>
            <div className="sub">نظرة عامة على المخزون والمبيعات</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="user-chip">
              <div className="avatar">{initial}</div> {username || 'فريق Eco Bel'}
            </div>
            <button className="logout-btn" onClick={logout}>تسجيل خروج</button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function LeafIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C9 6 7 9 7 13a5 5 0 0 0 10 0c0-4-2-7-5-11Z" fill="#E4C874" />
    </svg>
  );
}
function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 8 12 3 4 8v8l8 5 8-5V8Z" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.6a2 2 0 0 0 2-1.6L21 5H6" />
    </svg>
  );
}
function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6M12 2v13M8 11l4 4 4-4" />
    </svg>
  );
}
function MoneyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" />
    </svg>
  );
}
