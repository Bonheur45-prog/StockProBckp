import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPublicProduct } from "../controllers/publicController.js";
import { getPublicAuthBackground } from "../controllers/authBackgroundController.js";

const router = Router();

// Anonymous endpoint: cap lookups per IP so it can't be used to enumerate
// store codes or barcodes. Generous enough for customers scanning in a shop
// that shares one connection.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down." },
});

// Deliberately no router.use(protect) here — this whole file exists to be
// reachable without a login, unlike every other route file in this app.
router.use(publicLimiter);
router.get("/auth-background", getPublicAuthBackground);
router.get("/:storeSlug/products/:barcode", getPublicProduct);

export default router;