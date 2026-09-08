#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path("/workspace/cutouts/npc_sheet.png")
FURN = Path("/workspace/night-club-sim/public/assets/furniture")
BACKUP = Path("/workspace/cutouts/bar_backup")
OUT_DIR = Path("/workspace/cutouts")
PREVIEW = Path("/workspace/night-club-sim/tmp_bar_preview")

def key_gray(rgb, tol=42):
    bg = np.median(rgb[5:30, 5:30], axis=(0, 1)).astype(np.float32)
    diff = np.abs(rgb.astype(np.float32) - bg).sum(axis=2)
    a = np.clip((diff - tol + 12) / 24.0, 0.0, 1.0)
    mx = rgb.max(axis=2).astype(np.int16)
    mn = rgb.min(axis=2).astype(np.int16)
    chroma = mx - mn
    flat_gray = (chroma < 14) & (np.abs(mx.astype(np.float32) - float(bg.max())) < 28)
    a = a.copy()
    a[flat_gray] = 0.0
    return (a * 255).astype(np.uint8)

def extract_center_pose(src):
    rgb = np.array(Image.open(src).convert("RGB"))
    alpha = key_gray(rgb)
    mask = alpha > 20
    lab, n = ndimage.label(mask)
    bbs = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(xs) < 3000:
            continue
        bbs.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), i, int(len(xs))))
    bbs.sort(key=lambda b: b[0])
    print("pose blobs:", bbs)
    x0, y0, x1, y1, li, _ = bbs[1]
    pad = 8
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(rgb.shape[1] - 1, x1 + pad); y1 = min(rgb.shape[0] - 1, y1 + pad)
    keep = ndimage.binary_dilation(lab == li, iterations=2)
    crop_rgb = rgb[y0:y1+1, x0:x1+1]
    crop_a = alpha[y0:y1+1, x0:x1+1].copy()
    crop_a[~keep[y0:y1+1, x0:x1+1]] = 0
    out = np.dstack([crop_rgb, crop_a])
    ys, xs = np.where(crop_a > 10)
    fig = Image.fromarray(out[ys.min():ys.max()+1, xs.min():xs.max()+1], "RGBA")
    print("center figure size", fig.size)
    return fig

def remove_source_bar_and_crop_bust(fig: Image.Image) -> Image.Image:
    """Drop the source mini-bar (dark + pink neon ledge) and keep head/shoulders/chest + glass."""
    a = np.array(fig.convert("RGBA"))
    h, w = a.shape[:2]
    r, g, b, al = a[:,:,0], a[:,:,1], a[:,:,2], a[:,:,3]
    mx = np.maximum(np.maximum(r, g), b).astype(np.int16)
    mn = np.minimum(np.minimum(r, g), b).astype(np.int16)
    chroma = mx - mn

    # Pink neon strip on source bar — find its y
    pink = (r > 140) & (b > 100) & (g < r * 0.75) & (chroma > 40) & (al > 40)
    pink_rows = np.where(pink.any(axis=1))[0]
    print("pink row count", len(pink_rows), "range", (int(pink_rows.min()), int(pink_rows.max())) if len(pink_rows) else None)

    # Dark horizontal bar mass in lower half
    dark = (mx < 55) & (al > 40) & (chroma < 35)
    # Prefer pink neon as cut guide; else dark band in lower 55%
    if len(pink_rows) > 20:
        # neon is on front of counter — cut a bit above it so hand-on-bar may remain partially
        cut_y = int(np.percentile(pink_rows, 15)) - 4
    else:
        lower = dark.copy(); lower[: int(h * 0.35), :] = False
        row_dark = lower.sum(axis=1)
        # first strong dark row from top in lower region
        cand = np.where(row_dark > w * 0.12)[0]
        cut_y = int(cand.min()) - 2 if len(cand) else int(h * 0.55)

    cut_y = max(int(h * 0.35), min(cut_y, int(h * 0.72)))
    print("bust cut_y", cut_y, "of", h)

    # Soft fade into cut
    fade = 8
    out = a.copy()
    for y in range(h):
        if y < cut_y - fade:
            continue
        if y >= cut_y:
            out[y, :, 3] = 0
        else:
            t = (y - (cut_y - fade) + 1) / (fade + 1)
            mul = max(0.0, 1.0 - t)
            out[y, :, 3] = (out[y, :, 3].astype(np.float32) * mul).astype(np.uint8)

    # Also clear remaining dark bar leftovers above cut (props on counter OK if colorful)
    # Kill large flat-dark chunks near bottom of remaining area
    zone = out.copy()
    # Remove silver shakers/bottles sitting on the bar near bottom edges — optional keep glass in hand
    # Heuristic: opaque dark/silver pixels in bottom 18% of remaining bust → clear if not near center torso
    ys, xs = np.where(out[:, :, 3] > 8)
    if len(xs) == 0:
        return Image.fromarray(out, "RGBA")
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    cropped = out[y0:y1+1, x0:x1+1]
    return Image.fromarray(cropped, "RGBA")

def paste_rgba(base, overlay, x, y):
    ov = np.array(overlay.convert("RGBA"))
    h, w = ov.shape[:2]
    H, W = base.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    sx0, sy0 = x0 - x, y0 - y
    sx1, sy1 = sx0 + (x1 - x0), sy0 + (y1 - y0)
    if x1 <= x0 or y1 <= y0:
        return base
    dst = base[y0:y1, x0:x1].astype(np.float32)
    src = ov[sy0:sy1, sx0:sx1].astype(np.float32)
    sa = src[:, :, 3:4] / 255.0
    da = dst[:, :, 3:4] / 255.0
    out_a = sa + da * (1 - sa)
    out_rgb = src[:, :, :3] * sa + dst[:, :, :3] * da * (1 - sa)
    out_rgb = np.where(out_a > 1e-6, out_rgb / np.maximum(out_a, 1e-6), 0)
    out = np.dstack([out_rgb, out_a * 255]).astype(np.uint8)
    base = base.copy()
    base[y0:y1, x0:x1] = out
    return base

def split_bar_front(bar, keep_bottom_frac=0.48):
    ys, xs = np.where(bar[:, :, 3] > 10)
    minY, maxY = int(ys.min()), int(ys.max())
    aabb_h = maxY - minY + 1
    keep_h = max(1, int(aabb_h * keep_bottom_frac))
    cut_y = maxY - keep_h + 1
    front = bar.copy()
    front[:cut_y, :, 3] = 0
    return front, cut_y

def checker_preview(im, path, max_side=520):
    prev = im.copy(); prev.thumbnail((max_side, max_side))
    pa = np.array(prev.convert("RGBA"))
    h, w = pa.shape[:2]
    yy, xx = np.indices((h, w))
    chk = np.where(((xx // 12) + (yy // 12)) % 2 == 0, 200, 90).astype(np.float32)
    af = pa[:, :, 3].astype(np.float32) / 255.0
    rgb = pa[:, :, :3].astype(np.float32)
    comp = (rgb * af[..., None] + np.dstack([chk, chk, chk]) * (1 - af[..., None])).astype(np.uint8)
    Image.fromarray(comp, "RGB").save(path, quality=92)

def composite_facing(facing, body, scale, cx_frac, top_frac, front_frac):
    # Always start from clean backup
    bar = np.array(Image.open(BACKUP / f"bar_{facing}.png").convert("RGBA"))
    H, W = bar.shape[:2]
    target_h = int(H * scale)
    bw = max(1, int(round(body.width * (target_h / body.height))))
    scaled = body.resize((bw, target_h), Image.Resampling.LANCZOS)
    # Align bottom of bust roughly to counter top (front cut line)
    front, cut_y = split_bar_front(bar, keep_bottom_frac=front_frac)
    # Place so bottom of sprite sits near cut_y (counter top), slightly above so chest clears
    x = int(W * cx_frac) - scaled.width // 2
    y = int(cut_y - scaled.height * top_frac)
    composed = paste_rgba(bar, scaled, x, y)
    fa = front[:, :, 3] > 0
    composed[fa] = bar[fa]
    path = FURN / f"bar_{facing}.png"
    Image.fromarray(composed, "RGBA").save(path, "PNG")
    checker_preview(Image.fromarray(composed, "RGBA"), PREVIEW / f"bar_{facing}_npc_check.jpg")
    print(f"{facing}: h={target_h} pos=({x},{y}) cut_y={cut_y} front={front_frac}")

def main():
    PREVIEW.mkdir(parents=True, exist_ok=True)
    fig = extract_center_pose(SRC)
    fig.save(OUT_DIR / "npc_center_full.png")
    bust = remove_source_bar_and_crop_bust(fig)
    bust.save(OUT_DIR / "npc_center_bust.png")
    checker_preview(bust, PREVIEW / "npc_center_bust_check.jpg")
    print("bust", bust.size)

    # Smaller peek: ~32% of bar height; front covers lower half of bust
    composite_facing("se", bust, scale=0.34, cx_frac=0.47, top_frac=0.78, front_frac=0.50)
    composite_facing("sw", bust, scale=0.34, cx_frac=0.53, top_frac=0.78, front_frac=0.50)

    for facing in ("ne", "nw"):
        Image.open(BACKUP / f"bar_{facing}.png").save(FURN / f"bar_{facing}.png")
        print(facing, "no NPC")
    print("done")

if __name__ == "__main__":
    main()
