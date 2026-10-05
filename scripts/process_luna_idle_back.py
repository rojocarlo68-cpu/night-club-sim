#!/usr/bin/env python3
"""Luna back idle (NE/NW): single static frame -> public/assets/characters/luna_idle_back_standing.png (146x784, 1 frame).
Input: art_src/luna_idle_back_cutout.png (see cut_luna_idle_back.py). Same normalisation as the front idle: visible height
416 px, shoe soles on y=583 (LUNA_FEET_ORIGIN_Y / LUNA_DISPLAY_H unchanged). The source looks to image-LEFT; the PNG is saved
MIRRORED (looks right) so NE (unflipped) looks toward its travel direction, and NW = flipX of it = the original orientation."""
import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
FW, FH, FEET_Y, H = 146, 784, 583, 416
im = Image.open(src).convert("RGBA")
a = np.array(im)
ys, xs = np.where(a[..., 3] > 40)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
crop = im.crop((x0, y0, x1, y1))
s = H / crop.height
w = round(crop.width * s)
p = np.array(crop).astype(np.float32)
p[..., :3] *= p[..., 3:4] / 255.0
chs = [Image.fromarray(p[..., i]).resize((w, H), Image.LANCZOS) for i in range(4)]
q = np.dstack([np.array(c) for c in chs])
al = np.clip(q[..., 3], 0, 255)
rgb = np.where(al[..., None] > 0, q[..., :3] * 255.0 / np.maximum(al[..., None], 1), 0)
res = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
res[..., 3] = np.where(res[..., 3] < 6, 0, res[..., 3])
frame = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
# feet centre column (src) ~357 px from bbox left -> keep body inside the 146 frame (hand/ponytail touch the edges)
px = max(0, min(FW - w, round(FW / 2 - 357 * s)))
frame.alpha_composite(Image.fromarray(res), (px, FEET_Y - H))
frame = frame.transpose(Image.FLIP_LEFT_RIGHT)  # saved mirrored (looks right) => NE; NW = flipX
frame.save(out, optimize=True)
print("scale", s, "w", w, "paste x", px, "bbox", frame.getbbox())
