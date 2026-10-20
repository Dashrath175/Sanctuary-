"use client";

// The background score: a calm, deep ambient bed synthesised live, so nothing is downloaded
// and it never loops audibly. A sub drone breathes under a soft pad; now and then a single
// chime rings out. Each chapter has its own mood (key, chord, brightness), and moods glide
// into one another over several seconds. It sits low under everything, and fades out
// smoothly when a major scene needs silence.

export type Mood = "drift" | "belt" | "home" | "survey" | "signal" | "transmission" | "record" | "lonely";

type Preset = { root: number; chord: number[]; cutoff: number; air: number; chimes: number };

const A1 = 55;
const note = (root: number, semis: number) => root * 2 ** (semis / 12);

// root in Hz (sub octave), pad intervals in semitones above it, filter brightness, wind level,
// chimes per minute
const PRESETS: Record<Mood, Preset> = {
  drift: { root: A1, chord: [12, 19, 24, 27], cutoff: 520, air: 0.5, chimes: 1.2 },
  belt: { root: note(A1, -4), chord: [12, 13, 19, 24], cutoff: 380, air: 1, chimes: 0 },
  home: { root: note(A1, 3), chord: [12, 16, 19, 24], cutoff: 640, air: 0.4, chimes: 1.6 },
  survey: { root: A1, chord: [12, 19, 22, 27, 31], cutoff: 760, air: 0.45, chimes: 2.2 },
  signal: { root: note(A1, -7), chord: [12, 19, 25], cutoff: 430, air: 0.7, chimes: 0.6 },
  transmission: { root: note(A1, -5), chord: [12, 18, 19, 24], cutoff: 420, air: 0.8, chimes: 0.3 },
  record: { root: A1, chord: [12, 19, 24], cutoff: 300, air: 0.3, chimes: 0 },
  lonely: { root: note(A1, -4), chord: [19, 24, 28, 31], cutoff: 700, air: 0.35, chimes: 1 },
};

const PAD_VOICES = 5;
/**
 * How the score sits in the mix. It plays at full level in flight and keeps playing under the
 * dialogue, only dipped to a quarter and muffled (so the words always sit on top); after a few
 * seconds at rest (holding beside something) it settles to about a third, also muffled; with the
 * records open it halves. It dips quickly (about 0.6 s), comes back gently (about 1.5 s), fades
 * in over 4 s at the start and out over 6 s.
 */
const FULL = 0.07;
const DIALOGUE = 0.25;
const REST = 0.35;
const PAUSED = 0.5;
const OPEN_HZ = 9000;
const MUFFLED_HZ = 1200;
export type ScoreState = { on: boolean; dialogue: boolean; rest: boolean; paused: boolean };

type Score = {
  ctx: AudioContext;
  out: GainNode;
  sub: OscillatorNode[];
  pad: { osc: OscillatorNode; gain: GainNode }[];
  filter: BiquadFilterNode;
  air: GainNode;
  reverb: ConvolverNode;
  mood: Mood;
  chimeTimer: number;
  /** muffles the whole score under dialogue and at rest */
  tone: BiquadFilterNode;
  bed: GainNode;
  /** the recorded score, looping, once it has loaded */
  song: AudioBufferSourceNode | null;
  level: number;
  started: boolean;
  hz: number;
};

let score: Score | null = null;

/** a long, dark, soft hall built from decaying noise */
function hall(ctx: AudioContext, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.08 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - i / len, 3.2);
    }
  }
  return buf;
}

/** Start the score on this context, into `dest`. */
export function startScore(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
  if (score) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = OPEN_HZ;
  tone.Q.value = 0.5;
  out.connect(tone).connect(dest);
  // the synthesised bed (drone, pad, wind, chimes) sits under its own gain, so the recorded
  // score can take its place once it has loaded
  const bed = ctx.createGain();
  bed.gain.value = 1;
  bed.connect(out);
  const reverb = ctx.createConvolver();
  reverb.buffer = hall(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(bed);

  const p = PRESETS.drift;
  // the sub drone: root and fifth, breathing very slowly
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  subGain.connect(bed);
  const sub = [0, 7].map((semis, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = note(p.root, semis);
    const g = ctx.createGain();
    g.gain.value = i ? 0.35 : 0.65;
    o.connect(g).connect(subGain);
    o.start();
    return o;
  });
  const breathe = ctx.createOscillator();
  const breatheDepth = ctx.createGain();
  breathe.frequency.value = 0.037;
  breatheDepth.gain.value = 0.18;
  breathe.connect(breatheDepth).connect(subGain.gain);
  breathe.start();

  // the pad: soft triangles through a low filter, half of it into the hall
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = p.cutoff;
  filter.Q.value = 0.4;
  filter.connect(bed);
  filter.connect(reverb);
  const pad = Array.from({ length: PAD_VOICES }, (_, i) => {
    const osc = ctx.createOscillator();
    osc.type = i % 2 ? "sine" : "triangle";
    osc.detune.value = (Math.random() - 0.5) * 9;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(filter);
    osc.start();
    // each voice swells on its own slow cycle
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.02 + Math.random() * 0.03;
    depth.gain.value = 0.012;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    return { osc, gain };
  });

  // space wind: brown noise, band-limited and barely there
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windBand = ctx.createBiquadFilter();
  windBand.type = "bandpass";
  windBand.frequency.value = 320;
  windBand.Q.value = 0.6;
  const air = ctx.createGain();
  air.gain.value = 0;
  wind.connect(windBand).connect(air).connect(bed);
  wind.start();

  score = { ctx, out, sub, pad, filter, air, reverb, mood: "drift", chimeTimer: 0 , tone, bed, song: null, level: 0, started: false, hz: OPEN_HZ };
  attachSong();
  applyMood("drift", 0.1);
  scheduleChime();
}

function applyMood(mood: Mood, glide = 3) {
  if (!score) return;
  const { ctx, sub, pad, filter, air } = score;
  const p = PRESETS[mood];
  const t = ctx.currentTime;
  sub[0].frequency.setTargetAtTime(note(p.root, 0), t, glide);
  sub[1].frequency.setTargetAtTime(note(p.root, 7), t, glide);
  pad.forEach((v, i) => {
    const semis = p.chord[i];
    if (semis === undefined) {
      v.gain.gain.setTargetAtTime(0, t, glide);
      return;
    }
    v.osc.frequency.setTargetAtTime(note(p.root, semis), t, glide);
    v.gain.gain.setTargetAtTime(0.05 / (1 + i * 0.35), t, glide);
  });
  filter.frequency.setTargetAtTime(p.cutoff, t, glide);
  air.gain.setTargetAtTime(0.05 * p.air, t, glide);
  score.mood = mood;
}

/** a single soft chime from the current chord, into the hall */
function chime() {
  if (!score) return;
  const { ctx, reverb, mood } = score;
  const p = PRESETS[mood];
  const semis = p.chord[Math.floor(Math.random() * p.chord.length)] + 24;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = note(p.root, semis);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
  o.connect(g).connect(reverb);
  o.start(t);
  o.stop(t + 5.2);
}

function scheduleChime() {
  if (!score) return;
  const per = PRESETS[score.mood].chimes;
  const wait = per > 0 ? (60 / per) * (0.5 + Math.random()) : 20;
  score.chimeTimer = window.setTimeout(() => {
    if (score && PRESETS[score.mood].chimes > 0) chime();
    scheduleChime();
  }, wait * 1000);
}

// ---------- the recorded score ----------

/** the recorded score sits this much above the synthesised bed (it is mastered at -20 dBFS) */
const SONG_GAIN = 3.5;
let songBuffer: AudioBuffer | null = null;

/** Fetch and decode the recorded score behind the loading screen (silent if it is missing). */
export async function preloadSong(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    const res = await fetch("/audio/score.mp3");
    if (!res.ok) return;
    songBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
    attachSong();
  } catch {
    // no recorded score: the synthesised bed plays on its own
  }
}

/** Swap the synthesised bed for the recorded score, looping. */
function attachSong() {
  if (!score || !songBuffer || score.song) return;
  const { ctx } = score;
  const src = ctx.createBufferSource();
  src.buffer = songBuffer;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = SONG_GAIN;
  src.connect(g).connect(score.out);
  src.start();
  score.song = src;
  score.bed.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
}

/** Move the score to a chapter's mood (a slow glide). */
export function setMood(mood: Mood) {
  if (score && score.mood !== mood) applyMood(mood, 3.5);
}

/** Set the score's place in the mix (see FULL and friends); every change is a smooth fade. */
export function setScoreState(st: ScoreState) {
  if (!score) return;
  const level = st.on ? FULL * Math.min(st.dialogue ? DIALOGUE : 1, st.rest ? REST : 1) * (st.paused ? PAUSED : 1) : 0;
  const t = score.ctx.currentTime;
  if (Math.abs(level - score.level) > 1e-4) {
    // first start: a 4 s fade-in; off: 6 s; down: ~0.6 s; back up: ~1.5 s
    const tau = !score.started && level > 0 ? 4 / 3 : level === 0 ? 2 / 3 : level < score.level ? 0.6 / 5 : 1.5 / 3;
    score.out.gain.cancelScheduledValues(t);
    score.out.gain.setValueAtTime(score.out.gain.value, t);
    score.out.gain.setTargetAtTime(level, t, tau);
    score.level = level;
    if (level > 0) score.started = true;
  }
  const hz = st.dialogue || st.rest ? MUFFLED_HZ : OPEN_HZ;
  if (hz !== score.hz) {
    score.tone.frequency.setTargetAtTime(hz, t, hz < score.hz ? 0.12 : 0.5);
    score.hz = hz;
  }
}
