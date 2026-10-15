"use client";

import { useEffect, useRef } from "react";
import { useObservatory } from "../Observatory";
import type { Callout, NetLink, SunReading } from "../scene/engine";

// Scan feedback: a canvas for frames, markers, leader lines, the links between readings
// (solid planet–moon links, dashed scan noise while a scan runs and a moment after), the
// deep-scan sky trace and the Sun's reading, plus a fixed pool of DOM labels for the survey
// callouts. Drawn after each frame. Readings belong to the last scan and fade out as the view
// moves off that patch of sky.

const POOL = 6;

export default function Targets() {
  const { engine, pick } = useObservatory();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labels = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = useRef<string[]>([]);

  useEffect(() => {
    const c = canvasRef.current!;
    const g = c.getContext("2d")!;
    // draw right after the engine renders each frame; poll until the engine exists
    let raf = 0;
    let hooked: NonNullable<typeof engine.current> | null = null;
    const attach = () => {
      const e = engine.current;
      if (e && e !== hooked) {
        hooked = e;
        e.onFrame = draw;
      }
      raf = requestAnimationFrame(attach);
    };
    // HUD panels mask the scan drawings, so lines and frames pass behind them
    let blocks: DOMRect[] = [];
    let blocksAt = -1;
    const draw = () => {
      const e = engine.current;
      const w = window.innerWidth, h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!e) return;
      const phone = w <= 700;
      const now = performance.now();
      if (now - blocksAt > 300) {
        blocksAt = now;
        blocks = [...document.querySelectorAll<HTMLElement>("[data-hud-in], #nav-dock, #approach-panel")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
      }
      const sun = e.sunReading();
      if (sun) drawSunReading(g, sun, h, phone);
      drawNet(g, e.getNet());
      drawTrace(g, e.getTrace(), phone);
      placeLabels(g, e.getCallouts(), w, h, phone);
      g.globalCompositeOperation = "destination-out";
      for (const r of blocks) g.fillRect(r.x - 6, r.y - 6, r.width + 12, r.height + 12);
      g.globalCompositeOperation = "source-over";
    };

    const placeLabels = (g: CanvasRenderingContext2D, list: Callout[], w: number, h: number, phone: boolean) => {
      const taken: [number, number, number, number][] = [];
      // keep labels off the nav map when it is open
      const dock = document.getElementById("nav-dock")?.getBoundingClientRect();
      if (dock && dock.width > 0 && !phone) taken.push([dock.x - 6, dock.y - 6, dock.width + 12, dock.height + 12]);
      for (let i = 0; i < POOL; i++) {
        const el = labels.current[i];
        const co = list[i];
        if (!el) continue;
        if (!co) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          ids.current[i] = "";
          continue;
        }
        ids.current[i] = co.id;
        const known = co.identified;
        g.globalAlpha = co.alpha;
        const stroke = known ? (co.kind === "moon" ? "rgba(207,214,230,0.6)" : "rgba(242,101,0,0.6)") : "rgba(200,206,220,0.45)";
        const bw = el.offsetWidth || 160;
        const bh = el.offsetHeight || 60;
        const big = co.hero && co.r > 30;
        let bx: number, by: number, ax: number, ay: number;

        if (big) {
          // wide while acquiring, then contracts onto the body once it resolves
          const lock = co.identified ? Math.min(1, co.since / 0.6) : 0;
          const k = 1 - (1 - lock) ** 3;
          const hw = co.r * (1.52 - 0.48 * k), hh = co.r * (1.6 - 0.52 * k);
          g.strokeStyle = co.identified ? "rgba(242,101,0,0.6)" : "rgba(242,101,0,0.42)";
          g.lineWidth = 1;
          g.strokeRect(co.x - hw, co.y - hh, hw * 2, hh * 2);
          bx = co.x + hw + 5;
          by = co.y - hh + 3;
          if (bx + bw > w - 8) { bx = co.x + hw - bw; by = co.y - hh - bh - 6; }
          ax = co.x + hw;
          ay = co.y - hh;
        } else {
          const s = 12;
          g.strokeStyle = stroke;
          g.lineWidth = 1;
          g.strokeRect(co.x - s, co.y - s, s * 2, s * 2);
          const right = co.x < w * 0.66;
          bx = right ? co.x + 26 : co.x - 26 - bw;
          by = co.y - bh / 2 - 6;
          ax = right ? co.x + s : co.x - s;
          ay = co.y;
        }
        const minX = phone ? 8 : 300, maxX = w - (phone ? 8 : 300) - bw;
        const minY = phone ? 300 : 70, maxY = h - bh - (phone ? 210 : 196);
        const clampedX = Math.max(minX, Math.min(maxX, bx));
        const clampedY = Math.max(minY, Math.min(maxY, by));
        const moved = Math.abs(clampedX - bx) > 2 || Math.abs(clampedY - by) > 2;
        bx = clampedX;
        by = clampedY;
        const hits = (y: number) => taken.some(([tx, ty, tw, th]) => bx < tx + tw + 6 && bx + bw + 6 > tx && y < ty + th + 6 && y + bh + 6 > ty);
        for (let k = 0; k < 8 && hits(by); k++) by = by + bh + 8 > maxY ? Math.max(minY, by - (bh + 8) * (k + 1)) : by + bh + 8;
        taken.push([bx, by, bw, bh]);

        // leader: dashed when the label had to move away from its anchor
        if (moved || !big) {
          const ex = bx > ax ? bx : bx + bw;
          const ey = Math.max(by, Math.min(by + bh, ay));
          g.save();
          if (moved) g.setLineDash([3, 4]);
          g.strokeStyle = stroke;
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(ex, ey);
          g.stroke();
          g.restore();
        }

        g.globalAlpha = 1;
        el.style.transform = `translate3d(${Math.round(bx)}px, ${Math.round(by)}px, 0)`;
        el.style.opacity = co.alpha.toFixed(3);
        el.style.pointerEvents = co.alpha > 0.3 ? "auto" : "none";
        el.dataset.known = String(known);
        el.dataset.acquiring = String(co.acquiring);
        el.dataset.kind = co.kind;
        setText(el, "kicker", co.acquiring ? "ACQUIRING" : "OBJECT:");
        setText(el, "name", known ? co.name : `UNIDENTIFIED OBJECT #${co.number}`);
        setText(el, "status", co.status ? `STATUS: ${co.status}` : "");
        setText(el, "dist", `${Math.round(co.distKm).toLocaleString("en-US")} KM`);
        el.setAttribute("aria-label", `Navigate toward ${known ? co.name : `unidentified object ${co.number}`}`);
      }
    };

    attach();
    return () => {
      cancelAnimationFrame(raf);
      if (hooked && hooked.onFrame === draw) hooked.onFrame = null;
    };
  }, [engine]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      <canvas ref={canvasRef} id="scan-feedback" className="absolute inset-0 h-full w-full" aria-hidden />
      <div id="scan-targets">
        {Array.from({ length: POOL }, (_, i) => (
          <button
            key={i}
            type="button"
            ref={(el) => {
              labels.current[i] = el;
            }}
            onClick={() => ids.current[i] && pick(ids.current[i])}
            className="target-label opacity-0"
            data-known="false"
          >
            <span data-f="kicker" className="kicker">OBJECT:</span>
            <span className="flex items-baseline">
              <strong data-f="name" className="name" />
              <span data-f="status" className="status" />
            </span>
            <span data-f="dist" className="dist" />
          </button>
        ))}
      </div>
    </div>
  );
}

function drawTrace(g: CanvasRenderingContext2D, t: ReturnType<NonNullable<ReturnType<typeof useObservatory>["engine"]["current"]>["getTrace"]>, phone: boolean) {
  if (!t.stars.length || t.alpha <= 0) return;
  const cyan = (a: number) => `rgba(116,229,220,${a * t.alpha})`;
  g.lineWidth = 1;
  for (const [x1, y1, x2, y2, a] of t.lines) {
    g.strokeStyle = cyan(0.7 * a);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  g.font = `bold ${phone ? 9.5 : 11.5}px 'Archivo Narrow', sans-serif`;
  g.textBaseline = "middle";
  g.shadowColor = "rgba(5,4,10,0.95)";
  g.shadowBlur = 3;
  for (const s of t.stars) {
    const half = s.box / 2;
    g.strokeStyle = cyan(0.75 * s.alpha);
    g.strokeRect(Math.round(s.x - half) + 0.5, Math.round(s.y - half) + 0.5, s.box, s.box);
    g.fillStyle = cyan(0.95 * s.alpha);
    g.fillText(s.name, s.x + half + 7, s.y);
  }
  g.font = `bold ${phone ? 10 : 12.5}px 'Archivo Narrow', sans-serif`;
  for (const p of t.patterns) {
    if (p.alpha <= 0) continue;
    g.fillStyle = cyan(p.alpha);
    g.textAlign = "center";
    g.fillText(p.name, p.x, p.y);
    g.textAlign = "left";
  }
  g.shadowBlur = 0;
}

// ---------- the Sun's reading ----------

const SUN_DOTS = ["#fff1c4", "#ffd76b", "#ffb24a", "#ff7a1f", "#ff3b2f"];
const LEVELS = 6;
const CLASS_DOT = { X: 4, M: 3, C: 2 } as const;
const CLASS_REACH = { X: 1.15, M: 1.05, C: 0.95 } as const;

const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The Sun as a scan reads it. Its surface is drawn on the sphere itself (see the Sun material);
 * around it this adds a ring of glowing dust and flares streaming from the day's active
 * regions as stippled plumes, kept off the disc. It wipes in from the top and fades with the
 * reading.
 */
function drawSunReading(g: CanvasRenderingContext2D, s: SunReading, h: number, phone: boolean) {
  const a = Math.max(0, Math.min(1, s.alpha));
  if (a <= 0) return;
  const r = Math.max(s.r, 0.5);
  const R = Math.max(r, 3);
  const reach = Math.max(R * 4, phone ? 32 : 46);
  const span = s.full ? Math.max(reach, Math.min(h * 0.5, R * 14)) : R + 20;
  g.save();
  if (s.reveal < 1) {
    g.beginPath();
    g.rect(s.x - span, s.y - span, span * 2, span * 2 * s.reveal);
    g.clip();
  }
  if (s.full) {
    // nothing here covers the disc: the sphere shows through
    g.save();
    g.beginPath();
    g.rect(s.x - span * 2, s.y - span * 2, span * 4, span * 4);
    g.arc(s.x, s.y, r, 0, Math.PI * 2, true);
    g.clip("evenodd");
    g.globalCompositeOperation = "lighter";

    // stippled dust and flare plumes, bucketed by colour and brightness so each draws in one fill
    const buckets: number[][] = Array.from({ length: SUN_DOTS.length * LEVELS }, () => []);
    const put = (x: number, y: number, size: number, colour: number, level: number) => {
      const b = buckets[colour * LEVELS + Math.max(0, Math.min(LEVELS - 1, Math.floor(level * LEVELS)))];
      b.push(x, y, size);
    };
    const t = s.time;
    // dust: thickest at the limb, thinning outward, twinkling
    const area = Math.PI * (reach * reach - R * R);
    const dust = Math.round(Math.min(phone ? 700 : 1600, 900 * Math.pow(area / 15300, 0.8)));
    for (let i = 0; i < dust; i++) {
      const u = Math.pow(rnd(i, 1), 2);
      const d = R * 1.02 + (reach - R * 1.02) * u;
      const ang = rnd(i, 2) * Math.PI * 2 + t * 0.004 * (rnd(i, 7) - 0.5);
      const band = u < 0.05 ? 0 : u < 0.15 ? 1 : u < 0.33 ? 2 : u < 0.55 ? 3 : 4;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.5 + rnd(i, 3) * 3) + rnd(i, 4) * 6.283);
      put(s.x + Math.cos(ang) * d, s.y + Math.sin(ang) * d, rnd(i, 5) < 0.12 ? 2 : 1, band, 0.8 * (1 - 0.3 * u) * tw);
    }
    // plumes: rays of particles flowing out from each active region, widening as they go
    for (const site of s.sites) {
      const perSite = Math.round((site.cls === "X" ? 1100 : site.cls === "M" ? 900 : 420) * (phone ? 0.45 : 1));
      const len = Math.max(70, Math.min(h * 0.42, R * 12 * CLASS_REACH[site.cls] * (0.7 + 0.5 * site.seed)));
      const nx = -site.dy, ny = site.dx;
      const colour = CLASS_DOT[site.cls];
      const behind = site.facing < 0;
      for (let i = 0; i < perSite; i++) {
        const ray = Math.floor(rnd(i, 11 + site.seed * 7) * 15);
        const f = (rnd(i, 12 + site.seed) + t * (0.03 + 0.02 * rnd(ray, 13))) % 1;
        const along = R * 0.03 + f * len;
        // a fan of rays, each a little ragged, opening out with distance
        const spread = ((rnd(ray, 14 + site.seed) - 0.5) * 1.15 + (rnd(i, 15) - 0.5) * 0.45) * along * 0.75 + (rnd(i, 18) - 0.5) * 3;
        const x = site.x + site.dx * along + nx * spread;
        const y = site.y + site.dy * along + ny * spread;
        if (Math.hypot(x - s.x, y - s.y) < r) continue;
        const fade = (1 - f) ** 1.35;
        const c = f < 0.08 ? 0 : f < 0.3 ? Math.max(1, colour - 1) : colour;
        put(x, y, rnd(i, 16) < 0.15 ? 2 : 1, c, (0.55 + 0.45 * rnd(i, 17)) * fade);
      }
      // a broad warm cloud along the stream
      for (const [k, al] of [[0.015, 0.3], [0.06, 0.24], [0.13, 0.17], [0.24, 0.1], [0.31, 0.07]] as [number, number][]) {
        const d = k * len * 3;
        const hx = site.x + site.dx * d, hy = site.y + site.dy * d;
        const hr = Math.max(10, R * 1.1 + d * 0.62);
        const hz = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
        hz.addColorStop(0, SUN_DOTS[colour]);
        hz.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = a * al * (behind ? 0.6 : 1);
        g.fillStyle = hz;
        g.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
      }
    }
    for (let cIdx = 0; cIdx < SUN_DOTS.length; cIdx++) {
      for (let lv = 0; lv < LEVELS; lv++) {
        const b = buckets[cIdx * LEVELS + lv];
        if (!b.length) continue;
        g.globalAlpha = a * ((lv + 0.5) / LEVELS);
        g.fillStyle = SUN_DOTS[cIdx];
        g.beginPath();
        for (let i = 0; i < b.length; i += 3) g.rect(Math.round(b[i] - b[i + 2] / 2), Math.round(b[i + 1] - b[i + 2] / 2), b[i + 2], b[i + 2]);
        g.fill();
      }
    }
    g.restore();
    if (r < 6) {
      // too small to show its face: a warm core
      const cr = Math.max(5, r * 2.4);
      const core = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, cr);
      core.addColorStop(0, "#fff1c4");
      core.addColorStop(Math.min(0.9, r / cr), "#ffb24a");
      core.addColorStop(1, "rgba(255,122,31,0)");
      g.globalAlpha = a;
      g.fillStyle = core;
      g.beginPath();
      g.arc(s.x, s.y, cr, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (s.reveal < 1) {
    g.restore();
    g.save();
    g.globalAlpha = a * 0.55 * Math.sqrt(1 - s.reveal);
    g.fillStyle = SUN_DOTS[0];
    g.fillRect(s.x - span * 0.92, Math.round(s.y - span + span * 2 * s.reveal), span * 1.84, 1);
  }
  g.restore();
  // its reading: a star-coloured frame and name
  const half = Math.round(Math.max(r + 6, 12));
  g.save();
  g.globalAlpha = a;
  g.strokeStyle = "rgba(57,214,200,0.85)";
  g.lineWidth = 1;
  g.strokeRect(Math.round(s.x - half) + 0.5, Math.round(s.y - half) + 0.5, half * 2, half * 2);
  g.font = `bold ${phone ? 9.5 : 11.5}px 'Archivo Narrow', sans-serif`;
  g.textBaseline = "middle";
  g.shadowColor = "rgba(5,4,10,0.95)";
  g.shadowBlur = 3;
  g.fillStyle = "rgba(116,229,220,0.95)";
  g.fillText("SUN", s.x + half + 7, s.y - half + 6);
  g.restore();
}

function drawNet(g: CanvasRenderingContext2D, links: NetLink[]) {
  if (!links.length) return;
  g.save();
  g.lineWidth = 0.8;
  g.lineCap = "square";
  g.shadowBlur = 4;
  for (const l of links) {
    g.globalAlpha = l.alpha;
    g.strokeStyle = l.colour;
    g.shadowColor = l.colour;
    g.setLineDash(l.dashed ? [3, 7] : []);
    g.beginPath();
    g.moveTo(l.x1, l.y1);
    g.lineTo(l.x2, l.y2);
    g.stroke();
  }
  g.restore();
}

function setText(root: HTMLElement, field: string, text: string) {
  const el = root.querySelector<HTMLElement>(`[data-f="${field}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}
