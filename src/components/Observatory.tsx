"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ScanResult, SpaceEngine, Telemetry } from "./scene/engine";
import { byId, type BodyDef } from "@/lib/solar";
import { say, store, toast, useUI, type Story } from "@/lib/store";
import { audio } from "@/lib/audio";
import { BELT_LINE, CHAR_MS, CONTACT, DEEP_SCAN_LINE, EXPLORE_DESKTOP, EXPLORE_PHONE, NOTHING_NEW, OPENING, SCAN_SIGHTED, SWEEP_AT, SWEEP_MS, TRAVEL } from "@/lib/script";
import Loader from "./Loader";
import Narrative from "./Narrative";
import Hud, { ScanPanel } from "./hud/Hud";
import Targets from "./hud/Targets";
import NavMap from "./hud/NavMap";
import Logbook from "./records/Logbook";

type Actions = {
  loaded: () => void;
  scan: () => void;
  wake: () => void;
  advance: () => void;
  skip: () => void;
  openRecords: () => void;
  closeRecords: () => void;
  /** select a contact (body id or "star:NAME") and turn toward it */
  pick: (id: string) => void;
  clearTarget: () => void;
  /** fly to a body from the system map */
  travel: (id: string) => void;
  cancelTravel: () => void;
};
type Ctx = { engine: React.RefObject<SpaceEngine | null> } & Actions;

const ObservatoryContext = createContext<Ctx | null>(null);
export const useObservatory = () => useContext(ObservatoryContext)!;

const MOBILE_QUERY = "(max-width: 700px)";
const SCAN_MS = 2400;
const isPhone = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Observatory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpaceEngine | null>(null);
  const story = useUI((s) => s.story);
  const records = useUI((s) => s.records);
  const sceneError = useUI((s) => s.sceneError);
  const blackout = useUI((s) => s.blackout);

  // ---------- story machine ----------
  const actions = useMemo<Actions>(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const clearTimers = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.length = 0;
    };
    const go = (s: Story) => store.set({ story: s });
    const lineMs = (text: string) => text.length * CHAR_MS;
    const sayFor = (text: string, ms = 5200) => {
      say(text, { named: true });
      later(lineMs(text) + ms, () => store.get().subtitle?.text === text && store.set({ subtitle: null }));
    };

    function startWaking() {
      go("waking");
      OPENING.forEach((l) => later(l.at ?? 0, () => store.get().story === "waking" && say(l.text)));
      later(SWEEP_AT, () => engineRef.current?.sweepToPlanet(SWEEP_MS));
    }

    function wake() {
      if (store.get().soundOn) {
        audio.unlock();
        audio.setEnabled(true);
      }
      if (store.get().story === "gate") startWaking();
    }

    function advance() {
      if (store.get().story !== "waking") return;
      clearTimers();
      engineRef.current?.sweepToPlanet(900);
      store.set({ subtitle: null });
      go("awaiting-scan");
      audio.ui();
    }

    function enterExplore() {
      clearTimers();
      const e = engineRef.current;
      if (!e) return;
      const from = store.get().story;
      if (from === "waking" || from === "awaiting-scan") e.snapExplore();
      else e.setExplore();
      store.set({ subtitle: null, scanning: false });
      go("exploring");
      const lines = isPhone() ? EXPLORE_PHONE : EXPLORE_DESKTOP;
      lines.forEach((l) => later(l.at ?? 0, () => say(l.text, { named: l.named, instructions: l.instructions })));
      const last = lines[lines.length - 1];
      later((last.at ?? 0) + lineMs(last.text) + 4200, () => store.set({ subtitle: null }));
    }

    function skip() {
      if (!["waking", "awaiting-scan", "contact"].includes(store.get().story)) return;
      audio.ui();
      enterExplore();
    }

    function finishScan(e: SpaceEngine, result: ScanResult, opening: boolean) {
      e.commitScan(result);
      store.set({ scanning: false, scanLevel: store.get().scanLevel + 1, starsNamed: e.namedStars });
      if (result.stage === "deep") {
        sayFor(result.stars.length ? DEEP_SCAN_LINE : NOTHING_NEW);
      } else if (opening) {
        let t = 70;
        CONTACT.forEach((l) => {
          later(t, () => store.get().story === "contact" && say(l.text, { named: l.named }));
          t += lineMs(l.text) + 2300;
        });
        later(t + 300, () => store.get().story === "contact" && enterExplore());
      } else {
        const primary = result.primary ? result.contacts.find((c) => c.id === result.primary) : null;
        const def = primary ? byId.get(primary.id) : null;
        if (def && primary) sayFor(primary.status === "scanned" ? def.callout : SCAN_SIGHTED(e.name(def.id)));
        else sayFor(NOTHING_NEW);
      }
      if (result.contacts.some((c) => c.fresh) || result.stars.length) audio.discover();
    }

    function scan() {
      const e = engineRef.current;
      const s = store.get();
      if (!e || s.scanning || s.records !== "closed" || s.story === "waking") return;
      const opening = s.story === "awaiting-scan";
      const result = e.scan();
      e.beginScanFx(result);
      store.set({ scanning: true, scanStage: result.stage });
      audio.sweep();
      if (opening) {
        go("contact");
        e.dollyIn(1600);
      }
      later(SCAN_MS, () => finishScan(e, result, opening));
    }

    function openRecords() {
      if (store.get().records !== "closed") return;
      audio.ui();
      store.set({ records: "loading" });
      window.setTimeout(() => store.get().records === "loading" && store.set({ records: "open" }), 600);
    }
    function closeRecords() {
      audio.ui();
      store.set({ records: "closed" });
    }

    function pick(id: string) {
      const e = engineRef.current;
      if (!e || store.get().story !== "exploring") return;
      audio.blip(990, 0.05, "square", 0.03);
      if (id.startsWith("star:")) {
        e.lookAtStar(id.slice(5));
        return;
      }
      e.select(id);
      store.set({ target: id });
      e.lookAtBody(id);
    }

    function clearTarget() {
      engineRef.current?.select(null);
      store.set({ target: null });
    }

    function travel(id: string) {
      const e = engineRef.current;
      const s = store.get();
      if (!e || s.story !== "exploring" || s.blackout) return;
      clearTimers();
      store.set({ target: id, subtitle: null });
      if (reducedMotion()) {
        // no fly-through: fade out, move, fade back in
        store.set({ blackout: true });
        audio.engage();
        window.setTimeout(() => {
          if (!engineRef.current?.jumpTo(id)) sayFor(TRAVEL.already);
          window.setTimeout(() => store.set({ blackout: false }), 120);
        }, 380);
        return;
      }
      if (!e.travelTo(id, true)) {
        e.lookAtBody(id);
        sayFor(TRAVEL.already);
        return;
      }
      audio.engage();
      sayFor(TRAVEL.engage(e.name(id)), 1800);
    }

    function cancelTravel() {
      engineRef.current?.cancelAutopilot(false);
    }

    /** Loader finished; sound starts muted, so there is nothing to unlock. */
    function loaded() {
      if (store.get().story !== "loading") return;
      store.set({ loaderDone: true });
      startWaking();
    }

    return { loaded, scan, wake, advance, skip, openRecords, closeRecords, pick, clearTarget, travel, cancelTravel };
  }, []);

  // Boot the renderer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: SpaceEngine | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    const mq = window.matchMedia(MOBILE_QUERY);

    import("./scene/engine")
      .then(({ SpaceEngine }) => {
        if (cancelled) return;
        try {
          engine = new SpaceEngine(canvas, { mobile: mq.matches, reducedMotion: reducedMotion() });
        } catch {
          store.set({ sceneError: true });
          return;
        }
        engineRef.current = engine;
        // handy for poking at the scene from the console while developing
        if (process.env.NODE_ENV !== "production") (window as unknown as { __sanctuary?: SpaceEngine }).__sanctuary = engine;
        const restored = engine.restoredState();
        store.set({ identified: restored.identified, reached: restored.reached, starsNamed: restored.stars });
        const fit = () => engine!.resize(canvas.clientWidth, canvas.clientHeight, mq.matches);
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(canvas);
        engine.onTelemetry = (t: Telemetry) => {
          const s = store.get();
          store.set({
            hasMoved: s.hasMoved || t.speed > 5,
            speed: Math.round(t.speed),
            limitText: t.limitText,
            thrustLevel: Math.round(t.thrustLevel * 100) / 100,
            thrustText: t.thrustText,
            radial: t.radial,
            timeScale: Math.round(t.timeScale),
            heading: Math.round(t.heading) === Math.round(s.heading) ? s.heading : t.heading,
            elevation: Math.round(t.elevation) === Math.round(s.elevation) ? s.elevation : t.elevation,
            course: t.course,
            courseAlert: t.courseAlert,
            location: t.location,
            contacts: sameContacts(s.contacts, t.contacts) ? s.contacts : t.contacts,
            autopilot: sameAuto(s.autopilot, t.autopilot) ? s.autopilot : t.autopilot,
            approach: sameApproach(s.approach, t.approach) ? s.approach : t.approach,
            scanStage: s.scanning ? s.scanStage : t.scanStage,
          });
          audio.setTravel(Math.min(1, Math.sqrt(t.speed / 200_000) * 1.2));
          audio.setDrive(t.autopilot?.mode === "flying" ? 1 : 0);
        };
        engine.onRecordsChange = (identified, reached) => store.set({ identified, reached });
        engine.onReached = (b: BodyDef) => {
          audio.discover();
          toast(`REACHED ${b.name.toUpperCase()}`);
        };
        engine.onArrive = (b: BodyDef) => {
          audio.arrive();
          say(TRAVEL.arrive(b.name.toUpperCase(), true), { named: true });
          window.setTimeout(() => {
            if (store.get().subtitle?.text === TRAVEL.arrive(b.name.toUpperCase(), true)) store.set({ subtitle: null });
          }, 4800);
        };
        engine.onTravelEnd = (reason) => {
          audio.setDrive(0);
          if (reason === "cancelled") {
            audio.ui();
            toast("AUTOPILOT OFF · MANUAL CONTROL");
          }
        };
        engine.onHold = (text) => toast(text);
        engine.onBelt = () => {
          say(BELT_LINE, { named: true });
          window.setTimeout(() => {
            if (store.get().subtitle?.text === BELT_LINE) store.set({ subtitle: null });
          }, 5600);
        };
        engine.start();
      })
      .catch(() => store.set({ sceneError: true }));

    return () => {
      cancelled = true;
      ro?.disconnect();
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Indian Standard Time clock (UTC+5:30).
  useEffect(() => {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const tick = () => {
      const d = new Date(Date.now() + 5.5 * 3_600_000);
      const p = (n: number) => String(n).padStart(2, "0");
      store.set({
        clock: `${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}  ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} IST`,
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Global keys. Pointer clicks on buttons blur them so Space never re-triggers a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = store.get();
      if (s.story === "gate") {
        actions.wake();
        return;
      }
      if (e.code === "Escape" && s.records !== "closed") return actions.closeRecords();
      if (s.records !== "closed") return;
      if (e.code === "Enter" && s.story === "waking") {
        e.preventDefault();
        actions.advance();
      }
      if (e.code === "KeyF") actions.scan();
      if (e.code === "KeyM" && s.story === "exploring") store.set({ mapExpanded: !s.mapExpanded });
      if (e.code === "Escape" && s.story === "exploring") {
        if (s.autopilot?.mode === "flying") actions.cancelTravel();
        else if (s.target) actions.clearTarget();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (store.get().story === "gate") actions.wake();
      const btn = (e.target as HTMLElement | null)?.closest("button");
      if (btn && e.pointerType !== "") window.setTimeout(() => btn.blur(), 0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onPointer);
    };
  }, [actions]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.inputEnabled = records === "closed" && story === "exploring";
  }, [records, story]);

  const showScan = story === "awaiting-scan" || story === "contact" || story === "exploring";

  return (
    <ObservatoryContext.Provider value={{ engine: engineRef, ...actions }}>
      <main aria-label="Solar system survey" className="relative h-dvh w-full overflow-hidden bg-void" data-story={story}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="Interactive three-dimensional solar system. Drag or use A and D, Q and E and the arrow keys to look; W accelerates along your view, S slows and reverses, Shift and Space move up and down, X brakes, the mouse wheel zooms. F scans what is in view."
          className="absolute inset-0 h-full w-full touch-none outline-none"
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="scanlines" />
        </div>
        <div aria-hidden className={`pointer-events-none absolute inset-0 z-[25] bg-void transition-opacity duration-[350ms] ${blackout ? "opacity-100" : "opacity-0"}`} />

        <Targets />
        {story === "exploring" && <Hud />}
        {story === "exploring" && <NavMap />}
        {showScan && <ScanPanel />}
        <Narrative />
        <Loader />
        <Logbook />
        {sceneError && (
          <div role="alert" className="absolute inset-x-0 top-1/2 z-[26] mx-auto w-[min(420px,calc(100vw-32px))] -translate-y-1/2 border border-ember bg-void/90 p-[18px] text-center font-hud text-[12px] leading-[18px] tracking-[0.3px] text-ash">
            <p className="font-bold text-alert">3D VIEW UNAVAILABLE</p>
            <p className="mt-[6px]">This browser could not start WebGL. Try enabling hardware acceleration or another browser. The records still work.</p>
          </div>
        )}
      </main>
    </ObservatoryContext.Provider>
  );
}

function sameContacts(a: Telemetry["contacts"], b: Telemetry["contacts"]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;
    const da = a[i].distKm, db = b[i].distKm;
    if ((da === null) !== (db === null)) return false;
    if (da !== null && db !== null && Math.abs(da - db) > Math.max(1, da * 0.0005)) return false;
  }
  return true;
}

function sameAuto(a: Telemetry["autopilot"], b: Telemetry["autopilot"]) {
  if (!a || !b) return a === b;
  return a.mode === b.mode && a.id === b.id && a.name === b.name;
}

function sameApproach(a: Telemetry["approach"], b: Telemetry["approach"]) {
  if (!a || !b) return a === b;
  return a.phase === b.phase && a.detail === b.detail && a.urgent === b.urgent;
}
