import type { Category, Product, Promotion, ShippingRate } from '../../lib/api';
import type { PricedProduct } from './offerMath';
import type { Errors, OfferForm } from './offerTypes';
import type { Warning } from './overlap';

/** What every step reads (and the one way to change the form). */
export interface WizardCtx {
  form: OfferForm;
  update: (patch: Partial<OfferForm>) => void;
  errors: Errors;
  products: Product[];
  categories: Category[];
  rates: ShippingRate[];
  byId: Map<string, Product>;
  /** Regular and today's price of a product. */
  priced: (id: string) => PricedProduct | undefined;
  /** Active products the offer covers (for estimates). */
  pool: PricedProduct[];
  /** The offer being edited (null: a new one). */
  original: Promotion | null;
  /** An order used it: its terms are read-only. */
  locked: boolean;
  today: string;
  warnings: Warning[];
  marketError: string | null;
  marketLoading: boolean;
}

export const TYPE_NAME: Record<string, string> = {
  product_price: 'سعر عرض على منتج',
  bundle: 'باقة',
  free_shipping: 'شحن مجاني',
  percentage: 'خصم نسبة',
  fixed_amount: 'خصم مبلغ',
  buy_x_get_y: 'هدية مع الشراء',
};

export const STATE_NAME: Record<string, string> = {
  draft: 'مسودة', scheduled: 'مجدول', active: 'فعّال', expired: 'منتهي', inactive: 'موقّف',
};
