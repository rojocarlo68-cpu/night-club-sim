#!/usr/bin/env python3
"""
Procedural PLACEHOLDER floor tiles for the medieval night club (Ultima-Online style fixed iso grid).

Output: public/assets/tiles/floor_<type>.png   (128x64 RGBA = one 64x32 tile at 2x)
        public/data/floor.json                  (only with --json; 12x12 layout + type list)

Geometry (must match the engine):
  * Tile = 2:1 diamond, 128x64 px at 2x (64x32 at 1x). Top vertex (64,0), bottom (64,64).
  * Pixel-centre rule: a pixel belongs to the tile iff |cx|/64 + |cy-32|/32 < 1 (cx = x+.5-64,
    cy = y+.5). No pixel centre can sit exactly on an edge, so neighbouring diamonds partition the
    plane exactly (no gaps, no overlap). Edges are hard (no anti-aliasing).
  * Tile-local axes: u runs along +col (screen down-right), v along +row (screen down-left).
    px = 64 + (u-v)*64,  py = (u+v)*32.  All mortar / plank lines are parallel to u or v, i.e.
    parallel to the iso axes (slope exactly 0.5 on screen).
  * Light from the top-left: edges facing -u (screen up-left) are lit, +u edges are dark.

Seamless-ness: tiles are independent PNGs, but each material is built so any neighbour pairing
joins cleanly (joints cross every tile border at fixed points; shared tileable noise is identical
in every variant; per-variant detail fades to zero at the border).

Swap in real art: replace the PNGs with same names (any size with a 2:1 ratio works; the engine
resamples to 128x64 and re-masks to the exact diamond), or add types to floor.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "assets", "tiles")
DATA = os.path.join(ROOT, "public", "data", "floor.json")
TW, TH = 128, 64


def tile_grid():
    xs = np.arange(TW) + 0.5 - 64.0
    ys = np.arange(TH) + 0.5
    cx, cy = np.meshgrid(xs, ys)
    u = (cx / 64.0 + cy / 32.0) / 2.0
    v = (cy / 32.0 - cx / 64.0) / 2.0
    mask = (np.abs(cx) / 64.0 + np.abs(cy - 32.0) / 32.0) < 1.0
    return u, v, mask


U, V, MASK = tile_grid()


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def periodic_noise(u, v, fu, fv, seed):
    """Value noise that tiles with period 1 in u and v (fu x fv lattice cells)."""
    rng = np.random.RandomState(seed)
    g = rng.rand(fv, fu)
    x = (u % 1.0) * fu
    y = (v % 1.0) * fv
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    tx = x - x0
    ty = y - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    x0 %= fu
    y0 %= fv
    x1 = (x0 + 1) % fu
    y1 = (y0 + 1) % fv
    a = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
    b = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
    return a * (1 - ty) + b * ty  # 0..1


def border_window(u, v, ramp=0.10):
    """0 on the tile border, 1 inside: per-variant detail uses this so variants join cleanly."""
    d = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
    return smoothstep(0.0, ramp, d)


def seg_dist(u, v, segs):
    """Min distance (uv units) from every pixel to a list of ((u0,v0),(u1,v1)) segments."""
    best = np.full(u.shape, 9.0)
    for (a, b) in segs:
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = np.clip(((u - ax) * dx + (v - ay) * dy) / L2, 0, 1)
        px = ax + t * dx
        py = ay + t * dy
        best = np.minimum(best, np.hypot(u - px, v - py))
    return best


def shade_from_height(fn, u, v, scale=0.04, e=0.006):
    """Directional light (from screen top-left) from a height function of (u, v)."""
    dhu = (fn(u + e, v) - fn(u - e, v)) / (2 * e)
    dhv = (fn(u, v + e) - fn(u, v - e)) / (2 * e)
    return (0.9 * dhu + 0.35 * dhv) * scale  # >0: surface faces the light (scaled ~ +-1)


def finish(rgb):
    out = np.zeros((TH, TW, 4), np.uint8)
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(MASK, 255, 0)
    out[~MASK, :3] = 0
    return Image.fromarray(out, "RGBA")


# ----------------------------------------------------------------------------- stone
def stone_segments(variant):
    """Axis-aligned joints. All variants cross every tile border at 0.5 (fixed join points)."""
    rng = np.random.RandomState(100 + variant)
    segs = []
    # H joint (along u) at v=0.5 with one axis-aligned jog; V joint (along u->v) at u=0.5.
    for axis in ("H", "V"):
        a = rng.uniform(0.22, 0.36)
        b = rng.uniform(0.64, 0.78)
        d = rng.choice([-1, 1]) * rng.uniform(0.04, 0.08)
        pts = [(-0.15, 0.5), (a, 0.5), (a, 0.5 + d), (b, 0.5 + d), (b, 0.5), (1.15, 0.5)]
        for p, q in zip(pts[:-1], pts[1:]):
            if axis == "H":
                segs.append(((p[0], p[1]), (q[0], q[1])))
            else:
                segs.append(((p[1], p[0]), (q[1], q[0])))  # swap u/v
    # carve one or two smaller stones next to the centre crossing (L-shaped joints)
    quads = rng.permutation(4)[: 1 + (variant % 2)]
    for q in quads:
        su = -1 if q & 1 else 1  # which side of the V joint
        sv = -1 if q & 2 else 1
        cu, cv = 0.5, 0.5
        wu = rng.uniform(0.14, 0.28)
        wv = rng.uniform(0.14, 0.28)
        ue, ve = cu + su * wu, cv + sv * wv
        # keep clear of the jogs: use only the straight parts of the main joints
        segs.append(((ue, cv), (ue, ve)))
        segs.append(((ue, ve), (cu, ve)))
    return segs


def make_stone(variant):
    segs = stone_segments(variant)
    wm = 0.020  # mortar half width (uv)
    bw = 0.045  # bevel width
    seed = 7 + variant

    def height(u, v):
        d = seg_dist(u, v, segs)
        return smoothstep(wm, wm + bw, d)

    d = seg_dist(U, V, segs)
    H = height(U, V)
    light = shade_from_height(height, U, V)

    # stone interiors: label regions in uv space (fine raster), tint only those not touching the border
    N = 256
    gu, gv = np.meshgrid((np.arange(N) + 0.5) / N, (np.arange(N) + 0.5) / N)
    lab, n = ndimage.label(seg_dist(gu, gv, segs) > wm)
    touch = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    rng = np.random.RandomState(900 + variant)
    tone = np.zeros(n + 1)
    for i in range(1, n + 1):
        tone[i] = 0.0 if i in touch else rng.uniform(-0.07, 0.07)
    iu = np.clip((U * N).astype(int), 0, N - 1)
    iv = np.clip((V * N).astype(int), 0, N - 1)
    tone_px = tone[lab[iv, iu]]

    win = border_window(U, V)
    shared_lo = periodic_noise(U, V, 3, 3, 11)  # identical in every variant
    shared_mid = periodic_noise(U, V, 9, 9, 12)
    local = periodic_noise(U, V, 14, 14, seed * 5 + 1) * 0.6 + periodic_noise(U, V, 40, 40, seed * 5 + 2) * 0.4

    base = np.array([150.0, 138.0, 122.0])
    warm = np.array([164.0, 140.0, 112.0])
    cool = np.array([128.0, 128.0, 126.0])
    mix = shared_mid[..., None]
    col = base + (warm - base) * np.clip(mix * 2 - 1, 0, 1)[..., :1] + (cool - base) * np.clip(1 - mix * 2, 0, 1)[..., :1]
    col = col * (1 + 0.10 * (shared_lo[..., None] - 0.5) + tone_px[..., None])
    col = col * (1 + 0.10 * (local[..., None] - 0.5) * win[..., None])
    # painterly soft light/dark blotches (shared, subtle)
    col = col * (1 + 0.05 * (periodic_noise(U, V, 5, 5, 13)[..., None] - 0.5))
    # bevel lighting + ambient occlusion near joints
    ao = 0.80 + 0.20 * smoothstep(wm, wm + 0.10, d)
    col = col * ao[..., None]
    lit = np.clip(light, 0, 1) * 0.30
    dark = np.clip(-light, 0, 1) * 0.30
    col = col * (1 + lit[..., None] - dark[..., None]) + 16 * lit[..., None]
    # subtle global top-left lighting gradient across the tile
    gl = 1.0 + 0.03 * ((0.5 - U) * 0.8 + (0.5 - V) * 0.3)
    col = col * gl[..., None]
    # chips / pits (interior only)
    rng = np.random.RandomState(300 + variant)
    for _ in range(rng.randint(5, 9)):
        cu, cv = rng.uniform(0.12, 0.88, 2)
        if seg_dist(np.array([cu]), np.array([cv]), segs)[0] < wm + 0.05:
            continue
        r = rng.uniform(0.012, 0.028)
        dd = np.hypot(U - cu, V - cv)
        pit = np.exp(-(dd / r) ** 2)
        hi = np.exp(-(np.hypot(U - cu + r * 0.5, V - cv + r * 0.35) / (r * 0.9)) ** 2)
        col = col * (1 - 0.35 * pit[..., None]) + 28 * (hi * (1 - pit))[..., None] * 0.6
    # fine grit speckle (per variant, fades at border)
    grit = periodic_noise(U, V, 64, 64, seed * 7) - 0.5
    col = col + (grit[..., None] * 18) * win[..., None]
    # mortar
    mortar = np.array([66.0, 58.0, 52.0])
    mnoise = periodic_noise(U, V, 30, 30, 21)
    mcol = mortar[None, None, :] * (0.9 + 0.25 * mnoise[..., None])
    mmask = smoothstep(wm + 0.004, wm - 0.004, d)[..., None]
    col = col * (1 - mmask) + mcol * mmask
    return finish(col)


# ----------------------------------------------------------------------------- wood
PLANK_TONE = np.array([1.00, 0.90, 1.08, 0.95])
PLANK_JOINT_U = [0.30, 0.74, 0.52, 0.18]  # butt joint position per plank (staggered)


def make_wood():
    nb = 4
    gap_half = 0.012
    bevel = 0.030

    def height(u, v):
        f = (v * nb) % 1.0
        dist = np.minimum(f, 1 - f) / nb
        return smoothstep(gap_half, gap_half + bevel, dist)

    f = (V * nb) % 1.0
    dgap = np.minimum(f, 1 - f) / nb
    k = np.clip(np.floor(V * nb).astype(int), 0, nb - 1)
    H = height(U, V)
    light = shade_from_height(height, U, V)

    # grain: stretched along u (periodic), shared by all (only one wood variant)
    grain1 = periodic_noise(U, V + k * 0.173, 2, 46, 31)
    grain2 = periodic_noise(U, V + k * 0.311, 5, 120, 32)
    wob = periodic_noise(U, V, 3, 9, 33)
    rings = 0.5 + 0.5 * np.sin(2 * np.pi * (V * nb * 5.0 + 1.6 * wob + k * 0.37))
    tone = PLANK_TONE[k]
    base = np.array([104.0, 68.0, 42.0])
    col = base[None, None, :] * tone[..., None]
    col = col * (1 + 0.20 * (grain1[..., None] - 0.5) + 0.12 * (grain2[..., None] - 0.5) + 0.07 * (rings[..., None] - 0.5))
    col = col * (1 + 0.08 * (periodic_noise(U, V, 3, 3, 34)[..., None] - 0.5))
    # butt joints
    ju = np.array(PLANK_JOINT_U)[k]
    dj = np.abs(U - ju)
    jmask = smoothstep(0.012, 0.006, dj)
    col = col * (1 - 0.55 * jmask[..., None])
    ao_j = 0.85 + 0.15 * smoothstep(0.012, 0.05, dj)
    col = col * ao_j[..., None]
    # bevel light
    lit = np.clip(light, 0, 1) * 0.40
    dark = np.clip(-light, 0, 1) * 0.40
    col = col * (1 + lit[..., None] - dark[..., None]) + 14 * lit[..., None]
    # slight warm highlight upper-left of each board, a few knots (interior)
    win = border_window(U, V, 0.12)
    for (cu, cv_, r) in [(0.38, 0.40, 0.030), (0.80, 0.88, 0.026)]:
        ell = np.exp(-(((U - cu) / (r * 2.2)) ** 2 + ((V - cv_) / r) ** 2))
        ring = np.exp(-(((np.hypot((U - cu) / 2.2, V - cv_) - r * 0.8) / (r * 0.35)) ** 2))
        col = col * (1 - 0.35 * ell[..., None] * win[..., None]) + 8 * ring[..., None] * win[..., None]
    # gaps
    gmask = smoothstep(gap_half + 0.003, gap_half - 0.003, dgap)[..., None]
    gcol = np.array([48.0, 31.0, 20.0])
    col = col * (1 - gmask) + gcol * gmask
    # worn scuffs (variant-local, fade at border)
    scuff = periodic_noise(U, V, 10, 6, 35)
    col = col * (1 - 0.12 * smoothstep(0.62, 0.9, scuff)[..., None] * win[..., None])
    return finish(col)


# ----------------------------------------------------------------------------- carpet
def make_carpet():
    u, v = U, V
    red = np.array([142.0, 30.0, 38.0])
    deep = np.array([100.0, 18.0, 28.0])
    gold = np.array([206.0, 160.0, 62.0])
    dgold = np.array([150.0, 108.0, 40.0])

    edge = np.minimum(v, 1 - v)  # distance to the runner side edges
    # height profile of the runner: raised hem, flat field
    def height(uu, vv):
        e = np.minimum(vv, 1 - vv)
        return smoothstep(0.0, 0.06, e) * 0.6 + smoothstep(0.10, 0.16, e) * 0.4

    light = shade_from_height(height, u, v)

    col = np.broadcast_to(red, u.shape + (3,)).copy()
    # field motif: lattice of diamonds repeating twice per tile along u
    pu = (u * 2.0) % 1.0
    dm = np.abs(pu - 0.5) * 2.0 * 0.5 + np.abs(v - 0.5) / 0.5 * 0.5  # diamond metric 0..1
    lattice = smoothstep(0.52, 0.46, np.abs(dm - 0.55)) * (edge > 0.19)
    medal = smoothstep(0.30, 0.26, dm) * (edge > 0.19)
    col = col * (1 - 0.55 * lattice[..., None]) + deep * 0.0
    col = col * (1 - 0.30 * medal[..., None]) + deep * 0.30 * medal[..., None]
    dot = smoothstep(0.09, 0.06, dm) * (edge > 0.19)
    col = col * (1 - dot[..., None]) + gold * dot[..., None] * 0.9
    # side stripes: dark hem, gold line, red gap, thin gold line
    hem = smoothstep(0.065, 0.055, edge)
    col = col * (1 - hem[..., None]) + deep * 0.85 * hem[..., None]
    g1 = smoothstep(0.012, 0.0, np.abs(edge - 0.085) - 0.012)
    g2 = smoothstep(0.007, 0.0, np.abs(edge - 0.150) - 0.007)
    for g, c in ((g1, gold), (g2, dgold)):
        col = col * (1 - g[..., None]) + c * g[..., None]
    # woven texture
    weave = 0.5 + 0.5 * np.sin(2 * np.pi * u * 22) * np.sin(2 * np.pi * v * 22)
    col = col * (0.90 + 0.14 * weave[..., None])
    col = col * (1 + 0.14 * (periodic_noise(u, v, 3, 3, 41)[..., None] - 0.5))
    win = border_window(u, v)
    wear = periodic_noise(u, v, 6, 6, 42) * 0.5 + periodic_noise(u, v, 18, 18, 43) * 0.5
    worn = smoothstep(0.58, 0.80, wear) * win
    col = col * (1 - 0.22 * worn[..., None]) + np.array([60.0, 36.0, 30.0]) * 0.22 * worn[..., None]
    # light
    lit = np.clip(light, 0, 1) * 0.30
    dark = np.clip(-light, 0, 1) * 0.28
    col = col * (1 + lit[..., None] - dark[..., None])
    return finish(col)


# ----------------------------------------------------------------------------- layout
def default_layout():
    """12x12 default: worn stone, an oak dance floor, and a carpet runner from the door."""
    rng = np.random.RandomState(2024)
    n = 12
    grid = [[None] * n for _ in range(n)]  # grid[row][col]
    stones = ["stone_a", "stone_b", "stone_c"]
    for r in range(n):
        for c in range(n):
            grid[r][c] = stones[rng.randint(0, 3)]
    # dance floor (wood): cols 7..10, rows 4..8
    for r in range(4, 9):
        for c in range(7, 11):
            grid[r][c] = "wood"
    # carpet runner along the row axis at col 6 from the entrance (row 11) up to row 3
    for r in range(3, 12):
        grid[r][6] = "carpet"
    return grid


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = {
        "stone_a": make_stone(0),
        "stone_b": make_stone(1),
        "stone_c": make_stone(2),
        "wood": make_wood(),
        "carpet": make_carpet(),
    }
    for name, im in tiles.items():
        im.save(os.path.join(OUT, f"floor_{name}.png"))
        print("wrote", f"floor_{name}.png", im.size)
    if "--json" in sys.argv:
        data = {
            "_doc": "grid[row][col] holds a type id. Replace public/assets/tiles/floor_<id>.png to swap art (128x64 px, 2:1 diamond). Add types freely.",
            "tileWidth": 64,
            "tileHeight": 32,
            "textureScale": 2,
            "types": [
                {"id": k, "texture": f"floor_{k}", "file": f"assets/tiles/floor_{k}.png"} for k in tiles
            ],
            "grid": default_layout(),
        }
        with open(DATA, "w") as f:
            json.dump(data, f, indent=1)
        print("wrote", DATA)


if __name__ == "__main__":
    main()
