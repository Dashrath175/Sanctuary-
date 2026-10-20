// The story's progress and the save file. Everything the player has done lives here or in the
// engine's records, so a visit days later picks up exactly where the last one stopped.

import type { Pose } from "@/components/scene/engine";
import { RENAMED_SITES, SHIP1_DONE } from "./clues";

export type Chapter =
  /** waking near Uranus, before the controls are handed over */
  | "awakening"
  /** flying in toward the Sun; the sensors are still settling */
  | "inbound"
  /** first crossing of the asteroid belt: SCAN and DEEP SCAN are down */
  | "belt"
  /** past the belt, looking for Earth */
  | "inner"
  /** at Earth: the discovery scene */
  | "earth"
  /** open exploration */
  | "explore"
  /** following the weak signal to the first spacecraft */
  | "signal"
  /** answering the Earth-orbit transmission */
  | "transmission"
  /** the reconstruction of what happened */
  | "reckoning"
  /** home, and nobody left */
  | "ending";

export type Unlocks = { scan: boolean; deep: boolean; map: boolean; archive: boolean };

export type Journey = {
  chapter: Chapter;
  /** story moments already played, so nothing repeats after a reload */
  beats: string[];
  /** recovered recordings and records, in the order they were recovered */
  archive: string[];
};

/** 2: the sites were re-cut (two on AI, two on the wars, two on control, the ISS last) */
type SaveFile = Journey & { v: 1 | 2; pose: Pose | null; savedAt: number };

export const SAVE_KEY = "sanctuary.save.v1";
/** the engine keeps survey records under this key */
export const RECORDS_KEY = "sanctuary.records.v2";
/** keys from earlier builds that a fresh journey clears */
const STALE_KEYS = ["waypoint.records.v2"];

const CHAPTERS: Chapter[] = ["awakening", "inbound", "belt", "inner", "earth", "explore", "signal", "transmission", "reckoning", "ending"];

export const FRESH: Journey = { chapter: "awakening", beats: [], archive: [] };

export function unlocksFor(chapter: Chapter): Unlocks {
  switch (chapter) {
    case "awakening":
      // only the opening scan of Uranus
      return { scan: true, deep: false, map: false, archive: false };
    case "inbound":
    case "belt":
      return { scan: false, deep: false, map: false, archive: false };
    case "inner":
    case "earth":
      return { scan: true, deep: true, map: false, archive: false };
    case "reckoning":
      return { scan: false, deep: false, map: false, archive: true };
    default:
      return { scan: true, deep: true, map: true, archive: true };
  }
}

/** Has the story reached (or passed) this chapter? */
export const reached = (now: Chapter, c: Chapter) => CHAPTERS.indexOf(now) >= CHAPTERS.indexOf(c);

export function loadSave(): (Journey & { pose: Pose | null }) | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<SaveFile>;
    if ((s.v !== 1 && s.v !== 2) || !s.chapter || !CHAPTERS.includes(s.chapter)) return null;
    const beats = Array.isArray(s.beats) ? s.beats.map(String) : [];
    const archive = Array.isArray(s.archive) ? s.archive.map(String) : [];
    return {
      chapter: s.chapter,
      ...(s.v === 1 ? migrateSites(beats, archive) : { beats, archive }),
      pose: s.pose && Array.isArray(s.pose.offset) && s.pose.offset.length === 3 ? s.pose : null,
    };
  } catch {
    return null;
  }
}

export function writeSave(j: Journey, pose: Pose | null) {
  try {
    const file: SaveFile = { v: 2, chapter: j.chapter, beats: j.beats, archive: j.archive, pose, savedAt: Date.now() };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(file));
  } catch {
    // storage unavailable: progress lasts for this visit only
  }
}

/**
 * A first-version save: each site keeps its credit where it was found (its host), under the
 * site's new name. The ISS only opens after the first ship now, so earlier progress there goes.
 */
function migrateSites(beats: string[], archive: string[]) {
  const site = (id: string) => RENAMED_SITES[id] ?? id;
  const iss = beats.includes(SHIP1_DONE);
  const keep = (id: string) => iss || id !== "bioweapons";
  const out = beats
    .map((b) => {
      const m = /^(clue|near):([a-z]+)(:deep)?$/.exec(b);
      return m ? `${m[1]}:${site(m[2])}${m[3] ?? ""}` : b;
    })
    .filter((b) => !/^(clue|near):bioweapons/.test(b) || iss);
  return { beats: out, archive: archive.map(site).filter(keep) };
}

/** A new journey starts with an empty survey. */
export function clearProgress() {
  try {
    for (const k of [SAVE_KEY, RECORDS_KEY, ...STALE_KEYS]) window.localStorage.removeItem(k);
  } catch {
    // nothing stored
  }
}
