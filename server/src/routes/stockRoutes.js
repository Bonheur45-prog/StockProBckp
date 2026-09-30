import { Router } from "express";
import { restock, adjustStock, listMovements } from "../controllers/stockController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/movements", listMovements);
router.post("/restock", requireRole("owner", "manager"), restock);
router.post("/adjust", requireRole("owner", "manager"), adjustStock);

export default router;
