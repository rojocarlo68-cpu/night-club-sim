#!/usr/bin/env python3
"""Nova walk (SE = semi-right, as drawn — same facing as the idle) -> public/assets/characters/nova_walk_se_sheet.png
(10 frames of FWx784, transparent) + mirrored SW reference sheet in art_src/nova_walk/ (the game mirrors SE with flipX,
so the SW sheet is reference/verification only).
Input: dir of walk_01..walk_10.png (clean RGBA cutouts from scripts/clean_nova_walk.py, ~470x1670).
One common scale (median figure height -> 476 px, the new idle's body height) for ALL frames, lowest sole on y=610
(NOVA_FEET_ORIGIN_Y 610/784), horizontal anchor = alpha centroid of the torso band (30-60% of figure height) on the
frame centre line -> no size jump vs idle, no sliding. Frame width = smallest even width that crops nothing."""
import sys, glob, os
import numpy as np
from PIL import Image

FH, FEET_Y, BODY_H = 784, 610, 476
src, outdir, refdir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(refdir, exist_ok=True)

frames = []
for f in sorted(glob.glob(os.path.join(src, "walk_*.png"))):
    im = Image.open(f).convert("RGBA")
    a = np.array(im)
    ys, xs = np.where(a[..., 3] > 8)
    c = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    ca = np.array(c)[..., 3] > 40
    h = c.height
    bx = np.where(ca[int(h * .30):int(h * .60)])[1].mean()
    frames.append((c, bx))
heights = [c.height for c, _ in frames]
s = BODY_H / float(np.median(heights))
print("frames", len(frames), "median h", np.median(heights), "range", min(heights), max(heights), "scale", s)

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

res = [(resize(c), bx * s) for c, bx in frames]
half = max(max(bx, r.width - bx) for r, bx in res)
FW = int(np.ceil(half + 2)) * 2
print("frame width", FW)
sheet = Image.new("RGBA", (FW * len(res), FH), (0, 0, 0, 0))
for i, (r, bx) in enumerate(res):
    px = round(FW / 2 - bx)
    py = FEET_Y - r.height
    assert px >= 0 and px + r.width <= FW and py >= 0, (i, px, r.width, py)
    sheet.alpha_composite(r, (i * FW + px, py))
    print(i, "x", px, "w", r.width, "h", r.height, "top", py)
sheet.save(os.path.join(outdir, "nova_walk_se_sheet.png"), optimize=True)
m = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
for i in range(len(res)):
    m.paste(sheet.crop((i * FW, 0, (i + 1) * FW, FH)).transpose(Image.FLIP_LEFT_RIGHT), (i * FW, 0))
m.save(os.path.join(refdir, "nova_walk_sw_sheet.png"), optimize=True)
