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

## The cash-on-delivery rule (business rule, adopted 2026-10-27)

**When a cash-on-delivery order is marked Delivered, its payment is treated as
completed and its revenue is recognized.** This is a business assumption, not
a verification: the system has no payment-confirmation step and does not
independently check that the courier collected or remitted the money. Staff
marking an order «تم التوصيل» is what recognizes the revenue.

## Admin status changes (accounting → طلبات الموقع)

Staff pick the status from a dropdown; the backend (`schemas.ORDER_TRANSITIONS`)
is the source of truth for what's allowed:

| From | Allowed to |
|---|---|
| pending | shipped, delivered, cancelled |
| shipped | pending, delivered, cancelled |
| delivered | cancelled |
| cancelled | — (final: its stock and coupon were released; reviving it could oversell) |

Anything else is refused (409); an unknown status value is rejected (422);
saving the current status again is a no-op. Only signed-in staff can change
a status (there are no staff roles — every staff account may). Each change
is recorded in `order_status_changes` (from → to, staff username, time,
revenue recognized/reversed, units restored) — schema change
`docs/schema-changes/2026-10-27_order_status_changes.sql` (applied 2026-10-27).

**Delivered → cancelled** (the whole order refused or sent back): the
recognized revenue is reversed with one «إلغاء طلب موقع» entry (the income
entry stays), all the stock the order still holds is given back, and the
coupon and offer uses are released. Each happens once: the order row is
locked, a cancelled order can't change again, and the ledger functions only
move what's still recognized/held. When only some items came back, or some
came back damaged, record a **return** instead (below). An order with a
recorded return can't be cancelled (409) — its returned units were already
handled one by one.

## Returns (accounting → طلبات الموقع → التفاصيل → تسجيل مرتجع)

A return is recorded against a **delivered** order, per order line: units
returned, and whether they're sellable (back to stock) or not (damaged). The
order stays «تم التوصيل». Code: `backend/app/returns.py`,
`backend/app/routers/order_returns.py`; schema change
`docs/schema-changes/2026-10-28_order_returns.sql`.

- **Quantities:** never more than ordered minus already returned, per line.
- **Stock:** only the units marked sellable go back — one `customer_return`
  inventory movement per product (reference = the order). Damaged units
  don't; nothing beyond what was returned does.
- **Money:** a returned unit is worth what the customer paid for it — the
  line price, minus the offer discount allocated to that product at checkout
  (`order_promotions.details.allocations`; older orders without allocations:
  spread by value), minus the coupon spread over the lines by their value
  after offers. The value of everything returned so far is rounded once, so
  returning every unit reverses exactly the merchandise total (to the cent).
- **Shipping is not refunded** by a return (it stays recognized revenue).
- **Revenue:** if the order's revenue was recognized (delivered + cash on
  delivery), the returned value is reversed with one expense entry
  «مرتجع طلب موقع» (source `website`, reference = the order) — a revenue
  reversal, not an operating expense; the sale entry stays. An order never
  recognized (another payment method) reverses nothing; its stock is still
  handled. Restocking never touches revenue.
- **Reports:** revenue is net of returns. The dashboard shows the period's
  returns (`period_returns`); sales analytics shows the returns total and how
  many recognized orders were partly / fully returned. Cancellations
  («إلغاء طلب موقع») and returns («مرتجع طلب موقع») stay distinguishable.
- **Once only:** each submission carries a `request_id` (unique) — a retry
  returns the return already recorded; the order row lock serializes returns
  on one order (verified on PostgreSQL 17: 8 simultaneous returns of the same
  last units → one recorded; 6 retries of one submission → one recorded).
- **Audit:** who processed it, when, the date the goods came back, reason,
  note, per-line units/restock/value, merchandise value and revenue reversed.
  The admin reviews quantities and money before confirming.

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

Partial returns aren't cancellations: they're recorded as returns (above).

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
2. **Payment confirmation (limitation).** There is no payment-status field;
   per the COD rule above, a delivered COD order is treated as paid. A failed
   collection marked "delivered" still counts until staff cancel it; courier
   remittance isn't recorded. Any other payment method is never counted. A
   real payment status needs a schema change.
3. **Shipping** is included in recognized revenue (`total_amount`) — the
   approved rule.
4. **Returns:** shipping is never refunded by a return, and the reversal is
   dated when the return is recorded (the goods' return date is kept on the
   return). Cash actually paid back to customers isn't tracked (no payment
   ledger) — the reversal is revenue, not a cash movement.
5. **Customer cancellations** (website, pending orders only) aren't written
   to `order_status_changes` — only staff changes are; their ledger and
   inventory notes still record them.

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
