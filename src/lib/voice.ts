"use client";

import { audio } from "./audio";

// Recorded voice lines. Every line lives in a few packed files (public/voice), decoded behind
// the loading screen, so a line starts the instant its caption does. A line is found by the
// exact caption text it speaks; lines with no recording simply stay silent.

type Clip = [sprite: number, start: number, duration: number];
type Manifest = { sprites: string[]; clips: Record<string, Clip> };

let manifest: Manifest | null = null;
let buffers: (AudioBuffer | null)[] = [];
const playing = new Set<AudioBufferSourceNode>();

/** the same key the generator writes: FNV-1a of the trimmed caption text */
export function voiceKey(text: string) {
  let h = 0x811c9dc5;
  const t = text.trim();
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Off turns every line into captions only (for a build without public/voice). */
const VOICES_ON = true;

/** Fetch and decode every voice file; reports 0..1. Silent (and done) if there are none. */
export async function preloadVoices(onProgress: (k: number) => void) {
  if (!VOICES_ON) return onProgress(1);
  const ctx = audio.context();
  try {
    const res = await fetch("/voice/manifest.json");
    if (!res.ok || !ctx) throw new Error("no voices");
    manifest = (await res.json()) as Manifest;
  } catch {
    onProgress(1);
    return;
  }
  let done = 0;
  buffers = await Promise.all(
    manifest.sprites.map((file) =>
      fetch(`/voice/${file}`)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx!.decodeAudioData(b))
        .catch(() => null)
        .finally(() => onProgress(++done / manifest!.sprites.length)),
    ),
  );
}

const clipOf = (text: string) => {
  const c = manifest?.clips[voiceKey(text)];
  return c && buffers[c[0]] ? c : null;
};

/** Total length in ms of these lines spoken back to back, or null if any is missing. */
export function voiceMs(parts: string[]) {
  let s = 0;
  for (const p of parts) {
    const c = clipOf(p);
    if (!c) return null;
    s += c[2];
  }
  return s * 1000;
}

/** Speak these lines back to back, starting now. Returns their length in ms, or null. */
export function playVoice(parts: string[]) {
  const ms = voiceMs(parts);
  const ctx = audio.context();
  const out = audio.voiceOut();
  if (ms === null || !ctx || !out) return ms;
  let at = ctx.currentTime;
  for (const p of parts) {
    const [sprite, start, dur] = clipOf(p)!;
    const src = ctx.createBufferSource();
    src.buffer = buffers[sprite];
    src.connect(out);
    src.start(at, start, dur);
    src.onended = () => playing.delete(src);
    playing.add(src);
    at += dur;
  }
  return ms;
}

/** How long the sound takes to reach the speakers (ms), so a caption can wait for its voice. */
export function voiceLatencyMs() {
  const ctx = audio.context();
  return ctx ? ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 : 0;
}

/** Cut off whatever is being spoken. */
export function stopVoice() {
  for (const s of playing) {
    try {
      s.stop();
    } catch {
      // already ended
    }
  }
  playing.clear();
}
