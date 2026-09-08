#!/usr/bin/env python3
"""DJ booth front/back 2x4 sheets: punch studio gray/black plate + grid; keep neon/booth."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ATT = Path("/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments")
FRONT_SRC = ATT / "cc3e1bad1718d74718198171a63f9dcffb3209147aac690ca940e554c7498d11.png"  # face = front
BACK_SRC = ATT / "77b9f8663bf50dffaf80e88ecf9a329784326dfbd6a8abc5504b5f554fca7579.png"  # hair-back = back
# ref single: 8cd3e8bc4661dd191ddbec84341eab35a9680593cd13370f5eb5cafb5537508d.png

OUT = Path("/workspace/night-club-sim/public/assets/furniture")
CUTOUTS = Path("/workspace/cutouts")
PREV = Path("/workspace/night-club-sim/tmp_bar_preview")
COLS, ROWS = 4, 2
MAX_FRAME_W = 320
FRAME_W, FRAME_H = 400, 450


def normalize_sheet(im: Image.Image) -> np.ndarray:
    rgba = np.array(im.convert("RGBA"))
    tw, th = COLS * FRAME_W, ROWS * FRAME_H
    h, w = rgba.shape[:2]
    x0 = max(0, (w - tw) // 2)
    y0 = 0 if 0 <= (h - th) <= 6 else max(0, (h - th) // 2)
    return rgba[y0 : y0 + th, x0 : x0 + tw].copy()


def punch_backdrop(rgba: np.ndarray) -> np.ndarray:
    """Remove studio gray plate + grid; never eat purple neon or dark booth body."""
    rgb = rgba[:, :, :3].astype(np.float32)
    a0 = rgba[:, :, 3].astype(np.float32)
    h, w = rgb.shape[:2]
    mx = rgb.max(2)
    mn = rgb.min(2)
    spread = mx - mn
    luma = rgb.mean(2)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

    # Protect subject (RGB from original crop)
    neon = (r > 70) & (b > 85) & (g < r * 0.94) & (spread > 16)
    led = ((b > 105) & (b > r + 10)) | ((g > 95) & (g > r + 8))
    dark_booth = (mx <= 68) & (a0 > 200)  # charcoal body / shadows
    metal = (mx > 130) & (spread < 55) & (luma > 100)
    skin_hair = (r > 110) & (g > 70) & (b > 50) & (r > g) & (spread > 12) & (a0 > 128)
    colorful = (spread >= 18) & (a0 > 128)
    protect = neon | led | dark_booth | metal | skin_hair | colorful

    # Studio plate only (user crop corners ~79–90). Do NOT include charcoal booth.
    studio = (spread < 14) & (luma >= 68) & (luma <= 125) & ~protect
    # Leftover near-black plate blobs that are NOT dark booth (already alpha holes usually)
    # Only kill near-black if flood-connected from clear — handled below via walk.

    seed = a0 < 12
    seed[:2, :] = True
    seed[-2:, :] = True
    seed[:, :2] = True
    seed[:, -2:] = True
    for c in range(1, COLS):
        x = c * FRAME_W
        seed[:, max(0, x - 1) : min(w, x + 1)] = True
    for rr in range(1, ROWS):
        y = rr * FRAME_H
        seed[max(0, y - 1) : min(h, y + 1), :] = True

    # Walk through studio gray + already-clear only (never through dark booth)
    walk = studio | (a0 < 12)
    struct = ndimage.generate_binary_structure(2, 1)  # 4-connected — less bleed
    killed = seed & walk
    for _ in range(max(h, w)):
        grown = ndimage.binary_dilation(killed, structure=struct) & walk
        if grown.sum() == killed.sum():
            break
        killed = grown

    # Explicit seam / rim grid kill (studio gray only)
    seam = np.zeros((h, w), dtype=bool)
    for c in range(COLS + 1):
        x = min(w - 1, max(0, c * FRAME_W))
        for dx in (-1, 0):
            xx = x + dx
            if 0 <= xx < w:
                seam[:, xx] = True
    for rr in range(ROWS + 1):
        y = min(h - 1, max(0, rr * FRAME_H))
        for dy in (-1, 0):
            yy = y + dy
            if 0 <= yy < h:
                seam[yy, :] = True
    seam[:2, :] = True
    seam[-2:, :] = True
    seam[:, :2] = True
    seam[:, -2:] = True
    seam_kill = seam & studio

    kill = (killed | seam_kill) & ~protect

    alpha = a0.copy()
    alpha[kill] = 0

    # Soft 1px studio fringe next to clear
    near_clear = ndimage.binary_dilation(alpha < 8, iterations=1)
    fringe = near_clear & studio & ~protect & (alpha > 0)
    alpha[fringe] = 0  # hard punch thin studio fringe

    # Tiny studio speckles not flood-reached
    lab, _ = ndimage.label(studio & (alpha > 200))
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    tiny = sizes < 25
    tiny[0] = False
    alpha[tiny[lab] & ~protect] = 0

    # Restore protected opacity
    alpha[protect & (a0 > 200)] = 255

    out_rgb = rgb.astype(np.uint8).copy()
    out_rgb[alpha < 8] = 0
    return np.dstack([out_rgb, alpha.astype(np.uint8)])


def process_sheet(src: Path, name: str) -> Image.Image:
    arr = punch_backdrop(normalize_sheet(Image.open(src)))
    out = Image.fromarray(arr, "RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    CUTOUTS.mkdir(parents=True, exist_ok=True)
    PREV.mkdir(parents=True, exist_ok=True)
    out.save(OUT / name, "PNG", optimize=True)
    out.save(CUTOUTS / name, "PNG")
    a = arr[:, :, 3]
    print(
        f"saved {name} {out.size} a0={(a < 8).sum()} a255={(a > 250).sum()} "
        f"partial={((a >= 8) & (a <= 250)).sum()}"
    )
    return out


def crop_frame(sheet: Image.Image, index: int) -> Image.Image:
    col, row = index % COLS, index // COLS
    cell = sheet.crop((col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H))
    arr = np.array(cell)
    ys, xs = np.where(arr[:, :, 3] > 12)
    pad = 4
    y0, y1 = max(0, int(ys.min()) - pad), min(arr.shape[0], int(ys.max()) + 1 + pad)
    x0, x1 = max(0, int(xs.min()) - pad), min(arr.shape[1], int(xs.max()) + 1 + pad)
    cropped = Image.fromarray(arr[y0:y1, x0:x1], "RGBA")
    if cropped.width > MAX_FRAME_W:
        nh = int(round(cropped.height * (MAX_FRAME_W / cropped.width)))
        cropped = cropped.resize((MAX_FRAME_W, nh), Image.Resampling.LANCZOS)
    return cropped


def checker(img: Image.Image, path: Path) -> None:
    rgba = np.array(img)
    h, w = rgba.shape[:2]
    yy, xx = np.indices((h, w))
    chk = np.where(((xx // 14) + (yy // 14)) % 2 == 0, 210, 70).astype(np.float32)
    af = rgba[:, :, 3].astype(np.float32) / 255.0
    comp = (rgba[:, :, :3].astype(np.float32) * af[..., None] + chk[..., None] * (1 - af[..., None])).astype(
        np.uint8
    )
    Image.fromarray(comp, "RGB").save(path, "JPEG", quality=90)


def measure_person_h(sheet: Image.Image) -> int:
    cell = np.array(sheet.crop((0, 0, FRAME_W, FRAME_H)))
    rgb = cell[:, :, :3].astype(float)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    alpha = cell[:, :, 3]
    hair = (alpha > 200) & (r > 150) & (g > 90) & (b > 50) & (r > g + 20) & (g > b)
    ys = np.where(hair.any(axis=1))[0]
    hair_top = int(ys[0]) if len(ys) else 40
    spread = rgb.max(2) - rgb.min(2)
    subj = (alpha > 180) & ~((spread < 14) & (rgb.mean(2) >= 68) & (rgb.mean(2) <= 125))
    widths = subj.sum(1)
    booth_start = hair_top + 100
    for y in range(hair_top + 50, FRAME_H):
        if widths[y] > int(FRAME_W * 0.68):
            booth_start = y
            break
    return max(60, booth_start - hair_top), hair_top, booth_start


def main() -> None:
    front = process_sheet(FRONT_SRC, "dj_booth_front_sheet.png")
    back = process_sheet(BACK_SRC, "dj_booth_back_sheet.png")

    se = crop_frame(front, 0)
    sw = se.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    ne = crop_frame(back, 0)
    nw = ne.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    for name, img in {
        "dj_booth_se.png": se,
        "dj_booth_sw.png": sw,
        "dj_booth_ne.png": ne,
        "dj_booth_nw.png": nw,
        "dj_booth.png": se.copy(),
    }.items():
        img.save(OUT / name, "PNG", optimize=True)
        img.save(CUTOUTS / name, "PNG")
        checker(img, CUTOUTS / name.replace(".png", "_check.jpg"))
        print(f"placement {name} {img.size}")

    person_h, hair_top, booth_y = measure_person_h(front)
    luna = 88 * 417 / 784
    display_h = int(round(luna * FRAME_H / person_h))
    display_w = int(round(display_h * FRAME_W / FRAME_H))
    # Prefer tidy pair close to measured
    # Keep in-game displaySize locked (shop_furniture.json)
    display_h, display_w = 110, 98
    print(f"person_h={person_h} ({hair_top}->{booth_y}) luna={luna:.1f} → keep displaySize=[{display_w},{display_h}]")

    for label, im in ("front", front), ("back", back):
        a = np.array(im)
        rgb = a[:, :, :3].astype(np.int16)
        spread = np.max(rgb, 2) - np.min(rgb, 2)
        luma = rgb.mean(2)
        studio_left = (a[:, :, 3] > 200) & (spread < 14) & (luma >= 68) & (luma <= 125)
        near = ndimage.binary_dilation(a[:, :, 3] < 8, iterations=2)
        neon = (a[:, :, 3] > 128) & (a[:, :, 0] > 70) & (a[:, :, 2] > 85) & (a[:, :, 1] < a[:, :, 0] * 0.94)
        dark = (a[:, :, 3] > 200) & (a.max(2) <= 68)
        print(
            f"QA {label}: studio_fringe={(studio_left & near).sum()} studio_interior={studio_left.sum()} "
            f"neon={neon.sum()} dark={dark.sum()}"
        )

    meta = OUT / "dj_booth_sheet_meta.txt"
    meta.write_text(
        f"front_sheet={front.size[0]}x{front.size[1]} frame={FRAME_W}x{FRAME_H} cols={COLS} rows={ROWS}\n"
        f"back_sheet={back.size[0]}x{back.size[1]} frame={FRAME_W}x{FRAME_H} cols={COLS} rows={ROWS}\n"
        f"facing: se=front frame0, sw=front flip, ne=back frame0, nw=back flip\n"
        f"placement_se={se.size[0]}x{se.size[1]} ne={ne.size[0]}x{ne.size[1]}\n"
        f"person_h_px={person_h} displaySize=[{display_w}, {display_h}]\n"
        f"sources: front=cc3e1bad…png back=77b9f866…png (clean crops, no grid)\n"
    )
    print(meta.read_text())
    checker(front.crop((0, 0, FRAME_W, FRAME_H)), PREV / "dj_front_f0_check.jpg")
    checker(back.crop((0, 0, FRAME_W, FRAME_H)), PREV / "dj_back_f0_check.jpg")
    # strip
    for tag, sheet in ("front", front), ("back", back):
        frames = [
            sheet.crop((i % 4 * FRAME_W, i // 4 * FRAME_H, i % 4 * FRAME_W + FRAME_W, i // 4 * FRAME_H + FRAME_H)).resize(
                (100, 112), Image.Resampling.LANCZOS
            )
            for i in range(8)
        ]
        canvas = Image.new("RGBA", (800, 112))
        for i, f in enumerate(frames):
            canvas.paste(f, (i * 100, 0), f)
        checker(canvas, PREV / f"dj_{tag}_strip.jpg")
    (PREV / "dj_display_size.txt").write_text(f"{display_w},{display_h},{person_h}\n")


if __name__ == "__main__":
    main()
