import Phaser from 'phaser';
import { PATRON_FRAME_W, PATRON_FRAME_H } from '../entities/Patron';

export class BootScene extends Phaser.Scene {
  private loadFailed = false;
  private statusText!: Phaser.GameObjects.Text;
  private errorText!: Phaser.GameObjects.Text;

  constructor() {
    super('BootScene');
  }

  preload(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add
      .text(w / 2, h / 2 - 40, 'Night Club', {
        fontSize: '28px',
        color: '#ff3ca0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const barY = h - 72;
    const bar = this.add.rectangle(w / 2, barY, 280, 14, 0x2a1638).setOrigin(0.5);
    const fill = this.add.rectangle(w / 2 - 138, barY, 4, 10, 0xff3ca0).setOrigin(0, 0.5);

    this.statusText = this.add
      .text(w / 2, barY + 28, 'Cargando 0%…', {
        fontSize: '14px',
        color: '#c8a0e0',
      })
      .setOrigin(0.5);

    this.errorText = this.add
      .text(w / 2, barY - 36, '', {
        fontSize: '13px',
        color: '#ff6688',
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.load.setPath('./');

    this.load.on('progress', (v: number) => {
      fill.width = 4 + 272 * v;
      const pct = Math.round(v * 100);
      this.statusText.setText(`Cargando ${pct}%…`);
    });

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.loadFailed = true;
      const key = file?.key ?? '?';
      const url = (file as { url?: string })?.url ?? '';
      const msg = `Error cargando: ${key}${url ? ` (${url})` : ''}`;
      console.error('[BootScene]', msg, file);
      this.errorText.setText(msg).setVisible(true);
      this.statusText.setText('Fallo al cargar assets');
      this.statusText.setColor('#ff6688');
    });

    this.load.on('complete', () => {
      if (this.loadFailed) {
        this.statusText.setText('Carga incompleta — revisa la consola');
        this.statusText.setColor('#ff6688');
        return;
      }
      this.statusText.setText('Cargando 100%…');
      this.ensureCharacterAnims();
      this.scene.start('ClubScene');
      this.scene.launch('UIScene');
      this.scene.bringToTop('UIScene');
    });

    // Floor: data/floor.json lists the tile types; their PNGs are queued as soon as it is parsed
    // (swap art by replacing public/assets/tiles/floor_<type>.png, no code change).
    this.load.json('floor', 'data/floor.json');
    this.load.once('filecomplete-json-floor', () => {
      const floor = this.cache.json.get('floor') as {
        image?: { texture: string; file: string };
        types?: Array<{ texture: string; file: string }>;
      };
      // Single-image mode (floor.image) loads only that picture; tile mode loads every tile type.
      if (floor?.image) this.load.image(floor.image.texture, floor.image.file);
      else for (const t of floor?.types ?? []) this.load.image(t.texture, t.file);
    });

    // Furniture: the medieval sofa and drink bar (single fixed pose, no rotation). DJ / pinball and the
    // neon placeholder pieces are gone (their art files were deleted from the repo).
    this.load.image('furn_sofa_medieval', 'assets/furniture/sofa_medieval_sw.png');
    this.load.image('furn_bar_medieval', 'assets/furniture/bar_medieval_sw.png');

    this.load.spritesheet('luna_idle', 'assets/characters/luna_idle_standing.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    // Back-facing idle (8 frames, 146×784). Front 'luna_idle' is a single 146×784 standing frame.
    this.load.spritesheet('luna_idle_back', 'assets/characters/luna_idle_back_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    // Luna walk, two alternative cycles (SE = semi-right, 10 frames of 200×784; SW = flipX of these)
    this.load.spritesheet('luna_walk_a', 'assets/characters/luna_walk_a_se_sheet.png', {
      frameWidth: 200,
      frameHeight: 784,
    });
    this.load.spritesheet('luna_walk_b', 'assets/characters/luna_walk_b_se_sheet.png', {
      frameWidth: 200,
      frameHeight: 784,
    });
    this.load.spritesheet('luna_serve_beer', 'assets/characters/luna_serve_beer_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    this.load.image('bartender', 'assets/characters/bartender.png');
    // Legacy single-frame keys (same male client art)
    this.load.image('patron_a', 'assets/characters/patron_a.png');
    this.load.image('patron_b', 'assets/characters/patron_b.png');
    this.load.image('patron_c', 'assets/characters/patron_c.png');
    // Male client iso walk (4×6) + idle (4 facings)
    this.load.spritesheet('patron_walk', 'assets/characters/patron_walk_sheet.png', {
      frameWidth: PATRON_FRAME_W,
      frameHeight: PATRON_FRAME_H,
    });
    this.load.spritesheet('patron_idle', 'assets/characters/patron_idle_sheet.png', {
      frameWidth: PATRON_FRAME_W,
      frameHeight: PATRON_FRAME_H,
    });
    this.load.spritesheet('nova_idle', 'assets/characters/nova_idle_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    this.load.spritesheet('nova_serve_beer', 'assets/characters/nova_serve_beer_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    this.load.image('nova', 'assets/characters/nova.png');
    this.load.image('nova_portrait', 'assets/characters/nova_portrait.png');
    this.load.image('luna_portrait', 'assets/characters/luna_portrait.png');

    this.load.json('characters', 'data/characters.json');
    this.load.json('scenario', 'data/scenario.json');
    this.load.json('staff_pool', 'data/staff_pool.json');
    this.load.json('shop_furniture', 'data/shop_furniture.json');

    void bar;
  }

  create(): void {
    if (this.loadFailed) return;
  }

  private ensureCharacterAnims(): void {
    // Luna directional idle: SE/SW = front sheet, NE/NW = back sheet (flipX in Character)
    const lunaIdleFacings: Array<{ key: string; texture: string }> = [
      { key: 'se', texture: 'luna_idle' },
      { key: 'sw', texture: 'luna_idle' },
      { key: 'ne', texture: 'luna_idle_back' },
      { key: 'nw', texture: 'luna_idle_back' },
    ];
    for (const f of lunaIdleFacings) {
      const animKey = `luna-idle-${f.key}`;
      if (!this.anims.exists(animKey) && this.textures.exists(f.texture)) {
        this.anims.create({
          key: animKey,
          // Front (SE/SW) idle is ONE static standing frame; back (NE/NW) keeps its 8-frame loop.
          frames: this.anims.generateFrameNumbers(f.texture, {
            start: 0,
            end: f.texture === 'luna_idle' ? 0 : 7,
          }),
          frameRate: 9,
          repeat: -1,
        });
      }
    }
    // Luna walk variants a/b: SE anim; SW anim uses the same SE frames, Character mirrors with flipX.
    for (const v of ['a', 'b']) {
      const tex = `luna_walk_${v}`;
      if (!this.textures.exists(tex)) continue;
      for (const f of ['se', 'sw']) {
        const k = `luna-walk-${v}-${f}`;
        if (this.anims.exists(k)) continue;
        this.anims.create({
          key: k,
          frames: this.anims.generateFrameNumbers(tex, { start: 0, end: 9 }),
          frameRate: 9,
          repeat: -1,
        });
      }
    }
    // Legacy alias (default SE)
    if (!this.anims.exists('luna-idle') && this.anims.exists('luna-idle-se')) {
      this.anims.create({
        key: 'luna-idle',
        frames: this.anims.generateFrameNumbers('luna_idle', { start: 0, end: 0 }),
        frameRate: 9,
        repeat: -1,
      });
    }
    // 8 frames over 2.0s for beer pour / prepare
    if (!this.anims.exists('luna-serve-beer') && this.textures.exists('luna_serve_beer')) {
      this.anims.create({
        key: 'luna-serve-beer',
        frames: this.anims.generateFrameNumbers('luna_serve_beer', { start: 0, end: 7 }),
        frameRate: 4,
        repeat: 0,
      });
    }
    if (!this.anims.exists('nova-idle')) {
      this.anims.create({
        key: 'nova-idle',
        frames: this.anims.generateFrameNumbers('nova_idle', { start: 0, end: 7 }),
        frameRate: 9,
        repeat: -1,
      });
    }
    // 8 frames over 2.0s — match Luna cerveza pour
    if (!this.anims.exists('nova-serve-beer') && this.textures.exists('nova_serve_beer')) {
      this.anims.create({
        key: 'nova-serve-beer',
        frames: this.anims.generateFrameNumbers('nova_serve_beer', { start: 0, end: 7 }),
        frameRate: 4,
        repeat: 0,
      });
    }

    // patron_walk sheet: row0 SE 0-5, SW 6-11, NE 12-17, NW 18-23
    const facings: Array<{ key: string; start: number }> = [
      { key: 'se', start: 0 },
      { key: 'sw', start: 6 },
      { key: 'ne', start: 12 },
      { key: 'nw', start: 18 },
    ];
    for (const f of facings) {
      const walkKey = `patron-walk-${f.key}`;
      if (!this.anims.exists(walkKey) && this.textures.exists('patron_walk')) {
        this.anims.create({
          key: walkKey,
          frames: this.anims.generateFrameNumbers('patron_walk', {
            start: f.start,
            end: f.start + 5,
          }),
          frameRate: 10,
          repeat: -1,
        });
      }
      const idleKey = `patron-idle-${f.key}`;
      if (!this.anims.exists(idleKey)) {
        if (this.textures.exists('patron_idle')) {
          const idleFrame = facings.findIndex((x) => x.key === f.key);
          this.anims.create({
            key: idleKey,
            frames: this.anims.generateFrameNumbers('patron_idle', {
              start: idleFrame,
              end: idleFrame,
            }),
            frameRate: 1,
            repeat: -1,
          });
        } else if (this.textures.exists('patron_walk')) {
          // Standing = first frame of walk cycle
          this.anims.create({
            key: idleKey,
            frames: this.anims.generateFrameNumbers('patron_walk', {
              start: f.start,
              end: f.start,
            }),
            frameRate: 1,
            repeat: -1,
          });
        }
      }
    }
  }
}
