// Boots the real Express app (no DB) and checks CORS fail-closed behaviour.
process.env.NODE_ENV = "production";
process.env.CLIENT_ORIGINS = "https://good.example";
process.env.JWT_SECRET = "z".repeat(40);
const { default: app } = await import("../src/app.js");
let pass = 0, fail = 0;
const ok = (d, c) => (c ? pass++ : (fail++, console.log("FAIL:", d)));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = (origin) => fetch(`${base}/api/health`, { headers: origin ? { Origin: origin } : {} });
ok("allowed origin gets ACAO", (await get("https://good.example")).headers.get("access-control-allow-origin") === "https://good.example");
ok("other origin gets no ACAO", !(await get("https://evil.example")).headers.get("access-control-allow-origin"));
const unauth = await fetch(`${base}/api/reports/activity`);
ok("reports require login", unauth.status === 401);
const adminUnauth = await fetch(`${base}/api/admin/stores`);
ok("admin requires login", adminUnauth.status === 401);
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
