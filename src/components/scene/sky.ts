import * as THREE from "three";
import { eclipticDirection, type Vec } from "@/lib/solar";
import { FIGURES, STARS } from "@/lib/stars";
import NAMED from "@/lib/data/named-stars.json";

// The sky: every catalogue star through magnitude 8 at its real position, coloured by its
// spectral class, over the Gaia all-sky map of the Milky Way laid out in galactic coordinates.
// Directions are J2000 ecliptic mapped into scene axes (x, z_north, −y).
// Stars: HYG v4.4 (CC BY-SA 4.0). Milky Way: ESA/Gaia/DPAC, A. Moitinho (CC BY-SA 3.0 IGO).

export const toScene = ([x, y, z]: Vec) => new THREE.Vector3(x, z, -y);

const GAL_POLE = toScene(eclipticDirection(192.85948, 27.12825)).normalize();
const GAL_CENTRE_RAW = toScene(eclipticDirection(266.40499, -28.93617)).normalize();
const GAL_Y = new THREE.Vector3().crossVectors(GAL_POLE, GAL_CENTRE_RAW).normalize();
const GAL_X = new THREE.Vector3().crossVectors(GAL_Y, GAL_POLE).normalize();

/** spectral class colours: O B A F G K M, other, unknown */
export const CLASS_HEX = ["#9cafff", "#abcfff", "#e1efff", "#fff1cc", "#f4cd72", "#f29c55", "#ed6754", "#78d8c0", "#a6a8b5"];
const CLASS_RGB = CLASS_HEX.map((h) => new THREE.Color(h));
const bvClass = (bv: number) => (bv < -0.02 ? 1 : bv < 0.3 ? 2 : bv < 0.58 ? 3 : bv < 0.81 ? 4 : bv < 1.4 ? 5 : 6);

const starVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uMotion;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // a faint shimmer at rest, livelier while the ship is moving
    float amp = (0.07 + 0.28 * uMotion) * smoothstep(1.6, 3.2, aSize);
    float tw = 1.0 - amp * (0.5 + 0.5 * sin(uTime * (1.1 + aSeed * 2.6) + aSeed * 61.0));
    vColor = aColor * tw;
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const starFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 o = abs(gl_PointCoord - 0.5);
    float core = 1.0 - smoothstep(0.08, 0.5, length(o));
    float spikes = ((1.0 - smoothstep(0.01, 0.06, o.x)) * (1.0 - o.y * 2.0) + (1.0 - smoothstep(0.01, 0.06, o.y)) * (1.0 - o.x * 2.0)) * 0.35;
    float a = core + spikes;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

const bandFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  uniform vec3 uGX;
  uniform vec3 uGY;
  uniform vec3 uGZ;
  uniform float uFade;
  varying vec3 vDir;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float l = atan(dot(d, uGY), dot(d, uGX));
    float b = asin(clamp(dot(d, uGZ), -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 - l / 6.2831853), 0.5 + b / 3.1415926);
    vec3 c = texture2D(uMap, uv).rgb;
    // stipple: each map texel takes its own grain, denser where the glow is brighter
    vec2 cell = floor(uv / uTexel);
    float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float r = smoothstep(0.15, 0.85, lum * 2.0 + n * 0.6);
    gl_FragColor = vec4(c * 0.11 * uFade * (r * 0.6 + 0.3), 1.0);
  }
`;

export type SkyStar = { name: string; dir: THREE.Vector3; mag: number };

function starGeometry(dirs: Float32Array, mags: Float32Array, classes: Uint8Array, radius: number) {
  const n = mags.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), seed = new Float32Array(n);
  let s = 4242 >>> 0;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = dirs[i * 3] * radius;
    pos[i * 3 + 1] = dirs[i * 3 + 1] * radius;
    pos[i * 3 + 2] = dirs[i * 3 + 2] * radius;
    const m = mags[i];
    size[i] = (1 + Math.pow(2.512, (4 - m) * 0.33)) * 1.5;
    const k = CLASS_RGB[classes[i]] ?? CLASS_RGB[8];
    const gain = 1.25 * Math.pow(2.512, (2 - m) * 0.45);
    color[i * 3] = k.r * gain;
    color[i * 3 + 1] = k.g * gain;
    color[i * 3 + 2] = k.b * gain;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    seed[i] = s / 4294967296;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  return geo;
}

export class Sky {
  readonly group = new THREE.Group();
  readonly named: SkyStar[] = [];
  readonly figures: { name: string; lines: (readonly [SkyStar, SkyStar])[] }[];
  readonly material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private band: THREE.Mesh;
  private bandMaterial: THREE.ShaderMaterial;
  private fadeStart = -1;
  private disposed = false;

  constructor(private radius: number, private mobile: boolean, pixelRatio: number) {
    // named stars first, so scanning works before the full catalogue arrives
    const seen = new Set<string>();
    const dirs: number[] = [], mags: number[] = [], classes: number[] = [];
    const add = (name: string, raDeg: number, decDeg: number, mag: number, cls: number) => {
      const key = name.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      const dir = toScene(eclipticDirection(raDeg, decDeg)).normalize();
      this.named.push({ name: key, dir, mag });
      dirs.push(dir.x, dir.y, dir.z);
      mags.push(mag);
      classes.push(cls);
    };
    for (const [name, ra, dec, mag, cls] of NAMED as [string, number, number, number, number][]) add(name, ra, dec, mag, cls);
    // a few figure stars whose IAU names the catalogue does not carry
    for (const [name, raH, decD, mag, bv] of STARS) add(name, raH * 15, decD, mag, bvClass(bv));

    // drawn with the opaque pass, right after the Milky Way and before any world, so a world
    // (lit or dark side) hides the stars behind it; the blending stays additive
    this.material = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uMotion: { value: 0 } },
      transparent: false,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(starGeometry(new Float32Array(dirs), new Float32Array(mags), new Uint8Array(classes), radius), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;

    this.bandMaterial = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: bandFragment,
      uniforms: {
        uMap: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 4000, 1 / 2000) },
        uGX: { value: GAL_X },
        uGY: { value: GAL_Y },
        uGZ: { value: GAL_POLE },
        uFade: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.band = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.2, 96, 64), this.bandMaterial);
    this.band.renderOrder = -20;
    this.band.frustumCulled = false;
    this.band.visible = false;
    this.group.add(this.band, this.points);

    const byName = new Map(this.named.map((s) => [s.name, s]));
    this.figures = FIGURES.map((f) => ({
      name: f.name,
      lines: f.lines
        .map(([a, b]) => [byName.get(a.toUpperCase()), byName.get(b.toUpperCase())] as const)
        .filter((pair): pair is readonly [SkyStar, SkyStar] => !!pair[0] && !!pair[1]),
    }));
  }

  /** Fetch the full star catalogue and the Milky Way map; the sky works without them meanwhile. */
  load() {
    fetch("/sky/stars.bin")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        if (this.disposed) return;
        const view = new DataView(buf);
        const n = Math.floor(buf.byteLength / 8);
        const dirs = new Float32Array(n * 3), mags = new Float32Array(n), classes = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          const o = i * 8;
          const x = view.getInt16(o, true) / 32767, y = view.getInt16(o + 2, true) / 32767, z = view.getInt16(o + 4, true) / 32767;
          const v = toScene([x, y, z]).normalize();
          dirs[i * 3] = v.x;
          dirs[i * 3 + 1] = v.y;
          dirs[i * 3 + 2] = v.z;
          mags[i] = view.getUint8(o + 6) / 20 - 2;
          classes[i] = view.getUint8(o + 7);
        }
        const old = this.points.geometry;
        this.points.geometry = starGeometry(dirs, mags, classes, this.radius);
        old.dispose();
      })
      .catch(() => {
        // the named stars stay up on their own
      });

    new THREE.TextureLoader()
      .loadAsync(this.mobile ? "/sky/milkyway-2k.jpg" : "/sky/milkyway-4k.jpg")
      .then((tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const img = tex.image as { width: number; height: number };
        this.bandMaterial.uniforms.uTexel.value.set(1 / img.width, 1 / img.height);
        this.bandMaterial.uniforms.uMap.value = tex;
        this.band.visible = true;
        this.fadeStart = -2;
      })
      .catch(() => {
        // no map: the catalogue stars carry the sky alone
      });
  }

  /** `motion` 0..1: how much the view is moving, for the star shimmer. */
  update(time: number, motion: number, reduced: boolean) {
    this.material.uniforms.uTime.value = reduced ? 0 : time;
    this.material.uniforms.uMotion.value = reduced ? 0 : motion;
    if (this.fadeStart === -2) this.fadeStart = time;
    if (this.fadeStart >= 0) {
      const f = Math.min(1, (time - this.fadeStart) / 1.5);
      this.bandMaterial.uniforms.uFade.value = f * f * (3 - 2 * f);
      if (f >= 1) this.fadeStart = -1;
    }
  }

  dispose() {
    this.disposed = true;
    this.points.geometry.dispose();
    this.material.dispose();
    this.band.geometry.dispose();
    (this.bandMaterial.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    this.bandMaterial.dispose();
  }
}
