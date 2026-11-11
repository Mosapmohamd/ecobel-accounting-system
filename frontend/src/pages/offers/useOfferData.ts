import { useCallback, useEffect, useState } from 'react';
import {
  categoriesApi, productsApi, promotionsApi, shippingRatesApi,
  type Category, type Product, type Promotion, type PromotionState, type ShippingRate,
} from '../../lib/api';

/** Products (archived included, so old offers keep their names), categories
 * and active shipping rates — the same endpoints the Offers page used. */
export function useLookups() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([productsApi.list({ status: 'all' }), categoriesApi.list(), shippingRatesApi.list()])
      .then(([p, c, r]) => {
        if (!live) return;
        setProducts(p);
        setCategories(c);
        setRates(r.filter((x) => x.is_active));
        setLoaded(true);
      })
      .catch(() => live && setError('تعذر تحميل المنتجات والفئات'));
    return () => { live = false; };
  }, [attempt]);
  return { products, categories, rates, loaded, error, retry: () => setAttempt((n) => n + 1) };
}

const PAGE = 100;

/** Every offer in one state, page by page (the unified list). */
async function allInState(state: PromotionState): Promise<Promotion[]> {
  const out: Promotion[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await promotionsApi.list({ state, sort: 'oldest', limit: PAGE, offset });
    out.push(...page.items);
    if (offset + PAGE >= page.total || !page.items.length) return out;
  }
}

/** Running and scheduled offers (cart offers and sale prices) — for the
 * overlap warnings and today's prices. Never blocks the form. */
export function useMarket() {
  const [offers, setOffers] = useState<Promotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([allInState('active'), allInState('scheduled')])
      .then(([a, s]) => live && setOffers([...a, ...s]))
      .catch(() => live && setError('تعذر تحميل العروض الحالية — مش هنقدر ننبّهك لو في تعارض'));
    return () => { live = false; };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { offers, error, retry };
}
