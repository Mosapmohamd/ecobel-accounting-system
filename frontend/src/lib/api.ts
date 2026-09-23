import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ecobel_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ecobel_token');
      if (!location.pathname.includes('/login')) {
        location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// ---------------- Types ----------------
export type StockStatus = 'ok' | 'low' | 'out';

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  sku: string | null;
  sale_price: number;
  quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  stock_status: StockStatus;
  image_url: string | null;
  created_at: string;
}

export interface B2BCustomer {
  id: string;
  name: string;
  phone: string | null;
  discount_percentage: number;
  notes: string | null;
  created_at: string;
}

export interface B2BOrderItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  line_total: number;
}

export interface B2BOrder {
  id: string;
  customer_id: string;
  total_amount: number;
  extra_discount_percentage: number;
  note: string | null;
  created_at: string;
  items: B2BOrderItem[];
}

export type RecipientType = 'pharmacy' | 'potential_customer';

export interface FreeDistribution {
  id: string;
  recipient_name: string;
  recipient_type: RecipientType;
  note: string | null;
  created_at: string;
  items: { product_id: string; quantity: number }[];
}

export type FinanceEntryType = 'income' | 'expense';
export type FinanceSource = 'website' | 'b2b' | 'spending';

export interface FinanceEntry {
  id: string;
  type: FinanceEntryType;
  category: string;
  amount: number;
  description: string | null;
  reference_id: string | null;
  source: FinanceSource | null;
  entry_date: string;
}

export type DashboardPeriod = 'today' | 'month' | 'quarter' | 'year';

export interface DashboardSummary {
  period: DashboardPeriod;
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  period_income: number;
  period_expense: number;
  period_b2b_sales: number;
  free_distribution_events: number;
  free_distribution_pieces: number;
}

export interface MonthlySalesPoint {
  month: string;
  total: number;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  type: string;
  quantity_change: number;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

// ---------------- Auth ----------------
export async function login(username: string, password: string) {
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  const { data } = await axios.post(`${API_BASE}/auth/login`, form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data as { access_token: string; token_type: string };
}

// ---------------- Categories ----------------
export const categoriesApi = {
  list: () => api.get<Category[]>('/categories/').then((r) => r.data),
  create: (name: string) => api.post<Category>('/categories/', { name }).then((r) => r.data),
};

// ---------------- Products ----------------
export const productsApi = {
  list: (params?: { category_id?: string; low_stock_only?: boolean }) =>
    api.get<Product[]>('/products/', { params }).then((r) => r.data),
  create: (payload: Partial<Product> & { category_id: string }) =>
    api.post<Product>('/products/', payload).then((r) => r.data),
  update: (id: string, payload: Partial<Product>) =>
    api.patch<Product>(`/products/${id}`, payload).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/products/${id}`),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<Product>(`/products/${id}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

// ---------------- Inventory ----------------
export const inventoryApi = {
  adjust: (payload: { product_id: string; quantity_change: number; note?: string }) =>
    api.post('/inventory/adjust', payload).then((r) => r.data),
  movements: (params?: { product_id?: string; limit?: number }) =>
    api.get<InventoryMovement[]>('/inventory/movements', { params }).then((r) => r.data),
};

// ---------------- B2B ----------------
export const b2bApi = {
  listCustomers: () => api.get<B2BCustomer[]>('/b2b/customers').then((r) => r.data),
  createCustomer: (payload: Partial<B2BCustomer>) =>
    api.post<B2BCustomer>('/b2b/customers', payload).then((r) => r.data),
  updateCustomer: (id: string, payload: Partial<B2BCustomer>) =>
    api.patch<B2BCustomer>(`/b2b/customers/${id}`, payload).then((r) => r.data),
  listOrders: (customer_id?: string) =>
    api.get<B2BOrder[]>('/b2b/orders', { params: { customer_id } }).then((r) => r.data),
  createOrder: (payload: { customer_id: string; items: { product_id: string; quantity: number }[]; note?: string; extra_discount_percentage?: number }) =>
    api.post<B2BOrder>('/b2b/orders', payload).then((r) => r.data),
};

// ---------------- Free distribution ----------------
export const freeDistributionApi = {
  list: () => api.get<FreeDistribution[]>('/free-distribution/').then((r) => r.data),
  create: (payload: {
    recipient_name: string;
    recipient_type: RecipientType;
    items: { product_id: string; quantity: number }[];
    note?: string;
  }) => api.post<FreeDistribution>('/free-distribution/', payload).then((r) => r.data),
};

// ---------------- Finance ----------------
export const financeApi = {
  list: (params?: { type?: FinanceEntryType; source?: FinanceSource }) =>
    api.get<FinanceEntry[]>('/finance/entries', { params }).then((r) => r.data),
  create: (payload: { type: FinanceEntryType; category: string; amount: number; description?: string; source?: FinanceSource }) =>
    api.post<FinanceEntry>('/finance/entries', payload).then((r) => r.data),
};

// ---------------- Shipping rates ----------------
export interface ShippingRate {
  id: string;
  city: string;
  fee: number;
  is_active: boolean;
  created_at: string;
}

export const shippingRatesApi = {
  list: () => api.get<ShippingRate[]>('/shipping-rates/').then((r) => r.data),
  create: (payload: { city: string; fee: number }) =>
    api.post<ShippingRate>('/shipping-rates/', payload).then((r) => r.data),
  update: (id: string, payload: Partial<{ fee: number; is_active: boolean }>) =>
    api.patch<ShippingRate>(`/shipping-rates/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/shipping-rates/${id}`),
};

// ---------------- Report exports (Excel) ----------------
function downloadExport(path: string, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const token = localStorage.getItem('ecobel_token');
  const url = `${API_BASE}${path}${qs}`;
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((res) => res.blob())
    .then((blob) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'report.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
    });
}

export const reportExportsApi = {
  finance: (params?: { source?: FinanceSource; type?: FinanceEntryType }) =>
    downloadExport('/reports/export/finance', params as Record<string, string>),
  onlineOrders: (status?: string) => downloadExport('/reports/export/online-orders', status ? { status } : undefined),
  b2bOrders: () => downloadExport('/reports/export/b2b-orders'),
  inventory: () => downloadExport('/reports/export/inventory'),
};

// ---------------- Reports ----------------
export const reportsApi = {
  dashboard: (period: DashboardPeriod = 'today') =>
    api.get<DashboardSummary>('/reports/dashboard', { params: { period } }).then((r) => r.data),
  monthlySales: (months = 6) =>
    api.get<MonthlySalesPoint[]>('/reports/monthly-sales', { params: { months } }).then((r) => r.data),
};

// ==========================================================================
// Online store admin — coupons, website orders, unified sales analytics.
// The website (ecobel-website) validates coupons and creates these orders;
// all administration of them happens here.
// ==========================================================================

// ---------------- Coupons ----------------
export type CouponDiscountType = 'percentage' | 'fixed';
export type CouponLimitType = 'duration' | 'count' | 'unlimited';

export interface Coupon {
  id: string;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export const couponsApi = {
  list: () => api.get<Coupon[]>('/coupons/').then((r) => r.data),
  create: (payload: {
    code: string;
    discount_type: CouponDiscountType;
    discount_value: number;
    min_order_amount?: number;
    limit_type: CouponLimitType;
    max_uses?: number;
    expires_at?: string;
  }) => api.post<Coupon>('/coupons/', payload).then((r) => r.data),
  renew: (id: string) => api.post<Coupon>(`/coupons/${id}/renew`).then((r) => r.data),
  remove: (id: string) => api.delete(`/coupons/${id}`),
};

// ---------------- Online (website) orders ----------------
export type OnlineOrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';

export interface OnlineOrderItem {
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface OnlineOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  status: OnlineOrderStatus;
  payment_method: string;
  subtotal: number;
  discount_amount: number;
  shipping_fee: number;
  total_amount: number;
  note: string | null;
  created_at: string;
  items: OnlineOrderItem[];
}

export const onlineOrdersApi = {
  list: (status?: OnlineOrderStatus) =>
    api.get<OnlineOrder[]>('/online-orders/', { params: status ? { status } : undefined }).then((r) => r.data),
  updateStatus: (id: string, status: OnlineOrderStatus) =>
    api.patch<OnlineOrder>(`/online-orders/${id}/status`, { status }).then((r) => r.data),
};

// ---------------- Unified sales analytics ----------------
export type SalesSource = 'all' | 'online' | 'b2b';

export interface RevenuePoint {
  date: string;
  total: number;
}

export interface TopProduct {
  product_name: string;
  quantity_sold: number;
  revenue: number;
}

export interface SalesAnalytics {
  source: SalesSource;
  total_revenue: number;
  total_orders: number;
  orders_by_status: Record<string, number>;
  revenue_last_30_days: RevenuePoint[];
  top_products: TopProduct[];
}

export const salesAnalyticsApi = {
  get: (source: SalesSource = 'all') =>
    api.get<SalesAnalytics>('/sales-analytics/', { params: { source } }).then((r) => r.data),
};

// ---------------- Offers ----------------
export interface Offer {
  id: string;
  product_id: string;
  title: string;
  offer_price: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export const offersApi = {
  list: () => api.get<Offer[]>('/offers/').then((r) => r.data),
  create: (payload: { product_id: string; title: string; offer_price: number; expires_at?: string }) =>
    api.post<Offer>('/offers/', payload).then((r) => r.data),
  update: (id: string, payload: Partial<{ title: string; offer_price: number; is_active: boolean; expires_at: string | null }>) =>
    api.patch<Offer>(`/offers/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/offers/${id}`),
};

// ---------------- Routines ----------------
export interface RoutineItem {
  product_id: string;
  product_name: string;
  sale_price: number;
  image_url: string | null;
}

export interface Routine {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  items: RoutineItem[];
  created_at: string;
}

export const routinesApi = {
  list: () => api.get<Routine[]>('/routines/').then((r) => r.data),
  create: (payload: { name: string; description?: string; product_ids: string[] }) =>
    api.post<Routine>('/routines/', payload).then((r) => r.data),
  update: (id: string, payload: Partial<{ name: string; description: string; is_active: boolean; product_ids: string[] }>) =>
    api.patch<Routine>(`/routines/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/routines/${id}`),
};
