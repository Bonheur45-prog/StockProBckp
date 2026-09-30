import { useMemo, useState } from "react";
import { getPeriodRange, getPeriodRangeLabel } from "../lib/repo.js";

/**
 * Tracks which period type ("today"/"month"/"year") and how far back
 * (`offset`, in units of that period) is currently being viewed. Switching
 * period type resets offset to 0 (the current, in-progress period) — going
 * back a few months then flipping to "Today" shouldn't leave you looking
 * at a random day.
 */
export function usePeriodNavigator(initialPeriod = "today") {
  const [period, setPeriodState] = useState(initialPeriod);
  const [offset, setOffset] = useState(0);

  const range = useMemo(() => getPeriodRange(period, offset), [period, offset]);
  const rangeLabel = useMemo(() => getPeriodRangeLabel(period, offset, range), [period, offset, range]);

  function setPeriod(p) {
    setPeriodState(p);
    setOffset(0);
  }

  function goBack() {
    setOffset((o) => o + 1);
  }

  function goForward() {
    setOffset((o) => Math.max(0, o - 1));
  }

  return { period, offset, range, rangeLabel, setPeriod, goBack, goForward, canGoForward: offset > 0 };
}
