#!/usr/bin/env python3
"""DJ booth front/back 2x4 sheets: gray studio BG -> transparent; export placement frames."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ATT = Path("/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments")
FRONT_SRC = ATT / "14f99eba592f7e320368ef3aac8db6ae50d74a2c8d36467607d50b1c0e95c8fc.jpeg"
BACK_SRC = ATT / "9f683b115e2189801de4476b992491a22f21f0a777b9a195c6ba70af9a91fa28.jpeg"

OUT = Path("/workspace/night-club-sim/public/assets/furniture")
CUTOUTS = Path("/workspace/cutouts")
COLS, ROWS = 4, 2
# Target max frame width for placement sprites (match sofa/bar ~512)
MAX_FRAME_W = 320


def gray_to_alpha(rgb: np.ndarray) -> np.ndarray:
    """Edge-connected gray studio key; keep neon/dark charcoal subject."""
    src = rgb.astype(np.float32)
    h, w = src.shape[:2]
    corners = np.stack([src[2, 2], src[2, -3], src[-3, 2], src[-3, -3]])
    bg = corners.mean(axis=0)
    dist = np.sqrt(((src - bg) ** 2).sum(axis=2))
    mx = src.max(axis=2)
    mn = src.min(axis=2)
    spread = mx - mn
    luma = src.mean(axis=2)

    near_gray = (spread < 14) & (np.abs(luma - bg.mean()) < 32) & (dist < 36)
    cand = near_gray | (dist < 10)

    lab, _ = ndimage.label(cand)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    bg_mask = np.isin(lab, border) | (near_gray & (dist < 24))

    r, g, b = src[:, :, 0], src[:, :, 1], src[:, :, 2]
    neon = (r > 80) & (b > 90) & (g < r * 0.88) & (spread > 22)
    led = ((b > 110) & (b > r + 15)) | ((g > 95) & (g > r + 12)) | ((r > 130) & (g > 70) & (b < 90))
    charcoal = (mx < 72) & (mx > 6)
    metal = (mx > 135) & (spread < 55)
    skin_hair = (r > 110) & (g > 70) & (b > 60) & (spread > 18)
    force = neon | led | charcoal | metal | skin_hair | (spread >= 16) | (dist > 38)

    alpha = np.ones((h, w), dtype=np.float32)
    alpha = np.where(bg_mask & ~force, 0.0, alpha)
    chroma_a = np.clip((dist - 5.0) / 14.0, 0, 1)
    alpha = np.where(near_gray & ~force, np.minimum(alpha, chroma_a), alpha)
    alpha = np.where(force, 1.0, alpha)

    # Soften fringe
    alpha = ndimage.gaussian_filter(alpha, 0.35)
    alpha = np.clip(alpha, 0, 1)

    # Keep largest component per cell-ish: whole sheet still OK (frames separated by gray)
    bin_subj = alpha >= 0.25
    lab2, n = ndimage.label(bin_subj)
    if n:
        # Keep all components that touch non-edge (frames) — drop tiny speckles
        sizes = np.bincount(lab2.ravel())
        sizes[0] = 0
        keep = sizes >= max(80, int(sizes.max() * 0.002))
        keep[0] = False
        mask = keep[lab2]
        alpha = np.where(mask, alpha, 0.0)

    return np.dstack([rgb, (alpha * 255).astype(np.uint8)])


def process_sheet(src: Path, name: str) -> tuple[Image.Image, int, int]:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    assert w % COLS == 0 and h % ROWS == 0, (name, im.size)
    fw, fh = w // COLS, h // ROWS
    rgba = gray_to_alpha(np.array(im))
    out = Image.fromarray(rgba, "RGBA")
    dest = OUT / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    CUTOUTS.mkdir(parents=True, exist_ok=True)
    out.save(CUTOUTS / name, "PNG")
    a = rgba[:, :, 3]
    print(
        f"saved {dest} {out.size} frame={fw}x{fh} opaque={(a>250).sum()} "
        f"partial={((a>5)&(a<=250)).sum()} clear={(a<=5).sum()}"
    )
    return out, fw, fh


def crop_frame(sheet: Image.Image, fw: int, fh: int, index: int) -> Image.Image:
    col = index % COLS
    row = index // COLS
    cell = sheet.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
    arr = np.array(cell)
    ys, xs = np.where(arr[:, :, 3] > 12)
    if len(xs) == 0:
        return cell
    pad = 4
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(arr.shape[0], int(ys.max()) + 1 + pad)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(arr.shape[1], int(xs.max()) + 1 + pad)
    cropped = Image.fromarray(arr[y0:y1, x0:x1], "RGBA")
    if cropped.width > MAX_FRAME_W:
        nh = int(round(cropped.height * (MAX_FRAME_W / cropped.width)))
        cropped = cropped.resize((MAX_FRAME_W, nh), Image.Resampling.LANCZOS)
    return cropped


def checker(img: Image.Image, path: Path) -> None:
    rgba = np.array(img)
    h, w = rgba.shape[:2]
    tile = 16
    yy, xx = np.indices((h, w))
    chk = np.where(((xx // tile) + (yy // tile)) % 2 == 0, 220, 60).astype(np.float32)
    af = rgba[:, :, 3].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)
    comp = (rgb * af[..., None] + np.dstack([chk, chk, chk]) * (1 - af[..., None])).astype(np.uint8)
    Image.fromarray(comp, "RGB").save(path, "JPEG", quality=88)


def main() -> None:
    front, ffw, ffh = process_sheet(FRONT_SRC, "dj_booth_front_sheet.png")
    back, bfw, bfh = process_sheet(BACK_SRC, "dj_booth_back_sheet.png")

    # Placement: frame 0 of each sheet; flip for SW/NW
    se = crop_frame(front, ffw, ffh, 0)
    sw = se.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    ne = crop_frame(back, bfw, bfh, 0)
    nw = ne.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    mapping = {
        "dj_booth_se.png": se,
        "dj_booth_sw.png": sw,
        "dj_booth_ne.png": ne,
        "dj_booth_nw.png": nw,
        # Keep legacy key as SE for shop thumb / old refs
        "dj_booth.png": se.copy(),
    }
    for name, img in mapping.items():
        p = OUT / name
        img.save(p, "PNG", optimize=True)
        img.save(CUTOUTS / name, "PNG")
        checker(img, CUTOUTS / name.replace(".png", "_check.jpg"))
        print(f"placement {name} {img.size}")

    # Meta for game code
    meta = OUT / "dj_booth_sheet_meta.txt"
    meta.write_text(
        f"front_sheet={front.size[0]}x{front.size[1]} frame={ffw}x{ffh} cols={COLS} rows={ROWS}\n"
        f"back_sheet={back.size[0]}x{back.size[1]} frame={bfw}x{bfh} cols={COLS} rows={ROWS}\n"
        f"facing: se=front frame0, sw=front flip, ne=back frame0, nw=back flip\n"
        f"placement_se={se.size[0]}x{se.size[1]} ne={ne.size[0]}x{ne.size[1]}\n"
    )
    print(meta.read_text())


if __name__ == "__main__":
    main()
