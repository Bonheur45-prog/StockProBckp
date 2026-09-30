import { Router } from "express";
import { pull, push, uploadQueuedImage } from "../controllers/syncController.js";
import { protect } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();

router.use(protect);

router.get("/pull", pull);
router.post("/push", push);
router.post("/upload-queued-image", upload.single("image"), uploadQueuedImage);

export default router;
