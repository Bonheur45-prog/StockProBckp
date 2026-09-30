import { Router } from "express";
import { customerBalances, listPayments, recordPayment } from "../controllers/creditController.js";
import { protect } from "../middleware/auth.js";

const router = Router();

router.use(protect);

router.get("/balances", customerBalances);
router.get("/payments", listPayments);
router.post("/payments", recordPayment);

export default router;
