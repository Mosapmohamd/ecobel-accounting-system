# Settings → Integrations (admin)

One page (`/settings/integrations`) for the storefront's **Meta Pixel**. It
shows only what this system can verify, and says plainly what it can't. It
is not an ads dashboard: campaigns, spend, reach, ROAS and attribution stay in
Meta (Events Manager / Ads Manager). Code: `backend/app/integrations.py`,
`backend/app/routers/integrations.py`, `frontend/src/pages/IntegrationsPage.tsx`.
Signed-in admin only (the one staff account; no roles).

## Data flow — what is measured where

```
customer's browser ──(Pixel events)──► Meta          (this system never sees them)
storefront HTML/CSP ◄──(on-demand check)── accounting backend   (STOREFRONT_URL)
orders + status audit (this DB) ──► "orders that qualify for Purchase"
```

| Shown on the page | Source | Reliable? |
|---|---|---|
| Pixel on/off, the Pixel ID the live storefront serves, consent mode | fetch of `STOREFRONT_URL` (its public `<meta name="ecobel-meta-pixel" content="<id>" data-consent="opt-in">` marker) | yes — what the deployed storefront actually serves |
| No Meta beacon sent without consent | the same page (no `facebook.com/tr?` image in the HTML) | yes |
| CSP lets the Pixel run, and nothing broader | the same response's `Content-Security-Policy` | yes |
| Orders that qualify for Purchase (7 / 30 days, value, last delivery) | `orders` (delivered + cash on delivery) and `order_status_changes` (delivery time) | yes — the server-side truth of which orders are completed and paid |
| Events sent by browsers (counts, last time) | — | **not measured**: browsers send straight to Meta |
| Events received / matched by Meta | — | **not measured**: needs a Meta API token (none configured) |
| Campaign metrics, spend, ROAS | — | **out of scope**: Meta Ads Manager |

Nothing is estimated or extrapolated. The last check is kept in the server's
memory only (it's a live probe, not a history) — after a restart the page says
"not checked yet".

## The check

`POST /integrations/meta-pixel/check` fetches **only** `STOREFRONT_URL`
(server configuration; the request can't choose a URL), once, with an 8 s
timeout, at most 2 MB, and **never follows redirects** (it reports them). It
sends nothing to Meta. Results: reachable, Pixel ID(s) found, consent mode
is opt-in, no beacon that would send without consent, CSP allows
`script-src https://connect.facebook.net` + `connect-src`/`img-src
https://www.facebook.com` when the Pixel is on, and no wildcard/scheme-wide
sources (`*`, `https:`, `*.facebook.*`).

Configure (accounting backend env, not secret):

```
STOREFRONT_URL=https://<the new storefront's public address>
```

Empty → the page says the check isn't configured.

## Not stored, not exposed

- The Pixel ID is public (it's in every storefront page); it's read from the
  storefront, not stored here.
- No Meta access token exists in this system. If a Conversions API or
  Marketing API integration is approved later, its token is a server secret
  (env var on the accounting backend, never `NEXT_PUBLIC_*`, never returned by
  any endpoint, never shown on this page).

## Later (separately approved)

- **Conversions API (server-side Purchase):** send Purchase when staff mark a
  cash-on-delivery order delivered, `event_id = "purchase_<order id>"` (the
  same id the browser uses, so Meta deduplicates). The "orders that qualify"
  set on this page is exactly that event's source. Needs: access token,
  privacy review (customer data sent hashed, or not at all), consent decision,
  and a retry/outbox so Meta can never block or duplicate a status change.
  Then this page can show sent/failed counts from that outbox — real numbers.
- **Marketing API:** campaign metrics here only if a read-only integration is
  approved; until then, Meta's own reports.
