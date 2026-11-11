import {
  chooseBundleRange, fixedBundleSummary, fixedItemRow, giftValue, money, percentOff, percentageRow, shippingRange, type PricedProduct,
} from './offerMath';
import { salePriceOf } from './offerTypes';
import type { WizardCtx } from './wizardContext';

const SHOWN = 6;
const n = (s: string) => (s.trim() === '' ? NaN : Number(s));

function PriceTable({ rows, more }: { rows: { id: string; name: string; before: number; after: number }[]; more: number }) {
  return (
    <table className="calc-table">
      <thead><tr><th>المنتج</th><th>قبل</th><th>بعد</th><th>الخصم</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td>{money(r.before)}</td>
            <td><strong>{money(r.after)}</strong></td>
            <td>{percentOff(r.before, r.after).toLocaleString('ar-EG')}٪</td>
          </tr>
        ))}
      </tbody>
      {more > 0 && <tfoot><tr><td colSpan={4} className="field-hint">+ {more.toLocaleString('ar-EG')} منتج كمان</td></tr></tfoot>}
    </table>
  );
}

const range = (pool: PricedProduct[]) => {
  const p = pool.map((x) => x.current).sort((a, b) => a - b);
  return p.length ? `${money(p[0])} لـ ${money(p[p.length - 1])}` : '';
};

/** Live, display-only figures for the offer — the backend prices the real
 * carts. Estimates say so. */
export default function CalcPreview({ w }: { w: WizardCtx }) {
  const { form: f, pool, priced, rates } = w;
  switch (f.type) {
    case 'product_price': {
      const rows = f.productIds.flatMap((id) => {
        const p = priced(id);
        const price = salePriceOf(f, id);
        return p && Number.isFinite(price) ? [{ id, name: p.name, before: p.regular, after: price }] : [];
      });
      return rows.length ? <PriceTable rows={rows.slice(0, 50)} more={Math.max(0, rows.length - 50)} /> : null;
    }
    case 'percentage': {
      const pct = n(f.percent);
      if (!(pct > 0 && pct <= 100) || !pool.length) return null;
      const rows = pool.slice(0, SHOWN).map((p) => ({ id: p.id, name: p.name, before: p.current, after: percentageRow(p, pct).after }));
      return (
        <div className="calc">
          <PriceTable rows={rows} more={pool.length - rows.length} />
          {n(f.maxDiscount) > 0 && <p className="field-hint">بحد أقصى {money(n(f.maxDiscount))} خصم على الطلب كله.</p>}
          {pool.some((p) => p.current < p.regular) && <p className="field-hint">الخصم بيتحسب على سعر العرض الحالي للمنتجات اللي عليها سعر عرض.</p>}
        </div>
      );
    }
    case 'fixed_amount': {
      const amount = n(f.amount);
      if (!(amount > 0)) return null;
      if (f.applyPer === 'order') {
        return <p className="calc-line">خصم {money(amount)} مرة واحدة من إجمالي المنتجات الداخلة في العرض — ومش أكتر من سعرها.</p>;
      }
      if (!pool.length) return null;
      const rows = pool.slice(0, SHOWN).map((p) => ({ id: p.id, name: p.name, before: p.current, after: fixedItemRow(p, amount).after }));
      return <PriceTable rows={rows} more={pool.length - rows.length} />;
    }
    case 'bundle_fixed': {
      const price = n(f.bundlePrice);
      const items = f.productIds.flatMap((id) => { const p = priced(id); return p ? [{ product: p, quantity: f.quantities[id] ?? 1 }] : []; });
      if (!items.length) return null;
      const s = fixedBundleSummary(items, Number.isFinite(price) ? price : 0);
      return (
        <div className="calc">
          <p className="calc-line">
            سعرها العادي <strong>{money(s.regularTotal)}</strong>
            {price > 0 && <> · سعر الباقة <strong>{money(price)}</strong></>}
            {price > 0 && s.priceOk && <> · العميلة بتوفّر <strong>{money(s.savingsRegular)}</strong> ({s.percentRegular.toLocaleString('ar-EG')}٪)</>}
          </p>
          {price > 0 && s.discountedInside && (
            <p className="field-hint">
              في منتجات عليها سعر عرض دلوقتي: التوفير الفعلي بأسعار النهارده {s.savingsCurrent > 0 ? money(s.savingsCurrent) : 'مفيش'}.
            </p>
          )}
        </div>
      );
    }
    case 'bundle_choose': {
      const price = n(f.bundlePrice);
      const size = n(f.bundleQuantity);
      if (!(price > 0) || !(size >= 2)) return null;
      const r = chooseBundleRange(pool, size, price, f.distinct);
      if (!r.possible) {
        return r.reason === 'too_few'
          ? <p className="warn">مفيش {size.toLocaleString('ar-EG')} منتجات مختلفة في العرض (فيه {r.available.toLocaleString('ar-EG')} بس) — العميلة مش هتقدر تكمّل الباقة.</p>
          : null;
      }
      return (
        <div className="calc">
          <p className="calc-line">
            <span className="est">تقدير</span> على أساس أسعار النهارده{f.distinct ? '، بمنتجات مختلفة' : ''}: أرخص اختيار {money(r.cheapest)} وأغلى اختيار {money(r.dearest)} —
            {' '}العميلة بتوفّر {r.maxSaving > 0 ? <>لحد <strong>{money(r.maxSaving)}</strong></> : 'مفيش'} حسب اختيارها.
          </p>
          {r.cheapestNotWorth && (
            <p className="warn">لو اختارت أرخص {size.toLocaleString('ar-EG')} منتجات، سعرهم العادي ({money(r.cheapest)}) أقل من سعر الباقة ({money(price)}) أو قده — الباقة ما بتوفّرلهاش حاجة. (تنبيه بس، تقدري تكمّلي.)</p>
          )}
        </div>
      );
    }
    case 'buy_x_get_y': {
      const get = n(f.getQuantity);
      const buy = n(f.buyQuantity);
      const gifts = f.rewardMode === 'custom'
        ? w.products.filter((p) => p.is_active && (f.rewardProductIds.includes(p.id) || f.rewardCategoryIds.includes(p.category_id))).flatMap((p) => { const x = priced(p.id); return x ? [x] : []; })
        : pool;
      const v = giftValue(gifts, get, f.rewardChoice);
      if (!v || !(buy > 0)) return null;
      return (
        <p className="calc-line">
          <span className="est">تقدير</span> اشتري {buy.toLocaleString('ar-EG')} وخدي {get.toLocaleString('ar-EG')} هدية — الهدية ({f.rewardChoice === 'cheapest' ? 'الأرخص' : 'الأغلى'}) قيمتها حوالي <strong>{money(v.typical)}</strong>
          {gifts.length > 1 && <> (أسعار منتجات الهدية من {range(gifts)})</>}.
        </p>
      );
    }
    case 'free_shipping': {
      const fees = rates.filter((r) => !f.cities.length || f.cities.includes(r.city)).map((r) => r.fee);
      const s = shippingRange(fees);
      if (!s) return null;
      return (
        <p className="calc-line">
          العميلة بتوفّر مصاريف الشحن: {s.lo === s.hi ? <strong>{money(s.lo)}</strong> : <>من <strong>{money(s.lo)}</strong> لـ <strong>{money(s.hi)}</strong> حسب المحافظة</>}
          {n(f.minSubtotal) > 0 ? ` — للطلبات من ${money(n(f.minSubtotal))}` : ' — على أي طلب'}.
        </p>
      );
    }
    default:
      return null;
  }
}
