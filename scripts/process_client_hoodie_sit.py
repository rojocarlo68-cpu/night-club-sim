#!/usr/bin/env python3
"""Client (hoodie guy) SITTING pose (sofa, no drink):
art_src/client_hoodie_sit_cutout.png -> public/assets/characters/client_hoodie_sit.png

Same on-screen character scale as the hi-res idle sheet (client_hoodie_idle_sheet.png, 560x960 frames = patron
112x192 x5, visible body 940 px): the idle source figure is scaled by 940/idle_height; the sit drawing is drawn a bit
larger (hair/head width 264 vs 241 px in the sources), so it gets that scale / HEAD_RATIO. In game the image is shown at
PATRON_DISPLAY_H/960 (same factor as the idle frames). Legs hang toward lower-left (SW) = the sofa's facing.
Prints the seat anchor (buttocks on the cushion) as origin fractions for Patron.ts (CLIENT_SIT_ORIGIN_X/Y)."""
import sys
import numpy as np
from PIL import Image

idle_src, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
IDLE_H = 940
HEAD_RATIO = 264 / 241
# buttocks contact point (under the hoodie hem, behind the thigh) in the sit cutout's alpha-bbox coords
ANCHOR = (615, 690)
PAD = 6

def bbox(im):
    a = np.array(im)[..., 3]
    ys, xs = np.where(a > 40)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

idle = Image.open(idle_src).convert("RGBA")
ix0, iy0, ix1, iy1 = bbox(idle)
s = IDLE_H / (iy1 - iy0) / HEAD_RATIO

im = Image.open(src).convert("RGBA")
x0, y0, x1, y1 = bbox(im)
crop = im.crop((x0, y0, x1, y1))
w, h = round(crop.width * s), round(crop.height * s)
p = np.array(crop).astype(np.float32)
p[..., :3] *= p[..., 3:4] / 255.0  # premultiply so edges do not pick up dark fringes
chs = [Image.fromarray(p[..., i]).resize((w, h), Image.LANCZOS) for i in range(4)]
q = np.dstack([np.array(c) for c in chs])
al = np.clip(q[..., 3], 0, 255)
rgb = np.where(al[..., None] > 0, q[..., :3] * 255.0 / np.maximum(al[..., None], 1), 0)
res = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
res[..., 3] = np.where(res[..., 3] < 6, 0, res[..., 3])
canvas = Image.new("RGBA", (w + 2 * PAD, h + 2 * PAD), (0, 0, 0, 0))
canvas.alpha_composite(Image.fromarray(res), (PAD, PAD))
canvas.save(out, optimize=True)
ax, ay = ANCHOR[0] * s + PAD, ANCHOR[1] * s + PAD
print("scale", round(s, 4), "size", canvas.size, "anchor px", (round(ax, 1), round(ay, 1)),
      "origin", (round(ax / canvas.width, 4), round(ay / canvas.height, 4)),
      "on-screen h@86/940", round(h * 86 / 940, 1))
