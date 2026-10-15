import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { AU_KM, BODIES, byId, eclipticDirection, ephemeris, type BodyDef, type Vec } from "@/lib/solar";
import { attachMap, buildBody, exposureFor, glowSprite, sunGlare, sunGlareAt, type SunParts } from "./surface";
import { GLOW_LAYER, craftModel, lightCraft, orientCraft, prefetchCraft, type CraftModel } from "./craft";
import { Sky, toScene, type SkyStar } from "./sky";
import { Dust } from "./dust";
import { CraftGlow, TravelOptics, grainShader, lensShader, travelShader } from "./post";
import { MAX_SPEED, shortKm } from "@/lib/units";

// Scene units: 1 = 1000 km. The camera always sits at the origin; every body is placed
// relative to it each frame, so heliocentric distances of billions of km stay precise.

export const UNIT = 1000;
const THRESHOLD = 50_000;
const NEAR_KM = 1e8; // bodies farther than this are drawn as dots only
const FAR_UNITS = 120_000;
const SKY_UNITS = 150_000;
const PLANET_RANGE_KM = 5e7; // planets resolve within 50 million km
const RESOLVE_DEG = 0.15; // moons and asteroids resolve once they look this big
const CRAFT_RANGE_KM = 2e5;
const LOOK_RATE = 1.2; // rad/s with keys
const LOOK_EASE = 12;
const BRAKE_S = 0.6;
const ALIGN_S = 0.25;
const AUTO_MAX = MAX_SPEED * 100;
const RADAR_KM = 1e6;
// a scan's readings linger while we stay on the same patch: full until 30,000 km of travel
// or 5° of turn, gone by 300,000 km or 20°
const LINGER_KM = 30_000;
const FADE_KM = 270_000;
const LINGER_DEG = 5;
const FADE_DEG = 15;
// the next scan looks deeper when made within this distance and angle of the last one
const DEEP_KM = 300_000;
const DEEP_RAD = Math.PI / 9;
const SCAN_S = 2.4;
const SCAN_PLANET = "#ff6a1f";
const SCAN_MOON = "#cfd6e6";
const SCAN_STAR = "#39d6c8";
// scan noise lingers a little after a scan completes, then fades
const NET_HOLD_S = SCAN_S + 1.2;
const NET_FADE_S = 1.6;
// flying within 10,000 km of a vehicle closes in on it; leaving disarms everything within 15,000
const CRAFT_CAPTURE_KM = 10_000;
const CRAFT_DISARM_KM = 15_000;
// S slows to a stop; held at rest for 0.3 s it engages reverse, up to 10,000 km/s
const REST_KM_S = 0.001;
const REVERSE_DELAY_S = 0.3;
const REVERSE_KM_S = 10_000;
// a scan reads the Sun's disc within 1.78 AU; the real Sun dims while the reading shows
const SUN_READING_AU = 1.78;
const SUN_GLARE_DIM = 0.95;
const SUN_DISC_DIM = 1 - 0.015 ** 0.95;
// the bare disc, kept below the point where bloom swallows its edge close in
const SUN_DISC_GAIN = 0.38;
/** the Sun is held where its whole disc just fits the view: 90% of the view's shorter side */
const SUN_FIT = 0.9;
/** the Sun's surface turns once in this many seconds (shown faster than life, so it reads as round) */
const SUN_TURN_S = 240;

// the main asteroid belt: a ring 2.1–3.3 AU from the Sun, ±0.45 AU thick. The drive eases its
// effective top speed down to 60% through it, ramping in over the last 0.3 AU outside and
// the first 0.1 AU inside, and back out the same way.
const BELT_INNER_AU = 2.1;
const BELT_OUTER_AU = 3.3;
const BELT_HALF_AU = 0.45;
const BELT_APPROACH_AU = 0.3;
const BELT_RAMP_AU = 0.1;
const BELT_SPEED = 0.6;
/** fastest the belt limit itself may move, km/s per second, so the speed never jerks */
const BELT_EASE = 30_000;
/** stable 0..1 hash of a string */
const hash01 = (key: string) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number) => {
  const e = Math.max(0, Math.min(1, t));
  return e * e * (3 - 2 * e);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** time compression ramps ×1 → ×100 between 50,000 and 100,000 km/s */
export const timeScaleFor = (v: number) => 1 + 99 * smooth((Math.abs(v) - THRESHOLD) / 50_000);
/** thrust: 12,000 km/s² cruising, surging to 81,000 above the threshold */
const accelFor = (v: number) => 12_000 + 69_000 * smooth((Math.abs(v) - THRESHOLD) / 15_000);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** scene axes (x, z_north, −y) → J2000 ecliptic */
const toEcliptic = (v: THREE.Vector3): Vec => [v.x, -v.z, v.y];

export type RecordStatus = "sighted" | "scanned";
export type ContactRow = { id: string; name: string; unidentified: boolean; number: number | null; distKm: number | null; star: boolean };
export type AutopilotState = { mode: "flying"; id: string; name: string };
export type Telemetry = {
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
  hold: string | null;
  scanStage: "local" | "deep";
};
export type ScanResult = {
  stage: "local" | "deep";
  primary: string | null;
  contacts: { id: string; status: RecordStatus; fresh: boolean }[];
  stars: string[];
};
export type Callout = {
  id: string;
  name: string;
  number: number;
  status: string | null;
  distKm: number;
  x: number;
  y: number;
  r: number;
  identified: boolean;
  acquiring: boolean;
  since: number;
  hero: boolean;
  target: "selected" | "travel" | null;
  kind: BodyDef["kind"];
  /** fades as we move or turn away from where the scan was made */
  alpha: number;
};
/** a scan link between two readings, in screen space */
export type NetLink = { x1: number; y1: number; x2: number; y2: number; colour: string; alpha: number; dashed: boolean };
export type Trace = {
  alpha: number;
  stars: { x: number; y: number; name: string; box: number; alpha: number; settle: number }[];
  lines: [number, number, number, number, number][];
  patterns: { x: number; y: number; name: string; alpha: number }[];
};

type Live = {
  def: BodyDef;
  pos: THREE.Vector3;
  rel: THREE.Vector3;
  dist: number;
  /** angular radius on screen, px */
  px: number;
  group: THREE.Group | null;
  globe: THREE.Mesh | null;
  material: THREE.ShaderMaterial | null;
  rings: THREE.Object3D | null;
  dot: THREE.Sprite;
  glintSeed: number;
  /** largest radius: the long axis of an elongated world */
  outer: number;
  collision: number;
  holdAlt: number;
  /** survey map requested */
  mapAsked: boolean;
  /** a vehicle's model (loaded on approach) */
  craft: CraftModel | null;
  /** where a vehicle we closed in on turns its broad face (between the Sun and our view) */
  face: THREE.Vector3 | null;
};

type Pilot = {
  id: string;
  points: THREE.Vector3[];
  path: THREE.Vector3[];
  total: number;
  speed: number;
  accel: number;
  max: number;
  phase: "turn" | "fly" | "orbit";
  t: number;
  turnDur: number;
  from: [number, number];
  standoff: number;
  orbitAxis: THREE.Vector3;
};

/** Closing in on a vehicle (zoom), then holding alongside it (hold). */
type CraftView = {
  l: Live;
  phase: "zoom" | "hold";
  from: number;
  to: number;
  t: number;
  k: number;
  seconds: number;
  up: THREE.Vector3;
  across: THREE.Vector3;
  along: THREE.Vector3;
  arrive: { yaw: number; pitch: number };
  yaw: number;
  pitch: number;
  sweep: { sign: number; extent: number; phase: number };
};

/** The Sun as a scan reads it, in screen space, for the HUD to draw. */
export type SunReading = {
  x: number;
  y: number;
  /** true radius on screen, px */
  r: number;
  alpha: number;
  reveal: number;
  time: number;
  /** within reading range: dust and flares drawn (the surface itself is drawn on the sphere) */
  full: boolean;
  /** active regions: where they sit, outward direction on screen, facing (−1..1), class */
  sites: { x: number; y: number; dx: number; dy: number; facing: number; cls: "X" | "M" | "C"; seed: number }[];
};

/** where and which way a scan was made, measured along our path */
type Observation = { travel: number; pos: THREE.Vector3; dir: THREE.Vector3 };

type Tween = { from: number[]; to: number[]; t: number; dur: number; apply: (v: number[]) => void; done?: () => void };

const KIND_STATUS: Record<BodyDef["kind"], string> = { star: "STAR", planet: "PLANET", moon: "MOON", dwarf: "DWARF PLANET", asteroid: "ASTEROID", spacecraft: "SPACECRAFT", satellite: "SATELLITE" };
const STORE_KEY = "sanctuary.records.v2";
/** records saved before the rename, carried over once */
const OLD_STORE_KEY = "waypoint.records.v2";
const isCraft = (d: BodyDef) => d.kind === "spacecraft" || d.kind === "satellite";

/** Direction from a vehicle to the camera for a view `yaw` and `pitch` in its holding frame. */
function viewDirection(v: CraftView, yaw: number, pitch: number, out: THREE.Vector3) {
  const c = Math.cos(pitch);
  return out.copy(v.across).multiplyScalar(c * Math.cos(yaw)).addScaledVector(v.along, c * Math.sin(yaw)).addScaledVector(v.up, Math.sin(pitch)).normalize();
}

/** Roll (about the view axis) that turns the camera's up toward `up`. */
function rollToward(yaw: number, pitch: number, up: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  const a = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const s = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const i = up.clone().addScaledVector(a, -up.dot(a));
  if (i.lengthSq() < 1e-8) return 0;
  i.normalize();
  return -Math.atan2(new THREE.Vector3().crossVectors(s, i).dot(a), s.dot(i));
}

/**
 * How to frame a vehicle we reach from direction `u` (vehicle to us): "up" points away from the
 * world below it, the view is pitched so that world's limb stays in the lower part of the frame,
 * and the holding side is turned so the Sun stays out of the shot. Returns the frame axes, the
 * holding pitch, where we arrive from (yaw, pitch in that frame) and a gentle sweep to drift by.
 */
function frameCraft(u: THREE.Vector3, world: { away: THREE.Vector3; radius: number } | null, sun: THREE.Vector3 | null, fovDeg: number, aspect: number) {
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const up = world ? world.away.clone() : new THREE.Vector3(0, 1, 0);
  const h = THREE.MathUtils.clamp(u.dot(up), -1, 1);
  const k = Math.tan((fovDeg * Math.PI) / 360);
  let b = Math.asin(h);
  if (world) b = Math.min(b, Math.PI / 2 - world.radius - Math.atan(0.72 * k));
  b = THREE.MathUtils.clamp(b, -1.3, 1.3);
  let f = u.clone().addScaledVector(up, -h);
  if (f.length() < 1e-9) {
    const ref = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    f = ref.addScaledVector(up, -ref.dot(up));
  }
  f.normalize();
  const x = new THREE.Vector3().crossVectors(up, f);
  let turn = 0, sign = 1, extent = 0.5;
  const reach = sun ? Math.hypot(f.dot(sun), x.dot(sun)) * Math.cos(b) : 0;
  if (sun && reach > 1e-9) {
    const y = Math.atan2(x.dot(sun), f.dot(sun));
    const half = Math.atan(Math.hypot(k, k * aspect)) + 0.15;
    const L = (-Math.cos(half) - Math.sin(b) * up.dot(sun)) / reach;
    const F = L <= -1 ? Math.PI : L >= 1 ? 0 : Math.acos(L);
    const V = wrap(-y);
    if (Math.abs(V) > F) turn = y + Math.sign(V) * F * 0.9;
    const q = wrap(y - turn);
    sign = Math.sign(q) || 1;
    extent = Math.max(Math.abs(q), Math.min(0.5, Math.abs(q) + F * 0.9));
  }
  const R = Math.cos(turn), O = Math.sin(turn);
  const across = f.clone().multiplyScalar(R).addScaledVector(x, O);
  const along = x.clone().multiplyScalar(R).addScaledVector(f, -O);
  return { up, across, along, pitch: b, from: { yaw: wrap(-turn), pitch: Math.asin(h) }, sweep: { sign, extent } };
}

export class SpaceEngine {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private travel: ShaderPass;
  private lens: ShaderPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private sky: Sky;
  private grain: ShaderPass;
  private dust = new Dust();
  private glare = sunGlare();
  /** planet exposure shared by every survey surface, adapted to the nearest world */
  private exposure = { value: 1 };
  /** the world (or craft) we are carried along with */
  private host: Live | null = null;
  private optics = new TravelOptics(THRESHOLD, MAX_SPEED);
  private craftGlow = new CraftGlow(GLOW_LAYER);
  private eph = new Map<string, Vec>();

  private bodies: Live[] = [];
  private live = new Map<string, Live>();

  // ship (scene axes, km and km/s, heliocentric)
  private cam = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private timeScale = 1;
  private yaw = 0;
  private pitch = 0;
  private yawT = 0;
  private pitchT = 0;
  private baseLook: [number, number] = [0, 0];
  private fovDeg = 54;
  private keys = new Set<string>();
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private touchHold = false;
  private holdTimer = 0;
  private tweens: Tween[] = [];
  private mode: "opening" | "awaiting" | "explore" = "opening";
  private brake: { from: THREE.Vector3; t: number } | null = null;
  /** +1 forward, −1 reverse (engaged by holding S at rest) */
  private gear = 1;
  private restHeld = 0;
  private roll = 0;
  private view: CraftView | null = null;
  /** vehicles we just left, so flying off doesn't close in on them again */
  private disarmed = new Set<string>();
  /** eased Sun gains (glare, disc) while a scan reads it */
  private sunBack: [number, number] = [1, 1];
  private thrustLevel = 0;
  private thrustText = "IDLE";
  private governed: { gapKm: number; limit: number; belt?: boolean } | null = null;
  /** the asteroid belt's speed limit as it eases (km/s) */
  private beltLimit = MAX_SPEED;
  private beltSaid = false;
  private holding: { id: string; alt: number } | null = null;
  private pilot: Pilot | null = null;
  private selected: string | null = null;
  private time = 0;
  private lastTelemetry = 0;
  private hero: Live;
  private startPos = new THREE.Vector3();
  private openingPos = new THREE.Vector3();

  // records
  private records = new Map<string, RecordStatus>();
  private numbers = new Map<string, number>();
  private contactCount = 0;
  private skyRecords = new Set<string>();
  private reached = new Set<string>();
  private acquireAt = new Map<string, number>();
  private travelKm = 0;
  private lastCam = new THREE.Vector3();
  private lastLook: [number, number] = [0, 0];
  private motion = 0;
  private lastScan: Observation | null = null;
  private scanning: { obs: Observation; found: Map<string, RecordStatus>; start: number } | null = null;
  /** when each star of a deep scan pops up */
  private starAt = new Map<string, number>();
  /** seeds which random "scan noise" connections a scan draws */
  private netSeed = 1;
  private shown: Observation | null = null;
  private shownIds = new Set<string>();
  private shownStars = new Set<string>();
  private starLineAt = new Map<string, number>();
  private callouts: Callout[] = [];
  private trace: Trace = { alpha: 0, stars: [], lines: [], patterns: [] };
  private net: NetLink[] = [];
  /** when the last scan started, for how long its noise lingers */
  private netFrom = -Infinity;

  inputEnabled = false;
  onTelemetry: ((t: Telemetry) => void) | null = null;
  onRecordsChange: ((identified: string[], reached: string[]) => void) | null = null;
  onArrive: ((b: BodyDef) => void) | null = null;
  onReached: ((b: BodyDef) => void) | null = null;
  onTravelEnd: ((reason: "arrived" | "cancelled") => void) | null = null;
  onHold: ((text: string) => void) | null = null;
  /** the drive starts easing off for the asteroid belt (once a visit) */
  onBelt: (() => void) | null = null;
  /** after each rendered frame, so screen-space overlays stay in step with the view */
  onFrame: (() => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: { mobile: boolean; reducedMotion: boolean },
  ) {
    // throws when WebGL is unavailable; the caller shows a fallback
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    this.renderer.setClearColor("#000000", 1);
    // filmic tone mapping rolls bright starlight and the galactic core off instead of clipping
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.mobile ? 1.5 : 1.75));
    this.fovDeg = opts.mobile ? 62 : 54;
    this.camera = new THREE.PerspectiveCamera(this.fovDeg, 1, 1e-6, 400_000);
    this.camera.rotation.order = "YXZ";

    this.sky = new Sky(SKY_UNITS, opts.mobile, this.renderer.getPixelRatio());
    this.scene.add(this.sky.group, this.dust.mesh, this.glare);
    this.sky.load();

    ephemeris(Date.now(), this.eph);
    for (const def of BODIES) this.addBody(def);
    this.hero = this.live.get("uranus")!;
    this.placeStart();
    this.lastCam.copy(this.cam);
    this.restoreRecords();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // only real highlights bloom (bright stars, the Sun, glints); the Milky Way and lit
    // surfaces stay crisp under it
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.0, 0.4, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.craftGlow.pass);
    this.travel = new ShaderPass(travelShader);
    this.composer.addPass(this.travel);
    this.lens = new ShaderPass(lensShader);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(grainShader);
    this.composer.addPass(this.grain);

    this.bindInput();
  }

  // ---------- construction ----------

  private addBody(def: BodyDef) {
    const v = this.eph.get(def.id)!;
    const pos = toScene(v);
    const colour = def.kind === "star" ? "#fff3d6" : isCraft(def) ? "#ff9a6a" : def.palette[1];
    // elongated worlds keep their distance from the far end of their long axis
    const outer = def.axesKm ? Math.max(...def.axesKm) : def.radiusKm;
    const dot = glowSprite(colour, 1, def.kind === "star" ? 1 : 0.8);
    dot.renderOrder = 2;
    this.scene.add(dot);
    const l: Live = {
      def,
      pos,
      rel: new THREE.Vector3(),
      dist: 1,
      px: 0,
      group: null,
      globe: null,
      material: null,
      rings: null,
      dot,
      glintSeed: (def.seed * 0.618) % 1,
      outer,
      collision: outer * 1.025 + 0.001,
      holdAlt: isCraft(def) ? 0 : Math.max(outer * 0.552, 2),
      mapAsked: false,
      craft: null,
      face: null,
    };
    this.bodies.push(l);
    this.live.set(def.id, l);
  }

  private ensureMesh(l: Live) {
    if (l.group) return;
    if (isCraft(l.def)) {
      l.craft = craftModel(l.def, UNIT, this.exposure);
      l.group = l.craft.group;
    } else {
      const { group, globe, material, rings } = buildBody(l.def, UNIT, null, this.exposure);
      l.group = group;
      l.globe = globe;
      l.material = material;
      l.rings = rings;
    }
    this.scene.add(l.group);
  }

  /** Start ~126,000 km from Uranus, which sits just right of and below a look of 007° / +7°. */
  private placeStart() {
    const dir = toScene(this.dirFromAngles(4.4, 5.7));
    this.startPos.copy(this.hero.pos).addScaledVector(dir, -126_000);
    this.openingPos.copy(this.hero.pos).addScaledVector(dir, -(this.opts.mobile ? 230_000 : 178_000));
    this.cam.copy(this.openingPos);
    this.setLook(78, 16);
    this.baseLook = [this.yaw, this.pitch];
  }

  private dirFromAngles(headingDeg: number, elevDeg: number): Vec {
    const h = (headingDeg * Math.PI) / 180, e = (elevDeg * Math.PI) / 180;
    return [Math.cos(e) * Math.cos(h), Math.cos(e) * Math.sin(h), Math.sin(e)];
  }

  /** heading/elevation in degrees → yaw/pitch (also targets) */
  private setLook(headingDeg: number, elevDeg: number) {
    this.yaw = this.yawT = ((headingDeg - 90) * Math.PI) / 180;
    this.pitch = this.pitchT = (elevDeg * Math.PI) / 180;
  }

  private forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  private anglesTo(dir: THREE.Vector3): [number, number] {
    const d = dir.clone().normalize();
    return [Math.atan2(-d.x, -d.z), Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))];
  }

  private wrapTo(target: number, from: number) {
    let t = target;
    while (t - from > Math.PI) t -= Math.PI * 2;
    while (t - from < -Math.PI) t += Math.PI * 2;
    return t;
  }

  // ---------- input ----------

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.inputEnabled) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const code = e.code;
    if (["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyX", "ShiftLeft", "ShiftRight", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(code)) {
      if (code === "Space" || code.startsWith("Arrow")) e.preventDefault();
      if (!e.repeat && this.pilot && (code === "KeyW" || code === "KeyX" || code === "KeyS")) this.cancelAutopilot(code === "KeyW");
      // thrust, S or X hands control back beside a vehicle, at rest, facing where we look
      if (!e.repeat && this.view && (code === "KeyW" || code === "KeyX" || code === "KeyS")) this.releaseView();
      else if (!e.repeat && code === "KeyX" && !this.pilot) this.beginBrake();
      this.keys.add(code);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "Space" && this.inputEnabled) e.preventDefault();
  };
  private onBlur = () => this.keys.clear();

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    if (e.pointerType === "touch" && this.inputEnabled) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => {
        if (this.drag && this.drag.moved < 10) this.touchHold = true;
      }, 300);
    }
  };
  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (this.view) {
      // beside a vehicle, dragging swings the view round it
      if (this.inputEnabled && this.view.phase === "hold") {
        this.view.yaw -= dx * 0.004;
        this.view.pitch = THREE.MathUtils.clamp(this.view.pitch + dy * 0.004, -1.3, 1.3);
      }
      return;
    }
    if (!this.inputEnabled || this.tweens.length || this.pilot) return;
    // drag right looks right, drag down looks down
    const k = 0.003;
    this.yawT -= dx * k;
    this.pitchT = THREE.MathUtils.clamp(this.pitchT - dy * k, -1.55, 1.55);
  };
  private onPointerUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
    window.clearTimeout(this.holdTimer);
    this.touchHold = false;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.inputEnabled) return;
    const s = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
    this.fovDeg = THREE.MathUtils.clamp(this.fovDeg + s * 0.055, 35, 100);
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  // ---------- public: lifecycle ----------

  resize(width: number, height: number, mobile: boolean) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.opts.mobile = mobile;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const sun = this.live.get("sun");
    if (sun) sun.holdAlt = this.sunStandoff() - sun.outer;
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.bloom.resolution.set(this.width * 0.35, this.height * 0.35);
    const px = this.renderer.getPixelRatio();
    this.craftGlow.setSize(this.width * px, this.height * px);
    this.travel.uniforms.uAspect.value = this.width / this.height;
  }

  start() {
    const loop = (t?: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.timer.update(t);
      const raw = this.timer.getDelta();
      this.frame(Math.min(raw, 0.05), this.timer.getElapsed(), Math.min(raw, 0.25));
    };
    loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.dust.dispose();
    this.craftGlow.dispose();
    this.sky.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------- public: opening choreography ----------

  private tween(from: number[], to: number[], ms: number, apply: (v: number[]) => void, done?: () => void) {
    this.tweens.push({ from, to, t: 0, dur: ms / 1000, apply, done });
  }

  /** Swing the view from the opening sky onto Uranus. */
  sweepToPlanet(ms: number) {
    if (this.mode !== "opening") return;
    this.mode = "awaiting";
    const ty = ((7 - 90) * Math.PI) / 180, tp = (7 * Math.PI) / 180;
    this.tween([this.yaw, this.pitch], [this.wrapTo(ty, this.yaw), tp], ms, ([y, p]) => {
      this.yaw = this.yawT = y;
      this.pitch = this.pitchT = p;
    }, () => (this.baseLook = [this.yaw, this.pitch]));
  }

  /** Close in from the opening distance to the survey distance. */
  dollyIn(ms: number) {
    if (this.mode === "opening") this.sweepToPlanet(Math.min(ms, 900));
    const from = this.cam.clone(), to = this.explorePos();
    this.tween([0], [1], ms, ([k]) => this.cam.lerpVectors(from, to, k));
  }

  private explorePos() {
    return this.opts.mobile ? this.hero.pos.clone().addScaledVector(this.startPos.clone().sub(this.hero.pos).normalize(), 200_000) : this.startPos.clone();
  }

  /** Jump straight to the survey framing (skip opening). */
  snapExplore() {
    this.tweens = [];
    this.mode = "explore";
    this.cam.copy(this.explorePos());
    this.setLook(7, 7);
    this.baseLook = [this.yaw, this.pitch];
  }

  setExplore() {
    this.mode = "explore";
  }

  // ---------- public: selection & autopilot ----------

  get travelling() {
    return this.pilot !== null;
  }
  get selectedId() {
    return this.selected;
  }

  select(id: string | null) {
    if (this.pilot && id !== this.pilot.id) this.cancelAutopilot(false);
    this.selected = id;
  }

  /** Turn the view toward a body (contacts, radar, labels). */
  lookAtBody(id: string) {
    const l = this.live.get(id);
    if (!l || this.pilot || this.view) return;
    const [y, p] = this.anglesTo(l.rel);
    this.yawT = this.wrapTo(y, this.yaw);
    this.pitchT = THREE.MathUtils.clamp(p, -1.55, 1.55);
  }

  /** Turn toward a named star. */
  lookAtStar(name: string) {
    const s = this.sky.named.find((x) => x.name === name);
    if (!s || this.pilot || this.view) return;
    const [y, p] = this.anglesTo(s.dir);
    this.yawT = this.wrapTo(y, this.yaw);
    this.pitchT = THREE.MathUtils.clamp(p, -1.55, 1.55);
  }

  name(id: string) {
    const st = this.records.get(id);
    const def = byId.get(id);
    if (!def) return id.toUpperCase();
    if (st === "scanned" || this.reached.has(id)) return def.name.toUpperCase();
    return `UNIDENTIFIED OBJECT #${this.numbers.get(id) ?? "?"}`;
  }

  /**
   * How far from the Sun's centre we hold: where its whole disc just fits the view (90% of the
   * shorter side), so a scan shows all of it, close up but at a safe distance.
   */
  private sunStandoff() {
    const t = Math.tan((this.camera.fov * Math.PI) / 360) * Math.min(1, this.camera.aspect) * SUN_FIT;
    return byId.get("sun")!.radiusKm / Math.sin(Math.atan(t));
  }

  private standoff(l: Live) {
    if (isCraft(l.def)) return 8_000;
    if (l.def.kind === "star") return this.sunStandoff();
    return Math.max(l.outer * 3.8, l.collision * 1.5);
  }

  autopilotState(): AutopilotState | null {
    return this.pilot ? { mode: "flying", id: this.pilot.id, name: this.name(this.pilot.id) } : null;
  }

  /** Fly to a body picked on the solar map. Returns false when already there. */
  travelTo(id: string, fromMap = false): boolean {
    const l = this.live.get(id);
    if (!l) return false;
    const standoff = this.standoff(l);
    if (l.dist < standoff * 1.15) return false;
    // the solar map names every world it shows
    if (fromMap && this.records.get(id) !== "scanned") {
      if (!this.numbers.has(id)) this.numbers.set(id, ++this.contactCount);
      this.records.set(id, "scanned");
      this.saveRecords();
      this.onRecordsChange?.(this.identifiedIds(), [...this.reached]);
    }
    if (this.view) this.releaseView();
    this.pilot = null;
    this.tweens = [];
    this.brake = null;
    this.selected = id;
    const arrival = this.arrivalPoint(l, standoff);
    const points = this.route(this.cam, arrival, l);
    if (!points) return false;
    let total = 0;
    let prev = this.cam;
    for (const p of points) {
      total += prev.distanceTo(p);
      prev = p;
    }
    const max = Math.max(AUTO_MAX, total / 150);
    // speed builds like holding W (the map's autopilot takes ten seconds to top speed, a picked
    // target's five) and brakes evenly from far out, arriving at rest; short legs last ≥ 6 s
    const accel = Math.max(1e3, Math.min(max / (fromMap ? 10 : 5), (4 * total) / 36));
    const [ty, tp] = this.anglesTo(points[0].clone().sub(this.cam));
    const turn = Math.hypot(this.wrapTo(ty, this.yaw) - this.yaw, tp - this.pitch);
    this.pilot = {
      id,
      points,
      path: [this.cam.clone(), ...points.map((p) => p.clone())],
      total,
      speed: 0,
      accel,
      max,
      phase: "turn",
      t: 0,
      turnDur: 0.5 + 1.8 * Math.min(1, turn / Math.PI),
      from: [this.yaw, this.pitch],
      standoff,
      orbitAxis: new THREE.Vector3(),
    };
    this.vel.set(0, 0, 0);
    return true;
  }

  /** Arrive on the sunlit side, leaning toward where we are coming from. */
  private arrivalPoint(l: Live, standoff: number) {
    const sun = this.live.get("sun")!.pos;
    const toUs = this.cam.clone().sub(l.pos).normalize();
    const toSun = sun.clone().sub(l.pos);
    if (toSun.lengthSq() > 1) toSun.normalize();
    else toSun.copy(toUs);
    const side = toUs.add(toSun.multiplyScalar(0.8)).normalize();
    return l.pos.clone().addScaledVector(side, standoff);
  }

  cancelAutopilot(keepMotion: boolean) {
    const p = this.pilot;
    if (!p) return;
    this.pilot = null;
    if (keepMotion && p.phase === "fly") this.vel.copy(this.forward()).multiplyScalar(Math.min(p.speed / 100, MAX_SPEED));
    else this.vel.set(0, 0, 0);
    this.onTravelEnd?.("cancelled");
  }

  /** Route points from `from` to `to`, bending round anything big in the way. */
  private route(from: THREE.Vector3, to: THREE.Vector3, skip: Live) {
    const pts = [from.clone(), to.clone()];
    for (let pass = 0; pass < 24; pass++) {
      let blocked = false;
      for (let i = 0; i < pts.length - 1 && !blocked; i++) {
        const a = pts[i], b = pts[i + 1];
        const seg = b.clone().sub(a);
        const len = seg.length();
        if (len < 1) continue;
        const dir = seg.divideScalar(len);
        let hit: { l: Live; along: number } | null = null;
        for (const o of this.bodies) {
          if (o === skip || isCraft(o.def)) continue;
          const c = o.pos.clone().sub(a);
          const along = c.dot(dir);
          if (along <= 0 || along >= len) continue;
          const miss = c.clone().addScaledVector(dir, -along).length();
          if (miss < o.collision + 100 && (!hit || along < hit.along)) hit = { l: o, along };
        }
        if (!hit) continue;
        blocked = true;
        const centre = hit.l.pos;
        const closest = a.clone().addScaledVector(dir, hit.along);
        let away = closest.clone().sub(centre);
        if (away.length() < 1) {
          const ref = Math.abs(dir.y) < 0.8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
          away = ref.addScaledVector(dir, -ref.dot(dir));
        }
        away.normalize();
        pts.splice(i + 1, 0, centre.clone().addScaledVector(away, Math.max(hit.l.collision * 3, 1e4) * (1 + pass * 0.25)));
      }
      if (!blocked) return pts.slice(1);
    }
    return null;
  }

  // ---------- public: scanning & records ----------

  private visibleFor(l: Live) {
    const k = l.def.kind;
    if (k === "star") return true;
    if (isCraft(l.def)) return l.dist <= CRAFT_RANGE_KM;
    if (k === "planet") return l.dist <= PLANET_RANGE_KM;
    return 2 * Math.asin(Math.min(1, l.def.radiusKm / Math.max(l.def.radiusKm, l.dist))) >= (RESOLVE_DEG * Math.PI) / 180;
  }

  /** moons of a planet we can resolve show up with it */
  private isResidentOfVisible(l: Live) {
    const parent = l.def.parent ? this.live.get(l.def.parent) : null;
    return !!parent && parent.def.kind === "planet" && this.visibleFor(parent) && l.dist < parent.dist + 4e6;
  }

  private observe(): Observation {
    return { travel: this.travelKm, pos: this.cam.clone(), dir: this.forward() };
  }

  /** 1 while we stay on the scanned patch, easing to 0 as we travel or turn away from it. */
  private lingering(o: Observation) {
    const moved = this.travelKm - o.travel;
    const turned = (o.dir.angleTo(this.forward()) * 180) / Math.PI;
    return 1 - THREE.MathUtils.clamp(Math.max((moved - LINGER_KM) / FADE_KM, (turned - LINGER_DEG) / FADE_DEG), 0, 1);
  }

  /** A scan made where the last one was, looking the same way, looks deeper, at the stars. */
  private nextStage(fwd = this.forward()): "local" | "deep" {
    const o = this.lastScan;
    if (!o) return "local";
    return o.pos.distanceTo(this.cam) > DEEP_KM || o.dir.angleTo(fwd) > DEEP_RAD ? "local" : "deep";
  }

  /** What a scan would find right now; `commitScan` writes it to the records. */
  scan(): ScanResult {
    const fwd = this.forward();
    if (this.nextStage(fwd) === "deep") {
      const half = (Math.max(this.camera.fov, this.camera.fov * this.camera.aspect) * Math.PI) / 360;
      const stars = this.sky.named
        .filter((s) => s.dir.angleTo(fwd) < half * 1.05)
        .sort((a, b) => a.mag - b.mag)
        .slice(0, 40)
        .map((s) => s.name);
      return { stage: "deep", primary: null, contacts: [], stars };
    }
    this.camera.updateMatrixWorld();
    const cands: { l: Live; angle: number; radius: number; error: number }[] = [];
    const v = new THREE.Vector3();
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    for (const l of this.bodies) {
      if (l.def.kind === "star") continue;
      if (!this.visibleFor(l) && !this.isResidentOfVisible(l) && !(l.def.kind === "planet")) continue;
      const angle = l.rel.angleTo(fwd);
      if (angle > Math.PI / 2) continue;
      const radius = Math.asin(Math.min(1, l.def.radiusKm / Math.max(l.dist, 1)));
      v.copy(l.rel).divideScalar(UNIT).project(this.camera);
      const pad = Math.tan(radius) / tanHalf;
      if (Math.abs(v.x) < 1 + pad / this.camera.aspect && Math.abs(v.y) < 1 + pad) cands.push({ l, angle, radius, error: Math.max(0, angle - radius) });
    }
    cands.sort((a, b) => a.l.dist - b.l.dist);
    const two = (2 * Math.PI) / 180;
    const primary =
      [...cands].sort((a, b) => a.error - b.error).find((c) => c.error < two)?.l ??
      [...cands].sort((a, b) => b.radius - a.radius).find((c) => c.radius >= two)?.l ??
      cands[0]?.l ??
      null;
    const contacts = cands.map(({ l }) => {
      const prev = this.records.get(l.def.id);
      const status: RecordStatus = this.visibleFor(l) || prev === "scanned" ? "scanned" : "sighted";
      return { id: l.def.id, status, fresh: prev !== status };
    });
    // the Sun answers too, once its disc is big enough to read
    const sun = this.live.get("sun")!;
    v.copy(sun.rel).divideScalar(UNIT).project(this.camera);
    const sunSize = 2 * Math.asin(Math.min(1, sun.def.radiusKm / Math.max(sun.dist, 1)));
    const sunSeen = sun.rel.dot(fwd) > 0 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && sunSize >= (RESOLVE_DEG * Math.PI) / 180;
    if (sunSeen) contacts.push({ id: "sun", status: "scanned", fresh: this.records.get("sun") !== "scanned" });
    // looking straight at the Sun, it is what the scan is about
    const sunCentred = sunSeen && Math.max(0, sun.rel.angleTo(fwd) - sunSize / 2) < two;
    return { stage: "local", primary: sunCentred ? "sun" : (primary?.def.id ?? (sunSeen ? "sun" : null)), contacts, stars: [] };
  }

  /** Start the acquire animation for a scan result (labels appear with a little jitter). */
  beginScanFx(result: ScanResult) {
    let k = 0;
    for (const c of result.contacts) {
      this.acquireAt.set(c.id, this.time + 0.27 + Math.random() * 1.1 + (k++ % 4) * 0.05);
      if (!this.numbers.has(c.id)) this.numbers.set(c.id, ++this.contactCount);
    }
    this.scanning = { obs: this.observe(), found: new Map(result.contacts.map((c) => [c.id, c.status])), start: this.time };
    this.netSeed = 1 + Math.floor(Math.random() * 1e9);
    this.netFrom = this.time;
    if (result.stars.length) {
      // a deep scan picks the stars out one by one while it runs
      if (this.shown && this.lingering(this.shown) <= 0) this.clearShown();
      k = 0;
      for (const n of result.stars) {
        if (!this.shownStars.has(n)) this.starAt.set(n, this.time + 0.27 + Math.random() * 1.1 + (k++ % 4) * 0.05);
        this.shownStars.add(n);
      }
      if (!this.shown) this.shown = this.scanning.obs;
    }
  }

  commitScan(result: ScanResult) {
    for (const c of result.contacts) {
      const prev = this.records.get(c.id);
      if (prev === "scanned") continue;
      if (!this.numbers.has(c.id)) this.numbers.set(c.id, ++this.contactCount);
      this.records.set(c.id, c.status);
    }
    for (const s of result.stars) this.skyRecords.add(s);
    this.saveRecords();
    this.onRecordsChange?.(this.identifiedIds(), [...this.reached]);

    // the readings stay on screen while we hold this patch; earlier ones from here stay too
    const obs = this.scanning?.obs ?? this.observe();
    this.scanning = null;
    if (this.shown && this.lingering(this.shown) <= 0) this.clearShown();
    for (const c of result.contacts) this.shownIds.add(c.id);
    for (const n of result.stars) {
      this.shownStars.add(n);
      // constellation lines join stars once the scan has finished
      if (!this.starLineAt.has(n)) this.starLineAt.set(n, this.time);
    }
    this.shown = obs;
    this.lastScan = obs;
  }

  private clearShown() {
    this.shown = null;
    this.shownIds.clear();
    this.shownStars.clear();
    this.starAt.clear();
    this.starLineAt.clear();
  }

  get namedStars() {
    return this.skyRecords.size;
  }

  identifiedIds() {
    const out = new Set<string>();
    for (const [id, s] of this.records) if (s === "scanned") out.add(id);
    for (const id of this.reached) out.add(id);
    return [...out];
  }

  /** Records restored from a previous visit, for the HUD totals. */
  restoredState() {
    return { identified: this.identifiedIds(), reached: [...this.reached], stars: this.skyRecords.size };
  }

  getCallouts() {
    return this.callouts;
  }
  getNet() {
    return this.net;
  }
  getTrace() {
    return this.trace;
  }

  private markReached(l: Live) {
    const id = l.def.id;
    if (!this.numbers.has(id)) this.numbers.set(id, ++this.contactCount);
    this.records.set(id, "scanned");
    if (!this.reached.has(id)) {
      this.reached.add(id);
      this.onReached?.(l.def);
    }
    this.saveRecords();
    this.onRecordsChange?.(this.identifiedIds(), [...this.reached]);
  }

  private saveRecords() {
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ records: [...this.records], numbers: [...this.numbers], count: this.contactCount, stars: [...this.skyRecords], reached: [...this.reached] }),
      );
    } catch {
      // storage unavailable: records last for this visit only
    }
  }

  private restoreRecords() {
    try {
      let raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) {
        raw = window.localStorage.getItem(OLD_STORE_KEY);
        if (!raw) return;
        window.localStorage.setItem(STORE_KEY, raw);
        window.localStorage.removeItem(OLD_STORE_KEY);
      }
      const s = JSON.parse(raw) as { records?: [string, RecordStatus][]; numbers?: [string, number][]; count?: number; stars?: string[]; reached?: string[] };
      for (const [id, st] of s.records ?? []) if (byId.has(id) && (st === "sighted" || st === "scanned")) this.records.set(id, st);
      for (const [id, n] of s.numbers ?? []) if (byId.has(id) && Number.isFinite(n)) this.numbers.set(id, n);
      this.contactCount = Math.max(Number(s.count) || 0, 0, ...this.numbers.values());
      for (const n of s.stars ?? []) this.skyRecords.add(String(n));
      for (const id of s.reached ?? []) if (byId.has(id)) this.reached.add(id);
    } catch {
      // ignore damaged saves
    }
  }

  // ---------- flight ----------

  private beginBrake() {
    if (this.vel.lengthSq() < 1e-6) return;
    this.brake = { from: this.vel.clone(), t: 0 };
    this.optics.beginBrake(this.vel.length());
  }

  private fly(dt: number) {
    const k = this.keys;
    const fwd = this.forward();
    const up = new THREE.Vector3(0, 1, 0).applyEuler(this.camera.rotation);
    const forwardCmd = (k.has("KeyW") || this.touchHold ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const lift = (k.has("ShiftLeft") || k.has("ShiftRight") ? 1 : 0) - (k.has("Space") ? 1 : 0);
    let text = "IDLE";
    let commanded = 0;

    if (this.brake) {
      this.brake.t += dt;
      const f = 1 - smooth(this.brake.t / BRAKE_S);
      this.vel.copy(this.brake.from).multiplyScalar(f);
      text = "BRAKING";
      if (this.brake.t >= BRAKE_S) {
        this.vel.set(0, 0, 0);
        this.brake = null;
      }
    } else {
      const speed = this.vel.length();
      const a = accelFor(speed);
      // gears: S slows to a stop and holds there; kept down at rest for a moment, it backs away
      const rest = speed <= REST_KM_S;
      if (this.gear > 0) {
        this.restHeld = rest && forwardCmd < 0 ? this.restHeld + dt : 0;
        if (this.restHeld >= REVERSE_DELAY_S) {
          this.gear = -1;
          this.restHeld = 0;
        }
      } else if (rest && forwardCmd >= 0) this.gear = 1;
      const go = Math.max(0, forwardCmd * this.gear);
      const slow = Math.max(0, -forwardCmd * this.gear);
      if (go > 0) {
        this.vel.addScaledVector(fwd, a * dt * this.gear);
        if (this.gear < 0 && this.vel.length() > REVERSE_KM_S) this.vel.setLength(REVERSE_KM_S);
        commanded = 1;
        text = this.gear > 0 ? "THRUST" : "REVERSE";
      } else if (slow > 0) {
        // ease off along the current course and stop dead instead of passing through zero
        const dv = Math.min(speed, a * dt);
        if (speed - dv <= REST_KM_S) this.vel.set(0, 0, 0);
        else this.vel.multiplyScalar((speed - dv) / speed);
        commanded = 1;
        text = rest ? "AT REST" : "SLOWING";
      }
      if (lift !== 0) {
        this.vel.addScaledVector(up, lift * 6_000 * dt);
        if (!commanded) text = lift > 0 ? "LIFT UP" : "LIFT DOWN";
        commanded = Math.max(commanded, 0.6);
      }
      // the course follows the view
      const s = this.vel.length();
      if (s > 1) {
        const reverse = this.vel.dot(fwd) < 0;
        const aim = reverse ? fwd.clone().negate() : fwd;
        const dir = this.vel.clone().divideScalar(s);
        dir.lerp(aim, 1 - Math.exp(-dt / ALIGN_S)).normalize();
        this.vel.copy(dir).multiplyScalar(s);
      }
      if (this.vel.length() > MAX_SPEED) this.vel.setLength(MAX_SPEED);
    }

    this.thrustLevel += (commanded - this.thrustLevel) * (1 - Math.exp(-dt * 7));
    if (text === "THRUST") text = `${Math.round(this.thrustLevel * 100)}%`;
    else if (text === "REVERSE") text = `REV ${Math.round(this.thrustLevel * 100)}%`;

    // the asteroid belt: the limit eases down through it and back up after, and the speed
    // follows it (it only ever caps; thrust still brings the speed back)
    const beltCap = this.brake ? MAX_SPEED : MAX_SPEED * (1 - (1 - BELT_SPEED) * this.beltDepth());
    this.beltLimit += THREE.MathUtils.clamp(beltCap - this.beltLimit, -BELT_EASE * dt, BELT_EASE * dt);
    let beltHeld = false;
    if (this.beltLimit < MAX_SPEED - 1 && this.vel.length() > this.beltLimit) {
      this.vel.setLength(this.beltLimit);
      beltHeld = true;
      text = "ASSIST";
      if (!this.beltSaid) {
        this.beltSaid = true;
        this.onBelt?.();
      }
    }

    // approach assist: ease the effective speed near any surface, hold just above it
    let speed = this.vel.length();
    this.timeScale = timeScaleFor(speed);
    this.governed = beltHeld ? { gapKm: 0, limit: this.beltLimit, belt: true } : null;
    let nearest: Live | null = null, gap = Infinity;
    for (const l of this.bodies) {
      if (!l.holdAlt) continue;
      const g = l.dist - l.outer;
      if (g < gap) {
        gap = g;
        nearest = l;
      }
    }
    if (nearest && speed > 0.01) {
      const toward = nearest.rel.clone().normalize().dot(this.vel) / speed;
      const room = Math.max(0, gap - nearest.holdAlt);
      const allowed = Math.max(60, room);
      if (toward > 0.05 && speed * this.timeScale > allowed) {
        let lo = 0, hi = speed;
        for (let i = 0; i < 30; i++) {
          const m = (lo + hi) / 2;
          if (m * timeScaleFor(m) > allowed) hi = m;
          else lo = m;
        }
        this.vel.setLength(lo);
        speed = lo;
        this.timeScale = timeScaleFor(lo);
        this.governed = { gapKm: gap, limit: lo };
        text = "ASSIST";
      }
    }
    this.thrustText = text;

    this.cam.addScaledVector(this.vel, this.timeScale * dt);

    // hold altitude: never sink into a surface
    const wasHolding = this.holding;
    this.holding = null;
    if (nearest) {
      const off = this.cam.clone().sub(nearest.pos);
      const r = off.length();
      const minR = nearest.outer + nearest.holdAlt;
      if (r < minR) {
        off.setLength(minR);
        this.cam.copy(nearest.pos).add(off);
        const n = off.normalize();
        const inward = this.vel.dot(n);
        if (inward < 0) this.vel.addScaledVector(n, -inward);
        if (this.vel.length() < 50) this.vel.set(0, 0, 0);
      }
      if (r < minR * 1.002) {
        this.holding = { id: nearest.def.id, alt: nearest.holdAlt + 1 };
        if (!wasHolding) this.onHold?.(`HOLDING · ${fmt(nearest.holdAlt + 1)} KM ABOVE ${this.name(nearest.def.id)}`);
        if (!this.reached.has(nearest.def.id)) this.markReached(nearest);
      }
    }
  }

  /** 0..1: how deep we are in the asteroid belt's slow zone (0 well clear of it) */
  private beltDepth() {
    const e = toEcliptic(this.cam.clone().sub(this.live.get("sun")!.pos));
    const rho = Math.hypot(e[0], e[1]) / AU_KM;
    const depth = Math.min(rho - BELT_INNER_AU, BELT_OUTER_AU - rho, BELT_HALF_AU - Math.abs(e[2] / AU_KM));
    return smooth((depth + BELT_APPROACH_AU) / (BELT_APPROACH_AU + BELT_RAMP_AU));
  }

  private autopilot(dt: number) {
    const p = this.pilot!;
    const l = this.live.get(p.id)!;
    p.t += dt;
    if (p.phase === "turn") {
      const [ty, tp] = this.anglesTo(p.points[0].clone().sub(this.cam));
      const k = ease(Math.min(1, p.t / p.turnDur));
      this.yaw = this.yawT = p.from[0] + (this.wrapTo(ty, p.from[0]) - p.from[0]) * k;
      this.pitch = this.pitchT = p.from[1] + (tp - p.from[1]) * k;
      this.timeScale = 1;
      if (p.t >= p.turnDur) {
        p.phase = "fly";
        p.t = 0;
      }
      return;
    }
    if (p.phase === "fly") {
      let remaining = 0;
      let prev = this.cam;
      for (const q of p.points) {
        remaining += prev.distanceTo(q);
        prev = q;
      }
      p.speed = Math.min(p.max, p.speed + p.accel * dt, Math.sqrt(2 * p.accel * remaining) + 50);
      let step = p.speed * dt;
      while (step > 0 && p.points.length) {
        const q = p.points[0];
        const d = this.cam.distanceTo(q);
        if (d <= step) {
          this.cam.copy(q);
          step -= d;
          p.points.shift();
        } else {
          this.cam.addScaledVector(q.clone().sub(this.cam).divideScalar(d), step);
          step = 0;
        }
      }
      // look along the route, settling onto the destination near the end
      const next = p.points[0] ?? l.pos;
      const settle = smooth((1 - remaining / Math.max(1, p.total) - 0.55) / 0.35);
      const aim = next.clone().sub(this.cam).normalize().lerp(l.pos.clone().sub(this.cam).normalize(), settle).normalize();
      const [ty, tp] = this.anglesTo(aim);
      const kk = 1 - Math.exp(-dt * 6);
      this.yaw = this.yawT = this.yaw + (this.wrapTo(ty, this.yaw) - this.yaw) * kk;
      this.pitch = this.pitchT = this.pitch + (tp - this.pitch) * kk;
      // the drive runs at ×100 compression: the speed shown is a hundredth of the effective one
      const shown = Math.min(p.speed / 100, MAX_SPEED);
      this.timeScale = shown > 0 ? Math.max(100, p.speed / shown) : 100;
      this.vel.copy(next.clone().sub(this.cam).normalize()).multiplyScalar(shown);
      if (!p.points.length && isCraft(l.def)) {
        // at a vehicle there is no orbit: we stop and close in on it
        this.pilot = null;
        this.vel.set(0, 0, 0);
        this.timeScale = 1;
        this.onTravelEnd?.("arrived");
        return;
      }
      if (!p.points.length) {
        p.phase = "orbit";
        p.t = 0;
        const sunDir = this.live.get("sun")!.pos.clone().sub(l.pos).normalize();
        const off = this.cam.clone().sub(l.pos).normalize();
        p.orbitAxis.crossVectors(off, sunDir);
        if (p.orbitAxis.lengthSq() < 1e-6) p.orbitAxis.set(0, 1, 0);
        p.orbitAxis.normalize();
      }
      return;
    }
    // orbit: swing slowly round the body while the view settles on it
    const orbitS = this.opts.reducedMotion ? 0.1 : 8;
    const ang = ((12 * Math.PI) / 180) * dt * (1 - smooth(p.t / orbitS) * 0.6);
    const off = this.cam.clone().sub(l.pos).applyAxisAngle(p.orbitAxis, ang);
    this.cam.copy(l.pos).add(off);
    const [ty, tp] = this.anglesTo(l.pos.clone().sub(this.cam));
    const k = 1 - Math.exp(-dt * 4);
    this.yaw = this.yawT = this.yaw + (this.wrapTo(ty, this.yaw) - this.yaw) * k;
    this.pitch = this.pitchT = this.pitch + (tp - this.pitch) * k;
    this.vel.set(0, 0, 0);
    this.timeScale = 1;
    if (p.t >= orbitS) {
      this.pilot = null;
      this.markReached(l);
      this.onArrive?.(l.def);
      this.onTravelEnd?.("arrived");
    }
  }

  /** Reduced-motion travel: cut straight to the arrival point. */
  jumpTo(id: string): boolean {
    const l = this.live.get(id);
    if (!l) return false;
    const standoff = this.standoff(l);
    if (l.dist < standoff * 1.15) return false;
    this.cam.copy(this.arrivalPoint(l, standoff));
    this.vel.set(0, 0, 0);
    this.selected = id;
    const [y, p] = this.anglesTo(l.pos.clone().sub(this.cam));
    this.yaw = this.yawT = y;
    this.pitch = this.pitchT = p;
    this.markReached(l);
    this.onArrive?.(l.def);
    this.onTravelEnd?.("arrived");
    return true;
  }


  // ---------- vehicles: closing in, holding alongside ----------

  /** How far to hold from a vehicle so it spans about 42% of the view. */
  private viewDistance(l: Live) {
    const half = (l.def.spanM ?? 10) / 2000;
    const t = Math.tan((this.camera.fov * Math.PI) / 360) * Math.min(1, this.camera.aspect);
    return Math.max(half / (t * 0.42), l.collision * 1.6, 0.012);
  }

  /** The world filling a good part of a vehicle's sky (its planet, close in), if any. */
  private worldBelow(l: Live) {
    let best: { away: THREE.Vector3; radius: number } | null = null;
    for (const o of this.bodies) {
      if (o === l || isCraft(o.def) || o.def.kind === "star") continue;
      const d = l.pos.distanceTo(o.pos);
      const r = Math.asin(Math.min(1, o.outer / Math.max(d, 1e-6)));
      if (r > 0.02 && (!best || r > best.radius)) best = { away: l.pos.clone().sub(o.pos).normalize(), radius: r };
    }
    return best;
  }

  /** Did this frame's path enter a vehicle's 10,000 km? Each draws us in once (or as our target). */
  private checkCapture(start: THREE.Vector3) {
    if (this.mode !== "explore") return;
    const seg = this.cam.clone().sub(start);
    const a = seg.lengthSq();
    let hit: { l: Live; t: number } | null = null;
    for (const l of this.bodies) {
      if (!isCraft(l.def)) continue;
      const id = l.def.id;
      if (this.disarmed.has(id)) {
        if (l.pos.distanceTo(this.cam) > CRAFT_DISARM_KM * 2) this.disarmed.delete(id);
        continue;
      }
      if (this.reached.has(id) && this.selected !== id) continue;
      const m = start.clone().sub(l.pos);
      const b = m.dot(seg), c = m.lengthSq() - CRAFT_CAPTURE_KM ** 2;
      let t: number | null = null;
      if (c <= 0) t = 0;
      else if (a > 0 && b * b - a * c >= 0) {
        const r = (-b - Math.sqrt(b * b - a * c)) / a;
        if (r >= 0 && r <= 1) t = r;
      }
      if (t !== null && (!hit || t < hit.t || (t === hit.t && id === this.selected))) hit = { l, t };
    }
    if (hit) this.beginView(hit.l, start.clone().addScaledVector(seg, hit.t));
  }

  private beginView(l: Live, entry: THREE.Vector3) {
    this.cam.copy(entry);
    this.vel.set(0, 0, 0);
    this.brake = null;
    this.gear = 1;
    this.restHeld = 0;
    this.selected = l.def.id;
    if (!this.records.has(l.def.id)) {
      if (!this.numbers.has(l.def.id)) this.numbers.set(l.def.id, ++this.contactCount);
      this.records.set(l.def.id, "sighted");
      this.saveRecords();
      this.onRecordsChange?.(this.identifiedIds(), [...this.reached]);
    }
    this.ensureMesh(l);
    void l.craft?.load();
    const off = this.cam.clone().sub(l.pos);
    const from = Math.max(off.length(), 1e-6);
    if (off.lengthSq() < 1e-12) this.forward(off).negate();
    const sunDir = this.live.get("sun")!.pos.clone().sub(l.pos).normalize();
    const f = frameCraft(off.normalize(), this.worldBelow(l), sunDir, this.camera.fov, this.camera.aspect);
    const to = this.viewDistance(l);
    // turn its arrays halfway between the Sun and where we will hold, so we see them lit, and
    // tip them 15 degrees out of that plane so foil and mirrors don't flash straight at us
    const hold = f.across.clone().multiplyScalar(Math.cos(f.pitch)).addScaledVector(f.up, Math.sin(f.pitch));
    const half = sunDir.clone().add(hold).normalize();
    const tip = new THREE.Vector3().crossVectors(sunDir, hold);
    l.face = half.addScaledVector(tip.lengthSq() > 1e-8 ? tip.normalize() : f.along, 0.27).normalize();
    this.view = {
      l,
      phase: "zoom",
      from,
      to,
      t: 0,
      k: 0,
      seconds: THREE.MathUtils.clamp(0.28 * Math.abs(Math.log(from / to)), 2.5, 4.5),
      up: f.up,
      across: f.across,
      along: f.along,
      arrive: f.from,
      yaw: 0,
      pitch: f.pitch,
      sweep: { ...f.sweep, phase: 0 },
    };
  }

  /** Leave the vehicle at rest, facing where we look; it won't pull us back as we fly off. */
  private releaseView() {
    if (!this.view) return;
    this.view = null;
    for (const l of this.bodies) if (isCraft(l.def) && l.pos.distanceTo(this.cam) <= CRAFT_DISARM_KM) this.disarmed.add(l.def.id);
    this.vel.set(0, 0, 0);
    this.yawT = this.yaw;
    this.pitchT = this.pitch;
  }

  private craftView(dt: number) {
    const v = this.view!;
    const l = v.l;
    // on a touch screen, pressing and holding (thrust) leaves the vehicle
    if (this.touchHold) {
      this.releaseView();
      return;
    }
    const dist = Math.max(v.to, l.collision * 1.2);
    const dir = new THREE.Vector3();
    const reduced = this.opts.reducedMotion;
    let n = 1;
    if (v.phase === "zoom") {
      // swing round onto the holding side while closing in (distance eased in log space)
      v.t += dt;
      v.k = reduced ? 1 : smooth(v.t / v.seconds);
      n = reduced ? 1 : smooth(v.k * 2 - 1);
      viewDirection(v, v.arrive.yaw * (1 - n), v.arrive.pitch + (v.pitch - v.arrive.pitch) * n, dir);
      this.cam.copy(l.pos).addScaledVector(dir, Math.exp(Math.log(v.from) + (Math.log(dist) - Math.log(v.from)) * v.k));
      if (v.k >= 1) {
        v.phase = "hold";
        v.yaw = 0;
        this.markReached(l);
        this.onArrive?.(l.def);
      }
    } else {
      if (this.inputEnabled) {
        const k = this.keys;
        const yawIn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
        const pitchIn = (k.has("KeyE") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyQ") || k.has("ArrowDown") ? 1 : 0);
        v.yaw += yawIn * LOOK_RATE * dt;
        v.pitch = THREE.MathUtils.clamp(v.pitch + pitchIn * LOOK_RATE * dt, -1.3, 1.3);
      }
      // left alone, the view drifts slowly to and fro across the vehicle
      if (!reduced && !this.drag) {
        const sw = v.sweep;
        const c0 = Math.cos(sw.phase);
        sw.phase += (dt * 0.1) / Math.max(sw.extent, 0.1);
        v.yaw += ((sw.sign * sw.extent) / 2) * (c0 - Math.cos(sw.phase));
      }
      viewDirection(v, v.yaw, v.pitch, dir);
      this.cam.copy(l.pos).addScaledVector(dir, dist);
    }
    // look at it, rolling so that its planet's horizon lies level beneath it
    const [ty, tp] = this.anglesTo(l.pos.clone().sub(this.cam));
    if (v.phase === "zoom") {
      const e = 1 - Math.exp(-dt * LOOK_EASE);
      this.yawT = this.wrapTo(ty, this.yaw);
      this.pitchT = tp;
      this.yaw += (this.yawT - this.yaw) * e;
      this.pitch += (this.pitchT - this.pitch) * e;
    } else {
      this.yaw = this.yawT = this.wrapTo(ty, this.yaw);
      this.pitch = this.pitchT = tp;
    }
    this.roll = n * rollToward(this.yaw, this.pitch, v.up);
    this.vel.set(0, 0, 0);
    this.timeScale = 1;
    this.governed = null;
    this.holding = null;
  }

  // ---------- frame ----------

  private frame(dt: number, time: number, realDt: number) {
    this.time = time;
    // we ride along with the nearest world, so it holds still in the view while we hold still
    const host = this.pilot ? null : this.host;
    const before = host ? host.pos.clone() : null;
    ephemeris(Date.now(), this.eph);
    for (const l of this.bodies) {
      const v = this.eph.get(l.def.id)!;
      l.pos.set(v[0], v[2], -v[1]);
    }
    if (host && before) {
      const shift = host.pos.clone().sub(before);
      this.cam.add(shift);
      this.lastCam.add(shift);
    }

    if (this.tweens.length) {
      for (const tw of this.tweens) {
        tw.t = Math.min(1, tw.t + dt / tw.dur);
        const e = ease(tw.t);
        tw.apply(tw.from.map((f, i) => f + (tw.to[i] - f) * e));
      }
      const finished = this.tweens.filter((t) => t.t >= 1);
      this.tweens = this.tweens.filter((t) => t.t < 1);
      finished.forEach((t) => t.done?.());
    } else if (!this.inputEnabled && !this.opts.reducedMotion && !this.pilot) {
      // idle drift during the opening, a gentle sway once Uranus is framed
      if (this.mode === "opening") {
        this.yaw = this.yawT = this.yaw - dt * 0.008;
      } else if (this.mode === "awaiting") {
        this.yaw = this.yawT = this.baseLook[0] + Math.sin(time * 0.35) * ((0.7 * Math.PI) / 180);
        this.pitch = this.pitchT = this.baseLook[1] + Math.cos(time * 0.28) * ((0.45 * Math.PI) / 180);
      }
    }

    const start = this.cam.clone();
    if (this.pilot) this.autopilot(realDt);
    else if (this.view) this.craftView(realDt);
    else if (this.inputEnabled) {
      // keyboard look, then ease the view toward its target
      const k = this.keys;
      const turn = LOOK_RATE * dt;
      const yawIn = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
      const pitchIn = (k.has("KeyE") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyQ") || k.has("ArrowDown") ? 1 : 0);
      this.yawT += yawIn * turn;
      this.pitchT = THREE.MathUtils.clamp(this.pitchT + pitchIn * turn, -1.55, 1.55);
      const e = 1 - Math.exp(-dt * LOOK_EASE);
      this.yaw += (this.yawT - this.yaw) * e;
      this.pitch += (this.pitchT - this.pitch) * e;
      this.fly(dt);
      // passing within reach of a vehicle closes in on it
      this.checkCapture(start);
    } else {
      this.timeScale = 1;
    }

    // distance flown (for how long scan readings linger) and how lively the view is
    this.travelKm += this.cam.distanceTo(this.lastCam);
    this.lastCam.copy(this.cam);
    const turnRate = Math.hypot(this.yaw - this.lastLook[0], this.pitch - this.lastLook[1]) / Math.max(dt, 1e-3);
    this.lastLook = [this.yaw, this.pitch];
    const lively = Math.min(1, Math.max(turnRate / 0.8, this.vel.length() / 30_000, this.pilot ? 1 : 0));
    this.motion += (lively - this.motion) * (1 - Math.exp(-dt / 0.3));

    // beside a vehicle the view rolls to level its planet's horizon; it rolls back after
    if (!this.view) this.roll += (0 - this.roll) * (1 - Math.exp(-realDt * 3));
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
    // closing in on a vehicle breathes the field of view out a little and back
    const fovGoal = this.fovDeg + (this.view?.phase === "zoom" && !this.opts.reducedMotion ? Math.sin(Math.PI * this.view.k) * 6 : 0);
    if (Math.abs(this.camera.fov - fovGoal) > 0.01) {
      this.camera.fov += (fovGoal - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    this.placeBodies(time, dt);

    // passing dust and travel optics follow the motion
    const reduced = this.opts.reducedMotion;
    this.dust.update(dt, this.vel, this.timeScale, this.camera, reduced);
    this.optics.update(dt, this.vel.length(), reduced, realDt);
    const tu = this.travel.uniforms;
    tu.uPower.value = this.optics.power;
    tu.uBlur.value = this.optics.blur;
    tu.uBrake.value = this.optics.brake;
    tu.uTime.value = this.optics.time;
    tu.uFocusRadius.value = this.optics.focusRadius;
    tu.uFocusFeather.value = this.optics.focusFeather;
    this.grain.uniforms.uTime.value = time;
    this.sky.update(time, this.motion, reduced);

    this.updateCallouts();
    this.buildTrace();
    this.buildNet();
    // a vehicle filling part of the view gets its own soft halo
    let glow = 0;
    for (const l of this.bodies) if (l.craft?.loaded && l.group?.visible) glow = Math.max(glow, smooth((l.px - 20) / 40));
    this.craftGlow.render(this.renderer, this.scene, this.camera, glow);
    this.composer.render(dt);

    this.onFrame?.();

    if (time - this.lastTelemetry > 0.1) {
      this.lastTelemetry = time;
      this.emitTelemetry();
    }
  }

  private placeBodies(time: number, dt = 0) {
    const sun = this.live.get("sun")!;
    this.adaptExposure(sun, dt);
    // while a scan reads the Sun, its glare and disc step back (~0.2 s) so its shape shows
    const reading = this.sunReadingLevel();
    const back = dt > 0 ? 1 - Math.exp(-Math.min(0.25, dt) / 0.2) : 1;
    this.sunBack[0] += (1 - SUN_GLARE_DIM * reading - this.sunBack[0]) * back;
    this.sunBack[1] += (1 - SUN_DISC_DIM * reading - this.sunBack[1]) * back;
    const pxPerRad = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const hours = (Date.now() - Date.UTC(2000, 0, 1, 12)) / 3.6e6;
    const q = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const l of this.bodies) {
      l.rel.copy(l.pos).sub(this.cam);
      l.dist = Math.max(l.rel.length(), 1e-6);
      l.px = (Math.asin(Math.min(1, l.def.radiusKm / l.dist)) || 0) * pxPerRad;
      const craft = isCraft(l.def);
      const star = l.def.kind === "star";
      if (craft && l.dist < CRAFT_RANGE_KM) {
        // a vehicle's model is fetched as we come near and dressed once it is a few pixels across
        prefetchCraft(l.def);
        this.ensureMesh(l);
        if (l.px > 3 || this.view?.l === l) void l.craft?.load();
      }
      // the Sun shows its disc once it is two pixels across; a vehicle its model from 2 px
      const showSurface = star ? l.px >= 1 : l.dist < NEAR_KM && (craft ? !!l.craft?.loaded && l.px > 2 : l.px >= 5);
      if (showSurface) this.ensureMesh(l);
      if (l.group) {
        l.group.visible = showSurface;
        if (showSurface) {
          l.group.position.copy(l.rel).divideScalar(UNIT);
          // orientation: pole up and spinning; small moons face their planet
          if (l.def.pole) {
            q.setFromUnitVectors(yAxis, toScene(eclipticDirection(l.def.pole[0], l.def.pole[1])).normalize());
            const turns = (l.def.spinHours ? hours / l.def.spinHours : 0) + (star ? time / SUN_TURN_S : 0);
            spin.setFromAxisAngle(yAxis, (turns % 1) * Math.PI * 2);
            l.group.quaternion.copy(q).multiply(spin);
          } else if (l.def.parent && !craft) {
            const p = this.live.get(l.def.parent);
            if (p) l.group.lookAt(p.rel.clone().divideScalar(UNIT));
          }
          // the survey map loads once the world is big enough on screen to show it
          if (l.material && !l.mapAsked && l.px >= 18) {
            l.mapAsked = true;
            void attachMap(l.def, l.material, this.opts.mobile ? "1k" : "full");
          }
          if (craft && l.craft) {
            const sd = sun.pos.clone().sub(l.pos);
            const flux = (AU_KM / Math.max(sd.length(), 1)) ** 2;
            sd.normalize();
            if (l.face && l.dist > CRAFT_RANGE_KM / 2) l.face = null;
            orientCraft(l.craft, l.face ?? sd);
            const p = l.def.parent && l.def.parent !== "sun" ? this.live.get(l.def.parent) : null;
            const toCraft = p ? l.pos.clone().sub(p.pos) : null;
            const pd = toCraft ? toCraft.length() : 1;
            lightCraft(l.craft.look, {
              sun: sd,
              flux,
              px: l.px,
              parentDir: toCraft ? toCraft.clone().negate().normalize() : null,
              parentSin: p ? Math.min(0.9999, p.outer / Math.max(pd, 1e-6)) : 0,
              parentColour: p ? new THREE.Color(p.def.palette[1]) : null,
              // how much of the planet's face toward the craft is sunlit
              parentLit: p && toCraft ? 0.5 * (1 + toCraft.normalize().dot(sun.pos.clone().sub(p.pos).normalize())) : 0,
            });
          }
          if (l.material) {
            const sd = sun.pos.clone().sub(l.pos);
            if (sd.lengthSq() < 1) sd.set(0, 1, 0);
            sd.normalize();
            l.material.uniforms.uSun.value.copy(sd);
            l.material.uniforms.uFlux.value = (AU_KM / Math.max(l.pos.distanceTo(sun.pos), 1)) ** 2;
            l.material.uniforms.uTime.value = time;
            if (star) this.dressSun(l, time);
            const ringMat = (l.rings as THREE.Mesh | null)?.material as THREE.ShaderMaterial | undefined;
            if (ringMat?.uniforms?.uSun) ringMat.uniforms.uSun.value.copy(sd);
          }
          if (l.rings) l.rings.visible = l.px > 5;
        }
      }
      // dot: constant angular size; distant planets glint now and then
      const distU = l.dist / UNIT;
      const placeDist = Math.min(distU, FAR_UNITS);
      l.dot.position.copy(l.rel).multiplyScalar(placeDist / distU / UNIT);
      let glint = 0;
      if (l.def.kind === "planet" && l.px < 5 && !this.opts.reducedMotion) {
        const cyc = 17 + l.glintSeed * 12, r = (time + l.glintSeed * cyc) % cyc;
        glint = r < 1.65 ? Math.sin((Math.PI * r) / 1.65) ** 4 : 0;
      }
      const angular = l.def.kind === "star" ? Math.max(0.006, Math.min(0.2, (l.def.radiusKm / l.dist) * 9)) : 0.0042;
      l.dot.scale.setScalar(placeDist * angular * (1 + glint * 0.8));
      const allowed = craft ? this.records.has(l.def.id) && l.dist < 5e6 : l.def.kind === "moon" ? l.dist < 1e9 : l.def.kind === "asteroid" ? l.dist < 5e8 : true;
      l.dot.visible = !showSurface && allowed;
      if (star) {
        // beyond ~1.15 AU the Sun reads as a glare whose size and gain follow the sunlight here
        const g = sunGlareAt(l.dist / AU_KM);
        this.glare.visible = g.fade > 0;
        if (g.fade > 0) {
          l.dot.visible = false;
          this.glare.position.copy(l.dot.position);
          this.glare.quaternion.copy(this.camera.quaternion);
          this.glare.scale.setScalar((placeDist * g.px) / pxPerRad);
          const u = (this.glare.material as THREE.ShaderMaterial).uniforms;
          u.uGain.value = g.gain * g.fade * this.sunBack[0];
          u.uPx.value = g.px;
        }
      }
      (l.dot.material as THREE.SpriteMaterial).opacity = (l.def.kind === "star" ? 1 : 0.8 + glint * 0.2) * (l.def.kind === "moon" ? 0.6 : 1);
    }
  }

  /**
   * The Sun's sphere under a scan: its everyday disc steps back and its surface takes over,
   * wiping in from the top with the reading, with the day's active regions lit; its warm
   * halo gives way to the deep red corona.
   */
  private dressSun(l: Live, time: number) {
    const u = l.material!.uniforms;
    const read = THREE.MathUtils.clamp((1 - this.sunBack[1]) / SUN_DISC_DIM, 0, 1);
    const at = this.acquireAt.get("sun");
    const reveal = at === undefined ? 1 : THREE.MathUtils.clamp((this.time - at) / 0.6, 0, 1);
    u.uDisc.value = SUN_DISC_GAIN * this.sunBack[1];
    u.uRead.value = read;
    u.uReveal.value = reveal;
    u.uDetail.value = l.px;
    const sites = u.uSites.value as THREE.Vector4[];
    const regions = this.activeRegions();
    for (let i = 0; i < sites.length; i++) {
      const r = regions[i];
      if (r) sites[i].set(r.dir.x, r.dir.y, r.dir.z, r.cls === "X" ? 1.1 : r.cls === "M" ? 0.85 : 0.6);
      else sites[i].set(0, 1, 0, 0);
    }
    const parts = l.group!.userData.sun as SunParts | undefined;
    if (parts) {
      const c = (parts.corona.material as THREE.ShaderMaterial).uniforms;
      c.uRead.value = read;
      c.uReveal.value = reveal;
      c.uTime.value = time;
      parts.glows[0].material.opacity = 0.28 * (1 - 0.97 * read);
      parts.glows[1].material.opacity = 0.07 * (1 - 0.97 * read);
    }
  }

  private regionsDay = -1;
  private regions: { dir: THREE.Vector3; cls: "X" | "M" | "C"; seed: number; turn: number }[] = [];

  /** Active regions in the Sun's own frame: in the two sunspot belts, a new set each day. */
  private activeRegions() {
    const day = Math.floor(Date.now() / 86_400_000);
    if (day === this.regionsDay) return this.regions;
    this.regionsDay = day;
    this.regions = [];
    for (let i = 0; i < 5; i++) {
      const h = (k: string) => hash01(`${day}:${i}:${k}`);
      if (i >= 3 && h("on") < 0.5) continue;
      const lat = (h("ns") < 0.5 ? -1 : 1) * (8 + h("lat") * 24) * (Math.PI / 180);
      const lon = h("lon") * Math.PI * 2;
      const cls = h("cls") < 0.08 ? "X" : h("cls") < 0.42 ? "M" : "C";
      this.regions.push({ dir: new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)), cls, seed: h("seed"), turn: h("dir") });
    }
    return this.regions;
  }

  /**
   * Ease the planet exposure (in log space, ~1.2 s) toward what the world filling most of
   * the view needs, so a moon's dark side close by doesn't blow out the planet behind it.
   */
  private adaptExposure(sun: Live, dt: number) {
    let near: Live | null = null;
    let host: Live | null = null;
    for (const l of this.bodies) {
      if (l.def.kind === "star") continue;
      if (!host || l.dist - l.outer < host.dist - host.outer) host = l;
      if (isCraft(l.def)) continue;
      if (!near || l.px > near.px) near = l;
    }
    // beside a vehicle the exposure is set for the vehicle: it is what we came to look at
    if (this.view) near = this.view.l;
    this.host = host;
    if (!near) return;
    const flux = (AU_KM / Math.max(near.pos.distanceTo(sun.pos), 1)) ** 2;
    const mars = this.live.get("mars")!;
    const marsFlux = (AU_KM / Math.max(mars.pos.distanceTo(sun.pos), 1)) ** 2;
    const toSun = sun.pos.clone().sub(near.pos).normalize();
    const toUs = this.cam.clone().sub(near.pos).normalize();
    // a vehicle turns its broad face to the light, so expose it as if seen front-lit
    const target = exposureFor(flux, this.view ? 1 : toUs.dot(toSun), marsFlux);
    const e = this.exposure.value;
    const k = dt > 0 ? 1 - Math.exp(-dt / 1.2) : 1;
    this.exposure.value = Math.exp(Math.log(e) + (Math.log(target) - Math.log(e)) * k);
  }

  // ---------- HUD helpers ----------

  private project(rel: THREE.Vector3, out: { x: number; y: number }) {
    const v = rel.clone().divideScalar(UNIT).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > 0) return false;
    v.copy(rel).divideScalar(UNIT).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return true;
  }

  private updateCallouts() {
    const active = this.scanning;
    let fade = 1;
    if (!active && this.shown) {
      fade = this.lingering(this.shown);
      if (fade <= 0) this.clearShown();
    }
    const pt = { x: 0, y: 0 };
    const list: Callout[] = [];
    for (const l of this.bodies) {
      const id = l.def.id;
      if (l.def.kind === "star") continue;
      const pending = active?.found.get(id);
      if (!pending && !this.shownIds.has(id)) continue;
      const at = this.acquireAt.get(id);
      if (pending && at !== undefined && this.time < at - 0.2) continue;
      if (!this.project(l.rel, pt)) continue;
      if (pt.x < -40 || pt.y < -40 || pt.x > this.width + 40 || pt.y > this.height + 40) continue;
      const known = this.records.get(id) === "scanned" || this.reached.has(id) || pending === "scanned";
      list.push({
        id,
        name: l.def.name.toUpperCase(),
        number: this.numbers.get(id) ?? 0,
        status: known ? KIND_STATUS[l.def.kind] : null,
        distKm: l.dist,
        x: pt.x,
        y: pt.y,
        r: l.px,
        identified: known && (at === undefined || this.time >= at),
        acquiring: at !== undefined && this.time < at,
        since: at === undefined ? 10 : this.time - at,
        hero: l.px > 30,
        target: this.pilot?.id === id ? "travel" : this.selected === id ? "selected" : null,
        kind: l.def.kind,
        alpha: fade,
      });
    }
    list.sort((a, b) => a.distKm - b.distKm);
    const keep = list.slice(0, this.opts.mobile ? 2 : 4);
    const farthest = list[list.length - 1];
    if (farthest && !keep.includes(farthest) && !this.opts.mobile) keep.push(farthest);
    this.callouts = keep;
  }

  private buildTrace() {
    if (!this.shownStars.size || !this.shown) {
      if (this.trace.stars.length) this.trace = { alpha: 0, stars: [], lines: [], patterns: [] };
      return;
    }
    const fade = this.scanning ? 1 : this.lingering(this.shown);
    const pt = { x: 0, y: 0 };
    const v = new THREE.Vector3();
    const screen = new Map<SkyStar, { x: number; y: number }>();
    const stars: Trace["stars"] = [];
    const glitch = this.opts.reducedMotion ? 0 : 12;
    for (const s of this.sky.named) {
      if (!this.shownStars.has(s.name)) continue;
      const at = this.starAt.get(s.name);
      const age = at === undefined ? 10 : this.time - at;
      const alpha = THREE.MathUtils.clamp(age / 0.25, 0, 1);
      if (alpha <= 0) continue;
      v.copy(s.dir).multiplyScalar(SKY_UNITS * UNIT);
      if (!this.project(v, pt)) continue;
      if (pt.x < -60 || pt.y < -60 || pt.x > this.width + 60 || pt.y > this.height + 60) continue;
      screen.set(s, { x: pt.x, y: pt.y });
      // a fresh reading wanders and swells a little before it locks on
      const settle = THREE.MathUtils.clamp(age / 0.5, 0, 1);
      const j = glitch * (1 - settle);
      const tick = Math.floor(this.time * 11);
      const jx = j ? (hash01(s.name + ":x:" + tick) - 0.5) * j * 2 : 0;
      const jy = j ? (hash01(s.name + ":y:" + tick) - 0.5) * j * 2 : 0;
      const box = (s.mag < 1 ? 28 : 14) * (1 + (1 - settle) * 0.6);
      stars.push({ x: pt.x + jx, y: pt.y + jy, name: s.name, box, alpha: alpha * (0.52 + 0.48 * settle), settle });
    }
    const lines: Trace["lines"] = [];
    const patterns: Trace["patterns"] = [];
    for (const f of this.sky.figures) {
      let cx = 0, cy = 0, c = 0, from = -Infinity;
      for (const [a, b] of f.lines) {
        const A = screen.get(a), B = screen.get(b);
        const la = this.starLineAt.get(a.name), lb = this.starLineAt.get(b.name);
        if (A && B && la !== undefined && lb !== undefined) {
          const t0 = Math.max(la, lb);
          lines.push([A.x, A.y, B.x, B.y, THREE.MathUtils.clamp((this.time - t0) / 1.8, 0, 1)]);
          from = Math.max(from, t0);
          cx += A.x + B.x;
          cy += A.y + B.y;
          c += 2;
        }
      }
      if (c >= 4) patterns.push({ x: cx / c, y: cy / c - 22, name: f.name, alpha: THREE.MathUtils.clamp((this.time - from - 1.6) / 0.6, 0, 1) });
    }
    this.trace = { alpha: fade, stars, lines, patterns };
  }

  /**
   * Links between the readings on screen: solid ones join each identified moon to its
   * planet; while a scan runs, about a third of the near-neighbour pairs also get a dashed
   * "scan noise" connection that fades out as the scan completes.
   */
  private buildNet() {
    type Item = { key: string; x: number; y: number; half: number; colour: string; alpha: number; age: number; settle: number; id?: string; parent?: string; kind: string; known: boolean };
    const items: Item[] = [];
    for (const c of this.callouts) {
      const big = c.hero && c.r > 30;
      items.push({
        key: "body:" + c.id, x: c.x, y: c.y, half: big ? c.r * 1.5 : 12,
        colour: c.kind === "moon" ? SCAN_MOON : SCAN_PLANET, alpha: c.alpha, age: c.since,
        settle: THREE.MathUtils.clamp(c.since / 0.5, 0, 1), id: c.id, parent: byId.get(c.id)?.parent, kind: c.kind, known: c.identified,
      });
    }
    for (const s of this.trace.stars) {
      items.push({ key: "star:" + s.name, x: s.x, y: s.y, half: s.box / 2, colour: SCAN_STAR, alpha: s.alpha * this.trace.alpha, age: s.settle * 0.5, settle: s.settle, kind: "star", known: true });
    }
    const out: NetLink[] = [];
    if (items.length < 2) {
      this.net = out;
      return;
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const pairs = new Map<string, [Item, Item]>();
    const add = (a: Item, b: Item) => {
      if (a !== b) pairs.set(a.key < b.key ? a.key + "|" + b.key : b.key + "|" + a.key, a.key < b.key ? [a, b] : [b, a]);
    };
    const planets = new Map(items.filter((i) => i.kind === "planet" && i.id).map((i) => [i.id!, i]));
    for (const i of items) if (i.kind === "moon" && i.parent && planets.has(i.parent)) add(i, planets.get(i.parent)!);
    for (let i = 0; i < items.length; i++) for (let c = 1; c <= Math.min(3, items.length - 1); c++) add(items[i], items[(i + c) % items.length]);
    // dashed scan noise: full through the scan and a beat after it, then fading out
    const age = this.time - this.netFrom;
    const noise = this.opts.reducedMotion ? 0 : 1 - smooth((age - NET_HOLD_S) / NET_FADE_S);
    for (const [key, [a, b]] of pairs) {
      const related = a.known && b.known && ((a.kind === "planet" && b.parent === a.id) || (b.kind === "planet" && a.parent === b.id));
      if (!related && (noise <= 0 || hash01(this.netSeed + ":" + key) >= 0.35)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < Math.max(a.half, b.half) * 2 + 8) continue;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      const t0 = Math.min(0.4, a.half / m), t1 = 1 - Math.min(0.4, b.half / m);
      const grow = related ? Math.min(a.settle, b.settle) : smooth(Math.min(a.age, b.age) / 0.25);
      const te = t0 + (t1 - t0) * grow;
      const alpha = 0.6 * Math.min(a.alpha, b.alpha) * (related ? 1 : noise);
      if (alpha <= 0.01 || te <= t0) continue;
      out.push({ x1: a.x + dx * t0, y1: a.y + dy * t0, x2: a.x + dx * te, y2: a.y + dy * te, colour: a.colour, alpha, dashed: !related });
    }
    this.net = out;
  }

  /** 0..1: how fully a scan reading of the Sun is showing (it must be on screen and near). */
  private sunReadingLevel() {
    const sun = this.live.get("sun")!;
    if (sun.dist > SUN_READING_AU * AU_KM) return 0;
    const pending = this.scanning?.found.has("sun");
    if (!pending && !this.shownIds.has("sun")) return 0;
    const at = this.acquireAt.get("sun");
    if (at !== undefined && this.time < at) return 0;
    const fade = this.scanning ? 1 : this.shown ? this.lingering(this.shown) : 0;
    const c = { x: 0, y: 0 };
    if (fade <= 0 || !this.project(sun.rel, c)) return 0;
    const pad = Math.max(sun.px * 2, 40);
    if (c.x < -pad || c.y < -pad || c.x > this.width + pad || c.y > this.height + pad) return 0;
    const settle = at === undefined ? 1 : THREE.MathUtils.clamp((this.time - at) / 0.6, 0, 1);
    return fade * settle;
  }

  /**
   * The Sun as the last scan read it, in screen space: its true disc and its active regions
   * (seeded by the day) for the HUD to draw flares from. Null when the Sun has no reading on
   * screen.
   */
  sunReading(): SunReading | null {
    const sun = this.live.get("sun")!;
    const pending = this.scanning?.found.has("sun");
    if (!pending && !this.shownIds.has("sun")) return null;
    const at = this.acquireAt.get("sun");
    if (at !== undefined && this.time < at) return null;
    const alpha = this.scanning ? 1 : this.shown ? this.lingering(this.shown) : 0;
    const c = { x: 0, y: 0 };
    if (alpha <= 0 || !this.project(sun.rel, c)) return null;
    const r = sun.px;
    const full = sun.dist <= SUN_READING_AU * AU_KM && !!sun.group;
    const pad = full ? Math.max(r * 6, 160) : 30;
    if (c.x < -pad || c.y < -pad || c.x > this.width + pad || c.y > this.height + pad) return null;
    const reveal = at === undefined ? 1 : THREE.MathUtils.clamp((this.time - at) / 0.6, 0, 1);
    const out: SunReading = { x: c.x, y: c.y, r, alpha, reveal, time: this.time, full, sites: [] };
    if (!full) return out;
    const q = sun.group!.quaternion;
    const toCam = sun.rel.clone().negate().normalize();
    const R = sun.def.radiusKm;
    const n = new THREE.Vector3(), w = new THREE.Vector3(), pt = { x: 0, y: 0 }, pt2 = { x: 0, y: 0 };
    // active regions turn with the Sun
    for (const region of this.activeRegions()) {
      const { cls } = region;
      n.copy(region.dir).applyQuaternion(q);
      const facing = n.dot(toCam);
      if (facing < -0.35) continue;
      if (!this.project(w.copy(sun.rel).addScaledVector(n, R), pt)) continue;
      if (!this.project(w.copy(sun.rel).addScaledVector(n, R * 1.6), pt2)) continue;
      let dx = pt2.x - pt.x, dy = pt2.y - pt.y;
      let len = Math.hypot(dx, dy);
      if (len < 0.5) {
        // facing us head-on: let it stream out from the centre through the site
        dx = pt.x - c.x;
        dy = pt.y - c.y;
        len = Math.hypot(dx, dy);
        if (len < 0.5) {
          const a = region.turn * Math.PI * 2;
          dx = Math.cos(a);
          dy = Math.sin(a);
          len = 1;
        }
      }
      out.sites.push({ x: pt.x, y: pt.y, dx: dx / len, dy: dy / len, facing, cls, seed: region.seed });
    }
    return out;
  }

  /** Where to draw the target chevron: on screen, or pinned to the edge pointing at it. */
  targetGuide() {
    const id = this.selected;
    const l = id ? this.live.get(id) : null;
    if (!l) return null;
    const range = Math.max(0, l.dist - l.def.radiusKm);
    const base = range < 1 ? `${this.name(l.def.id)} · HERE` : `${this.name(l.def.id)} · ${shortKm(range)} KM`;
    const dir = l.rel.clone().divideScalar(UNIT);
    const camSpace = dir.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const front = camSpace.z < 0;
    let x: number, y: number;
    if (front) {
      const p = dir.clone().project(this.camera);
      x = p.x;
      y = -p.y;
    } else {
      x = camSpace.x;
      y = -camSpace.y;
      if (Math.hypot(x, y) < 0.01) {
        x = 0;
        y = 1;
      }
    }
    const o = Math.max(Math.abs(x) / 0.68, Math.abs(y) / 0.62);
    const s = Math.max(front ? 1 : 1e-4, o);
    x /= s;
    y /= s;
    return {
      x: (x * 0.5 + 0.5) * this.width,
      y: (y * 0.5 + 0.5) * this.height,
      angle: (Math.atan2(y, x) * 180) / Math.PI,
      onTarget: front && Math.hypot(x, y) < 0.08,
      label: base + (front ? "" : " · BEHIND"),
    };
  }

  /** Local radar: everything recorded within 1M km, relative to us (ecliptic axes). */
  radarSnapshot() {
    const fwd = toEcliptic(this.forward());
    const vel = this.vel.lengthSq() > 1e-4 ? toEcliptic(this.vel.clone().normalize()) : null;
    let nearest: Live | null = null;
    for (const l of this.bodies) if (l.def.kind !== "star" && (!nearest || l.dist - l.def.radiusKm < nearest.dist - nearest.def.radiusKm)) nearest = l;
    const pts: { id: string; rel: Vec; known: boolean; name: string; selected: boolean; nearest: boolean }[] = [];
    for (const l of this.bodies) {
      if (l.dist > RADAR_KM || !this.records.has(l.def.id)) continue;
      pts.push({
        id: l.def.id,
        rel: toEcliptic(l.rel),
        known: this.records.get(l.def.id) === "scanned" || this.reached.has(l.def.id),
        name: this.name(l.def.id),
        selected: this.selected === l.def.id,
        nearest: nearest === l,
      });
    }
    pts.sort((a, b) => Math.hypot(...b.rel) - Math.hypot(...a.rel));
    const heading = ((Math.atan2(fwd[1], fwd[0]) * 180) / Math.PI + 360) % 360;
    return { range: RADAR_KM, heading, forward: fwd, velocity: vel, pts };
  }

  /** Sun-centred map data: planets and dwarfs, us, and any autopilot route. */
  mapSnapshot() {
    const sun = this.live.get("sun")!.pos;
    const rel = (v: THREE.Vector3): Vec => toEcliptic(v.clone().sub(sun));
    // planets, the Sun, dwarf planets, asteroids, and the probes that orbit the Sun itself
    const bodies = this.bodies
      .filter((l) => l.def.kind !== "moon" && (!isCraft(l.def) || l.def.parent === "sun"))
      .map((l) => ({
        id: l.def.id,
        name: l.def.name.toUpperCase(),
        kind: l.def.kind,
        colour: l.def.palette[1],
        pos: rel(l.pos),
        known: this.records.get(l.def.id) === "scanned" || this.reached.has(l.def.id) || l.def.kind === "star",
      }));
    const route = this.pilot ? [this.cam, ...this.pilot.points].map((p) => rel(p)) : [];
    return { bodies, me: rel(this.cam), forward: toEcliptic(this.forward()), route, selected: this.selected, travelling: this.pilot?.id ?? null };
  }

  // ---------- telemetry ----------

  private emitTelemetry() {
    if (!this.onTelemetry) return;
    const fwd = this.forward();
    const eF = toEcliptic(fwd);
    const heading = ((Math.atan2(eF[1], eF[0]) * 180) / Math.PI + 360) % 360;
    const elevation = (Math.asin(THREE.MathUtils.clamp(eF[2], -1, 1)) * 180) / Math.PI;
    const speed = this.pilot ? Math.min(this.pilot.speed / 100, MAX_SPEED) : this.vel.length();
    const known = (id: string) => this.records.get(id) === "scanned" || this.reached.has(id);

    let nearest: Live | null = null;
    for (const l of this.bodies) if (l.def.kind !== "star" && (!nearest || l.dist - l.def.radiusKm < nearest.dist - nearest.def.radiusKm)) nearest = l;

    // course
    let course = "— · AT REST";
    let courseAlert = true;
    if (this.pilot) {
      course = `AUTOPILOT → ${this.name(this.pilot.id)}`;
      courseAlert = false;
    } else if (this.view) {
      course = this.view.phase === "zoom" ? "CLOSING IN" : "HOLD · ALONGSIDE";
      courseAlert = false;
    } else if (this.holding) {
      course = `${speed < 0.01 ? "HOLD" : "FOLLOWING"} · ${shortKm(this.holding.alt)} KM`;
    } else if (this.governed?.belt) {
      course = "EASING · ASTEROID BELT";
      courseAlert = false;
    } else if (this.governed) {
      course = `EASING · ${shortKm(Math.max(0, this.governed.gapKm))} KM`;
      courseAlert = false;
    } else if (speed > 0.01) {
      const v = this.vel.clone().normalize();
      const off = (v.angleTo(fwd) * 180) / Math.PI;
      if (off < 3) course = "ON VIEW";
      else if (off > 177) course = "REVERSE";
      else {
        const e = toEcliptic(v);
        const h = ((Math.atan2(e[1], e[0]) * 180) / Math.PI + 360) % 360;
        const el = (Math.asin(THREE.MathUtils.clamp(e[2], -1, 1)) * 180) / Math.PI;
        course = `${String(Math.round(h) % 360).padStart(3, "0")}° / ${el >= 0 ? "+" : "−"}${String(Math.abs(Math.round(el))).padStart(2, "0")}°`;
      }
      courseAlert = false;
    }

    // radial motion relative to the nearest body
    let radial = "IDLE";
    if (nearest && speed > 0.01) {
      const along = this.vel.dot(nearest.rel.clone().normalize()) / Math.max(this.vel.length(), 1e-9);
      const who = known(nearest.def.id) ? nearest.def.name.toUpperCase() : "CONTACT";
      radial = Math.abs(along) < 0.1 ? `CROSSING ${who}` : `${along > 0 ? "TOWARD" : "AWAY FROM"} ${who}`;
    }

    // location
    let location: string;
    const fromSun = this.cam.distanceTo(this.live.get("sun")!.pos) / AU_KM;
    // name the place after the nearest world, or a moon we already know
    let host: Live | null = null;
    for (const l of this.bodies) {
      if (isCraft(l.def) || l.def.kind === "star") continue;
      if ((l.def.kind === "moon" || l.def.kind === "asteroid") && !known(l.def.id)) continue;
      if (!host || l.dist - l.def.radiusKm < host.dist - host.def.radiusKm) host = l;
    }
    if (this.view) location = `${this.name(this.view.l.def.id)} PROXIMITY`;
    else if (host && host.dist - host.def.radiusKm < Math.max(2e6, host.def.radiusKm * 80)) {
      location = known(host.def.id) ? `${host.def.name.toUpperCase()} PROXIMITY` : "UNIDENTIFIED SPACE";
    } else if (fromSun < 0.05) location = "SOLAR CORONA";
    else if (fromSun < 1.8) location = "INNER SYSTEM";
    else if (fromSun > 2.1 && fromSun < 3.4) location = "ASTEROID BELT";
    else if (fromSun < 31) location = "OUTER SYSTEM";
    else if (fromSun < 55) location = "KUIPER BELT";
    else if (fromSun < 120) location = "HELIOSPHERE";
    else location = "INTERSTELLAR SPACE";

    // approach panel for the selected target
    let approach: Telemetry["approach"] = null;
    const sel = this.selected ? this.live.get(this.selected) : null;
    const auto = this.autopilotState();
    if (sel) {
      const relV = this.vel.clone().multiplyScalar(this.timeScale);
      const v2 = relV.lengthSq();
      const tStar = v2 > 1e-6 ? sel.rel.dot(relV) / v2 : -1;
      const miss = tStar > 0 ? sel.rel.clone().addScaledVector(relV, -tStar).length() : sel.dist;
      const range = shortKm(Math.max(0, sel.dist - sel.def.radiusKm));
      if (this.pilot && this.pilot.id === sel.def.id) approach = { phase: this.pilot.phase === "orbit" ? "ARRIVING" : "AUTOPILOT", detail: `${range} KM to go.`, urgent: false };
      else if (this.view?.l === sel) approach = { phase: this.view.phase === "zoom" ? "CLOSING IN" : "ALONGSIDE", detail: `${Math.round(sel.dist * 1000).toLocaleString("en-US")} M · drag to look round, W to leave.`, urgent: false };
      else if (this.holding?.id === sel.def.id) approach = { phase: "HOLDING", detail: "Drag to look round; W to move off.", urgent: false };
      else if (speed < 0.01 && sel.dist < this.standoff(sel) * 1.3) approach = { phase: "ARRIVED", detail: `${range} KM · drag to look round, F to scan.`, urgent: false };
      else if (tStar > 0 && speed > 0.01) {
        approach = {
          phase: "CLOSING",
          detail: `Closest approach ${tStar < 60 ? tStar.toFixed(1) + " s" : (tStar / 60).toFixed(1) + " min"} · ${shortKm(Math.max(0, miss - sel.def.radiusKm))} KM`,
          urgent: tStar < 10 && miss < Math.max(1e6, sel.def.radiusKm * 20),
        };
      } else if (speed > 0.01) approach = { phase: "OPENING", detail: `${range} KM · turn back toward it.`, urgent: false };
      else approach = { phase: "TARGET", detail: "Turn toward the arrow to begin.", urgent: false };
    }

    // contacts: every record, grouped by system (a planet, then its moons, then craft around
    // it) nearest system first, the Sun last; named stars after, alphabetically
    const rows: { row: ContactRow; star: number; range: number; home: string; rank: number }[] = [];
    for (const l of this.bodies) {
      if (!this.records.has(l.def.id)) continue;
      const k = known(l.def.id);
      const parent = l.def.kind !== "planet" && l.def.parent ? this.live.get(l.def.parent) : null;
      const host = parent && parent.def.kind !== "star" ? parent : l;
      rows.push({
        row: { id: l.def.id, name: this.name(l.def.id), unidentified: !k, number: this.numbers.get(l.def.id) ?? null, distKm: l.dist, star: false },
        star: l.def.kind === "star" ? 1 : 0,
        range: host.dist,
        home: host.def.id,
        rank: host === l ? 0 : l.def.kind === "moon" ? 1 : 2,
      });
    }
    rows.sort((a, b) => a.star - b.star || a.range - b.range || a.home.localeCompare(b.home) || a.rank - b.rank || (a.row.distKm ?? 0) - (b.row.distKm ?? 0));
    const contacts: ContactRow[] = rows.map((r) => r.row);
    const stars = this.sky.named.filter((s) => this.skyRecords.has(s.name)).sort((a, b) => a.name.localeCompare(b.name));
    for (const s of stars) contacts.push({ id: `star:${s.name}`, name: s.name, unidentified: false, number: null, distKm: null, star: true });

    this.onTelemetry({
      speed,
      limitText: this.governed ? `${fmt(this.governed.limit)} KM/S LIMIT` : `${fmt(MAX_SPEED)} KM/S MAX`,
      thrustLevel: this.pilot ? (this.pilot.phase === "fly" ? 1 : 0.3) : this.thrustLevel,
      thrustText: this.pilot ? "AUTOPILOT" : this.thrustText,
      radial,
      timeScale: this.timeScale,
      heading,
      elevation,
      course,
      courseAlert,
      location,
      contacts,
      autopilot: auto,
      approach,
      hold: this.view ? this.name(this.view.l.def.id) : this.holding ? this.name(this.holding.id) : null,
      scanStage: this.nextStage(fwd),
    });
  }
}
