import { useEffect, useRef } from "react";
import styles from "./AuthBackground.module.css";

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return Number.isNaN(n) ? [217, 142, 43] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Deep-space starfield: three depth layers drifting slowly (far stars barely
 * move, near ones a little faster), gentle twinkle, soft nebula glows tinted by
 * the chosen colour, and a rare faint shooting star. Pauses when the tab is
 * hidden; shows one still frame when the visitor prefers reduced motion.
 */
function SpaceCanvas({ color, count, speed }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [r, g, b] = hexToRgb(color);
    let w = 0;
    let h = 0;
    let raf = 0;
    let stars = [];
    let nebula = null; // pre-drawn once per resize, so each frame is cheap
    let comet = null;
    let nextComet = performance.now() + 6000 + Math.random() * 8000;

    // depth 0 = far (tiny, dim, nearly still) ... 2 = near (bigger, brighter, drifts more)
    const LAYERS = [
      { share: 0.6, size: [0.4, 0.9], alpha: [0.25, 0.55], drift: 0.04 },
      { share: 0.3, size: [0.7, 1.3], alpha: [0.4, 0.75], drift: 0.09 },
      { share: 0.1, size: [1.1, 1.9], alpha: [0.6, 0.95], drift: 0.16 },
    ];
    const rand = (a, b2) => a + Math.random() * (b2 - a);

    function buildNebula(dpr) {
      const off = document.createElement("canvas");
      off.width = w * dpr;
      off.height = h * dpr;
      const o = off.getContext("2d");
      o.scale(dpr, dpr);
      const glows = [
        { x: 0.22, y: 0.3, rad: 0.55, c: [r, g, b], a: 0.13 },
        { x: 0.8, y: 0.75, rad: 0.6, c: [90, 110, 220], a: 0.12 },
        { x: 0.55, y: 0.1, rad: 0.4, c: [150, 90, 200], a: 0.07 },
      ];
      for (const gl of glows) {
        const R = Math.max(w, h) * gl.rad;
        const grad = o.createRadialGradient(gl.x * w, gl.y * h, 0, gl.x * w, gl.y * h, R);
        grad.addColorStop(0, `rgba(${gl.c[0]},${gl.c[1]},${gl.c[2]},${gl.a})`);
        grad.addColorStop(1, `rgba(${gl.c[0]},${gl.c[1]},${gl.c[2]},0)`);
        o.fillStyle = grad;
        o.fillRect(0, 0, w, h);
      }
      return off;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nebula = buildNebula(dpr);
      // Star count follows the admin's "amount", scaled to the screen so phones stay smooth.
      const total = Math.round((count * 3) * Math.min(1, (w * h) / (1280 * 720)) + 30);
      stars = [];
      LAYERS.forEach((L, depth) => {
        const n = Math.round(total * L.share);
        for (let i = 0; i < n; i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            depth,
            size: rand(L.size[0], L.size[1]),
            alpha: rand(L.alpha[0], L.alpha[1]),
            tw: rand(0.4, 1.4), // twinkle rate
            ph: Math.random() * Math.PI * 2,
            warm: Math.random() < 0.18, // a few stars lean to the accent colour
          });
        }
      });
    }

    function draw(t, move) {
      ctx.clearRect(0, 0, w, h);
      if (nebula) ctx.drawImage(nebula, 0, 0, w, h);

      for (const st of stars) {
        const L = LAYERS[st.depth];
        if (move) {
          // Slow diagonal drift, wrapping around the edges.
          st.x += L.drift * speed * 0.6;
          st.y += L.drift * speed * 0.25;
          if (st.x > w + 2) st.x = -2;
          if (st.y > h + 2) st.y = -2;
        }
        const twinkle = move ? 0.75 + 0.25 * Math.sin(t * 0.001 * st.tw + st.ph) : 1;
        const a = st.alpha * twinkle;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
        ctx.fillStyle = st.warm ? `rgba(${r},${g},${b},${a})` : `rgba(215,225,255,${a})`;
        ctx.fill();
        if (st.depth === 2) {
          // soft halo on the few nearest stars
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.size * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = st.warm ? `rgba(${r},${g},${b},${a * 0.12})` : `rgba(180,200,255,${a * 0.12})`;
          ctx.fill();
        }
      }

      if (move) {
        if (!comet && t > nextComet) {
          comet = { x: rand(0.1, 0.7) * w, y: rand(0, 0.35) * h, vx: rand(5, 7), vy: rand(2, 3), life: 0 };
        }
        if (comet) {
          comet.x += comet.vx;
          comet.y += comet.vy;
          comet.life += 1;
          const fade = Math.max(0, 1 - comet.life / 55);
          const grad = ctx.createLinearGradient(comet.x, comet.y, comet.x - comet.vx * 14, comet.y - comet.vy * 14);
          grad.addColorStop(0, `rgba(235,240,255,${0.7 * fade})`);
          grad.addColorStop(1, "rgba(235,240,255,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(comet.x, comet.y);
          ctx.lineTo(comet.x - comet.vx * 14, comet.y - comet.vy * 14);
          ctx.stroke();
          if (fade <= 0) {
            comet = null;
            nextComet = t + 14000 + Math.random() * 14000;
          }
        }
      }
    }

    function loop(t) {
      draw(t, true);
      raf = requestAnimationFrame(loop);
    }
    function onVisibility() {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduceMotion) raf = requestAnimationFrame(loop);
    }

    resize();
    if (reduceMotion) draw(0, false);
    else raf = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [color, count, speed]);

  return <canvas ref={ref} className={styles.canvas} />;
}

/** Drifting dots joined by faint lines when close. Pauses when the tab is hidden. */
function ParticleCanvas({ color, count, speed }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [r, g, b] = hexToRgb(color);
    let w = 0;
    let h = 0;
    let raf = 0;
    let particles = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fewer particles on small screens so phones stay smooth.
      const n = Math.round(count * Math.min(1, (w * h) / (1280 * 720)) + 12);
      particles = Array.from({ length: n }, () => {
        const angle = Math.random() * Math.PI * 2;
        const v = (0.15 + Math.random() * 0.35) * speed;
        return { x: Math.random() * w, y: Math.random() * h, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, s: 1 + Math.random() * 1.8 };
      });
    }

    function frame(step) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        if (step) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
        ctx.fill();
      }
      const maxD = 120;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.hypot(dx, dy);
          if (d < maxD) {
            ctx.strokeStyle = `rgba(${r},${g},${b},${0.25 * (1 - d / maxD)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }

    function loop() {
      frame(true);
      raf = requestAnimationFrame(loop);
    }
    function onVisibility() {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduceMotion) loop();
    }

    resize();
    if (reduceMotion) frame(false);
    else loop();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [color, count, speed]);

  return <canvas ref={ref} className={styles.canvas} />;
}

/**
 * Fills its positioned parent (position: relative) behind the content.
 * `settings` is the object from useAuthBackground() / the admin form.
 */
export default function AuthBackground({ settings }) {
  const { mode } = settings;
  if (mode === "default") return null;

  let style = {};
  if (mode === "color") style = { background: settings.color1 };
  if (mode === "gradient") style = { background: `linear-gradient(135deg, ${settings.color1}, ${settings.color2})` };
  if (mode === "image") style = { backgroundImage: `url("${settings.imageUrl}")`, backgroundColor: settings.color1 };
  if (mode === "particles" || mode === "space") style = { background: `linear-gradient(135deg, ${settings.color1}, ${settings.color2})` };

  return (
    <div className={styles.layer} style={style} aria-hidden="true">
      {mode === "space" && <SpaceCanvas color={settings.particleColor} count={settings.particleCount} speed={settings.particleSpeed} />}
      {mode === "particles" && <ParticleCanvas color={settings.particleColor} count={settings.particleCount} speed={settings.particleSpeed} />}
      {mode === "image" && <div className={styles.tint} style={{ opacity: settings.overlay / 100 }} />}
    </div>
  );
}
