/**
 * A store's display status — shared by AdminStores.jsx and
 * AdminStoreDetail.jsx so they can never show two different answers for
 * the same store again (they did, before this existed: suspended beats
 * everything, then trial dates, then plain active).
 */
export function storeStatus(store) {
  if (!store.isActive) return { label: "Suspended", tone: "danger" };
  if (store.trialEndsAt && new Date(store.trialEndsAt) > new Date()) return { label: "Trial", tone: "amber" };
  if (store.trialEndsAt && new Date(store.trialEndsAt) <= new Date()) return { label: "Trial expired", tone: "amber" };
  return { label: "Active", tone: "success" };
}