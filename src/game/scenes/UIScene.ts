import Phaser from 'phaser';

interface HudBartender {
  name: string;
  energy: number;
  mood: number;
  skill: number;
  state: string;
}

interface HudState {
  money: number;
  phase: string;
  nightTimer: number;
  bartender: HudBartender | null;
  nightEarned?: number;
  servedCount?: number;
  buildMode?: boolean;
}

export class UIScene extends Phaser.Scene {
  private moneyText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private openBtn!: Phaser.GameObjects.Container;
  private closeBtn!: Phaser.GameObjects.Container;
  private buildBtn!: Phaser.GameObjects.Container;
  private doneBuildBtn!: Phaser.GameObjects.Container;
  private restBtn!: Phaser.GameObjects.Container;
  private panel!: Phaser.GameObjects.Container;
  private panelVisible = false;
  private panelDismissBtn!: Phaser.GameObjects.Container;
  private summary!: Phaser.GameObjects.Container;
  private energyBar!: Phaser.GameObjects.Rectangle;
  private moodBar!: Phaser.GameObjects.Rectangle;
  private panelName!: Phaser.GameObjects.Text;
  private panelStats!: Phaser.GameObjects.Text;
  private phase: string = 'prep';
  private buildMode = false;

  constructor() {
    super({ key: 'UIScene', active: false });
  }

  create(): void {
    const cam = this.cameras.main;

    // Top HUD
    const hudBg = this.add.rectangle(0, 0, cam.width, 52, 0x12081e, 0.85).setOrigin(0);
    hudBg.setScrollFactor(0);
    // Block world pan from "hitting through" the HUD
    hudBg.setInteractive();

    this.moneyText = this.add
      .text(16, 14, 'Dinero: $40', {
        fontSize: '18px',
        color: '#ffe066',
        fontStyle: 'bold',
      })
      .setScrollFactor(0);

    this.timerText = this.add
      .text(cam.width / 2, 14, 'Noche: —', {
        fontSize: '16px',
        color: '#c8a0e0',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    this.openBtn = this.makeButton(cam.width - 150, 8, 130, 36, 'Abrir noche', () => {
      if (this.buildMode) return;
      this.game.events.emit('cmd-open-night');
    });
    this.closeBtn = this.makeButton(cam.width - 150, 8, 130, 36, 'Cerrar noche', () => {
      this.game.events.emit('cmd-close-night');
    });
    this.closeBtn.setVisible(false);

    this.buildBtn = this.makeButton(16, cam.height - 48, 110, 36, 'Construir', () => {
      if (this.phase === 'open') return;
      this.game.events.emit('cmd-set-build-mode', true);
    });
    this.doneBuildBtn = this.makeButton(16, cam.height - 48, 110, 36, 'Listo', () => {
      this.game.events.emit('cmd-set-build-mode', false);
    });
    this.doneBuildBtn.setVisible(false);

    // Side panel
    this.panel = this.add.container(cam.width - 20, 70).setScrollFactor(0).setVisible(false);
    const panelBg = this.add.rectangle(0, 0, 260, 300, 0x1a0e28, 0.92).setOrigin(1, 0);
    panelBg.setStrokeStyle(2, 0xff3ca0);
    // Absorb pointer so ClubScene pan doesn't steal panel drags
    panelBg.setInteractive();

    this.panelName = this.add
      .text(-250, 12, 'Luna', { fontSize: '20px', color: '#ff9ad5', fontStyle: 'bold' })
      .setOrigin(0, 0);
    this.panelStats = this.add
      .text(-250, 48, '', { fontSize: '14px', color: '#e8d0ff', lineSpacing: 8 })
      .setOrigin(0, 0);

    this.panel.removeAll(false);
    const eLabel = this.add.text(-250, 130, 'Energía', { fontSize: '12px', color: '#a080c0' });
    const mLabel = this.add.text(-250, 170, 'Ánimo', { fontSize: '12px', color: '#a080c0' });
    const eBg = this.add.rectangle(-250, 150, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const mBg = this.add.rectangle(-250, 190, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(-250, 150, 220, 12, 0x3cff9a).setOrigin(0, 0.5);
    this.moodBar = this.add.rectangle(-250, 190, 220, 12, 0xffb84d).setOrigin(0, 0.5);
    this.restBtn = this.makeLocalButton(-250, 220, 200, 36, 'Descansar', () => {
      this.game.events.emit('cmd-rest');
    });

    this.panelDismissBtn = this.makeLocalButton(-56, 8, 36, 32, '✕', () => {
      this.hidePanel();
    });

    this.panel.add([
      panelBg,
      this.panelName,
      this.panelStats,
      eLabel,
      mLabel,
      eBg,
      mBg,
      this.energyBar,
      this.moodBar,
      this.restBtn,
      this.panelDismissBtn,
    ]);

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ESC', () => {
        if (this.panelVisible) this.hidePanel();
        else if (this.buildMode) this.game.events.emit('cmd-set-build-mode', false);
      });
    }

    // Summary overlay
    this.summary = this.add.container(cam.width / 2, cam.height / 2).setScrollFactor(0).setVisible(false);
    const sumBg = this.add.rectangle(0, 0, 380, 260, 0x140a22, 0.95);
    sumBg.setStrokeStyle(2, 0x2ad6ff);
    sumBg.setInteractive();
    const sumTitle = this.add
      .text(0, -100, 'Fin de la noche', {
        fontSize: '24px',
        color: '#2ad6ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('title');
    const sumBody = this.add
      .text(0, -20, '', {
        fontSize: '16px',
        color: '#f0e0ff',
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5)
      .setName('body');
    const again = this.makeLocalButton(-100, 80, 200, 40, 'Abrir noche', () => {
      if (this.buildMode) return;
      this.summary.setVisible(false);
      this.game.events.emit('cmd-open-night');
    });
    this.summary.add([sumBg, sumTitle, sumBody, again]);

    this.game.events.on('club-ready', this.onStats, this);
    this.game.events.on('stats-updated', this.onStats, this);
    this.game.events.on('night-started', this.onNightStarted, this);
    this.game.events.on('night-summary', this.onSummary, this);
    this.game.events.on('select-bartender', this.onSelectBartender, this);
    this.game.events.on('build-mode-changed', this.onBuildModeChanged, this);

    this.scale.on('resize', this.onResize, this);
    this.refreshBuildButtons();
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    cb: () => void
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, w, h, 0xb43282, 1).setOrigin(0);
    bg.setStrokeStyle(1, 0xff7ac8);
    bg.setInteractive({ useHandCursor: true });
    const t = this.add
      .text(w / 2, h / 2, label, { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setName('label');
    bg.on('pointerover', () => bg.setFillStyle(0xd44a9a));
    bg.on('pointerout', () => bg.setFillStyle(0xb43282));
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      cb();
    });
    c.add([bg, t]);
    return c;
  }

  private makeLocalButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    cb: () => void
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0xb43282, 1).setOrigin(0);
    bg.setStrokeStyle(1, 0xff7ac8);
    bg.setInteractive({ useHandCursor: true });
    const t = this.add
      .text(w / 2, h / 2, label, { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0xd44a9a));
    bg.on('pointerout', () => bg.setFillStyle(0xb43282));
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      cb();
    });
    c.add([bg, t]);
    return c;
  }


  isPointerOnUi(p: Phaser.Input.Pointer): boolean {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    if (p.y < 56) return true;
    // Construir / Listo
    if (p.x < 140 && p.y > h - 60) return true;
    if (this.panelVisible && p.x > w - 280 && p.y > 60 && p.y < 380) return true;
    if (this.summary.visible) {
      const cx = w / 2;
      const cy = h / 2;
      if (Math.abs(p.x - cx) < 200 && Math.abs(p.y - cy) < 140) return true;
    }
    return false;
  }

  private hidePanel(): void {
    if (!this.panelVisible) return;
    this.panelVisible = false;
    this.panel.setVisible(false);
    this.game.events.emit('cmd-deselect-bartender');
  }

  private onSelectBartender = (b: any): void => {
    if (this.buildMode) return;
    this.panelVisible = true;
    this.panel.setVisible(true);
    const hud: HudBartender = {
      name: b.displayName ?? b.name,
      energy: typeof b.energy === 'number' ? b.energy : b.profile?.energy ?? 0,
      mood: typeof b.mood === 'number' ? b.mood : b.profile?.mood ?? 0,
      skill: typeof b.skill === 'number' ? b.skill : b.profile?.skill ?? 0,
      state: b.state ?? 'idle',
    };
    this.refreshPanel(hud);
  };

  private refreshPanel(b: HudBartender): void {
    this.panelName.setText(b.name);
    const stateEs: Record<string, string> = {
      idle: 'Libre',
      walking: 'Caminando',
      busy: 'Ocupada',
      resting: 'Descansando',
    };
    this.panelStats.setText(
      `Estado: ${stateEs[b.state] || b.state}\nHabilidad: ${b.skill}`
    );
    this.energyBar.width = 220 * Phaser.Math.Clamp(b.energy / 100, 0, 1);
    this.moodBar.width = 220 * Phaser.Math.Clamp(b.mood / 100, 0, 1);
    this.energyBar.setFillStyle(b.energy < 30 ? 0xff4466 : 0x3cff9a);
  }

  private onBuildModeChanged = (on: boolean): void => {
    this.buildMode = on;
    if (on) this.hidePanel();
    this.refreshBuildButtons();
  };

  private refreshBuildButtons(): void {
    const canBuild = this.phase !== 'open';
    this.buildBtn.setVisible(canBuild && !this.buildMode);
    this.doneBuildBtn.setVisible(canBuild && this.buildMode);
    // Dim / hide Abrir noche while building
    this.openBtn.setAlpha(this.buildMode ? 0.35 : 1);
    if (this.buildMode) {
      this.openBtn.setVisible(this.phase !== 'open');
    }
  }

  private onStats = (s: HudState): void => {
    this.phase = s.phase;
    this.moneyText.setText(`Dinero: $${s.money}`);
    if (s.phase === 'open') {
      this.timerText.setText(`Noche: ${s.nightTimer}s`);
    } else if (s.phase === 'prep') {
      this.timerText.setText('Noche: lista');
    }
    if (s.bartender && this.panelVisible) {
      this.refreshPanel(s.bartender);
    }
    this.refreshBuildButtons();
  };

  private onNightStarted = (s: HudState): void => {
    this.summary.setVisible(false);
    this.openBtn.setVisible(false);
    this.closeBtn.setVisible(true);
    // Force exit build if somehow still on
    if (this.buildMode) {
      this.game.events.emit('cmd-set-build-mode', false);
    }
    this.onStats(s);
  };

  private onSummary = (s: HudState): void => {
    this.openBtn.setVisible(true);
    this.closeBtn.setVisible(false);
    this.timerText.setText('Noche: cerrada');
    this.moneyText.setText(`Dinero: $${s.money}`);
    const body = this.summary.getByName('body') as Phaser.GameObjects.Text;
    body.setText(
      `Ganado esta noche: $${s.nightEarned ?? 0}\n` +
        `Bebidas servidas: ${s.servedCount ?? 0}\n` +
        `Dinero total: $${s.money}`
    );
    this.summary.setVisible(true);
    if (s.bartender) this.refreshPanel(s.bartender);
    this.refreshBuildButtons();
  };

  private onResize = (gameSize: Phaser.Structs.Size): void => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.openBtn.setX(w - 150);
    this.closeBtn.setX(w - 150);
    this.buildBtn.setPosition(16, h - 48);
    this.doneBuildBtn.setPosition(16, h - 48);
    this.panel.setX(w - 20);
    this.timerText.setX(w / 2);
    this.summary.setPosition(w / 2, h / 2);
  };
}
