import { Router } from "express";
import { dashboard, salesOverTime, topProducts, lowStock, activityFeed, staffPerformance } from "../controllers/reportController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/dashboard", dashboard);
router.get("/sales-over-time", salesOverTime);
router.get("/top-products", topProducts);
router.get("/low-stock", lowStock);
router.get("/activity", activityFeed);
router.get("/staff-performance", requireRole("owner", "manager"), staffPerformance);

export default router;
