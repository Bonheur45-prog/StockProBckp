import { describe, it, expect } from "vitest";
import {
  toMoney,
  priceAtFromRows,
  buildHistoryIndex,
  summarizeExpenses,
  historyRowsForProduct,
  computeProfitAndLoss,
  describeAccuracy,
  chooseGranularity,
  buildIncomeExpenseSeries,
} from "../profitLoss.js";

/**
 * Every expected number below is worked out BY HAND from the fixture (see the
 * comment on each sale), not copied from the function's output. If one of
 * these fails, the arithmetic — not the test — should be suspected first.
 */

const d = (month, day, h = 12) => new Date(2026, month - 1, day, h, 0, 0).toISOString();
const RANGE = { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) }; // October 2026, end exclusive

const products = [
  { clientId: "p1", id: "srv1", name: "Cement", costPrice: 100 }, // current cost 100
  { clientId: "p2", id: "srv2", name: "Nails", costPrice: "50" }, // string, as the product form stores it
];

// p1 cost history: 70 from Sep 1 (baseline), raised to 90 on Oct 3.
// Rows reference the product by DIFFERENT ids on purpose (server id vs clientId).
const history = [
  { productId: "srv1", productClientId: "p1", field: "costPrice", newValue: 70, changedAt: d(9, 1), kind: "baseline" },
  { productId: "p1", productClientId: "p1", field: "costPrice", oldValue: 70, newValue: 90, changedAt: d(10, 3), kind: "change" },
  { productId: "srv1", field: "sellPrice", newValue: 9999, changedAt: d(9, 1), kind: "baseline" }, // must never leak into cost
];

const sale = (over) => ({ status: "completed", discount: 0, ...over });

const sales = [
  // S1: snapshot. 2 × 80 = 160 cost. Revenue 300.
  sale({ occurredAt: d(10, 5), total: 300, items: [{ productId: "p1", quantity: 2, unitCost: 80, lineTotal: 300 }] }),
  // S2: no snapshot; product referenced by SERVER id. History at Oct 6 = 90. 1 × 90 = 90. Revenue 150.
  sale({ occurredAt: d(10, 6), total: 150, items: [{ productId: "srv1", quantity: 1, lineTotal: 150 }] }),
  // S3: no snapshot, p2 has no history -> ESTIMATE at current cost "50". 3 × 50 = 150. Revenue 300.
  sale({ occurredAt: d(10, 7), total: 300, items: [{ productId: "p2", quantity: 3, lineTotal: 300 }] }),
  // S4: custom line, no cost -> excluded from COGS, but its 500 IS revenue.
  sale({ occurredAt: d(10, 8), total: 500, items: [{ isCustom: true, name: "Cut to length", quantity: 1, lineTotal: 500 }] }),
  // S5: VOIDED -> not income at all.
  sale({ status: "voided", occurredAt: d(10, 9), total: 999, items: [{ productId: "p1", quantity: 9, unitCost: 1, lineTotal: 999 }] }),
  // S6: Sep 30 23:59 -> before the range.
  sale({ occurredAt: new Date(2026, 8, 30, 23, 59).toISOString(), total: 1000, items: [{ productId: "p1", quantity: 1, unitCost: 1, lineTotal: 1000 }] }),
  // S7: exactly Nov 1 00:00 -> range end is EXCLUSIVE, so out.
  sale({ occurredAt: new Date(2026, 10, 1, 0, 0).toISOString(), total: 777, items: [{ productId: "p1", quantity: 1, unitCost: 1, lineTotal: 777 }] }),
  // S8: product that no longer exists, no snapshot -> unknown, excluded. Revenue 200.
  sale({ occurredAt: d(10, 10), total: 200, items: [{ productId: "ghost", quantity: 1, lineTotal: 200 }] }),
  // S9: snapshot cost recorded as exactly 0 -> counted at 0 but FLAGGED. Revenue 100.
  sale({ occurredAt: d(10, 11), total: 100, items: [{ productId: "p2", quantity: 1, unitCost: 0, lineTotal: 100 }] }),
  // S10: DISCOUNT. Line 200 less 50 discount -> sale total 150 is the revenue. Cost 1 × 100 = 100.
  sale({ occurredAt: d(10, 12), total: 150, discount: 50, items: [{ productId: "p1", quantity: 1, unitCost: 100, lineTotal: 200 }] }),
];
// Revenue = 300+150+300+500+200+100+150 = 1700
// COGS    = 160+90+150+0+0+0+100        =  500   (custom + unknown excluded, zero-cost counted at 0)
// Gross   = 1200

const expenses = [
  { date: d(10, 2), amount: 400, category: "Rent" },
  { date: d(10, 15), amount: 100, category: "Fuel" },
  { date: d(10, 20), amount: 50, category: "Rent" },
  { date: d(10, 21), amount: 9999, category: "Rent", isDeleted: true }, // soft-deleted -> ignored
  { date: new Date(2026, 10, 1, 0, 0).toISOString(), amount: 77, category: "Rent" }, // end boundary -> out
  { date: d(10, 25), amount: 30, category: "  " }, // blank -> Uncategorized
];
// Expenses = 400+100+50+30 = 580 ; Rent 450 (2), Fuel 100 (1), Uncategorized 30 (1)
// Net      = 1200 - 580 = 620

describe("computeProfitAndLoss — Revenue − COGS − Expenses", () => {
  const pl = computeProfitAndLoss({ sales, expenses, products, history, range: RANGE });

  it("revenue counts only completed sales inside [start, end), net of discount", () => {
    expect(pl.revenue).toBe(1700);
    expect(pl.salesCount).toBe(7);
  });

  it("COGS = 500: snapshot + history + estimate, custom/unknown excluded", () => {
    expect(pl.cogs).toBe(500);
    expect(pl.grossProfit).toBe(1200);
  });

  it("splits COGS by how trustworthy its source is", () => {
    // snapshot: S1 160 + S9 0 + S10 100 = 3 lines / 260
    expect(pl.cogsBySource.snapshot).toEqual({ lines: 3, amount: 260 });
    // history: S2 only (looked up by server id against rows stored under clientId)
    expect(pl.cogsBySource.history).toEqual({ lines: 1, amount: 90 });
    // estimate: S3 only
    expect(pl.cogsBySource.estimate).toEqual({ lines: 1, amount: 150 });
  });

  it("never counts un-costable lines as free — reports them instead", () => {
    expect(pl.excluded.custom).toEqual({ lines: 1, revenue: 500 });
    expect(pl.excluded.unknown).toEqual({ lines: 1, revenue: 200 });
    expect(pl.zeroCost).toEqual({ lines: 1, revenue: 100 });
  });

  it("expenses total ignores deleted and out-of-range rows", () => {
    expect(pl.expenses).toBe(580);
    expect(pl.expenseCount).toBe(4);
  });

  it("groups expenses by category, largest first, blank -> Uncategorized", () => {
    expect(pl.expensesByCategory).toEqual([
      { category: "Rent", total: 450, count: 2 },
      { category: "Fuel", total: 100, count: 1 },
      { category: "Uncategorized", total: 30, count: 1 },
    ]);
  });

  it("net profit = revenue − COGS − expenses", () => {
    expect(pl.netProfit).toBe(620);
    expect(pl.revenue - pl.cogs - pl.expenses).toBe(pl.netProfit);
  });

  it("margins are percentages of revenue", () => {
    expect(pl.grossMarginPct).toBe(70.59); // 1200/1700
    expect(pl.netMarginPct).toBe(36.47); // 620/1700
  });

  it("the three costed sources always add up to COGS", () => {
    const { snapshot, history: h, estimate } = pl.cogsBySource;
    expect(snapshot.amount + h.amount + estimate.amount).toBe(pl.cogs);
  });
});

describe("computeProfitAndLoss — edge cases", () => {
  it("an empty period is all zeros, with null margins (no divide-by-zero)", () => {
    const pl = computeProfitAndLoss({ sales: [], expenses: [], products, history: [], range: RANGE });
    expect(pl).toMatchObject({ revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0, grossMarginPct: null, netMarginPct: null });
    expect(pl.expensesByCategory).toEqual([]);
  });

  it("expenses with no sales is a loss, not an error", () => {
    const pl = computeProfitAndLoss({ sales: [], expenses: [{ date: d(10, 2), amount: 400, category: "Rent" }], products, history: [], range: RANGE });
    expect(pl.netProfit).toBe(-400);
    expect(pl.netMarginPct).toBeNull();
  });

  it("a snapshot always beats history and the current cost", () => {
    const one = [sale({ occurredAt: d(10, 6), total: 100, items: [{ productId: "p1", quantity: 1, unitCost: 55, lineTotal: 100 }] })];
    const pl = computeProfitAndLoss({ sales: one, expenses: [], products, history, range: RANGE });
    expect(pl.cogs).toBe(55);
    expect(pl.cogsBySource.snapshot.lines).toBe(1);
  });

  it("accepts string snapshot costs (as stored from a form) without concatenating", () => {
    const one = [sale({ occurredAt: d(10, 6), total: 100, items: [{ productId: "p1", quantity: 3, unitCost: "40", lineTotal: 100 }] })];
    expect(computeProfitAndLoss({ sales: one, expenses: [], products, history: [], range: RANGE }).cogs).toBe(120);
  });

  it("history lookup is time-correct: Oct 2 sees 70, Oct 6 sees 90", () => {
    const early = [sale({ occurredAt: d(10, 2), total: 100, items: [{ productId: "p1", quantity: 1, lineTotal: 100 }] })];
    const late = [sale({ occurredAt: d(10, 6), total: 100, items: [{ productId: "p1", quantity: 1, lineTotal: 100 }] })];
    expect(computeProfitAndLoss({ sales: early, expenses: [], products, history, range: RANGE }).cogs).toBe(70);
    expect(computeProfitAndLoss({ sales: late, expenses: [], products, history, range: RANGE }).cogs).toBe(90);
  });

  it("a sale BEFORE any history existed falls back to an estimate (history cannot answer)", () => {
    const old = [sale({ occurredAt: d(8, 15), total: 100, items: [{ productId: "p1", quantity: 1, lineTotal: 100 }] })];
    const wide = { start: new Date(2026, 7, 1), end: new Date(2026, 10, 1) };
    const pl = computeProfitAndLoss({ sales: old, expenses: [], products, history, range: wide });
    expect(pl.cogsBySource.estimate).toEqual({ lines: 1, amount: 100 }); // current cost, NOT the 70 baseline
    expect(pl.cogsBySource.history.lines).toBe(0);
  });

  it("sell-price history never contaminates the cost lookup", () => {
    // The product's rows live under BOTH of its ids; the union must find all of them.
    const rows = historyRowsForProduct(buildHistoryIndex(history), products[0]);
    expect(rows).toHaveLength(3);
    expect(priceAtFromRows(rows, "costPrice", d(10, 20))).toBe(90);
    expect(priceAtFromRows(rows, "sellPrice", d(10, 20))).toBe(9999);
  });
});

describe("expenses belong to a calendar DAY, not a moment", () => {
  // An expense picked for "today" is stored at local noon. A current-period
  // range ends at NOW. Logging one at 9am must still count immediately.
  it("an expense dated today (noon) counts in a range that ends at 9am today", () => {
    const todayNoon = new Date(2026, 9, 7, 12, 0).toISOString();
    const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 7, 9, 0) }; // "This Month" at 9am on the 7th
    const pl = computeProfitAndLoss({ sales: [], expenses: [{ date: todayNoon, amount: 250, category: "Fuel" }], products: [], history: [], range });
    expect(pl.expenses).toBe(250);
  });

  it("...and in the same-day 'Today' range", () => {
    const todayNoon = new Date(2026, 9, 7, 12, 0).toISOString();
    const range = { start: new Date(2026, 9, 7), end: new Date(2026, 9, 7, 9, 0) };
    expect(computeProfitAndLoss({ sales: [], expenses: [{ date: todayNoon, amount: 250 }], products: [], history: [], range }).expenses).toBe(250);
  });

  it("tomorrow's expense is still NOT in a range ending today", () => {
    const tomorrowNoon = new Date(2026, 9, 8, 12, 0).toISOString();
    const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 7, 9, 0) };
    expect(computeProfitAndLoss({ sales: [], expenses: [{ date: tomorrowNoon, amount: 250 }], products: [], history: [], range }).expenses).toBe(0);
  });

  it("the series places it on the right day instead of dropping or misplacing it", () => {
    const todayNoon = new Date(2026, 9, 7, 12, 0).toISOString();
    const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 7, 9, 0) };
    const s = buildIncomeExpenseSeries({ sales: [], expenses: [{ date: todayNoon, amount: 250 }], range, granularity: "day" });
    expect(s).toHaveLength(7);
    expect(s[6].expenses).toBe(250); // the 7th
    expect(s.slice(0, 6).every((b) => b.expenses === 0)).toBe(true);
  });

  it("summarizeExpenses (Expenses page cards) agrees with the P&L", () => {
    const todayNoon = new Date(2026, 9, 7, 12, 0).toISOString();
    const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 7, 9, 0) };
    expect(summarizeExpenses([{ date: todayNoon, amount: 250, category: "Fuel" }], range).total).toBe(250);
  });
});

describe("price lookup (priceAtFromRows)", () => {
  const rows = [
    { field: "costPrice", newValue: 100, changedAt: d(3, 1) },
    { field: "costPrice", newValue: 120, changedAt: d(6, 1) },
  ];
  it("null before the first row", () => expect(priceAtFromRows(rows, "costPrice", d(2, 1))).toBeNull());
  it("exactly at a change time uses that change", () => expect(priceAtFromRows(rows, "costPrice", d(6, 1))).toBe(120));
  it("between rows uses the earlier", () => expect(priceAtFromRows(rows, "costPrice", d(5, 1))).toBe(100));
  it("no rows -> null", () => expect(priceAtFromRows([], "costPrice", d(5, 1))).toBeNull());
  it("garbage time -> null, not a crash", () => expect(priceAtFromRows(rows, "costPrice", "nope")).toBeNull());
  it("toMoney rejects blanks/negatives/garbage but keeps 0", () => {
    expect([toMoney(""), toMoney(null), toMoney(-1), toMoney("x"), toMoney(0), toMoney("12.5")]).toEqual([null, null, null, null, 0, 12.5]);
  });
});

describe("describeAccuracy — the honesty labels", () => {
  it("says nothing when everything is an exact snapshot", () => {
    const one = [sale({ occurredAt: d(10, 6), total: 100, items: [{ productId: "p1", quantity: 1, unitCost: 55, lineTotal: 100 }] })];
    const pl = computeProfitAndLoss({ sales: one, expenses: [], products, history, range: RANGE });
    expect(describeAccuracy(pl)).toEqual([]);
  });

  it("flags estimates as warnings and history lookups as info", () => {
    const pl = computeProfitAndLoss({ sales, expenses, products, history, range: RANGE });
    const notes = describeAccuracy(pl, "RWF");
    const warn = notes.filter((n) => n.tone === "warn").map((n) => n.text).join(" | ");
    const info = notes.filter((n) => n.tone === "info").map((n) => n.text).join(" | ");
    expect(warn).toMatch(/ESTIMATE/);
    expect(warn).toMatch(/custom item/);
    expect(warn).toMatch(/no longer in your catalog/);
    expect(warn).toMatch(/costed at 0/);
    expect(info).toMatch(/price history/);
    expect(warn).toMatch(/150 RWF/); // the estimated amount is stated, not just "some"
  });
});

describe("income vs expenses series", () => {
  it("chooseGranularity: presets and custom ranges", () => {
    expect(chooseGranularity("today", RANGE, false)).toBe("hour");
    expect(chooseGranularity("month", RANGE, false)).toBe("day");
    expect(chooseGranularity("year", RANGE, false)).toBe("month");
    const day = { start: new Date(2026, 9, 5), end: new Date(2026, 9, 6) };
    const ten = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 11) };
    const long = { start: new Date(2026, 0, 1), end: new Date(2026, 9, 1) };
    expect(chooseGranularity("month", day, true)).toBe("hour");
    expect(chooseGranularity("month", ten, true)).toBe("day");
    expect(chooseGranularity("month", long, true)).toBe("month");
  });

  it("daily buckets cover the whole range and conserve totals", () => {
    const s = buildIncomeExpenseSeries({ sales, expenses, range: RANGE, granularity: "day" });
    expect(s).toHaveLength(31);
    expect(s.reduce((n, b) => n + b.income, 0)).toBe(1700);
    expect(s.reduce((n, b) => n + b.expenses, 0)).toBe(580);
  });

  it("puts each amount in the right day", () => {
    const s = buildIncomeExpenseSeries({ sales, expenses, range: RANGE, granularity: "day" });
    const oct5 = s.find((b) => new Date(b.date).getDate() === 5);
    const oct2 = s.find((b) => new Date(b.date).getDate() === 2);
    expect(oct5.income).toBe(300); // S1
    expect(oct2.expenses).toBe(400); // rent
    expect(s.find((b) => new Date(b.date).getDate() === 9).income).toBe(0); // voided S5 not counted
  });

  it("an in-progress range stops at its end (no future buckets)", () => {
    const partial = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 6, 12) };
    const s = buildIncomeExpenseSeries({ sales, expenses, range: partial, granularity: "day" });
    expect(s).toHaveLength(6);
  });

  it("monthly buckets across a year, labelled by month", () => {
    const year = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 1) };
    const s = buildIncomeExpenseSeries({ sales, expenses, range: year, granularity: "month" });
    expect(s).toHaveLength(11);
    expect(s[9].income).toBe(1700);
    expect(s[9].expenses).toBe(580);
    expect(s[9].fullLabel).toMatch(/October/);
  });

  it("hourly buckets for a single day", () => {
    const oneDay = { start: new Date(2026, 9, 5), end: new Date(2026, 9, 6) };
    const s = buildIncomeExpenseSeries({ sales, expenses, range: oneDay, granularity: "hour" });
    expect(s).toHaveLength(24);
    expect(s[12].income).toBe(300); // S1 at 12:00
    expect(s[12].label).toBe("12:00");
  });

  it("data outside the range never leaks in", () => {
    const narrow = { start: new Date(2026, 9, 5), end: new Date(2026, 9, 6) };
    const s = buildIncomeExpenseSeries({ sales, expenses, range: narrow, granularity: "day" });
    expect(s.reduce((n, b) => n + b.income, 0)).toBe(300);
    expect(s.reduce((n, b) => n + b.expenses, 0)).toBe(0);
  });

  it("an empty range yields no buckets rather than crashing", () => {
    const none = { start: new Date(2026, 9, 5), end: new Date(2026, 9, 5) };
    expect(buildIncomeExpenseSeries({ sales, expenses, range: none, granularity: "day" })).toEqual([]);
  });
});