// Fail closed: in production the server refuses to start with a missing or
// weak security setting instead of silently running open.
export function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const problems = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  }
  if (!(env.CLIENT_ORIGINS || "").split(",").some((s) => s.trim())) {
    problems.push("CLIENT_ORIGINS must list the allowed web origin(s)");
  }
  if (!env.MONGO_URI) problems.push("MONGO_URI must be set");
  if (problems.length) {
    throw new Error("Unsafe production configuration:\n - " + problems.join("\n - "));
  }
}
