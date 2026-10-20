"use client";

import { say, store, type Who } from "./store";
import { CHAR_MS } from "./script";
import { playVoice, stopVoice, voiceLatencyMs, voiceMs } from "./voice";

// Reads lines into the subtitles one after another. A scene (the story) runs to the end
// unless something cuts it; a remark (a scan result, an arrival) only shows when no scene is
// being read, so the story never gets talked over.

export type Cue = {
  who: Who | null;
  text: string;
  /** silence before the line, ms */
  pause?: number;
  /** how long the line stays up after it has typed out, ms */
  hold?: number;
  instructions?: boolean;
  /** recorded pieces when the caption is put together from several (an identification) */
  parts?: string[];
  /** runs as the line comes up (interference on a damaged recording, and so on) */
  onStart?: () => void;
};

const HOLD_MS = 1900;
const REMARK_HOLD_MS = 4200;

let epoch = 0;
let pending = 0;
let queue: Promise<unknown> = Promise.resolve();
let scene = false;
let remarkId = 0;

/** scenes can be run faster for testing (window.__sanctuarySpeed); 1 in play */
const pace = () => (window as { __sanctuarySpeed?: number }).__sanctuarySpeed ?? 1;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms / pace()));

/** after a recorded line ends, the caption stays this long at most before the next (the last
 * line of a scene a little longer, so the scene doesn't snap shut) */
const VOICED_HOLD_MS = 300;
const VOICED_LAST_HOLD_MS = 900;

/**
 * The silence before a line, from what the script asks for and who is talking. Spoken lines run
 * close together: the same voice going on barely pauses, a reply comes quickly, and only the
 * silences written in on purpose (two seconds or more: a shock, a breakdown) stay long.
 */
export function gapBefore(c: Cue, prev: Cue | null) {
  const p = c.pause ?? 0;
  if (!prev || p <= 0) return p;
  if (p >= 2000) return p * 0.75;
  return p * (prev.who === c.who ? 0.3 : 0.5);
}

/**
 * Start a line: its voice (when recorded) and its caption in the same tick. A recorded line
 * sets the caption's typing pace to follow the voice, and the line's length.
 */
let shown = 0;
export function readOut(c: { text: string; who: Who | null; instructions?: boolean; parts?: string[]; hold?: number }, last = true) {
  const my = ++shown;
  // a new line never talks over the last one (a remark still finishing, a cut-off line)
  if (!c.instructions) stopVoice();
  const voiceMs = c.instructions ? null : playVoice(c.parts ?? [c.text]);
  const n = Math.max(1, c.text.length);
  if (voiceMs === null) {
    say(c.text, { who: c.who, instructions: c.instructions });
    return n * CHAR_MS + (c.hold ?? HOLD_MS);
  }
  // the words type out at the pace they are spoken, finishing just before the voice does; the
  // caption waits for the sound to actually reach the speakers, so both start together
  const show = () => my === shown && say(c.text, { who: c.who, instructions: c.instructions, charMs: Math.min(90, (voiceMs * 0.88) / n) });
  const lag = voiceLatencyMs();
  if (lag > 4) window.setTimeout(show, lag);
  else show();
  return lag + voiceMs + Math.min(c.hold ?? HOLD_MS, last ? VOICED_LAST_HOLD_MS : VOICED_HOLD_MS);
}

/** About how long these lines take to read (ms, at play pace): for a cutscene cut to fit them. */
export function estimateMs(cues: Cue[]) {
  let ms = 0;
  cues.forEach((c, i) => {
    const voiced = c.instructions ? null : voiceMs(c.parts ?? [c.text]);
    const hold = i === cues.length - 1 ? VOICED_LAST_HOLD_MS : VOICED_HOLD_MS;
    ms += gapBefore(c, cues[i - 1] ?? null) + (voiced === null ? Math.max(1, c.text.length) * CHAR_MS + (c.hold ?? HOLD_MS) : voiced + Math.min(c.hold ?? HOLD_MS, hold));
  });
  return ms / pace();
}

/** Is a story scene being read (or waiting to be read) right now? */
export const inScene = () => scene;

/**
 * Read a scene after any scene already being read. Resolves true once every line has been
 * read, false if `hush` cut it off.
 */
export function speak(cues: Cue[]): Promise<boolean> {
  const my = epoch;
  pending++;
  scene = true;
  const read = queue.then(async () => {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const gap = gapBefore(c, cues[i - 1] ?? null);
      if (gap) await wait(gap);
      if (my !== epoch) return false;
      c.onStart?.();
      await wait(readOut(c, i === cues.length - 1));
      if (my !== epoch) return false;
    }
    return true;
  });
  queue = read;
  return read.then((ok) => {
    if (my === epoch && --pending === 0) {
      scene = false;
      store.set({ subtitle: null });
    }
    return ok;
  });
}

/** A single line outside the story; dropped while a scene is being read. */
export function remark(text: string, who: Who | null = "ai", hold = REMARK_HOLD_MS, parts?: string[]) {
  if (scene || store.get().replaying) return;
  const id = ++remarkId;
  stopVoice();
  const ms = readOut({ text, who, hold, parts });
  window.setTimeout(() => id === remarkId && !scene && store.set({ subtitle: null }), ms);
}

/** Stop every scene (read or waiting) and clear the subtitles. */
export function hush() {
  stopVoice();
  shown++;
  epoch++;
  pending = 0;
  queue = Promise.resolve();
  scene = false;
  remarkId++;
  store.set({ subtitle: null });
}
