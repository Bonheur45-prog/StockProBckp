/**
 * Abbreviates a number for tight spaces (chart axis labels on a phone
 * screen) — 1400000 -> "1.4M", 700000 -> "700K". Only used for axis
 * ticks; tooltips and receipts keep full toLocaleString() numbers since
 * there's room for them there.
 */
export function formatCompactNumber(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trimTrailingZero(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimTrailingZero(n / 1_000)}K`;
  return `${n}`;
}

function trimTrailingZero(n) {
  return Number(n.toFixed(1)).toString();
}