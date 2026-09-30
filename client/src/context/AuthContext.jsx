import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api.js";
import { clearLocalData } from "../lib/db.js";
import { runSync } from "../lib/sync.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });
  const [store, setStore] = useState(() => {
    const raw = localStorage.getItem("store");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  const persist = useCallback(async (token, userObj, storeObj) => {
    // Switching to a different store on this device than whatever was
    // last logged in here — the local cache could still hold that
    // previous store's data. The repo layer already filters every read
    // by storeId (so this was never actually a security hole for reads),
    // but clearing here stops the on-device cache from silently
    // accumulating more than one store's data over time, and guarantees a
    // clean full resync for the store being logged into now. Skipped when
    // it's the same store re-authenticating (e.g. an expired token), so we
    // don't discard any of that session's still-unsynced work.
    //
    // Deliberately keyed on its own dedicated "lastStoreId" marker, not on
    // the "user" object. The 401 interceptor in api.js clears "token" and
    // "user" on any auth failure (so an expired-token 401 doesn't leave a
    // stale session lying around) — but that meant a 401 followed by
    // logging into a DIFFERENT store found no previous "user" to compare
    // against, silently skipped clearLocalData(), and let the old store's
    // dirty records ride along into the new store's session (the server
    // trusts whatever storeId the new token carries, not what's in the
    // record body, so they'd get silently written into the wrong tenant).
    // "lastStoreId" only exists for this one comparison and only this
    // function touches it, so it can't be quietly broken again by some
    // future, unrelated change to what the 401 handler clears.
    const previousStoreId = localStorage.getItem("lastStoreId");
    if (previousStoreId && previousStoreId !== String(userObj.storeId)) {
      await clearLocalData();
    }

    localStorage.setItem("lastStoreId", String(userObj.storeId));
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userObj));
    if (storeObj) localStorage.setItem("store", JSON.stringify(storeObj));
    setUser(userObj);
    if (storeObj) setStore(storeObj);
  }, []);

  const login = useCallback(
    async ({ email, password, storeSlug }) => {
      setLoading(true);
      try {
        const { data } = await api.post("/auth/login", { email, password, storeSlug });
        await persist(data.token, data.user, data.store);
        runSync();
        return data.user;
      } finally {
        setLoading(false);
      }
    },
    [persist]
  );

  const registerStore = useCallback(
    async (fields) => {
      setLoading(true);
      try {
        const { data } = await api.post("/auth/register-store", fields);
        await persist(data.token, data.user, data.store);
        runSync();
        return data.user;
      } finally {
        setLoading(false);
      }
    },
    [persist]
  );

  const logout = useCallback(async () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("store");
    await clearLocalData();
    setUser(null);
    setStore(null);
  }, []);

  // Called after Settings saves a change, so the rest of the app (sidebar,
  // stat cards, receipts) reflects the new name/store info immediately
  // without needing a full reload.
  const updateUser = useCallback((userObj) => {
    localStorage.setItem("user", JSON.stringify(userObj));
    setUser(userObj);
  }, []);

  const updateStore = useCallback((storeObj) => {
    localStorage.setItem("store", JSON.stringify(storeObj));
    setStore(storeObj);
  }, []);

  // On first load, if we have a token, fetch fresh /me (works fine to skip
  // when offline — cached user from localStorage keeps the app usable).
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !navigator.onLine) return;
    api
      .get("/auth/me")
      .then(({ data }) => {
        localStorage.setItem("user", JSON.stringify(data.user));
        localStorage.setItem("store", JSON.stringify(data.store));
        setUser(data.user);
        setStore(data.store);
      })
      .catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, store, loading, login, registerStore, logout, updateUser, updateStore, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}