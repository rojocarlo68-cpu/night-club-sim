"""Rebuild floor / stage / sofa PNGs from the AI-generated source JPGs.
Usage: python3 build_assets.py <srcdir> <outdir>"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art_src/new'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/assets'

def load(p): return np.array(Image.open(p).convert('RGB')).astype(np.float64)
def save(a, p): Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8), 'RGBA').save(p, optimize=True)

def poly_cov(shape, pts, ss=8):
    H, W = shape
    im = Image.new('L', (W * ss, H * ss), 0)
    ImageDraw.Draw(im).polygon([(x * ss, y * ss) for x, y in pts], fill=255)
    return np.array(im).astype(np.float64).reshape(H, ss, W, ss).mean(axis=(1, 3)) / 255

# ---------------------------------------------------------------- floor
def build_floor():
    p = load(f'{SRC}/floor.jpg'); H, W = p.shape[:2]
    # measured diamond edges (50% crossing, continuous px coords)
    # grid vertex of the art measured from the 63 interior grid-line centroids: (0.39, 0.465)
    ox_, oy_ = 0.39, 0.465
    top = (384 + ox_, oy_); right = (768 + ox_, 192 + oy_); bot = (384 + ox_, 384 + oy_); left = (ox_, 192 + oy_)
    cov = poly_cov((H, W), [top, right, bot, left])
    # distance inside the diamond (rough, in px) -> band to re-colour
    inside = cov >= 0.999
    dist_in = ndi.distance_transform_edt(inside)
    dark = p.mean(axis=2) < 90
    good = inside & (dist_in > 1.6) & dark
    w = good.astype(np.float64)
    k = 7
    num = np.stack([ndi.uniform_filter(p[..., c] * w, size=2 * k + 1) for c in range(3)], -1)
    den = ndi.uniform_filter(w, size=2 * k + 1)[..., None]
    fill = np.where(den > 1e-4, num / np.maximum(den, 1e-4), np.array([36., 38., 48.]))
    band = ~(inside & (dist_in > 1.6))
    rgb = np.where(band[..., None], fill, p)
    a = cov * 255
    a[cov < 0.02] = 0
    save(np.dstack([rgb, a]), f'{OUT}/tiles/room_floor.png')

# ---------------------------------------------------------------- stage
def build_stage():
    p = load(f'{SRC}/stage.jpg'); H, W = p.shape[:2]
    B = (65.44, 258.54); Rv = (B[0] + 384, B[1] - 192); Lv = (B[0] - 64, B[1] - 32)
    Tv = (Lv[0] + 384, Lv[1] - 192)
    up = lambda q: (q[0], q[1] - 32)
    poly = [up(Lv), up(Tv), up(Rv), Rv, B, Lv]
    # edge list: (a, b, type)
    edges = [(up(Lv), up(Tv), 'pink'), (up(Tv), up(Rv), 'pink'), (up(Rv), Rv, 'dark'),
             (Rv, B, 'cyan'), (B, Lv, 'cyan'), (Lv, up(Lv), 'dark')]
    yy, xx = np.mgrid[0:H, 0:W]; px = xx + .5; py = yy + .5
    # signed distance (positive inside) for convex polygon, orientation-agnostic
    def edge_dist(a, b):
        ex, ey = b[0] - a[0], b[1] - a[1]; L = np.hypot(ex, ey)
        return ((px - a[0]) * ey - (py - a[1]) * ex) / L
    ds = [edge_dist(a, b) for a, b, _ in edges]
    # make positive inside: test with centroid
    cx = np.mean([q[0] for q in poly]); cy = np.mean([q[1] for q in poly])
    for i, (a, b, _) in enumerate(edges):
        ex, ey = b[0] - a[0], b[1] - a[1]; L = np.hypot(ex, ey)
        s = ((cx - a[0]) * ey - (cy - a[1]) * ex) / L
        if s < 0: ds[i] = -ds[i]
    D = np.min(ds, axis=0)               # >0 inside the centreline hexagon
    nearest = np.argmin(ds, axis=0)      # edge index of the closest boundary
    NEON = {'pink': np.array([196., 82., 176.]), 'cyan': np.array([80., 196., 212.]), 'dark': np.array([16., 10., 18.])}
    R, G, Bc = p[..., 0], p[..., 1], p[..., 2]
    out = p.copy(); alpha = np.ones((H, W))
    # ---- outside the centreline hexagon: soft alpha from the source's own antialiasing
    outm = D < 0
    for i, (_, _, t) in enumerate(edges):
        m = outm & (nearest == i)
        if t == 'pink': a = np.clip((255 - G) / (255 - 84), 0, 1)
        elif t == 'cyan': a = np.clip((255 - R) / (255 - 76), 0, 1)
        else: a = np.clip((255 - p.min(axis=2)) / (255 - 14), 0, 1)
        a = np.where(D > -3.2, a, 0)
        a[a < 0.06] = 0
        alpha[m] = a[m]
        out[m] = NEON[t]
    # ---- repaint the white front face (between pink top line and cyan base line)
    face_dark = np.array([18., 12., 22.])
    # lines through the base/top front edge: y = -0.5*(x - B.x) + B.y  (cyan) ; top = cyan - 32 (pink)
    y_c = -0.5 * (px - B[0]) + B[1]; y_p = y_c - 32
    inface = (px > B[0] - 0.01) & (px < Rv[0] + 0.01) & (py > y_p - 1.5) & (py < y_c + 1.5) & (D > -0.01)
    dp = py - y_p; dc = y_c - py          # vertical distances below pink / above cyan
    upper = dp < dc
    ap = np.clip((255 - G) / (255 - 84), 0, 1); ac = np.clip((255 - R) / (255 - 76), 0, 1)
    an = np.where(upper, ap, ac)
    ncol = np.where(upper[..., None], NEON['pink'], NEON['cyan'])
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1.8, (H, W, 1))
    face = an[..., None] * ncol + (1 - an[..., None]) * (face_dark + noise)
    # only replace pixels that are below the pink core / above the cyan core (keep the neon cores & everything else)
    repl = inface & (dp > 0.2) & (dc > 0.2)
    # keep original where it is clearly the neon core (strongly coloured, not whitish)
    out[repl] = face[repl]
    # inner-edge JPEG ringing along the vertical right edge etc: nothing to do (dark body)
    save(np.dstack([out, alpha * 255]), f'{OUT}/tiles/stage.png')

# ---------------------------------------------------------------- sofas
SOFAS = {  # facing -> source file (physical analysis: base vertex left = footprint [1,2])
    'se': 'sofa_b.jpg', 'sw': 'sofa_a.jpg', 'nw': 'sofa_c.jpg', 'ne': 'sofa_d.jpg'}

def build_sofa(src, dst):
    p = load(src)
    mn = p.min(axis=2)
    dark = ndi.binary_opening(mn < 110, iterations=1)
    lab, n = ndi.label(dark)
    if n > 1:
        sizes = ndi.sum(dark, lab, range(1, n + 1)); dark = lab == (1 + np.argmax(sizes))
    body = ndi.binary_fill_holes(ndi.binary_closing(dark, iterations=3))
    deep = ndi.binary_erosion(body, iterations=2)
    araw = np.clip((255 - p).max(axis=2) / 255, 0, 1)
    a_s = np.maximum(araw, 1e-3)
    c = np.clip((p - 255 * (1 - a_s[..., None])) / a_s[..., None], 0, 255)   # un-premultiply from white
    alpha = araw.copy(); alpha[araw < 0.02] = 0
    alpha = np.where(deep, 1.0, alpha)
    col = np.where(deep[..., None], p, c)
    save(np.dstack([col, alpha * 255]), dst)

def build_sofas():
    for f, s in SOFAS.items():
        build_sofa(f'{SRC}/{s}', f'{OUT}/furniture/sofa_{f}.png')

if __name__ == '__main__':
    os.makedirs(f'{OUT}/tiles', exist_ok=True); os.makedirs(f'{OUT}/furniture', exist_ok=True)
    build_floor(); build_stage(); build_sofas()
