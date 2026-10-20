# Story ships for SANCTUARY, built in Blender from two Sketchfab models (CC BY 4.0, credited in
# the README), then packed by scripts/prep-craft.mjs:
#
#   blender -b -P scripts/story-ships.py -- <folder with the downloads> <out folder>
#   node prep-craft.mjs <out folder> public/craft kestrel,halcyon,vessel
#
# Kestrel (story ship 1, at 50%): the Space Glider, hull breached in several places, one ring
# snapped, torn plates drifting nearby, soot and scorching baked as vertex colours, decimated.
# Halcyon (story ship 2, at 100%): Aquaris, intact, lightly decimated.
# Vessel: the commander's own ship for the cutscenes, its logo plate removed.
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, noise

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]


def load(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o != ob:
            bpy.data.objects.remove(o)
    return ob


def decimate(ob, ratio):
    m = ob.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="dec")


def strip_maps(ob):
    """Keep only the base colour texture (the craft shader reads nothing else)."""
    for mat in ob.data.materials:
        if not mat or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for sock in ["Normal", "Metallic", "Roughness", "Specular IOR Level", "Coat Normal"]:
            s = bsdf.inputs.get(sock)
            if s:
                for l in list(s.links):
                    mat.node_tree.links.remove(l)
        bsdf.inputs["Metallic"].default_value = 0.6
        bsdf.inputs["Roughness"].default_value = 0.45


def export(ob, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print("WROTE", path, os.path.getsize(path))


def bounds(bm):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for v in bm.verts:
        lo = Vector(map(min, lo, v.co)); hi = Vector(map(max, hi, v.co))
    return lo, hi


# ---------------- Kestrel ----------------
from mathutils import Quaternion
rng = random.Random(11)
ob = load("space__glider_-unit.glb")
strip_maps(ob)
me = ob.data
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
lo, hi = bounds(bm)
size = hi - lo
L = max(size)
long_axis = max(range(3), key=lambda i: size[i])
up_axis = 2
mid = (lo + hi) / 2
faces = list(bm.faces)
centres = [f.calc_center_median() for f in faces]


def along(p):
    return (p[long_axis] - lo[long_axis]) / size[long_axis]


def pick(t0, t1, extra=lambda c: True):
    return rng.choice([c for c in centres if t0 < along(c) < t1 and extra(c)])


# breaches in the hull, and the top of one ring snapped off
holes = [
    (pick(0.38, 0.52, lambda c: c[up_axis] > mid[up_axis]), 0.095 * L),
    (pick(0.55, 0.68, lambda c: c[up_axis] > mid[up_axis]), 0.055 * L),
    (pick(0.18, 0.32), 0.05 * L),
    (pick(0.6, 0.78, lambda c: c[up_axis] < mid[up_axis]), 0.07 * L),
    (pick(0.05, 0.16), 0.035 * L),
]
ring_top = max(centres, key=lambda c: c[up_axis])
holes.append((ring_top, 0.08 * L))


def ragged(c, centre, r):
    k = noise.noise(c * (14.0 / L)) * 0.5 + 0.5
    return (c - centre).length < r * (0.65 + 0.7 * k)


doomed = {}
for hi_, (centre, r) in enumerate(holes):
    for f, c in zip(faces, centres):
        if f not in doomed and ragged(c, centre, r):
            doomed[f] = hi_

# a few torn plates drift off each breach; the snapped ring arc drifts as one piece
plates = []
for hi_, (centre, r) in enumerate(holes):
    mine = [f for f, h in doomed.items() if h == hi_]
    if not mine:
        continue
    count, frac = (1, 0.55) if hi_ == len(holes) - 1 else (2, 0.3)
    for _ in range(count):
        seed = rng.choice(mine).calc_center_median()
        patch = [f for f in mine if (f.calc_center_median() - seed).length < r * frac]
        if len(patch) > 3:
            plates.append((patch, centre, hi_ == len(holes) - 1))
for patch, centre, is_ring in plates:
    geom = bmesh.ops.duplicate(bm, geom=patch)
    verts = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)]
    pc = sum((v.co for v in verts), Vector()) / len(verts)
    out = (pc - mid).normalized()
    shift = out * L * (rng.uniform(0.05, 0.09) if is_ring else rng.uniform(0.03, 0.1))
    q = Quaternion(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized(),
                   math.radians(rng.uniform(12, 25) if is_ring else rng.uniform(20, 55)))
    for v in verts:
        v.co = pc + q @ (v.co - pc) + shift
bmesh.ops.delete(bm, geom=list(doomed), context="FACES")
print("breach faces", len(doomed), "plates", len(plates))

# soot and scorch, baked as vertex colours
col = bm.loops.layers.color.new("Col")
for f in bm.faces:
    for loop in f.loops:
        p = loop.vert.co
        v = 1.0
        for centre, r in holes:
            d = (p - centre).length
            v *= 1.0 - 0.9 * math.exp(-((d / (2.8 * r)) ** 2))
        n = noise.noise(p * (6.0 / L)) * 0.5 + 0.5
        v *= 1.0 - 0.6 * max(0.0, min(1.0, (n - 0.42) / 0.25))
        if along(p) < 0.08:
            v *= 0.7
        loop[col] = (v, v * 0.92, v * 0.84, 1.0)
bm.to_mesh(me)
bm.free()
me.update()
for a in [a for a in me.color_attributes if a.name != "Col"]:
    me.color_attributes.remove(a)
me.color_attributes.active_color = me.color_attributes["Col"]
for uv in [uv for uv in me.uv_layers][1:]:
    me.uv_layers.remove(uv)
print("glider tris", sum(len(p.vertices) - 2 for p in me.polygons))
decimate(ob, 0.08)
print("kestrel tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
export(ob, os.path.join(OUT, "kestrel.glb"))

# ---------------- Halcyon ----------------
ob = load("aquaris.glb")
print("aquaris tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
decimate(ob, 0.7)
export(ob, os.path.join(OUT, "halcyon.glb"))

# ---------------- Vessel (the commander's own ship, seen in cutscenes) ----------------
# "Cool Spaceship With Logo": the floating logo plate behind the ship is cut away; nose is +Z.
ob = load("cool_spaceship_with_logo.glb")
strip_maps(ob)
bm = bmesh.new()
bm.from_mesh(ob.data)
# glTF z = -Blender y: the plate sits beyond z = -0.11, clear of the hull
bmesh.ops.delete(bm, geom=[v for v in bm.verts if -v.co.y < -0.11], context="VERTS")
bm.to_mesh(ob.data)
bm.free()
for uv in [uv for uv in ob.data.uv_layers][1:]:
    ob.data.uv_layers.remove(uv)
print("vessel tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
export(ob, os.path.join(OUT, "vessel.glb"))
