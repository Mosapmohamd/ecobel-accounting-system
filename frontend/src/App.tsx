import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import B2BPage from './pages/B2BPage';
import FreeDistributionPage from './pages/FreeDistributionPage';
import FinancePage from './pages/FinancePage';
import CouponsPage from './pages/CouponsPage';
import OnlineOrdersPage from './pages/OnlineOrdersPage';
import SalesAnalyticsPage from './pages/SalesAnalyticsPage';
import OffersPage from './pages/OffersPage';
import RoutinesPage from './pages/RoutinesPage';
import ShippingRatesPage from './pages/ShippingRatesPage';
import ReportsPage from './pages/ReportsPage';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="b2b" element={<B2BPage />} />
        <Route path="free-distribution" element={<FreeDistributionPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="coupons" element={<CouponsPage />} />
        <Route path="online-orders" element={<OnlineOrdersPage />} />
        <Route path="sales-analytics" element={<SalesAnalyticsPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="routines" element={<RoutinesPage />} />
        <Route path="shipping-rates" element={<ShippingRatesPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
