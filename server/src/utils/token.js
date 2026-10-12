import jwt from "jsonwebtoken";

export function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

/**
 * True when a token was issued before the user's last password change.
 * JWT `iat` has whole-second precision, so compare in whole seconds: a token
 * issued in the same second as the change (e.g. the fresh one handed back
 * right after a password change) must still be accepted.
 */
export function tokenPredatesPasswordChange(decoded, passwordChangedAt) {
  if (!passwordChangedAt || !decoded || typeof decoded.iat !== "number") return false;
  return decoded.iat < Math.floor(new Date(passwordChangedAt).getTime() / 1000);
}
