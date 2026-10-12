import { useEffect, useState } from "react";
import { api } from "./api.js";

export const DEFAULT_AUTH_BACKGROUND = {
  mode: "default",
  color1: "#10151f",
  color2: "#2b3a55",
  imageUrl: "",
  overlay: 45,
  particleColor: "#d98e2b",
  particleCount: 70,
  particleSpeed: 2,
};

const CACHE_KEY = "authBackground";

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_AUTH_BACKGROUND, ...JSON.parse(raw) } : DEFAULT_AUTH_BACKGROUND;
  } catch {
    return DEFAULT_AUTH_BACKGROUND;
  }
}

/**
 * The login / create-store background chosen by the platform admin.
 * Shows the last known setting instantly (so the page never flashes or breaks
 * offline), then refreshes it from the server in the background.
 */
export function useAuthBackground() {
  const [settings, setSettings] = useState(readCache);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/public/auth-background")
      .then(({ data }) => {
        if (cancelled) return;
        const next = { ...DEFAULT_AUTH_BACKGROUND, ...data };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch {
          // storage unavailable: the live value still applies for this visit
        }
        setSettings(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
