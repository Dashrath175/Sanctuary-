"use client";

import { useSyncExternalStore } from "react";
import type { AutopilotState, ContactRow } from "@/components/scene/engine";

// Tiny external store: the render loop writes telemetry here at a throttled rate and
// the HUD subscribes with selectors, so 60 fps work never re-renders React.

export type Story = "loading" | "gate" | "waking" | "awaiting-scan" | "contact" | "exploring";

export type Subtitle = { text: string; named: boolean; instructions: boolean; key: number };

export type UIState = {
  story: Story;
  loaderDone: boolean;
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
  records: "closed" | "loading" | "open";
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
  loaderDone: false,
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
  records: "closed",
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
export function say(text: string, opts: { named?: boolean; instructions?: boolean } = {}) {
  store.set({ subtitle: { text, named: !!opts.named, instructions: !!opts.instructions, key: ++key } });
}
export function toast(text: string) {
  store.set({ toast: { text, key: ++key } });
}
