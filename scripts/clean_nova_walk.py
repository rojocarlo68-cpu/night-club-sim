#!/usr/bin/env python3
"""Nova walk source frames (already RGBA, ~470-512 x 1667-1744) -> cleaned RGBA frames (same size, nothing cropped).
The supplied cut-outs had white background residue trapped in the hair outline (top of the figure) and a few stray
grey specks. Fix: (1) keep only the main body component (+ pieces >= 400 px); (2) in the hair zone (top 37% of the
figure: above the apron, whose white tie/ruffles must be kept) remove near-white / light-grey low-saturation pixels that
are connected to the transparent outside; (3) remove the light halo within 2 px of the edge in that zone;
(4) magenta/pink key on the edge ring (any height). Colours on the new edge are decontaminated from the core.
python3 clean_nova_walk.py srcdir outdir"""
import sys, glob, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, "walk_*.png"))):
    a = np.array(Image.open(f).convert("RGBA")).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    H, W = al.shape
    fg = al > 8
    l, n = ndi.label(fg, structure=np.ones((3, 3)))
    sz = ndi.sum(fg, l, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sz) if s >= 400]
    fg = np.isin(l, keep)
    ys = np.where(fg.any(1))[0]; top, bot = ys.min(), ys.max()
    zone = np.zeros_like(fg); zone[: top + int((bot - top) * 0.37)] = True
    mn, mx = a[..., :3].min(2), a[..., :3].max(2)
    light = (mn > 140) & ((mx - mn) < 50)
    # light pixels in hair zone connected to outside
    outside = ~fg
    cand = (light & zone & fg) | outside
    lab, _ = ndi.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    rem = np.isin(lab, list(border)) & fg
    fg &= ~rem
    # enclosed light pockets in the hair zone (background trapped between strands): surrounded by hair, not skin
    # only in the head (top 24%: below that are the neckline trim / bra stitching, which are light grey on black)
    head = np.zeros_like(fg); head[: top + int((bot - top) * 0.24)] = True
    dark = mx < 100
    lab2, n2 = ndi.label(light & head & fg)
    skin = (r > g) & (g > b) & ((r - b) > 40) & (mx > 110)
    pockets = 0
    for i in range(1, n2 + 1):
        m = lab2 == i
        if m.sum() < 12: continue
        ringm = ndi.binary_dilation(m, iterations=3) & ~m & fg
        # trapped background = surrounded by dark hair (not skin, not the gold hair-pin highlights)
        if ringm.sum() and (skin & ringm).sum() / ringm.sum() < 0.15 and (dark & ringm).sum() / ringm.sum() > 0.6:
            fg &= ~m; pockets += 1
    print("  pockets", pockets)
    # light halo on the hair-zone edge
    ring2 = fg & ~ndi.binary_erosion(fg, iterations=2)
    fg &= ~(ring2 & zone & (mn > 110) & ((mx - mn) < 50))
    # magenta / pink fringe anywhere on the edge
    mag = ((r - g) > 40) & ((b - g) > 30) & (b > 0.55 * r) & (r > 0.55 * b) & (r > 90)
    ring3 = fg & ~ndi.binary_erosion(fg, iterations=3)
    fg &= ~(ring3 & mag)
    l, n = ndi.label(fg, structure=np.ones((3, 3)))
    sz = ndi.sum(fg, l, range(1, n + 1))
    fg = np.isin(l, [i + 1 for i, s in enumerate(sz) if s >= 400])
    changed = fg != (al > 8)
    newedge = ndi.binary_dilation(~fg, iterations=2) & fg & ndi.binary_dilation(changed, iterations=3)
    core = fg & ~newedge
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    rgb = a[..., :3].copy()
    rgb[newedge] = a[..., :3][idx[0], idx[1]][newedge]
    na = np.where(fg, al, 0)
    # soften only the newly cut edge
    soft = np.clip((ndi.gaussian_filter(fg.astype(float), 0.6) - 0.12) / 0.7, 0, 1) * 255
    na = np.where(ndi.binary_dilation(changed, iterations=2), np.minimum(na, soft), na).astype(np.uint8)
    o = np.dstack([rgb, na]).astype(np.uint8)
    Image.fromarray(o, "RGBA").save(os.path.join(out, os.path.basename(f)))
    print(os.path.basename(f), "removed px", int(((al > 8) & (na == 0)).sum()), "hair-zone light removed", int(rem.sum()))
