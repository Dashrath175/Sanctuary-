"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { store, useUI } from "@/lib/store";
import { useTouch } from "@/lib/usePhone";
import { audio } from "@/lib/audio";
import { BODIES, byId } from "@/lib/solar";
import { explorationProgress } from "@/lib/clues";
import { ENDING_STATE } from "@/lib/finale";
import { Objective } from "./StoryHud";
import { MAX_SPEED, shortKm } from "@/lib/units";
import { useObservatory } from "../Observatory";
import { Credit } from "../icons";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- motion helpers ---------- */

const STEP = "steps(1, end)";
const HUD_IN: Keyframe[] = [
  { opacity: 0, offset: 0, easing: STEP },
  { opacity: 0.35, offset: 0.16, easing: STEP },
  { opacity: 0.12, offset: 0.23, easing: STEP },
  { opacity: 0.8, offset: 0.31, easing: STEP },
  { opacity: 0.55, offset: 0.42, easing: STEP },
  { opacity: 1, offset: 0.7, easing: STEP },
  { opacity: 1, offset: 1, easing: STEP },
];
const GLITCHES: [Keyframe[], number][] = [
  [[{ opacity: 1 }, { opacity: 0.86 }, { opacity: 0.958 }, { opacity: 0.902 }, { opacity: 1 }], 140],
  [[{ opacity: 1 }, { opacity: 0.8775 }, { opacity: 0.9475 }, { opacity: 1 }], 170],
];

/** Stepped flicker-in for each HUD group, 32 ms apart. */
function useHudIn() {
  useEffect(() => {
    if (reduced()) return;
    const els = [...document.querySelectorAll<HTMLElement>("[data-hud-in]")].sort((a, b) => +a.dataset.hudIn! - +b.dataset.hudIn!);
    els.forEach((el, i) => el.animate(HUD_IN, { duration: 680, delay: i * 32, fill: "backwards" }));
  }, []);
}

/** Every few seconds one readout drops a frame or two of brightness. */
function useGlitch() {
  useEffect(() => {
    if (reduced()) return;
    let id = 0;
    const tick = () => {
      const els = document.querySelectorAll<HTMLElement>("[data-glitch]");
      if (els.length) {
        const el = els[Math.floor(Math.random() * els.length)];
        const [kf, ms] = GLITCHES[Math.random() < 0.8 ? 0 : 1];
        el.animate(kf, { duration: ms, easing: STEP });
      }
      id = window.setTimeout(tick, 2500 + Math.random() * 7000);
    };
    id = window.setTimeout(tick, 3000);
    return () => window.clearTimeout(id);
  }, []);
}

/* ---------- shared controls ---------- */

export function SoundToggle() {
  const on = useUI((s) => s.soundOn);
  return (
    <button
      id="sound-toggle"
      type="button"
      aria-pressed={on}
      aria-label={on ? "Mute sound" : "Turn sound on"}
      title="Sound"
      onClick={() => {
        const next = !store.get().soundOn;
        if (next) audio.unlock();
        audio.setEnabled(next);
        store.set({ soundOn: next });
        if (next) audio.ui();
      }}
      className={`h-[32px] pl-[12px] font-hud text-[10.5px] font-bold leading-[13.2px] tracking-[0.63px] halo md:h-[28px] md:pl-0 md:text-[12px] md:tracking-[0.3px] ${on ? "text-mint" : "text-ash"}`}
    >
      {on ? "SOUND ON" : "SOUND OFF"}
    </button>
  );
}

function ArchiveButton() {
  const online = useUI((s) => s.unlocks.archive);
  const count = useUI((s) => s.journey.archive.length);
  const hl = useUI((s) => s.highlight.includes("archive"));
  if (!online) return null;
  return (
    <button
      type="button"
      data-hl={hl}
      aria-label="Open the archive of recovered records"
      aria-haspopup="dialog"
      onClick={() => {
        if (store.get().locked || store.get().deepOnly) return;
        audio.ui();
        store.set({ archiveOpen: true });
      }}
      className="flex h-[32px] items-center gap-[6px] pl-[12px] font-hud text-[10.5px] font-bold leading-[13.2px] tracking-[0.63px] text-alert halo hover:text-loc md:h-[28px] md:pl-0 md:text-[12px] md:tracking-[0.3px]"
    >
      <span aria-hidden>▤</span> ARCHIVE{count > 0 && <span className="font-normal text-mint">{count}</span>}
    </button>
  );
}

function RecordsButton() {
  const { openRecords } = useObservatory();
  const open = useUI((s) => s.records !== "closed");
  return (
    <button
      id="open-codex"
      type="button"
      data-hud-in="4"
      aria-label="Open your records"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openRecords}
      className="flex h-[32px] items-center gap-[6px] pl-[12px] font-hud text-[10.5px] font-bold leading-[13.2px] tracking-[0.63px] text-alert halo hover:text-loc md:h-[28px] md:pl-0 md:text-[12px] md:tracking-[0.3px]"
    >
      <span aria-hidden>◐</span> RECORDS
    </button>
  );
}

export function ScanPanel() {
  const { scan } = useObservatory();
  const story = useUI((s) => s.story);
  const stage = useUI((s) => s.scanStage);
  const scanning = useUI((s) => s.scanning);
  const online = useUI((s) => s.unlocks.scan);
  const belt = useUI((s) => s.journey.chapter === "belt");
  const locked = useUI((s) => s.locked);
  const hl = useUI((s) => s.highlight.includes("scan"));
  const earthDeep = useUI((s) => s.journey.chapter === "earth" && s.journey.beats.includes("earth-identified") && !s.journey.beats.includes("earth-deep"));
  const touch = useTouch();
  if (story === "contact" && !scanning) return null;
  const deep = (story === "exploring" && stage === "deep") || earthDeep;
  const label = locked ? "SCAN LOCKED" : !online ? "SCAN OFFLINE" : scanning ? (deep ? "LOOKING DEEPER…" : "SCANNING…") : deep ? "DEEP SCAN" : "SCAN";
  const key = touch ? "" : " · F";
  const small = locked ? "CONTROLS LOCKED" : !online ? (belt ? "SENSOR INTERFERENCE" : "SENSORS RECALIBRATING") : earthDeep ? `LIFE SIGNS${key}` : deep ? `STARS & CONSTELLATIONS${key}` : `NEARBY SKY${key}`;
  return (
    <section id="scan-panel" data-hud-in="8" className="absolute bottom-[calc(env(safe-area-inset-bottom)+76px)] left-1/2 z-[6] -translate-x-1/2 md:bottom-[77px]">
      <button
        id="scan-button"
        type="button"
        onClick={scan}
        disabled={scanning}
        data-scanning={scanning}
        data-call={story === "awaiting-scan"}
        data-offline={!online || locked}
        data-hl={hl}
        aria-label={`${deep ? "Deep scan: stars and constellations" : "Scan nearby sky"}${touch ? "" : " (F)"}`}
        className="scan-btn h-[33px] min-w-[107px] whitespace-nowrap px-[15.3px] tracking-[2.4px] md:h-[40px] md:min-w-[140px] md:px-[18px] md:tracking-[0.3px]"
      >
        <span className="scan-sweep" aria-hidden />
        <span className="text-[16px] leading-[16px]">⌖</span>
        <span>{label}</span>
      </button>
      <p className="absolute left-1/2 top-full mt-[6px] hidden -translate-x-1/2 whitespace-nowrap font-hud text-[10px] leading-[12px] tracking-[0.25px] text-ash/60 halo md:block">{small}</p>
    </section>
  );
}

/* ---------- header ---------- */

/** exploration progress, once the map is online */
function Explored() {
  const online = useUI((s) => s.unlocks.map);
  const beats = useUI((s) => s.journey.beats);
  const pct = useMemo(() => Math.floor(explorationProgress(beats) * 100), [beats]);
  if (!online) return null;
  return (
    <div className="mt-[4px] hidden h-[15px] whitespace-nowrap font-hud text-[12px] leading-[15px] tracking-[0.3px] text-dim halo md:block">
      EXPLORATION <b className="ml-[2px] font-normal text-mint glow">{pct}%</b>
    </div>
  );
}

const TOTALS = (() => {
  const k = { planet: 0, moon: 0, minor: 0, craft: 0 };
  for (const b of BODIES) {
    if (b.kind === "planet") k.planet++;
    else if (b.kind === "moon") k.moon++;
    else if (b.kind === "dwarf" || b.kind === "asteroid") k.minor++;
    else if (b.kind === "spacecraft" || b.kind === "satellite") k.craft++;
  }
  return k;
})();

const LEGEND: [string, string, string][] = [
  ["#abcfff", "O·B", "10,000K+"],
  ["#e1efff", "A·F", "7,500K"],
  ["#f4cd72", "G", "5,800K · SUN-LIKE"],
  ["#f29c55", "K", "4,500K"],
  ["#ed6754", "M", "3,000K"],
];

function Brand() {
  const clock = useUI((s) => s.clock);
  const identified = useUI((s) => s.identified);
  const stars = useUI((s) => s.starsNamed);
  const counts = useMemo(() => {
    const k = { planet: 0, moon: 0, minor: 0, craft: 0 };
    for (const id of identified) {
      const b = byId.get(id);
      if (!b) continue;
      if (b.kind === "planet") k.planet++;
      else if (b.kind === "moon") k.moon++;
      else if (b.kind === "dwarf" || b.kind === "asteroid") k.minor++;
      else if (b.kind === "spacecraft" || b.kind === "satellite") k.craft++;
    }
    return k;
  }, [identified]);
  const totals: [string, number, number | null][] = [
    ["STARS", stars, null],
    ["PLANETS", counts.planet, TOTALS.planet],
    ["MOONS", counts.moon, TOTALS.moon],
    ["ASTEROIDS", counts.minor, TOTALS.minor],
    ["VEHICLES", counts.craft, TOTALS.craft],
  ];
  return (
    <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+10px)] left-[var(--side)] w-[272px] md:bottom-auto md:top-[30px] md:w-[347px]">
      <div data-hud-in="0" className="h-[25px] md:h-[53px]">
        <b className="font-display text-[28px] font-[350] leading-[25px] tracking-[0.28px] text-mint glow md:text-[60px] md:leading-[52.8px] md:tracking-[0.6px]">SANCTUARY</b>
      </div>
      <div
        data-hud-in="1"
        data-glitch
        className="fixed left-[8px] top-1/2 -translate-y-1/2 whitespace-pre font-clock text-[10px] leading-[10px] tracking-[1.2px] text-mint glow [writing-mode:vertical-rl] md:static md:mt-[9px] md:translate-y-0 md:text-[14px] md:leading-[21px] md:tracking-normal md:[writing-mode:horizontal-tb]"
      >
        {clock}
      </div>
      <Explored />
      <div className="mt-[6px] flex h-[12px] whitespace-nowrap font-hud text-[9.5px] leading-[12px] tracking-[0.2375px] text-dim halo md:mt-[8px] md:h-[15px] md:text-[12px] md:leading-[15px] md:tracking-[0.3px]">
        {totals.map(([k, v, total]) => (
          <span key={k} className="mr-[10px] md:mr-[12px]">
            {k} <b className="ml-[2px] font-normal text-mint glow">{v}</b>
            {total !== null && <span className="hidden text-dim md:inline">/{total}</span>}
          </span>
        ))}
      </div>
      <div
        id="star-key"
        data-hud-in="2"
        className="mt-[4px] grid grid-cols-[max-content_auto_auto] gap-x-[8px] gap-y-[2px] font-hud text-[9px] leading-[11px] halo md:grid-cols-[max-content_auto_auto] md:gap-x-[12px] md:gap-y-[4px] md:text-[12px] md:leading-[15px] md:tracking-[0.3px]"
      >
        <span className="whitespace-nowrap text-key glow">STAR CLASS · SURFACE TEMP</span>
        {LEGEND.map(([c, k, t]) => (
          <span key={k} className="flex items-center gap-[5px] whitespace-nowrap text-dim">
            <i className="h-[5px] w-[5px] rounded-full md:h-[7px] md:w-[7px]" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
            <b className="font-bold" style={{ color: c }}>
              {k}
            </b>{" "}
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Location() {
  const location = useUI((s) => s.location);
  return (
    <div
      id="location"
      data-hud-in="3"
      className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+14px)] h-[19px] -translate-x-1/2 whitespace-nowrap px-[6px] font-clock text-[10.5px] leading-[19px] tracking-[0.84px] text-loc glow md:top-[31px] md:h-[28px] md:text-[14px] md:leading-[28px] md:tracking-[0.3px]"
    >
      {location}
    </div>
  );
}

/* ---------- drive ---------- */

function DrivePanel() {
  const speed = useUI((s) => s.speed);
  const limit = useUI((s) => s.limitText);
  const thrust = useUI((s) => s.thrustText);
  const level = useUI((s) => s.thrustLevel);
  const radial = useUI((s) => s.radial);
  const timeScale = useUI((s) => s.timeScale);
  const lit = Math.round(Math.min(1, speed / MAX_SPEED) * 24);
  const row = "flex h-[12px] justify-between text-[9.5px] leading-[12px] tracking-[0.2375px] text-dim halo md:h-[15px] md:text-[12px] md:leading-[15px] md:tracking-[0.3px]";
  return (
    <section
      id="speed-panel"
      data-hud-in="6"
      className="plus-frame absolute left-[var(--side)] top-[calc(env(safe-area-inset-top)+14px)] w-[148px] font-hud md:top-[max(26.45%,212px)] md:w-[230px]"
    >
      <span className="badge">01 / DRIVE</span>
      <div className="mt-[12px] flex h-[30px] items-baseline gap-[5px] md:h-[18px]">
        <span className="text-[30px] leading-[30px] text-mint glow md:text-[14px] md:leading-[17.5px]">{fmt(speed)}</span>
        <small className="text-[9.5px] text-dim halo md:text-[12px]">KM/S</small>
      </div>
      <div className="mt-[7px] flex h-[9px] gap-[2px] md:mt-[8px] md:h-[12px]" role="meter" aria-label="Speed relative to drive limit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((speed / MAX_SPEED) * 100)}>
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} className="seg" data-on={i < lit} />
        ))}
      </div>
      <div className={`mt-[4px] ${row}`}>
        <span>SPEED</span>
        <span className="text-alert">{limit}</span>
      </div>
      <div className="mt-[9px] h-[2px] bg-rule md:mt-[12px]">
        <i className="block h-full bg-[linear-gradient(90deg,#f26500,#ff4747)] transition-[width] duration-[160ms]" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className={`mt-[4px] ${row}`}>
        <span>THRUST</span>
        <span className={thrust === "IDLE" ? "text-alert" : thrust === "AUTOPILOT" || thrust === "ASSIST" ? "text-loc" : "text-mint"}>{thrust}</span>
      </div>
      <p className={`mt-[10px] md:mt-[12px] ${row}`}>{radial}</p>
      <p data-glitch title="Time passes faster during travel; approach assist slows you near bodies" className={`mt-[2px] md:mt-[4px] ${row}`}>
        TIME ×{fmt(timeScale)}
      </p>
    </section>
  );
}

/* ---------- bearings ---------- */

const GOLD_DIM = "#f0b32a29";
const GOLD = "#f0b32a59";

function Radar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const { engine, goTo } = useObservatory();
  useEffect(() => {
    const c = canvasRef.current!;
    const holder = dotsRef.current!;
    const g = c.getContext("2d")!;
    const pool = new Map<string, HTMLButtonElement>();
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now;
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
      const snap = e.radarSnapshot();
      const R = snap.range;
      const rot = (-snap.heading * Math.PI) / 180 + Math.PI / 2;
      const tilt = 0.48;
      const s = Math.min(w * 0.43, h * 0.63) / R;
      const cx = w / 2, cy = h * 0.52;
      const P = (x: number, y: number, z: number) => {
        const r = x * Math.cos(rot) - y * Math.sin(rot);
        const o = x * Math.sin(rot) + y * Math.cos(rot);
        return { x: cx + r * s, y: cy + (o * Math.sin(tilt) - z * Math.cos(tilt)) * s };
      };
      g.lineWidth = 1;
      // plane rings and cross
      for (const k of [0.33, 0.66, 1]) {
        g.strokeStyle = k === 1 ? GOLD : GOLD_DIM;
        g.beginPath();
        for (let i = 0; i <= 80; i++) {
          const a = (i / 80) * Math.PI * 2;
          const p = P(Math.cos(a) * R * k, Math.sin(a) * R * k, 0);
          if (i) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
        }
        g.stroke();
      }
      g.strokeStyle = GOLD_DIM;
      for (const a of [0, Math.PI / 2]) {
        const p1 = P(Math.cos(a) * R, Math.sin(a) * R, 0), p2 = P(-Math.cos(a) * R, -Math.sin(a) * R, 0);
        g.beginPath();
        g.moveTo(p1.x, p1.y);
        g.lineTo(p2.x, p2.y);
        g.stroke();
      }
      const top = P(0, 0, R * 0.7), bottom = P(0, 0, -R * 0.7);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(bottom.x, bottom.y);
      g.stroke();
      g.fillStyle = "#F26500";
      g.font = "10px 'Archivo Narrow', sans-serif";
      g.fillText("+Z", top.x + 5, top.y + 5);
      // arrows: where we look (mint) and where we are going (red)
      const arrow = (v: [number, number, number], len: number, colour: string) => {
        const o = P(0, 0, 0), t = P(v[0] * len, v[1] * len, v[2] * len);
        g.strokeStyle = g.fillStyle = colour;
        g.beginPath();
        g.moveTo(o.x, o.y);
        g.lineTo(t.x, t.y);
        g.stroke();
        const a = Math.atan2(t.y - o.y, t.x - o.x);
        g.beginPath();
        g.moveTo(t.x, t.y);
        g.lineTo(t.x - 7 * Math.cos(a - 0.4), t.y - 7 * Math.sin(a - 0.4));
        g.lineTo(t.x - 7 * Math.cos(a + 0.4), t.y - 7 * Math.sin(a + 0.4));
        g.fill();
      };
      arrow(snap.forward, R * 0.75, "#47FFA9");
      if (snap.velocity) arrow(snap.velocity, R * 0.6, "#FF4747");
      const o = P(0, 0, 0);
      g.shadowColor = g.fillStyle = "#54ff8a";
      g.shadowBlur = 6;
      g.fillRect(o.x - 2, o.y - 2, 4, 4);
      g.shadowBlur = 0;
      // stems and dots
      const seen = new Set<string>();
      for (const p of snap.pts) {
        const [x, y, z] = p.rel;
        const at = P(x, y, z), base = P(x, y, 0);
        g.strokeStyle = "#FF474766";
        g.beginPath();
        g.moveTo(base.x, base.y);
        g.lineTo(at.x, at.y);
        g.stroke();
        if (at.x < 7 || at.x > w - 7 || at.y < 7 || at.y > h - 7) continue;
        seen.add(p.id);
        let b = pool.get(p.id);
        if (!b) {
          b = document.createElement("button");
          b.type = "button";
          b.className = "scope-dot";
          b.innerHTML = "<i></i><span></span>";
          const id = p.id;
          b.onclick = (ev) => {
            ev.stopPropagation();
            goTo(id);
          };
          holder.append(b);
          pool.set(p.id, b);
        }
        b.hidden = false;
        b.style.left = `${at.x}px`;
        b.style.top = `${at.y}px`;
        b.classList.toggle("confirmed", p.known);
        b.classList.toggle("selected", p.selected);
        b.title = p.name;
        b.setAttribute("aria-label", `Navigate toward ${p.name}`);
        const label = p.selected || p.nearest ? p.name : "";
        const span = b.lastElementChild as HTMLSpanElement;
        if (span.textContent !== label) span.textContent = label;
      }
      for (const [id, b] of pool) if (!seen.has(id)) b.hidden = true;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      for (const b of pool.values()) b.remove();
    };
  }, [engine, goTo]);
  return (
    <div className="scope-wrap relative mt-[6px] h-[96px] md:mt-[8px] md:h-[143px]">
      <canvas ref={canvasRef} id="radar-canvas" data-glitch aria-label="Three-dimensional local radar, range one million kilometres" className="block h-full w-full" />
      <div ref={dotsRef} id="radar-dots" className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}

function ContactList() {
  const contacts = useUI((s) => s.contacts);
  const target = useUI((s) => s.target);
  const { goTo } = useObservatory();
  const [more, setMore] = useState(false);
  const phoneLimit = 3;
  if (!contacts.length) return <p className="contacts-empty mt-[4px] font-hud text-[11px] text-dim halo md:text-[12px]">Scan to find nearby signals.</p>;
  return (
    <>
      <div id="contact-list" aria-label="Detected contacts" className={`contact-list -mx-[7px] mt-[2px] md:mt-[4px] ${more ? "more" : ""}`}>
        {contacts.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => goTo(c.id)}
            aria-pressed={target === c.id}
            aria-label={`Navigate toward ${c.name}`}
            title={c.name}
            className={`contact-row ${target === c.id ? "selected" : ""} ${!more && i >= phoneLimit ? "max-md:hidden" : ""}`}
          >
            {c.unidentified ? (
              <span className="flex min-w-0">
                <span className="truncate text-dim">UNIDENTIFIED OBJECT</span>
                <span className="ml-[3px]">#{c.number}</span>
              </span>
            ) : (
              <span className="truncate">{c.name}</span>
            )}
            {c.distKm !== null && <small>{c.distKm < 1 ? `${Math.round(c.distKm * 1000)} M` : `${shortKm(c.distKm)} KM`}</small>}
          </button>
        ))}
      </div>
      {contacts.length > phoneLimit && (
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="pt-[6px] font-hud text-[10px] tracking-[1px] text-mint halo md:hidden">
          {more ? "− FEWER" : `+${contacts.length - phoneLimit} MORE`}
        </button>
      )}
    </>
  );
}

function BearingsPanel() {
  const heading = useUI((s) => s.heading);
  const elevation = useUI((s) => s.elevation);
  const course = useUI((s) => s.course);
  const alert = useUI((s) => s.courseAlert);
  // the contact list stays dark until Earth has been found
  const contactsOnline = useUI((s) => s.journey.beats.includes("earth-identified") || !["awakening", "inbound", "belt", "inner"].includes(s.journey.chapter));
  const hl = useUI((s) => s.highlight.includes("contacts"));
  const h = String(Math.round(heading) % 360).padStart(3, "0");
  const el = `${elevation >= 0 ? "+" : "−"}${String(Math.abs(Math.round(elevation))).padStart(2, "0")}`;
  return (
    <section
      id="radar-panel"
      data-hud-in="7"
      className="plus-frame absolute right-[var(--side)] top-[calc(env(safe-area-inset-top)+14px)] w-[148px] font-hud md:top-[max(26.45%,212px)] md:w-[237px]"
    >
      <span className="badge ml-auto">02 / BEARINGS</span>
      <div className="mt-[10px] md:mt-[12px]" title="Heading / elevation in the fixed J2000 ecliptic frame">
        <div className="flex h-[23px] items-end justify-between md:h-[18px] md:items-center">
          <span className="pb-[2px] text-[9.5px] leading-[12px] tracking-[0.2375px] text-dim halo md:pb-0 md:text-[12px] md:leading-[15px] md:tracking-[0.3px]">↗ LOOK</span>
          <span data-glitch className="flex gap-[6px] text-[18px] leading-[23px] text-mint glow md:text-[14px] md:leading-[17.5px]">
            <span>{h}°</span>
            <span className="opacity-60">/</span>
            <span>{el}°</span>
          </span>
        </div>
        <div className="mt-[4px] hidden h-[18px] items-center justify-between gap-[12px] md:flex">
          <span className="shrink-0 text-[12px] leading-[15px] tracking-[0.3px] text-dim halo">↗ COURSE</span>
          <span className={`truncate text-[14px] leading-[17.5px] glow ${alert ? "text-alert" : "text-mint"}`}>{course}</span>
        </div>
      </div>
      <Radar />
      <p className="mt-[2px] h-[12px] text-center text-[8px] leading-[12px] tracking-[0.2px] text-dim halo md:mt-[4px] md:h-[15px] md:text-[10px] md:leading-[15px] md:tracking-[0.25px]">J2000 ECLIPTIC · RANGE 1M KM</p>
      {contactsOnline && (
        <div id="bearing-contacts" data-hl={hl} className="hl mt-[8px] border-t border-rule pt-[6px] md:mt-[12px] md:pt-[8px]">
          <p className="h-[13px] text-[10.5px] leading-[13px] tracking-[0.2625px] text-key glow md:h-[15px] md:text-[12px] md:leading-[15px] md:tracking-[0.3px]">CONTACTS</p>
          <ContactList />
        </div>
      )}
    </section>
  );
}

/* ---------- target guide & approach ---------- */

function TargetGuide() {
  const target = useUI((s) => s.target);
  const { engine, clearTarget } = useObservatory();
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const chevRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = engine.current?.targetGuide();
      const el = ref.current;
      if (!el) return;
      if (!g) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.left = `${g.x}px`;
      el.style.top = `${g.y}px`;
      el.classList.toggle("on-target", g.onTarget);
      if (chevRef.current) {
        chevRef.current.textContent = g.label.endsWith("· HERE") ? "◇" : "➤";
        chevRef.current.style.transform = `rotate(${g.angle}deg)`;
      }
      if (nameRef.current && nameRef.current.textContent !== g.label) nameRef.current.textContent = g.label;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, target]);
  if (!target) return null;
  return (
    <div ref={ref} id="target-guide" className="target-guide">
      <span ref={chevRef} id="target-chevron" aria-hidden>
        ➤
      </span>
      <span ref={nameRef} id="target-name" />
      <button type="button" aria-label="Clear navigation target" onClick={clearTarget} className="pointer-events-auto text-[18.9px] leading-none text-dim hover:text-ink">
        ×
      </button>
    </div>
  );
}

/**
 * Lifts a bottom-anchored element clear of any of the given boxes it would sit on (a long
 * caption, the approach panel, the map sheet), back to where its class puts it once they are gone.
 */
function liftClear(el: HTMLElement, ids: string[]) {
  el.style.bottom = "";
  for (let pass = 0; pass < ids.length; pass++) {
    const r = el.getBoundingClientRect();
    let need = 0;
    for (const id of ids) {
      const o = document.getElementById(id)?.getBoundingClientRect();
      if (o && o.height > 0 && o.left < r.right && o.right > r.left && o.top < r.bottom + 10 && o.bottom > r.top) need = Math.max(need, window.innerHeight - o.top + 10);
    }
    if (!need) return;
    el.style.bottom = `${Math.round(need)}px`;
  }
}

function ApproachPanel() {
  const a = useUI((s) => s.approach);
  const sub = useUI((s) => s.subtitle);
  const ref = useRef<HTMLElement>(null);
  const up = a !== null;
  // on a phone the panel sits just over the captions: a long one lifts it clear
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => liftClear(el, ["subtitle-box"]);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [sub, up]);
  if (!a) return null;
  return (
    <section ref={ref} id="approach-panel" className={`approach-panel ${a.urgent ? "urgent" : ""}`} aria-live="polite">
      <strong id="approach-phase">{a.phase}</strong>
      <p>{a.detail}</p>
    </section>
  );
}

/* ---------- footer / misc ---------- */

function NavHelp() {
  // a tablet gets the wide layout but has no keys to name
  const touch = useTouch();
  return (
    <div
      id="nav-help"
      data-hud-in="5"
      className="absolute bottom-[20px] right-[var(--side)] hidden h-[28px] items-center gap-[12px] whitespace-nowrap font-hud text-[10px] leading-[12.5px] tracking-[0.25px] text-dim halo md:flex"
    >
      {touch ? (
        <>
          <span>DRAG TO LOOK AROUND</span>
          <span>PRESS AND HOLD TO FLY AHEAD</span>
        </>
      ) : (
        <>
          <span>W GO · S BACK</span>
          <span>DRAG / A D / ARROWS STEER</span>
          <span>SHIFT UP · SPACE DOWN</span>
          <span>X BRAKE</span>
        </>
      )}
    </div>
  );
}

function Toast() {
  const t = useUI((s) => s.toast);
  const sub = useUI((s) => s.subtitle);
  const approach = useUI((s) => s.approach !== null);
  const map = useUI((s) => s.mapExpanded);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  const [visible, setVisible] = useState(false);
  // a caption of two or three lines, or on a phone the approach panel or the map sheet, can reach
  // up to where the toast sits: the toast goes just above them
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => liftClear(el, ["subtitle-box", "approach-panel", "nav-dock"]);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [sub, shown, approach, map]);
  useEffect(() => {
    if (!t) return;
    const a = window.setTimeout(() => {
      setShown(t);
      setVisible(true);
    }, 0);
    const b = window.setTimeout(() => setVisible(false), 2300);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [t]);
  return (
    <div
      ref={ref}
      id="toast"
      role="status"
      className={`toast absolute bottom-[215px] left-1/2 -translate-x-1/2 whitespace-nowrap font-hud text-[11px] leading-[15px] tracking-[1.2px] text-mint glow-halo md:text-[12px] ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {shown?.text}
    </div>
  );
}

/** strength of the signal being followed, under the location */
function SignalMeter() {
  const k = useUI((s) => s.signal);
  if (k === null) return null;
  return (
    <div id="signal-meter" className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+36px)] z-[6] w-[180px] -translate-x-1/2 whitespace-nowrap text-center font-hud text-[10px] leading-[14px] tracking-[1.2px] text-dim halo max-[520px]:w-auto md:top-[62px] md:w-[220px]">
      SIGNAL <b className="font-normal text-mint glow">{k}%</b>
      {/* a narrow phone has no room for the bar between the drive and bearings panels: the figure says it */}
      <div className="mt-[3px] h-[3px] w-full bg-white/10 max-[520px]:hidden">
        <div className="h-full bg-mint transition-[width] duration-700" style={{ width: `${k}%` }} />
      </div>
    </div>
  );
}

/** Story read-outs (scan findings, signal alerts): a heading, then the lines one by one. */
function Readout() {
  const r = useUI((s) => s.readout);
  const ending = useUI((s) => s.journey.chapter === "ending");
  const [shown, setShown] = useState<NonNullable<typeof r> | null>(null);
  useEffect(() => {
    if (!r) return;
    const a = window.setTimeout(() => setShown(r), 0);
    const b = window.setTimeout(() => setShown((x) => (x?.key === r.key ? null : x)), r.ms);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [r]);
  if (!shown && ending) {
    // home: the final state stays up
    return (
      <div role="status" className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+40px)] z-[6] -translate-x-1/2 whitespace-nowrap text-center font-hud text-[10px] leading-[16px] tracking-[1.2px] halo md:top-[66px] md:text-[11.5px] md:leading-[19px]">
        {ENDING_STATE.map((l, i) => (
          <p key={l} className={`readout-line ${i === 0 ? "text-alert" : "text-mint"}`} style={{ animationDelay: `${i * 700}ms` }}>
            {l}
          </p>
        ))}
      </div>
    );
  }
  if (!shown) return null;
  return (
    <div
      key={shown.key}
      id="readout"
      role="status"
      aria-live="polite"
      className="readout absolute left-1/2 top-[calc(env(safe-area-inset-top)+40px)] z-[6] -translate-x-1/2 whitespace-nowrap text-center font-hud halo md:top-[66px]"
    >
      <p className="readout-line readout-title text-[11px] font-bold leading-[18px] tracking-[2px] text-alert md:text-[13.5px] md:leading-[22px]">{shown.title}</p>
      {shown.lines.map((l, i) => (
        <p key={i} className="readout-line text-[10.5px] leading-[17px] tracking-[1.3px] text-mint glow md:text-[12.5px] md:leading-[20px]" style={{ animationDelay: `${450 + i * 650}ms` }}>
          {l}
        </p>
      ))}
    </div>
  );
}

export default function Hud() {
  useHudIn();
  useGlitch();
  return (
    <div id="helmet-hud" className="pointer-events-none absolute inset-0 z-[5] [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_canvas]:pointer-events-auto">
      <header>
        <Brand />
        <Location />
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+44px)] right-[var(--side)] flex flex-col items-end md:bottom-auto md:top-[30px] md:flex-row md:items-center md:gap-[16px]">
          <ArchiveButton />
          <RecordsButton />
          <SoundToggle />
        </div>
        <Credit className="absolute right-[var(--side)] top-[62px] hidden md:flex" />
      </header>
      <div className="crosshair" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <DrivePanel />
      <BearingsPanel />
      <ApproachPanel />
      <TargetGuide />
      <NavHelp />
      <Toast />
      <SignalMeter />
      <Readout />
      <Objective />
    </div>
  );
}
