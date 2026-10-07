import { EXPENSE_FREQUENCIES } from "./expenseMeta.js";

/**
 * Recurring expenses are MANUAL by design: nothing is ever created on a
 * timer. "Log this period's recurring expenses" calls findDueRecurring to
 * show what's missing for the CURRENT month/week; the owner/manager reviews
 * the amounts and confirms.
 *
 * A "series" is every expense sharing one recurringSeriesId (rent, salaries…).
 * Its template is the LATEST entry of the series:
 *   - template.isRecurring false  -> the series was stopped; never due again.
 *   - template dated before the current period began -> due.
 *   - template dated this period (or later)          -> already logged.
 * Only the current period is ever proposed — missed past periods are NOT
 * back-filled (guessing old amounts into old months would silently rewrite
 * past profit); the owner can add those by hand if they really want them.
 */

/** The calendar month (monthly) or Monday-start week (weekly) containing `now`. */
export function periodWindow(frequency, now = new Date()) {
  if (frequency === "weekly") {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday + 7);
    return { start, end, label: `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
}

function isLater(a, b) {
  const da = new Date(a.date).getTime();
  const db = new Date(b.date).getTime();
  if (da !== db) return da > db;
  return new Date(a.createdAt || a.updatedAt || 0).getTime() > new Date(b.createdAt || b.updatedAt || 0).getTime();
}

export function findDueRecurring(expenses, now = new Date()) {
  const latestBySeries = new Map();
  for (const e of expenses) {
    if (e.isDeleted || !e.recurringSeriesId) continue;
    const current = latestBySeries.get(e.recurringSeriesId);
    if (!current || isLater(e, current)) latestBySeries.set(e.recurringSeriesId, e);
  }

  const due = [];
  for (const [seriesId, template] of latestBySeries) {
    if (!template.isRecurring || !EXPENSE_FREQUENCIES.includes(template.frequency)) continue;
    const window = periodWindow(template.frequency, now);
    if (new Date(template.date) >= window.start) continue; // already logged for this period
    due.push({ seriesId, template, frequency: template.frequency, periodLabel: window.label });
  }
  return due.sort((a, b) => (a.template.category || "").localeCompare(b.template.category || "") || (a.template.description || "").localeCompare(b.template.description || ""));
}