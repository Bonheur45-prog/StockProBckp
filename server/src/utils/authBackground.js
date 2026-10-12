// Validation for the login / create-store page background. Everything here
// ends up inside CSS or a canvas on a PUBLIC page, so only strictly checked
// values are ever stored (no free text that could carry CSS or script).

export const MODES = ["default", "color", "gradient", "image", "particles", "space"];

export const DEFAULT_AUTH_BACKGROUND = {
  mode: "default",
  color1: "#10151f",
  color2: "#2b3a55",
  imageUrl: "",
  overlay: 45, // % of dark tint over an image so text stays readable
  particleColor: "#d98e2b",
  particleCount: 70,
  particleSpeed: 2, // 1 (slow) .. 5 (fast)
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Only images uploaded through our own Cloudinary account are accepted.
export function isAllowedImageUrl(url) {
  if (typeof url !== "string" || url === "") return url === "";
  if (url.length > 500 || /["'()\s\\]/.test(url)) return false;
  try {
    const u = new URL(url);
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    return u.protocol === "https:" && u.hostname === "res.cloudinary.com" && (!cloud || u.pathname.startsWith(`/${cloud}/`));
  } catch {
    return false;
  }
}

/** Returns { value } with a clean object, or { error } with a message. */
export function sanitizeAuthBackground(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid settings" };
  const d = DEFAULT_AUTH_BACKGROUND;
  if (!MODES.includes(input.mode)) return { error: "Unknown background type" };
  for (const f of ["color1", "color2", "particleColor"]) {
    if (input[f] !== undefined && !HEX.test(input[f])) return { error: `${f} must be a colour like #1a2b3c` };
  }
  if (input.imageUrl !== undefined && !isAllowedImageUrl(input.imageUrl)) return { error: "Image must be uploaded through the uploader" };

  const value = {
    mode: input.mode,
    color1: input.color1 ?? d.color1,
    color2: input.color2 ?? d.color2,
    imageUrl: input.imageUrl ?? d.imageUrl,
    overlay: clampInt(input.overlay, 0, 80, d.overlay),
    particleColor: input.particleColor ?? d.particleColor,
    particleCount: clampInt(input.particleCount, 20, 150, d.particleCount),
    particleSpeed: clampInt(input.particleSpeed, 1, 5, d.particleSpeed),
  };
  if (value.mode === "image" && !value.imageUrl) return { error: "Upload an image first, or pick another background type" };
  return { value };
}

/** Reads whatever is stored and always returns a safe, complete object. */
export function normalizeStored(stored) {
  const r = sanitizeAuthBackground({ ...DEFAULT_AUTH_BACKGROUND, ...(stored || {}) });
  return r.value || { ...DEFAULT_AUTH_BACKGROUND };
}
