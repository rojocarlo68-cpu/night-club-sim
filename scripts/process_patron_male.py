#!/usr/bin/env python3
"""Build male patron Phaser spritesheets from gray-bg walk ISO sheet."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ATT = Path('/home/box/agent-data/agents/f700e6ae-328d-4b52-bf56-2e253ee65a34/attachments')
WALK_ISO = ATT / '97e5b57c924ce378660194ff9e561f779a991228431769efeee78db1fff40404.jpeg'
FRONT = ATT / '88be5b319d3131a516e1022a5b178ab60af9a73406da4848455dbf606ff8baf2.jpeg'
GAME = Path('/workspace/night-club-sim/public/assets/characters')
FW, FH = 112, 192
DIRS = ['se', 'sw', 'ne', 'nw']


def gray_to_alpha(rgb: np.ndarray) -> np.ndarray:
    src = rgb.astype(np.float32)
    corners = np.stack([src[2, 2], src[2, -3], src[-3, 2], src[-3, -3]])
    bg = corners.mean(axis=0)
    dist = np.sqrt(((src - bg) ** 2).sum(axis=2))
    spread = src.max(axis=2) - src.min(axis=2)
    luma = src.mean(axis=2)
    near_gray = (spread < 14) & (np.abs(luma - bg.mean()) < 30) & (dist < 32)
    cand = near_gray | (dist < 10)
    lab, _ = ndimage.label(cand)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    bg_mask = np.isin(lab, border) | (near_gray & (dist < 22))
    is_chromatic = spread >= 12
    is_dark = luma < 70
    force = (is_chromatic & (dist > 8)) | is_dark | (dist > 35)
    alpha = np.ones(src.shape[:2], dtype=np.float32)
    alpha = np.where(bg_mask & ~force, 0.0, alpha)
    chroma_a = np.clip((dist - 6.0) / 12.0, 0, 1)
    alpha = np.where(near_gray & ~force, np.minimum(alpha, chroma_a), alpha)
    alpha = np.where(force, 1.0, alpha)
    return np.dstack([rgb, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])


def cell_ranges(arr):
    spread = arr.max(axis=2) - arr.min(axis=2)
    col_c = (spread > 15).mean(axis=0)
    row_c = (spread > 15).mean(axis=1)

    def empty_runs(frac, min_w):
        empty = np.where(frac < 0.005)[0]
        runs, s, p = [], None, None
        for c in empty:
            if s is None:
                s = p = int(c)
            elif c == p + 1:
                p = int(c)
            else:
                if p - s + 1 >= min_w:
                    runs.append((s, p))
                s = p = int(c)
        if s is not None and p - s + 1 >= min_w:
            runs.append((s, p))
        return runs

    h, w = arr.shape[:2]
    xs, prev = [], 0
    for a, b in empty_runs(col_c, 20):
        if a - prev > 40:
            xs.append((prev, a))
        prev = b + 1
    if w - prev > 40:
        xs.append((prev, w))
    ys, prev = [], 0
    for a, b in empty_runs(row_c, 5):
        if a - prev > 40:
            ys.append((prev, a))
        prev = b + 1
    if h - prev > 40:
        ys.append((prev, h))
    return xs, ys


def extract_subject(rgba_cell):
    a = rgba_cell[:, :, 3].copy()
    rgb = rgba_cell[:, :, :3].astype(np.float32)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    luma = rgb.mean(axis=2)
    a[(luma > 200) & (spread < 50)] = 0
    ys, xs = np.where(a > 20)
    if len(xs) == 0:
        return np.zeros((FH, FW, 4), dtype=np.uint8)
    crop = np.dstack([rgba_cell[:, :, :3], a])[ys.min():ys.max()+1, xs.min():xs.max()+1]
    ch, cw = crop.shape[:2]
    scale = min((FW - 4) / cw, (FH - 4) / ch)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.Resampling.LANCZOS)
    out = np.zeros((FH, FW, 4), dtype=np.uint8)
    out[FH - nh - 2:FH - 2, (FW - nw) // 2:(FW - nw) // 2 + nw] = np.array(img)
    return out


def main():
    rgb = np.array(Image.open(WALK_ISO).convert('RGB'))
    rgba = gray_to_alpha(rgb)
    xs, ys = cell_ranges(rgb)
    assert len(xs) == 6 and len(ys) == 4
    frames = []
    for y0, y1 in ys:
        row = [extract_subject(rgba[y0:y1, x0:x1].copy()) for x0, x1 in xs]
        frames.append(row)
    sheet = Image.new('RGBA', (FW * 6, FH * 4), (0, 0, 0, 0))
    for ri, row in enumerate(frames):
        for ci, fr in enumerate(row):
            sheet.paste(Image.fromarray(fr), (ci * FW, ri * FH))
    sheet.save(GAME / 'patron_walk_sheet.png')
    idle = Image.new('RGBA', (FW * 4, FH), (0, 0, 0, 0))
    for ri, row in enumerate(frames):
        idle.paste(Image.fromarray(row[0]), (ri * FW, 0))
    idle.save(GAME / 'patron_idle_sheet.png')
    se = Image.fromarray(frames[0][0])
    for name in ('patron_a.png', 'patron_b.png', 'patron_c.png'):
        se.save(GAME / name)
    frgb = np.array(Image.open(FRONT).convert('RGB'))
    frgba = gray_to_alpha(frgb)
    a = frgba[:, :, 3]
    ys, xs = np.where(a > 20)
    crop = frgba[ys.min():ys.max()+1, xs.min():xs.max()+1]
    img = Image.fromarray(crop, 'RGBA')
    h = 200
    img = img.resize((max(1, int(img.width * h / img.height)), h), Image.Resampling.LANCZOS)
    img.save(GAME / 'patron_portrait.png')
    print(f'OK frames {FW}x{FH} sheet={sheet.size}')


if __name__ == '__main__':
    main()
