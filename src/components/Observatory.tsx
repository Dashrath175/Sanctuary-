"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { Pose, ScanResult, SpaceEngine, Telemetry } from "./scene/engine";
import type { Mood } from "@/lib/music";
import type { CutName } from "./scene/cutscene";
import { AU_KM, byId, type BodyDef } from "@/lib/solar";
import { announceUnlock, showReadout, store, toast, useUI, type Story } from "@/lib/store";
import { audio } from "@/lib/audio";
import { estimateMs, hush, inScene, readOut, remark, speak } from "@/lib/dialogue";
import { preloadVoices } from "@/lib/voice";
import { clearProgress, loadSave, unlocksFor, writeSave, type Chapter, type Journey } from "@/lib/journey";
import { CLUES, DEEP_TOO_FAR, HINT_INWARD, HINT_NEAR_LINES, HINT_OUTWARD, SHIP1_DONE, deepBeat, explorationProgress, foundBeat, recovered, siteOpen, type ClueSite } from "@/lib/clues";
import * as F from "@/lib/finale";
import type { Cue } from "@/lib/dialogue";
import {
  BELT_CLEAR, BELT_ENTER, EARTH_NONE, HOMEWARD, INBOUND_TALK, INBOUND_TALK_AFTER_MS, BELT_TOAST_IN, BELT_TOAST_OUT, CONTACT, CONTROLS_DESKTOP, CONTROLS_PHONE, DEEP_SCAN_LINES,
  EARTH_FOUND, EARTH_SIGNALS, EARTH_YEAR, MAP_LOCKED, MAP_UNIDENTIFIED, NOTHING_NEW_LINES, OPENING, READ_IDENTIFIED,
  READ_UNIDENTIFIED, SCAN_DOWN, SCAN_PROMPT_AFTER_MS, SCAN_SIGHTED_LINES, SWEEP_AT, SWEEP_MS, TRAVEL, identifyLine, pick as pickLine,
  BRAKE_LINES, RESCAN_LINES, SITE_ALONGSIDE_LINES, PLAYER_ARRIVE_LINES, PLAYER_BRAKE_LINES, deal,
} from "@/lib/script";
import Loader from "./Loader";
import Narrative from "./Narrative";
import Hud, { ScanPanel } from "./hud/Hud";
import Targets from "./hud/Targets";
import NavMap from "./hud/NavMap";
import Logbook from "./records/Logbook";
import Archive from "./records/Archive";
import { ChapterCard, EndingChoices, JoltFlash, Letterbox, UnlockBanner, useHudInterference } from "./hud/StoryHud";

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
  /** a contact clicked (list, radar, on-screen marker): a vehicle gets a course, anything else a look */
  goTo: (id: string) => void;
  clearTarget: () => void;
  /** fly to a body from the system map */
  travel: (id: string) => void;
  cancelTravel: () => void;
  /** the engine brought us alongside a body (autopilot or a vehicle taking the view) */
  arrived: (b: BodyDef) => void;
  /** a body reached for the first time (called just before `arrived`) */
  reachedFirst: (b: BodyDef) => void;
  /** after the story: keep exploring, or start again */
  keepFlying: () => void;
  newJourney: () => void;
  /** engine callbacks that move the story on */
  beltCrossed: (inside: boolean) => void;
  track: (t: Telemetry) => void;
};
type Ctx = { engine: React.RefObject<SpaceEngine | null> } & Actions;

const ObservatoryContext = createContext<Ctx | null>(null);
export const useObservatory = () => useContext(ObservatoryContext)!;

const MOBILE_QUERY = "(max-width: 700px)";
const SCAN_MS = 2400;
const isPhone = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// the asteroid belt counts as crossed once we are this close to the Sun
const PAST_BELT_AU = 2.4;
const INSIDE_BELT_AU = 1.9;
// evidence sites: where the AI first notices one (a DEEP SCAN needs us alongside)
const SITE_NOTICE_KM = 5_000_000;
/** while we look for Earth, a scan names it (and home is found) only this close to it */
const EARTH_FOUND_KM = 80_000;
const SITE_HINT_AFTER_MS = 7000;
/** with nothing found for this long, FABLE points the way again */
const IDLE_HINT_MS = 150_000;
/** how often the commander says something on reaching a world for the first time */
const PLAYER_ARRIVE_CHANCE = 0.4;
const PLAYER_BRAKE_CHANCE = 0.35;
// a rescan of something known gets a word at most this often; other repeats, this often
const KNOWN_QUIET_MS = 90_000;
const REPEAT_QUIET_MS = 20_000;
// the ships: where the AI says the signal is close, and how often it reports the strength
const SHIP_CLOSE_KM = 5_000_000;
const SHIP_SCAN_KM = 400_000;
const SIGNAL_REPORT_MS = 20_000;
/** 0..1 signal strength from distance: full at 100,000 km, nothing past 40 AU */
const strength = (km: number) => Math.max(0, Math.min(1, 1 - Math.log10(Math.max(km, 1e5) / 1e5) / Math.log10(6e9 / 1e5)));

// ---------- the score's place in the mix ----------

/** when the ship came to rest (null while moving); the score settles after 5 s at rest */
let restSince: number | null = null;
const REST_AFTER_MS = 5000;
/** a save this close to a vehicle (km) was made alongside it: holding beside it, or in its mission */
const BESIDE_SAVE_KM = 2_000;
/** the score starts the first time we fly forward (thrust or autopilot), not at the gate */
let underway = false;
function updateMusic() {
  const s = store.get();
  const now = performance.now();
  audio.music({
    // silent through any mission (a scene that holds the controls, or a site waiting for its deep scan)
    on: underway && s.story !== "loading" && s.story !== "gate" && !s.locked && !s.deepOnly && !s.replaying,
    dialogue: (!!s.subtitle && !s.subtitle.instructions) || !!s.playback,
    rest: restSince !== null && now - restSince > REST_AFTER_MS && !s.cut,
    paused: s.records !== "closed" || s.archiveOpen,
  });
}

// ---------- the journey: chapter, story beats, unlocks ----------

const journey = () => store.get().journey;
function setJourney(patch: Partial<Journey>) {
  const j = { ...journey(), ...patch };
  store.set({ journey: j, unlocks: unlocksFor(j.chapter) });
}
const setChapter = (chapter: Chapter) => journey().chapter !== chapter && setJourney({ chapter });
const hasBeat = (b: string) => journey().beats.includes(b);
const markBeat = (b: string) => !hasBeat(b) && setJourney({ beats: [...journey().beats, b] });

// A major scene (a discovery, a recording, the reconstruction) takes the controls while it
// plays: the ship stops, the view holds, scanning and navigation wait. Small lines don't.
let holds = 0;
let haltShip: () => void = () => {};
/** a hard stop from this speed (km/s) or more gets a word from FABLE, at most this often */
const BRAKE_WARN_KM_S = 10_000;
const BRAKE_WARN_GAP_MS = 9_000;
let lastBrakeWarn = -Infinity;

/** film our own ship (a cutscene); set once the engine exists. `ms`: how long a montage should run */
let film: (name: CutName, target?: string, ms?: number, count?: number) => Promise<void> = () => Promise.resolve();
/** a major mission's camera: outside on our ship and its target, always moving, the HUD away */
let missionCam: (target: string) => void = () => {};
/** back to the cockpit, if the mission camera is still the one filming */
let missionEnd: () => void = () => {};
function held<T>(p: Promise<T>): Promise<T> {
  if (++holds === 1) {
    store.set({ locked: true });
    haltShip();
  }
  return p.finally(() => {
    if (--holds === 0) store.set({ locked: false });
  });
}

/** A scene plays once (marked done only when heard to the end); a major one holds the controls. */
const scene = (id: string, cues: Parameters<typeof speak>[0], major = false) =>
  hasBeat(id) ? Promise.resolve(true) : (major ? held(speak(cues)) : speak(cues)).then((ok) => (ok && markBeat(id), ok));

/** What the story lets the engine show: the ships only from their chapters, the ISS only once the
 * first ship has pointed to it, Earth alone after the belt. */
function storyToEngine(e: SpaceEngine) {
  const j = journey();
  const show = (beat: string) => j.beats.includes(beat);
  e.setHidden([...(show("signal-start") ? [] : ["derelict-1"]), ...(show("tx-start") ? [] : ["derelict-2"]), ...(show(SHIP1_DONE) ? [] : ["iss"])]);
  e.scanOnly = j.chapter === "inner" ? "earth" : null;
  // while the first ship's signal is followed, a scan finds where it is from a billion km away (in
  // any direction); once its mission is over it is found like any other site again
  e.farSight = new Map(j.chapter === "signal" && !show(SHIP1_DONE) ? [["derelict-1", 1e9]] : []);
  e.scanOnlyKm = j.chapter === "inner" ? EARTH_FOUND_KM : 0;
  e.holdOff(null, 0);
}

/** Where the montage goes: every site in the order it was found, with both ships in their place. */
function montageHosts() {
  const stops: string[] = [];
  for (const b of journey().beats) {
    const site = /^clue:([a-z]+)$/.exec(b);
    const host = site ? CLUES.find((c) => c.id === site[1])?.host : b === "ship1-found" ? "derelict-1" : b === "ship2-found" ? "derelict-2" : null;
    if (host && !stops.includes(host)) stops.push(host);
  }
  return stops;
}

const MOODS: Record<Chapter, Mood> = {
  awakening: "drift",
  inbound: "drift",
  belt: "belt",
  inner: "home",
  earth: "home",
  explore: "survey",
  signal: "signal",
  transmission: "transmission",
  reckoning: "record",
  ending: "lonely",
};

export default function Observatory() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpaceEngine | null>(null);
  const story = useUI((s) => s.story);
  const records = useUI((s) => s.records);
  const sceneError = useUI((s) => s.sceneError);
  const blackout = useUI((s) => s.blackout);
  const mapOnline = useUI((s) => s.unlocks.map);
  const archiveOpen = useUI((s) => s.archiveOpen);
  const locked = useUI((s) => s.locked);
  const deepOnly = useUI((s) => s.deepOnly);
  const cut = useUI((s) => s.cut);

  // ---------- story machine ----------
  const resumeRef = useRef<(Journey & { pose: Pose }) | null>(null);
  /** set while a new journey wipes the save, so leaving the page does not write it back */
  const erasing = useRef(false);
  const sunAU = useRef(Infinity);
  const actions = useMemo<Actions>(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const clearTimers = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.length = 0;
    };
    const go = (s: Story) => store.set({ story: s });

    function startWaking() {
      go("waking");
      // first our ship, adrift near Uranus; then the commander wakes inside it
      void film("opening").then(() => {
        if (store.get().story !== "waking") return;
        // first person: the visor's panels flicker on one by one
        engineRef.current?.bootGlitch(1.8);
        OPENING.forEach((l) => later(l.at, () => store.get().story === "waking" && readOut(l)));
        later(SWEEP_AT, () => engineRef.current?.sweepToPlanet(SWEEP_MS));
        // the scan prompt comes up once Uranus is framed
        later(SWEEP_AT + SWEEP_MS + SCAN_PROMPT_AFTER_MS, advance);
      });
    }

    /** The gate click: sound on (voices need a click to start), then the game. */
    function wake() {
      if (store.get().story !== "gate") return;
      // the game takes the whole screen, as F11 would (this click is the gesture a browser asks for)
      const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (!document.fullscreenElement) {
        if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
        else root.webkitRequestFullscreen?.();
      }
      store.set({ soundOn: true });
      audio.unlock();
      audio.setEnabled(true);
      audio.mood(MOODS[journey().chapter]);
      updateMusic();
      begin();
    }

    /** Resume a saved journey, or wake up near Uranus. */
    function begin() {
      const e = engineRef.current;
      const save = resumeRef.current;
      resumeRef.current = null;
      if (e && save && e.restorePose(save.pose)) {
        enterExplore(true);
        // saved beside a vehicle (a site, a ship): hold beside it again, so it is on screen (a world's
        // hold height can push us well off a vehicle in a low orbit, like the ISS). Only when the save
        // really was alongside it: on the way out to one it can be the nearest thing by far, and a
        // reload there must leave us where we were, not fly us in and start its mission.
        const kind = byId.get(save.pose.body)?.kind;
        const alongside = Math.hypot(...save.pose.offset) <= BESIDE_SAVE_KM;
        if ((kind === "spacecraft" || kind === "satellite") && alongside)
          later(400, () => {
            resumingBeside = engineRef.current?.closeIn(save.pose.body) ?? false;
          });
      } else startWaking();
    }

    function advance() {
      if (store.get().story !== "waking") return;
      clearTimers();
      engineRef.current?.sweepToPlanet(900);
      store.set({ subtitle: null });
      go("awaiting-scan");
      audio.ui();
    }

    /** Hand over the controls; `resumed` when a save put us back where we were. */
    function enterExplore(resumed = false) {
      clearTimers();
      hush();
      store.set({ deepOnly: false });
      const e = engineRef.current;
      if (!e) return;
      e.endCut();
      e.endZoom();
      const from = store.get().story;
      if (!resumed) {
        if (from === "waking" || from === "awaiting-scan") e.snapExplore();
        else e.setExplore();
      }
      store.set({ scanning: false });
      go("exploring");
      if (journey().chapter === "awakening") setChapter("inbound");
      if (resumed) toast("JOURNEY RESUMED");
      // pick the story up wherever it stands
      const c = journey().chapter;
      if (c !== "reckoning") void speak([isPhone() ? CONTROLS_PHONE : CONTROLS_DESKTOP]);
      if (c === "inbound" && !hasBeat("inbound-talk")) later(resumed ? 12_000 : INBOUND_TALK_AFTER_MS, inboundTalk);
      if (c === "earth") earthNext();
      if (c === "signal") later(4000, signalNext);
      if (c === "transmission") later(4000, transmissionNext);
      if (c === "reckoning") later(1500, reconstruct);
      if (c === "ending" && !hasBeat("part-two")) later(2500, epilogue);
    }

    // ---------- Earth: home, and nobody there ----------

    // ---------- the major missions (Earth, both ships) ----------

    let onMission = false;
    /**
     * A major mission plays out in the third person: the camera leaves the cockpit and keeps
     * moving round our ship and the target, the HUD goes, the controls wait, and FABLE runs the
     * scans and plays the recordings itself. `keep` leaves the camera filming afterwards (the
     * reconstruction carries on from the second ship).
     */
    async function mission(target: string, body: () => Promise<boolean>, keep = false) {
      if (onMission) return false;
      onMission = true;
      missionCam(target);
      try {
        return await held(body());
      } finally {
        onMission = false;
        if (!keep) missionEnd();
      }
    }

    /** A ship's mission films us alongside it: from farther off (a resumed journey sits outside its
     * hold distance) we close in first, and the arrival starts the mission. */
    const closingIn = (id: string) => !onMission && !!engineRef.current && !engineRef.current.beside(id) && engineRef.current.closeIn(id);

    /** FABLE scans on its own during a mission: the sweep, then the time a scan takes */
    const autoScan = () =>
      new Promise<void>((done) => {
        audio.sweep();
        later(SCAN_MS, done);
      });

    /** Earth: found, the deep scan, the year, the signals; then the systems come online. */
    function earthNext() {
      if (onMission || journey().chapter !== "earth") return;
      if (hasBeat("earth-signals")) return earthDone();
      // the mission is filmed over Earth's day side (not whatever side we came in on), far enough
      // out that Earth sits in the frame rather than filling it
      engineRef.current?.toDayside("earth", 48_000);
      void mission("earth", async () => {
        // the commander asks for the deep scan and FABLE runs it
        if (!(await scene("earth-identified", EARTH_FOUND))) return false;
        if (!hasBeat("earth-deep")) {
          await autoScan();
          markBeat("earth-deep");
        }
        if (!hasBeat("earth-year")) {
          // the ship's calendar flips as the AI reads the year out
          const [doubt, ...rest] = EARTH_YEAR;
          if (!hasBeat("year-2126")) {
            if (!(await speak([EARTH_NONE, doubt]))) return false;
            markBeat("year-2126");
          }
          if (!(await scene("earth-year", rest))) return false;
        }
        return scene("earth-signals", EARTH_SIGNALS);
      }).then((ok) => ok && earthDone());
    }

    function earthDone() {
      if (journey().chapter !== "earth") return;
      setChapter("explore");
      announceUnlock("SYSTEMS ONLINE", ["SOLAR MAP", "AUTOPILOT", "CONTACTS", "ARCHIVE", "EXPLORATION TRACKER"], ["map", "contacts", "archive"]);
      audio.discover();
      later(SITE_HINT_AFTER_MS + 3000, hintNext);
    }

    /** On the way in, before the belt: a few words between the commander and the ship. */
    function inboundTalk() {
      if (journey().chapter !== "inbound" || hasBeat("inbound-talk")) return;
      if (store.get().story !== "exploring" || store.get().records !== "closed" || inSceneNow()) return void later(4000, inboundTalk);
      void scene("inbound-talk", INBOUND_TALK);
    }

    /** The end of the opening: the view finds the Sun and leans in on it, then the controls are handed over. */
    function homeward() {
      // the Sun as FABLE points to it, then Earth as it is named (both as their models, not the
      // Sun's glare); back in the cockpit, facing the Sun, for the hand-over
      const show = (id: string) => () => void engineRef.current?.playCut("showcase", id);
      const back = () => {
        const e = engineRef.current;
        if (e?.cutName !== "showcase") return;
        e.endCut();
        e.faceSun();
      };
      const last = HOMEWARD.length - 1;
      const cues = HOMEWARD.map((c, i) => (i === 0 ? { ...c, onStart: show("sun") } : i === 1 ? { ...c, onStart: show("earth") } : i === last ? { ...c, onStart: back } : c));
      void speak(cues).then((ok) => {
        back();
        if (!ok || store.get().story !== "contact") return;
        markBeat("bearings");
        enterExplore();
      });
    }

    // ---------- evidence sites ----------

    const reading = new Set<string>();
    // the evidence sites wait while a signal is being followed or the story is closing
    const sitesOpen = () => journey().chapter === "explore" || (journey().chapter === "ending" && hasBeat("part-two") && !store.get().finished);
    /** a site found but not yet deep-scanned that we are alongside: its deep scan can run */
    const pendingDeep = (e: SpaceEngine) => CLUES.find((c) => c.major && hasBeat(foundBeat(c.id)) && !hasBeat(deepBeat(c.id)) && e.beside(c.host));

    function addArchive(id: string) {
      const j = journey();
      if (!j.archive.includes(id)) setJourney({ archive: [...j.archive, id] });
    }

    /** First scan of a site: what it is, what it holds, and (small sites) straight into the archive. */
    function siteFound(site: ClueSite, intro: { text: string; parts: string[] } | null) {
      markBeat(foundBeat(site.id));
      lastNudge = performance.now();
      showReadout(site.found.title, site.found.lines, 9000);
      audio.discover();
      const cues: Cue[] = intro ? [{ who: "ai", text: intro.text, parts: intro.parts, hold: 1400 }, ...site.scan] : site.scan;
      // a site's mission: once it has been read out, nothing moves until its deep scan (F)
      void held(speak(cues)).then(() => site.major && !hasBeat(deepBeat(site.id)) && store.set({ deepOnly: true }));
    }

    /** The DEEP SCAN at a major site: the full account, then the archive entry. */
    function siteDeep(site: ClueSite) {
      if (reading.has(site.id)) return;
      reading.add(site.id);
      // the deep scan's scene holds the controls itself, and lets them go when it is over
      store.set({ deepOnly: false });
      showReadout("DEEP SCAN · RECOVERING DATA", [site.archive.subject, `STATUS: ${site.archive.status}`], 9000);
      void scene(deepBeat(site.id), site.deep ?? [], true).then((ok) => {
        reading.delete(site.id);
        if (!ok) return;
        addArchive(site.id);
        announceUnlock("ARCHIVE UPDATED", [site.archive.title], ["archive"]);
        later(SITE_HINT_AFTER_MS, hintNext);
      });
    }

    let lastNudge = 0;
    /** Point at the nearest site still holding something, from where it really is. */
    function hintNext() {
      const e = engineRef.current;
      lastNudge = performance.now();
      if (!e || !sitesOpen() || store.get().story !== "exploring" || store.get().deepOnly) return;
      const open = CLUES.filter((c) => siteOpen(c, journey().beats) && !hasBeat(foundBeat(c.id)));
      const pool = open.some((c) => c.major) ? open.filter((c) => c.major) : open;
      let best: { c: ClueSite; us: number; sun: number } | null = null;
      for (const c of pool) {
        const d = e.distancesOf(c.host);
        if (d && (!best || d.us < best.us)) best = { c, us: d.us, sun: d.sun };
      }
      if (!best) return;
      const host = byId.get(best.c.host);
      const parent = host?.parent && host.parent !== "sun" ? host.parent : null;
      const where = parent && store.get().identified.includes(parent) ? `, around ${byId.get(parent)!.name}` : "";
      const ours = sunAU.current * AU_KM;
      if (best.us < SITE_NOTICE_KM) return;
      void speak([{ who: "ai", text: best.sun > ours ? HINT_OUTWARD(where) : HINT_INWARD(where), hold: 2600 }]);
    }

    let lastNotice = 0;
    /** Close to a site nobody has scanned yet: say so, once per site. */
    function noticeSites() {
      const e = engineRef.current;
      const now = performance.now();
      if (!e || now - lastNotice < 1000 || !sitesOpen() || store.get().deepOnly) return;
      lastNotice = now;
      for (const c of CLUES) {
        if (!siteOpen(c, journey().beats) || hasBeat(foundBeat(c.id)) || hasBeat(`near:${c.id}`)) continue;
        if ((e.distancesOf(c.host)?.us ?? Infinity) < SITE_NOTICE_KM) {
          markBeat(`near:${c.id}`);
          // one notice at a time, even where several sites sit close together
          lastNotice = now + 60_000;
          showReadout("ARTIFICIAL SIGNAL DETECTED", ["SOURCE: NEARBY · UNRESOLVED"], 6000);
          void speak([{ who: "ai", text: pickLine(HINT_NEAR_LINES, "near"), hold: 2400 }]);
          return;
        }
      }
    }

    // ---------- recordings: controls locked, no skip ----------

    /** Play a recovered recording; it goes into the archive once it has played to the end. */
    function playRecording(rec: F.Recording) {
      store.set({ playback: { heading: rec.heading, torn: false } });
      // the interference is in the sound, not on the screen: a radio bed runs under the whole
      // recording (gaps too) and surges where the signal breaks up
      audio.radio(1);
      const cues: Cue[] = rec.lines.map((l) => ({
        who: "rec",
        text: l.text,
        pause: l.pause,
        hold: 2200,
        onStart: () => {
          store.set({ playback: { heading: rec.heading, torn: !!l.torn } });
          if (l.torn) audio.radioBurst(l.torn === "heavy" ? 1 : 0.6);
        },
      }));
      return held(speak(cues)).then((ok) => {
        audio.radio(0);
        store.set({ playback: null });
        if (ok) {
          const j = journey();
          if (!j.archive.includes(rec.id)) setJourney({ archive: [...j.archive, rec.id] });
          markBeat(`played:${rec.id}`);
          announceUnlock("ARCHIVE UPDATED", [rec.archive.title], ["archive"]);
        }
        return ok;
      });
    }

    // ---------- 50%: the weak signal ----------

    let lastStrength = -1;
    let lastReport = 0;

    function startSignal() {
      setChapter("signal");
      markBeat("signal-start");
      const e = engineRef.current;
      // the signal says where it comes from: Pluto goes on the map and the contacts, named
      const named = store.get().identified.includes("pluto");
      e?.reveal("pluto");
      e?.flicker(0.6, 1.1);
      showReadout(F.SIGNAL_READOUT.title, F.SIGNAL_READOUT.lines, 9000);
      // the moment Pluto is named the camera goes out to it; on the commander's reply it flies on,
      // without a cut, to a glimpse of the ship sending the signal; then back to the cockpit, where
      // what unlocked is announced (not over the chapter's title card)
      const toPluto = () => void engineRef.current?.playCut("showcase", "pluto", { then: "derelict-1" });
      const onward = () => engineRef.current?.cutName === "showcase" && engineRef.current.advanceCut();
      let announced = false;
      const back = () => {
        if (engineRef.current?.cutName === "showcase") engineRef.current.endCut();
        if (announced) return;
        announced = true;
        announceUnlock("ARTIFICIAL SIGNAL DETECTED", ["SOURCE: ORBIT OF PLUTO", ...(named ? [] : ["PLUTO IDENTIFIED"]), "SIGNAL STRENGTH METER"], ["signal"]);
      };
      const cues = F.SIGNAL_START.map((c, i) => (i === 1 ? { ...c, onStart: toPluto } : i === 2 ? { ...c, onStart: onward } : c));
      void held(speak(cues)).finally(back);
    }

    /** Pick the first ship's thread up wherever it stands. */
    function signalNext() {
      if (journey().chapter !== "signal") return;
      if (!hasBeat("ship1-found")) void speak([{ who: "ai", text: F.SIGNAL_REMIND, pause: 500, hold: 2600 }]);
      else ship1Brief();
    }

    /** To the first ship: fly in if we are not there yet (the arrival starts the mission). */
    function ship1Brief() {
      const e = engineRef.current;
      // its mission is already playing (a resumed journey reaches here twice)
      if (!e || hasBeat(SHIP1_DONE) || onMission) return;
      if (e.travelTo("derelict-1")) return void audio.engage();
      ship1Mission();
    }

    /**
     * The 50% mission, beside the first ship: FABLE names it (if the scan from afar did not),
     * looks it over, finds the recording and plays it, and works out what it means.
     */
    function ship1Mission() {
      if (onMission || journey().chapter !== "signal" || hasBeat(SHIP1_DONE) || closingIn("derelict-1")) return;
      void mission("derelict-1", async () => {
        markBeat("cut-ship1");
        if (!hasBeat("ship1-found")) {
          engineRef.current?.reveal("derelict-1");
          markBeat("ship1-found");
          audio.sweep();
          later(900, () => audio.discover());
          if (!(await speak(F.SHIP1_ASK))) return false;
        }
        if (!(await scene("ship1-brief", F.SHIP1_FOUND))) return false;
        if (!hasBeat("ship1-source")) {
          await autoScan();
          markBeat("ship1-source");
          if (!(await speak(F.SHIP1_RECOVERED))) return false;
        }
        if (!hasBeat("played:rec-briefing") && !(await playRecording(F.recordingById.get("rec-briefing")!))) return false;
        return scene("ship1-after", F.SHIP1_AFTER);
      }).then((ok) => {
        if (!ok) return;
        markBeat(SHIP1_DONE);
        setChapter("explore");
        // the recording's last words point to the ISS: it is on the contacts list now, unnamed
        engineRef.current?.sight("iss");
        showReadout(F.ISS_READOUT.title, F.ISS_READOUT.lines, 9000);
        announceUnlock("EXPLORATION RESUMED", ["NEW CONTACT · EARTH ORBIT", "SOLAR MAP", "EVIDENCE SITES"], ["map"]);
        later(SITE_HINT_AFTER_MS + 4000, hintNext);
      });
    }

    /** Alongside a body; beside a story ship for the first time, film both ships together. */
    /** set when a world is reached for the first time, just before the arrival itself */
    let freshReach: string | null = null;
    function reachedFirst(b: BodyDef) {
      freshReach = b.id;
    }

    /** set while a resumed journey closes in again on the vehicle it was saved beside */
    let resumingBeside = false;

    function arrived(b: BodyDef) {
      audio.arrive();
      const quiet = resumingBeside;
      resumingBeside = false;
      const e = engineRef.current;
      const unknownSite = !!e && e.closeOnly.has(b.id) && !store.get().identified.includes(b.id);
      const c = journey().chapter;
      const world = b.kind === "planet" || b.kind === "moon" || b.kind === "dwarf";
      const first = freshReach === b.id;
      freshReach = null;
      // beside a story ship in its chapter: its mission takes over
      if (b.id === "derelict-1" && c === "signal" && !hasBeat(SHIP1_DONE)) return ship1Mission();
      if (b.id === "derelict-2" && c === "transmission" && !hasBeat("played:rec-final")) return ship2Mission();
      // a site found but not deep-scanned yet: its mission is still open, and waits for the scan
      if (sitesOpen() && CLUES.some((s) => s.major && s.host === b.id && hasBeat(foundBeat(s.id)) && !hasBeat(deepBeat(s.id)))) return void store.set({ deepOnly: true });
      if (quiet) return;
      if (unknownSite && sitesOpen()) remark(pickLine(SITE_ALONGSIDE_LINES, "alongside"));
      else if (world && first && (c === "explore" || c === "ending") && !inScene() && Math.random() < PLAYER_ARRIVE_CHANCE)
        void speak([
          { who: "ai", text: TRAVEL.arrive(e ? e.name(b.id) : b.name.toUpperCase()), hold: 600 },
          { who: "player", text: deal(PLAYER_ARRIVE_LINES, "arrive-me"), pause: 700, hold: 2400 },
        ]);
      else remark(TRAVEL.arrive(e ? e.name(b.id) : b.name.toUpperCase()));
    }

    /**
     * The 100% mission, beside the second ship: the commander's first look, FABLE's scans (what
     * it is, what is inside, the manifest and the logs), the final recording, then straight on
     * into the reconstruction with the camera still outside.
     */
    function ship2Mission() {
      // already playing: a second start must not end the camera of the one running
      if (onMission || journey().chapter !== "transmission" || hasBeat("played:rec-final") || closingIn("derelict-2")) return;
      void mission(
        "derelict-2",
        async () => {
          if (!hasBeat("cut-ship2")) {
            markBeat("cut-ship2");
            if (!(await speak(F.SHIP2_LOOK))) return false;
          }
          if (!hasBeat("ship2-found")) {
            markBeat("ship2-found");
            engineRef.current?.reveal("derelict-2");
            audio.sweep();
            later(900, () => audio.discover());
            if (!(await speak(F.SHIP2_FOUND))) return false;
          }
          if (!hasBeat("ship2-deep")) {
            await autoScan();
            markBeat("ship2-deep");
            if (!(await speak(F.SHIP2_DEEP))) return false;
          }
          if (!hasBeat("ship2-manifest")) {
            await autoScan();
            markBeat("ship2-manifest");
            if (!(await speak(F.SHIP2_MANIFEST))) return false;
          }
          return hasBeat("played:rec-final") || playRecording(F.recordingById.get("rec-final")!);
        },
        true,
      ).then((ok) => {
        if (ok) void reconstruct();
        else missionEnd();
      });
    }

    // ---------- near the end: the transmission ----------

    function startTransmission() {
      setChapter("transmission");
      markBeat("tx-start");
      // the call is strong enough to shake the ship
      const k = 0.72;
      engineRef.current?.quake(k);
      store.set({ jolt: { k, key: (store.get().jolt?.key ?? 0) + 1 } });
      audio.jolt(k);
      engineRef.current?.flicker(1, 1.6);
      audio.blip(140, 0.6, "sawtooth", 0.08);
      showReadout(F.TRANSMISSION_READOUT.title, F.TRANSMISSION_READOUT.lines, 10000);
      // as FABLE names Earth orbit the camera goes out to Earth; on the commander's reply it flies on,
      // without a cut, to a glimpse of the ship calling; back in the cockpit for "Then we go. Now."
      const toEarth = () => void engineRef.current?.playCut("showcase", "earth", { then: "derelict-2" });
      const onward = () => engineRef.current?.cutName === "showcase" && engineRef.current.advanceCut();
      const back = () => engineRef.current?.cutName === "showcase" && engineRef.current.endCut();
      const cues = F.TRANSMISSION_START.map((c, i) => (i === 1 ? { ...c, onStart: toEarth } : i === 3 ? { ...c, onStart: onward } : i === 5 ? { ...c, onStart: back } : c));
      void held(speak(cues)).then((ok) => {
        back();
        if (!ok) return;
        announceUnlock("WAYPOINT ESTABLISHED", ["EARTH ORBIT", "AUTOPILOT ENGAGED"], ["map"]);
        setCourse();
      });
    }

    /** Course for the second ship; already there, its mission starts. */
    function setCourse() {
      const e = engineRef.current;
      if (!e || onMission || journey().chapter !== "transmission" || hasBeat("played:rec-final")) return;
      markBeat("tx-course");
      if (e.travelTo("derelict-2", true)) audio.engage();
      else ship2Mission();
    }

    function transmissionNext() {
      if (journey().chapter !== "transmission") return;
      if (!hasBeat("tx-course")) void speak(F.TRANSMISSION_START.slice(-1)).then((ok) => ok && setCourse());
      else if (hasBeat("played:rec-final")) void reconstruct();
      else setCourse();
    }

    // ---------- the reconstruction, then home ----------

    async function reconstruct() {
      setChapter("reckoning");
      // still beside the second ship (a resumed journey): its mission camera carries on
      const e = engineRef.current;
      if (e && (e.distancesOf("derelict-2")?.us ?? Infinity) < SHIP_SCAN_KM) missionCam("derelict-2");
      const done = await held(
        (async () => {
          for (const part of F.RECONSTRUCTION) {
            showReadout("RECONSTRUCTING THE RECORD", [part.heading], 9000);
            if (!(await speak(part.cues))) return false;
          }
          // the commander breaks down: the camera leaves the second ship and goes back over the
          // worlds and every place the record was found, while the last words are said,
          // one shot per line: each new line cuts to the next shot
          const last = [...F.BREAKDOWN, ...F.ENDING].map((c, i) => (i ? { ...c, onStart: () => engineRef.current?.advanceCut() } : c));
          void film("montage", undefined, estimateMs(last), last.length);
          return speak(last);
        })(),
      );
      if (!done) return missionEnd();
      markBeat("ending");
      setChapter("ending");
      void epilogue();
    }

    /** Home, nobody left; then the door to Part II over our own ship, and the choice to keep flying. */
    async function epilogue() {
      // our ship, alone in Earth orbit, pulling away until it is a speck; the last shot holds
      if (!store.get().finished) void film("ending");
      if (!(await scene("ending", F.ENDING, true))) return;
      if (!(await scene("part-two", F.PART_TWO, true))) return;
      store.set({ finished: true });
    }

    /** Telemetry tick (throttled): milestones, the signal meter, the ships coming into range. */
    let lastMilestone = 0;
    // when each threshold was first met; the signal and the last call wait a while after it
    let signalReady: number | null = null;
    let callReady: number | null = null;
    function milestones() {
      const e = engineRef.current;
      const now = performance.now();
      if (!e || now - lastMilestone < 1000 || store.get().story !== "exploring" || store.get().locked) return;
      lastMilestone = now;
      const s = store.get();
      const c = s.journey.chapter;
      const progress = explorationProgress(s.journey.beats);
      const signalDue = c === "explore" && !hasBeat("signal-start") && progress >= F.SIGNAL_THRESHOLD;
      signalReady = signalDue ? (signalReady ?? now) : null;
      if (signalReady !== null && !inSceneNow() && now - signalReady >= F.SIGNAL_DELAY_MS) return startSignal();
      // lost for a while with sites still to find: point the way again
      if (c === "explore" && progress < 1 && !inSceneNow()) {
        if (!lastNudge) lastNudge = now;
        else if (now - lastNudge > IDLE_HINT_MS) hintNext();
      }
      const callDue = c === "explore" && hasBeat(SHIP1_DONE) && !hasBeat("tx-start") && progress >= F.TRANSMISSION_THRESHOLD;
      callReady = callDue ? (callReady ?? now) : null;
      if (callReady !== null && !inSceneNow() && now - callReady >= F.TRANSMISSION_DELAY_MS) return startTransmission();
      if (c === "signal") {
        const d = e.distancesOf("derelict-1")?.us ?? Infinity;
        const k = Math.round(strength(d) * 100);
        store.set({ signal: k });
        if (d < SHIP_CLOSE_KM && !hasBeat("signal-close")) {
          markBeat("signal-close");
          void speak([{ who: "ai", text: F.SIGNAL_CLOSE, hold: 2600 }]);
        } else if (now - lastReport > SIGNAL_REPORT_MS && !hasBeat("ship1-found")) {
          if (lastStrength >= 0 && !inSceneNow()) {
            if (k >= lastStrength + 4) remark(F.SIGNAL_STRONGER);
            else if (k <= lastStrength - 4) remark(pickLine(F.SIGNAL_WEAKER_LINES, "weaker"));
          }
          lastStrength = k;
          lastReport = now;
        }
      } else if (s.signal !== null) store.set({ signal: null });
    }
    const inSceneNow = () => store.get().subtitle !== null;

    /** A ship seen from afar: the scan shows where it is, unnamed, until we are alongside. */
    function sightedShip(e: SpaceEngine, result: ScanResult) {
      e.commitScan(result);
      showReadout(READ_UNIDENTIFIED);
      if (sayAgain("sighted-ship", REPEAT_QUIET_MS)) remark(pickLine(SCAN_SIGHTED_LINES, "sighted"));
    }

    /** Scans while a ship is the story: the ship answers, everything else waits. */
    function shipScan(e: SpaceEngine, result: ScanResult) {
      const c = journey().chapter;
      const near = (id: string) => (e.distancesOf(id)?.us ?? Infinity) < SHIP_SCAN_KM;
      const sees = (id: string) => result.contacts.some((x) => x.id === id && x.status === "scanned");
      if (c === "signal") {
        if (!hasBeat("ship1-found") && sees("derelict-1")) {
          // alongside it already: the mission names it and takes it from here
          e.commitScan(result);
          ship1Mission();
        } else if (hasBeat("ship1-found") && !hasBeat(SHIP1_DONE)) {
          if (near("derelict-1")) ship1Mission();
          else ship1Brief();
        } else if (!hasBeat("ship1-found") && result.contacts.some((x) => x.id === "derelict-1")) sightedShip(e, result);
        else remark(pickLine(F.SIGNAL_HOLD_LINES, "hold-signal"));
        return true;
      }
      if (c === "transmission") {
        if (near("derelict-2") && !hasBeat("played:rec-final")) {
          if (sees("derelict-2")) e.commitScan(result);
          ship2Mission();
        } else if (!hasBeat("ship2-found") && result.contacts.some((x) => x.id === "derelict-2")) sightedShip(e, result);
        else remark(pickLine(F.TRANSMISSION_HOLD_LINES, "hold-transmission"));
        return true;
      }
      return false;
    }

    // ---------- the asteroid belt (first crossing is a story moment) ----------

    function beltCrossed(inside: boolean) {
      const e = engineRef.current;
      const chapter = journey().chapter;
      if (inside) {
        if (chapter === "inbound") {
          setChapter("belt");
          e?.flicker(0.9, 1.2);
          if (hasBeat("belt-enter")) toast(BELT_TOAST_IN);
          else void scene("belt-enter", BELT_ENTER);
        } else toast(BELT_TOAST_IN);
        return;
      }
      if (chapter === "belt") {
        // out the far side, or back the way we came
        if (sunAU.current < PAST_BELT_AU) sensorsBack();
        else {
          setChapter("inbound");
          toast(BELT_TOAST_OUT);
        }
      } else toast(BELT_TOAST_OUT);
    }

    function sensorsBack() {
      if (journey().chapter !== "inbound" && journey().chapter !== "belt") return;
      setChapter("inner");
      engineRef.current?.flicker(0.4, 0.5);
      announceUnlock("SENSORS ONLINE", ["SCAN", "DEEP SCAN"], ["scan"]);
      void scene("belt-clear", BELT_CLEAR);
    }

    /** Telemetry tick: catch a belt we flew over or under. */
    function track(t: Telemetry) {
      sunAU.current = t.sunAU;
      // the score waits for the first time we fly forward
      if (!underway && store.get().story === "exploring" && t.speed >= 1 && (t.autopilot || /^\d+%$/.test(t.thrustText))) underway = true;
      // at rest (stopped, or holding beside something) for a while: the score settles
      const still = t.speed < 1;
      if (still && restSince === null) restSince = performance.now();
      else if (!still) restSince = null;
      updateMusic();
      if (t.sunAU < INSIDE_BELT_AU && store.get().story === "exploring") sensorsBack();
      if (store.get().story === "exploring") {
        noticeSites();
        milestones();
      }
    }

    // ---------- scanning ----------

    // pressing F again and again at the same thing should not make FABLE say the same thing again
    const lastSaid = new Map<string, number>();
    const sayAgain = (key: string, quietMs: number) => {
      const now = performance.now();
      if (now - (lastSaid.get(key) ?? -Infinity) < quietMs) return false;
      lastSaid.set(key, now);
      return true;
    };

    function finishScan(e: SpaceEngine, result: ScanResult, opening: boolean) {
      store.set({ scanning: false });
      if (shipScan(e, result)) return;
      e.commitScan(result);
      store.set({ scanning: false, scanLevel: store.get().scanLevel + 1, starsNamed: e.namedStars });
      const deepSite = sitesOpen() ? pendingDeep(e) : undefined;
      if (deepSite) {
        siteDeep(deepSite);
      } else if (result.stage === "deep") {
        const waiting = sitesOpen() && CLUES.some((c) => c.major && hasBeat(foundBeat(c.id)) && !hasBeat(deepBeat(c.id)) && !recovered(c, journey().beats));
        // the panel shows every result; FABLE only speaks when it has not just said the same
        const key = result.stars.length ? "deep" : waiting ? "too-far" : "nothing";
        if (sayAgain(key, REPEAT_QUIET_MS)) remark(result.stars.length ? pickLine(DEEP_SCAN_LINES, "deep") : waiting ? DEEP_TOO_FAR : pickLine(NOTHING_NEW_LINES, "nothing"));
      } else if (opening) {
        void speak(CONTACT).then((ok) => ok && store.get().story === "contact" && homeward());
      } else {
        const primary = result.primary ? result.contacts.find((c) => c.id === result.primary) : null;
        const def = primary ? byId.get(primary.id) : null;
        const far = def ? e.distancesOf(def.id) : null;
        const earth = result.contacts.find((c) => c.id === "earth" && c.status === "scanned");
        if (journey().chapter === "inner" && earth) {
          // home at last
          setChapter("earth");
          showReadout(READ_IDENTIFIED("Earth"));
          earthNext();
        } else if (siteIn(result, e)) {
          const site = siteIn(result, e)!;
          const c = result.contacts.find((x) => x.id === site.host)!;
          const hostDef = byId.get(site.host)!;
          const d = e.distancesOf(site.host)!;
          siteFound(site, c.fresh ? identifyLine(hostDef, d.sun) : null);
        } else if (def && primary && far) {
          if (primary.status === "scanned" && primary.fresh) {
            showReadout(READ_IDENTIFIED(def.name));
            const id = identifyLine(def, far.sun);
            remark(id.text, "ai", undefined, id.parts);
          } else if (primary.status === "scanned") {
            // known already: the panel says so; FABLE says it once in a while, never the distance again
            showReadout(READ_IDENTIFIED(def.name));
            if (sayAgain(`known:${def.id}`, KNOWN_QUIET_MS)) remark(pickLine(RESCAN_LINES, "rescan"));
          } else {
            showReadout(READ_UNIDENTIFIED);
            if (sayAgain(`sighted:${def.id}`, REPEAT_QUIET_MS)) remark(pickLine(SCAN_SIGHTED_LINES, "sighted"));
          }
        } else if (sayAgain("nothing", REPEAT_QUIET_MS)) remark(pickLine(NOTHING_NEW_LINES, "nothing"));
      }
      if (result.contacts.some((c) => c.fresh) || result.stars.length) audio.discover();
    }

    /** a site whose host this scan identified (and is about), not yet found */
    function siteIn(result: ScanResult, e: SpaceEngine) {
      if (!sitesOpen()) return undefined;
      return CLUES.find((c) => {
        if (!siteOpen(c, journey().beats) || hasBeat(foundBeat(c.id))) return false;
        const hit = result.contacts.find((x) => x.id === c.host && x.status === "scanned");
        return !!hit && e.beside(c.host);
      });
    }

    function scan() {
      const e = engineRef.current;
      const s = store.get();
      if (!e || s.scanning || s.records !== "closed" || s.story === "waking" || s.locked) return;
      if (!s.unlocks.scan) {
        // the HUD says why every time; the voice said it once already
        audio.blip(220, 0.12, "square", 0.04);
        const c = s.journey.chapter;
        toast(c === "belt" ? SCAN_DOWN.belt : c === "inbound" ? SCAN_DOWN.settling : SCAN_DOWN.locked);
        return;
      }
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

    function skip() {
      if (!["waking", "awaiting-scan", "contact"].includes(store.get().story)) return;
      audio.ui();
      enterExplore();
    }

    function openRecords() {
      if (store.get().records !== "closed" || store.get().locked || store.get().deepOnly) return;
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
      if (!e || store.get().story !== "exploring" || store.get().deepOnly) return;
      audio.blip(990, 0.05, "square", 0.03);
      if (id.startsWith("star:")) {
        e.lookAtStar(id.slice(5));
        return;
      }
      e.select(id);
      store.set({ target: id });
      e.lookAtBody(id);
    }

    /**
     * A contact clicked. A vehicle is far too small to fly to by eye, so it gets a course straight
     * away (once the autopilot is online); a world or a star is only looked at, and the map flies.
     */
    function goTo(id: string) {
      const kind = byId.get(id)?.kind;
      if ((kind === "spacecraft" || kind === "satellite") && store.get().unlocks.map) travel(id);
      else pick(id);
    }

    function clearTarget() {
      engineRef.current?.select(null);
      store.set({ target: null });
    }

    function travel(id: string) {
      const e = engineRef.current;
      const s = store.get();
      if (!e || s.story !== "exploring" || s.blackout || s.locked || s.deepOnly) return;
      if (s.journey.chapter === "transmission") {
        // the waypoint is set: every course leads to the source
        toast(F.TRANSMISSION_LOCKED);
        if (!hasBeat("ship2-found")) setCourse();
        return;
      }
      if (!s.unlocks.map) {
        toast(MAP_LOCKED);
        return;
      }
      // any vehicle can be flown to from the map or the contacts: a story site keeps its name
      // until we are alongside, a real one is named on the way (as the map names every world)
      const kind = byId.get(id)?.kind;
      const vehicle = kind === "spacecraft" || kind === "satellite";
      if (!s.identified.includes(id) && !vehicle) {
        // a course needs a name: unknown contacts only get looked at (a story site can be
        // reached unnamed, since only being there names it)
        e.select(id);
        store.set({ target: id });
        e.lookAtBody(id);
        toast(MAP_UNIDENTIFIED);
        return;
      }
      store.set({ target: id });
      if (reducedMotion()) {
        // no fly-through: fade out, move, fade back in
        store.set({ blackout: true });
        audio.engage();
        window.setTimeout(() => {
          if (!engineRef.current?.jumpTo(id)) remark(TRAVEL.already);
          window.setTimeout(() => store.set({ blackout: false }), 120);
        }, 380);
        return;
      }
      if (!e.travelTo(id, true)) {
        e.lookAtBody(id);
        remark(TRAVEL.already);
        return;
      }
      audio.engage();
      remark(TRAVEL.engage(e.name(id)), "ai", 1800);
    }

    function cancelTravel() {
      engineRef.current?.cancelAutopilot(false);
    }

    /** Loader finished and every asset is in: wait on the start gate. */
    function loaded() {
      if (store.get().story !== "loading") return;
      store.set({ loaderDone: true, story: "gate" });
    }

    function keepFlying() {
      engineRef.current?.endCut();
      audio.ui();
      store.set({ finished: false });
      toast("FREE FLIGHT · THE SOLAR SYSTEM IS YOURS");
    }
    function newJourney() {
      erasing.current = true;
      clearProgress();
      window.location.reload();
    }

    return { loaded, scan, wake, advance, skip, openRecords, closeRecords, pick, goTo, clearTarget, travel, cancelTravel, arrived, reachedFirst, beltCrossed, track, keepFlying, newJourney };
  }, []);

  // Boot the renderer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: SpaceEngine | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    const mq = window.matchMedia(MOBILE_QUERY);

    // a saved journey picks up where it stopped; anything else is a fresh start with an empty survey
    const save = loadSave();
    if (save && save.chapter !== "awakening" && save.pose) {
      resumeRef.current = { ...save, pose: save.pose };
      store.set({ journey: { chapter: save.chapter, beats: save.beats, archive: save.archive }, unlocks: unlocksFor(save.chapter) });
    } else clearProgress();

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
        storyToEngine(engine);
        haltShip = () => engineRef.current?.halt();
        // handy for poking at the scene from the console while developing
        if (process.env.NODE_ENV !== "production") Object.assign(window, { __sanctuary: engine, __sanctuaryStore: store });
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
          audio.setStatic(t.interference);
          actions.track(t);
        };
        engine.onRecordsChange = (identified, reached) => store.set({ identified, reached });
        engine.onReached = (b: BodyDef) => {
          actions.reachedFirst(b);
          audio.discover();
          toast(`REACHED ${b.name.toUpperCase()}`);
        };
        engine.onArrive = actions.arrived;
        // the story sites are named only from alongside
        engine.closeOnly = new Set([...CLUES.map((c) => c.host), "derelict-1", "derelict-2"]);
        engine.onCut = (shot, seamless) => store.set({ cut: shot >= 0, cutShot: store.get().cutShot + (seamless ? 0 : 1) });
        // X at speed: the flash and the crunch follow the speed; a hard one earns a warning
        engine.onJolt = (k, speed) => {
          store.set({ jolt: { k, key: (store.get().jolt?.key ?? 0) + 1 } });
          audio.jolt(k);
          if (k >= 0.45) toast(`EMERGENCY STOP · HULL STRESS ${Math.round(40 + 60 * k)}%`);
          const now = performance.now();
          const s = store.get();
          if (speed > BRAKE_WARN_KM_S && now - lastBrakeWarn > BRAKE_WARN_GAP_MS && s.story === "exploring" && !s.locked) {
            lastBrakeWarn = now;
            window.setTimeout(() => {
              const line = deal(BRAKE_LINES, "brake");
              // now and then the commander answers back
              if (!inScene() && Math.random() < PLAYER_BRAKE_CHANCE)
                void speak([
                  { who: "ai", text: line, hold: 500 },
                  { who: "player", text: deal(PLAYER_BRAKE_LINES, "brake-me"), pause: 450, hold: 1800 },
                ]);
              else remark(line);
            }, 650 + 500 * k);
          }
        };
        film = (name, target, ms, count) => engineRef.current?.playCut(name, target, { ms, count, stops: name === "montage" ? montageHosts() : [] }) ?? Promise.resolve();
        missionCam = (target) => {
          const e = engineRef.current;
          if (e && e.cutName !== "mission") void e.playCut("mission", target, { loop: true });
        };
        missionEnd = () => {
          const e = engineRef.current;
          if (e?.cutName === "mission") e.endCut();
        };
        engine.onTravelEnd = (reason) => {
          audio.setDrive(0);
          if (reason === "cancelled") {
            audio.ui();
            toast("AUTOPILOT OFF · MANUAL CONTROL");
          }
        };
        engine.onHold = (text) => toast(text);
        engine.onBelt = actions.beltCrossed;
        engine.start();
        // every map, model, shader and voice line loads now, behind the loading screen
        const part = { engine: 0, voice: 0 };
        const report = () => store.set({ assets: Math.min(0.99, part.engine * 0.65 + part.voice * 0.35) });
        void Promise.all([
          engine.preloadAll((k) => {
            part.engine = k;
            report();
          }),
          preloadVoices((k) => {
            part.voice = k;
            report();
          }),
          audio.preloadScore(),
        ]).then(() => store.set({ assets: 1 }));
      })
      .catch(() => store.set({ sceneError: true }));

    return () => {
      cancelled = true;
      ro?.disconnect();
      engine?.dispose();
      engineRef.current = null;
    };
  }, [actions]);

  // The engine, the score and the HUD follow the story.
  useEffect(() => {
    let last = store.get().journey;
    let wasLocked = store.get().locked;
    return store.subscribe(() => {
      const s = store.get();
      if (s.journey !== last) {
        if (s.journey.chapter !== last.chapter) audio.mood(MOODS[s.journey.chapter]);
        last = s.journey;
        if (engineRef.current) storyToEngine(engineRef.current);
      }
      if (s.locked !== wasLocked) wasLocked = s.locked;
      updateMusic();
    });
  }, []);
  const readInterference = useCallback(() => engineRef.current?.interferenceNow ?? 0, []);
  useHudInterference(readInterference);

  // Auto-save: the journey whenever it moves on, the position every few seconds and on leaving.
  useEffect(() => {
    let last = store.get().journey;
    const persist = () => {
      const e = engineRef.current;
      const s = store.get();
      if (e && s.story === "exploring" && !erasing.current) writeSave(s.journey, e.pose());
    };
    const unsub = store.subscribe(() => {
      const j = store.get().journey;
      if (j !== last) {
        last = j;
        persist();
      }
    });
    const id = window.setInterval(persist, 4000);
    const onHide = () => document.visibilityState === "hidden" && persist();
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsub();
      window.clearInterval(id);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Indian Standard Time clock (UTC+5:30).
  useEffect(() => {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const tick = () => {
      const d = new Date(Date.now() + 5.5 * 3_600_000);
      const p = (n: number) => String(n).padStart(2, "0");
      store.set({
        clock: `${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + (store.get().journey.beats.includes("year-2126") ? 100 : 0)}  ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} IST`,
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
        // a key on one of the gate's own buttons (start a new journey) presses that button instead
        if (!(e.target as HTMLElement | null)?.closest?.("button")) actions.wake();
        return;
      }
      if (s.deepOnly) {
        if (e.code === "KeyF") actions.scan();
        return;
      }
      if (s.locked) return;
      if (e.code === "Escape" && s.archiveOpen) return store.set({ archiveOpen: false });
      if (s.archiveOpen) return;
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
      const btn = (e.target as HTMLElement | null)?.closest("button");
      // anywhere on the gate wakes the ship, except its own buttons
      if (store.get().story === "gate" && !btn) actions.wake();
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
    if (engineRef.current) engineRef.current.inputEnabled = records === "closed" && !archiveOpen && !locked && !deepOnly && story === "exploring";
  }, [records, archiveOpen, locked, deepOnly, story]);

  const showScan = story === "awaiting-scan" || story === "contact" || story === "exploring";

  return (
    <ObservatoryContext.Provider value={{ engine: engineRef, ...actions }}>
      <main aria-label="Solar system survey" className="relative h-dvh w-full overflow-hidden bg-void" data-story={story} data-cut={cut}>
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
        {story === "exploring" && mapOnline && <NavMap />}
        {showScan && <ScanPanel />}
        <ChapterCard />
        <Narrative />
        <Loader />
        <Logbook />
        <Archive />
        <UnlockBanner />
        <Letterbox />
        <JoltFlash />
        <EndingChoices onContinue={actions.keepFlying} onNew={actions.newJourney} />
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
