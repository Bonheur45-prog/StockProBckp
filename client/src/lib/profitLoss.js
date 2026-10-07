/**
 * Pure Profit & Loss logic — no Dexie, no network, no React. repo.js loads the
 * data and hands it to these functions, which is what makes the money maths
 * testable in isolation (see __tests__/profitLoss.test.js).
 *
 *   Revenue − COGS − Expenses = Net Profit
 *
 * Revenue is each completed sale's `total` (already net of any discount).
 * COGS is quantity × the unit cost of each catalog product line. Where that
 * unit cost comes from is the whole accuracy story, so every line is tagged
 * with its SOURCE and the result reports how much of COGS rests on each:
 *
 *   snapshot  — the sale itself recorded the cost at the moment of sale.
 *               Exact; never recomputed. (Every sale from now on.)
 *   history   — an older sale with no snapshot, costed from the price-history
 *               log ("what did this product cost at that moment?"). Accurate
 *               for any moment on/after tracking was switched on.
 *   estimate  — an older sale with neither: costed at the product's CURRENT
 *               cost price. A last resort. If the cost has moved since, this
 *               is wrong by exactly that much, and the UI says so.
 *
 * Lines that can't be costed are EXCLUDED from COGS (never silently counted
 * as free) and reported separately:
 *   custom    — ad-hoc "custom item" lines have no catalog product, so no cost.
 *   unknown   — the product is gone from the local catalog, so no cost either.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Finite number >= 0, else null. ("" / null / undefined / "abc" / -1 -> null) */
export function toMoney(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- price history

/**
 * What was `field` at time `at`, according to `rows` (one product's history)?
 * The newValue of the latest row at-or-before `at`; null when the product has
 * no row that early — which means history CANNOT answer, and the caller must
 * fall back (and say so). Must stay in lock-step with the server's priceAt().
 */
export function priceAtFromRows(rows, field, at) {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  let best = null;
  let bestTime = -Infinity;
  for (const r of rows) {
    if (r.field !== field) continue;
    const rt = new Date(r.changedAt).getTime();
    if (Number.isNaN(rt) || rt > t) continue;
    if (rt >= bestTime) {
      best = r;
      bestTime = rt;
    }
  }
  return best ? toMoney(best.newValue) : null;
}

/**
 * A device may know a product by its local clientId, its server id, or (for
 * rows written before the product synced) a mix — so history is indexed under
 * every id it mentions, and a product looks itself up under all of its own.
 */
export function buildHistoryIndex(rows) {
  const index = new Map();
  const add = (key, row) => {
    if (!key) return;
    const k = String(key);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(row);
  };
  for (const row of rows) {
    add(row.productId, row);
    if (row.productClientId && row.productClientId !== row.productId) add(row.productClientId, row);
  }
  return index;
}

export function historyRowsForProduct(index, product) {
  if (!product) return [];
  const seen = new Set();
  const out = [];
  for (const key of [product.clientId, product.id]) {
    if (!key) continue;
    for (const row of index.get(String(key)) || []) {
      if (!seen.has(row)) {
        seen.add(row);
        out.push(row);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ line costing

/**
 * Unit cost for one sale line and where it came from.
 * ctx: { productsByRef: Map(ref -> product), historyIndex, rowsCache: Map }
 */
export function resolveLineCost(item, saleTime, ctx) {
  if (item.isCustom || !item.productId) return { source: "custom", cost: null };

  const snapshot = toMoney(item.unitCost);
  if (snapshot !== null) return { source: "snapshot", cost: snapshot };

  const product = ctx.productsByRef.get(String(item.productId));
  if (!product) return { source: "unknown", cost: null };

  let rows = ctx.rowsCache.get(product);
  if (!rows) {
    rows = historyRowsForProduct(ctx.historyIndex, product);
    ctx.rowsCache.set(product, rows);
  }
  const fromHistory = priceAtFromRows(rows, "costPrice", saleTime);
  if (fromHistory !== null) return { source: "history", cost: fromHistory };

  return { source: "estimate", cost: toMoney(product.costPrice) ?? 0 };
}

function inRange(date, range) {
  const t = new Date(date).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

/** completed sales only — voided/refunded sales are not income. */
function completedSalesInRange(sales, range) {
  return sales.filter((s) => s.status === "completed" && inRange(s.occurredAt, range));
}

/**
 * An expense belongs to a calendar DAY, not a moment — the picker stores it at
 * local noon purely so timezones can't shift it. A current-period range ends at
 * NOW, so comparing the stored noon directly would hide an expense logged at
 * 9am for today until 12:00. Compare the start of its local day instead.
 */
function expenseDay(expense) {
  const d = new Date(expense.date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function liveExpensesInRange(expenses, range) {
  return expenses.filter((e) => !e.isDeleted && inRange(expenseDay(e), range));
}

/**
 * Total, count and per-category breakdown of the live (non-deleted) expenses
 * dated inside `range`. Shared by the P&L and the Expenses page's summary
 * cards so the two can never disagree about "total this period".
 */
export function summarizeExpenses(expenses, range) {
  const periodExpenses = liveExpensesInRange(expenses, range);
  const byCategory = new Map();
  let total = 0;
  for (const e of periodExpenses) {
    const amount = Number(e.amount) || 0;
    total += amount;
    const category = (e.category || "").trim() || "Uncategorized";
    const prev = byCategory.get(category) || { category, total: 0, count: 0 };
    prev.total += amount;
    prev.count += 1;
    byCategory.set(category, prev);
  }
  return {
    total: round2(total),
    count: periodExpenses.length,
    byCategory: [...byCategory.values()].map((c) => ({ ...c, total: round2(c.total) })).sort((a, b) => b.total - a.total),
  };
}

function emptySource() {
  return { lines: 0, amount: 0 };
}

/**
 * The full P&L for `range` ({ start, end } with end EXCLUSIVE — the same shape
 * getPeriodRange returns, so P&L and the existing Reports cards always agree).
 */
export function computeProfitAndLoss({ sales, expenses, products, history, range }) {
  const productsByRef = new Map();
  for (const p of products) {
    productsByRef.set(String(p.clientId), p);
    if (p.id) productsByRef.set(String(p.id), p);
  }
  const ctx = { productsByRef, historyIndex: buildHistoryIndex(history), rowsCache: new Map() };

  const periodSales = completedSalesInRange(sales, range);

  let revenue = 0;
  let cogs = 0;
  const cogsBySource = { snapshot: emptySource(), history: emptySource(), estimate: emptySource() };
  const excluded = { custom: { lines: 0, revenue: 0 }, unknown: { lines: 0, revenue: 0 } };
  const zeroCost = { lines: 0, revenue: 0 };

  for (const sale of periodSales) {
    revenue += Number(sale.total) || 0;
    for (const item of sale.items || []) {
      const quantity = Number(item.quantity) || 0;
      const { source, cost } = resolveLineCost(item, sale.occurredAt, ctx);

      if (cost === null) {
        excluded[source].lines += 1;
        excluded[source].revenue += Number(item.lineTotal) || 0;
        continue;
      }

      const lineCost = cost * quantity;
      cogs += lineCost;
      cogsBySource[source].lines += 1;
      cogsBySource[source].amount += lineCost;

      // A cost of exactly 0 means "no cost price was ever entered" far more
      // often than "this was free" — surface it instead of letting it quietly
      // inflate the margin.
      if (cost === 0) {
        zeroCost.lines += 1;
        zeroCost.revenue += Number(item.lineTotal) || 0;
      }
    }
  }

  const expenseSummary = summarizeExpenses(expenses, range);

  revenue = round2(revenue);
  cogs = round2(cogs);
  const expensesTotal = expenseSummary.total;
  const grossProfit = round2(revenue - cogs);
  const netProfit = round2(grossProfit - expensesTotal);

  for (const k of Object.keys(cogsBySource)) cogsBySource[k].amount = round2(cogsBySource[k].amount);

  return {
    range,
    salesCount: periodSales.length,
    revenue,
    cogs,
    grossProfit,
    expenses: expensesTotal,
    netProfit,
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    netMarginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : null,
    cogsBySource,
    excluded,
    zeroCost,
    expenseCount: expenseSummary.count,
    expensesByCategory: expenseSummary.byCategory,
  };
}

/**
 * Plain-language statements about how much to trust a P&L, for the UI/PDF.
 * Returns [] when everything rests on exact snapshots. Each item is
 * { tone: "info" | "warn", text }. Kept here (not in a component) so the web
 * page and the PDF can never word the caveat differently.
 */
export function describeAccuracy(pl, currency = "") {
  const fmt = (n) => `${Math.round(n).toLocaleString()}${currency ? ` ${currency}` : ""}`;
  const out = [];
  const { history, estimate } = pl.cogsBySource;

  if (estimate.lines > 0) {
    out.push({
      tone: "warn",
      text: `${fmt(estimate.amount)} of cost of goods (${estimate.lines} sale line${estimate.lines === 1 ? "" : "s"}) is an ESTIMATE: those sales were made before per-sale costs were recorded and before price tracking began, so they use each product's current cost price. If a cost has changed since, this profit is off by that much.`,
    });
  }
  if (history.lines > 0) {
    out.push({
      tone: "info",
      text: `${fmt(history.amount)} of cost of goods (${history.lines} sale line${history.lines === 1 ? "" : "s"}) was looked up from each product's price history for the day of the sale — accurate, but not a recorded per-sale cost.`,
    });
  }
  if (pl.excluded.custom.lines > 0) {
    out.push({
      tone: "warn",
      text: `${pl.excluded.custom.lines} custom item line${pl.excluded.custom.lines === 1 ? "" : "s"} (${fmt(pl.excluded.custom.revenue)} of sales) have no cost, so no cost of goods is counted for them — profit is overstated by whatever they cost you.`,
    });
  }
  if (pl.excluded.unknown.lines > 0) {
    out.push({
      tone: "warn",
      text: `${pl.excluded.unknown.lines} sale line${pl.excluded.unknown.lines === 1 ? "" : "s"} (${fmt(pl.excluded.unknown.revenue)} of sales) are for products no longer in your catalog and have no recorded cost, so no cost of goods is counted for them.`,
    });
  }
  if (pl.zeroCost.lines > 0) {
    out.push({
      tone: "warn",
      text: `${pl.zeroCost.lines} sale line${pl.zeroCost.lines === 1 ? "" : "s"} (${fmt(pl.zeroCost.revenue)} of sales) were costed at 0 — usually a product whose cost price was never entered. Set its cost price so profit isn't overstated.`,
    });
  }
  return out;
}

// ---------------------------------------------------------- income vs expenses series

/** hour | day | month — what the chart's x-axis steps by. */
export function chooseGranularity(period, range, isCustom) {
  if (isCustom) {
    const days = Math.ceil((range.end.getTime() - range.start.getTime()) / DAY_MS);
    if (days <= 1) return "hour";
    return days <= 62 ? "day" : "month";
  }
  if (period === "today") return "hour";
  if (period === "month") return "day";
  return "month";
}

function startOfBucket(date, granularity) {
  const d = new Date(date);
  if (granularity === "hour") d.setMinutes(0, 0, 0);
  else if (granularity === "day") d.setHours(0, 0, 0, 0);
  else return new Date(d.getFullYear(), d.getMonth(), 1);
  return d;
}

function nextBucket(date, granularity) {
  const d = new Date(date);
  if (granularity === "hour") d.setHours(d.getHours() + 1);
  else if (granularity === "day") d.setDate(d.getDate() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

const MAX_BUCKETS = 400;

/**
 * Income and expenses per bucket across `range`. Buckets run from the range
 * start up to (not past) its end, so a still-in-progress period stops at "now"
 * exactly like getSalesSeries does. Events are clipped to the range first, so
 * a custom range that starts mid-bucket can't leak outside data in.
 */
export function buildIncomeExpenseSeries({ sales, expenses, range, granularity }) {
  const starts = [];
  for (let cur = startOfBucket(range.start, granularity); cur < range.end && starts.length < MAX_BUCKETS; cur = nextBucket(cur, granularity)) {
    starts.push(cur);
  }

  const spansYears = starts.length > 0 && starts[0].getFullYear() !== starts[starts.length - 1].getFullYear();
  const spansMonths = starts.length > 0 && (spansYears || starts[0].getMonth() !== starts[starts.length - 1].getMonth());

  const buckets = starts.map((start) => {
    let label;
    let fullLabel;
    if (granularity === "hour") {
      label = `${String(start.getHours()).padStart(2, "0")}:00`;
      fullLabel = start.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } else if (granularity === "day") {
      label = spansMonths ? start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(start.getDate());
      fullLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } else {
      label = start.toLocaleDateString(undefined, spansYears ? { month: "short", year: "2-digit" } : { month: "short" });
      fullLabel = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return { label, fullLabel, date: start.toISOString(), income: 0, expenses: 0 };
  });

  const place = (when, key, amount) => {
    const t = new Date(when).getTime();
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (new Date(buckets[i].date).getTime() <= t) {
        buckets[i][key] += amount;
        return;
      }
    }
  };

  for (const s of completedSalesInRange(sales, range)) place(s.occurredAt, "income", Number(s.total) || 0);
  for (const e of liveExpensesInRange(expenses, range)) place(expenseDay(e), "expenses", Number(e.amount) || 0);

  return buckets.map((b) => ({ ...b, income: round2(b.income), expenses: round2(b.expenses) }));
}