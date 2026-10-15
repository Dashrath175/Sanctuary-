"use client";

// Procedural sound: everything is synthesised with WebAudio, no sample files.

type Bus = { ctx: AudioContext; master: GainNode; travel: GainNode; travelFilter: BiquadFilterNode; hum: GainNode };

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

  // Ambience: two detuned low drones through a slow-moving lowpass.
  const drone = ctx.createGain();
  drone.gain.value = 0.08;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 420;
  drone.connect(lp).connect(master);
  for (const f of [55, 82.4, 110.3]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 14;
    o.connect(drone);
    o.start();
  }
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start();

  // Travel: filtered noise whose level follows speed.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const travelFilter = ctx.createBiquadFilter();
  travelFilter.type = "bandpass";
  travelFilter.frequency.value = 300;
  travelFilter.Q.value = 0.7;
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

  bus = { ctx, master, travel, travelFilter, hum };
  return bus;
}

export const audio = {
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
    bus.travel.gain.setTargetAtTime(Math.min(0.5, level * 0.5), t, 0.25);
    bus.travelFilter.frequency.setTargetAtTime(240 + level * 1400, t, 0.25);
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
