import { Router } from "express";
import { protectAdmin } from "../middleware/auth.js";
import {
  listStores,
  getStoreDetail,
  updateStoreAdmin,
  getDashboard,
  searchUsers,
  resetUserPassword,
} from "../controllers/adminController.js";

const router = Router();

router.use(protectAdmin);

router.get("/dashboard", getDashboard);
router.get("/stores", listStores);
router.get("/stores/:id", getStoreDetail);
router.put("/stores/:id", updateStoreAdmin);
router.get("/users", searchUsers);
router.put("/users/:id/reset-password", resetUserPassword);

export default router;