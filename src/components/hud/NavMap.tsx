"use client";

import { useEffect, useRef, useState } from "react";
import { store, useUI } from "@/lib/store";
import { usePhone } from "@/lib/usePhone";
import { AU_KM, BODIES, orbitShape, orbitTrail, type Kind } from "@/lib/solar";
import { useObservatory } from "../Observatory";

// Solar system map: a perspective view of the Sun-centred ecliptic, linear out to 4 AU and
// log-compressed beyond so Neptune still fits. Real orbits of the planets, dwarf planets and
// asteroids, the probes flying on their own round the Sun (and the escape paths of the
// ones leaving), the asteroid belt, where we are, and the autopilot route. Drag to orbit,
// wheel or +/- to zoom (eased), hover for the distance, click a world to fly there.

const FOV = (42 * Math.PI) / 180;
const DEFAULT = { yaw: -0.4, tilt: 0.52, zoom: 1, zoomGoal: 1 };
const ZOOM_RATE = 7.67; // per second, toward the goal the wheel sets
const scaleAU = (au: number) => (au <= 4 ? au * 46 : 184 + Math.log1p(au - 4) * 96);
type V3 = [number, number, number];
type Hit = { id: string; x: number; y: number; name: string; au: number; fromSun: number };

/** compress a Sun-centred position (km) into map units, keeping its direction */
function mapPos([x, y, z]: V3): V3 {
  const r = Math.hypot(x, y, z);
  if (r === 0) return [0, 0, 0];
  const k = scaleAU(r / AU_KM) / r;
  return [x * k, y * k, z * k];
}

const SMALL = "#f0b32a";
const PROBE = "#ff9a6a";
const isProbe = (k: Kind) => k === "spacecraft" || k === "satellite";
const ORBITS = BODIES.filter((b) => b.id !== "derelict-1" && (b.kind === "planet" || b.kind === "dwarf" || b.kind === "asteroid" || (isProbe(b.kind) && b.parent === "sun"))).map((b) => ({
  id: b.id,
  kind: b.kind,
  colour: b.kind === "planet" ? b.palette[1] : isProbe(b.kind) ? PROBE : SMALL,
  shape: orbitShape(b.id),
}));
/** probes on escape paths: draw the stretch flown since their last planetary flyby */
const ESCAPES: Record<string, number> = { "voyager-2": Date.UTC(1990, 0, 1), "new-horizons": Date.UTC(2007, 6, 1) };
const BELT: V3[] = (() => {
  let s = 977;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
  const pts: V3[] = [];
  for (let i = 0; i < 700; i++) {
    const r = (2.15 + Math.pow(rand(), 0.9) * 1.2) * AU_KM;
    const a = rand() * Math.PI * 2;
    const inc = (rand() - 0.5) * 0.25;
    pts.push(mapPos([Math.cos(a) * r, Math.sin(a) * r, Math.sin(inc) * r * 0.5]));
  }
  for (let i = 0; i < 260; i++) {
    const r = (39 + rand() * 9) * AU_KM;
    const a = rand() * Math.PI * 2;
    pts.push(mapPos([Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.3 * r]));
  }
  return pts;
})();

export default function NavMap() {
  const phone = usePhone();
  const expanded = useUI((s) => s.mapExpanded);
  const hl = useUI((s) => s.highlight.includes("map"));
  const auto = useUI((s) => s.autopilot);
  const { engine, travel, cancelTravel } = useObservatory();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...DEFAULT });
  const hits = useRef<Hit[]>([]);
  const hover = useRef<string | null>(null);
  const focus = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const phoneInit = useRef(false);
  const flying = auto?.mode === "flying";

  // phones start with the map folded away; it opens as a bottom sheet
  useEffect(() => {
    if (phone && !phoneInit.current) {
      phoneInit.current = true;
      store.set({ mapExpanded: false });
    }
  }, [phone]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.dataset.map = expanded ? (phone ? "sheet" : "open") : "closed";
    return () => {
      if (main) main.dataset.map = "closed";
    };
  }, [expanded, phone]);

  useEffect(() => {
    if (!expanded) return;
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    let raf = 0;
    const orbitPts = ORBITS.map((o) => {
      const pts: V3[] = [];
      if (o.shape) {
        const { a, e, peri, side } = o.shape;
        for (let i = 0; i <= 160; i++) {
          const nu = (i / 160) * Math.PI * 2;
          const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
          pts.push(mapPos([(peri[0] * Math.cos(nu) + side[0] * Math.sin(nu)) * r, (peri[1] * Math.cos(nu) + side[1] * Math.sin(nu)) * r, (peri[2] * Math.cos(nu) + side[2] * Math.sin(nu)) * r]));
        }
      } else if (ESCAPES[o.id]) {
        for (const p of orbitTrail(o.id, ESCAPES[o.id], Date.now(), 120)) pts.push(mapPos(p as V3));
      }
      return { id: o.id, kind: o.kind, colour: o.colour, pts };
    }).filter((o) => o.pts.length);
    let last = performance.now();
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const e = engine.current;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!e) return;
      const snap = e.mapSnapshot();
      const v = view.current;
      // the wheel sets a goal; the view glides there
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      v.zoom = Math.abs(v.zoomGoal - v.zoom) < 1e-4 ? v.zoomGoal : v.zoom + (v.zoomGoal - v.zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
      const cy0 = Math.cos(v.yaw), sy0 = Math.sin(v.yaw), ct = Math.cos(v.tilt), st = Math.sin(v.tilt);
      const extent = scaleAU(31);
      const D = (extent * 1.05) / Math.tan(FOV / 2);
      const f = (Math.min(w, h * 1.5) / 2 / Math.tan(FOV / 2)) * v.zoom;
      const cx = w / 2, cy = h / 2 + 8;
      const P = ([X, Y, Z]: V3) => {
        const x1 = X * cy0 - Y * sy0, y1 = X * sy0 + Y * cy0;
        const depth = D + y1 * ct - Z * st;
        const k = f / Math.max(depth, 1);
        return { x: cx + x1 * k, y: cy - (y1 * st + Z * ct) * k, depth, k };
      };
      const line = (pts: V3[], colour: string, alpha: number, dash: number[] = []) => {
        g.save();
        g.globalAlpha = alpha;
        g.strokeStyle = colour;
        g.setLineDash(dash);
        g.beginPath();
        pts.forEach((p, i) => {
          const q = P(p);
          if (i) g.lineTo(q.x, q.y);
          else g.moveTo(q.x, q.y);
        });
        g.stroke();
        g.restore();
      };

      // belt dust
      g.fillStyle = "#f0b32a";
      g.globalAlpha = 0.28;
      for (const p of BELT) {
        const q = P(p);
        g.fillRect(q.x, q.y, 1, 1);
      }
      g.globalAlpha = 1;
      // orbits
      const target = store.get().target;
      g.lineWidth = 1;
      for (const o of orbitPts) {
        const hot = o.id === target || o.id === snap.travelling || o.id === hover.current || o.id === focus.current;
        const probe = isProbe(o.kind);
        const base = o.kind === "planet" ? 0.42 : probe ? 0.34 : 0.24;
        line(o.pts, o.colour, hot ? 0.85 : base, probe ? [2, 3] : []);
      }
      // the Sun
      const sun = P([0, 0, 0]);
      const sr = Math.max(4.5 * sun.k * 0.4, 5);
      const grad = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sr * 3.4);
      grad.addColorStop(0, "rgba(255,247,204,1)");
      grad.addColorStop(0.25, "rgba(255,178,74,0.75)");
      grad.addColorStop(1, "rgba(255,106,31,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sun.x, sun.y, sr * 3.4, 0, Math.PI * 2);
      g.fill();
      // autopilot route
      if (snap.route.length > 1) line(snap.route.map((p) => mapPos(p as V3)), "#ff9875", 0.9, [3, 3]);
      // bodies
      const font = phone ? 9 : 10;
      g.font = `bold ${font}px 'Archivo Narrow', sans-serif`;
      g.textBaseline = "middle";
      const list = snap.bodies.map((b) => ({ b, q: P(mapPos(b.pos as V3)) })).sort((a, b2) => b2.q.depth - a.q.depth);
      const newHits: Hit[] = [];
      const boxes: [number, number, number, number][] = [];
      const claim = (x: number, y: number, text: string, force: boolean) => {
        const bw = g.measureText(text).width, bh = font + 2;
        const free = !boxes.some(([bx, by, ww, hh]) => x < bx + ww && x + bw > bx && y - bh / 2 < by + hh && y + bh / 2 > by);
        if (free || force) boxes.push([x, y - bh / 2, bw, bh]);
        return free || force;
      };
      const me = P(mapPos(snap.me as V3));
      claim(me.x - 30, me.y - 9, "YOU", true);
      for (const { b, q } of list) {
        const fromSun = Math.hypot(...(b.pos as V3));
        const au = Math.hypot(b.pos[0] - snap.me[0], b.pos[1] - snap.me[1], b.pos[2] - snap.me[2]) / AU_KM;
        newHits.push({ id: b.id, x: q.x, y: q.y, name: b.name, au, fromSun });
        const hot = b.id === target || b.id === snap.travelling;
        const isHover = hover.current === b.id || focus.current === b.id;
        if (b.kind === "star") {
          g.fillStyle = isHover ? "#47ffa9" : "#ffb24a";
          if (claim(q.x + 10, q.y, "SUN", true)) g.fillText("SUN", q.x + 10, q.y);
          continue;
        }
        const planet = b.kind === "planet";
        const probe = isProbe(b.kind as Kind);
        // unscanned bodies show where they are, not what they are
        const colour = !b.known ? SMALL : planet ? b.colour : probe ? PROBE : SMALL;
        g.fillStyle = colour;
        g.shadowColor = colour;
        g.shadowBlur = 6;
        g.beginPath();
        if (planet) {
          g.arc(q.x, q.y, b.id === "jupiter" || b.id === "saturn" ? 3.4 : 2.6, 0, Math.PI * 2);
        } else if (probe) {
          // probes: a small triangle
          g.moveTo(q.x, q.y - 2.6);
          g.lineTo(q.x + 2.3, q.y + 1.6);
          g.lineTo(q.x - 2.3, q.y + 1.6);
          g.closePath();
        } else {
          // dwarf planets and asteroids: a diamond
          const r = b.kind === "dwarf" ? 2.6 : 2.1;
          g.moveTo(q.x, q.y - r);
          g.lineTo(q.x + r * 0.8, q.y);
          g.lineTo(q.x, q.y + r);
          g.lineTo(q.x - r * 0.8, q.y);
          g.closePath();
        }
        g.fill();
        g.shadowBlur = 0;
        if (hot || isHover) {
          g.strokeStyle = hot ? "#ff4747" : "#47ffa9";
          g.beginPath();
          g.arc(q.x, q.y, 6, 0, Math.PI * 2);
          g.stroke();
        }
        // planets and dwarf planets keep their names; asteroids and probes name themselves
        // on hover, or once the map is zoomed in far enough to make room
        const named = (b.known && (planet || b.kind === "dwarf")) || v.zoom >= 1.8;
        if (!named && !hot && !isHover) continue;
        const label = b.known ? b.name : "UNIDENTIFIED";
        g.fillStyle = hot ? "#ff9875" : isHover ? "#47ffa9" : colour;
        if (claim(q.x + 7, q.y, label, hot || isHover)) g.fillText(label, q.x + 7, q.y);
      }
      // you: red marker pointing along the view
      const ahead = P(mapPos([snap.me[0] + snap.forward[0] * AU_KM * 0.6, snap.me[1] + snap.forward[1] * AU_KM * 0.6, snap.me[2] + snap.forward[2] * AU_KM * 0.6]));
      const ang = Math.atan2(ahead.y - me.y, ahead.x - me.x);
      g.fillStyle = "#ff4747";
      g.shadowColor = "#ff4747";
      g.shadowBlur = 6;
      g.beginPath();
      g.moveTo(me.x + Math.cos(ang) * 6, me.y + Math.sin(ang) * 6);
      g.lineTo(me.x + Math.cos(ang + 2.4) * 5, me.y + Math.sin(ang + 2.4) * 5);
      g.lineTo(me.x + Math.cos(ang - 2.4) * 5, me.y + Math.sin(ang - 2.4) * 5);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.textAlign = "right";
      g.fillText("YOU", me.x - 7, me.y - 9);
      g.textAlign = "left";
      // readout
      const hl = newHits.find((x) => x.id === (hover.current ?? focus.current));
      g.font = `${phone ? 8.5 : 9}px 'Archivo Narrow', sans-serif`;
      g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(170,165,143,0.75)";
      if (hl) {
        g.textAlign = "right";
        g.fillText(`${hl.name} · ${hl.au.toFixed(hl.au < 1 ? 3 : 2)} AU FROM YOU`, w - 8, h - 8);
        g.textAlign = "left";
      } else if (!phone) {
        g.fillText("SUN-CENTRED · ECLIPTIC  |  LINEAR TO 4 AU · COMPRESSED BEYOND  |  ORBITS", 8, h - 8);
      }
      hits.current = newHits;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine, expanded, phone]);

  // pointer: drag orbits the map, click picks a world
  useEffect(() => {
    if (!expanded) return;
    const c = canvasRef.current;
    if (!c) return;
    let drag: { id: number; x: number; y: number; moved: number } | null = null;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const nearest = (x: number, y: number) => {
      let best: Hit | null = null, bd = phone ? 20 : 14;
      for (const h of hits.current) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      return best;
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    };
    const move = (e: PointerEvent) => {
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) {
          view.current.yaw += dx * 0.008;
          view.current.tilt = Math.min(1.5, Math.max(0.05, view.current.tilt + dy * 0.006));
        }
        return;
      }
      const [x, y] = at(e);
      const h = nearest(x, y);
      hover.current = h?.id ?? null;
      c.style.cursor = h ? "pointer" : "";
    };
    const up = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (moved > 6) return;
      const [x, y] = at(e);
      const h = nearest(x, y);
      if (!h) return;
      const a = store.get().autopilot;
      if (a?.mode === "flying" && a.id === h.id) return;
      travel(h.id);
      if (phone) store.set({ mapExpanded: false });
    };
    const leave = () => {
      hover.current = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      view.current.zoomGoal = Math.min(8, Math.max(0.35, view.current.zoomGoal * Math.exp(-e.deltaY * 0.0015)));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("wheel", wheel);
    };
  }, [expanded, phone, travel]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const list = [...hits.current].sort((a, b) => a.fromSun - b.fromSun);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      if (!list.length) return;
      const n = list.length;
      const i = list.findIndex((h) => h.id === focus.current);
      const next = i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
      focus.current = list[next].id;
      setAnnounce(`${list[next].name}, ${list[next].au.toFixed(2)} astronomical units away. Enter to fly there.`);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      view.current.tilt = Math.min(1.5, Math.max(0.05, view.current.tilt + (e.key === "ArrowUp" ? 0.08 : -0.08)));
    } else if ((e.key === "Enter" || e.key === " ") && focus.current) {
      e.preventDefault();
      travel(focus.current);
    } else if (e.key === "+" || e.key === "=") view.current.zoomGoal = Math.min(8, view.current.zoomGoal * 1.2);
    else if (e.key === "-") view.current.zoomGoal = Math.max(0.35, view.current.zoomGoal / 1.2);
    else if (e.key === "0") reset();
  };

  const reset = () => {
    view.current = { ...DEFAULT, zoom: view.current.zoom };
  };
  const toggle = () => store.set({ mapExpanded: !store.get().mapExpanded });
  const sheet = phone && expanded;

  return (
    <section
      id="nav-dock"
      aria-label="Solar system map"
      data-expanded={expanded}
      data-hl={hl}
      className={
        sheet
          ? "pointer-events-auto absolute inset-x-0 bottom-0 z-[7] h-[38dvh] border-t border-gold/70 bg-void/95 pb-[env(safe-area-inset-bottom)]"
          : `pointer-events-auto absolute z-[6] font-hud ${phone ? "bottom-[calc(env(safe-area-inset-bottom)+104px)] left-[var(--side)]" : `plus-frame bottom-[20px] left-[var(--side)] ${expanded ? "w-[clamp(290px,27vw,420px)]" : ""}`}`
      }
    >
      {expanded && (
        <div className={sheet ? "h-full" : "h-[clamp(120px,calc(100vh-410px),230px)] bg-[rgba(5,4,10,0.66)]"}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            onKeyDown={onKeyDown}
            onBlur={() => (focus.current = null)}
            aria-label="Three-dimensional Sun-centred map. Drag to orbit, scroll to zoom, zero resets. Left and right arrows pick a world; Enter flies there on autopilot."
            className="nav-chart block h-full w-full"
          />
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className={sheet ? "absolute right-[var(--side)] top-[8px] flex gap-[6px]" : `flex items-center gap-[12px] ${expanded ? "mt-[6px]" : ""}`}>
        <div className="flex gap-[4px]">
          <button
            type="button"
            className={`dock-btn ${!expanded && phone ? "!flex w-auto gap-[7px] border border-gold/70 px-[10px] font-hud text-[10.5px] font-bold tracking-[0.6px] halo" : ""}`}
            aria-label={expanded ? "Fold the solar map" : "Open the solar map"}
            aria-expanded={expanded}
            title="Solar map (M)"
            onClick={toggle}
          >
            {expanded ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="6" cy="6" r="1.4" fill="currentColor" />
              </svg>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <ellipse cx="6" cy="6" rx="5.2" ry="2.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
                  <circle cx="6" cy="6" r="1.4" fill="currentColor" />
                </svg>
                {phone && <span>SOLAR MAP</span>}
              </>
            )}
          </button>
          {expanded && (
            <button type="button" className="dock-btn" aria-label="Reset the map view" title="Reset view" onClick={reset}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M9.6 4.2A4 4 0 1 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M10.4 1.6v3h-3" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          )}
        </div>
        {expanded && !sheet && !flying && <p className="ml-auto truncate text-right text-[10px] leading-[15px] tracking-[0.25px] text-dim halo">▸ CLICK A PLANET · AUTOPILOT</p>}
        {flying && !sheet && expanded && (
          <button
            type="button"
            onClick={cancelTravel}
            className="ml-auto min-h-[28px] whitespace-nowrap rounded-[4px] border border-alert bg-[rgba(5,4,10,0.72)] px-[10px] py-[5px] text-[12px] font-bold leading-[13px] tracking-[0.3px] text-alert shadow-[0_0_8px_rgba(255,71,71,0.42)] glow hover:bg-[rgba(240,179,42,0.1)]"
          >
            CANCEL AUTOPILOT · X
          </button>
        )}
      </div>
      {sheet && <p className="pointer-events-none absolute left-[var(--side)] top-[14px] font-hud text-[10px] tracking-[0.25px] text-dim halo">▸ TAP A PLANET · AUTOPILOT</p>}
      {flying && sheet && (
        <button
          type="button"
          onClick={cancelTravel}
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+8px)] left-[var(--side)] whitespace-nowrap rounded-[4px] border border-alert bg-[rgba(5,4,10,0.72)] px-[10px] py-[5px] font-hud text-[11px] font-bold tracking-[0.3px] text-alert glow"
        >
          CANCEL AUTOPILOT · X
        </button>
      )}
    </section>
  );
}
