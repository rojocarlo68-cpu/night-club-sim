#!/usr/bin/env python3
"""Pinball placeholder sprites: key white -> alpha, piecewise-affine warp so the base edges are
exactly +-0.5 slope / 64px per side at 2x (128x64 ground diamond), save pinball_{se,sw,ne,nw}.png.

Source: art_src/pinball/*.jpg (192x192 AI renders on white). The rear render (pinball_ne_src.jpg:
plain back panel on the lower-LEFT face => the machine's front faces screen-NE) is the NE facing;
NW = its horizontal mirror (back on the lower-right face => front faces screen-NW). This keeps the
se -> sw -> nw -> ne rotation a true 90deg cycle (fronts SE, SW, NW, NE).
Warp: pivot = lowest base vertex V; per side horizontal scale k = 64/run (run = vertex -> silhouette
extreme), then per-side vertical shear so the base edge slope is exactly 0.5; verticals stay vertical.
Prints measured output edges + the vertex (px from image top-left, pixel-edge coords) used as the
`baseVertex` anchors in public/data/shop_furniture.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art_src" / "pinball"
OUT = ROOT / "public" / "assets" / "furniture"

# (file, measured lowest vertex (x,y idx coords), measured slopes L,R)
SPEC = {
    "se": ("pinball_se.jpg", (90.3, 188.7), (0.455, 0.695)),
    "sw": ("pinball_sw.jpg", (94.4, 189.0), (0.741, 0.525)),
    "ne": ("pinball_ne_src.jpg", (92.1, 184.6), (0.195, 0.417)),
}
CANVAS_W = 192
CANVAS_H = 192
X0 = 95.5  # pixel-centre coords: continuous centre of a 192px canvas
Y0 = 187.5  # target lowest vertex row (idx coords)
RUN = 64.0  # per-side horizontal run at 2x (ground diamond 128x64)


def key_white(rgb):
    """Return premultiplied-free RGBA float: protect dark body, soft alpha for neon glow."""
    im = rgb.astype(np.float64)
    mn = im.min(axis=2)
    # strongly non-white core, holes filled (keeps white flippers etc. opaque)
    core = mn < 200
    lab, n = ndi.label(core)
    if n > 1:
        sz = ndi.sum(core, lab, range(1, n + 1))
        core = lab == (1 + int(np.argmax(sz)))
    core = ndi.binary_fill_holes(core)
    interior = ndi.binary_erosion(core, iterations=3)
    near = ndi.binary_dilation(core, iterations=6)
    a_raw = np.clip((255.0 - mn) / 255.0, 0, 1)
    a = np.where(interior, 1.0, np.where(near, a_raw, 0.0))
    a[a < 0.03] = 0.0
    # unmix from white: F = (P - (1-a)*255)/a
    F = np.zeros_like(im)
    ok = a > 0
    for c in range(3):
        F[..., c] = np.where(ok, (im[..., c] - (1 - a) * 255.0) / np.maximum(a, 1e-3), 0)
    F = np.clip(F, 0, 255)
    return F, a


def base_profile(alpha, vx, vy, sl, sr, lo=40, hi=150, clip=4.0):
    """Per-column base-bottom y (source idx coords): robust line per side + smoothed residual, so
    wobbly AI skirts are straightened (column-wise vertical shift only; verticals stay vertical)."""
    W = alpha.shape[1]
    xs = np.arange(W, dtype=float)
    line = np.where(xs <= vx, vy - sl * (vx - xs), vy - sr * (xs - vx))
    meas = bottom_edge(alpha)
    res = np.where(np.isfinite(meas), meas - line, 0.0)
    res = np.clip(res, -clip, clip)
    # keep only the interior of each side; fade to the pure line near the corners
    w = np.clip(np.minimum(xs - lo, hi - xs) / 6.0, 0, 1)
    res = ndi.median_filter(res, size=7, mode="nearest")
    res = ndi.gaussian_filter1d(res, 1.2)
    return line + res * w


def warp(F, a, vx, vy, sl, sr, xl, xr, prof=None, W=CANVAS_W, H=CANVAS_H):
    """Inverse-map piecewise affine. xl/xr = silhouette extreme edges (continuous idx coords)."""
    runL, runR = vx - xl, xr - vx
    kL, kR = RUN / runL, RUN / runR
    yo, xo = np.mgrid[0:H, 0:W].astype(np.float64)
    left = xo <= X0
    d_out = np.where(left, X0 - xo, xo - X0)
    k = np.where(left, kL, kR)
    s = np.where(left, sl, sr)
    d = d_out / k  # source distance from the vertex column
    xs = np.where(left, vx - d, vx + d)
    # verticals vertical: y' = y + (s - 0.5k) d  ->  y = y' - ...   (relative to the pivot row)
    if prof is None:
        ys = vy + (yo - Y0) - (s - 0.5 * k) * d
    else:
        b = np.interp(xs, np.arange(len(prof)), prof)
        ys = yo - (Y0 - 0.5 * k * d - b)
    prem = np.dstack([F * a[..., None] / 255.0, a])
    out = np.zeros((H, W, 4))
    for c in range(4):
        out[..., c] = ndi.map_coordinates(prem[..., c], [ys, xs], order=1, mode="constant", cval=0.0)
    A = out[..., 3]
    rgb = np.where(A[..., None] > 1e-4, out[..., :3] / np.maximum(A[..., None], 1e-4), 0)
    rgb = np.clip(rgb, 0, 1) * 255.0
    A = np.clip(A, 0, 1)
    A[A < 0.02] = 0
    return np.dstack([np.round(rgb), np.round(A * 255)]).astype(np.uint8), (kL, kR)


def bottom_edge(alpha):
    """Sub-pixel lowest-boundary y per column from alpha (idx coords)."""
    H, W = alpha.shape
    al = alpha.astype(np.float64) / 255.0
    ys = np.full(W, np.nan)
    for x in range(W):
        col = al[:, x]
        idx = np.where(col >= 0.5)[0]
        if len(idx) == 0:
            continue
        r0 = idx.max()
        tail = col[r0 + 1 : r0 + 4].sum() if r0 + 1 < H else 0.0
        ys[x] = r0 - 0.5 + col[r0] + tail
    return ys


def rfit(xs, ys):
    ok = np.isfinite(ys)
    xs, ys = xs[ok], ys[ok]
    p = np.polyfit(xs, ys, 1)
    for _ in range(4):
        r = ys - np.polyval(p, xs)
        k = np.abs(r) < max(0.8, 2 * r.std())
        p = np.polyfit(xs[k], ys[k], 1)
    return p, float(np.std(ys[k] - np.polyval(p, xs[k])))


def measure(alpha, lo=40, hi=150, gap=10, label=""):
    ys = bottom_edge(alpha)
    xs = np.arange(len(ys), dtype=float)
    xm = int(np.nanargmax(ys))
    L = (xs >= lo) & (xs <= xm - gap)
    R = (xs >= xm + gap) & (xs <= hi)
    pl, rl = rfit(xs[L], ys[L])
    pr, rr = rfit(xs[R], ys[R])
    vx = (pr[1] - pl[1]) / (pl[0] - pr[0])
    vy = np.polyval(pl, vx)
    # slopes as positive rise per px away from the vertex
    return dict(slopeL=pl[0], slopeR=-pr[0], vx=vx, vy=vy, resL=rl, resR=rr)


def silhouette_extremes(alpha):
    cols = np.where((alpha >= 128).any(axis=0))[0]
    return cols.min() - 0.5, cols.max() + 0.5


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    result = {}
    sprites = {}
    for facing, (fn, (vx, vy), (sl, sr)) in SPEC.items():
        rgb = np.array(Image.open(SRC / fn).convert("RGB"))
        F, a = key_white(rgb)
        # silhouette extremes of the keyed source (continuous coords)
        xl, xr = silhouette_extremes((a * 255).astype(np.uint8))
        src_m = measure((a * 255).astype(np.uint8), lo=40, hi=150)
        print(f"{facing}: src extremes {xl:.1f}..{xr:.1f}  own fit {src_m}  | given V=({vx},{vy}) s=({sl},{sr})")
        # use our own robust fit of the pivot/slopes (given values differ by <0.5px / 0.03)
        fvx, fvy, fsl, fsr = src_m["vx"], src_m["vy"], src_m["slopeL"], src_m["slopeR"]
        prof = base_profile((a * 255).astype(np.uint8), fvx, fvy, fsl, fsr)
        img, ks = warp(F, a, fvx, fvy, fsl, fsr, xl, xr, prof)
        sprites[facing] = img
        print(f"   k=({ks[0]:.3f},{ks[1]:.3f})")
    # NW = mirror of NE (vertex is on the canvas centre column so the mirror keeps the vertex)
    sprites["nw"] = sprites["ne"][:, ::-1].copy()
    # common vertical crop: keep rows from first opaque row (min over facings) to Y0+3
    top = min(int(np.where(s[..., 3] > 0)[0].min()) for s in sprites.values())
    bottom = int(Y0) + 4
    top = max(0, top - 2)
    for facing, img in sprites.items():
        img = img[top:bottom]
        Image.fromarray(img, "RGBA").save(OUT / f"pinball_{facing}.png", optimize=True)
        m = measure(img[..., 3])
        ext = silhouette_extremes(img[..., 3])
        result[facing] = dict(
            vertex=[round(float(m["vx"]) + 0.5, 2), round(float(m["vy"]) + 0.5, 2)],
            slopeL=round(float(m["slopeL"]), 4),
            slopeR=round(float(m["slopeR"]), 4),
            width=img.shape[1],
            height=img.shape[0],
            extremes=[float(ext[0]), float(ext[1])],
            residual=[round(m["resL"], 3), round(m["resR"], 3)],
        )
        print(facing, json.dumps(result[facing]))
    print("crop top", top, "bottom", bottom)


if __name__ == "__main__":
    sys.exit(main())
