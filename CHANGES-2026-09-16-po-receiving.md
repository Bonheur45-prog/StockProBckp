# StockPro — Fix session, 2026-09-16 (PO receiving)

## What was asked

Fix "the PO-receiving bug": stock correctly increments when receiving
against a purchase order, but the PO's own `quantityReceived`/status never
updates — traced (by reading code only, not by running it) to a shared
`clientId` between two locally-queued records colliding with itself in the
same push.

## What was actually found (the diagnosis was incomplete)

Writing a real regression test and running it — rather than continuing to
reason from reading the code — immediately surfaced something the earlier
read-only trace missed entirely: **`receivePurchaseOrder()` on the client
threw before it could do anything at all.**

Its `db.transaction("rw", db.products, db.stockMovements, db.purchaseOrders, ...)`
call wrote to `db.poReceipts` inside the callback, but `db.poReceipts` was
never included in that transaction's declared table list. IndexedDB (and
Dexie) transactions can only touch the stores they were opened with — this
throws `NotFoundError` immediately, every time, with no dependency on data
or timing. Confirmed in isolation, independent of any other change in this
session (see `isolate_test.mjs` reasoning in the session — not included in
this archive, reproducible by writing to any undeclared table inside a
Dexie transaction).

Made worse by a second finding: `PurchaseOrders.jsx`'s `handleReceive` had
no `try/catch` around the call at all. So the actual, real-world symptom
was almost certainly: clicking "Confirm receipt" **did nothing visible** —
no error, no success, modal just sat there — because the promise rejected
and nothing was listening for it.

**Net effect: receiving stock against a PO likely never worked at all,
client-side, in any version of this codebase** — not "works but the PO's
own bookkeeping drifts," which was the original, incomplete diagnosis. The
clientId-collision bug (the original ask) is real and was also fixed, but
it was never actually reachable in practice, since the function never got
far enough to hit it.

## What changed

**`client/src/lib/repo.js` — `receivePurchaseOrder()`**
1. Added `db.poReceipts` to the transaction's declared tables. This alone
   is what makes the function able to complete at all.
2. Removed the redundant locally-queued `StockMovement` for the receipt
   (same shape and same fix as the earlier `createSale()` double-decrement
   bug) — it no longer shares a `clientId` with the `poReceipts` entry
   because there's nothing left for it to share one with. A generated id
   is still attached to each receipt line purely as the idempotency key
   sent to the server, so a genuinely *retried* push (network drop after
   the server saved, before the response arrived) still can't double-apply
   stock.

**`server/src/controllers/purchaseOrderController.js`**
- Comment-only: clarified that the idempotency check in
  `performReceivePurchaseOrder` now only guards genuine retries, since the
  same-request collision it used to (incorrectly) also catch no longer
  exists on the client side.

**`client/src/pages/PurchaseOrders/PurchaseOrders.jsx` — `handleReceive`**
- Wrapped in `try/catch`, wired to the same `error` state and banner
  already used by the create-PO form on this page (added the banner to the
  receive modal too, since it didn't render there before). Added a
  `receiving` in-flight state so the button shows "Confirming…" and can't
  be double-submitted. `openReceive` now clears any stale error from a
  previous action when the modal opens.

## Also fixed, this turn: `performCreatePurchaseOrder` had no update path

(Originally flagged below as "found, not fixed" — now fixed.)

`performCreatePurchaseOrder` was idempotent-as-in-return-unchanged, not
idempotent-as-in-update. Any edit to an already-synced PO — most
importantly `updatePurchaseOrderStatus()` (used by "Cancel") — wrote
locally, marked the record dirty, and was then silently dropped on the
next sync push: the existing-clientId branch just returned the current
server document as-is. No error, no retry, no self-correction, since the
server genuinely never received the change.

**The fix, and the risk that had to be avoided:** a naive last-write-wins
update applying everything the client sent — including `items` — would
have reintroduced the exact double-application shape already fixed
above. `receivePurchaseOrder()`'s local optimistic write marks the *same*
`db.purchaseOrders` row dirty, so it rides along in the generic
`purchaseOrders` push category too, right next to the dedicated
`poReceipts` entry. If the update branch also wrote `items` from that
payload, both channels would apply the same receipt.

So the update only ever touches `status`, `notes`, `expectedDate`,
`supplierName` — the exact same editable-field list the (previously
unused-by-sync) direct `PUT /api/purchase-orders/:id` route already used.
Extracted that list into a shared `PO_EDITABLE_FIELDS` constant so the two
paths can't drift apart. `items` is never touched by this branch, under
any circumstance — traced and verified (`verify_po_update.mjs`, included)
that a PO edited and received against in the *same* push cycle still ends
up correct: the edit's fields land first, the receipt's authoritative
recompute of `items`/`status` runs second (push processes `purchaseOrders`
before `poReceipts`) and is what the client ultimately sees — not a
double-applied receipt, not a lost edit.

Verified: `verify_po_update.mjs` — 6 assertions (edit reaches the server,
items untouched by the edit path, a receipt in the same cycle still
applies exactly once, status ends authoritative, a genuine cancel now
reaches the server, a stale update is correctly skipped). `node --check`
on every touched server file, plus the full client suite (32/32,
unaffected — this fix is server-only) and a boot-test. No live-Mongo
verification, same standing gap as everything else this session.

## How this was verified

- New file: `client/src/lib/__tests__/receivePurchaseOrder.test.js` — 6
  tests against the real `fake-indexeddb` harness (stock bumps correctly,
  no redundant local movement, PO's own `quantityReceived`/status update
  locally, flips to `received` at full quantity, unique idempotency key
  per line, can't over-receive past what's ordered).
- Validated by breaking it: ran the tests against the original transaction
  declaration (missing `db.poReceipts`) — all 6 failed with the exact
  `NotFoundError` described above, not a hypothetical. Restored the fix,
  reran — 6/6 pass.
- Full suite: 32/32 (14 storeIsolation + 12 createSale + 6 this file).
- `node --check` + `oxlint` + `npm run build` on every changed file: clean
  (repo.js: 0 warnings; PurchaseOrders.jsx: 0 warnings).
- Boot-tested the server against a dead Mongo URI after the comment
  change: clean, handled failure, no crash.

**Still unverified, same standing gap as every prior fix:** a live sync
round-trip against a real MongoDB. Everything above proves the local write
path no longer throws and behaves correctly in isolation — it doesn't
prove the server round-trip end to end. Please do a real receive-against-a-PO
pass before considering this closed.
