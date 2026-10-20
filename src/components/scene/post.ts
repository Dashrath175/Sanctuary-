import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Full-screen passes written for this project:
//  - travel optics: circular lens, domain-warped edge displacement, radial zoom with colour
//    split, blur and glow, all kept out of a quiet centre; lookups past the frame edge fold
//    back into it, so the corners never smear;
//  - lens: colour fringing toward the edges (linear light; exposure and filmic tone mapping
//    follow in the output pass);
//  - grain: film noise, dither and vignette, applied after the display colour conversion so
//    they never lift the black of space;
//  - craft glow: a halo for spacecraft alone (see CraftGlow).

const pass = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const travelShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uPower: { value: 0 },
    uBlur: { value: 0 },
    uBrake: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1.6 },
    uFisheye: { value: 0.85 },
    uNoiseScale: { value: 4 },
    uNoiseStrength: { value: 0.99 },
    uZoom: { value: 0.16 },
    uChromatic: { value: 0.05 },
    uGlow: { value: 0.3 },
    uFocusRadius: { value: 0.18 },
    uFocusFeather: { value: 0.25 },
  },
  vertexShader: pass,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uPower, uBlur, uBrake, uTime, uAspect, uFisheye, uNoiseScale, uNoiseStrength, uZoom, uChromatic, uGlow, uFocusRadius, uFocusFeather;
    varying vec2 vUv;
    vec3 h33(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
    }
    // signed value noise, two channels
    vec2 n3(vec3 x) {
      vec3 i = floor(x); vec3 f = fract(x); vec3 u = f * f * (3.0 - 2.0 * f);
      vec2 a = mix(mix(h33(i).xy, h33(i + vec3(1, 0, 0)).xy, u.x), mix(h33(i + vec3(0, 1, 0)).xy, h33(i + vec3(1, 1, 0)).xy, u.x), u.y);
      vec2 b = mix(mix(h33(i + vec3(0, 0, 1)).xy, h33(i + vec3(1, 0, 1)).xy, u.x), mix(h33(i + vec3(0, 1, 1)).xy, h33(i + vec3(1, 1, 1)).xy, u.x), u.y);
      return mix(a, b, u.z);
    }
    vec2 fbm(vec3 p) { vec2 s = vec2(0.0); float a = 1.0; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.03; a *= 0.6; } return s; }
    // lookups past the frame edge fold back into it instead of smearing the edge pixels
    vec2 fold(vec2 t) { return clamp(1.0 - abs(fract(t * 0.5) * 2.0 - 1.0), 0.0001, 0.9999); }
    float quiet(vec2 uv) {
      float d = length((uv - 0.5) * vec2(uAspect, 1.0));
      return uFocusRadius > 0.0 ? smoothstep(uFocusRadius, uFocusRadius + max(uFocusFeather, 0.0001), d) : 1.0;
    }
    vec3 look(vec2 w, float s, vec2 disp) { return texture2D(tDiffuse, fold(w * exp(-s) + 0.5 + disp)).rgb; }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      float drive = max(max(uPower, uBlur), uBrake);
      if (drive < 0.0001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 asp = vec2(uAspect, 1.0);
      vec2 c = vUv - 0.5;
      // circular lens: bends the middle of the view as the warp builds
      float n = min(uAspect, 1.0) * 0.46;
      float r = clamp(dot(c * asp, c * asp) / (n * n), 0.0, 1.0);
      float o = 1.0 - r;
      float l = smoothstep(0.0, 0.8, uPower) * uFisheye * 0.8;
      vec2 w = c * (1.0 - l * o * o);
      // domain-warped fractal displacement, kept out of the quiet centre
      vec2 disp = vec2(0.0);
      if (uPower * uNoiseStrength > 0.0001) {
        vec3 p = vec3(c * asp * uNoiseScale, uTime * 0.32);
        vec2 q = n3(p * 0.7 + vec3(7.1, 19.3, 3.7));
        disp = fbm(p + vec3(q * 3.5, 0.0)) * uNoiseStrength * uPower * quiet(vUv) * 0.24 / asp;
      }
      // radial zoom (a contraction while braking hard), colour split and motion blur
      float zoom = uZoom * uPower * 0.9 - uBrake * 0.18;
      float split = uChromatic * uPower * 0.42;
      float blur = uBlur * 1.8;
      vec3 acc = vec3(0.0);
      if (blur > 0.004) {
        for (int k = 0; k < 10; k++) {
          float t = zoom + ((float(k) + 0.5) / 10.0 - 0.5) * blur;
          acc += vec3(look(w, t + split, disp).r, look(w, t, disp).g, look(w, t - split, disp).b);
        }
        acc /= 10.0;
      } else {
        acc = vec3(look(w, zoom + split, disp).r, look(w, zoom, disp).g, look(w, zoom - split, disp).b);
      }
      acc *= 1.0 + uGlow * uPower * 1.2;
      gl_FragColor = vec4(mix(base, acc, smoothstep(0.0, 0.065, drive) * quiet(vUv)), 1.0);
    }
  `,
};

export const lensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uChromatic: { value: 0.25 },
  },
  vertexShader: pass,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uChromatic;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      vec2 off = c * uChromatic * 0.0105 * (0.6 + dot(c, c) * 4.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export const grainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNoise: { value: 0.025 },
    uDither: { value: 0.12 },
    uVignette: { value: 0.55 },
    uInterfere: { value: 0 },
    uSeed: { value: 0 },
    uTiles: { value: 0 },
    uTileSeed: { value: 0 },
  },
  vertexShader: pass,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uNoise, uDither, uVignette, uInterfere, uSeed, uTiles, uTileSeed;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      vec3 col;
      if (uInterfere > 0.002) {
        // sensor interference: a few torn rows, a faint colour split, brief dips and static;
        // all of it scales with uInterfere
        float k = uInterfere;
        float tick = uSeed;
        float row = floor(vUv.y * (40.0 + 60.0 * fract(uSeed * 0.137)));
        float tear = step(1.0 - 0.16 * k, hash(vec2(row, tick)));
        vec2 uv = vUv + vec2((hash(vec2(row + 3.7, tick)) - 0.5) * 0.03 * k * tear, 0.0);
        col = texture2D(tDiffuse, uv).rgb;
        col.r = texture2D(tDiffuse, uv + vec2(0.0025 * k, 0.0)).r;
        float dip = step(1.0 - 0.2 * k, hash(vec2(tick, 5.1)));
        col *= 1.0 - dip * (0.12 + 0.18 * k);
        col += (hash(gl_FragCoord.xy * 0.5 + tick) - 0.5) * 0.07 * k;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uTiles > 0.002) {
        // the visor is a mosaic of panels (4 x 4): booting, in a hard stop or a heavy burst, panels
        // drop out, slip sideways, split their colours, fill with static or flash, each on its own
        // clock; never more than about two in five go dark, so the view is torn, not blacked out
        vec2 grid = vec2(4.0, 4.0);
        vec2 cell = floor(vUv * grid);
        float h = hash(cell + floor(uTileSeed) * 1.37);
        float h2 = hash(cell * 1.7 + floor(uTileSeed * 1.9) + 4.2);
        float h3 = hash(cell * 2.3 + floor(uTileSeed * 2.7) + 9.1);
        float gone = step(1.0 - uTiles * 0.4, h);
        float slip = step(1.0 - uTiles * 0.7, h2);
        // rows inside a slipped panel tear on their own
        float line = floor(vUv.y * 140.0);
        float jag = (hash(vec2(line, floor(uTileSeed * 3.1))) - 0.5) * 0.02 * uTiles * step(0.6, h3);
        vec2 suv = vUv + vec2((h2 - 0.5) * 0.09 * uTiles * slip + jag * slip, (h - 0.5) * 0.03 * uTiles * slip);
        float split = 0.006 * uTiles * (0.5 + h3);
        vec3 slipped = vec3(texture2D(tDiffuse, suv + vec2(split, 0.0)).r, texture2D(tDiffuse, suv).g, texture2D(tDiffuse, suv - vec2(split, 0.0)).b);
        col = mix(col, slipped, slip);
        // static in a few panels
        float noisy = step(1.0 - uTiles * 0.22, h3) * (1.0 - gone);
        float snow = hash(gl_FragCoord.xy * 0.37 + uTileSeed);
        col = mix(col, vec3(snow) * 0.45 + col * 0.35, noisy * 0.75);
        col *= 1.0 - gone * (0.55 + 0.4 * hash(vec2(h, uTileSeed)));
        vec2 f = abs(fract(vUv * grid) - 0.5);
        col = mix(col, col * 0.4 + vec3(0.02, 0.05, 0.04), step(0.494, max(f.x, f.y)) * min(1.0, uTiles * 1.3));
        col += vec3(0.6, 0.9, 0.8) * step(1.0 - uTiles * 0.1, h2) * 0.22;
      }
      col *= 1.0 - smoothstep(0.16, 0.6, dot(c, c)) * uVignette;
      // zero-mean grain, a little stronger in the lit parts of the frame
      float n = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
      col += n * uNoise * (0.25 + 0.75 * clamp(dot(col, vec3(0.333)) * 4.0, 0.0, 1.0));
      col += (hash(gl_FragCoord.xy * 0.731 + 0.37) - 0.5) * uDither / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth01 = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 at `peakAt` → `settleGain` at `settleAt` → 0 at `end`, eased between keys */
const envelope = (t: number, peakAt: number, settleAt: number, settleGain: number, end: number) => {
  if (!(t > 0) || t >= end) return 0;
  if (t <= peakAt) return smooth01(t / peakAt);
  if (t <= settleAt) return 1 + (settleGain - 1) * smooth01((t - peakAt) / (settleAt - peakAt));
  return settleGain * (1 - smooth01((t - settleAt) / (end - settleAt)));
};

/**
 * Drive state for the travel optics.
 * - Nothing below the 50,000 km/s threshold; the warp rises over the next 15,000 km/s.
 * - At top speed it starts at 30% and only reaches full strength after 20 seconds of
 *   unbroken cruise; the quiet centre shrinks as it builds, and it relaxes over ~1.5 s.
 * - Crossing the threshold gives a short burst of radial blur.
 * - An X brake from above the threshold gives a brief contraction pulse; slowing near a
 *   world (far below the threshold) leaves the view untouched.
 * - The displacement field evolves faster the harder the drive works.
 */
/**
 * A soft halo for spacecraft only. The vehicle is drawn again on its own into a quarter-size
 * target, blurred in two widening passes and added back in linear light, so a craft glows
 * softly while the global bloom (and every star and world) stays as it is.
 */
export class CraftGlow {
  private a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private quad = new FullScreenQuad();
  private blur = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uStep: { value: new THREE.Vector2() }, uKnee: { value: 0 } },
    vertexShader: pass,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uStep;
      uniform float uKnee;
      varying vec2 vUv;
      // only what is brighter than the knee glows (the first pass), like a bloom threshold
      vec3 s(vec2 o) { return max(texture2D(tDiffuse, vUv + o).rgb - uKnee, 0.0); }
      void main() {
        vec3 c = s(vec2(0.0)) * 0.2270270270;
        c += (s(uStep * 1.3846153846) + s(-uStep * 1.3846153846)) * 0.3162162162;
        c += (s(uStep * 3.2307692308) + s(-uStep * 3.2307692308)) * 0.0702702703;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  readonly pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tGlow: { value: null as THREE.Texture | null }, uStrength: { value: 0 } },
    vertexShader: pass,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tGlow;
      uniform float uStrength;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb + texture2D(tGlow, vUv).rgb * uStrength, 1.0); }
    `,
  });
  private w = 1;
  private h = 1;

  constructor(private layer: number) {
    this.pass.enabled = false;
    this.quad.material = this.blur;
  }

  /** drawing-buffer size in pixels */
  setSize(width: number, height: number) {
    this.w = Math.max(1, Math.round(width / 4));
    this.h = Math.max(1, Math.round(height / 4));
    this.a.setSize(this.w, this.h);
    this.b.setSize(this.w, this.h);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, strength: number) {
    this.pass.enabled = strength > 0.001;
    if (!this.pass.enabled) return;
    const mask = camera.layers.mask;
    const before = renderer.getRenderTarget();
    camera.layers.set(this.layer);
    renderer.setRenderTarget(this.a);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    const u = this.blur.uniforms;
    for (const spread of [1, 2.6]) {
      u.tDiffuse.value = this.a.texture;
      u.uKnee.value = spread === 1 ? 0.18 : 0;
      u.uStep.value.set(spread / this.w, 0);
      renderer.setRenderTarget(this.b);
      this.quad.render(renderer);
      u.tDiffuse.value = this.b.texture;
      u.uKnee.value = 0;
      u.uStep.value.set(0, spread / this.h);
      renderer.setRenderTarget(this.a);
      this.quad.render(renderer);
    }
    renderer.setRenderTarget(before);
    this.pass.uniforms.tGlow.value = this.a.texture;
    this.pass.uniforms.uStrength.value = strength;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.blur.dispose();
    this.quad.dispose();
  }
}

export class TravelOptics {
  power = 0;
  blur = 0;
  brake = 0;
  focusRadius = 0.18;
  focusFeather = 0.25;
  time = 0;
  private cruiseSeconds = 0;
  private cruise = 0;
  private atCruise = false;
  private armed = true;
  private boostT = Infinity;
  private brakeT = Infinity;
  private brakeWarp = 0;
  private base = 0;
  private pulseEnergy = 0;
  private accelEnergy = 0;
  private prev = 0;

  constructor(
    private threshold = 50_000,
    private max = 200_000,
  ) {}

  /** X pressed: the pulse scales with how far above the threshold we were */
  beginBrake(speed: number) {
    this.brakeT = 0;
    this.brakeWarp = clamp01((speed - this.threshold) / (this.max - this.threshold));
    this.boostT = Infinity;
  }

  /** `realDt` (uncapped wall-clock seconds) times the cruise, so it builds over real seconds */
  update(dt: number, speed: number, reduced: boolean, realDt = dt) {
    if (dt <= 0) return;
    if (reduced) {
      this.power = this.blur = this.brake = this.cruise = this.cruiseSeconds = 0;
      this.prev = speed;
      return;
    }
    this.boostT += dt;
    this.brakeT += dt;
    if (this.armed && this.prev <= this.threshold && speed > this.threshold) {
      this.armed = false;
      this.boostT = 0;
    }
    if (speed < this.threshold * 0.9) this.armed = true;

    // unbroken cruise at top speed builds the warp up over 20 s
    const top = speed >= this.max * (1 - 1e-6);
    if (top) {
      if (this.atCruise) this.cruiseSeconds = Math.min(20, this.cruiseSeconds + realDt);
      this.cruise = Math.max(smooth01(this.cruiseSeconds / 20), this.cruise * Math.exp(-realDt / 1.5));
    } else {
      this.cruiseSeconds = 0;
      this.cruise *= Math.exp(-realDt / 1.5);
      if (this.cruise < 1e-6) this.cruise = 0;
    }
    this.atCruise = top;

    const intensity = 0.8;
    const over = speed > this.threshold;
    const rise = smooth01((speed - this.threshold) / 15_000);
    this.power = over ? rise * intensity * (0.3 + 0.7 * this.cruise) : 0;
    this.focusRadius = 0.18 - 0.15 * this.cruise;
    this.focusFeather = 0.25 - 0.08 * this.cruise;
    const boost = envelope(this.boostT, 0.1, 0.25, 0.36, 0.65);
    const settle = Number.isFinite(this.boostT) ? smooth01(this.boostT / 0.1) : 1;
    this.blur = over ? clamp01(0.02 * settle + 0.18 * boost) : 0;
    this.brake = over ? this.brakeWarp * envelope(this.brakeT, 0.08, 0.22, 0.32, 0.6) * 0.8 * intensity : 0;

    // how fast the displacement field moves: speed, acceleration and hard deceleration
    const ratio = (speed - this.prev) / dt / 16_666.7;
    const hard = smooth01((-ratio - 2) / 4);
    const k = (3 * dt) / 0.28;
    const decay = Math.exp(-k);
    const kick = ((2.5 * Math.max(0, this.prev - speed)) / this.max) * hard;
    this.pulseEnergy = clamp01(this.pulseEnergy * decay + (kick * (1 - decay)) / k);
    const pulse = this.pulseEnergy * 0.8;
    const tau = ratio < 0 ? 0.18 * (1 - hard) + 0.035 * hard : 0.14;
    this.base += (clamp01(speed / this.max) - this.base) * (1 - Math.exp(-dt / tau));
    this.accelEnergy += (Math.min(3, Math.abs(ratio)) - this.accelEnergy) * (1 - Math.exp(-dt / 0.09));
    const a = clamp01(Math.max(this.base, pulse));
    this.time += dt * (a * (0.35 + 1.65 * a) + this.accelEnergy * 0.45 + pulse * 2.5) * 0.46;
    this.prev = speed;
  }
}
