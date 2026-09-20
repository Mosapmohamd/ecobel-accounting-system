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
  cost_price: number;
  sale_price: number;
  quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  stock_status: StockStatus;
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
  cost_price: number;
  discount_percentage: number;
  line_total: number;
  line_profit: number;
}

export interface B2BOrder {
  id: string;
  customer_id: string;
  total_amount: number;
  total_profit: number;
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

export interface FinanceEntry {
  id: string;
  type: FinanceEntryType;
  category: string;
  amount: number;
  description: string | null;
  reference_id: string | null;
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
  period_profit: number;
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
  createOrder: (payload: { customer_id: string; items: { product_id: string; quantity: number }[]; note?: string }) =>
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
  list: (params?: { type?: FinanceEntryType }) =>
    api.get<FinanceEntry[]>('/finance/entries', { params }).then((r) => r.data),
  create: (payload: { type: FinanceEntryType; category: string; amount: number; description?: string }) =>
    api.post<FinanceEntry>('/finance/entries', payload).then((r) => r.data),
};

// ---------------- Reports ----------------
export const reportsApi = {
  dashboard: (period: DashboardPeriod = 'today') =>
    api.get<DashboardSummary>('/reports/dashboard', { params: { period } }).then((r) => r.data),
  monthlySales: (months = 6) =>
    api.get<MonthlySalesPoint[]>('/reports/monthly-sales', { params: { months } }).then((r) => r.data),
};
