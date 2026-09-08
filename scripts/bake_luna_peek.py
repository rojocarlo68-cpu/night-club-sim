#!/usr/bin/env python3
"""Bake luna_idle_peek_sheet.png from luna_idle_sheet.png.

Same 1168×784 / 8 frames of 146×784. Keep pixels from top through ~navel
(CUTOFF_FRAC of frame height); set alpha=0 below with a short soft fade.
Preserves RGB (including black outfit) — only alpha is cleared.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/assets/characters/luna_idle_sheet.png"
DST = ROOT / "public/assets/characters/luna_idle_peek_sheet.png"
FW, FH = 146, 784
FRAMES = 8
CUTOFF_FRAC = 0.48  # ~navel/waist (45–50% range)
FADE_PX = 3


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    assert im.size == (FW * FRAMES, FH), im.size
    out = im.copy()
    px = out.load()
    cut_y = int(FH * CUTOFF_FRAC)
    fade_start = cut_y - FADE_PX

    for fi in range(FRAMES):
        x0 = fi * FW
        for y in range(FH):
            if y < fade_start:
                continue
            if y >= cut_y:
                for x in range(x0, x0 + FW):
                    r, g, b, a = px[x, y]
                    if a == 0:
                        continue
                    px[x, y] = (r, g, b, 0)
            else:
                t = (y - fade_start + 1) / (FADE_PX + 1)
                mul = max(0.0, 1.0 - t)
                for x in range(x0, x0 + FW):
                    r, g, b, a = px[x, y]
                    if a == 0:
                        continue
                    px[x, y] = (r, g, b, int(round(a * mul)))

    out.save(DST, optimize=True)
    print(f"Wrote {DST} cutoff={CUTOFF_FRAC:.0%} cut_y={cut_y} fade={FADE_PX}px")


if __name__ == "__main__":
    main()
