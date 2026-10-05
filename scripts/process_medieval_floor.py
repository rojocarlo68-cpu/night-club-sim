#!/usr/bin/env python3
"""Single-image 12x12 floor: art_src/medieval/floor_planks_src.jpg (2000x1008, white bg, slab thickness
visible on the lower edges) -> public/assets/tiles/floor_planks.png (1536x768 RGBA, = 12x12 grid diamond
of 768x384 displayed px at 2x).

The top surface of the source is an exact 2:1 diamond (fitted: edge slopes 0.5000/0.4998). Only that
surface is kept (the slab side is cropped away). Steps: fit diamond -> erode 3 src px and extend the
interior colours outward (no white halo) -> resample to 1536x768 -> hard pixel-centre diamond mask
|cx|/768 + |cy|/384 < 1 (same rule FloorRenderer uses), so tile edges are exact 2:1 and seam-free.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art_src/medieval/floor_planks_src.jpg')
OUT = os.path.join(ROOT, 'public/assets/tiles/floor_planks.png')

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float64)
H, W = a.shape[:2]

# --- fit the top-surface diamond from the (clean) upper-left / upper-right edges ---
cov = np.clip((255 - a.min(axis=2)) / 90.0, 0, 1)
L, R = [], []
for y in range(60, 440):
    r = cov[y]
    xs = np.nonzero(r > 0.5)[0]
    x0, x1 = xs[0], xs[-1]
    L.append((y + 0.5, x0 - cov[y, x0 - 3:x0 + 1].sum()))
    R.append((y + 0.5, x1 + 1 + cov[y, x1 + 1:x1 + 4].sum()))
L = np.array(L); R = np.array(R)
pl = np.polyfit(L[:, 0], L[:, 1], 1); pr = np.polyfit(R[:, 0], R[:, 1], 1)
ty = (pr[1] - pl[1]) / (pl[0] - pr[0]); tx = pl[0] * ty + pl[1]
print('edge slopes dy/dx: left %.4f right %.4f' % (-1 / pl[0], 1 / pr[0]), 'top vertex', round(tx, 2), round(ty, 2))
HW = 999.0           # half width of the surface diamond (left vertex touches x~0.9, right x~1998.9)
HH = HW / 2

yy, xx = np.mgrid[0:H, 0:W]
d = np.abs(xx + 0.5 - tx) / HW + np.abs(yy + 0.5 - (ty + HH)) / HH
inside = d < 1 - 3.0 / HH           # erode ~3 src px (kills white fringe + slab-edge blend)
idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True)
clean = a[idx[0], idx[1]]            # outside pixels take the nearest interior colour
clean_img = Image.fromarray(np.clip(clean + 0.5, 0, 255).astype(np.uint8))

OW, OH = 1536, 768
box = (tx - HW, ty, tx + HW, ty + 2 * HH)
out = np.asarray(clean_img.resize((OW, OH), Image.LANCZOS, box=box)).copy()
oy, ox = np.mgrid[0:OH, 0:OW]
m = np.abs(ox + 0.5 - OW / 2) / (OW / 2) + np.abs(oy + 0.5 - OH / 2) / (OH / 2) < 1
rgba = np.dstack([out, (m * 255).astype(np.uint8)])
rgba[~m] = 0
os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray(rgba, 'RGBA').save(OUT, optimize=True)
print('wrote', OUT, rgba.shape, 'opaque px', int(m.sum()), 'of diamond area', OW * OH // 2)
