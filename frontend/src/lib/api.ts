import axios from 'axios';
import { exportFilename } from './exportFilename';

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

/** The backend's own (Arabic) reason for a failed request, or `fallback`. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

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
  /** Main photo. */
  image_url: string | null;
  /** Additional photos, in display order. */
  images: ProductPhoto[];
  short_description: string | null;
  description: string | null;
  created_at: string;
}

export interface ProductPhoto {
  id: string;
  image_url: string | null;
  position: number;
}

export type ProductListStatus = 'active' | 'archived' | 'all';

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
  product_name: string | null;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  line_total: number;
}

export interface B2BOrder {
  id: string;
  customer_id: string;
  customer_name: string | null;
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
  /** Sales revenue: completed AND paid website orders only (backend app/revenue.py). */
  period_revenue: number;
  period_online_revenue: number;
  /** Revenue reversed by customer returns (already netted out of period_revenue). */
  period_returns: number;
  /** Booked B2B sales — shown on their own, NOT part of period_revenue. */
  period_b2b_sales: number;
  /** Income entered manually — not sales. */
  period_other_income: number;
  /** period_revenue + period_other_income. */
  period_income: number;
  /** Operating expenses (revenue reversals are not expenses). */
  period_expense: number;
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
  list: (params?: { category_id?: string; low_stock_only?: boolean; status?: ProductListStatus }) =>
    api.get<Product[]>('/products/', { params }).then((r) => r.data),
  create: (payload: Partial<Product> & { category_id: string }) =>
    api.post<Product>('/products/', payload).then((r) => r.data),
  update: (id: string, payload: Partial<Product>) =>
    api.patch<Product>(`/products/${id}`, payload).then((r) => r.data),
  /** Archives the product (soft delete) — see the backend's DELETE /products/{id}. */
  deactivate: (id: string) => api.delete(`/products/${id}`),
  restore: (id: string) => api.patch<Product>(`/products/${id}`, { is_active: true }).then((r) => r.data),
  uploadImage: (id: string, file: File) =>
    api.post<Product>(`/products/${id}/image`, fileForm(file), multipart).then((r) => r.data),
  removeImage: (id: string) => api.delete<Product>(`/products/${id}/image`).then((r) => r.data),
  addPhoto: (id: string, file: File) =>
    api.post<Product>(`/products/${id}/images`, fileForm(file), multipart).then((r) => r.data),
  replacePhoto: (id: string, imageId: string, file: File) =>
    api.put<Product>(`/products/${id}/images/${imageId}`, fileForm(file), multipart).then((r) => r.data),
  removePhoto: (id: string, imageId: string) =>
    api.delete<Product>(`/products/${id}/images/${imageId}`).then((r) => r.data),
  makePrimary: (id: string, imageId: string) =>
    api.post<Product>(`/products/${id}/images/${imageId}/primary`).then((r) => r.data),
  reorderPhotos: (id: string, imageIds: string[]) =>
    api.put<Product>(`/products/${id}/images/order`, { image_ids: imageIds }).then((r) => r.data),
};

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

// ---------------- Inventory ----------------
export const inventoryApi = {
  adjust: (payload: { product_id: string; quantity_change: number; note?: string }) =>
    api.post('/inventory/adjust', payload).then((r) => r.data),
  movements: (params?: { product_id?: string; limit?: number }) =>
    api.get<InventoryMovement[]>('/inventory/movements', { params }).then((r) => r.data),
};

// ---------------- B2B ----------------
export const b2bApi = {
  /** By name unless `order: 'newest'`; `limit` caps the list. */
  listCustomers: (params?: { order?: 'name' | 'newest'; limit?: number }) =>
    api.get<B2BCustomer[]>('/b2b/customers', { params }).then((r) => r.data),
  createCustomer: (payload: Partial<B2BCustomer>) =>
    api.post<B2BCustomer>('/b2b/customers', payload).then((r) => r.data),
  updateCustomer: (id: string, payload: Partial<B2BCustomer>) =>
    api.patch<B2BCustomer>(`/b2b/customers/${id}`, payload).then((r) => r.data),
  /** Newest first; `limit` caps the list. */
  listOrders: (params?: { customer_id?: string; limit?: number }) =>
    api.get<B2BOrder[]>('/b2b/orders', { params }).then((r) => r.data),
  createOrder: (payload: { customer_id: string; items: { product_id: string; quantity: number }[]; note?: string; extra_discount_percentage?: number }) =>
    api.post<B2BOrder>('/b2b/orders', payload).then((r) => r.data),
  getCustomer: (id: string) => api.get<B2BCustomer>(`/b2b/customers/${id}`).then((r) => r.data),
  /** Refused (409) while the customer has orders. */
  deleteCustomer: (id: string) => api.delete(`/b2b/customers/${id}`),
  getOrder: (id: string) => api.get<B2BOrder>(`/b2b/orders/${id}`).then((r) => r.data),
  /** Products, quantities, note and extra discount; stock and finance are reconciled server-side. */
  updateOrder: (id: string, payload: { items: { product_id: string; quantity: number }[]; note?: string | null; extra_discount_percentage: number }) =>
    api.put<B2BOrder>(`/b2b/orders/${id}`, payload).then((r) => r.data),
  /** Returns the stock and reverses the revenue, then removes the order. */
  deleteOrder: (id: string) => api.delete(`/b2b/orders/${id}`),
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
/** Downloads one report as its own .xlsx file. Rejects (and saves nothing)
 * if the server answers with an error, so an error message is never saved
 * as a spreadsheet. */
function downloadExport(path: string, filename: string, params?: Record<string, string>): Promise<void> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const token = localStorage.getItem('ecobel_token');
  const url = `${API_BASE}${path}${qs}`;
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((res) => {
      if (!res.ok) throw new Error(`export failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    });
}

export const reportExportsApi = {
  finance: (params?: { source?: FinanceSource; type?: FinanceEntryType }) =>
    downloadExport('/reports/export/finance', exportFilename('Finance_Report', [params?.source, params?.type]), params as Record<string, string>),
  onlineOrders: (status?: string) =>
    downloadExport('/reports/export/online-orders', exportFilename('Online_Orders_Report', [status]), status ? { status } : undefined),
  b2bOrders: () => downloadExport('/reports/export/b2b-orders', exportFilename('B2B_Orders_Report')),
  inventory: () => downloadExport('/reports/export/inventory', exportFilename('Inventory_Report')),
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
  /** Coupon discount. */
  discount_amount: number;
  /** Cart offers' product discount (shipping waivers are in applied_promotions). */
  promotion_discount: number;
  shipping_fee: number;
  total_amount: number;
  note: string | null;
  created_at: string;
  items: OnlineOrderItem[];
  applied_promotions: { promotion_id: string; name: string; type: string; discount: number; shipping_discount: number }[];
  /** Where staff can move it from here — decided by the backend. */
  next_statuses: OnlineOrderStatus[];
}

/** One staff status change (audit trail). */
export interface OrderStatusChange {
  from_status: OnlineOrderStatus;
  to_status: OnlineOrderStatus;
  changed_by: string;
  /** + revenue recognized / − revenue reversed by this change. */
  revenue_change: number;
  units_restored: number;
  created_at: string;
}

/** Customer returns on a delivered order (backend app/returns.py). */
export interface ReturnItemIn {
  order_item_id: string;
  quantity: number;
  restock: boolean;
}

export interface ReturnIn {
  items: ReturnItemIn[];
  reason: string;
  note?: string;
  returned_on: string;
}

export interface ReturnPreview {
  lines: { order_item_id: string; product_name: string; quantity: number; restock: boolean; amount: number }[];
  units: number;
  units_restocked: number;
  merchandise_value: number;
  /** What the ledger will reverse — 0 if the order's revenue was never recognized. */
  revenue_reversed: number;
  shipping_refunded: number;
}

export interface OrderReturn {
  id: string;
  reason: string;
  note: string | null;
  returned_on: string;
  processed_by: string;
  merchandise_value: number;
  revenue_reversed: number;
  created_at: string;
  items: { order_item_id: string; product_id: string; quantity: number; restock: boolean; amount: number }[];
}

export interface OrderReturnsSummary {
  order_id: string;
  status: OnlineOrderStatus;
  can_return: boolean;
  reason_if_not: string | null;
  lines: {
    order_item_id: string;
    product_id: string;
    product_name: string;
    ordered: number;
    returned: number;
    restocked: number;
    returnable: number;
    unit_value: number;
  }[];
  returns: OrderReturn[];
  merchandise_total: number;
  merchandise_returned: number;
  revenue_reversed: number;
  shipping_fee: number;
  fully_returned: boolean;
}

export const onlineOrdersApi = {
  list: (status?: OnlineOrderStatus) =>
    api.get<OnlineOrder[]>('/online-orders/', { params: status ? { status } : undefined }).then((r) => r.data),
  updateStatus: (id: string, status: OnlineOrderStatus) =>
    api.patch<OnlineOrder>(`/online-orders/${id}/status`, { status }).then((r) => r.data),
  statusHistory: (id: string) =>
    api.get<OrderStatusChange[]>(`/online-orders/${id}/status-history`).then((r) => r.data),
  returns: (id: string) => api.get<OrderReturnsSummary>(`/online-orders/${id}/returns`).then((r) => r.data),
  previewReturn: (id: string, payload: ReturnIn) =>
    api.post<ReturnPreview>(`/online-orders/${id}/returns/preview`, payload).then((r) => r.data),
  /** `request_id` stays the same when the same submission is retried. */
  createReturn: (id: string, payload: ReturnIn & { request_id: string }) =>
    api.post<OrderReturn>(`/online-orders/${id}/returns`, payload).then((r) => r.data),
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
  /** Recognized: completed AND paid website orders. */
  total_revenue: number;
  total_orders: number;
  /** Booked B2B sales — NOT part of total_revenue. */
  b2b_sales: number;
  /** Reversed by customer returns (already netted out of total_revenue). */
  returns_total: number;
  partially_returned_orders: number;
  fully_returned_orders: number;
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
  /** Exclusive end instant (UTC). Set from a date, it's the start of the
   * next Cairo day (backend app/cairo_time.py). */
  expires_at: string | null;
  created_at: string;
  /** Computed by the backend with the storefront's rule: on and not ended. */
  is_running: boolean;
  /** Last Cairo calendar day the offer runs ("YYYY-MM-DD"), or null. */
  ends_on: string | null;
  /** True when it runs to the end of `ends_on`; false for an explicit time. */
  ends_at_day_end: boolean;
}

/** Per-product sale prices. Listed on the unified Offers page (promotionsApi.list, type "product_price"). */
export const offersApi = {
  list: () => api.get<Offer[]>('/offers/').then((r) => r.data),
  /** expires_at: "YYYY-MM-DD" = the offer's last day (runs through that whole day, Cairo time). */
  /** is_active false: saved switched off (e.g. a copy) — changes no price yet. */
  create: (payload: { product_id: string; title: string; offer_price: number; expires_at?: string | null; is_active?: boolean }) =>
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

// ---------------- Reviews moderation ----------------
export interface Review {
  id: string;
  product_id: string;
  product_name: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  is_approved: boolean;
  created_at: string;
}

export const reviewsApi = {
  list: (isApproved?: boolean) =>
    api.get<Review[]>('/reviews/', { params: isApproved === undefined ? undefined : { is_approved: isApproved } }).then((r) => r.data),
  approve: (id: string) => api.post<Review>(`/reviews/${id}/approve`).then((r) => r.data),
  remove: (id: string) => api.delete(`/reviews/${id}`),
};

// ---------------- Homepage merchandising ----------------
export interface FeaturedProductSlot {
  position: number;
  product: Product;
  /** false = no longer sellable; the storefront skips this slot. */
  is_visible: boolean;
  issue: string | null;
}

export interface FeaturedRoutineSlot {
  position: number;
  routine: Routine;
  is_visible: boolean;
  issue: string | null;
}

export const FEATURED_PRODUCTS_MAX = 8;
export const FEATURED_ROUTINES_MAX = 2;

export const merchandisingApi = {
  featuredProducts: () => api.get<FeaturedProductSlot[]>('/merchandising/featured-products').then((r) => r.data),
  setFeaturedProducts: (productIds: string[]) =>
    api.put<FeaturedProductSlot[]>('/merchandising/featured-products', { product_ids: productIds }).then((r) => r.data),
  featuredRoutines: () => api.get<FeaturedRoutineSlot[]>('/merchandising/featured-routines').then((r) => r.data),
  setFeaturedRoutines: (routineIds: string[]) =>
    api.put<FeaturedRoutineSlot[]>('/merchandising/featured-routines', { routine_ids: routineIds }).then((r) => r.data),
};

// ---------------- Offer Builder (cart-level promotions — backend app/promotions.py) ----------------
export type PromotionType = 'bundle' | 'free_shipping' | 'percentage' | 'fixed_amount' | 'buy_x_get_y';
/** Every offer type the Offers page lists: cart offers plus per-product sale prices (/offers). */
export type OfferListType = PromotionType | 'product_price';
export type PromotionStatus = 'draft' | 'active' | 'inactive';
/** status plus the dates: an active offer before its start is "scheduled", after its end "expired". */
export type PromotionState = 'draft' | 'scheduled' | 'active' | 'expired' | 'inactive';
export type PromotionSort = 'newest' | 'oldest' | 'name' | 'priority' | 'starts' | 'ends' | 'usage';

export interface PromotionTarget {
  id: string;
  name: string;
  /** Units per bundle (fixed bundles); 1 otherwise. */
  quantity: number;
}

export interface Promotion {
  /** "product_offer": a per-product sale price (type "product_price",
   * config {product_id, offer_price, original_price}) — edited through offersApi. */
  source: 'promotion' | 'product_offer';
  id: string;
  name: string;
  description: string | null;
  badge_text: string | null;
  type: OfferListType;
  status: PromotionStatus;
  state: PromotionState;
  /** What the offer gives, in one line (from the backend). */
  summary: string;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  combinable: boolean;
  min_subtotal: number | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
  used_count: number;
  orders_count: number;
  /** Used by an order: type/settings/products/minimum can't change any more. */
  terms_locked: boolean;
  config: Record<string, unknown>;
  eligible_products: PromotionTarget[];
  eligible_categories: PromotionTarget[];
  reward_products: PromotionTarget[];
  reward_categories: PromotionTarget[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  badge_text?: string | null;
  type: PromotionType;
  status: PromotionStatus;
  /** "YYYY-MM-DD" — from the start of that day / through the end of that day, Cairo time. */
  starts_at?: string | null;
  ends_at?: string | null;
  priority: number;
  combinable: boolean;
  min_subtotal?: number | null;
  usage_limit?: number | null;
  per_customer_limit?: number | null;
  config: Record<string, unknown>;
  eligible_product_ids: string[];
  eligible_category_ids: string[];
  reward_product_ids: string[];
  reward_category_ids: string[];
  /** Fixed bundles: units per bundle of each product (missing = 1). */
  product_quantities?: Record<string, number>;
}

export interface PromotionPage {
  items: Promotion[];
  total: number;
  limit: number;
  offset: number;
  /** Per state for the current search/type, before the state filter (plus "total"). */
  counts: Partial<Record<PromotionState | 'total', number>>;
}

export interface PromotionPreview {
  lines: { product_id: string; product_name: string; quantity: number; unit_price: number; line_total: number; discount: number; free_units: number }[];
  subtotal: number;
  applied: boolean;
  reason: string | null;
  discount: number;
  shipping_fee: number | null;
  shipping_discount: number;
  total: number;
  summary: string;
  detail: Record<string, unknown>;
}

export const promotionsApi = {
  list: (params: { q?: string; type?: OfferListType; state?: PromotionState; sort?: PromotionSort; limit?: number; offset?: number }) =>
    api.get<PromotionPage>('/promotions/', { params }).then((r) => r.data),
  get: (id: string) => api.get<Promotion>(`/promotions/${id}`).then((r) => r.data),
  create: (payload: PromotionInput) => api.post<Promotion>('/promotions/', payload).then((r) => r.data),
  update: (id: string, payload: PromotionInput) => api.put<Promotion>(`/promotions/${id}`, payload).then((r) => r.data),
  activate: (id: string) => api.post<Promotion>(`/promotions/${id}/activate`).then((r) => r.data),
  deactivate: (id: string) => api.post<Promotion>(`/promotions/${id}/deactivate`).then((r) => r.data),
  duplicate: (id: string) => api.post<Promotion>(`/promotions/${id}/duplicate`).then((r) => r.data),
  remove: (id: string) => api.delete(`/promotions/${id}`),
  preview: (promotion: PromotionInput, items: { product_id: string; quantity: number }[], city?: string) =>
    api.post<PromotionPreview>('/promotions/preview', { promotion, items, city: city || null }).then((r) => r.data),
};

// ---------------- Storefront settings: the announcement bar ----------------
export interface AnnouncementBarSettings {
  enabled: boolean;
  text_ar: string | null;
  text_en: string | null;
  scrolling: boolean;
  /** auto: follows each language's reading direction. */
  direction: 'auto' | 'right' | 'left';
  speed: 'slow' | 'normal' | 'fast';
  visibility: 'all' | 'desktop' | 'mobile';
  theme: 'default' | 'brand' | 'light' | 'accent';
  /** A site path ("/products") or an https:// address; null = not clickable. */
  link_url: string | null;
}

export const announcementBarApi = {
  get: () => api.get<AnnouncementBarSettings>('/merchandising/announcement-bar').then((r) => r.data),
  save: (payload: AnnouncementBarSettings) =>
    api.put<AnnouncementBarSettings>('/merchandising/announcement-bar', payload).then((r) => r.data),
};

// ---------------- Settings → Integrations (backend app/integrations.py) ----------------
export interface IntegrationCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
}

export interface StorefrontCheck {
  checked_at: string;
  url: string | null;
  reachable: boolean;
  /** The Pixel ID the live storefront serves (null = none). */
  pixel_id: string | null;
  checks: IntegrationCheck[];
}

export interface MetaPixelStatus {
  storefront_url: string | null;
  /** Kept in the server's memory only — null after a restart. */
  last_check: StorefrontCheck | null;
  events: { name: string; trigger: string; server_side_data: boolean }[];
  purchase_eligible: {
    last_7_days: { orders: number; value: number };
    last_30_days: { orders: number; value: number };
    all_time: { orders: number; value: number };
    last_delivered_at: string | null;
    undated: number;
  };
  /** Always false: browser events go straight to Meta. */
  browser_events_measured: boolean;
  /** Always false: needs a Meta API token (none configured). */
  meta_received_measured: boolean;
  events_manager_url: string;
}

export const integrationsApi = {
  metaPixel: () => api.get<MetaPixelStatus>('/integrations/meta-pixel').then((r) => r.data),
  checkMetaPixel: () => api.post<StorefrontCheck>('/integrations/meta-pixel/check').then((r) => r.data),
};
