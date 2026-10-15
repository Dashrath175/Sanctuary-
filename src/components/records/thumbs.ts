import * as THREE from "three";
import type { BodyDef } from "@/lib/solar";
import { PLATE_EXPOSURE, attachMap, buildBody } from "../scene/surface";
import { craftModel, lightCraft } from "../scene/craft";

// Thumbnails for the records grid: each world rendered once, with the same survey surface
// as in flight (small maps), by one shared offscreen renderer, one at a time, and cached as
// images for the rest of the visit.

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
let renderer: THREE.WebGLRenderer | null = null;
const SIZE = 256;

function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/** Light from the upper left, a little in front, as on a survey plate. */
export const PLATE_LIGHT = new THREE.Vector3(-0.38, 0.26, 0.89).normalize();

/** A body posed for a plate: pole up with a slight lean, rings opened toward the viewer. */
export function poseBody(body: BodyDef, unitKm: number, map: "s" | "1k" | "full") {
  if (body.surface === "craft") {
    // the model arrives with `ready`; until then the group is empty
    const craft = craftModel(body, unitKm, PLATE_EXPOSURE, true);
    lightCraft(craft.look, { sun: PLATE_LIGHT, flux: 1, px: 200 });
    const root = new THREE.Group();
    root.add(craft.group);
    craft.group.rotation.set(0.45, -0.6, 0.12);
    return { root, material: null as THREE.ShaderMaterial | null, ready: craft.ready };
  }
  const built = buildBody(body, unitKm);
  const root = new THREE.Group();
  root.add(built.group);
  built.group.rotation.y = (body.seed % 7) * 0.6 + 0.4;
  root.rotation.set(body.rings ? 0.32 : 0.12, 0, body.rings ? 0.22 : -0.18);
  built.material.uniforms.uSun.value.copy(PLATE_LIGHT);
  const ready = map ? attachMap(body, built.material, map) : Promise.resolve(false);
  return { root, material: built.material, ready };
}

/** How big a posed body is (globe plus main rings; the whole model for a spacecraft). */
export function plateBounds(body: BodyDef, root: THREE.Object3D) {
  if (body.surface === "craft") {
    // fit what the camera sees (the posed model's width and height), not its full diagonal
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    return { radius: Math.max(size.x, size.y) / 2, centre: box.getCenter(new THREE.Vector3()) };
  }
  const ring = body.rings === "saturn" ? 2.42 : body.rings === "uranus" ? 2.05 : body.rings === "neptune" ? 2.6 : 1;
  const long = body.axesKm ? Math.max(...body.axesKm) / body.radiusKm : 1;
  return { radius: ring * long, centre: new THREE.Vector3() };
}

/** Distance that fits `radius` into the frame at the given vertical field of view. */
export const fitDistance = (radius: number, fovDeg: number, fill = 0.82) => radius / Math.sin(((fovDeg / 2) * Math.PI) / 180) / fill;

async function render(body: BodyDef) {
  const r = getRenderer();
  const scene = new THREE.Scene();
  const craft = body.surface === "craft";
  const unitKm = craft ? (body.spanM ?? 10) / 1000 / 2 : body.radiusKm;
  const { root, material, ready } = poseBody(body, unitKm, "s");
  scene.add(root);
  await ready;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  const { radius, centre } = plateBounds(body, root);
  camera.position.set(centre.x, centre.y, centre.z + fitDistance(radius, 28, body.kind === "star" ? 0.72 : 0.93));
  camera.lookAt(centre);
  if (material) material.uniforms.uTime.value = 1;
  r.render(scene, camera);
  const url = r.domElement.toDataURL("image/webp", 0.86);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    // a craft's geometry belongs to the cached model, which flight reuses
    if (!craft) m.geometry?.dispose?.();
    (m.material as THREE.Material | undefined)?.dispose?.();
  });
  return url;
}

/** The thumbnail image for a body (rendered on first request, then cached). */
export function thumbFor(body: BodyDef): Promise<string> {
  let p = cache.get(body.id);
  if (!p) {
    p = queue.then(() => render(body));
    queue = p.catch(() => undefined);
    cache.set(body.id, p);
  }
  return p;
}
