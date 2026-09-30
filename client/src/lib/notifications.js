const NOTIFIED_KEY = "lowStockNotifiedIds";

export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Notifies once per product per "low stock episode" — we track which
 * clientIds we've already alerted on in localStorage so a restock later
 * (which removes the id from this set) lets a future dip notify again,
 * without re-notifying every 5s while it stays low.
 */
export function notifyLowStock(lowStockProducts) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const alreadyNotified = new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "[]"));
  const currentLowIds = new Set(lowStockProducts.map((p) => p.clientId));
  const toNotify = lowStockProducts.filter((p) => !alreadyNotified.has(p.clientId));

  if (toNotify.length > 0) {
    const title = toNotify.length === 1 ? `${toNotify[0].name} is running low` : `${toNotify.length} products are running low`;
    const body = toNotify.length === 1
      ? `${toNotify[0].quantityOnHand} left, below your alert threshold.`
      : toNotify.slice(0, 3).map((p) => p.name).join(", ") + (toNotify.length > 3 ? "…" : "");
    new Notification(title, { body, tag: "low-stock" });
  }

  // Keep only ids still currently low, so a restock clears their "already notified" state.
  const stillRelevant = [...alreadyNotified, ...toNotify.map((p) => p.clientId)].filter((id) => currentLowIds.has(id));
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(stillRelevant));
}
