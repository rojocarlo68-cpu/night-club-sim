# Assets

Runtime art is PNG under public/assets.
SVGs may remain as source; BootScene loads PNG via this.load.image only.

- `scripts/process_pinball.py`: pinball placeholder (art_src/pinball/*.jpg -> public/assets/furniture/pinball_{se,sw,ne,nw}.png; keys white, warps base to 64px / +-0.5 slopes per side).
- `scripts/cut_client_hoodie_idle.py` + `scripts/process_client_hoodie_idle.py`: client (hoodie guy) idle art_src/client_hoodie_idle_cutout.png -> public/assets/characters/client_hoodie_idle_sheet.png (2 frames 560x960: SE + mirrored SW; same scale as the 112x192 patron sheets x5; soles y=950).
- `scripts/process_client_hoodie_walk.py`: client (hoodie guy) walk, SE as drawn (10 cut-out frames; walk_10 had a white patch between the legs removed) -> public/assets/characters/client_hoodie_walk_se_sheet.png (10 frames 560x960, 5x2 grid, same frame/scale/soles y=950 as the idle; SW = flipX in game) + art_src/client_walk/client_hoodie_walk_sw_sheet.png (mirrored reference).
- `scripts/cut_nova_idle.py` + `scripts/process_nova_idle.py`: Nova idle (white bg + magenta residue) -> art_src/nova_idle_cutout.png -> public/assets/characters/nova_idle_sheet.png (2 static frames 146x784: SE + mirrored SW; visible body 476 px like the previous Nova idle, soles y=610).
- `clean_nova_walk.py` + `process_nova_walk.py` — Nova walk SE (10 frames 156×784, 476px body / soles y=610) → `public/assets/characters/nova_walk_se_sheet.png`; SW = flipX in game (mirrored reference in `art_src/nova_walk/`).
