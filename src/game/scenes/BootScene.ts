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
      this.ensurePlaceholderFurniture();
      this.scene.start('ClubScene');
      this.scene.launch('UIScene');
      this.scene.bringToTop('UIScene');
    });

    this.load.image('room_floor', 'assets/tiles/room_floor.jpeg');

    this.load.image('furn_sofa_se', 'assets/furniture/sofa_se.png');
    this.load.image('furn_sofa_sw', 'assets/furniture/sofa_sw.png');
    this.load.image('furn_sofa_ne', 'assets/furniture/sofa_ne.png');
    this.load.image('furn_sofa_nw', 'assets/furniture/sofa_nw.png');
    this.load.image('furn_bar_se', 'assets/furniture/bar_se.png');
    this.load.image('furn_bar_sw', 'assets/furniture/bar_sw.png');
    this.load.image('furn_bar_ne', 'assets/furniture/bar_ne.png');
    this.load.image('furn_bar_nw', 'assets/furniture/bar_nw.png');
    this.load.image('furn_bar', 'assets/furniture/bar_se.png');
    this.load.image('furn_dj_booth_se', 'assets/furniture/dj_booth_se.png');
    this.load.image('furn_dj_booth_sw', 'assets/furniture/dj_booth_sw.png');
    this.load.image('furn_dj_booth_ne', 'assets/furniture/dj_booth_ne.png');
    this.load.image('furn_dj_booth_nw', 'assets/furniture/dj_booth_nw.png');
    // Legacy alias (shop thumb / old saves) → SE
    this.load.image('furn_dj_booth', 'assets/furniture/dj_booth_se.png');
    // Idle sheets (2×4): front=SE/SW, back=NE/NW
    this.load.spritesheet('dj_booth_front_sheet', 'assets/furniture/dj_booth_front_sheet.png', {
      frameWidth: 400,
      frameHeight: 450,
    });
    this.load.spritesheet('dj_booth_back_sheet', 'assets/furniture/dj_booth_back_sheet.png', {
      frameWidth: 400,
      frameHeight: 450,
    });

    this.load.image('tile_floor', 'assets/tiles/floor.png');
    this.load.image('tile_wall', 'assets/tiles/wall.png');

    this.load.spritesheet('luna_idle', 'assets/characters/luna_idle_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    // Back-facing idle (normalized to same 146×784 as front)
    this.load.spritesheet('luna_idle_back', 'assets/characters/luna_idle_back_sheet.png', {
      frameWidth: 146,
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
          frames: this.anims.generateFrameNumbers(f.texture, { start: 0, end: 7 }),
          frameRate: 9,
          repeat: -1,
        });
      }
    }
    // Legacy alias (default SE)
    if (!this.anims.exists('luna-idle') && this.anims.exists('luna-idle-se')) {
      this.anims.create({
        key: 'luna-idle',
        frames: this.anims.generateFrameNumbers('luna_idle', { start: 0, end: 7 }),
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

    // DJ booth idle (subtle 8-frame loop) — front sheet SE/SW, back NE/NW
    if (!this.anims.exists('dj-booth-idle-front') && this.textures.exists('dj_booth_front_sheet')) {
      this.anims.create({
        key: 'dj-booth-idle-front',
        frames: this.anims.generateFrameNumbers('dj_booth_front_sheet', { start: 0, end: 7 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    if (!this.anims.exists('dj-booth-idle-back') && this.textures.exists('dj_booth_back_sheet')) {
      this.anims.create({
        key: 'dj-booth-idle-back',
        frames: this.anims.generateFrameNumbers('dj_booth_back_sheet', { start: 0, end: 7 }),
        frameRate: 6,
        repeat: -1,
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
  /** Procedural iso placeholders for shop decor (no new art sheets). */
  private ensurePlaceholderFurniture(): void {
    const specs: Array<{
      key: string;
      color: number;
      accent: number;
      w: number;
      h: number;
      kind: 'box' | 'tall' | 'plant' | 'light' | 'speaker' | 'chair' | 'table';
    }> = [
      { key: 'furn_mesa_cocktail', color: 0x6b3d2e, accent: 0xc4a574, w: 96, h: 110, kind: 'table' },
      { key: 'furn_silla', color: 0x3a2a4a, accent: 0xb48cff, w: 80, h: 100, kind: 'chair' },
      { key: 'furn_banqueta', color: 0x2a2238, accent: 0xff9ad5, w: 84, h: 92, kind: 'chair' },
      { key: 'furn_mesa_vip', color: 0x4a3058, accent: 0xffe066, w: 160, h: 120, kind: 'table' },
      { key: 'furn_planta', color: 0x1e5c38, accent: 0x6dff9a, w: 72, h: 120, kind: 'plant' },
      { key: 'furn_altavoz', color: 0x222028, accent: 0x2ad6ff, w: 88, h: 118, kind: 'speaker' },
      { key: 'furn_luz_pista', color: 0x3a1048, accent: 0xff3ca0, w: 80, h: 108, kind: 'light' },
    ];
    for (const s of specs) {
      if (this.textures.exists(s.key)) continue;
      const g = this.add.graphics();
g.setVisible(false);
      const cx = s.w / 2;
      const cy = s.h * 0.62;
      const hw = Math.min(s.w, s.h) * 0.38;
      const hh = hw * 0.5;
      // Floor diamond shadow
      g.fillStyle(0x000000, 0.35);
      g.fillPoints(
        [
          { x: cx, y: cy + hh + 4 },
          { x: cx + hw, y: cy + 4 },
          { x: cx, y: cy - hh + 4 },
          { x: cx - hw, y: cy + 4 },
        ],
        true
      );
      if (s.kind === 'plant') {
        g.fillStyle(0x4a3020, 1);
        g.fillRect(cx - 10, cy - 8, 20, 18);
        g.fillStyle(s.color, 1);
        g.fillEllipse(cx, cy - 36, 36, 48);
        g.fillStyle(s.accent, 0.85);
        g.fillEllipse(cx - 8, cy - 48, 18, 22);
        g.fillEllipse(cx + 10, cy - 40, 16, 20);
      } else if (s.kind === 'light') {
        g.fillStyle(0x2a1838, 1);
        g.fillRect(cx - 4, cy - 50, 8, 54);
        g.fillStyle(s.accent, 0.95);
        g.fillCircle(cx, cy - 56, 14);
        g.fillStyle(0xffffff, 0.55);
        g.fillCircle(cx - 3, cy - 59, 4);
      } else if (s.kind === 'speaker') {
        g.fillStyle(s.color, 1);
        g.fillRoundedRect(cx - 22, cy - 58, 44, 70, 6);
        g.lineStyle(2, s.accent, 1);
        g.strokeRoundedRect(cx - 22, cy - 58, 44, 70, 6);
        g.fillStyle(s.accent, 0.7);
        g.fillCircle(cx, cy - 36, 12);
        g.fillCircle(cx, cy - 10, 8);
      } else if (s.kind === 'chair') {
        g.fillStyle(s.color, 1);
        g.fillPoints(
          [
            { x: cx, y: cy + hh * 0.7 },
            { x: cx + hw * 0.7, y: cy },
            { x: cx, y: cy - hh * 0.7 },
            { x: cx - hw * 0.7, y: cy },
          ],
          true
        );
        g.fillStyle(s.accent, 0.9);
        g.fillRect(cx - 14, cy - 48, 28, 34);
        g.fillStyle(s.color, 1);
        g.fillRect(cx - 16, cy - 52, 6, 40);
      } else {
        // table / box: iso diamond top + sides
        const topY = cy - hh * 0.85;
        g.fillStyle(s.accent, 1);
        g.fillPoints(
          [
            { x: cx, y: topY - hh },
            { x: cx + hw, y: topY },
            { x: cx, y: topY + hh },
            { x: cx - hw, y: topY },
          ],
          true
        );
        g.fillStyle(s.color, 1);
        g.fillPoints(
          [
            { x: cx - hw, y: topY },
            { x: cx, y: topY + hh },
            { x: cx, y: cy + hh * 0.35 },
            { x: cx - hw, y: cy - hh * 0.35 },
          ],
          true
        );
        g.fillStyle(0x1a1018, 1);
        g.fillPoints(
          [
            { x: cx + hw, y: topY },
            { x: cx, y: topY + hh },
            { x: cx, y: cy + hh * 0.35 },
            { x: cx + hw, y: cy - hh * 0.35 },
          ],
          true
        );
        g.lineStyle(1, 0xffffff, 0.25);
        g.strokePoints(
          [
            { x: cx, y: topY - hh },
            { x: cx + hw, y: topY },
            { x: cx, y: topY + hh },
            { x: cx - hw, y: topY },
          ],
          true
        );
      }
      g.generateTexture(s.key, s.w, s.h);
      g.destroy();
    }
  }

}
