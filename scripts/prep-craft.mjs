// Rebuilds public/craft/*.glb from NASA's public-domain spacecraft models: decodes Draco,
// drops parts that don't belong, scales each model to the real span in metres (centred),
// simplifies the heaviest meshes, shrinks textures to 512 px WebP, adds the feature edges as
// a line primitive (drawn as the bright outline in flight), and packs it with meshopt.
//
// Needs @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions,
// draco3dgltf, meshoptimizer and sharp. Install them in a scratch folder, copy this file there
// and run:  node prep-craft.mjs <folder with the downloaded .glb files> <rea-site>/public/craft
//
// Sources (public domain): github.com/nasa/NASA-3D-Resources (3D Models/…), and the New
// Horizons model from science.nasa.gov/resource/new-horizons-3d-model/.
//
// The two story ships come from Sketchfab (CC BY 4.0, credited in the README) by way of
// scripts/story-ships.py in Blender (damage, decimation): kestrel.glb and halcyon.glb, and the
// commander's own ship (Sketchfab, CC BY 4.0) for the cutscenes: vessel.glb.
// To rebuild only some files, name them:  node prep-craft.mjs <src> <out> kestrel,halcyon,vessel

import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, textureCompress, meshopt, getBounds, flatten, join } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";

const [srcDir, outDir, only] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error("usage: node prep-craft.mjs <source dir> <out dir>");
  process.exit(1);
}

// source file, span in metres, nodes to drop, simplify ratio and allowed error (of the size)
const MODELS = {
  // seven stray truss rings float 30 m off the station in the source; they go
  iss: { src: "iss.glb", span: 109, drop: ["bendedtru1", "bendedtru2", "bendedtru3", "bendedtrus", "pCylinder1", "pCylinder2", "pCylinder8"], ratio: 0.25, error: 0.003 },
  jwst: { src: "webb.glb", span: 21.197, drop: [], ratio: 0.25, error: 0.01 },
  mro: { src: "mro.glb", span: 13.6, drop: [], ratio: 0.35, error: 0.002 },
  odyssey: { src: "odyssey.glb", span: 8.267, drop: [], ratio: 1 },
  juno: { src: "juno.glb", span: 20, drop: [], ratio: 1 },
  dawn: { src: "dawn.glb", span: 19.7, drop: [], ratio: 0.8, error: 0.001 },
  stereo: { src: "stereo.glb", span: 6.47, drop: [], ratio: 0.6, error: 0.002 },
  "new-horizons": { src: "new-horizons.glb", span: 2.7, drop: [], ratio: 1 },
  voyager: { src: "voyager.glb", span: 16.41, drop: [], ratio: 0.9, error: 0.001 },
  // story ships, at the spans in solar.ts
  // the wreck draws only its silhouette, big folds and the torn edges of its breaches
  kestrel: { src: "kestrel.glb", span: 46, drop: [], ratio: 1, edgeAngle: 55 },
  halcyon: { src: "halcyon.glb", span: 120, drop: [], ratio: 0.75, error: 0.001 },
  // the commander's own ship (cutscenes only); nose +Z, up +Y
  vessel: { src: "vessel.glb", span: 28, drop: [], ratio: 1, edgeAngle: 38 },
};

/** One RGB vertex colour set at most (the darkest, i.e. the baked scorching), one UV set. */
function tidyAttributes(doc) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      let best = null, low = Infinity;
      for (const s of p.listSemantics().filter((s) => s.startsWith("COLOR_"))) {
        const a = p.getAttribute(s), v = new Float32Array(a.getCount() * 3), el = [];
        let m = Infinity;
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, el);
          v.set([el[0], el[1], el[2]], i * 3);
          m = Math.min(m, el[0]);
        }
        if (m < low) [best, low] = [v, m];
      }
      for (const s of p.listSemantics()) if (s.startsWith("COLOR_") || /^TEXCOORD_[1-9]/.test(s)) p.setAttribute(s, null);
      if (best && low < 0.95) p.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(best).setBuffer(buffer));
    }
  }
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "meshopt.encoder": MeshoptEncoder,
  });

/** Feature edges of a triangle primitive: boundaries and creases sharper than `angleDeg`. */
function featureEdges(pos, idx, angleDeg) {
  // weld by position only, so UV seams and split normals don't count as edges
  const key = (i) => `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`;
  const ids = new Map();
  const vid = new Uint32Array(pos.length / 3);
  const P = [];
  for (let i = 0; i < vid.length; i++) {
    const k = key(i);
    let v = ids.get(k);
    if (v === undefined) {
      v = P.length / 3;
      ids.set(k, v);
      P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    vid[i] = v;
  }
  const faces = idx.length / 3;
  const fn = new Float32Array(faces * 3);
  const edges = new Map();
  for (let f = 0; f < faces; f++) {
    const a = vid[idx[f * 3]], b = vid[idx[f * 3 + 1]], c = vid[idx[f * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    fn[f * 3] = nx / l;
    fn[f * 3 + 1] = ny / l;
    fn[f * 3 + 2] = nz / l;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p < q ? p * 4294967296 + q : q * 4294967296 + p;
      const e = edges.get(k);
      if (e) e.push(f);
      else edges.set(k, [f]);
    }
  }
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const out = [], nrm = [];
  for (const [k, fs_] of edges) {
    const p = Math.floor(k / 4294967296), q = k % 4294967296;
    let n = [0, 0, 0];
    if (fs_.length === 2) {
      const [f, g] = fs_;
      const d = fn[f * 3] * fn[g * 3] + fn[f * 3 + 1] * fn[g * 3 + 1] + fn[f * 3 + 2] * fn[g * 3 + 2];
      if (d > cos) continue;
      // a crease keeps the mean of both faces' normals (shorter the sharper the fold)
      n = [(fn[f * 3] + fn[g * 3]) / 2, (fn[f * 3 + 1] + fn[g * 3 + 1]) / 2, (fn[f * 3 + 2] + fn[g * 3 + 2]) / 2];
    } else if (fs_.length === 1) {
      const f = fs_[0];
      n = [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]];
    }
    out.push(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], P[q * 3], P[q * 3 + 1], P[q * 3 + 2]);
    nrm.push(...n, ...n);
  }
  return { positions: new Float32Array(out), normals: new Float32Array(nrm) };
}

fs.mkdirSync(outDir, { recursive: true });
for (const [id, m] of Object.entries(MODELS)) {
  if (only && !only.split(",").includes(id)) continue;
  const doc = await io.read(path.join(srcDir, m.src));
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (m.drop.includes(n.getName())) n.dispose();

  // centre on the bounding box and scale to the real span in metres
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => v - b.min[i]);
  const s = m.span / Math.max(...size);
  const centre = b.max.map((v, i) => (v + b.min[i]) / 2);
  const holder = doc.createNode("craft").setScale([s, s, s]).setTranslation(centre.map((c) => -c * s));
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    holder.addChild(child);
  }
  scene.addChild(holder);

  tidyAttributes(doc);
  await doc.transform(dedup(), flatten(), join(), weld(), prune());
  if (m.ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: m.ratio, error: m.error ?? 0.001 }));

  // feature edges, as a line primitive next to each mesh's triangles
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  const angle = m.edgeAngle ?? (tris > 120_000 ? 42 : tris > 60_000 ? 34 : 26);
  const edgeMat = doc.createMaterial("craft-edges");
  const buffer = root.listBuffers()[0];
  let segs = 0;
  for (const mesh of root.listMeshes()) {
    for (const p of [...mesh.listPrimitives()]) {
      if (p.getMode() !== 4) continue;
      const pa = p.getAttribute("POSITION");
      const ia = p.getIndices();
      const pos = pa.getArray();
      const idx = ia ? ia.getArray() : Uint32Array.from({ length: pa.getCount() }, (_, i) => i);
      const e = featureEdges(pos, idx, angle);
      if (!e.positions.length) continue;
      segs += e.positions.length / 6;
      const lp = doc.createAccessor().setType("VEC3").setArray(e.positions).setBuffer(buffer);
      const ln = doc.createAccessor().setType("VEC3").setArray(e.normals).setBuffer(buffer);
      mesh.addPrimitive(doc.createPrimitive().setMode(1).setAttribute("POSITION", lp).setAttribute("NORMAL", ln).setMaterial(edgeMat));
    }
  }

  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 78 }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const ext of root.listExtensionsUsed()) if (ext instanceof KHRDracoMeshCompression) ext.dispose();
  const file = path.join(outDir, `${id}.glb`);
  await io.write(file, doc);
  console.log(id, Math.round(tris), "tris,", segs, "edges,", (fs.statSync(file).size / 1024).toFixed(0), "KB");
}
void EXTMeshoptCompression;
