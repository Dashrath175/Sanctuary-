"""Build the game's sky assets from public sources.

usage: python -I prep_sky.py <hyg.csv.gz> <gaia.png> <public/sky dir> <src/lib/data dir>

- stars.bin: every HYG star through magnitude 8 (Sol excluded), brightest first, 8 bytes each:
  int16 x, y, z (J2000 ecliptic unit vector * 32767), uint8 (mag + 2) * 20, uint8 spectral class.
- named-stars.json: stars with an IAU proper name: [name, raDeg, decDeg, mag, class].
- milkyway-4k.jpg / milkyway-2k.jpg: the Gaia EDR3 all-sky map (galactic, equirectangular).
"""
import csv, gzip, io, json, math, os, struct, sys

from PIL import Image

hyg, gaia, out_public, out_data = sys.argv[1:5]
os.makedirs(out_public, exist_ok=True)
os.makedirs(out_data, exist_ok=True)

EPS = math.radians(23.4392911)
CLASSES = "OBAFGKM"


def cls_of(spect: str) -> int:
    s = (spect or "").strip().upper()
    # strip luminosity prefixes such as "sd", "d", "g" that HYG keeps on some entries
    while s and s[0] in "DGS" and len(s) > 1 and s[1] in CLASSES:
        s = s[1:]
    if not s:
        return 8
    c = s[0]
    if c in CLASSES:
        return CLASSES.index(c)
    return 7


rows = []
named = []
with gzip.open(hyg, "rt", encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f):
        if r["id"] == "0":
            continue
        try:
            mag = float(r["mag"])
            ra = float(r["ra"]) * 15.0
            dec = float(r["dec"])
        except ValueError:
            continue
        if mag > 8.0:
            continue
        a, d = math.radians(ra), math.radians(dec)
        x, y, z = math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)
        ex, ey, ez = x, y * math.cos(EPS) + z * math.sin(EPS), -y * math.sin(EPS) + z * math.cos(EPS)
        k = cls_of(r["spect"])
        rows.append((mag, ex, ey, ez, k))
        name = (r["proper"] or "").strip()
        if name:
            named.append([name, round(ra, 5), round(dec, 5), round(mag, 2), k])

rows.sort(key=lambda t: t[0])
buf = io.BytesIO()
q = lambda v: max(-32767, min(32767, int(round(v * 32767))))
for mag, x, y, z, k in rows:
    buf.write(struct.pack("<hhhBB", q(x), q(y), q(z), max(0, min(255, int(round((mag + 2) * 20)))), k))
open(os.path.join(out_public, "stars.bin"), "wb").write(buf.getvalue())

named.sort(key=lambda t: t[3])
json.dump(named, open(os.path.join(out_data, "named-stars.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

counts = [0] * 9
for r in rows:
    counts[r[4]] += 1
print("stars", len(rows), "named", len(named), "classes", dict(zip(list(CLASSES) + ["other", "unknown"], counts)))

img = Image.open(gaia).convert("RGB")
for w, name, quality in ((4000, "milkyway-4k.jpg", 74), (2000, "milkyway-2k.jpg", 80)):
    im = img if img.width == w else img.resize((w, w // 2), Image.LANCZOS)
    im.save(os.path.join(out_public, name), "JPEG", quality=quality, optimize=True, progressive=True)
    print(name, os.path.getsize(os.path.join(out_public, name)))
