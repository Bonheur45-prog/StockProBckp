import { Router } from "express";
import { protectAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { getAdminAuthBackground, updateAuthBackground, uploadAuthBackgroundImage } from "../controllers/authBackgroundController.js";
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
router.get("/auth-background", getAdminAuthBackground);
router.put("/auth-background", updateAuthBackground);
router.post("/auth-background/image", upload.single("image"), uploadAuthBackgroundImage);

export default router;