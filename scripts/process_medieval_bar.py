#!/usr/bin/env python3
"""Medieval wooden drink bar (natural SW pose, 2x1) -> public/assets/furniture/bar_medieval_sw.png (2x art).

art_src/medieval/bar_sw_src.jpg (592x518, white bg) -> cutout (border flood fill; enclosed white
stuffing in the torn arm is kept) -> rim colours replaced by the nearest interior colour (no white
halo) -> premultiplied Lanczos downscale by SCALE (uniform, never warped: verticals stay vertical)
-> tight crop. Prints the art-pixel position of the footprint's bottom vertex (the `baseVertex`
for shop_furniture.json) from a least-squares fit of the bar's 4 ground corners to the 2x1 diamond.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art_src/medieval/bar_sw_src.jpg')
OUT = os.path.join(ROOT, 'public/assets/furniture/bar_medieval_sw.png')
PAD = 4                              # transparent margin (2x px) kept around the crop

a = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64)
H, W = a.shape[:2]
white = a.min(axis=2) >= 238
lab, n = ndi.label(white)
border = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
border = border[border != 0]
bg = np.isin(lab, border)
fg = ~bg
fg = ndi.binary_opening(fg, iterations=1)           # drop isolated specks
fg_e = ndi.binary_erosion(fg, iterations=1)         # pull the edge 1 px inside the blended rim
alpha = ndi.gaussian_filter(fg_e.astype(np.float64), 0.8)
alpha[~ndi.binary_dilation(fg_e, iterations=2)] = 0

# --- ground-corner fit (source px; measured on 6x zooms of the four foot blocks, see REPORT) ---
# The 4 ground vertices of the bar's footprint = outer vertices of its corner feet:
#   W = left foot's west vertex, S = front foot's bottom vertex, E = right foot's east vertex, N = W+E-S (hidden).
Wc, Sc, Ec = np.array([7.5, 336.7]), np.array([405.0, 514.2]), np.array([587.5, 390.0])
Nc = Wc + Ec - Sc
src = np.array([Wc, Sc, Ec, Nc])
tgt = np.array([[-128, -64], [0, 0], [64, -32], [-64, -96]], float)   # 2x px, relative to the S vertex
# Weighted (front S vertex counts 2x: it is what the eye reads as the bar's position; N is hidden).
wts = np.array([float(x) for x in os.environ.get("BAR_W", "1,2,1,1").split(",")])
sm = (wts[:, None] * src).sum(0) / wts.sum()
tm = (wts[:, None] * tgt).sum(0) / wts.sum()
# UNIFORM scale + translation only (no warp: verticals stay vertical), least squares
SCALE = float(((wts[:, None] * (src - sm) * (tgt - tm)).sum()) / ((wts[:, None] * (src - sm) ** 2).sum()))
SCALE = round(SCALE, 4)
t = (wts[:, None] * (tgt - SCALE * src)).sum(axis=0) / wts.sum()   # tgt = SCALE*src + t   (rel. to S)
print('uniform scale', SCALE)

# colours: keep interior, replace the 4-px rim (white-contaminated) with the nearest interior colour
core = ndi.binary_erosion(fg, iterations=4)
idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
rgb = a[idx[0], idx[1]]

# premultiplied resize
ow, oh = int(round(W * SCALE)), int(round(H * SCALE))
pm = np.dstack([rgb * alpha[..., None], alpha * 255.0]).astype(np.float32)
chans = [np.asarray(Image.fromarray(pm[..., i], 'F').resize((ow, oh), Image.LANCZOS)) for i in range(4)]
pm2 = np.dstack(chans)
al2 = np.clip(pm2[..., 3], 0, 255)
rgb2 = np.where(al2[..., None] > 0.5, pm2[..., :3] / np.maximum(al2[..., None] / 255.0, 1e-3), 0)
rgba = np.dstack([np.clip(rgb2, 0, 255), al2]).astype(np.uint8)
rgba[rgba[..., 3] < 6] = 0

ys, xs = np.nonzero(rgba[..., 3] > 0)
x0, x1, y0, y1 = xs.min() - PAD, xs.max() + 1 + PAD, ys.min() - PAD, ys.max() + 1 + PAD
rgba = np.pad(rgba, ((PAD, PAD), (PAD, PAD), (0, 0)))
x0 += PAD; x1 += PAD; y0 += PAD; y1 += PAD
crop = rgba[y0:y1, x0:x1]
# width/height multiples of 4 so the 0.5-scaled sprite has an even display size: its centre (and top-left) land on whole pixels
crop = np.pad(crop, ((0, -crop.shape[0] % 4), (0, -crop.shape[1] % 4), (0, 0)))
Image.fromarray(crop, 'RGBA').save(OUT, optimize=True)
print('wrote', OUT, crop.shape[1], 'x', crop.shape[0])

# S' (0,0) corresponds to source point -t/SCALE; art px = SCALE*src - crop origin
sv = (-t / SCALE) * SCALE - np.array([x0 - PAD, y0 - PAD]) + 0.0
print('baseVertex exact (2x art px, footprint bottom vertex):', [round(float(v), 2) for v in sv])
# shop_furniture.json uses the nearest EVEN integers (whole-pixel placement at 0.5 display scale)
sv_even = [int(2 * round(float(v) / 2)) for v in sv]
print('baseVertex used (even ints):', sv_even, ' displaySize:', [crop.shape[1] // 2, crop.shape[0] // 2])
for nm, p, q in zip('WSEN', src, tgt):
    e = SCALE * p + t - q
    print(f'  corner {nm}: residual {e.round(2)} (2x px) = {(e / 2).round(2)} display px')
