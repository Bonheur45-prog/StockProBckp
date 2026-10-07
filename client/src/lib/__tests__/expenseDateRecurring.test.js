import { describe, it, expect } from "vitest";
import { dateInputToIso, isoToDateInput } from "../dates.js";
import { periodWindow, findDueRecurring } from "../recurring.js";

describe("day picker <-> stored date (timezone-safe)", () => {
  it("a picked day round-trips to the SAME calendar day, in any timezone", () => {
    for (const day of ["2026-10-01", "2026-12-31", "2026-01-01", "2026-03-08", "2026-11-01", "2028-02-29"]) {
      expect(isoToDateInput(dateInputToIso(day))).toBe(day);
    }
  });

  it("is stored at local NOON, so it can never slip into the neighbouring day", () => {
    const d = new Date(dateInputToIso("2026-10-01"));
    expect(d.getHours()).toBe(12);
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(9); // October, not September
  });

  it("the 1st of a month stays in that month (the UTC-midnight bug would put it in the previous one)", () => {
    const first = new Date(dateInputToIso("2026-10-01"));
    expect(first >= new Date(2026, 9, 1) && first < new Date(2026, 10, 1)).toBe(true);
  });

  it("rejects impossible days instead of rolling them over", () => {
    expect(dateInputToIso("2026-02-31")).toBeNull();
    expect(dateInputToIso("2026-13-01")).toBeNull();
    expect(dateInputToIso("2027-02-29")).toBeNull();
  });

  it("rejects blanks and garbage", () => {
    for (const v of ["", null, undefined, "abc", "2026-1-1", "01/10/2026"]) expect(dateInputToIso(v)).toBeNull();
    expect(isoToDateInput("nope")).toBe("");
  });
});

describe("periodWindow", () => {
  const wed = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026
  it("monthly = calendar month", () => {
    const w = periodWindow("monthly", wed);
    expect(w.start).toEqual(new Date(2026, 9, 1));
    expect(w.end).toEqual(new Date(2026, 10, 1));
  });
  it("weekly = Monday-start week (Wed 7 Oct -> Mon 5 Oct .. Mon 12 Oct)", () => {
    const w = periodWindow("weekly", wed);
    expect(w.start).toEqual(new Date(2026, 9, 5));
    expect(w.end).toEqual(new Date(2026, 9, 12));
  });
  it("weekly on a Sunday still belongs to the week that STARTED the Monday before", () => {
    const sun = new Date(2026, 9, 11, 10, 0);
    expect(periodWindow("weekly", sun).start).toEqual(new Date(2026, 9, 5));
  });
  it("weekly on a Monday starts that same day", () => {
    expect(periodWindow("weekly", new Date(2026, 9, 5, 0, 1)).start).toEqual(new Date(2026, 9, 5));
  });
  it("weekly week can straddle a month boundary", () => {
    const w = periodWindow("weekly", new Date(2026, 10, 2, 9, 0)); // Mon 2 Nov
    expect(w.start).toEqual(new Date(2026, 10, 2));
    const w2 = periodWindow("weekly", new Date(2026, 9, 30, 9, 0)); // Fri 30 Oct
    expect(w2.start).toEqual(new Date(2026, 9, 26));
    expect(w2.end).toEqual(new Date(2026, 10, 2));
  });
});

describe("findDueRecurring — what 'Log this period's recurring expenses' offers", () => {
  const NOW = new Date(2026, 9, 7, 15, 0); // Wed 7 Oct 2026
  const rent = (over) => ({ clientId: "r1", recurringSeriesId: "rent", isRecurring: true, frequency: "monthly", category: "Rent", amount: 400, date: new Date(2026, 8, 1, 12).toISOString(), ...over });

  it("monthly: last logged in September -> due for October", () => {
    const due = findDueRecurring([rent()], NOW);
    expect(due).toHaveLength(1);
    expect(due[0].seriesId).toBe("rent");
    expect(due[0].periodLabel).toMatch(/October/);
  });

  it("monthly: already logged this month -> NOT due (no double-logging)", () => {
    expect(findDueRecurring([rent({ date: new Date(2026, 9, 2, 12).toISOString() })], NOW)).toEqual([]);
  });

  it("uses the LATEST entry of the series, not the first", () => {
    const entries = [rent({ clientId: "a", date: new Date(2026, 7, 1, 12).toISOString() }), rent({ clientId: "b", date: new Date(2026, 9, 1, 12).toISOString() })];
    expect(findDueRecurring(entries, NOW)).toEqual([]);
  });

  it("a series whose latest entry is no longer recurring has been STOPPED", () => {
    const entries = [rent({ clientId: "a", date: new Date(2026, 7, 1, 12).toISOString() }), rent({ clientId: "b", date: new Date(2026, 8, 1, 12).toISOString(), isRecurring: false, frequency: null })];
    expect(findDueRecurring(entries, NOW)).toEqual([]);
  });

  it("deleted entries don't count: deleting this month's rent makes it due again", () => {
    const entries = [rent({ clientId: "a" }), rent({ clientId: "b", date: new Date(2026, 9, 2, 12).toISOString(), isDeleted: true })];
    expect(findDueRecurring(entries, NOW)).toHaveLength(1);
  });

  it("weekly: last logged last week -> due; logged this Monday -> not", () => {
    const weekly = (date) => ({ clientId: "w", recurringSeriesId: "wage", isRecurring: true, frequency: "weekly", category: "Wages", amount: 50, date: date.toISOString() });
    expect(findDueRecurring([weekly(new Date(2026, 9, 1, 12))], NOW)).toHaveLength(1);
    expect(findDueRecurring([weekly(new Date(2026, 9, 5, 12))], NOW)).toEqual([]);
  });

  it("an entry dated in the FUTURE counts as already covering the period", () => {
    expect(findDueRecurring([rent({ date: new Date(2026, 10, 15, 12).toISOString() })], NOW)).toEqual([]);
  });

  it("ignores one-off expenses and malformed frequencies", () => {
    expect(findDueRecurring([{ clientId: "x", category: "Fuel", amount: 5, date: new Date(2026, 8, 1).toISOString() }], NOW)).toEqual([]);
    expect(findDueRecurring([rent({ frequency: "daily" })], NOW)).toEqual([]);
  });

  it("does NOT back-fill missed periods: three months behind still proposes just one", () => {
    expect(findDueRecurring([rent({ date: new Date(2026, 6, 1, 12).toISOString() })], NOW)).toHaveLength(1);
  });

  it("separate series are independent and sorted by category", () => {
    const entries = [
      rent({ clientId: "a" }),
      { clientId: "s", recurringSeriesId: "sal", isRecurring: true, frequency: "monthly", category: "Salaries", amount: 900, date: new Date(2026, 8, 25, 12).toISOString() },
      { clientId: "e", recurringSeriesId: "elec", isRecurring: true, frequency: "monthly", category: "Electricity", amount: 80, date: new Date(2026, 8, 10, 12).toISOString() },
    ];
    expect(findDueRecurring(entries, NOW).map((d) => d.template.category)).toEqual(["Electricity", "Rent", "Salaries"]);
  });
});