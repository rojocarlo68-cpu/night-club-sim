import Phaser from 'phaser';

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

    // Title stays centered; progress UI near bottom
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

    // Prefer paths relative to the page (Vite base: './')
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
      // Leave immediately into gameplay scenes
      this.scene.start('ClubScene');
      this.scene.launch('UIScene');
    });

    // Room backdrop (Carlo art)
    this.load.image('room_floor', 'assets/tiles/room_floor.jpeg');

    // Furniture — PNG only (no load.svg)
    this.load.image('furn_sofa_se', 'assets/furniture/sofa_se.png');
    this.load.image('furn_sofa_sw', 'assets/furniture/sofa_sw.png');
    this.load.image('furn_sofa_ne', 'assets/furniture/sofa_ne.png');
    this.load.image('furn_sofa_nw', 'assets/furniture/sofa_nw.png');
    this.load.image('furn_bar_se', 'assets/furniture/bar_se.png');
    this.load.image('furn_bar_sw', 'assets/furniture/bar_sw.png');
    this.load.image('furn_bar_ne', 'assets/furniture/bar_ne.png');
    this.load.image('furn_bar_nw', 'assets/furniture/bar_nw.png');
    this.load.image('furn_bar', 'assets/furniture/bar_se.png');

    // Optional legacy tiles
    this.load.image('tile_floor', 'assets/tiles/floor.png');
    this.load.image('tile_wall', 'assets/tiles/wall.png');

    // Characters — Luna/Nova idle spritesheets + patron PNGs
    this.load.spritesheet('luna_idle', 'assets/characters/luna_idle_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    this.load.image('bartender', 'assets/characters/bartender.png'); // legacy fallback
    this.load.image('patron_a', 'assets/characters/patron_a.png');
    this.load.image('patron_b', 'assets/characters/patron_b.png');
    this.load.image('patron_c', 'assets/characters/patron_c.png');
    this.load.spritesheet('nova_idle', 'assets/characters/nova_idle_sheet.png', {
      frameWidth: 146,
      frameHeight: 784,
    });
    this.load.image('nova', 'assets/characters/nova.png'); // legacy static (unused in-world)
    this.load.image('nova_portrait', 'assets/characters/nova_portrait.png');
    this.load.image('luna_portrait', 'assets/characters/luna_portrait.png');

    this.load.json('characters', 'data/characters.json');
    this.load.json('scenario', 'data/scenario.json');
    this.load.json('staff_pool', 'data/staff_pool.json');

    // Silence unused locals (bar kept for visual track)
    void bar;
  }

  create(): void {
    // Scene transition is driven by loader 'complete' so we never hang
    // if create somehow runs without a successful load.
    if (this.loadFailed) return;
  }

  private ensureCharacterAnims(): void {
    // Luna idle: loop original sheet only (no alternate B).
    if (!this.anims.exists('luna-idle')) {
      this.anims.create({
        key: 'luna-idle',
        frames: this.anims.generateFrameNumbers('luna_idle', { start: 0, end: 7 }),
        frameRate: 9,
        repeat: -1,
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
  }
}
