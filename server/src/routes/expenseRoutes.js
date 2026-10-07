import { Router } from "express";
import { listExpenses, createExpense, updateExpense, deleteExpense } from "../controllers/expenseController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(protect);

// Expenses are business-sensitive: even READING them is owner/manager only
// (cashiers have no business seeing rent or salaries).
router.get("/", requireRole("owner", "manager"), listExpenses);
// Owner + manager can add. Only the owner can edit or delete — the same
// rule is enforced again inside performUpsertExpense so the sync push
// can't bypass it.
router.post("/", requireRole("owner", "manager"), createExpense);
router.put("/:id", requireRole("owner"), updateExpense);
router.delete("/:id", requireRole("owner"), deleteExpense);

export default router;