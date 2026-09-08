#!/workspace/venv/bin/python3
"""DJ booth cutout: original RGB + rembg alpha; gray studio BG → transparent."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import remove
from scipy import ndimage

SRC = Path(
    "/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments/"
    "56b2eea30c378f93420473cde9939de4d342df944073a965088cf80c04cef768.jpeg"
)
OUT = Path("/workspace/night-club-sim/public/assets/furniture")
CUTOUTS = Path("/workspace/cutouts")
MAX_W = 512


def edge_connected_bg(rgb: np.ndarray) -> np.ndarray:
    """Edge-connected neutral gray studio frame (DJ booth BG ~78)."""
    h, w = rgb.shape[:2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    # Flat gray studio (~60–95) OR near-black void
    is_bg = (mx <= 10) | ((mx >= 55) & (mx <= 100) & (chroma <= 14))
    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and not visited[y, x] and is_bg[y, x]:
            visited[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            push(y + dy, x + dx)
    return visited


def subject_hints(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    # Neon pink / purple accents on booth
    neon = (r > 80) & (b > 90) & (g < r * 0.85) & (chroma > 25)
    # Deck screens / LEDs (blue/cyan/green/orange)
    led = ((b > 120) & (b > r + 20)) | ((g > 100) & (g > r + 15)) | ((r > 140) & (g > 80) & (b < 80))
    # Charcoal body (dark but not pure void)
    charcoal = (mx < 70) & (mx > 8)
    # Light silver deck rims / mixer
    metal = (mx > 140) & (chroma < 50)
    return neon | led | charcoal | metal


def process(src: Path) -> Image.Image:
    src_img = Image.open(src).convert("RGB")
    rgb = np.array(src_img)
    print("src", src.name, rgb.shape)

    print("running rembg...")
    rembg_rgba = remove(src_img)
    rembg_a = np.array(rembg_rgba.convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0
    print(
        "rembg opaque",
        float((rembg_a > 0.9).mean()),
        "clear",
        float((rembg_a < 0.05).mean()),
    )

    bg = edge_connected_bg(rgb)
    hints = subject_hints(rgb)

    # Punch enclosed gray pockets rembg thinks are BG
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    near_gray = (chroma <= 14) & (mx >= 55) & (mx <= 100)
    enclosed = near_gray & (rembg_a < 0.35) & (~bg)
    bg = bg | enclosed

    # Force subject: rembg strong OR furniture hints not on edge-bg
    force = ((rembg_a >= 0.45) | (hints & (rembg_a >= 0.15))) & (~bg)
    # Dark charcoal booth panels near rembg should stay
    charcoal = (mx < 70) & (mx > 8) & (rembg_a >= 0.2)
    force = force | (charcoal & (~bg))

    alpha = rembg_a.copy()
    alpha[bg] = 0.0
    alpha[force] = np.maximum(alpha[force], 1.0)

    # Soft edge for remaining near-gray fringe
    fringe = near_gray & (~force) & (~bg) & (rembg_a < 0.6)
    alpha[fringe] = alpha[fringe] * 0.15

    # Morphological clean: remove tiny alpha speckles far from subject
    bin_subj = alpha >= 0.35
    bin_subj = ndimage.binary_opening(bin_subj, iterations=1)
    bin_subj = ndimage.binary_closing(bin_subj, iterations=2)
    # Keep largest component
    lab, n = ndimage.label(bin_subj)
    if n:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        keep = sizes.argmax()
        main = lab == keep
        # Dilate slightly for edge soft
        dil = ndimage.binary_dilation(main, iterations=2)
        alpha = np.where(dil, alpha, 0.0)
        alpha = np.where(main, np.maximum(alpha, 0.95), alpha)

    alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)

    # Crop to opaque bounds with padding
    ys, xs = np.where(alpha_u8 > 12)
    if len(xs) == 0:
        raise SystemExit("no opaque pixels")
    pad = 8
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(rgb.shape[0], int(ys.max()) + 1 + pad)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(rgb.shape[1], int(xs.max()) + 1 + pad)
    rgb_c = rgb[y0:y1, x0:x1]
    a_c = alpha_u8[y0:y1, x0:x1]

    rgba = np.dstack([rgb_c, a_c])
    out = Image.fromarray(rgba, "RGBA")

    # Scale max width
    if out.width > MAX_W:
        nh = int(round(out.height * (MAX_W / out.width)))
        out = out.resize((MAX_W, nh), Image.Resampling.LANCZOS)
        print("scaled to", out.size)
    else:
        print("size", out.size)

    return out


def checker_preview(img: Image.Image, path: Path) -> None:
    rgba = np.array(img)
    h, w = rgba.shape[:2]
    tile = 16
    yy, xx = np.indices((h, w))
    chk = np.where(((xx // tile) + (yy // tile)) % 2 == 0, 220, 60).astype(np.float32)
    af = rgba[:, :, 3].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)
    comp = (rgb * af[..., None] + np.dstack([chk, chk, chk]) * (1 - af[..., None])).astype(
        np.uint8
    )
    Image.fromarray(comp, "RGB").save(path, "JPEG", quality=90)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CUTOUTS.mkdir(parents=True, exist_ok=True)
    img = process(SRC)
    dest = OUT / "dj_booth.png"
    cut = CUTOUTS / "dj_booth.png"
    img.save(dest, "PNG")
    img.save(cut, "PNG")
    checker_preview(img, CUTOUTS / "dj_booth_check.jpg")
    a = np.array(img)[:, :, 3]
    print("saved", dest, cut)
    print(
        "opaque",
        int((a > 250).sum()),
        "partial",
        int(((a > 5) & (a <= 250)).sum()),
        "clear",
        int((a <= 5).sum()),
    )


if __name__ == "__main__":
    main()
