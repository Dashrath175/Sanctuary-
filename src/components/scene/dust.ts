import * as THREE from "three";

// Passing dust: a sparse cube of grains wrapped around the camera. Each grain is a small quad
// stretched along the direction of travel, so speed reads as fine streaks drifting past.

const COUNT = 1100;
const HALF = 24; // cube half-size in scene units (1 = 1000 km)
const wrap = (v: number) => ((((v + HALF) % (HALF * 2)) + HALF * 2) % (HALF * 2)) - HALF;
const smooth = (t: number) => {
  const e = Math.max(0, Math.min(1, t));
  return e * e * (3 - 2 * e);
};
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

export class Dust {
  readonly mesh: THREE.Mesh;
  private particles = new Float32Array(COUNT * 3);
  private grains = new Float32Array(COUNT * 2);
  private positions = new Float32Array(COUNT * 18);
  private colours = new Float32Array(COUNT * 18);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private fade = 0;
  private dir = new THREE.Vector3();
  private p = new THREE.Vector3();
  private view = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private side = new THREE.Vector3();
  density = 0.12;
  streak = 0.35;
  brightness = 0.65;

  constructor() {
    let seed = 85630519 >>> 0;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
    for (let i = 0; i < COUNT; i++) {
      this.particles[i * 3] = (rand() * 2 - 1) * HALF;
      this.particles[i * 3 + 1] = (rand() * 2 - 1) * HALF;
      this.particles[i * 3 + 2] = (rand() * 2 - 1) * HALF;
      this.grains[i * 2] = 0.55 + rand() * 0.9;
      this.grains[i * 2 + 1] = rand();
    }
    const uv = new Float32Array(COUNT * 12);
    const quad = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    for (let i = 0; i < COUNT; i++) uv.set(quad, i * 12);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 color;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          vColor = color; vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform float uAlpha;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 r = abs(vUv - 0.5);
          float a = uAlpha * (1.0 - smoothstep(0.06, 0.5, r.y)) * (1.0 - smoothstep(0.25, 0.5, r.x));
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** `velocity` in km/s (scene axes), `camera` sits at the origin of the floating frame. */
  update(dt: number, velocity: THREE.Vector3, timeScale: number, camera: THREE.Camera, reduced: boolean) {
    const speed = velocity.length();
    if (reduced) {
      this.mesh.visible = false;
      this.fade = 0;
      return;
    }
    const eff = speed * Math.pow(Math.max(1, timeScale), 0.15);
    const rate = 52 * (1 - Math.exp(-Math.pow(eff / 150_000, 0.65)));
    const visibility = smooth(speed / 900);
    this.fade += (visibility - this.fade) * (1 - Math.exp(-Math.min(dt, 0.1) * 12));
    const alpha = this.fade * this.brightness;
    this.material.uniforms.uAlpha.value = alpha;
    this.mesh.visible = alpha > 0.002;
    if (!this.mesh.visible) return;
    const count = Math.round(COUNT * this.density);
    this.geometry.setDrawRange(0, count * 6);
    this.dir.copy(velocity);
    if (speed > 0) this.dir.multiplyScalar(1 / speed);
    const step = rate * Math.min(dt, 0.1);
    const trail = rate * 0.022 * this.streak;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      this.particles[k] = wrap(this.particles[k] - this.dir.x * step);
      this.particles[k + 1] = wrap(this.particles[k + 1] - this.dir.y * step);
      this.particles[k + 2] = wrap(this.particles[k + 2] - this.dir.z * step);
      if (i >= count) continue;
      this.p.fromArray(this.particles, k);
      const dist = this.p.length();
      const grain = this.grains[i * 2], tone = this.grains[i * 2 + 1];
      const edge = HALF - Math.max(Math.abs(this.p.x), Math.abs(this.p.y), Math.abs(this.p.z));
      const fadeIn = smooth(edge / 4.8) * smooth((dist - 1.4) / 2.2);
      const width = (0.009 + dist * 0.00048) * grain;
      this.view.copy(this.p).normalize();
      this.axis.copy(this.dir).addScaledVector(this.view, -this.dir.dot(this.view));
      const across = this.axis.length();
      if (across > 1e-4) this.axis.multiplyScalar(1 / across);
      else this.axis.copy(up);
      this.side.crossVectors(this.view, this.axis).normalize();
      const length = width + trail * across * (0.6 + grain * 0.4);
      const glow = fadeIn * (0.35 + grain * 0.4);
      const r = (0.52 + tone * 0.19) * glow, g = (0.69 + tone * 0.1) * glow, b = (0.7 - tone * 0.12) * glow;
      const o = i * 18;
      for (let v = 0; v < 6; v++) {
        const q = o + v * 3;
        const along = CORNERS[v][0] * length, wide = CORNERS[v][1] * width;
        this.positions[q] = this.p.x + this.axis.x * along + this.side.x * wide;
        this.positions[q + 1] = this.p.y + this.axis.y * along + this.side.y * wide;
        this.positions[q + 2] = this.p.z + this.axis.z * along + this.side.z * wide;
        this.colours[q] = r;
        this.colours[q + 1] = g;
        this.colours[q + 2] = b;
      }
    }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.geometry.attributes.color as THREE.BufferAttribute;
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
