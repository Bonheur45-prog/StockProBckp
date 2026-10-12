// Runs every verify_*.mjs script (server/scripts and the repo root) and fails
// if any of them fails.   Usage (from server/):  npm test
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const rootDir = path.resolve(serverDir, "..");
const files = [
  ...readdirSync(here).filter((f) => /^verify_.*\.mjs$/.test(f)).map((f) => path.join(here, f)),
  ...readdirSync(rootDir).filter((f) => /^verify_.*\.mjs$/.test(f)).map((f) => path.join(rootDir, f)),
];

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, [file], { cwd: serverDir, encoding: "utf8", env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || "test-secret-test-secret-test-secret" } });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${path.relative(rootDir, file)}`);
  if (!ok) console.log(r.stdout, r.stderr);
}
console.log(failed ? `\n${failed} script(s) failed` : `\nall ${files.length} scripts passed`);
process.exit(failed ? 1 : 0);
