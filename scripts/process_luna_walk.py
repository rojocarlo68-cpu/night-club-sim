#!/usr/bin/env python3
"""Luna walk (2 alternative variants, SE = semi-right) -> public/assets/characters/luna_walk_{a,b}_se_sheet.png
(10 frames of 200x784, transparent) + mirrored SW sheets in art_src/luna_walk/ (the game mirrors SE with flipX,
so SW sheets are reference/verification only).
Input: dirs of walk_01..walk_10.png (RGBA, ~350-470 x ~1090). One common scale (median figure height -> 416 px,
the idle's body height) for ALL frames of BOTH variants, feet (lowest sole pixel) on y=583, horizontal anchor =
alpha centroid of the torso band (30-60% of figure height) on the frame centre line -> no size jump vs idle,
no sliding. Nothing is cropped (frame 200 wide > widest figure ~175)."""
import sys, glob, os
import numpy as np
from PIL import Image

FW, FH, FEET_Y, BODY_H = 200, 784, 583, 416
dirs = {"a": sys.argv[1], "b": sys.argv[2]}
outdir, refdir = sys.argv[3], sys.argv[4]
os.makedirs(refdir, exist_ok=True)

frames = {}
for v, d in dirs.items():
    frames[v] = []
    for f in sorted(glob.glob(os.path.join(d, "walk_*.png"))):
        im = Image.open(f).convert("RGBA")
        a = np.array(im)
        ys, xs = np.where(a[..., 3] > 8)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        c = im.crop((x0, y0, x1, y1))
        ca = np.array(c)[..., 3] > 40
        h = c.height
        band = ca[int(h * .30):int(h * .60)]
        bx = np.where(band)[1].mean()
        frames[v].append((c, bx))
heights = [c.height for v in frames for c, _ in frames[v]]
s = BODY_H / float(np.median(heights))
print("median h", np.median(heights), "range", min(heights), max(heights), "scale", s)

def resize(c):
    w, h = round(c.width * s), round(c.height * s)
    p = np.array(c).astype(np.float32)
    p[..., :3] *= p[..., 3:4] / 255.0
    q = np.dstack([np.array(Image.fromarray(p[..., i]).resize((w, h), Image.LANCZOS)) for i in range(4)])
    al = np.clip(q[..., 3], 0, 255)
    rgb = np.where(al[..., None] > 0, q[..., :3] * 255.0 / np.maximum(al[..., None], 1), 0)
    r = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
    r[..., 3] = np.where(r[..., 3] < 6, 0, r[..., 3])
    return Image.fromarray(r)

for v, fl in frames.items():
    sheet = Image.new("RGBA", (FW * len(fl), FH), (0, 0, 0, 0))
    for i, (c, bx) in enumerate(fl):
        r = resize(c)
        px = round(FW / 2 - bx * s)
        py = FEET_Y - r.height
        assert px >= 0 and px + r.width <= FW, (v, i, px, r.width)
        fr = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
        fr.alpha_composite(r, (px, py))
        sheet.alpha_composite(fr, (i * FW, 0))
        print(v, i, "x", px, "w", r.width, "h", r.height, "top", py)
    sheet.save(os.path.join(outdir, f"luna_walk_{v}_se_sheet.png"), optimize=True)
    # mirror each frame in place (frame-wise flip keeps the frame centre line)
    m = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    for i in range(len(fl)):
        m.paste(sheet.crop((i * FW, 0, (i + 1) * FW, FH)).transpose(Image.FLIP_LEFT_RIGHT), (i * FW, 0))
    m.save(os.path.join(refdir, f"luna_walk_{v}_sw_sheet.png"), optimize=True)
