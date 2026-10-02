# Assets

Runtime art is PNG under public/assets.
SVGs may remain as source; BootScene loads PNG via this.load.image only.

- `scripts/process_pinball.py`: pinball placeholder (art_src/pinball/*.jpg -> public/assets/furniture/pinball_{se,sw,ne,nw}.png; keys white, warps base to 64px / +-0.5 slopes per side).
