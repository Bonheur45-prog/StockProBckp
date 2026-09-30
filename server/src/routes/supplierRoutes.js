import { Router } from "express";
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../controllers/supplierController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/", listSuppliers);
router.post("/", requireRole("owner", "manager"), createSupplier);
router.put("/:id", requireRole("owner", "manager"), updateSupplier);
router.delete("/:id", requireRole("owner", "manager"), deleteSupplier);

export default router;
