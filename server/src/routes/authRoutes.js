import { Router } from "express";
import rateLimit from "express-rate-limit";
import { registerStore, login, getMe, updateMe, inviteTeammate, listTeammates, updateTeammate } from "../controllers/authController.js";
import { protect, requireRole } from "../middleware/auth.js";

const router = Router();

/**
 * Limits repeated attempts against unauthenticated auth endpoints
 * (password-guessing on login, registration spam) — keyed per IP, not
 * per account, since the attacker controls which email they submit but
 * not which IP they're rate-limited under. 10 attempts per 15 minutes is
 * generous enough that a real user mistyping their password a few times
 * never notices it, while still cutting a brute-force attempt down to a
 * pace that's no longer practical.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait a few minutes and try again." },
});

router.post("/register-store", authLimiter, registerStore);
router.post("/login", authLimiter, login);
router.get("/me", protect, getMe);
router.put("/me", protect, updateMe);
router.post("/invite", protect, requireRole("owner"), inviteTeammate);
router.get("/users", protect, requireRole("owner", "manager"), listTeammates);
router.put("/users/:id", protect, requireRole("owner"), updateTeammate);

export default router;