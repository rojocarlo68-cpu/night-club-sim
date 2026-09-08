#!/usr/bin/env python3
"""Punch studio gray from Luna idle FRONT/BACK sheets; normalize back to 146×784."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ATT = Path("/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments")
# A = front (face), B = back (hair + apron bow)
FRONT_SRC = ATT / "4d97ea654ced12d6287dc0d7a186ee6554e727abb6fb24ab2c69192cc7bf6e09.png"
BACK_SRC = ATT / "3f5fafb779833b766dc739b4e57c498c11ecf3f163d9b7f586004e2c59ea406d.png"

OUT = Path("/workspace/night-club-sim/public/assets/characters")
CUTOUTS = Path("/workspace/cutouts")
PREV = Path("/workspace/night-club-sim/tmp_bar_preview")

FRONT_FW, FRONT_FH = 146, 784
FRONT_COLS = 8
BACK_NATIVE_FW = 200  # 1600/8
TARGET_CONTENT_H = 417
FEET_Y = 583  # match existing front feet


def punch_studio(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[:, :, :3].astype(np.float32)
    a0 = rgba[:, :, 3].astype(np.float32)
    mx = rgb.max(2)
    mn = rgb.min(2)
    spread = mx - mn
    luma = rgb.mean(2)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

    colorful = (spread >= 18) & (a0 > 40)
    skin = (r > 110) & (g > 75) & (b > 55) & (r > g) & (spread > 8) & (a0 > 40)
    hair_pink = (r > 140) & (b > 100) & (g < r) & (spread > 20) & (a0 > 40)
    black_clothes = (mx <= 55) & (a0 > 80) & (spread < 25)
    white_frill = (mn > 180) & (spread < 40) & (a0 > 80)
    protect = colorful | skin | hair_pink | black_clothes | white_frill

    studio = (spread < 18) & (luma >= 70) & (luma <= 140) & ~protect
    near_black = (mx < 22) & (spread < 10) & ~protect & (a0 > 0)

    h, w = a0.shape
    seed = (a0 < 12) | studio | near_black
    seed[:2, :] = True
    seed[-2:, :] = True
    seed[:, :2] = True
    seed[:, -2:] = True
    walk = studio | near_black | (a0 < 12)
    struct = ndimage.generate_binary_structure(2, 1)
    killed = seed & walk
    for _ in range(max(h, w)):
        grown = ndimage.binary_dilation(killed, structure=struct) & walk
        if grown.sum() == killed.sum():
            break
        killed = grown

    alpha = a0.copy()
    alpha[killed & ~protect] = 0
    near_clear = ndimage.binary_dilation(alpha < 8, iterations=1)
    fringe = near_clear & studio & ~protect & (alpha > 0)
    alpha[fringe] = 0
    # tiny studio speckles
    lab, _ = ndimage.label(studio & (alpha > 200))
    sizes = np.bincount(lab.ravel())
    if len(sizes):
        sizes[0] = 0
        tiny = sizes < 20
        tiny[0] = False
        alpha[tiny[lab] & ~protect] = 0

    out_rgb = rgb.astype(np.uint8).copy()
    out_rgb[alpha < 8] = 0
    return np.dstack([out_rgb, alpha.astype(np.uint8)])


def checker(img: Image.Image, path: Path) -> None:
    rgba = np.array(img.convert("RGBA"))
    h, w = rgba.shape[:2]
    yy, xx = np.indices((h, w))
    chk = np.where(((xx // 12) + (yy // 12)) % 2 == 0, 210, 70).astype(np.float32)
    af = rgba[:, :, 3].astype(np.float32) / 255.0
    comp = (
        rgba[:, :, :3].astype(np.float32) * af[..., None]
        + chk[..., None] * (1 - af[..., None])
    ).astype(np.uint8)
    Image.fromarray(comp, "RGB").save(path, "JPEG", quality=90)


def process_front() -> Image.Image:
    raw = np.array(Image.open(FRONT_SRC).convert("RGBA"))
    assert raw.shape[1] == FRONT_COLS * FRONT_FW and raw.shape[0] == FRONT_FH
    punched = punch_studio(raw)
    out = Image.fromarray(punched, "RGBA")
    out.save(OUT / "luna_idle_sheet.png", "PNG", optimize=True)
    out.save(CUTOUTS / "luna_idle_sheet.png", "PNG")
    cell = punched[:, 0:FRONT_FW]
    ys, xs = np.where(cell[:, :, 3] > 20)
    print(
        f"front sheet {out.size} content_h={ys.max()-ys.min()+1} "
        f"y={ys.min()}-{ys.max()} a0={(punched[:,:,3]<8).sum()}"
    )
    checker(Image.fromarray(cell, "RGBA"), PREV / "luna_front_f0_check.jpg")
    return out


def normalize_back_frame(cell: np.ndarray) -> np.ndarray:
    ys, xs = np.where(cell[:, :, 3] > 20)
    if len(ys) == 0:
        return np.zeros((FRONT_FH, FRONT_FW, 4), dtype=np.uint8)
    crop = cell[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    ch, cw = crop.shape[:2]
    scale = TARGET_CONTENT_H / ch
    nh, nw = TARGET_CONTENT_H, max(1, int(round(cw * scale)))
    resized = np.array(
        Image.fromarray(crop, "RGBA").resize((nw, nh), Image.Resampling.LANCZOS)
    )
    canvas = np.zeros((FRONT_FH, FRONT_FW, 4), dtype=np.uint8)
    top = FEET_Y - nh + 1
    left = (FRONT_FW - nw) // 2
    if top < 0:
        resized = resized[-top:]
        top = 0
    if left < 0:
        xoff = (nw - FRONT_FW) // 2
        resized = resized[:, xoff : xoff + FRONT_FW]
        left = 0
    if left + resized.shape[1] > FRONT_FW:
        resized = resized[:, : FRONT_FW - left]
    if top + resized.shape[0] > FRONT_FH:
        resized = resized[: FRONT_FH - top]
    canvas[top : top + resized.shape[0], left : left + resized.shape[1]] = resized
    return canvas


def process_back() -> Image.Image:
    raw = np.array(Image.open(BACK_SRC).convert("RGBA"))
    punched = punch_studio(raw)
    h, w = punched.shape[:2]
    assert w == 8 * BACK_NATIVE_FW, f"unexpected back width {w}"
    frames = []
    for i in range(8):
        cell = punched[:, i * BACK_NATIVE_FW : (i + 1) * BACK_NATIVE_FW]
        frames.append(normalize_back_frame(cell))
    sheet = np.concatenate(frames, axis=1)
    out = Image.fromarray(sheet, "RGBA")
    # Primary back sheet name used by BootScene
    out.save(OUT / "luna_idle_back_sheet.png", "PNG", optimize=True)
    # Keep legacy filename in sync (was alt idle; now back facing)
    out.save(OUT / "luna_idle_b_sheet.png", "PNG", optimize=True)
    out.save(CUTOUTS / "luna_idle_back_sheet.png", "PNG")
    cell = sheet[:, 0:FRONT_FW]
    ys, xs = np.where(cell[:, :, 3] > 20)
    print(
        f"back sheet {out.size} (normalized from {w}x{h} @ {BACK_NATIVE_FW}x{h}) "
        f"content_h={ys.max()-ys.min()+1} y={ys.min()}-{ys.max()} "
        f"a0={(sheet[:,:,3]<8).sum()}"
    )
    checker(Image.fromarray(cell, "RGBA"), PREV / "luna_back_f0_check.jpg")
    meta = OUT / "luna_idle_facing_meta.txt"
    meta.write_text(
        "front=luna_idle_sheet.png 1168x784 frame=146x784 cols=8 "
        f"(src A face, content~{TARGET_CONTENT_H}px)\n"
        "back=luna_idle_back_sheet.png 1168x784 frame=146x784 cols=8 "
        f"(src B hair-back, native 200x1077 normalized)\n"
        "facing: se=front, sw=front flipX, ne=back, nw=back flipX\n"
        f"feet_origin_y={FEET_Y}/{FRONT_FH} display_h=158 visible~84px\n"
    )
    print(meta.read_text())
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CUTOUTS.mkdir(parents=True, exist_ok=True)
    PREV.mkdir(parents=True, exist_ok=True)
    process_front()
    process_back()
    # strip preview
    for tag, name in ("front", "luna_idle_sheet.png"), ("back", "luna_idle_back_sheet.png"):
        sheet = Image.open(OUT / name)
        frames = [
            sheet.crop((i * FRONT_FW, 0, (i + 1) * FRONT_FW, FRONT_FH))
            .crop((0, 150, FRONT_FW, 600))
            .resize((73, 112), Image.Resampling.LANCZOS)
            for i in range(8)
        ]
        canvas = Image.new("RGBA", (73 * 8, 112))
        for i, f in enumerate(frames):
            canvas.paste(f, (i * 73, 0), f)
        checker(canvas, PREV / f"luna_{tag}_strip.jpg")


if __name__ == "__main__":
    main()
