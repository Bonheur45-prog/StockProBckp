import { Router } from "express";
import { updateStore } from "../controllers/storeController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.put("/", requireRole("owner", "manager"), updateStore);

export default router;
