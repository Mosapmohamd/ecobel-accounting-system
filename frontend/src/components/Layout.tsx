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
      { to: '/reports', label: 'التقارير', icon: ReportIcon },
    ],
  },
  {
    group: 'المتجر الإلكتروني',
    items: [
      { to: '/online-orders', label: 'طلبات الموقع', icon: TruckIcon },
      { to: '/offers', label: 'العروض', icon: TagIcon },
      { to: '/routines', label: 'الروتين', icon: SparkleIcon },
      { to: '/coupons', label: 'الكوبونات', icon: TagIcon },
      { to: '/shipping-rates', label: 'أسعار الشحن', icon: TruckIcon },
      { to: '/sales-analytics', label: 'تحليلات المبيعات', icon: ChartIcon },
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
function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7zM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18M8 17V10M13 17V6M18 17v-4" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" />
    </svg>
  );
}
