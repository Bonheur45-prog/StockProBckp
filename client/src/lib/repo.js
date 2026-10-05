import { db } from "./db.js";
import { uuid } from "./uuid.js";
import { runSync } from "./sync.js";
import { api } from "./api.js";

function currentUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

/**
 * The store's own configurable settings (currency, name, and the
 * low-stock threshold default used below) — persisted the same way as
 * currentUser(), and subject to the same caveat: this is a snapshot from
 * whenever it was last synced down, not guaranteed fresh to the second.
 */
function currentStore() {
  const raw = localStorage.getItem("store");
  return raw ? JSON.parse(raw) : null;
}

/**
 * A product's own lowStockThreshold overrides the store's default when
 * set; falls back to the store's lowStockThresholdDefault, and only
 * falls back further to a hardcoded 5 if the store itself doesn't have
 * one configured (shouldn't normally happen — every store has this field
 * — but keeps this function safe to call even against stale/incomplete
 * local data). Exported so page components can reuse the exact same
 * logic rather than each re-deriving their own version of this chain
 * (which is exactly how the original bug happened — ~10 call sites each
 * independently hardcoded `?? 5`, never reading the store's own setting).
 * Components that already have `store` from useAuth() should pass it
 * explicitly rather than relying on the default, since that's the live,
 * already-in-scope value — the default (re-reading localStorage) exists
 * for repo.js's own internal callers, which aren't React components.
 */
export function effectiveLowStockThreshold(product, store = currentStore()) {
  return product.lowStockThreshold ?? store?.lowStockThresholdDefault ?? 5;
}

/**
 * Every local read in this file MUST filter by this. The local IndexedDB
 * cache is one shared database per browser/device — it is NOT automatically
 * scoped per store. Nothing stops it from holding more than one store's
 * data at once (e.g. testing multiple stores on one device, or a session
 * transition that didn't fully clear first) — the only thing standing
 * between that and showing one store's inventory/sales/customers to a
 * different store is this filter being applied on every single query.
 */
function currentStoreId() {
  return currentUser()?.storeId;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- Products ----------

export async function listProducts({ search, category, lowStockOnly, activeOnly } = {}) {
  const storeId = currentStoreId();
  let items = await db.products.filter((p) => !p.isDeleted && p.storeId === storeId).toArray();
  if (activeOnly) items = items.filter((p) => p.isActive !== false);
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q));
  }
  if (category) items = items.filter((p) => p.category === category);
  if (lowStockOnly) items = items.filter((p) => p.quantityOnHand <= effectiveLowStockThreshold(p));
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getProduct(clientId) {
  const product = await db.products.get(clientId);
  if (!product || product.storeId !== currentStoreId()) return undefined;
  return product;
}

/** Exact barcode match against the local catalog — used by every scan touchpoint. */
export async function findProductByBarcode(code, { activeOnly } = {}) {
  if (!code) return null;
  const storeId = currentStoreId();
  const trimmed = code.trim().toLowerCase();
  const items = await db.products
    .filter((p) => !p.isDeleted && p.storeId === storeId && p.barcode && p.barcode.trim().toLowerCase() === trimmed)
    .toArray();
  const match = items[0] || null;
  if (match && activeOnly && match.isActive === false) return null;
  return match;
}

/** Distinct categories currently in use, for the category picker. */
export async function listCategories() {
  const storeId = currentStoreId();
  const items = await db.products.filter((p) => !p.isDeleted && p.storeId === storeId).toArray();
  const set = new Set(items.map((p) => p.category).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Two products in the same store may never share a barcode/QR value or a
 * SKU. Checked locally (offline-capable, immediate) in addition to the
 * server-side check that runs again on sync — see productCodes.js on the
 * server for the same rule. excludeClientId lets an update check against
 * every *other* product without flagging itself as a duplicate. */
async function assertNoDuplicateCodesLocally(storeId, { barcode, sku }, excludeClientId) {
  const items = await db.products.filter((p) => !p.isDeleted && p.storeId === storeId && p.clientId !== excludeClientId).toArray();
  if (barcode) {
    const dupe = items.find((p) => p.barcode === barcode);
    if (dupe) throw new Error(`Barcode already used by "${dupe.name}"`);
  }
  if (sku) {
    const dupe = items.find((p) => p.sku === sku);
    if (dupe) throw new Error(`SKU already used by "${dupe.name}"`);
  }
}

export async function createProduct(input) {
  const user = currentUser();
  await assertNoDuplicateCodesLocally(user.storeId, { barcode: input.barcode, sku: input.sku }, null);
  const record = {
    clientId: uuid(),
    storeId: user.storeId,
    name: input.name,
    sku: input.sku || "",
    barcode: input.barcode || "",
    category: input.category || "",
    unit: input.unit || "pcs",
    costPrice: Number(input.costPrice) || 0,
    sellPrice: Number(input.sellPrice) || 0,
    quantityOnHand: Number(input.quantityOnHand) || 0,
    lowStockThreshold: input.lowStockThreshold !== undefined && input.lowStockThreshold !== "" ? Number(input.lowStockThreshold) : null,
    imageUrl: input.imageUrl || null,
    isActive: true,
    isDeleted: false,
    updatedAt: nowIso(),
    dirty: 1,
  };
  await db.products.put(record);
  runSync();
  return record;
}

export async function updateProduct(clientId, changes) {
  const existing = await db.products.get(clientId);
  if (!existing || existing.storeId !== currentStoreId()) throw new Error("Product not found locally");
  const updated = { ...existing, ...changes, updatedAt: nowIso(), dirty: 1 };
  await assertNoDuplicateCodesLocally(updated.storeId, { barcode: updated.barcode, sku: updated.sku }, clientId);
  await db.products.put(updated);
  runSync();
  return updated;
}

export async function deleteProduct(clientId) {
  return updateProduct(clientId, { isDeleted: true });
}

// ---------- Stock ----------

async function writeMovementAndAdjustStock({ productId, type, quantityChange, reason }) {
  const product = await db.products.get(productId);
  if (!product || product.storeId !== currentStoreId()) throw new Error("Product not found locally");

  const quantityAfter = product.quantityOnHand + quantityChange;
  if (quantityAfter < 0) throw new Error(`Insufficient stock for ${product.name}`);

  const user = currentUser();
  const movement = {
    clientId: uuid(),
    storeId: user.storeId,
    productId: product.id || product.clientId, // prefer server id once known
    type,
    quantityChange,
    quantityAfter,
    reason: reason || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    dirty: 1,
  };

  await db.transaction("rw", db.products, db.stockMovements, async () => {
    // dirty: product.dirty (not forced to 1) — the server never reads
    // quantityOnHand from a product push anyway (excluded from its
    // update, same as here), so marking the product dirty here was
    // always a no-op for syncing the quantity itself. It became actively
    // harmful once product pushes were role-gated to owner/manager: a
    // cashier's own sale/restock would mark their product dirty, that
    // entry would be rejected by the role gate on every future push
    // forever, and a permanently-dirty product also never receives future
    // catalog updates from pull (pull skips anything locally dirty). The
    // quantity itself doesn't need this: the movement above is the thing
    // that actually needs to sync, and once it does, the next pull
    // restores the product's true server quantity on its own — dirty or
    // not. If the product already had a genuine pending edit (dirty for
    // an unrelated reason), that's preserved, not cleared, by carrying
    // its existing dirty value forward instead of overwriting it.
    await db.products.put({ ...product, quantityOnHand: quantityAfter, updatedAt: nowIso(), dirty: product.dirty });
    await db.stockMovements.put(movement);
  });

  runSync();
  return movement;
}

export async function restock(productId, quantity, reason) {
  if (!quantity || Number(quantity) <= 0) throw new Error("Quantity must be positive");
  return writeMovementAndAdjustStock({ productId, type: "restock", quantityChange: Number(quantity), reason });
}

export async function adjustStock(productId, quantityChange, reason) {
  if (!quantityChange || Number(quantityChange) === 0) throw new Error("quantityChange must be non-zero");
  if (!reason) throw new Error("A reason is required for stock adjustments");
  return writeMovementAndAdjustStock({ productId, type: "adjustment", quantityChange: Number(quantityChange), reason });
}

export async function listMovements({ productId } = {}) {
  const storeId = currentStoreId();
  let items = await db.stockMovements.filter((m) => m.storeId === storeId).toArray();
  if (productId) items = items.filter((m) => m.productId === productId);
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---------- Sales (POS) ----------

/**
 * items: [{ productId (clientId), quantity }]
 * Applies the sale optimistically to local stock immediately (so the
 * cashier sees correct inventory instantly, online or offline), then
 * queues the sale itself for sync.
 *
 * Deliberately does NOT queue a separate local StockMovement for the sale's
 * line items. The server's performSaleCreation() is the single authoritative
 * place that decrements stock and writes the StockMovement for a sale —
 * queuing a second, independent movement here caused every synced sale to
 * decrement stock twice (once via the sale, once via the queued movement).
 * The optimistic product write below is only a local projection for instant
 * UI feedback; the real movement record arrives on the next pull once the
 * sale has synced.
 */
export async function createSale({ items, discount = 0, paymentMethod = "cash", customerName, customerPhone }) {
  if (!items?.length) throw new Error("At least one line item is required");
  const user = currentUser();

  const discountNum = discount === undefined || discount === null ? 0 : Number(discount);
  if (!Number.isFinite(discountNum) || discountNum < 0) {
    throw new Error("Discount must be a non-negative number");
  }

  const saleItems = [];
  let subtotal = 0;
  let createdSale = null;

  await db.transaction("rw", db.products, db.sales, async () => {
    for (const line of items) {
      if (line.isCustom) {
        // Ad-hoc line item — no catalog product, no stock to touch.
        const quantity = Number(line.quantity) || 1;
        const unitPrice = Number(line.unitPrice);
        if (!line.name) throw new Error("Custom items need a name");
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error(`Invalid price for ${line.name}`);
        const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
        subtotal += lineTotal;
        saleItems.push({ name: line.name, unitPrice, quantity, lineTotal, isCustom: true });
        continue;
      }

      const product = await db.products.get(line.productId);
      if (!product || product.storeId !== user.storeId) throw new Error("Product not found locally");
      const quantity = Number(line.quantity);
      if (quantity <= 0) throw new Error(`Invalid quantity for ${product.name}`);
      if (product.quantityOnHand < quantity) throw new Error(`Not enough stock for ${product.name} (have ${product.quantityOnHand})`);

      // A cashier may have negotiated a different price than the catalog
      // price — respect it when provided, otherwise fall back to the
      // product's standard sell price. The edit control is hidden for
      // cashiers in the UI, but this is the real local guard (mirrors the
      // server, which is the real remote guard) — belt and suspenders.
      const hasOverride = line.unitPrice !== undefined && line.unitPrice !== null;
      const unitPrice = hasOverride ? Number(line.unitPrice) : product.sellPrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Invalid price for ${product.name}`);
      if (hasOverride && Math.abs(unitPrice - product.sellPrice) > 0.0001 && user.role === "cashier") {
        throw new Error(`Only an owner or manager can change the price for ${product.name}`);
      }
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      subtotal += lineTotal;

      saleItems.push({ productId: product.id || product.clientId, name: product.name, unitPrice, quantity, lineTotal, isCustom: false });

      const quantityAfter = product.quantityOnHand - quantity;
      // dirty preserved, not forced — see writeMovementAndAdjustStock's
      // comment above for why.
      await db.products.put({ ...product, quantityOnHand: quantityAfter, updatedAt: nowIso(), dirty: product.dirty });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    if (discountNum > subtotal) {
      // Throwing here rolls back every product decrement already applied
      // earlier in this loop — Dexie transactions are all-or-nothing.
      throw new Error(`Discount (${discountNum.toLocaleString()}) cannot exceed subtotal (${subtotal.toLocaleString()})`);
    }
    const total = Math.round((subtotal - discountNum) * 100) / 100;

    const sale = {
      clientId: uuid(),
      storeId: user.storeId,
      items: saleItems,
      subtotal,
      discount: discountNum,
      total,
      paymentMethod,
      customerName: customerName || "",
      customerPhone: customerPhone || "",
      status: "completed",
      soldByUserId: user.id,
      occurredAt: nowIso(),
      updatedAt: nowIso(),
      dirty: 1,
    };

    await db.sales.put(sale);
    createdSale = sale;
  });

  runSync();

  return createdSale;
}

export async function listSales({ from, to } = {}) {
  const storeId = currentStoreId();
  let items = await db.sales.filter((s) => s.storeId === storeId).toArray();
  if (from) items = items.filter((s) => new Date(s.occurredAt) >= new Date(from));
  if (to) items = items.filter((s) => new Date(s.occurredAt) <= new Date(to));
  return items.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

// ---------- Customer credit accounts ----------

/**
 * Reduces a phone number to its digits and, for Rwanda's local format,
 * its international form — so "0788123456", "+250788123456", and
 * "078-812-3456" all resolve to the same customer instead of splitting
 * one person's credit history across several. Rwanda-specific by design
 * (this app's current stated scope), not a general E.164 normalizer.
 * IMPORTANT: kept byte-for-byte identical to the same function in
 * server/src/controllers/creditController.js — the two have no shared
 * module to import from across the client/server boundary, so a change
 * to one without the other would silently make the two sides group the
 * same customer differently.
 */
function normalizePhone(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return "250" + digits.slice(1);
  return digits;
}

function customerKey(name, phone) {
  return `${(name || "").trim().toLowerCase()}|${normalizePhone(phone)}`;
}

/** Aggregates credit sales minus payments, grouped by customer, from local data. */
export async function listCustomerBalances() {
  const storeId = currentStoreId();
  const [sales, payments] = await Promise.all([
    db.sales.filter((s) => s.storeId === storeId).toArray(),
    db.creditPayments.filter((c) => !c.isDeleted && c.storeId === storeId).toArray(),
  ]);

  const creditSales = sales.filter((s) => s.paymentMethod === "credit" && s.status === "completed");
  const byCustomer = new Map();

  for (const sale of creditSales) {
    const key = customerKey(sale.customerName, sale.customerPhone);
    const entry = byCustomer.get(key) || {
      customerName: sale.customerName || "Unnamed customer",
      customerPhone: sale.customerPhone || "",
      charged: 0,
      paid: 0,
      lastActivity: sale.occurredAt,
    };
    entry.charged += sale.total;
    if (new Date(sale.occurredAt) > new Date(entry.lastActivity)) entry.lastActivity = sale.occurredAt;
    byCustomer.set(key, entry);
  }

  for (const payment of payments) {
    const key = customerKey(payment.customerName, payment.customerPhone);
    const entry = byCustomer.get(key) || {
      customerName: payment.customerName,
      customerPhone: payment.customerPhone || "",
      charged: 0,
      paid: 0,
      lastActivity: payment.createdAt,
    };
    entry.paid += payment.amount;
    if (new Date(payment.createdAt) > new Date(entry.lastActivity)) entry.lastActivity = payment.createdAt;
    byCustomer.set(key, entry);
  }

  return [...byCustomer.values()]
    .map((e) => ({
      ...e,
      charged: Math.round(e.charged * 100) / 100,
      paid: Math.round(e.paid * 100) / 100,
      balance: Math.round((e.charged - e.paid) * 100) / 100,
    }))
    .sort((a, b) => b.balance - a.balance);
}

export async function recordCreditPayment({ customerName, customerPhone, amount, note }) {
  if (!customerName) throw new Error("Customer name is required");
  if (!amount || Number(amount) <= 0) throw new Error("Amount must be positive");

  const user = currentUser();
  const record = {
    clientId: uuid(),
    storeId: user.storeId,
    customerName,
    customerPhone: customerPhone || "",
    amount: Number(amount),
    note: note || "",
    isDeleted: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    dirty: 1,
  };
  await db.creditPayments.put(record);
  runSync();
  return record;
}

export async function listCreditPayments({ customerName, customerPhone } = {}) {
  const storeId = currentStoreId();
  let items = await db.creditPayments.filter((c) => !c.isDeleted && c.storeId === storeId).toArray();
  if (customerName) items = items.filter((c) => c.customerName === customerName);
  if (customerPhone !== undefined) items = items.filter((c) => c.customerPhone === customerPhone);
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---------- Misc ----------

export async function todaysSalesSummary() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sales = await listSales({ from: startOfToday.toISOString() });
  const completed = sales.filter((s) => s.status === "completed");
  return {
    total: completed.reduce((sum, s) => sum + s.total, 0),
    count: completed.length,
  };
}

export async function findLocalProductByAnyId(id) {
  if (!id) return null;
  const storeId = currentStoreId();
  const byClientId = await db.products.get(id);
  if (byClientId && byClientId.storeId === storeId) return byClientId;
  const all = await db.products.filter((p) => p.storeId === storeId).toArray();
  return all.find((p) => p.id === id) || null;
}

/**
 * Voids a sale via the server (which reverses stock server-side and logs
 * the action) and refreshes the local cache to match. Requires the sale
 * to have already synced (has a server id) and a live connection — voiding
 * touches money and stock, so it's deliberately not something we queue up
 * to apply blind later.
 */
export async function voidSaleRemote(sale) {
  if (!sale.id) throw new Error("This sale hasn't finished syncing yet — try again in a moment.");
  if (!navigator.onLine) throw new Error("Voiding a sale needs a connection.");

  const { data } = await api.post(`/sales/${sale.id}/void`);
  await db.sales.put({ ...data, clientId: sale.clientId, id: data._id, dirty: 0 });

  // Optimistic local stock restore for instant UI feedback; the next sync
  // pull reconciles this against the server's authoritative figures.
  for (const item of data.items) {
    const product = await findLocalProductByAnyId(item.productId);
    if (product) {
      await db.products.put({ ...product, quantityOnHand: product.quantityOnHand + item.quantity });
    }
  }

  return data;
}

// ---------- Period analytics (Dashboard cards + chart, Reports page) ----------

const PERIOD_LABELS = { today: "Today", month: "This Month", year: "This Year" };

export function periodLabel(period) {
  return PERIOD_LABELS[period] || "Today";
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Start/end (exclusive) of a period, `offset` periods back from now.
 * offset=0 is the current, still-in-progress period (end = now, so "today"
 * only covers hours elapsed so far). offset>0 is a fully-elapsed past
 * period (end = the exact boundary, e.g. midnight on the 1st of the next
 * month) — this is what powers the ‹ › time-travel navigation.
 */
export function getPeriodRange(period, offset = 0, override = null) {
  // Custom date range (Reports only) — wins regardless of period/offset.
  if (override) return override;

  const now = new Date();

  if (period === "year") {
    const year = now.getFullYear() - offset;
    const start = new Date(year, 0, 1);
    const end = offset === 0 ? now : new Date(year + 1, 0, 1);
    return { start, end };
  }

  if (period === "month") {
    const totalMonths = now.getFullYear() * 12 + now.getMonth() - offset;
    const year = Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const start = new Date(year, month, 1);
    const end = offset === 0 ? now : new Date(year, month + 1, 1);
    return { start, end };
  }

  // "today"
  const start = new Date(now);
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  const end = offset === 0 ? now : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Human label for the period currently being viewed, e.g. "August 2026" when offset > 0. */
export function getPeriodRangeLabel(period, offset, range) {
  if (offset === 0) return periodLabel(period);
  if (period === "year") return String(range.start.getFullYear());
  if (period === "month") return range.start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return range.start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The immediately-preceding range, for period-over-period comparison
 * (the "+12% vs last period" badges). For day/week, naively subtracting
 * the current range's duration is correct — a day before a day is just
 * yesterday. For month/year it isn't: 11 days into September, subtracting
 * that same 11-day duration lands on Aug 21-31, not the first 11 days of
 * August, so it was comparing against the wrong slice of the wrong month.
 * Month/year instead reuse getPeriodRange's own calendar-aware math to
 * find the correct previous period's actual start, then cap the
 * comparison at the same elapsed duration as the current range — so an
 * in-progress "this month" still compares fairly against the same number
 * of days last month, not the whole of last month.
 */
function getPreviousRange({ start, end }, period, offset = 0) {
  const durationMs = end.getTime() - start.getTime();
  if (period === "month" || period === "year") {
    const { start: prevStart } = getPeriodRange(period, offset + 1);
    return { start: prevStart, end: new Date(prevStart.getTime() + durationMs) };
  }
  return { start: new Date(start.getTime() - durationMs), end: new Date(start) };
}

function sumSales(sales, start, end) {
  const inRange = sales.filter((s) => {
    const t = new Date(s.occurredAt);
    return t >= start && t < end;
  });
  const revenue = inRange.reduce((sum, s) => sum + s.total, 0);
  const items = inRange.reduce((sum, s) => sum + s.items.reduce((x, i) => x + i.quantity, 0), 0);
  return { count: inRange.length, revenue, items };
}

function percentChange(current, previous) {
  if (previous === 0) return current > 0 ? null : 0; // null = "new", nothing to compare against
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Powers each Dashboard stat card: current value for the period, plus
 * percent change vs. the equivalent immediately-preceding period (today
 * vs. yesterday, this month-to-date vs. the same number of days last
 * month, etc).
 */
export async function getStatForPeriod(metric, period, offset = 0, customRange = null) {
  const allSales = (await listSales()).filter((s) => s.status === "completed");
  const range = getPeriodRange(period, offset, customRange);
  const key = metric === "sales" ? "count" : metric === "revenue" ? "revenue" : "items";
  const current = sumSales(allSales, range.start, range.end);

  if (customRange) {
    // No well-defined "previous period" for an arbitrary range.
    return { value: current[key], change: null };
  }

  const prevRange = getPreviousRange(range, period, offset);
  const previous = sumSales(allSales, prevRange.start, prevRange.end);
  return { value: current[key], change: percentChange(current[key], previous[key]) };
}

/**
 * Bucketed series for the sales/revenue/items chart: hourly for "today",
 * daily for "month", monthly for "year". At offset=0 buckets stop at "now"
 * (a still-in-progress period); at offset>0 they cover the full elapsed
 * period being looked back at.
 */
export async function getSalesSeries(period, offset = 0) {
  const allSales = (await listSales()).filter((s) => s.status === "completed");
  const { start } = getPeriodRange(period, offset);
  const now = new Date();
  const buckets = [];

  if (period === "today") {
    const hoursToShow = offset === 0 ? now.getHours() : 23;
    for (let h = 0; h <= hoursToShow; h++) {
      const bucketStart = new Date(start);
      bucketStart.setHours(h, 0, 0, 0);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setHours(h + 1, 0, 0, 0);
      const { count, revenue, items } = sumSales(allSales, bucketStart, bucketEnd);
      buckets.push({ label: `${String(h).padStart(2, "0")}:00`, date: bucketStart.toISOString(), sales: count, revenue, items });
    }
  } else if (period === "month") {
    const daysToShow = offset === 0 ? now.getDate() : daysInMonth(start.getFullYear(), start.getMonth());
    for (let d = 1; d <= daysToShow; d++) {
      const bucketStart = new Date(start.getFullYear(), start.getMonth(), d, 0, 0, 0, 0);
      const bucketEnd = new Date(start.getFullYear(), start.getMonth(), d + 1, 0, 0, 0, 0);
      const { count, revenue, items } = sumSales(allSales, bucketStart, bucketEnd);
      buckets.push({ label: String(d), date: bucketStart.toISOString(), sales: count, revenue, items });
    }
  } else {
    const monthsToShow = offset === 0 ? now.getMonth() + 1 : 12;
    for (let m = 0; m < monthsToShow; m++) {
      const bucketStart = new Date(start.getFullYear(), m, 1);
      const bucketEnd = new Date(start.getFullYear(), m + 1, 1);
      const { count, revenue, items } = sumSales(allSales, bucketStart, bucketEnd);
      buckets.push({ label: bucketStart.toLocaleDateString(undefined, { month: "short" }), date: bucketStart.toISOString(), sales: count, revenue, items });
    }
  }

  return buckets;
}

/** Top products by revenue for a given period, from local sales — used by the Reports table. */
export async function getTopProducts(period = "year", offset = 0, allTime = false, customRange = null) {
  const sales = (await listSales()).filter((s) => s.status === "completed");
  let inRange = sales;
  if (!allTime) {
    const { start, end } = getPeriodRange(period, offset, customRange);
    inRange = sales.filter((s) => {
      const t = new Date(s.occurredAt);
      return t >= start && t < end;
    });
  }

  const totals = new Map();
  for (const s of inRange) {
    for (const item of s.items || []) {
      const prev = totals.get(item.name) || { name: item.name, revenue: 0, quantity: 0 };
      prev.revenue += item.lineTotal;
      prev.quantity += item.quantity;
      totals.set(item.name, prev);
    }
  }
  return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
}

// ---------- Suppliers ----------

export async function listSuppliers() {
  const storeId = currentStoreId();
  const items = await db.suppliers.filter((s) => !s.isDeleted && s.storeId === storeId).toArray();
  return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function createSupplier(input) {
  const user = currentUser();
  const record = {
    clientId: uuid(),
    storeId: user.storeId,
    name: input.name,
    phone: input.phone || "",
    email: input.email || "",
    address: input.address || "",
    notes: input.notes || "",
    isActive: true,
    isDeleted: false,
    updatedAt: nowIso(),
    dirty: 1,
  };
  await db.suppliers.put(record);
  runSync();
  return record;
}

export async function updateSupplier(clientId, changes) {
  const existing = await db.suppliers.get(clientId);
  if (!existing || existing.storeId !== currentStoreId()) throw new Error("Supplier not found locally");
  const updated = { ...existing, ...changes, updatedAt: nowIso(), dirty: 1 };
  await db.suppliers.put(updated);
  runSync();
  return updated;
}

export async function deleteSupplier(clientId) {
  return updateSupplier(clientId, { isDeleted: true });
}

// ---------- Purchase orders ----------

export async function listPurchaseOrders({ status } = {}) {
  const storeId = currentStoreId();
  let items = await db.purchaseOrders.filter((po) => po.storeId === storeId).toArray();
  if (status) items = items.filter((po) => po.status === status);
  return items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export async function getPurchaseOrder(clientId) {
  const order = await db.purchaseOrders.get(clientId);
  if (!order || order.storeId !== currentStoreId()) return undefined;
  return order;
}

/**
 * items: [{ productId (clientId or server id), quantityOrdered, unitCost }]
 * Product names are snapshotted locally, same as a sale line item, so the
 * order still reads correctly even if a product is later renamed.
 */
export async function createPurchaseOrder({ supplierId, supplierName, items, notes, expectedDate }) {
  if (!items?.length) throw new Error("At least one line item is required");
  const user = currentUser();

  const resolvedItems = [];
  for (const line of items) {
    const product = await findLocalProductByAnyId(line.productId);
    if (!product) throw new Error("Product not found locally");
    const quantityOrdered = Number(line.quantityOrdered);
    if (!quantityOrdered || quantityOrdered <= 0) throw new Error(`Invalid quantity for ${product.name}`);
    resolvedItems.push({
      productId: product.id || product.clientId,
      name: product.name,
      quantityOrdered,
      quantityReceived: 0,
      unitCost: Number(line.unitCost) || 0,
    });
  }

  const record = {
    clientId: uuid(),
    storeId: user.storeId,
    supplierId: supplierId || null,
    supplierName: supplierName || "",
    items: resolvedItems,
    status: "ordered",
    notes: notes || "",
    expectedDate: expectedDate || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    dirty: 1,
  };
  await db.purchaseOrders.put(record);
  runSync();
  return record;
}

export async function updatePurchaseOrderStatus(clientId, status) {
  const existing = await db.purchaseOrders.get(clientId);
  if (!existing || existing.storeId !== currentStoreId()) throw new Error("Purchase order not found locally");
  const updated = { ...existing, status, updatedAt: nowIso(), dirty: 1 };
  await db.purchaseOrders.put(updated);
  runSync();
  return updated;
}

/**
 * Receives stock against a PO: applies the same optimistic local
 * stock-movement pattern as a restock (immediate local stock bump), updates
 * the PO's own quantityReceived/status locally, and queues a poReceipts
 * entry so the server applies the same change.
 *
 * Deliberately does NOT queue a separate local StockMovement for the
 * receipt (same reasoning as createSale() above, and the same bug shape,
 * just with a different symptom). This used to write both a StockMovement
 * AND a poReceipts entry, sharing one clientId on purpose so the server's
 * StockMovement idempotency check would treat the second as a no-op and
 * avoid double-counting stock. But in the SAME push request, the
 * stockMovements array was processed before poReceipts — so that shared
 * clientId always already existed by the time performReceivePurchaseOrder
 * looked for it, and its "already applied, skip" branch fired before the
 * line that increments the PO's own quantityReceived. Net effect: stock
 * moved correctly, but the PO itself stayed stuck at 0 received, forever,
 * on every single receipt. A generated id is still attached to each line
 * purely as the idempotency key sent to the server (so a genuinely
 * *retried* push — network drop after the server saved, before the
 * response arrived — still doesn't double-apply); it just no longer
 * doubles as a second local record fighting the first one in the same
 * request.
 */
export async function receivePurchaseOrder(poClientId, receivedItems) {
  // receivedItems: [{ productId, quantityReceived }]
  const order = await db.purchaseOrders.get(poClientId);
  if (!order || order.storeId !== currentStoreId()) throw new Error("Purchase order not found locally");
  if (order.status === "cancelled") throw new Error("This order was cancelled");

  const updatedItems = order.items.map((item) => ({ ...item }));
  const receiptItemsForSync = [];

  await db.transaction("rw", db.products, db.purchaseOrders, db.poReceipts, async () => {
    for (const receipt of receivedItems) {
      const quantity = Number(receipt.quantityReceived);
      if (!quantity || quantity <= 0) continue;

      const line = updatedItems.find((i) => i.productId === receipt.productId);
      if (!line) continue;

      const remaining = line.quantityOrdered - line.quantityReceived;
      const applied = Math.min(quantity, remaining);
      if (applied <= 0) continue;

      const product = await findLocalProductByAnyId(receipt.productId);
      if (!product) continue;

      const quantityAfter = product.quantityOnHand + applied;
      // dirty preserved, not forced — see writeMovementAndAdjustStock's
      // comment for why.
      await db.products.put({ ...product, quantityOnHand: quantityAfter, updatedAt: nowIso(), dirty: product.dirty });

      line.quantityReceived += applied;
      receiptItemsForSync.push({ productId: line.productId, quantityReceived: applied, clientId: uuid() });
    }

    const allReceived = updatedItems.every((i) => i.quantityReceived >= i.quantityOrdered);
    const anyReceived = updatedItems.some((i) => i.quantityReceived > 0);
    const nextStatus = allReceived ? "received" : anyReceived ? "partially_received" : order.status;

    await db.purchaseOrders.put({ ...order, items: updatedItems, status: nextStatus, updatedAt: nowIso(), dirty: 1 });

    if (receiptItemsForSync.length > 0) {
      await db.poReceipts.put({
        clientId: uuid(),
        purchaseOrderId: order.id || order.clientId,
        items: receiptItemsForSync,
        createdAt: nowIso(),
        dirty: 1,
      });
    }
  });

  runSync();
  return getPurchaseOrder(poClientId);
}

/**
 * Reorder suggestions: for each active product, estimate daily sales
 * velocity from the last 30 days and flag anything projected to run out
 * within `daysThreshold` days, or already at/below its low-stock alert.
 * Suggests enough to cover `targetDays` of stock at the current pace.
 */
export async function getReorderSuggestions({ daysThreshold = 10, targetDays = 21, lookbackDays = 30 } = {}) {
  const [products, sales] = await Promise.all([listProducts(), listSales()]);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const completed = sales.filter((s) => s.status === "completed" && new Date(s.occurredAt) >= since);

  const soldByProductId = new Map();
  for (const s of completed) {
    for (const item of s.items || []) {
      if (!item.productId) continue; // custom/ad-hoc items aren't in the catalog
      soldByProductId.set(item.productId, (soldByProductId.get(item.productId) || 0) + item.quantity);
    }
  }

  const suggestions = [];
  for (const p of products) {
    const ref = p.id || p.clientId;
    const soldInWindow = soldByProductId.get(ref) || soldByProductId.get(p.clientId) || 0;
    const dailyVelocity = soldInWindow / lookbackDays;
    const threshold = effectiveLowStockThreshold(p);

    const daysOfStockLeft = dailyVelocity > 0 ? p.quantityOnHand / dailyVelocity : p.quantityOnHand > 0 ? Infinity : 0;
    const isLow = p.quantityOnHand <= threshold;
    const isProjectedToRunOut = daysOfStockLeft <= daysThreshold;

    if (isLow || isProjectedToRunOut) {
      const suggestedQuantity = Math.max(
        Math.ceil(dailyVelocity * targetDays) - p.quantityOnHand,
        threshold * 2 - p.quantityOnHand,
        1
      );
      suggestions.push({
        product: p,
        dailyVelocity: Math.round(dailyVelocity * 100) / 100,
        daysOfStockLeft: Number.isFinite(daysOfStockLeft) ? Math.round(daysOfStockLeft) : null,
        suggestedQuantity,
      });
    }
  }

  return suggestions.sort((a, b) => (a.daysOfStockLeft ?? 999) - (b.daysOfStockLeft ?? 999));
}

// ---------- Full data backup ----------

/** Everything currently cached on this device for the current store, for a "download my data" export. */
export async function exportFullBackup() {
  const storeId = currentStoreId();
  const [products, sales, stockMovements, creditPayments, suppliers, purchaseOrders] = await Promise.all([
    db.products.filter((p) => p.storeId === storeId).toArray(),
    db.sales.filter((s) => s.storeId === storeId).toArray(),
    db.stockMovements.filter((m) => m.storeId === storeId).toArray(),
    db.creditPayments.filter((c) => c.storeId === storeId).toArray(),
    db.suppliers.filter((s) => s.storeId === storeId).toArray(),
    db.purchaseOrders.filter((po) => po.storeId === storeId).toArray(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    products,
    sales,
    stockMovements,
    creditPayments,
    suppliers,
    purchaseOrders,
  };
}