"use client";

import { useSyncExternalStore } from "react";
import type { AutopilotState, ContactRow } from "@/components/scene/engine";
import { FRESH, unlocksFor, type Journey, type Unlocks } from "./journey";

// Tiny external store: the render loop writes telemetry here at a throttled rate and
// the HUD subscribes with selectors, so 60 fps work never re-renders React.

export type Story = "loading" | "gate" | "waking" | "awaiting-scan" | "contact" | "exploring";

/** who is talking: the ship's AI, the commander (the player), or recovered audio */
export type Who = "ai" | "player" | "rec";

/** `charMs`: how fast the caption types, set from the voice line's length */
export type Subtitle = { text: string; who: Who | null; instructions: boolean; key: number; charMs?: number };

export type UIState = {
  story: Story;
  /** the story's progress (saved) and what it has switched on */
  journey: Journey;
  unlocks: Unlocks;
  loaderDone: boolean;
  /** 0..1 how much of the game's assets (maps, models, voices) is loaded */
  assets: number;
  soundOn: boolean;
  phoneNotice: boolean;
  subtitle: Subtitle | null;
  scanning: boolean;
  scanStage: "local" | "deep";
  scanLevel: number;
  identified: string[];
  reached: string[];
  starsNamed: number;
  speed: number;
  limitText: string;
  thrustLevel: number;
  thrustText: string;
  radial: string;
  timeScale: number;
  heading: number;
  elevation: number;
  course: string;
  courseAlert: boolean;
  location: string;
  contacts: ContactRow[];
  autopilot: AutopilotState | null;
  approach: { phase: string; detail: string; urgent: boolean } | null;
  clock: string;
  toast: { text: string; key: number } | null;
  /** a HUD read-out block: a heading and a few result lines, up for `ms` */
  readout: { title: string; lines: string[]; ms: number; key: number } | null;
  records: "closed" | "loading" | "open";
  archiveOpen: boolean;
  /** recordings and the reconstruction: no flying, scanning or navigating, and no skip */
  locked: boolean;
  /** at a site found but not yet deep-scanned: everything waits except the scan (F) */
  deepOnly: boolean;
  /** a recovered recording playing: its heading, and whether this stretch is breaking up */
  playback: { heading: string; torn: boolean } | null;
  /** a recovered recording played again from the archive (the score and small talk keep out of it) */
  replaying: boolean;
  /** 0..100 strength of the signal being followed */
  signal: number | null;
  /** a systems-online banner after an unlock */
  unlock: { title: string; items: string[]; key: number } | null;
  /** HUD parts pulsing to show they just came online: "scan", "map", "contacts", "archive", "signal" */
  highlight: string[];
  /** the story is over: offer free flight or a new journey */
  finished: boolean;
  /** a cutscene is filming our ship (letterbox on, HUD away) */
  cut: boolean;
  /** bumps at every cut between shots (the screen dips to black) */
  cutShot: number;
  /** the last hard stop: how hard (0..1), keyed so each one flashes */
  jolt: { k: number; key: number } | null;
  hasMoved: boolean;
  /** WebGL could not start */
  sceneError: boolean;
  /** destination picked in the contacts list, radar, labels or map */
  target: string | null;
  mapExpanded: boolean;
  /** short fade used instead of a fly-through when reduced motion is on */
  blackout: boolean;
};

const initial: UIState = {
  story: "loading",
  journey: FRESH,
  unlocks: unlocksFor(FRESH.chapter),
  loaderDone: false,
  assets: 0,
  soundOn: false,
  phoneNotice: true,
  subtitle: null,
  scanning: false,
  scanStage: "local",
  scanLevel: 0,
  identified: [],
  reached: [],
  starsNamed: 0,
  speed: 0,
  limitText: "200,000 KM/S MAX",
  thrustLevel: 0,
  thrustText: "IDLE",
  radial: "IDLE",
  timeScale: 1,
  heading: 7,
  elevation: 7,
  course: "— · AT REST",
  courseAlert: true,
  location: "UNIDENTIFIED SPACE",
  contacts: [],
  autopilot: null,
  approach: null,
  clock: "",
  toast: null,
  readout: null,
  records: "closed",
  archiveOpen: false,
  locked: false,
  deepOnly: false,
  playback: null,
  replaying: false,
  signal: null,
  unlock: null,
  highlight: [],
  finished: false,
  cut: false,
  cutShot: 0,
  jolt: null,
  hasMoved: false,
  sceneError: false,
  target: null,
  mapExpanded: true,
  blackout: false,
};

let state: UIState = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
    const next = typeof patch === "function" ? patch(state) : patch;
    let changed = false;
    for (const k in next) {
      if (!Object.is(next[k as keyof UIState], state[k as keyof UIState])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useUI<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(initial),
  );
}

let key = 0;
export function say(text: string, opts: { who?: Who | null; instructions?: boolean; charMs?: number } = {}) {
  store.set({ subtitle: { text, who: opts.who === undefined ? "ai" : opts.who, instructions: !!opts.instructions, key: ++key, charMs: opts.charMs } });
}
export function showReadout(title: string, lines: string[] = [], ms = 6000) {
  store.set({ readout: { title, lines, ms, key: ++key } });
}
let hlTimer = 0;
/** Announce what came online and make those HUD parts pulse for a few seconds. */
export function announceUnlock(title: string, items: string[], parts: string[]) {
  store.set({ unlock: { title, items, key: ++key }, highlight: parts });
  window.clearTimeout(hlTimer);
  hlTimer = window.setTimeout(() => store.set({ highlight: [] }), 8000);
}
export function toast(text: string) {
  store.set({ toast: { text, key: ++key } });
}
