#!/usr/bin/env python3
"""Luna front idle: single static standing pose -> public/assets/characters/luna_idle_standing.png (146x784, 1 frame).
Input: JPG on white (/workspace/lunaidle/cut.png is the cutout made by the cut2 step: border/enclosed pure-white
flood + 2x2 opening to drop the dotted halo + 1px erode/decontaminate). Visible height 416 px (old art ~417),
feet (shoe soles) on y=583 so LUNA_FEET_ORIGIN_Y / LUNA_DISPLAY_H are unchanged."""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]; out = sys.argv[2]
FW, FH, FEET_Y, H = 146, 784, 583, 416
im = Image.open(src).convert("RGBA")
a = np.array(im)
ys, xs = np.where(a[..., 3] > 40)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
crop = im.crop((x0, y0, x1, y1))
s = H / crop.height
w = round(crop.width * s)
# premultiplied resize -> no white/dark fringes
p = np.array(crop).astype(np.float32)
p[..., :3] *= p[..., 3:4] / 255.0
chs = [Image.fromarray(p[..., i]).resize((w, H), Image.LANCZOS) for i in range(4)]
q = np.dstack([np.array(c) for c in chs])
al = np.clip(q[..., 3], 0, 255)
rgb = np.where(al[..., None] > 0, q[..., :3] * 255.0 / np.maximum(al[..., None], 1), 0)
res = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
res[..., 3] = np.where(res[..., 3] < 6, 0, res[..., 3])
frame = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
cx_src = 91 - x0  # art column that sits on the frame's centre line (fits 146 wide without clipping)
px = round(FW / 2 - cx_src * s)
frame.alpha_composite(Image.fromarray(res), (px, FEET_Y - H))
frame.save(out, optimize=True)
print("scale", s, "w", w, "paste x", px, "bbox", frame.getbbox())
