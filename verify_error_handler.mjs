import { errorHandler } from "./server/src/middleware/errorHandler.js";

function mockRes() {
  const res = {
    statusCode: 200, // Express's real default before anything is sent
    _sent: null,
    _status: null,
    status(code) { this.statusCode = code; this._status = code; return this; },
    json(body) { this._sent = body; return this; },
  };
  return res;
}

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) pass++;
  else { fail++; console.log("FAIL:", desc); }
}

// --- The exact reported bug: an unexpected DB/driver error during login ---
{
  const res = mockRes(); // nobody called res.status() — genuinely unexpected error
  const err = new Error("getaddrinfo ENOTFOUND bonheurmongoo-shard-00-00.9ukep.mongodb.net");
  errorHandler(err, {}, res, () => {});
  check("unexpected error: status defaults to 500", res._status === 500);
  check("unexpected error: raw message NOT leaked to client", !res._sent.message.includes("mongodb.net"));
  check("unexpected error: generic safe message shown instead", res._sent.message === "Something went wrong on our end. Please try again in a moment.");
}

// --- A deliberate, expected validation error (e.g. "Invalid credentials") ---
{
  const res = mockRes();
  res.status(401); // login controller would call this before throwing
  const err = new Error("Invalid credentials");
  errorHandler(err, {}, res, () => {});
  check("deliberate 401 error: status preserved", res._status === 401);
  check("deliberate 401 error: real message shown verbatim (this is intended)", res._sent.message === "Invalid credentials");
}

// --- A deliberate 400 from this session's own validation work ---
{
  const res = mockRes();
  res.status(400);
  const err = new Error("Discount (10000) cannot exceed subtotal (5000)");
  errorHandler(err, {}, res, () => {});
  check("deliberate 400 error: status preserved", res._status === 400);
  check("deliberate 400 error: real message shown verbatim", res._sent.message === "Discount (10000) cannot exceed subtotal (5000)");
}

// --- requireRole's 403 ---
{
  const res = mockRes();
  res.status(403);
  const err = new Error("You don't have permission to do that");
  errorHandler(err, {}, res, () => {});
  check("403 error: status preserved and message shown", res._status === 403 && res._sent.message === "You don't have permission to do that");
}

// --- An error object that happens to carry err.statusCode but res.status() was never called (shouldn't matter — only res.statusCode is trusted) ---
{
  const res = mockRes();
  const err = Object.assign(new Error("some internal detail"), { statusCode: 400 });
  errorHandler(err, {}, res, () => {});
  check("err.statusCode alone (no res.status() call) is NOT trusted — still treated as unexpected", res._status === 500 && !res._sent.message.includes("internal detail"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
