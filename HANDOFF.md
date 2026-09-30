# StockPro — Project Handoff

**Purpose of this document:** this is a state snapshot meant to be handed to a *new* Claude
chat (inside the same Project) so it can pick up work without re-reading a very long prior
conversation. Paste/attach this alongside the current project zip when starting the new chat.

**Who this is for:** Bonheur, building StockPro as a sellable multi-tenant SaaS for hardware
stores in Rwanda (Kigali-focused).

---

## 1. What StockPro is

A multi-tenant, offline-first point-of-sale and inventory management platform for hardware
stores. Store owners sign up, get a 14-day trial (informational only right now — see §4), and
run their shop from a phone/tablet/desktop, online or off, with everything syncing once back
online.

**Stack:**
- Backend: Node.js, Express, MongoDB (Mongoose), Cloudinary (product/logo images), JWT auth
- Frontend: React + Vite, CSS Modules (no Tailwind), Dexie (IndexedDB) for offline storage,
  PWA via `vite-plugin-pwa` (installable — this is already built, not a gap)
- Tests: Vitest + `fake-indexeddb`, one suite so far (`client/npm test`)

**Repo layout:**
```
server/   Express API
client/   React PWA — public marketing site at "/", the product itself under "/app"
```

**Routing:** `/` is a public marketing/pricing landing page (browsable logged in or out).
`/login`, `/register`, `/terms`, `/privacy` are public. Everything else lives under `/app/*`
(`/app`, `/app/pos`, `/app/products`, `/app/stock`, `/app/customers`, `/app/suppliers`,
`/app/purchase-orders`, `/app/reports`, `/app/staff`, `/app/settings`), protected, inside the
`Layout` shell (sidebar nav, filtered per role).

**Roles:** `owner`, `manager`, `cashier`. **Owner and manager currently have identical
permissions** — this was a deliberate simplification, never revisited. Worth a decision.

---

## 2. Core architecture patterns (know these before touching anything)

### Offline-first sync
- Every write goes to local Dexie/IndexedDB first (`clientId`-keyed, `dirty: 1` flag), then a
  background loop (`client/src/lib/sync.js`) pushes dirty records to `POST /api/sync/push` and
  pulls server changes via `GET /api/sync/pull?since=<cursor>`.
- `clientId` (a client-generated UUID) makes every push idempotent.
- **A record created offline may reference another not-yet-synced record by its local
  `clientId` instead of a real Mongo `_id`.** The server has a helper for this —
  `server/src/utils/productRef.js`'s `resolveProductRefs(storeId, refs)` — which accepts
  *either* form for product references. **This pattern is not applied consistently — see Bug
  #3 and #4 in §3, both regressions of this exact class.**

### Multi-tenancy — read this before writing any new local read function
**A serious bug was found and fixed this cycle:** every local (Dexie) read function used to
return data with zero `storeId` filtering. Since the local IndexedDB cache is one shared
database per browser (not auto-scoped per store), a device that had ever synced more than one
store's data (e.g. testing multiple stores) showed a *mix* of stores' products/sales/customers
to whoever was logged in. The server was always correctly scoped — this was purely a client-
side read bug.

**The fix (already shipped):** every function in `client/src/lib/repo.js` filters by
`currentStoreId()` (a helper reading the logged-in user's `storeId` from localStorage) before
returning anything. Login/registration also clears the local cache when switching to a
*different* store than whatever was last used on that device.

**The guardrail (already shipped):** `client/src/lib/__tests__/storeIsolation.test.js` — seeds
two fake stores' worth of data into a simulated local DB and asserts every read function stays
scoped. Run with `cd client && npm test`. **Any new local read function added to `repo.js` must
filter by `currentStoreId()` — this test will fail if you forget.** This was proven to work: it
was deliberately broken and confirmed to fail before being restored.

### Shared create/action functions (reused by direct route + sync push)
Several mutations exist in a `performX(...)` form so the direct REST route and the sync-push
handler share identical logic instead of duplicating it (and risking the two drifting apart):
`performSaleCreation`, `performRecordPayment`, `performCreatePurchaseOrder`,
`performReceivePurchaseOrder`. **When fixing Bug #1 (see §3), the fix belongs inside these
shared functions or in `syncController.js`'s push handler — not just on the REST routes** —
otherwise the sync-push bypass remains open even after "fixing" the direct routes.

### Logout / login data safety
- Logout attempts a sync first, and if anything is still unsynced, shows an explicit
  confirmation before discarding it (`Layout.jsx`'s `handleLogout`) — it used to silently
  delete unsynced work, this was a real bug, now fixed.
- Login/registration clears the local cache if switching stores (see multi-tenancy note above).

---

## 3. Confirmed, unfixed bugs

Found by an external audit, independently verified line-by-line against the actual source this
cycle — every single one below was personally confirmed true, not just trusted from the report.
Ordered by severity. **None of these are fixed yet.** Suggested next chat should probably start
here, at minimum #1 and #2 together (see rationale below).

| # | Severity | Area | Bug |
|---|----------|------|-----|
| 1 | Critical | Sync / Auth | `POST /api/sync/push` (`server/src/routes/syncRoutes.js`) has only `protect`, no role check — and none of the functions it calls (`applyStockMovement`, `performCreatePurchaseOrder`, product/supplier creation in `syncController.js`) check `req.user.role` internally either. A cashier's token can push product price/cost/category changes, supplier changes, PO changes, and stock adjustments with zero restriction, completely bypassing the `requireRole("owner","manager")` gates that exist on the equivalent direct REST routes. |
| 2 | Critical | POS / Pricing | `performSaleCreation` (`server/src/controllers/saleController.js`) accepts any client-supplied `unitPrice` verbatim, no validation against catalog price. `total = Math.max(0, subtotal - discount)` means a discount larger than the subtotal is silently accepted (floors at 0) instead of rejected — stock still decrements in full. Client-side, `POS.jsx`'s price-edit control (`editPriceBtn`) has no role gate at all (contrast with `canVoid`, which does gate voiding by role). |
| 3 | High | Purchase Orders / Offline sync | If a product, its PO, and a receipt against that PO are all created fully offline before ever syncing, receiving permanently fails. Root cause: `performReceivePurchaseOrder` (`purchaseOrderController.js`) matches a receipt to a PO line item via raw string equality (`i.productId.toString() === receipt.productId`) instead of the either-ObjectId-or-clientId resolution (`resolveProductRefs`) used everywhere else. By the time the receipt is processed in a sync push, the PO's own item has already been re-resolved to the real product ID, but the queued receipt still references the old local UUID — permanent mismatch, retries forever (confirmed: `sync.js`'s `pushDirty` keeps a failed item `dirty: 1` and `initSyncLoop` retries every 30s). Fix should resolve `receipt.productId` through `resolveProductRefs` before comparing, not just compare raw strings. |
| 4 | High | Offline staleness | `resolveProductRefs` (`server/src/utils/productRef.js`) — used by every sale and every stock movement, online and offline — has no `isDeleted` filter, unlike `listProducts`/`getProduct` (confirmed they do filter it). A device with a stale cache can still sell/restock a product that was deleted elsewhere; it silently keeps mutating `quantityOnHand` on a product nobody can see or manage anymore. |
| 5 | Medium | Credit ledger | `customerKey(name, phone)` (exists in both `creditController.js` and `repo.js`) does `phone.trim()` only — no normalization. `0788...` vs `+250788...` vs spaces/dashes splits one real customer into two separate ledger entries. |
| 6 | Medium | Multi-device sync | Product/supplier conflict resolution in `syncController.js`'s push handler compares a client-supplied `updatedAt` (from the device's local clock) against the server's own timestamp to decide last-write-wins. A device with a wrong clock can silently overwrite a genuinely newer edit with no warning. |
| 7 | Medium | Auth | `inviteTeammate` (`authController.js`) has no try/catch around `User.create()` — a duplicate email at the same store throws a raw MongoDB `E11000` error straight to the client via the generic error handler (which just forwards `err.message`). |
| 8 | Low (latent) | Reporting API | `/api/reports/dashboard` and `/api/reports/sales-over-time` compute "today"/day boundaries using the server's timezone (`new Date()`, almost certainly UTC in any real deployment), not Kigali (UTC+2) — off by 2 hours. Confirmed currently harmless: grepped the entire frontend, these endpoints are never called (the shipped app computes reports from local device data instead, which naturally uses the device's own timezone). Still a landmine for any future admin panel or third-party integration. |
| 9 | Low (latent) | Products API | `GET /api/products?lowStock=true` (`productController.js`) paginates (`skip`/`limit`) before applying the low-stock filter (which happens in-memory afterward, only on the already-limited page). Page 2+ can silently miss real low-stock products. Confirmed unreachable by the shipped UI (same reason as #8 — Products page uses local data, not this endpoint). |
| 10 | Low | Store signup | Classic check-then-create race: `while (await Store.exists({slug})) {...}` then `Store.create(...)` — two simultaneous registrations with the identical store name could both pass the check and collide on create, surfacing a raw duplicate-key error. Confirmed extremely rare in practice. |

**One thing confirmed correct, not a bug:** `quantityOnHand` is deliberately and correctly
excluded from the product last-write-wins merge field list in `syncController.js` — stock
quantity only ever changes through the movement/sale/restock/receive pathways, never via a
direct product-edit sync. This is good design, verified intact.

**Suggested fix order** (from the original audit, endorsed): 1) role-check inside
`syncController.push` (fixes #1, and is the natural place to also enforce "price override
requires manager/owner" from #2 in the same pass) 2) server-side discount/price guard
3) fix PO receipt matching to use `resolveProductRefs` 4) add `isDeleted: false` to
`resolveProductRefs` + a clear client error ("this product was removed — sync to refresh")
5) normalize phone numbers in `customerKey` on both client and server 6) the rest,
opportunistically.

---

## 4. Deliberate gaps (not bugs — features not built yet, by explicit prior agreement)

- **No billing / payment collection.** Trial clock (`Store.trialEndsAt`) is informational only
  — nothing is gated or blocked. Explicitly deferred until a payment provider is chosen.
  Decision made: starting from scratch, no existing merchant account. Stripe does not support
  Rwanda-based merchants directly — realistic options are Flutterwave or Paystack (both
  support RW + mobile money). Not yet chosen.
- **No account/password recovery flow.** Only `updateMe` (requires knowing current password)
  and owner-invited teammates exist. An owner who forgets their password has no self-service
  recovery path.
- **No backup *restore* flow.** `exportFullBackup()` exists (Settings → Data & Backup) and
  produces a full JSON export, but there's no "restore this JSON onto a new/replacement device"
  path yet.
- **No Team management UI.** `POST /api/auth/invite` has existed a long time and works, but
  there's no screen for it — inviting/viewing/editing teammates currently requires either a
  future UI or manual database editing (which is literally how the multi-tenancy bug in §2 was
  discovered — testing via manual Atlas edits).
- **Credit customers are matched by name+phone, not a real Customer record** — related to Bug
  #5; a proper `Customer` model would fix the matching bug and the UX gap at once.
- **Single-store-per-owner.** Data model is `Store → User.storeId`, one store per user account.
  Multi-location for one owner would be a real migration, not a small patch, if wanted later.
- **No i18n.** Everything is hardcoded English. Flagged as possibly the single highest-leverage
  polish item for the actual target market (Kinyarwanda/French), ahead of most visual polish.

---

## 5. Feature ideas discussed, not built (roughly priority order as last assessed)

1. **Kinyarwanda / French language toggle** — likely highest-leverage item on this whole list.
2. **A real `Customer` model** — fixes Bug #5 and the UX gap simultaneously.
3. **Mobile Money reconciliation field** — `paymentMethod: "mobile_money"` exists but there's
   no transaction-reference/confirmation-code field, which is how Kigali shop owners actually
   reconcile MoMo/Airtel Money payments against their SMS confirmations.
4. **WhatsApp/SMS receipts and debt reminders** — `customerPhone` already exists on every sale;
   a `wa.me` deep link for receipts, and a "send reminder" action off the existing
   `listCustomerBalances()` data, are both short builds with real value for credit-heavy shops.
5. **Low-stock digest via SMS/WhatsApp**, not just in-app — an owner who isn't looking at the
   app won't see the in-app badge.
6. **Multi-store for one owner** — worth deciding scope before it becomes a bigger migration.
7. **First-run empty states** for Products/Sales/Reports on a brand-new store.
8. **Receipt polish** — currently `window.print()` of an HTML block; thermal-printer widths
   (58mm/80mm) and a downloadable-PDF option (the `pdfReport.js` pipeline already exists and
   could plausibly be reused/adapted) would look more "point of sale."
9. **Mobile sync-error visibility gap** — the sync badge's error detail currently only shows in
   a hover tooltip (`title` attribute), which doesn't work on touch devices. A cashier on a
   phone can't see why something failed to sync. Worth a tap-to-expand instead of hover-only.
10. **Owner cross-device visibility control** — any cashier's `/sync/pull` currently returns the
    entire store's sales/credit/stock history in one shot. Probably fine for a small shop,
    worth a deliberate decision rather than a silent default as the product scales.

---

## 6. How to resume in a new chat

1. Attach/upload: the current project zip, this document, and (optionally) the original audit
   doc (`Summary_table.docx`) if more detail than §3's summary is ever needed.
2. Tell the new chat which of §3/§4/§5 to start on. Last recommendation was Bug #1 and #2
   together, since fixing #1 (role-checking inside the sync push path) is the natural place to
   also enforce the price-override permission from #2's fix.
3. Whoever picks this up should re-run `cd client && npm test` immediately after any change to
   `repo.js` — the store-isolation suite is cheap insurance against reintroducing that bug
   class, and should stay green.
4. General working pattern this project has used successfully: build → `npm run build` (both
   client and server where relevant) → `npx oxlint src` (client) → boot-test the server against
   a dummy Mongo URI to catch import/wiring errors → package `hardware-saas.zip` excluding
   `node_modules`/`dist`/`.env` → do one fresh-extraction install+build to prove the zip itself
   works, not just the working copy.
