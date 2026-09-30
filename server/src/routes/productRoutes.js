import { Router } from "express";
import { listProducts, getProduct, createProduct, updateProduct, deleteProduct } from "../controllers/productController.js";
import { protect, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();

router.use(protect);

router.get("/", listProducts);
router.get("/:id", getProduct);
router.post("/", requireRole("owner", "manager"), upload.single("image"), createProduct);
router.put("/:id", requireRole("owner", "manager"), upload.single("image"), updateProduct);
router.delete("/:id", requireRole("owner", "manager"), deleteProduct);

export default router;
