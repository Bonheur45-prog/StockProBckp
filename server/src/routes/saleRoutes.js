import { Router } from "express";
import { createSale, listSales, getSale, voidSale } from "../controllers/saleController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/", listSales);
router.get("/:id", getSale);
router.post("/", createSale);
router.post("/:id/void", requireRole("owner", "manager"), voidSale);

export default router;
