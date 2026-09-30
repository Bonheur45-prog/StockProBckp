import { useEffect, useState } from "react";

// Same breakpoint as Layout.module.css and every page's own mobile media
// query — kept as one constant so a future breakpoint change only has to
// happen in one place for CSS and (via this hook) for chart JS.
const MOBILE_QUERY = "(max-width: 860px)";

/**
 * Tracks whether the viewport is at or below the app's mobile breakpoint.
 * CSS media queries can't reach into chart libraries like Recharts (tick
 * density, dot size, axis number formatting are all decided in JS at
 * render time) — this hook is how those pieces find out they're on a
 * phone. Anything that's purely visual/CSS should keep using a media
 * query instead; reach for this only when JS actually needs the answer.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}