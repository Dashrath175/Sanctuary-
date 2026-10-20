"use client";

// Procedural sound: the score, travel rumble and effects are synthesised with WebAudio; only
// the voice lines are files.

import { preloadSong, setMood, setScoreState, type ScoreState, startScore, type Mood } from "./music";

type Bus = { ctx: AudioContext; master: GainNode; travel: GainNode; travelFilter: BiquadFilterNode; hum: GainNode; static: GainNode; voice: GainNode; radio: GainNode };

let bus: Bus | null = null;
let enabled = true;
let volume = 0.8;
const level = () => (enabled ? 0.7 * volume : 0);

function noiseBuffer(ctx: AudioContext, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // brown-ish noise
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function ensure(): Bus | null {
  if (typeof window === "undefined") return null;
  if (bus) return bus;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = level();
  master.connect(ctx.destination);

  // The background score (src/lib/music.ts): silent until the game starts.
  startScore(ctx, master, noiseBuffer(ctx, 4));

  // Travel: filtered noise whose level follows speed.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const travelFilter = ctx.createBiquadFilter();
  // a low rumble that opens a little with speed, never a hiss
  travelFilter.type = "lowpass";
  travelFilter.frequency.value = 160;
  travelFilter.Q.value = 0.5;
  const travel = ctx.createGain();
  travel.gain.value = 0;
  src.connect(travelFilter).connect(travel).connect(master);
  src.start();

  // Drive hum under long autopilot legs.
  const hum = ctx.createGain();
  hum.gain.value = 0;
  hum.connect(master);
  for (const f of [46, 69.2]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(hum);
    o.start();
  }

  // Sensor interference: sparse crackle over a thin hiss, silent until set.
  const crackle = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const cd = crackle.getChannelData(0);
  for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() - 0.5) * 0.12 + (Math.random() < 0.0009 ? (Math.random() - 0.5) * 2.4 : 0);
  const staticSrc = ctx.createBufferSource();
  staticSrc.buffer = crackle;
  staticSrc.loop = true;
  const staticFilter = ctx.createBiquadFilter();
  staticFilter.type = "bandpass";
  staticFilter.frequency.value = 2200;
  staticFilter.Q.value = 0.6;
  const staticGain = ctx.createGain();
  staticGain.gain.value = 0;
  staticSrc.connect(staticFilter).connect(staticGain).connect(master);
  staticSrc.start();

  // A recovered recording's radio: a narrow band of hiss and crackle that runs under the whole
  // playback, the gaps between lines included, so the transmission never drops to clean silence.
  const radioBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const rd = radioBuf.getChannelData(0);
  let wob = 0;
  for (let i = 0; i < rd.length; i++) {
    wob += (Math.random() - 0.5) * 0.002;
    wob *= 0.999;
    rd[i] = (Math.random() - 0.5) * (0.22 + wob * 8) + (Math.random() < 0.0016 ? (Math.random() - 0.5) * 1.8 : 0);
  }
  const radioSrc = ctx.createBufferSource();
  radioSrc.buffer = radioBuf;
  radioSrc.loop = true;
  const radioBand = ctx.createBiquadFilter();
  radioBand.type = "bandpass";
  radioBand.frequency.value = 1600;
  radioBand.Q.value = 0.45;
  const radioGain = ctx.createGain();
  radioGain.gain.value = 0;
  radioSrc.connect(radioBand).connect(radioGain).connect(master);
  radioSrc.start();

  // Voices: straight to the master, a little above the ambience.
  const voice = ctx.createGain();
  voice.gain.value = 1.25;
  voice.connect(master);

  bus = { ctx, master, travel, travelFilter, hum, static: staticGain, voice, radio: radioGain };
  return bus;
}

export const audio = {
  /** Load the recorded score behind the loading screen. */
  preloadScore() {
    return preloadSong(ensure()?.ctx ?? null);
  },
  /** the shared context (created on first use; it may still be suspended) */
  context() {
    return ensure()?.ctx ?? null;
  },
  /** where voice lines play */
  voiceOut() {
    return ensure()?.voice ?? null;
  },
  unlock() {
    const b = ensure();
    if (b && b.ctx.state === "suspended") void b.ctx.resume();
  },
  /** True when sound can start without a gesture (otherwise the opening shows a wake gate). */
  async canStart() {
    const b = ensure();
    if (!b) return true;
    if (b.ctx.state === "running") return true;
    await Promise.race([b.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 180))]);
    return (b.ctx.state as string) === "running";
  },
  setEnabled(on: boolean) {
    enabled = on;
    const b = ensure();
    if (!b) return;
    b.master.gain.setTargetAtTime(level(), b.ctx.currentTime, 0.08);
  },
  /** 0..1 master volume (separate from mute). */
  setVolume(v: number) {
    volume = Math.min(1, Math.max(0, v));
    if (!bus) return;
    bus.master.gain.setTargetAtTime(level(), bus.ctx.currentTime, 0.05);
  },
  /** 0..1 */
  setTravel(level: number) {
    if (!bus) return;
    const t = bus.ctx.currentTime;
    bus.travel.gain.setTargetAtTime(Math.min(0.38, level * 0.38), t, 0.4);
    bus.travelFilter.frequency.setTargetAtTime(140 + level * 300, t, 0.4);
  },
  /** the score's mood for the chapter */
  mood(m: Mood) {
    if (ensure()) setMood(m);
  },
  /** the score low under play, or faded out for a major scene */
  /** the score's place in the mix: on/off, under dialogue, at rest, records open */
  music(st: ScoreState) {
    if (ensure()) setScoreState(st);
  },
  /** A recording's radio bed: on (0..1) for the whole playback, off when it ends. */
  radio(level: number) {
    if (!bus) return;
    bus.radio.gain.setTargetAtTime(level * 0.16, bus.ctx.currentTime, level > 0 ? 0.25 : 0.6);
  },
  /** A burst of interference in the radio bed where a recording breaks up (k 0..1). */
  radioBurst(k: number) {
    if (!bus) return;
    const g = bus.radio.gain, t = bus.ctx.currentTime;
    const base = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(base, t);
    // a few uneven surges and drop-outs, then back to the bed
    let at = t;
    for (let i = 0; i < 3 + Math.round(k * 4); i++) {
      at += 0.08 + Math.random() * 0.22;
      g.linearRampToValueAtTime((0.25 + Math.random() * 0.5) * k, at);
      at += 0.05 + Math.random() * 0.12;
      g.linearRampToValueAtTime(base * (0.3 + Math.random() * 0.7), at);
    }
    g.setTargetAtTime(0.16, at, 0.4);
  },
  /** 0..1 sensor interference (follows the screen flicker). */
  setStatic(level: number) {
    if (!bus) return;
    bus.static.gain.setTargetAtTime(Math.min(0.5, level * 0.5), bus.ctx.currentTime, 0.12);
  },
  /** 0..1 autopilot intensity: a low hum that swells under the travel noise. */
  setDrive(level: number) {
    if (!bus) return;
    bus.hum.gain.setTargetAtTime(Math.min(0.22, level * 0.22), bus.ctx.currentTime, 0.35);
  },
  /** Autopilot engaged: a filtered rush that opens up, over a soft low thump. */
  engage() {
    const b = bus;
    if (!b || !enabled) return;
    const t = b.ctx.currentTime;
    const src = b.ctx.createBufferSource();
    src.buffer = noiseBuffer(b.ctx, 2);
    const f = b.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    src.connect(f).connect(g).connect(b.master);
    src.start(t);
    src.stop(t + 2);
    const o = b.ctx.createOscillator();
    const og = b.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(og).connect(b.master);
    o.start(t);
    o.stop(t + 0.65);
  },
  /** A hard stop: a deep thud and a crunch, as heavy as the jolt (0..1); a hard one makes the frame groan. */
  jolt(k: number) {
    const b = bus;
    if (!b || !enabled) return;
    const t = b.ctx.currentTime;
    const o = b.ctx.createOscillator();
    const og = b.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(70 + 30 * k, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.35 + 0.6 * k);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.12 + 0.5 * k, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45 + 0.75 * k);
    o.connect(og).connect(b.master);
    o.start(t);
    o.stop(t + 1.3);
    const src = b.ctx.createBufferSource();
    src.buffer = noiseBuffer(b.ctx, 2);
    const f = b.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(400 + 1600 * k, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.5 + 0.6 * k);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.4 * k, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4 + 0.7 * k);
    src.connect(f).connect(g).connect(b.master);
    src.start(t);
    src.stop(t + 1.3);
    if (k > 0.5) {
      const m = b.ctx.createOscillator();
      const mf = b.ctx.createBiquadFilter();
      const mg = b.ctx.createGain();
      m.type = "sawtooth";
      m.frequency.setValueAtTime(150, t + 0.08);
      m.frequency.exponentialRampToValueAtTime(70, t + 0.9);
      mf.type = "bandpass";
      mf.frequency.value = 600;
      mf.Q.value = 3;
      mg.gain.setValueAtTime(0.0001, t + 0.08);
      mg.gain.exponentialRampToValueAtTime(0.03 * k, t + 0.15);
      mg.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      m.connect(mf).connect(mg).connect(b.master);
      m.start(t + 0.08);
      m.stop(t + 1.05);
    }
  },
  /** Arrival: the rush falls away and two soft tones land. */
  arrive() {
    this.sweep(false);
    setTimeout(() => this.discover(), 380);
  },
  blip(freq = 880, dur = 0.08, type: OscillatorType = "sine", vol = 0.12) {
    const b = bus;
    if (!b || !enabled) return;
    const t = b.ctx.currentTime;
    const o = b.ctx.createOscillator();
    const g = b.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(b.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  ui() {
    this.blip(1320, 0.05, "square", 0.04);
  },
  sweep(up = true) {
    const b = bus;
    if (!b || !enabled) return;
    const t = b.ctx.currentTime;
    const o = b.ctx.createOscillator();
    const g = b.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(up ? 220 : 1400, t);
    o.frequency.exponentialRampToValueAtTime(up ? 1600 : 200, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(b.master);
    o.start(t);
    o.stop(t + 1.2);
  },
  discover() {
    this.blip(660, 0.09, "sine", 0.1);
    setTimeout(() => this.blip(990, 0.12, "sine", 0.1), 90);
  },
};
