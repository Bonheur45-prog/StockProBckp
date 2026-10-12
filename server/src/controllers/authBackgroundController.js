import asyncHandler from "express-async-handler";
import PlatformSetting from "../models/PlatformSetting.js";
import { uploadBufferToCloudinary } from "../config/cloudinary.js";
import cloudinary from "../config/cloudinary.js";
import { sanitizeAuthBackground, normalizeStored } from "../utils/authBackground.js";

const KEY = "auth-background";

async function load() {
  const doc = await PlatformSetting.findOne({ key: KEY });
  return { doc, value: normalizeStored(doc?.value) };
}

// GET /api/public/auth-background  (no login: the login page needs it)
export const getPublicAuthBackground = asyncHandler(async (req, res) => {
  const { value } = await load();
  res.set("Cache-Control", "public, max-age=60");
  res.json(value);
});

// GET /api/admin/auth-background
export const getAdminAuthBackground = asyncHandler(async (req, res) => {
  const { value } = await load();
  res.json(value);
});

// PUT /api/admin/auth-background
export const updateAuthBackground = asyncHandler(async (req, res) => {
  const { value, error } = sanitizeAuthBackground(req.body);
  if (error) {
    res.status(400);
    throw new Error(error);
  }
  // Keep the stored image id (never sent to browsers) while the same image is in use.
  const { doc } = await load();
  const stored = doc?.value || {};
  const imagePublicId = stored.imageUrl && stored.imageUrl === value.imageUrl ? stored.imagePublicId : undefined;
  await PlatformSetting.findOneAndUpdate({ key: KEY }, { key: KEY, value: { ...value, imagePublicId } }, { upsert: true, new: true });
  res.json(value);
});

// POST /api/admin/auth-background/image  (multipart, field "image")
export const uploadAuthBackgroundImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Choose an image to upload");
  }
  const result = await uploadBufferToCloudinary(req.file.buffer, {
    folder: "hardware-saas/platform/auth-background",
    transformation: [{ width: 2000, height: 1400, crop: "limit" }, { quality: "auto:good" }, { fetch_format: "auto" }],
  });

  // Best effort: remove the previous background image so old uploads don't pile up.
  const { doc, value } = await load();
  const oldId = doc?.value?.imagePublicId;
  await PlatformSetting.findOneAndUpdate(
    { key: KEY },
    { key: KEY, value: { ...value, imageUrl: result.secure_url, imagePublicId: result.public_id } },
    { upsert: true, new: true }
  );
  if (oldId && oldId !== result.public_id) cloudinary.uploader.destroy(oldId).catch(() => {});

  res.json({ imageUrl: result.secure_url });
});
