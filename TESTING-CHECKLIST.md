# StockPro — End-to-end testing checklist

Everything below was verified against `fake-indexeddb` and static analysis
only. None of it has run in a real browser against a real server. This is
the actual hands-on pass that closes that gap.

## What you'll need

- Two separate store accounts (**Store A**, **Store B**) — the last
  section can't be tested with one store
- At least one user of each role: owner, manager, cashier
- Browser DevTools open throughout — Network tab (to force offline),
  Application → IndexedDB (to inspect local state directly), Console (to
  run a few one-line commands)
- Direct access to the MongoDB database (Compass or `mongosh`) — several
  of these bugs only show up in what the *server* actually stored, not
  what the UI displays. UI-only checking will miss real regressions here.
- Ideally a second device or a separate browser profile for the
  multi-device tests (a private/incognito window works as a stand-in)

Test roughly in this order — later sections build on things earlier ones
confirm are working.

---

## 1. Sale stock decrement (should happen exactly once)

1. Note a product's `quantityOnHand` in Mongo directly.
2. Sell 2 of it (any role), let it sync.
3. **Check Mongo**: quantity dropped by exactly 2, not 4.
4. **Check Mongo**: exactly one `StockMovement` document exists for this
   sale (`relatedSaleId` set to the sale's `_id`) — not two, not zero.

## 2. Sale price/discount validation

1. As a cashier: open the price-edit control on a cart line — confirm
   it's not there (was hidden last session).
2. As a cashier: enter a discount larger than the cart subtotal — Charge
   button should disable, inline warning shown. Same for a negative
   discount.
3. As owner/manager: override a line's price — should work normally.
4. Enter a discount **exactly equal to** the subtotal — should complete,
   total shows 0.
5. **Bypass the client** (DevTools → disable JS temporarily, or use
   curl/Postman with a real session token) to POST a sale with
   `discount > subtotal` directly to `/api/sync/push` or `/api/sales`.
   **Check**: rejected with a clear message; **check Mongo**: no sale
   document was created.

## 3. Sync push role gate (server-side)

This one specifically needs a tool that can hit the API directly (curl,
Postman, or DevTools with JS re-enabled) — the UI now prevents a cashier
from *attempting* these, so bypassing the UI is the only way to confirm
the server itself still refuses them independently.

1. Get a cashier's auth token.
2. POST a product edit through `/api/sync/push`'s `products` array.
3. **Check**: response includes it in `errors` with a role message;
   **check Mongo**: the product is unchanged.
4. Repeat for a `stockMovements` entry (restock).

## 4. UI-level role gating

1. As a cashier: open **Products** — Add/Import/per-row Edit/Delete
   should all be gone; the page should still show products (read-only).
2. As a cashier: open **Stock** — Adjust/Restock gone, list still visible.
3. As a cashier: confirm **Suppliers** and **Purchase Orders** don't even
   appear in the nav.
4. As owner/manager: confirm all of the above are visible and work
   normally — the point is cashiers are blocked, not that these features
   broke for everyone.

## 5. The dirty-flag / permanently-frozen-product bug

This is the subtle one — it doesn't show any error, it just silently
stops a product from ever updating again.

1. As a cashier: sell one unit of any product.
2. Let it sync.
3. **Check IndexedDB** (Application → IndexedDB → `products` table) for
   that product on the cashier's device: `dirty` should be `0`, not `1`.
4. As owner (any device): rename that same product, or change its price.
   Let it sync.
5. **Back on the cashier's device**, trigger a sync (or wait ~30s) —
   **check**: the new name/price actually arrives. If it never does, the
   product got silently frozen after the cashier's sale — that's this bug
   back.

## 6. PO receiving

1. As owner: create a PO for a product, order quantity 20.
2. Receive 8 against it.
3. **Check**: product stock went up by exactly 8 (not 16).
4. **Check the PO itself** (in the UI and in Mongo): `quantityReceived`
   shows 8, status is `partially_received` — not stuck at 0.
5. **Check IndexedDB** `stockMovements` table right after receiving,
   before the next sync completes: there should be **no** entry for this
   receipt (it was removed from that table on purpose — see the changelog
   if this looks wrong, it's intentional).
6. Receive the remaining 12. **Check**: status flips to `received`.
7. **Cancel a different, already-synced PO.** Refresh the page (or check
   from a second device). **Check**: the cancellation actually reached the
   server — it used to silently never leave the device it was cancelled
   on.

## 7. Stuck-record recovery screen

Generating a genuinely stuck record now that the known client-side causes
are blocked takes a bit more setup — two real options:

**Option A — multi-device stock race (most realistic):**
1. Two devices/browsers, same store, both viewing a product with only 2
   left in stock.
2. Take both offline.
3. Sell the last 2 units from **each** device (so 4 total are "sold"
   against 2 real ones).
4. Bring both online. One sale syncs fine; the other gets rejected
   ("Not enough stock").

**Option B — direct manipulation (faster, less realistic):**
1. DevTools → Application → IndexedDB → manually add a `products` row
   with `dirty: 1` and a nonsense field the server will reject, or edit
   an existing dirty record to something invalid.
2. Trigger a sync, confirm it gets rejected and `syncError` gets written
   onto that record.

Then, for whichever stuck record you produced:

3. **Reload the page.** Check the badge shows red ("N couldn't sync")
   **immediately** on load — not amber, not requiring another 30 seconds.
   This is specifically re-testing the bug you found last time.
4. Click the badge → confirm it opens `/app/sync-issues` directly.
5. For the stuck **sale** from Option A: click **Edit & Retry** — cart
   should reopen prefilled with the original items/discount/payment
   method. Adjust the over-sold line down to what's actually available,
   check out. **Check**: succeeds, and the old stuck entry is gone from
   the list afterward.
6. For any stuck record: click **Discard** — confirm it disappears from
   the list. For a product/supplier/PO-type record, confirm the local
   values correct themselves shortly after (via the next pull).

## 8. Tenant-switch data leak (the most involved — needs two stores)

**8a. The core scenario — 401 then switching stores:**
1. Log in as **Store A** owner. Go offline. Add a product (so there's
   real unsynced data sitting locally).
2. In the console, run exactly what a 401 would do:
   `localStorage.removeItem('token'); localStorage.removeItem('user');`
3. Without reloading, log in as **Store B** (a different account).
4. **Check IndexedDB**: the `products` table should now contain **only**
   Store B's data — Store A's offline product should be gone, not mixed
   in.
5. **Check**: `localStorage.getItem('lastStoreId')` reflects Store B's id.

**8b. Same-store re-auth should NOT wipe local drafts:**
1. Log in as Store A. Go offline, start a cart / make an edit, don't
   sync.
2. Simulate a token expiry the same way (`removeItem('token')`,
   `removeItem('user')`), then log back in as the **same** Store A
   account.
3. **Check**: your unsynced draft/edit is still there — this shouldn't
   have been wiped, since it's the same store.

**8c. The in-flight race — harder to force on demand, treat as a smoke
test rather than a guaranteed repro:**
1. Go offline, make several changes so there's a real backlog to push.
2. Come back online (triggers the automatic sync).
3. Within roughly a second, log out and log into a **different** store.
4. **Check Store B's data afterward**: nothing from Store A should have
   leaked in. This one is timing-sensitive and may not reproduce every
   attempt — the automated test suite is the primary evidence for this
   specific guard; this is a best-effort real-world sanity check on top
   of it.

**8d. Recovery screen respects the switch too:**
1. With both stores having at least one stuck record each (from section
   7), log in as Store A. **Check**: Sync Issues only shows Store A's
   stuck record. Switch to Store B. **Check**: only Store B's shows —
   never both, never the wrong one.

---

## If something fails

Note exactly which numbered step, what you expected vs. what happened,
and whether you checked the UI, IndexedDB, or Mongo directly for that
step — that's the fastest path back to a fix.
