import { db, getMeta, setMeta } from "./db.js";
import { api } from "./api.js";

let syncing = false;
const listeners = new Set();
let lastErrors = [];

/** Table for each sync category name, as used in push/pull error types. */
const TABLES = {
  product: db.products,
  sale: db.sales,
  stockMovement: db.stockMovements,
  creditPayment: db.creditPayments,
  supplier: db.suppliers,
  purchaseOrder: db.purchaseOrders,
  poReceipt: db.poReceipts,
  expense: db.expenses,
  priceHistory: db.priceHistory,
};

/**
 * The store this device is currently authenticated as, read fresh each
 * call (never cached) — used only to detect whether the active session
 * changed while a push/pull was in flight. A tiny local duplicate of
 * repo.js's own currentStoreId() rather than an import from it, since
 * repo.js imports runSync/discardStuckRecord from this file — importing
 * the other way would create a circular dependency between the two.
 */
function currentAuthedStoreId() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null")?.storeId ?? null;
  } catch {
    return null;
  }
}

/** Only owner/manager are sent finance data (expenses, price history) — see syncController.pull. */
function currentAuthedRoleCanSeeFinance() {
  try {
    const role = JSON.parse(localStorage.getItem("user") || "null")?.role;
    return role === "owner" || role === "manager";
  } catch {
    return false;
  }
}

export function onSyncStatusChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLastSyncErrors() {
  return lastErrors;
}

function notify(status) {
  for (const fn of listeners) fn(status);
}

/** Strips Dexie-only bookkeeping fields before sending a record to the server. */
function toServerPayload(record) {
  const { dirty, id, ...rest } = record;
  return rest;
}

/**
 * Pushes every locally dirty record to the server, then pulls everything
 * changed since our last successful pull. Safe to call repeatedly and
 * safe to call while offline (it just no-ops on failure and stays dirty
 * for next time).
 */
export async function runSync() {
  if (syncing) return { skipped: true };
  if (!navigator.onLine) return { skipped: true, reason: "offline" };
  if (!localStorage.getItem("token")) return { skipped: true, reason: "unauthenticated" };

  syncing = true;
  notify("syncing");

  try {
    await pushDirty();
    await pullChanges();
    notify(lastErrors.length ? "partial" : "idle");
    return { ok: true, errors: lastErrors };
  } catch (err) {
    console.error("[sync] failed:", err.message);
    notify("error");
    return { ok: false, error: err.message };
  } finally {
    syncing = false;
  }
}

async function pushDirty() {
  // Captured up front so the guard below has something to compare
  // against — see its comment at the reconcile step for why this matters.
  const startingStoreId = currentAuthedStoreId();

  const [
    dirtyProducts, dirtySales, dirtyMovements, dirtyPayments, dirtySuppliers, dirtyPOs, dirtyReceipts,
    dirtyExpenses, dirtyHistory,
  ] = await Promise.all([
    db.products.where("dirty").equals(1).toArray(),
    db.sales.where("dirty").equals(1).toArray(),
    db.stockMovements.where("dirty").equals(1).toArray(),
    db.creditPayments.where("dirty").equals(1).toArray(),
    db.suppliers.where("dirty").equals(1).toArray(),
    db.purchaseOrders.where("dirty").equals(1).toArray(),
    db.poReceipts.where("dirty").equals(1).toArray(),
    db.expenses.where("dirty").equals(1).toArray(),
    db.priceHistory.where("dirty").equals(1).toArray(),
  ]);

  const nothingToPush =
    !dirtyProducts.length && !dirtySales.length && !dirtyMovements.length && !dirtyPayments.length &&
    !dirtySuppliers.length && !dirtyPOs.length && !dirtyReceipts.length &&
    !dirtyExpenses.length && !dirtyHistory.length;
  if (nothingToPush) return;

  const { data } = await api.post("/sync/push", {
    products: dirtyProducts.map(toServerPayload),
    sales: dirtySales.map(toServerPayload),
    stockMovements: dirtyMovements.map(toServerPayload),
    creditPayments: dirtyPayments.map(toServerPayload),
    suppliers: dirtySuppliers.map(toServerPayload),
    purchaseOrders: dirtyPOs.map(toServerPayload),
    poReceipts: dirtyReceipts.map(toServerPayload),
    expenses: dirtyExpenses.map(toServerPayload),
    priceHistory: dirtyHistory.map(toServerPayload),
  });

  // Reconcile: server response gives us the canonical doc for everything
  // it accepted (including its Mongo _id). Anything in data.errors stays
  // dirty so we retry it on the next sync pass.
  const failedIds = (type) => new Set(data.errors.filter((e) => e.type === type).map((e) => e.clientId));
  const failedProductIds = failedIds("product");
  const failedSaleIds = failedIds("sale");
  const failedMovementIds = failedIds("stockMovement");
  const failedPaymentIds = failedIds("creditPayment");
  const failedSupplierIds = failedIds("supplier");
  const failedPOIds = failedIds("purchaseOrder");
  const failedReceiptIds = failedIds("poReceipt");
  const failedExpenseIds = failedIds("expense");
  const failedHistoryIds = failedIds("priceHistory");

  // The active session can change while this request was in flight —
  // initSyncLoop's 30s background sync runs regardless of auth state, and
  // nothing coordinates it with a login/logout/store-switch that happens
  // to land in the middle of one. If that happened, everything just read
  // and sent above belongs to whatever store was active when this
  // function STARTED, not whatever's active now — writing the server's
  // response back at this point would reconcile the wrong store's data
  // into the (possibly already-cleared, possibly a different store's)
  // local cache. The new session's own runSync() call (already triggered
  // by its own login) pushes and pulls its own correct data separately,
  // so it's safe to just walk away from this one rather than try to
  // partially salvage it.
  if (currentAuthedStoreId() !== startingStoreId) return;

  await db.transaction(
    "rw",
    db.products, db.sales, db.stockMovements, db.creditPayments, db.suppliers, db.purchaseOrders, db.poReceipts,
    db.expenses, db.priceHistory,
    async () => {
      for (const p of data.products) {
        if (failedProductIds.has(p.clientId)) continue;
        await db.products.put({ ...p, id: p._id, dirty: 0 });
      }
      for (const s of data.sales) {
        if (failedSaleIds.has(s.clientId)) continue;
        await db.sales.put({ ...s, id: s._id, dirty: 0 });
      }
      for (const m of data.stockMovements) {
        if (failedMovementIds.has(m.clientId)) continue;
        await db.stockMovements.put({ ...m, id: m._id, dirty: 0 });
      }
      for (const c of data.creditPayments || []) {
        if (failedPaymentIds.has(c.clientId)) continue;
        await db.creditPayments.put({ ...c, id: c._id, dirty: 0 });
      }
      for (const s of data.suppliers || []) {
        if (failedSupplierIds.has(s.clientId)) continue;
        await db.suppliers.put({ ...s, id: s._id, dirty: 0 });
      }
      for (const po of data.purchaseOrders || []) {
        if (failedPOIds.has(po.clientId)) continue;
        await db.purchaseOrders.put({ ...po, id: po._id, dirty: 0 });
      }
      for (const e of data.expenses || []) {
        if (failedExpenseIds.has(e.clientId)) continue;
        await db.expenses.put({ ...e, id: e._id, dirty: 0 });
      }
      for (const h of data.priceHistory || []) {
        if (failedHistoryIds.has(h.clientId)) continue;
        await db.priceHistory.put({ ...h, id: h._id, dirty: 0 });
      }
      for (const r of data.poReceipts || []) {
        if (failedReceiptIds.has(r.clientId)) continue;
        // The receipt itself isn't kept as a standing record — just clear
        // it from the outbox. The PO it affected will refresh moments
        // later via the pull that follows this push in the same runSync().
        await db.poReceipts.delete(r.clientId);
      }

      // Mark every rejected item's actual record with the error, so it's
      // queryable at any time (including after a page reload, when
      // lastErrors below would already be gone) — this is what the
      // "N couldn't sync" recovery screen reads from. The record stays
      // dirty (it still needs resolving); only the transient in-memory
      // status below is separate from this durable marker.
      for (const err of data.errors) {
        const table = TABLES[err.type];
        if (!table) continue;
        const local = await table.get(err.clientId);
        if (local) await table.put({ ...local, syncError: err.message });
      }
    }
  );

  if (data.errors.length) {
    console.warn("[sync] some records were rejected by the server:", data.errors);
    lastErrors = data.errors;
  } else {
    lastErrors = [];
  }
}

async function pullChanges() {
  const startingStoreId = currentAuthedStoreId();
  const since = await getMeta("lastPulledAt", null);
  // Finance data has its own cursor (see syncController.pull for why). Only
  // sent for roles the server will actually answer for; a device that has
  // never received finance data omits it and gets everything.
  const financeSince = currentAuthedRoleCanSeeFinance() ? await getMeta("financePulledAt", null) : null;
  const params = {};
  if (since) params.since = since;
  if (financeSince) params.financeSince = financeSince;
  const { data } = await api.get("/sync/pull", { params });

  // Same guard and same reasoning as pushDirty() above — the response we
  // just got back was requested under whatever store was active when this
  // function started, and could now be stale (or worse, belong to a
  // DIFFERENT store) if a switch happened mid-request.
  if (currentAuthedStoreId() !== startingStoreId) return;

  await db.transaction(
    "rw",
    db.products, db.sales, db.stockMovements, db.creditPayments, db.suppliers, db.purchaseOrders,
    db.expenses, db.priceHistory,
    async () => {
      for (const p of data.products) {
        // Don't clobber a record we have local unsynced edits for.
        const local = p.clientId ? await db.products.get(p.clientId) : null;
        if (local?.dirty) continue;
        await db.products.put({ ...p, clientId: p.clientId || p._id, id: p._id, dirty: 0 });
      }
      for (const s of data.sales) {
        const local = s.clientId ? await db.sales.get(s.clientId) : null;
        if (local?.dirty) continue;
        await db.sales.put({ ...s, clientId: s.clientId || s._id, id: s._id, dirty: 0 });
      }
      for (const m of data.stockMovements) {
        const local = m.clientId ? await db.stockMovements.get(m.clientId) : null;
        if (local?.dirty) continue;
        await db.stockMovements.put({ ...m, clientId: m.clientId || m._id, id: m._id, dirty: 0 });
      }
      for (const c of data.creditPayments || []) {
        const local = c.clientId ? await db.creditPayments.get(c.clientId) : null;
        if (local?.dirty) continue;
        await db.creditPayments.put({ ...c, clientId: c.clientId || c._id, id: c._id, dirty: 0 });
      }
      for (const s of data.suppliers || []) {
        const local = s.clientId ? await db.suppliers.get(s.clientId) : null;
        if (local?.dirty) continue;
        await db.suppliers.put({ ...s, clientId: s.clientId || s._id, id: s._id, dirty: 0 });
      }
      for (const po of data.purchaseOrders || []) {
        const local = po.clientId ? await db.purchaseOrders.get(po.clientId) : null;
        if (local?.dirty) continue;
        await db.purchaseOrders.put({ ...po, clientId: po.clientId || po._id, id: po._id, dirty: 0 });
      }
      for (const e of data.expenses || []) {
        const local = e.clientId ? await db.expenses.get(e.clientId) : null;
        if (local?.dirty) continue;
        await db.expenses.put({ ...e, clientId: e.clientId || e._id, id: e._id, dirty: 0 });
      }
      for (const h of data.priceHistory || []) {
        const local = h.clientId ? await db.priceHistory.get(h.clientId) : null;
        if (local?.dirty) continue;
        await db.priceHistory.put({ ...h, clientId: h.clientId || h._id, id: h._id, dirty: 0 });
      }
    }
  );

  await setMeta("lastPulledAt", data.serverTime);
  // Advance the finance cursor only if the server actually included finance
  // data in this response — otherwise a later promotion would skip history.
  if (data.financeIncluded) await setMeta("financePulledAt", data.serverTime);
}

/** Call once at app startup: syncs on load, on reconnect, and every 30s while online. */
export function initSyncLoop() {
  runSync();
  window.addEventListener("online", runSync);
  const interval = setInterval(() => {
    if (navigator.onLine) runSync();
  }, 30000);
  return () => {
    window.removeEventListener("online", runSync);
    clearInterval(interval);
  };
}

export async function pendingChangeCount() {
  const storeId = currentAuthedStoreId();
  const [p, s, m, c, sup, po, r, ex, ph] = await Promise.all([
    db.products.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.sales.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.stockMovements.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.creditPayments.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.suppliers.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.purchaseOrders.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.poReceipts.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.expenses.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
    db.priceHistory.where("dirty").equals(1).and((x) => x.storeId === storeId).count(),
  ]);
  return p + s + m + c + sup + po + r + ex + ph;
}

/**
 * Every syncable record still dirty with a syncError attached — the
 * server has rejected it, so the normal 30s retry loop will keep failing
 * it forever until someone resolves it. Powers the "N couldn't sync"
 * recovery screen.
 *
 * Filtered by storeId explicitly, not left to the assumption that the
 * local cache only ever holds one store's data — that assumption is
 * exactly what the tenant-switch bug this file was fixed alongside could
 * violate. Every local read in this codebase is expected to filter by
 * storeId for this reason (see repo.js's currentStoreId() comment); this
 * one didn't, until now.
 */
export async function listStuckRecords() {
  const storeId = currentAuthedStoreId();
  const out = [];
  for (const [type, table] of Object.entries(TABLES)) {
    const rows = await table.where("dirty").equals(1).and((r) => r.storeId === storeId).toArray();
    // `type` is the SYNC type ("stockMovement"…), and must win: stock movements have their own
    // `type` field ("restock"/"adjustment") which used to overwrite it, so a stuck restock
    // showed a raw label and could not be discarded ("Unknown record type: restock").
    // The record's own value stays available as `recordType`.
    for (const r of rows) if (r.syncError) out.push({ ...r, recordType: r.type, type });
  }
  return out.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

/**
 * Resolves a permanently-stuck record. It never reached the server — no
 * one else has seen it — so this is a purely local action: intentionally
 * no role check, unlike void (which reverses something the server, and
 * possibly other devices, already treat as real).
 *
 * If the record was never synced before (no server `id`), it's deleted
 * outright — there's nothing server-side to fall back to, and every
 * table's queued-but-rejected records are always in this state in
 * practice (a sale, a stock movement, a PO receipt — none of these have
 * an update-after-first-sync concept). If it WAS synced before and this
 * is a rejected edit on top of that (a role-blocked product/supplier/PO
 * update), it's left in place but cleared of dirty/syncError, and a sync
 * is triggered immediately — the next pull restores the server's true
 * values through the exact reconciliation path that already runs on
 * every successful sync, rather than this function computing a rollback
 * by hand.
 */
export async function discardStuckRecord(type, clientId) {
  const table = TABLES[type];
  if (!table) throw new Error(`Unknown record type: ${type}`);
  const record = await table.get(clientId);
  if (!record) return;
  // Belt-and-suspenders alongside listStuckRecords' own filtering above:
  // the recovery screen polls every 5s, so there's a narrow window where
  // it could still be holding a stale entry from just before a store
  // switch. Refuse rather than act on a record that isn't the current
  // session's to touch.
  if (record.storeId !== currentAuthedStoreId()) return;

  if (record.id) {
    await table.put({ ...record, dirty: 0, syncError: undefined });
  } else {
    await table.delete(clientId);
  }
  runSync();
}