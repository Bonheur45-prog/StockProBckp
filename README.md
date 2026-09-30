# StockPro — Hardware Store SaaS

A multi-tenant point-of-sale and inventory management platform for hardware
stores, built offline-first (PWA) with a public marketing site, a free
trial, and a full back-office (reports, staff performance, settings)
alongside the day-to-day POS.

## Stack

- **Backend**: Node.js, Express, MongoDB (Mongoose), Cloudinary for images, JWT auth
- **Frontend**: React + Vite, CSS Modules, Dexie (IndexedDB) for offline storage, PWA via vite-plugin-pwa

## Project layout

```
server/   Express API (multi-tenant, offline-sync endpoints)
client/   React PWA — public marketing site at "/", the product itself under "/app"
```

## 1. Backend setup

```bash
cd server
cp .env.example .env
```

Edit `.env`:
- `MONGO_URI` — your MongoDB Atlas connection string
- `JWT_SECRET` — any long random string
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` — from your Cloudinary dashboard
- `CLIENT_ORIGINS` — the URL(s) your frontend runs on (e.g. `http://localhost:5173`)

Then:

```bash
npm install
npm run dev
```

Health check: `GET http://localhost:5000/api/health`

Sale/stock endpoints use MongoDB transactions — your Atlas cluster (a
replica set) supports this natively. A non-transactional fallback exists
for local standalone Mongo during quick experiments, but Atlas is the
intended target.

## 2. Frontend setup

```bash
cd client
cp .env.example .env
```

Edit `.env`:
- `VITE_API_URL` — your backend URL + `/api`

Then:

```bash
npm install
npm run dev       # http://localhost:5173
```

```bash
npm run build     # outputs to client/dist — deploy as a static site
```

## 3. Routes

- `/` — public marketing/pricing site (browsable whether logged in or not)
- `/terms`, `/privacy` — legal pages (see note below)
- `/login`, `/register` — auth
- `/app` — the product itself (protected): Dashboard, Sell, Products, Stock,
  Customers, Reports, Staff (owner/manager only), Settings

## 4. First use

1. Visit `/register`, create your store (you become `owner`, a 14-day trial starts).
2. Add products under **Products**, bring in opening stock via **Stock → Restock**.
3. Run a sale under **Sell** — try it offline, then reconnect and watch the sync badge clear.
4. **Reports** — sales trend chart (with time-travel: ‹ › to look at any past day/month/year),
   top products, activity trail, and a PDF export, all following the selected period.
5. **Customers** — track running balances for customers buying on credit.
6. **Staff** (owner/manager only) — sales/revenue/items sold per team member.
7. **Settings** — store profile and your own account/password.

## How offline sync works

- Every write is saved instantly to on-device IndexedDB (via Dexie) with a
  `dirty` flag and a client-generated `clientId`.
- A background loop (`client/src/lib/sync.js`) pushes dirty records to
  `POST /api/sync/push` when online, and pulls server changes via
  `GET /api/sync/pull?since=<cursor>`.
- `clientId` makes every push idempotent — retrying a dropped connection
  never creates a duplicate sale or double-counts stock.
- The server resolves a product reference whether it's a real database ID
  or a client-only ID (for a product sold before it finished syncing), so
  a sale never gets permanently stuck as "pending."
- **Logging out wipes this device's local cache.** It now runs a sync
  first and warns you with an explicit confirmation if anything is still
  unsynced (e.g. you're offline) before discarding it — it no longer
  deletes unsynced work silently.
- **Every local read is scoped to the logged-in store.** The on-device
  cache is one shared database per browser, not automatically separated
  per store — so if a device is ever used to log into more than one store
  (testing, or a shared device), every single read function filters by
  the current session's `storeId` before returning anything. Logging into
  a *different* store than whatever was last used on that device also
  clears the local cache first, so stale data from a previous store
  doesn't linger. This closes a real bug that existed earlier: local
  reads had no store filter at all, so a device that had synced more than
  one store showed a mix of both. See the test suite below — it's what
  guards against this specific bug ever coming back.

## Tests

```bash
cd client
npm test
```

`src/lib/__tests__/storeIsolation.test.js` is a regression test for the
cross-store data leak described above: it seeds two stores' worth of data
into a simulated local database and asserts that every single local read
function — products, sales, stock movements, credit payments, suppliers,
purchase orders, reports, backup export — only ever returns the
currently logged-in store's data. If a future change reintroduces an
unscoped read, this fails immediately instead of silently leaking one
store's data into another's.

## What's built

Multi-tenant auth & roles (owner/manager/cashier), product catalog with
photos (drag-and-drop upload, inline category creation), full offline
sync, stock movements with a complete audit trail, POS checkout with
barcode scanning (native browser `BarcodeDetector` where supported, JS
fallback otherwise), per-line price overrides and ad-hoc custom items, a
cash change calculator, printable receipts, a persistent cart draft, sales
history with void/repeat actions, customer credit accounts, CSV export,
browser low-stock notifications, a period-filterable Dashboard and Reports
suite with time-travel navigation, staff performance reporting, PDF report
export, a Settings page (store profile + account), a public marketing/
pricing site, and a 14-day trial clock (informational only — nothing is
gated on it yet).

## What's not built yet

- **Payment collection.** The trial clock is purely informational — no
  plan is enforced or billed. Stripe doesn't support Rwanda-based
  merchants directly; Flutterwave or Paystack are the realistic options
  whenever billing is ready to build.
- **Team management UI.** Inviting/editing teammates has a working
  backend endpoint (`POST /api/auth/invite`) but no screen yet.
- Supplier & purchase-order tracking, a proper Customer model (credit
  accounts currently match by name+phone), multi-currency, finer-grained
  permissions beyond the three built-in roles.

## A note on the legal pages

`/terms` and `/privacy` are real, reasonably thorough starter templates
that accurately describe what this app actually does (Cloudinary for
photos, MongoDB for data, offline local storage, etc.) — but they were
written by Claude, not a lawyer. Have them reviewed before relying on them
for a paying customer base.

## Deployment notes

- **Backend**: any Node host (Railway, Render, Fly.io, a VPS), pointed at
  your Atlas cluster.
- **Frontend**: any static host (Vercel, Netlify, Cloudflare Pages).
- Add your production frontend URL to the backend's `CLIENT_ORIGINS`.
- Barcode scanning requires HTTPS (or `localhost`) — browsers block camera
  access on plain HTTP.
