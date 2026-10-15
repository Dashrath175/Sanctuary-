"""Build the survey maps for planets and moons from public NASA/USGS mosaics.

usage: python -I scripts/prep-maps.py <source dir> <public/maps dir> [ids...]

Only brightness is kept: the game recolours each map in the body's own two survey colours,
traces contours and edges from it and stipples it in the shader. For every body this writes
  <id>.jpg     2048 x 1024 (1024 x 512 when the source is smaller), greyscale
  <id>-1k.jpg  1024 x 512, for phones
  <id>-s.jpg   512 x 256, for the records grid
Bodies without a usable global mosaic get a procedural map (craters, bands) instead.
Sources (all public domain unless noted) are listed in README.md.

Gaps in the source mosaics (flat black or flat white fill) are reconstructed from the
opposite hemisphere: an artistic stand-in for terrain no spacecraft has photographed.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)

# id: (file, options)
MAPS = {
    "mercury": ("Mercury.jpg", {}),
    "venus": ("Venus.jpg", {}),
    "earth": ("Earth - Blue Marble.jpg", {"blend": ("Earth (A).jpg", 0.45)}),
    "moon": ("Moon - LROC 2k.jpg", {}),
    "mars": ("Mars.jpg", {}),
    "phobos": ("Mars - Phobos.jpg", {}),
    "deimos": ("Mars - Deimos.jpg", {}),
    "jupiter": ("Jupiter.jpg", {}),
    "io": ("Jupiter - Io (A).jpg", {}),
    "europa": ("Jupiter - Europa.jpg", {}),
    "ganymede": ("Jupiter - Ganymede.jpg", {"white": 236}),
    "callisto": ("Jupiter - Callisto.jpg", {"white": 225}),
    "saturn": ("Saturn.jpg", {}),
    "mimas": ("Saturn - Mimas.jpg", {"white": 225}),
    "enceladus": ("Saturn - Enceladus.jpg", {"white": 236}),
    "tethys": ("Saturn - Tethys.jpg", {"white": 225}),
    "dione": ("Saturn - Dione.jpg", {"white": 225}),
    "rhea": ("Saturn - Rhea.jpg", {}),
    "titan": ("Titan.jpg", {"crop": (88, 97, 1990, 1053)}),
    "iapetus": ("Saturn - Iapetus.jpg", {}),
    "ariel": ("Uranus - Ariel.jpg", {"black": 4}),
    "umbriel": ("Uranus - Umbriel.jpg", {"black": 4}),
    "titania": ("Uranus - Titania.jpg", {"black": 4}),
    "oberon": ("Uranus - Oberon.jpg", {"black": 4}),
    "miranda": ("Uranus - Miranda.jpg", {"black": 4}),
    "neptune": ("Neptune.jpg", {}),
    "triton": ("Triton.jpg", {"black": 6}),
    "pluto": ("Pluto.jpg", {}),
    "charon": ("Pluto - Charon.jpg", {}),
    "ceres": ("Ceres-mercator.jpg", {"mercator": True}),
}


def mercator_to_equirect(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A full-width Mercator map (height = width / 2) resampled to equirectangular rows."""
    h, w = a.shape
    out = np.zeros_like(a)
    valid = np.zeros(a.shape, bool)
    scale = w / (2 * math.pi)
    for y in range(h):
        lat = math.pi / 2 - (y + 0.5) / h * math.pi
        if abs(lat) > math.radians(84):
            continue
        ym = math.log(math.tan(math.pi / 4 + lat / 2))
        sy = h / 2 - ym * scale
        if 0 <= sy < h - 1:
            i = int(sy)
            f = sy - i
            out[y] = a[i] * (1 - f) + a[i + 1] * f
            valid[y] = True
    return out, valid


def polar_fill(a: np.ndarray, missing: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fill gaps that reach the north edge of the map (the unseen hemisphere) by reflecting
    the terrain below them across a smoothed edge of the coverage, so neighbouring columns
    fold the same way and no streaks appear."""
    h, w = a.shape
    valid = ~missing
    first = np.where(valid.any(axis=0), np.argmax(valid, axis=0), h).astype(float)
    if not (first > 0).any():
        return a, missing
    # smooth the coverage edge round the globe, ignoring columns with no coverage at all
    k = 61
    seen = (first < h).astype(float)
    wrap = lambda v: np.concatenate((v[-k:], v, v[:k]))
    num = np.convolve(wrap(first * seen), np.ones(k), mode="same")[k:-k]
    den = np.convolve(wrap(seen), np.ones(k), mode="same")[k:-k]
    edge = np.where(den > 0, num / np.maximum(den, 1e-9), h)
    edge = np.minimum(edge, h - 8)
    Y, X = np.mgrid[0:h, 0:w]
    gap = Y < first[None, :]
    lo = np.maximum(np.ceil(edge), first)[None, :] + 2
    span = np.maximum(h - 1 - lo, 1)
    d = 2 * edge[None, :] - Y + 2 - lo  # how far past the edge the mirror lands
    t = np.mod(d, 2 * span)
    src = lo + np.where(t < span, t, 2 * span - t)
    src = np.clip(np.round(src).astype(int), 0, h - 1)
    out = a.copy()
    out[gap] = a[src[gap], X[gap]]
    still = missing.copy()
    still[gap] = ~valid[src[gap], X[gap]]
    return out, still


def fill_gaps(a: np.ndarray, missing: np.ndarray) -> np.ndarray:
    """Reconstruct gaps: unseen polar regions by reflection, the rest from the far side of the
    globe at the same latitude, anything left with the mean brightness."""
    h, w = a.shape
    filled, left = a.copy(), missing.copy()
    # columns with almost nothing in them borrow the far side of the globe first
    empty = left.mean(axis=0) > 0.9
    far = np.roll(filled, w // 2, axis=1)
    far_ok = np.roll(~left, w // 2, axis=1)
    take = left & far_ok & empty[None, :]
    filled[take] = far[take]
    left &= ~take
    filled, left = polar_fill(filled, left)
    f2, l2 = polar_fill(filled[::-1].copy(), left[::-1].copy())
    filled, left = f2[::-1], l2[::-1]
    far = np.roll(filled, w // 2, axis=1)
    far_ok = np.roll(~left, w // 2, axis=1)
    take = left & far_ok
    filled[take] = far[take]
    left &= ~take
    if left.any():
        filled[left] = filled[~left].mean()
    # soften the seams where filled terrain meets the real mosaic
    blurred = np.asarray(Image.fromarray((filled * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), float) / 255
    edge = np.asarray(Image.fromarray((missing * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), float) / 255
    k = np.clip(edge * (1 - edge) * 4, 0, 1)
    return filled * (1 - k) + blurred * k


def flat(a: np.ndarray, radius: int = 4) -> np.ndarray:
    """Local standard deviation: near zero where a mosaic was padded with flat fill."""
    img = lambda x: Image.fromarray(np.clip(x * 255, 0, 255).astype(np.uint8))
    m = np.asarray(img(a).filter(ImageFilter.BoxBlur(radius)), float) / 255
    m2 = np.asarray(Image.fromarray(np.clip(a * a * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(radius)), float) / 255
    return np.sqrt(np.clip(m2 - m * m, 0, None))


def build(key: str, file: str, opt: dict) -> None:
    im = Image.open(os.path.join(src, file)).convert("L")
    if "crop" in opt:
        im = im.crop(opt["crop"])
    if im.width / im.height > 2.05 or im.width / im.height < 1.95:
        im = im.resize((im.width, im.width // 2), Image.LANCZOS)
    a = np.asarray(im, float) / 255
    if "blend" in opt:
        # mix in a second map (Earth: shaded relief and sea-floor depth under the Blue Marble)
        other, w = opt["blend"]
        b = Image.open(os.path.join(src, other)).convert("L").resize((im.width, im.height), Image.LANCZOS)
        a = a * (1 - w) + np.asarray(b, float) / 255 * w
    missing = np.zeros(a.shape, bool)
    if opt.get("mercator"):
        a, valid = mercator_to_equirect(a)
        missing |= ~valid
    if "black" in opt:
        missing |= a * 255 <= opt["black"]
    if "white" in opt:
        # flat, bright padding (real bright terrain still has texture)
        missing |= (a * 255 >= opt["white"]) & (flat(a) < 0.025)
    # grow the gap masks a little so their anti-aliased rims go too; a polar gap often has a
    # thin border of real pixels along the map edge, so the edge rows count as gap with it
    if missing.any():
        rim = max(4, a.shape[0] // 120)
        missing[:rim] |= missing[rim : 2 * rim].any(axis=0)[None, :]
        missing[-rim:] |= missing[-2 * rim : -rim].any(axis=0)[None, :]
        grown = Image.fromarray((missing * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
        missing = np.asarray(grown) > 0
        a = fill_gaps(a, missing)
    save(key, a, im.width >= 1400)


EDGES: dict[str, float] = {}


def smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def edge_gain(a: np.ndarray, target: float = 0.3) -> float:
    """How strongly the shader should weigh brightness edges so that about `target` of the
    map lights up as survey points (busy crater maps would otherwise glare)."""
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)  # as the GPU samples it
    q = (np.abs(lin - np.roll(lin, -1, 1)) + np.abs(lin - np.roll(lin, -1, 0))) * 1.732
    contour = 1 - smooth(0.025, 1.05 * 0.13 + 0.026, np.abs(np.sin(lin * 85)))
    r = np.random.default_rng(1).random(lin.shape)
    lo, hi = 0.4, 5.0
    if smooth(0.33, 0.7, q * hi + contour * 0.65 + r * 0.32).mean() <= target:
        return hi
    for _ in range(18):
        k = (lo + hi) / 2
        if smooth(0.33, 0.7, q * k + contour * 0.65 + r * 0.32).mean() > target:
            hi = k
        else:
            lo = k
    return round((lo + hi) / 2, 3)


def save(key: str, a: np.ndarray, large: bool) -> None:
    # stretch the brightness range so every map uses the full survey palette
    lo, hi = np.percentile(a, 1), np.percentile(a, 99)
    a = np.clip((a - lo) / max(hi - lo, 1e-3), 0, 1) * 0.88 + 0.06
    img = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    sample = np.asarray(img.resize((2048, 1024) if large else (1024, 512), Image.LANCZOS), float) / 255
    EDGES[key] = edge_gain(sample)
    big = (2048, 1024) if large else (1024, 512)
    for name, size in ((f"{key}.jpg", big), (f"{key}-1k.jpg", (1024, 512)), (f"{key}-s.jpg", (512, 256))):
        img.resize(size, Image.LANCZOS).save(os.path.join(out, name), quality=74, optimize=True, progressive=True)
    print(key, big, os.path.getsize(os.path.join(out, f"{key}.jpg")) // 1024, "KB", "edge", EDGES[key])


# ---------- procedural maps for bodies no spacecraft has mapped (or mapped only in part) ----------


def sphere(w: int, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    lon = (np.arange(w) + 0.5) / w * 2 * math.pi - math.pi
    lat = math.pi / 2 - (np.arange(h) + 0.5) / h * math.pi
    LON, LAT = np.meshgrid(lon, lat)
    return np.cos(LAT) * np.cos(LON), np.sin(LAT), np.cos(LAT) * np.sin(LON), LAT


def vnoise(x: np.ndarray, y: np.ndarray, z: np.ndarray, seed: float) -> np.ndarray:
    """3D value noise in [0, 1], smooth, on a unit lattice."""
    xi, yi, zi = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - xi, y - yi, z - zi
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)

    def h(i, j, k):
        n = np.sin((xi + i) * 127.1 + (yi + j) * 311.7 + (zi + k) * 74.7 + seed * 13.13) * 43758.5453
        return n - np.floor(n)

    x0 = h(0, 0, 0) * (1 - fx) + h(1, 0, 0) * fx
    x1 = h(0, 1, 0) * (1 - fx) + h(1, 1, 0) * fx
    x2 = h(0, 0, 1) * (1 - fx) + h(1, 0, 1) * fx
    x3 = h(0, 1, 1) * (1 - fx) + h(1, 1, 1) * fx
    return (x0 * (1 - fy) + x1 * fy) * (1 - fz) + (x2 * (1 - fy) + x3 * fy) * fz


def fbm(x, y, z, seed, octaves=5, freq=2.0):
    s, amp, tot = 0.0, 0.5, 0.0
    for o in range(octaves):
        s = s + amp * vnoise(x * freq, y * freq, z * freq, seed + o * 7.7)
        tot += amp
        freq *= 2.07
        amp *= 0.5
    return s / tot


def cratered(seed: int, w: int, h: int, count: int, dark: float = 0.0) -> np.ndarray:
    X, Y, Z, _ = sphere(w, h)
    rng = np.random.default_rng(seed)
    a = 0.45 + (fbm(X, Y, Z, seed, 6, 1.6) - 0.5) * 0.9
    a += (fbm(X, Y, Z, seed + 50, 4, 9.0) - 0.5) * 0.25
    for _ in range(count):
        v = rng.normal(size=3)
        v /= np.linalg.norm(v)
        r = 0.035 * rng.pareto(1.6) + 0.02
        r = min(r, 0.45)
        cosang = np.clip(X * v[0] + Y * v[1] + Z * v[2], -1, 1)
        d = np.arccos(cosang) / r
        near = d < 2.2
        if not near.any():
            continue
        dd = d[near]
        bowl = -0.28 * np.clip(1 - (dd / 0.85) ** 2, 0, 1)
        rim = 0.22 * np.exp(-((dd - 1.0) / 0.12) ** 2)
        ejecta = 0.05 * np.exp(-((dd - 1.3) / 0.35) ** 2)
        a[near] += (bowl + rim + ejecta) * (0.6 + 0.4 * rng.random())
    if dark:
        a -= dark * (fbm(X, Y, Z, seed + 99, 3, 1.2) > 0.55)
    return a


def ice_giant(seed: int, w: int, h: int) -> np.ndarray:
    X, Y, Z, LAT = sphere(w, h)
    warp = fbm(X, Y, Z, seed, 4, 2.0)
    bands = 0.5 + 0.06 * np.sin(LAT * 14 + warp * 3) + 0.04 * np.sin(LAT * 31 + warp * 5)
    streaks = (fbm(X * 0.6, Y * 6.0, Z * 0.6, seed + 3, 5, 2.5) - 0.5) * 0.18
    hood = 0.16 * np.clip((-LAT - 0.9) / 0.6, 0, 1)  # the bright southern polar hood
    return bands + streaks + hood


PROCEDURAL = {
    "uranus": lambda w, h: ice_giant(7, w, h),
    "vesta": lambda w, h: cratered(41, w, h, 260, 0.08),
    "pallas": lambda w, h: cratered(42, w, h, 220),
    "hygiea": lambda w, h: cratered(43, w, h, 200, 0.05),
    "psyche": lambda w, h: cratered(44, w, h, 160),
    "hyperion": lambda w, h: cratered(45, w, h, 520),
    "eros": lambda w, h: cratered(46, w, h, 240),
    "gaspra": lambda w, h: cratered(47, w, h, 200),
    "ida": lambda w, h: cratered(48, w, h, 300),
    "bennu": lambda w, h: cratered(49, w, h, 120, 0.1),
    "ryugu": lambda w, h: cratered(50, w, h, 120, 0.1),
}


only = set(sys.argv[3:])
edges_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "data", "map-edges.json")
if only and os.path.exists(edges_file):
    EDGES.update(json.load(open(edges_file, encoding="utf-8")))
for key, (file, opt) in MAPS.items():
    if not only or key in only:
        build(key, file, opt)
for key, make in PROCEDURAL.items():
    if not only or key in only:
        save(key, make(1024, 512), False)
with open(edges_file, "w", encoding="utf-8") as fh:
    json.dump(dict(sorted(EDGES.items())), fh, indent=1)
print("edge gains:", EDGES)
