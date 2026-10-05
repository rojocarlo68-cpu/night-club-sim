#!/usr/bin/env python3
"""Client (hoodie guy) walk, SE = semi-right (as drawn) -> public/assets/characters/client_hoodie_walk_se_sheet.png
(10 frames of 560x960 in a 5x2 grid, transparent) + the frame-wise mirrored SW reference sheet in refdir
(the game mirrors SE with flipX, so the SW sheet is reference/verification only).
Input: dir of walk_01..walk_10.png (RGBA, already cut out, ~480-545 x ~1590-1630; walk_10 had a white patch between
the legs that was removed beforehand). Same frame as the new idle (client_hoodie_idle_sheet.png): 560x960 frames,
ONE scale for all frames (median figure height -> 940 px = idle body height = patron 188/192 x5; capped so the tallest
frame fits: ~0.5% smaller), lowest sole pixel on
y=950 (= PATRON_FEET_ORIGIN_Y), horizontal anchor = alpha centroid of the torso band (30-60% of figure height) on the
same x as the idle's torso band (no head/torso pop when starting/stopping). Nothing is cropped."""
import sys, glob, os
import numpy as np
from PIL import Image

FW, FH, FEET_Y, BODY_H, COLS = 560, 960, 950, 940, 5
src, idle_sheet, outdir, refdir = sys.argv[1:5]
os.makedirs(refdir, exist_ok=True)

def torso_x(a):
    ys, xs = np.where(a > 40)
    h = ys.max() - ys.min() + 1
    y0 = ys.min() + int(h * .30); y1 = ys.min() + int(h * .60)
    band = a[y0:y1] > 40
    return np.where(band)[1].mean()

idle = np.array(Image.open(idle_sheet).convert("RGBA").crop((0, 0, FW, FH)))[..., 3]
anchor_x = torso_x(idle)
print("idle torso x", anchor_x)

frames = []
for f in sorted(glob.glob(os.path.join(src, "walk_*.png"))):
    im = Image.open(f).convert("RGBA")
    a = np.array(im)
    ys, xs = np.where(a[..., 3] > 8)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    c = im.crop((x0, y0, x1, y1))
    bx = torso_x(np.array(c)[..., 3])
    frames.append((c, bx))
assert len(frames) == 10, len(frames)
# median height -> idle body height, but the tallest frame must still fit above the soles (frame top margin >= 4 px)
s = min(BODY_H / float(np.median([c.height for c, _ in frames])), (FEET_Y - 4) / float(max(c.height for c, _ in frames)))
print("scale", s, "heights", [c.height for c, _ in frames])

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

rows = (len(frames) + COLS - 1) // COLS
sheet = Image.new("RGBA", (FW * COLS, FH * rows), (0, 0, 0, 0))
mirror = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
for i, (c, bx) in enumerate(frames):
    r = resize(c)
    px = round(anchor_x - bx * s)
    py = FEET_Y - r.height
    assert px >= 0 and px + r.width <= FW and py >= 0, (i, px, r.width, py)
    fr = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    fr.alpha_composite(r, (px, py))
    pos = ((i % COLS) * FW, (i // COLS) * FH)
    sheet.alpha_composite(fr, pos)
    mirror.alpha_composite(fr.transpose(Image.FLIP_LEFT_RIGHT), pos)
    print(i, "x", px, "w", r.width, "h", r.height, "top", py, "bbox", fr.getbbox())
sheet.save(os.path.join(outdir, "client_hoodie_walk_se_sheet.png"), optimize=True)
mirror.save(os.path.join(refdir, "client_hoodie_walk_sw_sheet.png"), optimize=True)
