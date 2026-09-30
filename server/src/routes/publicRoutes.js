import { Router } from "express";
import { getPublicProduct } from "../controllers/publicController.js";

const router = Router();

// Deliberately no router.use(protect) here — this whole file exists to be
// reachable without a login, unlike every other route file in this app.
router.get("/:storeSlug/products/:barcode", getPublicProduct);

export default router;