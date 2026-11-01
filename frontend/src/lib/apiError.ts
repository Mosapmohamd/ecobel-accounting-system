// Turns an API error into one message staff can act on. No imports, so it
// runs under `node --test` as well (tests/apiError.test.mjs).
//
// The API answers in two shapes:
// * our own errors: `{ detail: "Arabic message" }` — shown as they are;
// * request validation (HTTP 422): `{ detail: [{ loc, msg, type, ctx }] }` —
//   each item becomes "field: reason" in Arabic.
// Anything else (network error, 500…) shows the caller's fallback — never a
// raw server response or stack trace.

type ValidationItem = { loc?: unknown[]; msg?: unknown; type?: unknown; ctx?: Record<string, unknown> };

const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  title: 'العنوان',
  code: 'الكود',
  category: 'الفئة',
  category_id: 'الفئة',
  city: 'المدينة',
  fee: 'رسوم الشحن',
  amount: 'المبلغ',
  type: 'النوع',
  source: 'القسم',
  description: 'الوصف',
  short_description: 'الوصف المختصر',
  note: 'الملاحظة',
  notes: 'الملاحظات',
  phone: 'رقم التليفون',
  sku: 'SKU',
  sale_price: 'السعر',
  offer_price: 'سعر العرض',
  quantity: 'الكمية',
  quantity_change: 'الكمية',
  low_stock_threshold: 'حد التنبيه',
  discount_value: 'قيمة الخصم',
  discount_percentage: 'نسبة الخصم',
  extra_discount_percentage: 'الخصم الإضافي',
  min_order_amount: 'الحد الأدنى للطلب',
  max_uses: 'عدد مرات الاستخدام',
  expires_at: 'تاريخ الانتهاء',
  is_active: 'الحالة',
  recipient_name: 'اسم المستلم',
  recipient_type: 'نوع المستلم',
  items: 'المنتجات',
  product_ids: 'المنتجات',
  product_id: 'المنتج',
  customer_id: 'العميل',
};

function fieldLabel(loc: unknown[] | undefined): string | null {
  // loc is like ["body", "items", 0, "quantity"]: name the last named field.
  const names = (loc ?? []).filter((p): p is string => typeof p === 'string' && p !== 'body' && p !== 'query' && p !== 'path');
  const last = names[names.length - 1];
  if (!last) return null;
  return FIELD_LABELS[last] ?? null;
}

function reason(item: ValidationItem): string {
  const type = typeof item.type === 'string' ? item.type : '';
  const ctx = item.ctx ?? {};
  const msg = typeof item.msg === 'string' ? item.msg : '';
  switch (type) {
    case 'value_error':
      // Our own validators' Arabic messages ("Value error, اسم الروتين مطلوب").
      return msg.replace(/^Value error,\s*/, '');
    case 'missing':
      return 'مطلوب';
    case 'string_too_long':
      return `الحد الأقصى ${ctx.max_length} حرف`;
    case 'string_too_short':
      return `لازم ${ctx.min_length} حرف على الأقل`;
    case 'too_long':
      return `الحد الأقصى ${ctx.max_length}`;
    case 'too_short':
      return `لازم ${ctx.min_length} على الأقل`;
    case 'greater_than':
      return `لازم يكون أكبر من ${ctx.gt}`;
    case 'greater_than_equal':
      return `لازم يكون ${ctx.ge} أو أكتر`;
    case 'less_than':
      return `لازم يكون أقل من ${ctx.lt}`;
    case 'less_than_equal':
      return `لازم يكون ${ctx.le} أو أقل`;
    case 'int_parsing':
    case 'int_from_float':
    case 'float_parsing':
    case 'int_type':
    case 'float_type':
      return 'لازم يكون رقم';
    case 'bool_parsing':
    case 'bool_type':
      return 'قيمة غير صالحة';
    case 'enum':
    case 'literal_error':
      return 'اختيار غير صالح';
    case 'datetime_parsing':
    case 'datetime_from_date_parsing':
    case 'date_parsing':
      return 'تاريخ غير صالح';
    default:
      return 'قيمة غير صالحة';
  }
}

/** The validation items of a 422 answer as Arabic lines ("الاسم: مطلوب"),
 * duplicates removed. Empty when `detail` isn't a validation list. */
export function validationMessages(detail: unknown): string[] {
  if (!Array.isArray(detail)) return [];
  const lines: string[] = [];
  for (const raw of detail) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as ValidationItem;
    const text = reason(item);
    const label = fieldLabel(Array.isArray(item.loc) ? item.loc : undefined);
    const line = label ? `${label}: ${text}` : text;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const lines = validationMessages(detail);
  return lines.length ? lines.join(' — ') : fallback;
}
