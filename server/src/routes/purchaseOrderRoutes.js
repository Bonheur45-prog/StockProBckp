import { Router } from "express";
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  receivePurchaseOrder,
} from "../controllers/purchaseOrderController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/", listPurchaseOrders);
router.get("/:id", getPurchaseOrder);
router.post("/", requireRole("owner", "manager"), createPurchaseOrder);
router.put("/:id", requireRole("owner", "manager"), updatePurchaseOrder);
router.post("/:id/receive", requireRole("owner", "manager"), receivePurchaseOrder);

export default router;
