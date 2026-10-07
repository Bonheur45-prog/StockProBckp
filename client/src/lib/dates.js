/**
 * Day-picker helpers. An <input type="date"> gives "YYYY-MM-DD" with no time
 * or zone. Parsing that with new Date("YYYY-MM-DD") yields UTC midnight, which
 * in any zone behind UTC (the Americas) is the PREVIOUS evening — an expense
 * dated "the 1st" would land on the 31st and in the wrong month's P&L.
 * So a picked day is stored as LOCAL NOON: comfortably inside that day for any
 * offset, and what the server and every range comparison then see.
 */

/** "YYYY-MM-DD" -> ISO string at local noon, or null if it isn't a real calendar day. */
export function dateInputToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Rejects overflow like 2026-02-31, which Date would silently roll into March.
  if (Number.isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.toISOString();
}

const pad = (n) => String(n).padStart(2, "0");

/** ISO/Date -> "YYYY-MM-DD" in LOCAL time (what a date input should display). */
export function isoToDateInput(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayDateInput() {
  return isoToDateInput(new Date());
}