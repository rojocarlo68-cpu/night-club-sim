#!/usr/bin/env python3
"""Luna BACK walk (NE/NW) -> public/assets/characters/luna_walk_back_ne_sheet.png (10 frames of 200x784, transparent).
Input: dir of walk_01..walk_10.png (RGBA, already cut out, ~544 x ~1640, Luna seen from behind, head turned to image-LEFT).
Same normalisation as process_luna_walk.py / process_luna_idle_back.py: ONE scale for all frames (median figure height ->
416 px = idle body height), lowest sole pixel on y=583, horizontal anchor = alpha centroid of the torso band (30-60% of
figure height) on the frame centre line (no sliding / no size jump vs idle). Nothing cropped.
Orientation: the source looks/walks to the LEFT. Like luna_idle_back_standing.png the game sheet is saved MIRRORED
(looks RIGHT) -> NE = unflipped, NW = flipX (= original orientation). The un-mirrored reference sheet goes to refdir."""
import sys, glob, os
import numpy as np
from PIL import Image

FW, FH, FEET_Y, BODY_H = 200, 784, 583, 416
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
s = BODY_H / float(np.median([c.height for c, _ in frames]))
print("n", len(frames), "scale", s)

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

orig = Image.new("RGBA", (FW * len(frames), FH), (0, 0, 0, 0))
mirr = Image.new("RGBA", orig.size, (0, 0, 0, 0))
for i, (c, bx) in enumerate(frames):
    r = resize(c)
    px = round(FW / 2 - bx * s)
    py = FEET_Y - r.height
    assert px >= 0 and px + r.width <= FW, (i, px, r.width)
    fr = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    fr.alpha_composite(r, (px, py))
    orig.alpha_composite(fr, (i * FW, 0))
    mirr.paste(fr.transpose(Image.FLIP_LEFT_RIGHT), (i * FW, 0))
    print(i, "x", px, "w", r.width, "h", r.height, "top", py)
mirr.save(os.path.join(outdir, "luna_walk_back_ne_sheet.png"), optimize=True)   # looks RIGHT (NE); NW = flipX
orig.save(os.path.join(refdir, "luna_walk_back_nw_sheet.png"), optimize=True)   # looks LEFT (source orientation)
