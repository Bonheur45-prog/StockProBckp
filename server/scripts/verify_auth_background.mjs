// Verifies validation of the login-page background settings (they end up in CSS
// on a public page, so anything unexpected must be rejected).
// Run from server/:   node scripts/verify_auth_background.mjs
process.env.CLOUDINARY_CLOUD_NAME = "democloud";
const { sanitizeAuthBackground, normalizeStored, isAllowedImageUrl } = await import("../src/utils/authBackground.js");

let pass = 0, fail = 0;
const ok = (d, c) => (c ? pass++ : (fail++, console.log("FAIL:", d)));
const good = "https://res.cloudinary.com/democloud/image/upload/v1/a.jpg";

ok("default mode accepted", !!sanitizeAuthBackground({ mode: "default" }).value);
ok("both particle styles accepted", !!sanitizeAuthBackground({ mode: "particles" }).value && !!sanitizeAuthBackground({ mode: "space" }).value);
ok("unknown mode rejected", !!sanitizeAuthBackground({ mode: "evil" }).error);
ok("css injection in colour rejected", !!sanitizeAuthBackground({ mode: "color", color1: "red;} body{display:none" }).error);
ok("short hex rejected", !!sanitizeAuthBackground({ mode: "color", color1: "#fff" }).error);
ok("non-object rejected", !!sanitizeAuthBackground("x").error && !!sanitizeAuthBackground(null).error && !!sanitizeAuthBackground([]).error);
ok("foreign image host rejected", !isAllowedImageUrl("https://evil.example/a.jpg"));
ok("other cloudinary account rejected", !isAllowedImageUrl("https://res.cloudinary.com/other/image/upload/a.jpg"));
ok("http image rejected", !isAllowedImageUrl("http://res.cloudinary.com/democloud/a.jpg"));
ok("quote/paren in url rejected", !isAllowedImageUrl(good + '")'));
ok("own cloudinary image accepted", isAllowedImageUrl(good));
ok("image mode without image rejected", !!sanitizeAuthBackground({ mode: "image" }).error);
ok("image mode with image accepted", sanitizeAuthBackground({ mode: "image", imageUrl: good }).value?.imageUrl === good);
const p = sanitizeAuthBackground({ mode: "particles", particleCount: 99999, particleSpeed: -3, overlay: 500 }).value;
ok("numbers clamped", p.particleCount === 150 && p.particleSpeed === 1 && p.overlay === 80);
ok("unknown fields dropped", !("evil" in sanitizeAuthBackground({ mode: "color", evil: "x" }).value));
ok("public view never exposes the image id", !("imagePublicId" in normalizeStored({ mode: "image", imageUrl: good, imagePublicId: "secret" })));
ok("corrupt stored value falls back to default", normalizeStored({ mode: "image", imageUrl: "javascript:alert(1)" }).mode === "default");
ok("nothing stored -> default", normalizeStored(undefined).mode === "default");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
