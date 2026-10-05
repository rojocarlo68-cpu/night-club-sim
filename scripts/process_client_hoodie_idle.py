#!/usr/bin/env python3
"""Client (hoodie guy) hi-res idle: art_src/client_hoodie_idle_cutout.png -> public/assets/characters/client_hoodie_idle_sheet.png
Sheet = 2 frames of 560x960: frame 0 = SE (looks semi-right, as drawn), frame 1 = SW (exact horizontal mirror).
Same on-screen scale as the existing 112x192 patron sheets (x5): visible body 940 px of the 960 frame (= patron 188/192),
lowest shoe sole at y=950 (= PATRON_FEET_ORIGIN_Y 190/192), feet midpoint on the frame centre column."""
import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
FW, FH, FEET_Y, H = 560, 960, 950, 940
im = Image.open(src).convert("RGBA")
a = np.array(im)
ys, xs = np.where(a[..., 3] > 40)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
crop = im.crop((x0, y0, x1, y1))
s = H / crop.height
w = round(crop.width * s)
# feet centre = alpha centroid of the lowest 6% of the figure
ca = np.array(crop)[..., 3]
lo = ca[int(ca.shape[0] * 0.94):]
fx = (np.where(lo > 40)[1]).mean()
p = np.array(crop).astype(np.float32)
p[..., :3] *= p[..., 3:4] / 255.0
chs = [Image.fromarray(p[..., i]).resize((w, H), Image.LANCZOS) for i in range(4)]
q = np.dstack([np.array(c) for c in chs])
al = np.clip(q[..., 3], 0, 255)
rgb = np.where(al[..., None] > 0, q[..., :3] * 255.0 / np.maximum(al[..., None], 1), 0)
res = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
res[..., 3] = np.where(res[..., 3] < 6, 0, res[..., 3])
px = round(FW / 2 - fx * s)
assert px >= 0 and px + w <= FW, (px, w)
frame = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
frame.alpha_composite(Image.fromarray(res), (px, FEET_Y - H))
sheet = Image.new("RGBA", (FW * 2, FH), (0, 0, 0, 0))
sheet.paste(frame, (0, 0))
sheet.paste(frame.transpose(Image.FLIP_LEFT_RIGHT), (FW, 0))
sheet.save(out, optimize=True)
print("scale", s, "w", w, "paste x", px, "feet fx", fx * s, "bbox", frame.getbbox())
