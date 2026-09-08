#!/usr/bin/env python3
"""Build luna_serve_beer_sheet.png: 8×146×784, gray bg → transparent."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ATT = Path("/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments")
SRC = ATT / "21b1b172c44457de84ac126fba10ba02235538e973d34af83f835ee7bef807fb.jpeg"
DST = Path(__file__).resolve().parents[1] / "public/assets/characters/luna_serve_beer_sheet.png"
FW, FH, FRAMES = 146, 784, 8


def gray_to_alpha(rgb: np.ndarray) -> np.ndarray:
    src = rgb.astype(np.float32)
    corners = np.stack([src[2, 2], src[2, -3], src[-3, 2], src[-3, -3]])
    bg = corners.mean(axis=0)
    dist = np.sqrt(((src - bg) ** 2).sum(axis=2))
    spread = src.max(axis=2) - src.min(axis=2)
    luma = src.mean(axis=2)
    near_gray = (spread < 16) & (np.abs(luma - bg.mean()) < 35) & (dist < 40)
    cand = near_gray | (dist < 12)
    lab, _ = ndimage.label(cand)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    bg_mask = np.isin(lab, border) | (near_gray & (dist < 28))
    is_chromatic = spread >= 14
    is_dark = luma < 70
    force = (is_chromatic & (dist > 8)) | is_dark | (dist > 40)
    alpha = np.ones(src.shape[:2], dtype=np.float32)
    alpha = np.where(bg_mask & ~force, 0.0, alpha)
    chroma_a = np.clip((dist - 6.0) / 14.0, 0, 1)
    alpha = np.where(near_gray & ~force, np.minimum(alpha, chroma_a), alpha)
    alpha = np.where(force, 1.0, alpha)
    alpha = ndimage.gaussian_filter(alpha, 0.4)
    alpha = np.clip(alpha, 0, 1)
    return np.dstack([rgb, (alpha * 255).astype(np.uint8)])


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    assert im.size == (FW * FRAMES, FH), im.size
    out = gray_to_alpha(np.array(im))
    Image.fromarray(out, "RGBA").save(DST, optimize=True)
    print(f"Wrote {DST} {out.shape}")


if __name__ == "__main__":
    main()
