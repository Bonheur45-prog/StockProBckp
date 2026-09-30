import styles from "./StockGauge.module.css";

/**
 * Renders stock level as a notched ruler — a nod to the tape-measure,
 * the one tool every hardware store has in every aisle. Ticks fill from
 * left to right; color communicates status at a glance without needing
 * to read the number first.
 */
export default function StockGauge({ quantity, threshold = 5, max }) {
  const ceiling = max || Math.max(threshold * 3, quantity, 10);
  const ratio = Math.max(0, Math.min(1, quantity / ceiling));
  const tickCount = 12;
  const filledTicks = Math.round(ratio * tickCount);

  let status = "healthy";
  if (quantity <= 0) status = "out";
  else if (quantity <= threshold) status = "low";

  return (
    <div className={styles.wrap} role="img" aria-label={`${quantity} in stock, threshold ${threshold}`}>
      <div className={styles.ticks} data-status={status}>
        {Array.from({ length: tickCount }).map((_, i) => (
          <span key={i} className={styles.tick} data-filled={i < filledTicks} />
        ))}
      </div>
      <span className={styles.label} data-status={status}>
        {quantity} {status === "low" && "· low"}
        {status === "out" && "· out"}
      </span>
    </div>
  );
}
