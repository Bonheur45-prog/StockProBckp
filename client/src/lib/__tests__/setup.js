import "fake-indexeddb/auto";
import { vi } from "vitest";

// Minimal localStorage polyfill — repo.js reads the logged-in user from it
// to determine the current storeId, so tests need a real (if tiny)
// implementation, not just a mock function.
if (typeof localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

// Node 21+ defines a minimal built-in `navigator` global (no `onLine`
// property on it), so the old "only set it if navigator is undefined"
// guard never actually fired here — navigator.onLine was silently
// undefined in every test run, meaning runSync()'s `if (!navigator.onLine)
// return` guard always treated every test as offline. This went unnoticed
// because every test file until tenantSwitch.test.js either used the
// global sync.js mock below (runSync is a no-op stub, this never
// mattered) or triggered runSync() fire-and-forget without checking its
// effect. Set directly, not gated on `typeof navigator === "undefined"`.
if (typeof navigator === "undefined") {
  globalThis.navigator = { onLine: true };
} else {
  navigator.onLine = true;
}

// Tests exercise the local-first data layer only — never trigger a real
// sync/network call while doing it.
vi.mock("../sync.js", () => ({
  runSync: vi.fn().mockResolvedValue({ skipped: true }),
  onSyncStatusChange: vi.fn(() => () => {}),
  getLastSyncErrors: vi.fn(() => []),
  pendingChangeCount: vi.fn().mockResolvedValue(0),
  initSyncLoop: vi.fn(() => () => {}),
}));
