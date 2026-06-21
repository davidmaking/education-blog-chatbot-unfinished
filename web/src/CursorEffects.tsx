import { useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════════════════
   CursorEffects — Golden spark trail (canvas) + click ripple (DOM)
   Mount once at the root level. pointer-events: none so nothing is blocked.
   ═══════════════════════════════════════════════════════════════════════════════ */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 0 → 1 (1 = just born)
  size: number;
  hue: number;    // slight variation around gold
}

const MAX_SPARKS = 80;
const SPARK_LIFETIME = 0.6; // seconds
const SPARKS_PER_MOVE = 2;

export default function CursorEffects() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const mouse = useRef({ x: -100, y: -100 });
  const lastSpawn = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas to fill viewport
    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    // Track mouse
    function onMove(e: MouseEvent) {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;

      // Spawn sparks on move (throttled by count)
      const now = performance.now();
      if (now - lastSpawn.current < 16) return; // ~60fps throttle
      lastSpawn.current = now;

      for (let i = 0; i < SPARKS_PER_MOVE; i++) {
        if (sparks.current.length >= MAX_SPARKS) {
          // Recycle oldest
          sparks.current.shift();
        }
        sparks.current.push({
          x: e.clientX + (Math.random() - 0.5) * 8,
          y: e.clientY + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 40,
          vy: (Math.random() - 0.5) * 40 - 20, // slight upward bias
          life: 1,
          size: Math.random() * 2.5 + 1,
          hue: 38 + (Math.random() - 0.5) * 20, // gold range
        });
      }
    }
    window.addEventListener("mousemove", onMove);

    // Click ripple (DOM-based CSS animation)
    function onClick(e: MouseEvent) {
      const ripple = document.createElement("div");
      ripple.className = "click-ripple";
      ripple.style.left = e.clientX + "px";
      ripple.style.top = e.clientY + "px";
      document.body.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    }
    window.addEventListener("mousedown", onClick);

    // Animation loop
    let lastTime = performance.now();
    function loop(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Update & draw sparks
      const alive: Spark[] = [];
      for (const s of sparks.current) {
        s.life -= dt / SPARK_LIFETIME;
        if (s.life <= 0) continue;

        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 30 * dt; // gentle gravity

        const alpha = s.life * 0.8;
        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = `hsl(${s.hue}, 85%, ${55 + s.life * 20}%)`;
        ctx!.shadowColor = `hsla(${s.hue}, 90%, 60%, ${alpha * 0.6})`;
        ctx!.shadowBlur = 6;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
        ctx!.fill();

        alive.push(s);
      }
      ctx!.globalAlpha = 1;
      ctx!.shadowBlur = 0;
      sparks.current = alive;

      raf.current = requestAnimationFrame(loop);
    }
    raf.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        pointerEvents: "none",
      }}
    />
  );
}
