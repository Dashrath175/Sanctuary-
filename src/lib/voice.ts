"use client";

import { audio } from "./audio";

// Recorded voice lines. Every line lives in a few packed files (public/voice), found by the exact
// caption text it speaks; lines with no recording simply stay silent.
//
// A packed file is decoded at the output's own rate (so it plays exactly as decoded) and kept as
// 16-bit samples instead of the 32-bit audio the browser decodes to: half the memory. A new game
// decodes only the files its opening lines are in behind the loading screen and the rest one after
// another in the background; a resumed game, which may need any line at once, decodes every file
// first. A line is copied out of its file the moment it is spoken.

type Clip = [sprite: number, start: number, duration: number];
type Manifest = { sprites: string[]; clips: Record<string, Clip> };
/**
 * `waiting`: its download dropped and it is tried again shortly; `scale`: the file's loudest
 * sample, at least 1, so a peak above full scale is kept, not clipped; `tries`: downloads of it the
 * network has dropped so far
 */
type Sprite = { state: "idle" | "loading" | "waiting" | "ready" | "failed"; pcm: Int16Array | null; rate: number; scale: number; job: Promise<void> | null; tries: number };

/** files decoded at once behind the loading screen */
const UP_FRONT = 4;
/** a download the network dropped (a phone between masts) is tried again after these waits */
const RETRY_MS = [4000, 15_000, 45_000];

let manifest: Manifest | null = null;
let sprites: Sprite[] = [];
/** files still waiting to load in the background, next first */
let queue: number[] = [];
let pumping = false;
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

const SLICE = 1 << 19;
// between slices the page gets a turn; a message is answered at once, where a timeout nested
// this deep would wait 4 ms each time
const waiters: (() => void)[] = [];
let channel: MessageChannel | null = null;
function breathe() {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") return void setTimeout(resolve, 0);
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => waiters.shift()?.();
    }
    waiters.push(resolve);
    channel.port2.postMessage(0);
  });
}

type Packed = { pcm: Int16Array; scale: number };

// The packing runs in a worker so the game never waits on it. The decoded samples are handed over,
// not copied, and let go of there the moment they are packed, so a file's 32-bit samples only exist
// while it is being packed. Where a worker cannot start, or stops answering, the packing runs here,
// a slice at a time.
const PACK = `onmessage=function(e){var f=e.data.f,p=1,i,a;for(i=0;i<f.length;i++){a=f[i]<0?-f[i]:f[i];if(a>p)p=a}var o=new Int16Array(f.length),k=32767/p;for(i=0;i<f.length;i++)o[i]=Math.round(f[i]*k);postMessage({id:e.data.id,pcm:o,scale:p},[o.buffer]);try{f.buffer.transfer(0)}catch(x){}}`;
/** how long the worker may take over a file before it counts as broken */
const PACK_PATIENCE_MS = 20_000;
let packer: Worker | null | undefined;
let packId = 0;
const packing = new Map<number, (r: Packed | null) => void>();

/** The worker broke down: whatever it was holding comes back empty, and the packing moves here. */
function dropPacker() {
  packer?.terminate();
  packer = null;
  for (const done of packing.values()) done(null);
  packing.clear();
}

function packWorker() {
  if (packer === undefined) {
    try {
      packer = new Worker(URL.createObjectURL(new Blob([PACK], { type: "text/javascript" })));
      packer.onmessage = (e: MessageEvent<Packed & { id: number }>) => {
        packing.get(e.data.id)?.(e.data);
        packing.delete(e.data.id);
      };
      packer.onerror = dropPacker;
    } catch {
      packer = null;
    }
  }
  return packer;
}

/**
 * 32-bit samples to 16-bit over `scale`. Handed to the worker, they are its own: null if it broke
 * down with them, and the file has to be decoded again.
 */
function toInt16(f: Float32Array): Promise<Packed | null> {
  const w = packWorker();
  if (!w) return toInt16Here(f);
  const id = ++packId;
  return new Promise((done) => {
    // a browser that will not let decoded samples go sends a copy
    try {
      w.postMessage({ id, f }, [f.buffer]);
    } catch {
      w.postMessage({ id, f });
    }
    const late = setTimeout(dropPacker, PACK_PATIENCE_MS);
    packing.set(id, (r) => {
      clearTimeout(late);
      done(r);
    });
  });
}

/** The same packing on this thread, a slice at a time so a frame is never held up. */
async function toInt16Here(f: Float32Array): Promise<Packed> {
  let peak = 1;
  for (let i = 0; i < f.length; i += SLICE) {
    const end = Math.min(f.length, i + SLICE);
    for (let j = i; j < end; j++) {
      const a = f[j] < 0 ? -f[j] : f[j];
      if (a > peak) peak = a;
    }
    await breathe();
  }
  const out = new Int16Array(f.length);
  const k = 32767 / peak;
  for (let i = 0; i < f.length; i += SLICE) {
    const end = Math.min(f.length, i + SLICE);
    for (let j = i; j < end; j++) out[j] = Math.round(f[j] * k);
    if (end < f.length) await breathe();
  }
  return { pcm: out, scale: peak };
}

/** Fetch and decode one packed file (once); it ends up ready, or failed and silent. */
function load(i: number) {
  const s = sprites[i];
  if (s.job) return s.job;
  s.state = "loading";
  s.job = (async () => {
    const decode = async () => {
      const res = await fetch(`/voice/${manifest!.sprites[i]}`);
      if (!res.ok) throw new Error(`voice file ${res.status}`);
      const bytes = await res.arrayBuffer();
      const ctx = audio.context();
      if (!ctx) throw new Error("no audio");
      return ctx.decodeAudioData(bytes);
    };
    try {
      let buf = await decode();
      const rate = buf.sampleRate;
      let packed = await toInt16(buf.getChannelData(0));
      // the worker broke down holding the samples: decode them again and pack them here
      if (!packed) {
        buf = await decode();
        packed = await toInt16Here(buf.getChannelData(0));
      }
      s.pcm = packed.pcm;
      s.scale = packed.scale;
      s.rate = rate;
      s.state = "ready";
    } catch (e) {
      // a dropped connection (not a missing or broken file): back in the queue in a while
      if (e instanceof TypeError && s.tries < RETRY_MS.length) {
        const wait = RETRY_MS[s.tries++];
        s.state = "waiting";
        s.job = null;
        setTimeout(() => {
          if (sprites[i] !== s || s.state !== "waiting") return;
          s.state = "idle";
          queue.push(i);
          void pump();
        }, wait);
      } else s.state = "failed";
    }
  })();
  return s.job;
}

/** The background loader: the queued files one after another. */
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) await load(queue.shift()!);
  pumping = false;
  // every file is in: the worker can go
  if (packer && !packing.size && sprites.every((s) => s.state === "ready" || s.state === "failed")) {
    packer.terminate();
    packer = undefined;
  }
}

/** A line wanted before its file is in: that file loads next. */
function hurry(i: number) {
  if (sprites[i]?.state !== "idle") return;
  queue = [i, ...queue.filter((j) => j !== i)];
  void pump();
}

/**
 * Fetch the manifest and decode, behind the loading screen, the files that hold `first` (every
 * file when it is null); reports 0..1 for those. The others wait for `loadOtherVoices`. Silent
 * (and done) if there are no voices.
 */
export async function preloadVoices(onProgress: (k: number) => void, first: string[] | null = null) {
  if (!VOICES_ON) return onProgress(1);
  try {
    const res = await fetch("/voice/manifest.json");
    if (!res.ok || !audio.context()) throw new Error("no voices");
    manifest = (await res.json()) as Manifest;
  } catch {
    onProgress(1);
    return;
  }
  const m = manifest;
  sprites = m.sprites.map(() => ({ state: "idle", pcm: null, rate: 0, scale: 1, job: null, tries: 0 }));
  const all = m.sprites.map((_, i) => i);
  const wanted = first === null ? all : all.filter((i) => first.some((t) => m.clips[voiceKey(t)]?.[0] === i));
  const now = wanted.length ? wanted : all;
  queue = all.filter((i) => !now.includes(i));
  let done = 0;
  const waiting = [...now];
  const next = async () => {
    while (waiting.length) {
      await load(waiting.shift()!);
      onProgress(++done / now.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UP_FRONT, now.length) }, next));
}

/** Once the game has loaded: the files not needed yet, one after another in the background. */
export function loadOtherVoices() {
  void pump();
}

/** a line's place in the packed files, or null when it has none (or its file failed) */
const clipOf = (text: string) => {
  const c = manifest?.clips[voiceKey(text)];
  return c && sprites[c[0]] && sprites[c[0]].state !== "failed" ? c : null;
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

/**
 * Speak these lines back to back, starting now. Returns their length in ms, or null when any is
 * missing or its file is not decoded yet (the line is then shown as a caption only, and its file
 * is moved to the front of the queue).
 */
export function playVoice(parts: string[]) {
  const clips = parts.map(clipOf);
  if (clips.some((c) => !c)) return null;
  let waitingFor = false;
  for (const c of clips) {
    if (sprites[c![0]].state !== "ready") {
      hurry(c![0]);
      waitingFor = true;
    }
  }
  if (waitingFor) return null;
  const ms = voiceMs(parts);
  const ctx = audio.context();
  const out = audio.voiceOut();
  if (ms === null || !ctx || !out) return ms;
  let at = ctx.currentTime;
  for (const c of clips) {
    const [sprite, start, dur] = c!;
    const s = sprites[sprite];
    const pcm = s.pcm!;
    const from = Math.min(pcm.length, Math.round(start * s.rate));
    // (a line that would run past the end of its file stops there)
    const n = Math.min(pcm.length - from, Math.round(dur * s.rate));
    if (n > 0) {
      const buf = ctx.createBuffer(1, n, s.rate);
      const ch = buf.getChannelData(0);
      const k = s.scale / 32767;
      for (let j = 0; j < n; j++) ch[j] = pcm[from + j] * k;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(out);
      src.start(at);
      src.onended = () => playing.delete(src);
      playing.add(src);
    }
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
