export function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Route not found: ${req.originalUrl}`));
}

/**
 * Every deliberate, expected error throughout this app follows the same
 * convention: the code that raises it explicitly calls res.status(4xx)
 * before throwing (see protect/requireRole in auth.js, or the
 * res.status(err.statusCode || 500) pattern in saleController.js,
 * purchaseOrderController.js, etc.) — so by the time an error reaches
 * here, res.statusCode already tells us whether it was anticipated.
 *
 * Anything that reaches here WITHOUT having gone through that — meaning
 * res.statusCode is still whatever Express defaults it to — is by
 * definition something nobody anticipated: a bug, a database or network
 * failure, a library throwing something unexpected. Its real .message can
 * contain internal details that should never reach an end user. This is
 * exactly how a raw MongoDB driver error ("getaddrinfo ENOTFOUND
 * <cluster-hostname>", from a DNS failure reaching Atlas) once reached
 * the login screen verbatim — nothing distinguished it from a deliberate,
 * safe message like "Invalid credentials", so it got the same treatment.
 *
 * Only a genuine 4xx (client-error) status is treated as "safe to show
 * verbatim" — an explicit 5xx is left as unexpected too, since by REST
 * convention 5xx means "our fault", not a deliberate user-facing message.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  const isKnownClientError = statusCode >= 400 && statusCode < 500;

  if (!isKnownClientError) {
    console.error("[unhandled server error]", err);
  }

  res.status(statusCode).json({
    message: isKnownClientError ? (err.message || "Something went wrong") : "Something went wrong on our end. Please try again in a moment.",
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
}
