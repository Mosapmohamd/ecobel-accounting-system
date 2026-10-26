# Revenue, cancellation and stock — the rules

## The one revenue definition

**Recognized sales revenue = website orders that are completed AND paid.**
Every report uses it: the dashboard, monthly sales and sales analytics
(`backend/app/revenue.py`).

| Channel | Completed | Paid | Counted |
|---|---|---|---|
| Website order, cash on delivery | status `delivered` | assumed collected at delivery (see limitations) | the order's `total_amount` (products after offers and coupon, **plus shipping**) |
| Website order, any other payment method | — | no payment confirmation exists in the system | never (until a payment status exists) |
| Website order `pending` / `shipped` / `cancelled` | no | — | never |
| B2B order | not tracked | not tracked | **never, for now** — booked B2B sales are shown separately as «مبيعات الجملة B2B (خارج الإيراد)» |

Dates are **Cairo calendar** days, months, quarters and years, dated when the
revenue was recognized (delivery).

Not revenue, and reported separately:

- **B2B booked sales** — the B2B ledger (sale − edit/cancellation reversals);
  shown on its own (`period_b2b_sales`, `b2b_sales`), never added to revenue
  or other income.
- **Other income** — income entered manually on the finance page.
- **Cash collected** — there is no payment ledger: cash on delivery isn't
  tracked separately from delivery (courier remittance isn't recorded).
- **Meta-attributed conversion value** — Meta's own estimate; it isn't stored
  in this system and must never be added to revenue.

Revenue reversals (website cancellations; B2B edits and cancellations reduce B2B booked sales) are **not**
operating expenses.

## How it's recorded (`backend/app/order_ledger.py`, identical in both repos)

- **Checkout** books nothing — a placed order is pending and unpaid.
- **Delivered** (accounting → online orders) recognizes the order: one income
  entry, category «مبيعات الموقع», source `website`, `reference_id` = order id.
- **Cancelled** (customer or staff) reverses whatever was recognized with an
  expense entry «إلغاء طلب موقع» — nothing for an order that never was.
- Both go through `settle_revenue`, which compares what the ledger recognizes
  for the order (income − reversals) with what the rule says it should be and
  writes **one entry for the difference, or none**. A retry writes nothing.
- Entries are never edited or deleted (the old checkout income entry used to be
  edited in place when an order was edited — no longer).

## Stock on cancellation

`restore_stock` gives back exactly the units the order still holds according
to **its own inventory movements** (checkout and edits deduct, cancellations
and edits give back), each product once, with the product rows locked in id
order (like checkout). Never deducted → nothing comes back; already given back
→ nothing more. The order row is locked during cancellation and a cancelled
order can't be cancelled again. Verified under concurrent requests on
PostgreSQL 17 (duplicate cancellations racing checkouts).

There are no returns, refunds or partial cancellations in the system: an order
is either kept whole or cancelled whole.

## Older orders (booked at checkout before this rule)

Orders placed before this change had their total booked as income at checkout.

- Still pending/shipped: **not revenue** (the report only counts entries of
  completed and paid orders). On delivery the order is settled to its final
  total (one entry for any difference, e.g. after an edit).
- Cancelled later: the booked income is reversed exactly once.
- Their revenue is dated at checkout, not at delivery (the original entry).

## Decisions that need the owner

1. **B2B** orders have no completion or payment status, so they are excluded
   from recognized revenue (decided 2026-10-26). Adding status/payment fields
   to B2B orders would let them be recognized.
2. **Payment confirmation (limitation).** There is no payment-status field.
   Only cash on delivery is treated as paid, and only once delivered —
   assuming the courier collected it. A failed collection marked "delivered"
   would still count; courier remittance isn't recorded. Any other payment
   method is never counted. A real payment status needs a schema change.
3. **Shipping** is included in recognized revenue (`total_amount`) — the
   approved rule.
4. **Returns/refunds** aren't represented; a returned delivered order can't be
   recorded yet.

## Stock vs inventory history — reconciliation plan (NOT applied)

Found 2026-10-26 (read-only): 5 products created 2026-10-24 each show exactly
**+100** units not explained by their movements — their opening stock was saved
without a movement (`create_product`; fixed: new products now record opening
stock as a «restock» movement).

| Product | Stock | Σ movements | Unexplained |
|---|---|---|---|
| سيرم الشعر | 99 | −1 | +100 |
| شامبو التساقط | 99 | −1 | +100 |
| شامبو القشرة | 100 | 0 | +100 |
| لوشن التساقط | 100 | 0 | +100 |
| شامبو بدون سلفات | 100 | 0 | +100 |

Proposed, for review and approval — after a verified backup, in one
transaction, re-checking each product's unexplained amount first and aborting
if anything differs:

- insert ONE `restock` inventory movement of **+100** per product, dated at the
  product's creation, note «رصيد افتتاحي (تسوية)»;
- **do not change `products.quantity`** (it is already correct — only the
  history is incomplete);
- afterwards `quantity = Σ movements` must hold for every product.
