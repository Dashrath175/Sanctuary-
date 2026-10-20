import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BodyDef } from "@/lib/solar";

// Spacecraft. Ten of them are NASA's public-domain models (prepared by scripts/prep-craft.mjs:
// metres, centred, meshopt-packed, with their feature edges as a line primitive), loaded only
// when you come close to one. Juice and Psyche have no public model, so they are built here
// from simple parts at the real proportions. All are drawn in the survey style: the model's
// own colours pulled toward the craft palette, sunlit with a little gloss, then the light
// palette for a rim, iso-lines of the lighting, a stipple, and bright outlines. Orientation
// is illustrative.

/** render layer the craft glow pass draws */
export const GLOW_LAYER = 2;

export const CRAFT_DARK = "#1f4c70";
export const CRAFT_LIGHT = "#8fdcff";

/** model file for each vehicle (Voyager 1 and 2 share one) */
const MODEL: Record<string, string> = {
  iss: "iss",
  jwst: "jwst",
  mro: "mro",
  odyssey: "odyssey",
  juno: "juno",
  dawn: "dawn",
  "stereo-a": "stereo",
  "new-horizons": "new-horizons",
  "voyager-2": "voyager",
  // the story ships (Sketchfab, CC BY 4.0: see README)
  "derelict-1": "kestrel",
  "derelict-2": "halcyon",
  // our own ship, filmed in the cutscenes
  vessel: "vessel",
};

/**
 * Lighting shared by every part of one craft: sun direction and sunlight here (relative to
 * 1 AU), the planet below (direction and the light it reflects), and the shared planet exposure.
 */
export class CraftLight {
  sun = { value: new THREE.Vector3(0, 1, 0) };
  flux = { value: 1 };
  parent = { value: new THREE.Vector3(0, -1, 0) };
  planet = { value: new THREE.Color(0, 0, 0) };
  ambient = { value: 0.0025 };
  /** outlines fade in as the craft grows on screen */
  edges = { value: 1 };
  edgeWeight = { value: 1 };
  dark = { value: new THREE.Color(CRAFT_DARK) };
  light = { value: new THREE.Color(CRAFT_LIGHT) };
  constructor(public exposure: { value: number }) {}
}

type Finish = { metal: number; rough: number; spec: number; kind: string };

// how a part's material name reads: foil glints, panels gleam, blankets stay matte
const FINISHES: [RegExp, Finish][] = [
  [/lens|glass/i, { metal: 0, rough: 0.05, spec: 1.5, kind: "glass" }],
  [/mirror|chrome|reflector/i, { metal: 1, rough: 0.07, spec: 1, kind: "mirror" }],
  [/gold|bronze|brass|copper|kapton/i, { metal: 1, rough: 0.3, spec: 1, kind: "gold" }],
  [/silver|alum|foil|metal|gunmetal/i, { metal: 1, rough: 0.26, spec: 1, kind: "foil" }],
  [/solar|panel|array|cell/i, { metal: 0, rough: 0.16, spec: 1.6, kind: "panel" }],
  [/krinkle|blanket|mli|black/i, { metal: 0.45, rough: 0.5, spec: 1, kind: "blanket" }],
  [/white|paint|default|lambert|blinn/i, { metal: 0, rough: 0.62, spec: 1, kind: "paint" }],
];

function finishFor(name: string, metalness: number, roughness: number, mapped: boolean): Finish {
  if (mapped || metalness > 0) return { metal: Math.min(1, metalness), rough: THREE.MathUtils.clamp(roughness, 0.04, 1), spec: 1, kind: "file" };
  const hit = FINISHES.find(([re]) => re.test(name));
  return hit ? hit[1] : { metal: 0, rough: THREE.MathUtils.clamp(roughness, 0.35, 0.9), spec: 1, kind: "plain" };
}

const surfaceVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vTone;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    vUv = uv;
    vObj = position;
    #ifdef USE_COLOR
      vTone = color;
    #else
      vTone = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const surfaceFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uDark, uLight, uSun, uParent, uPlanet, uBase;
  uniform float uFlux, uExposure, uAmbient, uMetal, uRough, uSpec, uGrain, uHasMap, uAlphaTest, uOpacity;
  uniform sampler2D uMap;
  uniform vec2 uMapSize;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vTone;
  // GAIN is a little above the survey's 1.8: our bloom only lifts real highlights, so the craft
  // carries its own glow
  const float TINT = 0.45, GAIN = 1.8, FILL = 0.55, GLINT = 2.5, RIM = 0.45, CONTOUR = 0.3, STIPPLE = 0.15, DENSITY = 0.12;
  const float LINE = 1.05, SURFACE = 1.4, GRID = 0.22, FLOOR = 0.2, LIT = 0.43;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // antialiased iso-lines of t, a lines per unit
  float iso(float t, float a) {
    float n = t * a;
    float w = max(fwidth(n), 1e-5);
    float r = abs(fract(n - 0.5) - 0.5) / w;
    float s = LINE * 0.35;
    return (1.0 - smoothstep(s, s + 1.0, r)) * (1.0 - smoothstep(0.18, 0.4, w));
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec4 tex = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    if (tex.a * uOpacity < uAlphaTest) discard;
    vec3 k = uBase * vTone * tex.rgb;
    float b = luma(k);
    vec3 M = mix(k, mix(uDark, uLight, pow(b, 0.8)), TINT);
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vV);
    float O = dot(N, uSun);
    float P = dot(N, uParent);
    vec3 lit = vec3(max(O, 0.0) * uFlux) + uPlanet * max(P, 0.0) + uAmbient * uFlux;
    vec3 fill = M * (1.0 - 0.4 * uMetal) * lit * FILL;
    // a small glint off foil and panels
    vec3 f0 = mix(vec3(0.04 * uSpec), M, uMetal);
    vec3 H = normalize(uSun + V);
    vec3 fr = f0 + (1.0 - f0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    float r2 = uRough * uRough;
    float sp = min(2.0 / max(r2 * r2, 1e-4) - 2.0, 4000.0);
    vec3 glint = fr * min((sp + 2.0) / 8.0 * pow(max(dot(N, H), 0.0), sp), GLINT) * max(O, 0.0) * uFlux;
    // survey marks in the light palette: rim, iso-lines of the light (and of the texture), stipple
    float rim = smoothstep(0.7, 0.97, 1.0 - abs(dot(N, V)));
    float contour = max(iso(O * 0.5 + 0.5, 7.0), uHasMap > 0.5 ? iso(b, 9.0) * 0.5 : 0.0) * GRID;
    float edge = 0.0;
    if (uHasMap > 0.5) {
      vec2 t = 1.0 / uMapSize;
      edge = min((length(k - uBase * vTone * texture2D(uMap, vUv + vec2(t.x, 0.0)).rgb) + length(k - uBase * vTone * texture2D(uMap, vUv + vec2(0.0, t.y)).rgb)) * 0.8, 0.3);
    }
    float g = hash(floor(vObj.xy * uGrain) + floor(vObj.z * uGrain) * 7.13);
    float dens = clamp(luma(lit) * uExposure * 2.0, 0.0, 1.0);
    float dots = smoothstep(g - 0.05, g + 0.05, dens * DENSITY + edge);
    vec3 marks = uLight * (rim * RIM + contour * CONTOUR + dots * STIPPLE * SURFACE) * (LINE * 0.4 + 0.6);
    float markLit = uFlux * smoothstep(-0.15, 0.45, O) + min(uFlux, LIT / uExposure) * FLOOR + luma(uPlanet) * smoothstep(-0.15, 0.45, P) + uAmbient * uFlux;
    vec3 col = (fill + glint + marks * markLit) * uExposure * GAIN;
    gl_FragColor = vec4(col, tex.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const edgeVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNW;
  varying float vSharp;
  void main() {
    vNW = mat3(modelMatrix) * normal;
    // the mean of two face normals is short across a sharp fold
    vSharp = length(normal) < 0.75 ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    mv.xyz *= 0.9975; // just in front of the faces it outlines
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const edgeFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uLight, uSun, uParent, uPlanet;
  uniform float uFlux, uExposure, uAmbient, uEdges, uEdgeWeight;
  varying vec3 vNW;
  varying float vSharp;
  void main() {
    #include <logdepthbuf_fragment>
    float l = length(vNW);
    vec3 n = l > 1e-6 ? vNW / l : vec3(0.0);
    float d = dot(n, uSun), p = dot(n, uParent);
    float w = vSharp > 0.5 || l < 1e-6 ? max(abs(d), l < 1e-6 ? 0.6 : 0.0) : smoothstep(-0.2, 0.4, d);
    float q = vSharp > 0.5 || l < 1e-6 ? abs(p) : smoothstep(-0.2, 0.4, p);
    float lit = uFlux * w + min(uFlux, 0.43 / uExposure) * 0.2 + dot(uPlanet, vec3(0.333)) * q + uAmbient * uFlux;
    // outlines run bright enough for the bloom to give them a halo
    gl_FragColor = vec4(uLight * lit * 1.05 * 0.8 * uEdges * uEdgeWeight * uExposure * 3.5, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function surfaceMaterial(look: CraftLight, src: THREE.MeshStandardMaterial | null, geometry: THREE.BufferGeometry, tone?: number) {
  const map = src?.map ?? null;
  const name = src?.name ?? "";
  const base = src?.color?.clone() ?? new THREE.Color(1, 1, 1);
  const fin = finishFor(name, src?.metalness ?? 0, src?.roughness ?? 0.5, !!(src?.metalnessMap || src?.roughnessMap || src?.normalMap));
  // a plain light-grey solar panel without a texture is really a dark cell face
  if (fin.kind === "panel" && !map && [base.r, base.g, base.b].every((c) => Math.abs(c - 0.8) < 0.001)) base.multiplyScalar(0.2);
  if (tone !== undefined) base.multiplyScalar(tone);
  geometry.computeBoundingSphere();
  const img = map?.image as { width?: number; height?: number } | undefined;
  const mat = new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: {
      uDark: look.dark,
      uLight: look.light,
      uSun: look.sun,
      uParent: look.parent,
      uPlanet: look.planet,
      uFlux: look.flux,
      uExposure: look.exposure,
      uAmbient: look.ambient,
      uBase: { value: base },
      uMetal: { value: fin.metal },
      uRough: { value: fin.rough },
      uSpec: { value: fin.spec },
      // one stipple cell per ~1/300 of the part's size
      uGrain: { value: 300 / Math.max(geometry.boundingSphere?.radius ?? 1, 1e-9) },
      uMap: { value: map },
      uMapSize: { value: new THREE.Vector2(img?.width ?? 512, img?.height ?? 512) },
      uHasMap: { value: map ? 1 : 0 },
      uAlphaTest: { value: src?.alphaTest ?? 0 },
      uOpacity: { value: src?.opacity ?? 1 },
    },
    side: src?.side ?? THREE.DoubleSide,
    transparent: !!src?.transparent,
    depthWrite: src?.depthWrite ?? true,
    vertexColors: !!geometry.attributes.color && geometry.attributes.color.itemSize === 3,
  });
  return mat;
}

function edgeMaterial(look: CraftLight) {
  return new THREE.ShaderMaterial({
    vertexShader: edgeVertex,
    fragmentShader: edgeFragment,
    uniforms: {
      uLight: look.light,
      uSun: look.sun,
      uParent: look.parent,
      uPlanet: look.planet,
      uFlux: look.flux,
      uExposure: look.exposure,
      uAmbient: look.ambient,
      uEdges: look.edges,
      uEdgeWeight: look.edgeWeight,
    },
    transparent: true,
    depthWrite: false,
  });
}

// ---------- NASA models ----------

let loader: GLTFLoader | null = null;
const files = new Map<string, Promise<THREE.Group>>();

function loadFile(name: string) {
  let p = files.get(name);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(`/craft/${name}.glb`).then((g) => g.scene);
    p.catch(() => files.delete(name));
    files.set(name, p);
  }
  return p;
}

/** Start fetching a vehicle's model ahead of time (no-op for the built ones). */
export function prefetchCraft(body: BodyDef) {
  const f = MODEL[body.id];
  if (f && !files.has(f)) void loadFile(f).catch(() => undefined);
}

function dress(scene: THREE.Group, look: CraftLight) {
  const root = scene.clone(true);
  let segments = 0;
  root.traverse((o) => {
    if ((o as THREE.LineSegments).isLineSegments) {
      const l = o as THREE.LineSegments;
      l.material = edgeMaterial(look);
      l.frustumCulled = false;
      l.raycast = () => {};
      l.layers.enable(GLOW_LAYER);
      segments += l.geometry.attributes.position.count / 2;
    } else if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      const src = m.material as THREE.MeshStandardMaterial;
      // fully transparent placeholders stay hidden
      if (src.opacity === 0 && (src.transparent || src.alphaTest > 0)) m.visible = false;
      else m.material = surfaceMaterial(look, src, m.geometry);
      m.frustumCulled = false;
      m.layers.enable(GLOW_LAYER);
    }
  });
  look.edgeWeight.value = THREE.MathUtils.clamp(Math.sqrt(15_000 / Math.max(segments, 1)), 0.5, 1.2);
  return root;
}

export type CraftModel = {
  group: THREE.Group;
  look: CraftLight;
  ready: Promise<boolean>;
  loaded: boolean;
  load: () => Promise<boolean>;
  /** the model's broadest face (its arrays, shield or dish) and its long axis, in model space */
  axes: { face: THREE.Vector3; long: THREE.Vector3 } | null;
};

/**
 * The normal shared by most of a model's surface area (the solar arrays, Webb's sunshield, a
 * big dish) and its longest axis across it: real vehicles turn that face to the Sun.
 */
function faceAxes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const rel = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  // area-weighted second moment of the face normals
  const m = [0, 0, 0, 0, 0, 0];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.LineSegments).isLineSegments || !mesh.visible) return;
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(rel);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(rel);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(rel);
      n.subVectors(b, a).cross(c.sub(a));
      const area = n.length();
      if (area < 1e-12) continue;
      const x = n.x / area, y = n.y / area, z = n.z / area;
      m[0] += area * x * x;
      m[1] += area * y * y;
      m[2] += area * z * z;
      m[3] += area * x * y;
      m[4] += area * x * z;
      m[5] += area * y * z;
    }
  });
  const face = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  for (let k = 0; k < 48; k++) {
    face.set(m[0] * face.x + m[3] * face.y + m[4] * face.z, m[3] * face.x + m[1] * face.y + m[5] * face.z, m[4] * face.x + m[5] * face.y + m[2] * face.z);
    if (face.lengthSq() < 1e-20) face.set(0, 1, 0);
    face.normalize();
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const order = (["x", "y", "z"] as const).slice().sort((p, q) => size[q] - size[p]);
  let long = new THREE.Vector3();
  for (const axis of order) {
    long = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0).addScaledVector(face, -face[axis]);
    if (long.lengthSq() > 0.05) break;
  }
  return { face, long: long.normalize() };
}

/** Turn a vehicle's broad face to the Sun, its long axis level with the ecliptic. */
export function orientCraft(model: CraftModel, sun: THREE.Vector3) {
  const ax = model.axes;
  if (!ax) return;
  const A = sun.clone().normalize();
  const B = new THREE.Vector3().crossVectors(A, new THREE.Vector3(0, 1, 0));
  if (B.lengthSq() < 1e-6) B.set(1, 0, 0);
  B.normalize();
  const world = new THREE.Matrix4().makeBasis(A, B, new THREE.Vector3().crossVectors(A, B));
  const local = new THREE.Matrix4().makeBasis(ax.face, ax.long, new THREE.Vector3().crossVectors(ax.face, ax.long));
  model.group.quaternion.setFromRotationMatrix(world.multiply(local.transpose()));
}

/**
 * A vehicle in scene units (`unitKm` km each), centred on it. The group is empty until the
 * model arrives (`ready`); call `load` (or pass `eager`) to fetch it.
 */
export function craftModel(body: BodyDef, unitKm: number, exposure: { value: number }, eager = false) {
  const look = new CraftLight(exposure);
  const group = new THREE.Group();
  group.scale.setScalar(1 / 1000 / unitKm);
  const model: CraftModel = {
    group,
    look,
    loaded: false,
    ready: Promise.resolve(false),
    load: () => model.ready,
    axes: null,
  };
  const file = MODEL[body.id];
  let started: Promise<boolean> | null = null;
  const start = () => {
    if (started) return started;
    started = (file ? loadFile(file).then((s) => dress(s, look)) : Promise.resolve(buildKit(body, look)))
      .then((root) => {
        model.axes = faceAxes(root);
        group.add(root);
        model.loaded = true;
        return true;
      })
      .catch(() => {
        started = null;
        return false;
      });
    model.ready = started;
    return started;
  };
  model.load = start;
  if (eager || !file) void start();
  return model;
}

// ---------- vehicles with no public model, built from parts ----------

type Vec3 = [number, number, number];
const GOLD = 0.62, WHITE = 0.85;
const TONE_GOLD = new THREE.Color(0.78, 0.55, 0.16);
const TONE_PANEL = new THREE.Color(0.18, 0.24, 0.6);

class Kit {
  fills: THREE.BufferGeometry[] = [];
  lines: number[] = [];

  private place(g: THREE.BufferGeometry, at: Vec3, rot: Vec3, tone: THREE.Color) {
    g.deleteAttribute("uv");
    g.rotateX(rot[0]);
    g.rotateY(rot[1]);
    g.rotateZ(rot[2]);
    g.translate(...at);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([tone.r, tone.g, tone.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }
  private edges(g: THREE.BufferGeometry, angle = 25) {
    const e = new THREE.EdgesGeometry(g, angle);
    const p = e.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) this.lines.push(p[i]);
    e.dispose();
  }
  line(a: Vec3, b: Vec3) {
    this.lines.push(...a, ...b);
  }
  box(size: Vec3, at: Vec3, rot: Vec3 = [0, 0, 0], tone = TONE_GOLD) {
    const g = this.place(new THREE.BoxGeometry(...size), at, rot, tone);
    this.fills.push(g);
    this.edges(g);
  }
  cyl(r: number, len: number, at: Vec3, rot: Vec3 = [0, 0, 0], sides = 14, tone = new THREE.Color(WHITE, WHITE, WHITE)) {
    const g = this.place(new THREE.CylinderGeometry(r, r, len, sides, 1), at, rot, tone);
    this.fills.push(g);
    this.edges(g, sides <= 10 ? 20 : 40);
  }
  /** parabolic dish opening toward +Y before rotation */
  dish(r: number, depth: number, at: Vec3, rot: Vec3 = [0, 0, 0]) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const x = (i / 8) * r;
      pts.push(new THREE.Vector2(x, (depth * x * x) / (r * r)));
    }
    this.fills.push(this.place(new THREE.LatheGeometry(pts, 32), at, rot, new THREE.Color(WHITE, WHITE, WHITE)));
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).setPosition(...at);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m).toArray() as Vec3;
    for (const k of [1, 0.5]) {
      for (let i = 0; i < 32; i++) {
        const a0 = (i / 32) * Math.PI * 2, a1 = ((i + 1) / 32) * Math.PI * 2;
        this.line(v(Math.cos(a0) * r * k, depth * k * k, Math.sin(a0) * r * k), v(Math.cos(a1) * r * k, depth * k * k, Math.sin(a1) * r * k));
      }
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.line(v(Math.cos(a) * r, depth, Math.sin(a) * r), v(0, depth * 1.6, 0)); // feed struts
    }
  }
  /** a flat solar panel w (X) × h (Z) with its cell grid */
  panel(w: number, h: number, at: Vec3, rot: Vec3 = [0, 0, 0], cols = 4, rows = 2) {
    const g = this.place(new THREE.BoxGeometry(w, Math.max(0.04, Math.min(w, h) * 0.015), h), at, rot, TONE_PANEL);
    this.fills.push(g);
    this.edges(g);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).setPosition(...at);
    const v = (x: number, z: number) => new THREE.Vector3(x, 0.03, z).applyMatrix4(m).toArray() as Vec3;
    for (let i = 1; i < cols; i++) {
      const x = -w / 2 + (w * i) / cols;
      this.line(v(x, -h / 2), v(x, h / 2));
    }
    for (let j = 1; j < rows; j++) {
      const z = -h / 2 + (h * j) / rows;
      this.line(v(-w / 2, z), v(w / 2, z));
    }
  }
  boom(a: Vec3, b: Vec3, r = 0.06) {
    const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
    g.deleteAttribute("uv");
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const n = g.attributes.position.count;
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(WHITE * 0.9), 3));
    this.fills.push(g);
    this.line(a, b);
  }

  build(look: CraftLight) {
    const group = new THREE.Group();
    const fill = mergeGeometries(this.fills.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (fill) {
      fill.computeVertexNormals();
      const mesh = new THREE.Mesh(fill, surfaceMaterial(look, null, fill));
      mesh.layers.enable(GLOW_LAYER);
      group.add(mesh);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(this.lines, 3));
    // no face normals for hand-drawn lines: they glow evenly
    lg.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(this.lines.length), 3));
    const lines = new THREE.LineSegments(lg, edgeMaterial(look));
    lines.frustumCulled = false;
    lines.layers.enable(GLOW_LAYER);
    group.add(lines);
    look.edgeWeight.value = THREE.MathUtils.clamp(Math.sqrt(15_000 / Math.max(this.lines.length / 6, 1)), 0.5, 1.2);
    for (const g of this.fills) g.dispose();
    return group;
  }
}

function juice(k: Kit) {
  k.box([2.5, 4.1, 2.2], [0, 0, 0]);
  k.dish(1.25, 0.42, [0, 2.1, 0]);
  k.cyl(0.5, 0.6, [0.6, 2.25, 0.7], [0, 0, 0], 12); // medium-gain antenna
  for (const s of [-1, 1]) {
    // each wing is a cross of five panels on a short yoke
    k.boom([s * 1.25, 0, 0], [s * 2.3, 0, 0], 0.08);
    const cx = s * 5.2;
    k.panel(2.5, 3.5, [cx, 0, 0], [0, 0, 0], 4, 6);
    k.panel(2.5, 3.5, [cx + s * 2.6, 0, 0], [0, 0, 0], 4, 6);
    k.panel(2.5, 3.5, [cx - s * 2.6, 0, 0], [0, 0, 0], 4, 6);
    for (const z of [-1, 1]) k.panel(2.5, 3.5, [cx, 0, z * 3.6], [0, 0, 0], 4, 6);
  }
  k.boom([0, -2.05, 0], [0, -12.6, 0], 0.05); // magnetometer boom
  k.box([0.25, 0.25, 0.25], [0, -12.7, 0], [0, 0, 0], new THREE.Color(WHITE, WHITE, WHITE));
  k.boom([-0.9, 1.4, 1.1], [-0.9, 1.4, 9.1], 0.04); // RIME radar antenna
  k.boom([-0.9, 1.4, -1.1], [-0.9, 1.4, -9.1], 0.04);
  for (const a of [0.6, 2.1, 3.6]) k.boom([0.9 * Math.cos(a), 1.9, 0.9 * Math.sin(a)], [3.4 * Math.cos(a), 3.2, 3.4 * Math.sin(a)], 0.025); // radio-wave probes
  k.cyl(0.35, 0.5, [0, -2.3, 0], [0, 0, 0], 10, new THREE.Color(GOLD, GOLD, GOLD));
}

function psycheCraft(k: Kit) {
  k.box([2.1, 2.5, 2.1], [0, 0, 0]);
  k.dish(1.0, 0.32, [0, 1.3, 0]);
  for (const s of [-1, 1]) {
    // X-shaped wings: five panels in a cross, turned 45 degrees
    k.boom([s * 1.05, 0, 0], [s * 2.4, 0, 0], 0.07);
    const cx = s * 7.4;
    k.panel(3.3, 3.3, [cx, 0, 0], [0, Math.PI / 4, 0], 5, 5);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) k.panel(3.3, 3.3, [cx + dx * 2.35, 0, dz * 2.35], [0, Math.PI / 4, 0], 5, 5);
  }
  k.cyl(0.42, 0.55, [0, -1.5, 0], [0, 0, 0], 12, new THREE.Color(0.4, 0.4, 0.42)); // Hall thruster
  k.boom([0.8, 1.25, 0.8], [1.8, 3.2, 1.8], 0.05); // magnetometer boom
  k.box([0.6, 0.5, 0.5], [-0.75, 1.45, -0.5], [0, 0, 0], new THREE.Color(WHITE, WHITE, WHITE)); // multispectral imager
}

// relics from the story: simple, slightly broken shapes
const GREY = new THREE.Color(0.55, 0.56, 0.6);

function commandRelay(k: Kit) {
  k.box([2.4, 3, 2.4], [0, 0, 0]);
  k.dish(2.6, 0.8, [0, 1.9, 0], [0.35, 0, 0.2]);
  k.boom([1.2, 0, 0], [2.6, 0, 0], 0.08);
  k.panel(5, 2, [5.1, 0, 0], [0, 0, 0], 5, 2);
  // the other wing hangs off at an angle, half torn away
  k.boom([-1.2, 0, 0], [-2.4, -0.3, 0.2], 0.08);
  k.panel(3, 2, [-3.9, -0.9, 0.5], [0.5, 0.2, -0.6], 3, 2);
}

function archiveBuoy(k: Kit) {
  k.cyl(1.1, 3.6, [0, 0, 0], [0, 0, 0], 12, GREY);
  k.cyl(1.25, 0.3, [0, 1.85, 0], [0, 0, 0], 12);
  k.dish(0.9, 0.3, [0, 2.2, 0]);
  for (const a of [0, 2.1, 4.2]) k.boom([Math.cos(a) * 1.1, -1.2, Math.sin(a) * 1.1], [Math.cos(a) * 2.8, -2.2, Math.sin(a) * 2.8], 0.05);
}

function listeningRelay(k: Kit) {
  k.box([3, 2.4, 3], [0, 0, 0]);
  k.dish(5.5, 1.6, [0, 2.6, 0], [0.2, 0, 0]);
  k.boom([0, 2.6, 0], [0, 6.4, 0.6], 0.07);
  k.boom([0, -1.2, 0], [0, -8, 0], 0.05);
  for (const s of [-1, 1]) {
    k.boom([s * 1.5, 0, 0], [s * 3, 0, 0], 0.07);
    k.panel(6, 2.4, [s * 6, 0, 0], [0, 0, 0], 6, 2);
  }
}

function droneWreck(k: Kit) {
  // the fuselage and one wing, with the rest drifting apart
  k.box([0.9, 0.6, 5], [0, 0, 0], [0, 0, 0.15], GREY);
  k.box([3.6, 0.08, 1.8], [1.8, 0, -0.6], [0, -0.35, 0.1], GREY);
  k.box([2.8, 0.08, 1.5], [-3.4, 0.8, 1.2], [0.4, 0.5, -0.3], GREY);
  k.cyl(0.35, 1.2, [0.2, -0.1, 3], [Math.PI / 2, 0, 0], 8);
  k.box([0.7, 0.5, 1.4], [-1.6, -1.4, -3.2], [0.8, 0.3, 0.5], GREY);
  k.box([0.4, 0.4, 0.6], [2.4, 1.6, 2.6], [0.3, 1.1, 0.2]);
}

function surveyProbe(k: Kit) {
  k.cyl(1.0, 2.2, [0, 0, 0], [0, 0, 0], 12, GREY);
  k.dish(3.2, 0.9, [0, 1.6, 0], [0.15, 0, 0]); // high-gain dish, knocked a little off true
  k.boom([0, -1.1, 0], [0, -4.5, 0], 0.05); // magnetometer boom
  for (const s of [-1, 1]) {
    k.boom([s * 1.0, 0, 0], [s * 1.8, 0, 0], 0.06);
    k.panel(3.4, 1.4, [s * 3.6, 0, 0], [0, 0, 0], 4, 2);
  }
}

function medicalCapsule(k: Kit) {
  k.cyl(1.3, 2.6, [0, 0, 0], [0, 0, 0], 16, new THREE.Color(WHITE, WHITE, WHITE));
  k.cyl(0.7, 0.9, [0, 1.75, 0], [0, 0, 0], 12, GREY);
  k.cyl(1.35, 0.25, [0, -1.4, 0], [0, 0, 0], 16);
  for (const s of [-1, 1]) k.panel(1.6, 1, [s * 2.3, -0.4, 0], [0, 0, 0], 2, 1);
}

// Stand-ins for the two story ships; a model file in MODEL replaces either one.
function expeditionShip(k: Kit) {
  k.cyl(2.2, 26, [0, 0, 0], [Math.PI / 2, 0, 0], 16, GREY);
  k.cyl(7, 1.6, [0, 0, -4], [Math.PI / 2, 0, 0], 24); // habitat ring
  k.box([3.2, 3.2, 6], [0, 0, 14], [0, 0, 0], GREY); // command module
  k.cyl(2.8, 3.2, [0, 0, -14.5], [Math.PI / 2, 0, 0], 12); // drive
  k.dish(2.4, 0.7, [0, 3, 10], [-0.6, 0, 0]);
  k.boom([2.2, 0, 4], [9, 0, 4], 0.12);
  k.panel(8, 3, [13, 0, 4], [0, 0, 0], 6, 2);
  // the far wing is torn off and the hull is split behind the ring
  k.boom([-2.2, 0, 4], [-5, 1.5, 4.5], 0.12);
  k.panel(4, 3, [-7.2, 2.4, 5.4], [0.6, 0.3, 0.9], 3, 2);
  k.box([1.4, 4.6, 2.2], [1.6, 1.4, -7.5], [0.4, 0.2, 0.7], GREY);
}

function evacuationShip(k: Kit) {
  k.cyl(7, 60, [0, 0, 0], [Math.PI / 2, 0, 0], 20, new THREE.Color(WHITE, WHITE, WHITE));
  for (const z of [-16, 0, 16]) k.cyl(16, 3.5, [0, 0, z], [Math.PI / 2, 0, 0], 28); // accommodation rings
  k.cyl(9, 8, [0, 0, -34], [Math.PI / 2, 0, 0], 16, GREY); // drive section
  k.box([9, 7, 12], [0, 0, 34], [0, 0, 0], new THREE.Color(WHITE, WHITE, WHITE)); // bridge
  for (const s of [-1, 1]) {
    k.boom([s * 7, 0, -24], [s * 18, 0, -24], 0.3);
    k.panel(22, 7, [s * 30, 0, -24], [0, 0, 0], 8, 3);
  }
  k.dish(4.5, 1.4, [0, 9, 26], [-0.4, 0, 0]);
}

const BUILT: Record<string, (k: Kit) => void> = {
  "derelict-1": expeditionShip,
  "derelict-2": evacuationShip,
  juice,
  "psyche-craft": psycheCraft,
  "relay-ceres": commandRelay,
  "archive-mercury": archiveBuoy,
  "relay-neptune": listeningRelay,
  "drones-jupiter": droneWreck,
  "capsule-titan": medicalCapsule,
  "probe-uranus": surveyProbe,
};

function buildKit(body: BodyDef, look: CraftLight) {
  const k = new Kit();
  (BUILT[body.id] ?? juice)(k);
  return k.build(look);
}

/**
 * Light one craft: the Sun's direction and flux, the planet it circles (direction from the craft,
 * angular radius as a sine, and its light colour), and how big it is on screen.
 */
export function lightCraft(
  look: CraftLight,
  o: { sun: THREE.Vector3; flux: number; px: number; parentDir?: THREE.Vector3 | null; parentSin?: number; parentColour?: THREE.Color | null; parentLit?: number },
) {
  look.sun.value.copy(o.sun);
  look.flux.value = o.flux;
  look.ambient.value = 0.0025;
  // outlines arrive between ~18 and ~70 px, so a far vehicle is not a scribble of lines
  const t = THREE.MathUtils.clamp((o.px - 18) / 52, 0, 1);
  look.edges.value = t * t * (3 - 2 * t);
  if (o.parentDir && o.parentColour && (o.parentSin ?? 0) > 0) {
    look.parent.value.copy(o.parentDir);
    // reflected planetlight: a third of the sunlight times the share of the sky the planet fills
    const s = o.parentSin ?? 0;
    look.planet.value.copy(o.parentColour).multiplyScalar(0.3 * o.flux * s * s * (o.parentLit ?? 0.5));
  } else {
    look.planet.value.setRGB(0, 0, 0);
  }
}
