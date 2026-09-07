import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const bar = this.add.rectangle(w / 2, h / 2, 240, 12, 0x2a1638).setOrigin(0.5);
    const fill = this.add.rectangle(w / 2 - 118, h / 2, 4, 8, 0xff3ca0).setOrigin(0, 0.5);
    this.add
      .text(w / 2, h / 2 - 36, 'Night Club', {
        fontSize: '28px',
        color: '#ff3ca0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h / 2 + 28, 'Cargando…', { fontSize: '14px', color: '#c8a0e0' })
      .setOrigin(0.5);

    this.load.on('progress', (v: number) => {
      fill.width = 4 + 232 * v;
    });

    // SVG assets (placeholders — replace with PNGs later)
    this.load.svg('tile_floor', 'assets/tiles/floor.svg', { width: 64, height: 32 });
    this.load.svg('tile_wall', 'assets/tiles/wall.svg', { width: 64, height: 48 });
    this.load.svg('furn_bar', 'assets/furniture/bar.svg', { width: 96, height: 80 });
    this.load.svg('furn_sofa', 'assets/furniture/sofa.svg', { width: 96, height: 64 });
    this.load.svg('bartender', 'assets/characters/bartender.svg', { width: 64, height: 64 });
    this.load.svg('patron_a', 'assets/characters/patron_a.svg', { width: 64, height: 64 });
    this.load.svg('patron_b', 'assets/characters/patron_b.svg', { width: 64, height: 64 });
    this.load.svg('patron_c', 'assets/characters/patron_c.svg', { width: 64, height: 64 });

    this.load.json('characters', 'data/characters.json');
    this.load.json('scenario', 'data/scenario.json');
  }

  create(): void {
    this.scene.start('ClubScene');
    this.scene.launch('UIScene');
  }
}
