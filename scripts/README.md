# Assets

Runtime art is PNG under public/assets.
SVGs may remain as source; BootScene loads PNG via this.load.image only.

- `scripts/process_pinball.py`: pinball placeholder (art_src/pinball/*.jpg -> public/assets/furniture/pinball_{se,sw,ne,nw}.png; keys white, warps base to 64px / +-0.5 slopes per side).
- `scripts/cut_client_hoodie_idle.py` + `scripts/process_client_hoodie_idle.py`: client (hoodie guy) idle art_src/client_hoodie_idle_cutout.png -> public/assets/characters/client_hoodie_idle_sheet.png (2 frames 560x960: SE + mirrored SW; same scale as the 112x192 patron sheets x5; soles y=950).
