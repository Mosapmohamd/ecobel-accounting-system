# Eco Bel — Accounting & Inventory System (Frontend)

React + TypeScript + Vite dashboard for the [backend](../backend) API.
Same brand identity as the presentation and mockups (forest green / gold /
parchment, Tajawal + Markazi Text).

## Setup

```bash
npm install
cp .env.example .env   # set VITE_API_BASE if the backend isn't on localhost:8000
npm run dev
```

Then log in with the user you created on the backend
(`python create_admin.py <username> <password>`).

## Pages

- **Dashboard** (`/`) — KPI cards, monthly sales chart, low-stock list
- **Products** (`/products`) — product list, create, manual stock adjustments
- **B2B** (`/b2b`) — wholesale customers (fixed discount %) and orders;
  order form shows the auto-calculated discounted total live before saving
- **Free distribution** (`/free-distribution`) — sample tracking to
  pharmacies / potential customers
- **Finance** (`/finance`) — income/expense entries, totals

## Notes

- Auth is a simple JWT stored in `localStorage`; a 401 response anywhere
  redirects to `/login` automatically (see `src/lib/api.ts` interceptor).
- All B2B discount math and stock deduction happens server-side — the
  frontend only *previews* the total for the person entering the order.
- `npm run build` produces a static `dist/` folder — deploy it behind any
  static host or reverse proxy in front of the FastAPI backend.
