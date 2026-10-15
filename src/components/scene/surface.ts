import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RINGS, type BodyDef } from "@/lib/solar";
import EDGES from "@/lib/data/map-edges.json";

// Survey-style body rendering. Each world's brightness map (public NASA/USGS mosaics, or a
// procedural stand-in where none exists; see scripts/prep-maps.py) is recoloured in the
// body's two survey colours. Light only gathers where the map has structure: sharp edges and
// iso-brightness contours, broken up per map texel into a field of bright points, over a
// faint fill. A 10° graticule, real sunlight from the Sun's direction, a haze limb for Titan,
// triaxial and irregular shapes for the small worlds, and a blinding disc for the Sun.

// ---------- maps ----------

export type MapSize = "full" | "1k" | "s";
const maps = new Map<string, Promise<THREE.Texture | null>>();

/** A body's survey map, fetched once and shared; null if it has none or it failed. */
export function surfaceMap(id: string, size: MapSize): Promise<THREE.Texture | null> {
  const key = `${id}:${size}`;
  let p = maps.get(key);
  if (!p) {
    const url = `/maps/${id}${size === "full" ? "" : `-${size}`}.jpg`;
    p = new THREE.TextureLoader()
      .loadAsync(url)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        return t;
      })
      .catch(() => null);
    maps.set(key, p);
  }
  return p;
}

export const hasMap = (b: BodyDef) => b.kind !== "star" && b.surface !== "craft";

/** Load a body's map into its survey material. */
export function attachMap(body: BodyDef, material: THREE.ShaderMaterial, size: MapSize) {
  if (!hasMap(body)) return Promise.resolve(false);
  return surfaceMap(body.id, size).then((t) => {
    if (!t) return false;
    const u = material.uniforms;
    u.uMap.value = t;
    const img = t.image as { width: number; height: number };
    u.uMapSize.value.set(img.width, img.height);
    u.uHasMap.value = 1;
    return true;
  });
}

// ---------- the survey surface ----------

const surfaceVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const surfaceFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform vec2 uMapSize;
  uniform float uHasMap;
  uniform vec3 uDark;
  uniform vec3 uLight;
  uniform vec3 uSun;
  uniform float uGrid;
  uniform float uLine;
  uniform float uSurface;
  uniform float uEdge;     // weight of brightness edges, tuned per map so busy maps don't glare
  uniform float uGain;
  uniform float uFlux;     // sunlight here relative to 1 AU
  uniform float uExposure; // shared, adapted to the world we are closest to
  uniform float uAmbient;
  uniform vec3 uHaze; // limb strength, falloff power, veil
  uniform float uStar;
  uniform float uDisc;     // the Sun's brightness (eased down while a scan reads it)
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vObj);
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewW);
    vec3 col;
    if (uStar > 0.5) {
      // the Sun: a blinding warm-white disc, faintly granulated, darker toward the limb
      float g = n3(p * 60.0 + uTime * 0.05) * 0.5 + n3(p * 140.0 - uTime * 0.03) * 0.5;
      col = vec3(6.4, 4.8, 2.4) * uDisc * (0.92 + (g - 0.5) * 0.16) * (0.7 + 0.3 * pow(clamp(dot(n, v), 0.0, 1.0), 0.5));
    } else {
      // east longitude grows anticlockwise seen from the north pole (+Y); north is up the map
      vec2 uv = vec2(atan(-p.z, p.x) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.1415927 + 0.5);
      if (uHasMap > 0.5) {
        vec2 t = 1.0 / uMapSize;
        float y = texture2D(uMap, uv).r;
        float edge = (abs(y - texture2D(uMap, uv + vec2(t.x, 0.0)).r) + abs(y - texture2D(uMap, uv + vec2(0.0, t.y)).r)) * 1.732;
        float contour = 1.0 - smoothstep(0.025, uLine * 0.13 + 0.026, abs(sin(y * 85.0)));
        float dots = smoothstep(0.33, 0.7, edge * uEdge + contour * 0.65 + hash(floor(uv * uMapSize)) * 0.32);
        col = mix(uDark, uLight, y) * (dots * uSurface + 0.025);
      } else {
        col = uLight * 0.32; // until the map arrives
      }
      float ga = abs(sin(uv.x * 3.1415927 * 36.0)), gb = abs(sin(uv.y * 3.1415927 * 18.0));
      float grid = (1.0 - smoothstep(uLine * 0.006, uLine * 0.017, min(ga, gb))) * uGrid;
      col += uLight * grid * (uHasMap > 0.5 ? 1.0 : 0.15);
      float sun = dot(n, normalize(uSun));
      float light = uFlux * uExposure;
      col *= (max(sun, 0.0) + uAmbient) * light * uGain;
      if (uHaze.x > 0.0) {
        float rim = 1.0 - clamp(dot(n, v), 0.0, 1.0);
        col += uLight * (pow(rim, uHaze.y) * uHaze.x + uHaze.z) * max(0.0, (sun + 0.3) / 1.3) * light;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    // no-ops inside the post chain; tone-map and encode when drawn straight to a canvas
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export type SurfaceUniforms = {
  uSun: { value: THREE.Vector3 };
  uTime: { value: number };
};

/** planets light their survey points harder than the small worlds */
const gainFor = (b: BodyDef) => (b.kind === "planet" || b.id === "moon" ? 3 : 1.6);

/**
 * Lambert phase: the share of a lit sphere's light seen from a viewing direction whose
 * cosine to the sunward direction is `cos` (1 = full phase).
 */
export function lambertPhase(cos: number) {
  const c = Math.max(-1, Math.min(1, cos));
  return Math.max(0, Math.min(1, (Math.sqrt(1 - c * c) + (Math.PI - Math.acos(c)) * c) / Math.PI));
}

/**
 * Exposure that shows a world as if it hung at Mars's distance seen at a 55° phase: dim outer
 * worlds stay readable and a thin crescent opens up, as a camera would adapt.
 */
export function exposureFor(flux: number, viewCos: number, marsFlux = 0.43) {
  const seen = Math.max(flux * lambertPhase(viewCos), flux * 0.01, 1e-12);
  return Math.max(0.02, Math.min(65536, (marsFlux * lambertPhase(0.57)) / seen));
}

/** Exposure for plates lit from the front-left (records): a little brighter than flight, as the
 * plates have no bloom pass to lift them. */
export const PLATE_EXPOSURE = { value: exposureFor(1, 0.8) * 1.6 };

export function surfaceMaterial(body: BodyDef, exposure: { value: number } = PLATE_EXPOSURE) {
  const [dark, light] = body.palette;
  const haze = body.haze ?? [0, 1, 0];
  return new THREE.ShaderMaterial({
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    uniforms: {
      uMap: { value: null as THREE.Texture | null },
      uMapSize: { value: new THREE.Vector2(1024, 512) },
      uHasMap: { value: 0 },
      uDark: { value: new THREE.Color(dark) },
      uLight: { value: new THREE.Color(light) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uGrid: { value: body.kind === "star" ? 0 : 0.22 },
      uLine: { value: 1.05 },
      uSurface: { value: 1.4 },
      uEdge: { value: (EDGES as Record<string, number>)[body.id] ?? 5 },
      uGain: { value: gainFor(body) },
      uFlux: { value: 1 },
      uExposure: exposure,
      uAmbient: { value: 0.012 },
      uHaze: { value: new THREE.Vector3(...haze) },
      uStar: { value: body.kind === "star" ? 1 : 0 },
      uDisc: { value: 1 },
      uTime: { value: 0 },
    },
  });
}

// ---------- shapes ----------

function hash3(x: number, y: number, z: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.13) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
function fbm(x: number, y: number, z: number, seed: number) {
  let s = 0, a = 0.5, f = 1.6, t = 0;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x * f, y * f, z * f, seed + i * 7.7);
    t += a;
    f *= 2.1;
    a *= 0.5;
  }
  return s / t;
}

/**
 * Globe geometry in scene units: a sphere for the round worlds; a triaxial ellipsoid (pole
 * along +Y, long axis along +X) for the flattened giants and the small worlds, with lumps,
 * a waist or a spinning-top ridge for the irregular ones.
 */
export function shapeGeometry(body: BodyDef, unitKm: number, segments: [number, number] = [96, 64]) {
  if (!body.axesKm && !body.shape) {
    const g = new THREE.SphereGeometry(body.radiusKm / unitKm, segments[0], segments[1]);
    return g;
  }
  const [a, b, c] = body.axesKm ?? [body.radiusKm, body.radiusKm, body.radiusKm];
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, segments[0], segments[1]);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const seed = body.seed % 101;
  const shape = body.shape;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const dx = x / len, dy = y / len, dz = z / len;
    let r = 1 / Math.sqrt((dx * dx) / (a * a) + (dz * dz) / (b * b) + (dy * dy) / (c * c));
    if (shape === "top") {
      r *= 1 - 0.17 * Math.abs(dy) ** 1.2; // a ridge round the equator, cones toward the poles
      r *= 1 + (fbm(dx * 2, dy * 2, dz * 2, seed) - 0.5) * 0.1;
    } else if (shape === "peanut") {
      r *= 1 - 0.2 * Math.exp(-(dx * dx) / 0.05) * (1 - Math.abs(dx)); // a waist across the middle
      r *= 1 + (fbm(dx * 1.6, dy * 1.6, dz * 1.6, seed) - 0.5) * 0.3;
    } else if (shape === "lumpy") {
      r *= 1 + (fbm(dx * 1.3, dy * 1.3, dz * 1.3, seed) - 0.5) * 0.36;
    } else if (shape === "basin") {
      r *= 1 - 0.07 * Math.exp(-((dy + 1) * (dy + 1)) / 0.12); // a giant impact basin at the south pole
      r *= 1 + (fbm(dx * 1.5, dy * 1.5, dz * 1.5, seed) - 0.5) * 0.06;
    }
    pos.setXYZ(i, (dx * r) / unitKm, (dy * r) / unitKm, (dz * r) / unitKm);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------- the Sun ----------
//
// Everyday, the Sun is a blinding warm-white disc. While a scan reads it the glare steps back
// and its surface shows, drawn here on the sphere itself (so it is round, turns, and darkens
// toward the limb): a mottled orange chromosphere with a bright network, white-hot active
// regions where the day's flares rise, a few dark filaments, and a deep red corona beyond
// the limb. All procedural: no image to fetch, and the extra work only runs while a reading
// is on screen.

const sunVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vWipe;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - wp.xyz;
    vec4 mv = viewMatrix * wp;
    // height above the centre as the camera sees it, in radii (the reading wipes in from the top)
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vWipe = (mv.y - c.y) / max(length(position) * length(modelMatrix[0].xyz), 1e-12);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const noiseChunk = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

const sunFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uDisc;     // the everyday disc's brightness (eased down while a scan reads it)
  uniform float uRead;     // 0..1: how far the reading has taken over
  uniform float uReveal;   // 0..1: the reading wipes in from the top
  uniform float uDetail;   // disc radius in pixels: detail finer than a pixel fades out
  uniform vec4 uSites[5];  // active regions: direction in the Sun's frame, strength
  uniform float uTime;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vWipe;
  ${noiseChunk}
  float ridge(vec3 x) { return 1.0 - abs(n3(x) * 2.0 - 1.0); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vObj);
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewW);
    float mu = clamp(dot(n, v), 0.0, 1.0);
    // everyday: a blinding warm-white disc, faintly granulated, darker toward the limb
    float g = n3(p * 60.0 + uTime * 0.05) * 0.5 + n3(p * 140.0 - uTime * 0.03) * 0.5;
    vec3 col = vec3(6.4, 4.8, 2.4) * uDisc * (0.92 + (g - 0.5) * 0.16) * (0.7 + 0.3 * pow(mu, 0.5));
    float read = uRead * step(1.0 - 2.04 * uReveal, vWipe);
    if (read > 0.001) {
      float t = uTime;
      float d1 = smoothstep(30.0, 90.0, uDetail);
      float d2 = smoothstep(90.0, 260.0, uDetail);
      float d3 = smoothstep(260.0, 520.0, uDetail);
      // chromosphere: a broad mottle, a bright cell network and fine specks, slowly boiling;
      // the fine octaves average two skewed lattices so no grid shows close up
      vec3 pk = vec3(p.y + p.z * 0.5, p.z - p.x * 0.5, p.x + p.y * 0.5);
      float m0 = n3(p * 7.0 + vec3(0.0, t * 0.004, 0.0));
      float net = 0.5 * (ridge(p * 26.0 + vec3(t * 0.01, 0.0, -t * 0.008)) + ridge(pk * 23.0 + 5.0));
      float fine = 0.5 * (n3(p * 75.0 - vec3(0.0, t * 0.02, t * 0.015)) + n3(pk * 68.0 + vec3(9.0, t * 0.015, 0.0)));
      float grain = 0.5;
      if (d3 > 0.0) grain = 0.5 * (n3(p * 170.0 + t * 0.03) + n3(pk * 150.0 - t * 0.025));
      float s1 = smoothstep(0.5, 0.84, fine), s2 = smoothstep(0.52, 0.86, grain);
      float speck = (s1 * s1 * d2 * 0.85 + s2 * s2 * d3 * 0.6) * (0.55 + 0.9 * m0);
      float mott = 0.5 + 0.3 * (m0 - 0.5) + 0.5 * (net * net - 0.35) * d1 + 0.35 * speck - 0.12 * d3 * (0.5 - grain);
      // active regions: knotted bright plage round each of the day's sites, and a few fainter
      // patches in the two activity belts
      float plage = 0.0;
      for (int i = 0; i < 5; i++) plage += uSites[i].w * exp((dot(p, uSites[i].xyz) - 1.0) * 170.0);
      float belt = smoothstep(0.06, 0.18, abs(p.y)) * (1.0 - smoothstep(0.42, 0.58, abs(p.y)));
      plage += belt * smoothstep(0.74, 0.9, n3(p * 6.0 + 11.0)) * 0.35;
      plage *= 0.3 + 1.1 * smoothstep(0.35, 0.8, n3(p * 34.0 + 3.0) * 0.6 + fine * 0.4);
      // dark filaments snaking between them
      float fil = (1.0 - smoothstep(0.0, 0.02 + 0.03 * n3(p * 12.0), abs(n3(p * 5.0 + 7.0) - 0.5))) * smoothstep(0.58, 0.74, n3(p * 2.5 + 2.0));
      vec3 sdo = mix(vec3(0.13, 0.016, 0.001), vec3(0.6, 0.1, 0.006), clamp(mott, 0.0, 1.0));
      sdo = mix(sdo, vec3(1.0, 0.5, 0.15), clamp(speck * 0.7, 0.0, 1.0));
      sdo = mix(sdo, vec3(1.15, 0.78, 0.4), clamp(plage, 0.0, 1.0));
      sdo *= 1.0 - 0.42 * fil;
      // round: deeper and redder toward the limb, with a thin hot rim right at the edge
      sdo *= 0.38 + 0.62 * pow(mu, 0.45);
      sdo += vec3(0.38, 0.05, 0.0) * pow(1.0 - mu, 7.0);
      col = mix(col, sdo, read);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const coronaVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uRadius; // the Sun's radius, local units
  uniform float uSpan;   // how far out the corona is drawn, in radii
  varying vec3 vRay;
  varying vec3 vCentre;
  varying vec2 vLocal;
  varying float vR;
  void main() {
    // a billboard through the Sun's centre, turned to the camera
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float r = uRadius * length(modelMatrix[0].xyz);
    vec4 mv = c + vec4(position.xy * 2.0 * uSpan * r, 0.0, 0.0);
    vRay = mv.xyz;
    vCentre = c.xyz;
    vLocal = position.xy * 2.0 * uSpan;
    vR = r;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const coronaFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uRead;
  uniform float uReveal;
  uniform float uTime;
  varying vec3 vRay;
  varying vec3 vCentre;
  varying vec2 vLocal;
  varying float vR;
  ${noiseChunk}
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(vCentre);
    float ang = acos(clamp(dot(normalize(vRay), vCentre / d), -1.0, 1.0));
    float x = ang / asin(clamp(vR / d, 1e-6, 1.0)); // 1 at the limb
    if (x < 1.0 || uRead < 0.001) discard;
    float e = x - 1.0;
    float psi = atan(vLocal.y, vLocal.x);
    vec3 q = vec3(cos(psi), sin(psi), 0.0);
    // spicules and small prominences right at the limb, faint streamers farther out
    float spic = n3(q * 40.0 + vec3(0.0, 0.0, e * 26.0 - uTime * 0.08));
    float streak = n3(q * 5.0 + vec3(0.0, 0.0, e * 1.5 - uTime * 0.01));
    float glow = exp(-e * 14.0) * (0.5 + 0.75 * spic) + exp(-e * 4.0) * 0.12 * (0.5 + streak);
    vec3 col = vec3(0.6, 0.07, 0.008) * glow * uRead * smoothstep(0.0, 1.0, uReveal);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** The Sun's sphere: its everyday blinding disc and, under a scan reading, its surface. */
export function sunMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: sunVertex,
    fragmentShader: sunFragment,
    uniforms: {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uFlux: { value: 1 },
      uDisc: { value: 1 },
      uRead: { value: 0 },
      uReveal: { value: 1 },
      uDetail: { value: 200 },
      uSites: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
      uTime: { value: 0 },
    },
  });
}

/** The Sun's deep red corona, shown with its surface while a scan reads it. */
function sunCorona(radius: number) {
  const span = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      uniforms: { uRadius: { value: radius }, uSpan: { value: span }, uRead: { value: 0 }, uReveal: { value: 1 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

export type SunParts = { corona: THREE.Mesh; glows: THREE.Sprite[] };

/** A body's mesh group: survey globe (+ rings). Scale is in scene units (`unitKm` km each). */
export function buildBody(body: BodyDef, unitKm: number, map: MapSize | null = null, exposure?: { value: number }) {
  const group = new THREE.Group();
  const material = body.kind === "star" ? sunMaterial() : surfaceMaterial(body, exposure);
  const globe = new THREE.Mesh(shapeGeometry(body, unitKm), material);
  group.add(globe);
  const r = body.radiusKm / unitKm;
  if (body.kind === "star") {
    const glows = [glowSprite("#ffd9a0", r * 5, 0.28), glowSprite("#ff8a3d", r * 12, 0.07)];
    const corona = sunCorona(r);
    group.add(...glows, corona);
    group.userData.sun = { corona, glows } satisfies SunParts;
  }
  let rings: THREE.Object3D | null = null;
  if (body.rings) {
    rings = body.rings === "saturn" ? saturnRings(unitKm) : lineRings(body.rings, unitKm);
    group.add(rings);
  }
  if (map) void attachMap(body, material, map);
  return { group, globe, material, rings };
}

// ---------- rings ----------

const ringVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vPos;
  varying vec3 vWorldN;
  void main() {
    vPos = position.xy;
    vWorldN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const saturnFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uTint;
  uniform float uUnit;
  uniform vec3 uSun;
  uniform float uBands[15];
  varying vec2 vPos;
  varying vec3 vWorldN;
  float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    float rk = length(vPos) * uUnit;
    float a = 0.0;
    for (int i = 0; i < 5; i++) {
      float lo = uBands[i * 3], hi = uBands[i * 3 + 1], op = uBands[i * 3 + 2];
      a = max(a, op * smoothstep(lo - 150.0, lo + 150.0, rk) * (1.0 - smoothstep(hi - 150.0, hi + 150.0, rk)));
    }
    // fine ringlets
    float fine = 0.65 + 0.35 * sin(rk * 0.0017 + sin(rk * 0.00023) * 0.7) * sin(rk * 0.0097 + sin(rk * 0.00037) * 1.4);
    a *= fine * (0.85 + 0.3 * h(floor(rk / 220.0)));
    float lit = 0.55 + 0.45 * abs(dot(normalize(vWorldN), normalize(uSun)));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uTint * lit * 1.4, a * 0.34);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function saturnRings(unitKm: number) {
  const s = RINGS.saturn;
  const bands: number[] = [];
  for (const b of s.bands) bands.push(b.inner, b.outer, b.opacity);
  const outer = 141_000 / unitKm, inner = 66_000 / unitKm;
  const geo = new THREE.RingGeometry(inner, outer, 256, 8);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: saturnFragment,
    uniforms: {
      uTint: { value: new THREE.Color().setRGB(...s.tint) },
      uUnit: { value: unitKm },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uBands: { value: bands },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // ring plane = body equator (XZ)
  return mesh;
}

function lineRings(kind: "uranus" | "neptune", unitKm: number) {
  const s = RINGS[kind];
  const group = new THREE.Group();
  const tint = new THREE.Color().setRGB(...s.tint).lerp(new THREE.Color("#e6fff7"), 0.55);
  for (const ring of s.lines) {
    const pts: THREE.Vector3[] = [];
    const r = ring.a / unitKm;
    for (let i = 0; i <= 512; i++) {
      const a = (i / 512) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: Math.min(0.5, 0.05 + ring.weight * 0.42), depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    group.add(line);
  }
  return group;
}

// ---------- the Sun from afar ----------

const glareVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const glareFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uGain;
  uniform float uPx;
  varying vec2 vUv;
  // a hairline ray along one axis, thinning out toward the tip
  float ray(float across, float along) { return (1.0 - smoothstep(0.0, 0.9 / uPx, across)) * pow(max(0.0, 1.0 - along * 2.0), 2.2); }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 s = vUv - 0.5;
    vec2 a = abs(s);
    float n = length(s) * uPx; // pixels from the centre
    float core = exp(-(n / 2.4) * (n / 2.4));
    float halo = exp(-n / (uPx * 0.085)) * max(0.0, 1.0 - length(s) * 2.0) * 0.5;
    float rays = (ray(a.y, a.x) + ray(a.x, a.y)) * 0.7;
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * uGain, min(1.0, core + halo + rays));
  }
`;

/**
 * The Sun seen from beyond the inner system: a bright point with a soft halo and four
 * hairline rays. Its size and brightness follow the sunlight reaching us (inverse square,
 * softened), so it shrinks and dims the farther out we fly.
 */
export function sunGlare() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: glareVertex,
      fragmentShader: glareFragment,
      uniforms: { uGain: { value: 1 }, uPx: { value: 100 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Glare size (px across), gain and fade-in for a viewer `au` from the Sun. Both follow the
 * sunlight reaching us, softened (about a 0.3 power of it), so the Sun grows and brightens
 * plainly as we come in (about threefold from Uranus to Earth) and shrinks as we fly out.
 */
export function sunGlareAt(au: number) {
  const flux = Math.min(1, Math.max(au, 1e-9) ** -2) ** 0.3;
  const t = THREE.MathUtils.clamp((au - 1.15) / 0.45, 0, 1);
  return { px: 32 + 150 * flux, gain: 1.35 + 1.25 * flux, fade: t * t * (3 - 2 * t) };
}

// ---------- sprites ----------

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.16, "rgba(255,255,255,0.62)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function glowSprite(color: THREE.ColorRepresentation, scale: number, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(scale);
  return s;
}
