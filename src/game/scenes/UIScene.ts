import Phaser from 'phaser';
import { NpcInfo } from '../types/Npc';
import { StaffRosterEntry, StaffRosterPayload } from '../types/Staff';

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
  selectedNpc?: NpcInfo | null;
  nightEarned?: number;
  servedCount?: number;
  buildMode?: boolean;
}

const STATE_ES: Record<string, string> = {
  idle: 'Libre',
  walking: 'Caminando',
  busy: 'Ocupada',
  resting: 'Descansando',
  waiting: 'Esperando',
  drinking: 'Bebiendo',
  leaving: 'Saliendo',
  relaxing: 'Relajándose',
};

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
  private energyLabel!: Phaser.GameObjects.Text;
  private moodLabel!: Phaser.GameObjects.Text;
  private panelName!: Phaser.GameObjects.Text;
  private panelRole!: Phaser.GameObjects.Text;
  private panelStats!: Phaser.GameObjects.Text;
  private panelPortrait!: Phaser.GameObjects.Image;
  private phase: string = 'prep';
  private buildMode = false;
  private selectedNpc: NpcInfo | null = null;

  private staffBtn!: Phaser.GameObjects.Container;
  private staffPanel!: Phaser.GameObjects.Container;
  private staffPanelVisible = false;
  private staffRoster: StaffRosterPayload | null = null;
  private staffRows: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'UIScene', active: false });
  }

  create(): void {
    const cam = this.cameras.main;

    // Top HUD
    const hudBg = this.add.rectangle(0, 0, cam.width, 52, 0x12081e, 0.85).setOrigin(0);
    hudBg.setScrollFactor(0);
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

    this.staffBtn = this.makeButton(136, cam.height - 48, 100, 36, 'Staff', () => {
      this.toggleStaffPanel();
    });

    // Side panel (unified NPC)
    this.panel = this.add.container(cam.width - 20, 70).setScrollFactor(0).setVisible(false);
    const panelBg = this.add.rectangle(0, 0, 260, 320, 0x1a0e28, 0.92).setOrigin(1, 0);
    panelBg.setStrokeStyle(2, 0xff3ca0);
    panelBg.setInteractive();

    this.panelName = this.add
      .text(-250, 12, '', { fontSize: '20px', color: '#ff9ad5', fontStyle: 'bold' })
      .setOrigin(0, 0);
    this.panelRole = this.add
      .text(-250, 38, '', { fontSize: '13px', color: '#2ad6ff' })
      .setOrigin(0, 0);
    this.panelStats = this.add
      .text(-250, 58, '', { fontSize: '14px', color: '#e8d0ff', lineSpacing: 6 })
      .setOrigin(0, 0);

    this.panelPortrait = this.add
      .image(-60, 78, 'luna_portrait')
      .setDisplaySize(56, 56)
      .setVisible(false);

    this.energyLabel = this.add.text(-250, 130, 'Energía', { fontSize: '12px', color: '#a080c0' });
    this.moodLabel = this.add.text(-250, 170, 'Ánimo', { fontSize: '12px', color: '#a080c0' });
    const eBg = this.add.rectangle(-250, 150, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const mBg = this.add.rectangle(-250, 190, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(-250, 150, 220, 12, 0x3cff9a).setOrigin(0, 0.5);
    this.moodBar = this.add.rectangle(-250, 190, 220, 12, 0xffb84d).setOrigin(0, 0.5);
    this.restBtn = this.makeLocalButton(-250, 230, 200, 36, 'Descansar', () => {
      this.game.events.emit('cmd-rest');
    });

    this.panelDismissBtn = this.makeLocalButton(-56, 8, 36, 32, '✕', () => {
      this.hidePanel();
    });

    this.panel.add([
      panelBg,
      this.panelName,
      this.panelRole,
      this.panelStats,
      this.panelPortrait,
      this.energyLabel,
      this.moodLabel,
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
        if (this.staffPanelVisible) this.hideStaffPanel();
        else if (this.panelVisible) this.hidePanel();
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

    this.createStaffPanel();

    this.game.events.on('club-ready', this.onStats, this);
    this.game.events.on('stats-updated', this.onStats, this);
    this.game.events.on('night-started', this.onNightStarted, this);
    this.game.events.on('night-summary', this.onSummary, this);
    this.game.events.on('select-npc', this.onSelectNpc, this);
    // Back-compat: older emit still works
    this.game.events.on('select-bartender', this.onSelectBartenderLegacy, this);
    this.game.events.on('npc-deselected', this.onNpcDeselected, this);
    this.game.events.on('build-mode-changed', this.onBuildModeChanged, this);
    this.game.events.on('staff-roster', this.onStaffRoster, this);
    this.game.events.on('staff-hire-failed', this.onHireFailed, this);

    this.scale.on('resize', this.onResize, this);
    this.refreshBuildButtons();
    this.game.events.emit('cmd-request-staff-roster');
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
    if (p.x < 250 && p.y > h - 60) return true;
    if (this.panelVisible && p.x > w - 280 && p.y > 60 && p.y < 400) return true;
    if (this.staffPanelVisible) {
      const cx = w / 2;
      const cy = h / 2;
      if (Math.abs(p.x - cx) < 210 && Math.abs(p.y - cy) < 250) return true;
    }
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
    this.selectedNpc = null;
    this.game.events.emit('cmd-deselect-npc');
  }

  /** ClubScene cleared selection (empty tap / patron left) — close panel only. */
  private onNpcDeselected = (): void => {
    if (!this.panelVisible) return;
    this.panelVisible = false;
    this.panel.setVisible(false);
    this.selectedNpc = null;
  };

  private onSelectNpc = (npc: NpcInfo): void => {
    if (this.buildMode) return;
    this.selectedNpc = npc;
    this.panelVisible = true;
    this.panel.setVisible(true);
    this.refreshPanel(npc);
  };

  private onSelectBartenderLegacy = (b: any): void => {
    const npc: NpcInfo = {
      id: b.profile?.id ?? b.id ?? 'bartender',
      name: b.displayName ?? b.name ?? 'Luna',
      role: 'staff',
      energy: typeof b.energy === 'number' ? b.energy : b.profile?.energy ?? 0,
      mood: typeof b.mood === 'number' ? b.mood : b.profile?.mood ?? 0,
      skill: typeof b.skill === 'number' ? b.skill : b.profile?.skill ?? 0,
      state: b.state ?? 'idle',
    };
    this.onSelectNpc(npc);
  };

  private refreshPanel(npc: NpcInfo): void {
    this.panelName.setText(npc.name);
    const isStaff = npc.role === 'staff';
    this.panelRole.setText(`Rol: ${isStaff ? 'Camarera' : 'Cliente'}`);
    if (npc.portrait && this.textures.exists(npc.portrait)) {
      this.panelPortrait.setTexture(npc.portrait);
      this.panelPortrait.setDisplaySize(56, 56);
      this.panelPortrait.setVisible(true);
    } else {
      this.panelPortrait.setVisible(false);
    }

    const estado = STATE_ES[npc.state] || npc.state;
    if (isStaff) {
      this.panelStats.setText(
        `Estado: ${estado}\nHabilidad: ${npc.skill ?? '—'}`
      );
      this.energyLabel.setText('Energía');
      this.moodLabel.setText('Ánimo');
      const energy = npc.energy ?? 0;
      const mood = npc.mood ?? 0;
      this.energyBar.width = 220 * Phaser.Math.Clamp(energy / 100, 0, 1);
      this.moodBar.width = 220 * Phaser.Math.Clamp(mood / 100, 0, 1);
      this.energyBar.setFillStyle(energy < 30 ? 0xff4466 : 0x3cff9a);
      this.moodBar.setFillStyle(0xffb84d);
      this.moodBar.setVisible(true);
      this.moodLabel.setVisible(true);
      const canRest = !['walking', 'busy', 'resting'].includes(npc.state);
      this.restBtn.setVisible(canRest);
      this.restBtn.setAlpha(canRest ? 1 : 0.4);
    } else {
      const drink = npc.preferredDrink || '—';
      this.panelStats.setText(
        `Estado: ${estado}\nPreferencia: ${drink}\nHabilidad: —`
      );
      this.energyLabel.setText('Paciencia');
      this.moodLabel.setText('Ánimo de la noche');
      const pMax = Math.max(1, npc.patienceMax ?? 1);
      const pCur = npc.patience ?? 0;
      const mood = npc.mood ?? Math.round((pCur / pMax) * 100);
      this.energyBar.width = 220 * Phaser.Math.Clamp(pCur / pMax, 0, 1);
      this.moodBar.width = 220 * Phaser.Math.Clamp(mood / 100, 0, 1);
      this.energyBar.setFillStyle(pCur / pMax < 0.3 ? 0xff4466 : 0x2ad6ff);
      this.moodBar.setFillStyle(0xffb84d);
      this.moodBar.setVisible(true);
      this.moodLabel.setVisible(true);
      this.restBtn.setVisible(false);
    }
  }

  private onBuildModeChanged = (on: boolean): void => {
    this.buildMode = on;
    if (on) {
      this.hidePanel();
      this.hideStaffPanel();
    }
    this.refreshBuildButtons();
  };

  private refreshBuildButtons(): void {
    const canBuild = this.phase !== 'open';
    this.buildBtn.setVisible(canBuild && !this.buildMode);
    this.doneBuildBtn.setVisible(canBuild && this.buildMode);
    this.staffBtn.setVisible(!this.buildMode);
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
    if (this.panelVisible && s.selectedNpc) {
      this.selectedNpc = s.selectedNpc;
      this.refreshPanel(s.selectedNpc);
    } else if (this.panelVisible && this.selectedNpc?.role === 'staff' && s.bartender) {
      this.refreshPanel({
        id: this.selectedNpc.id,
        name: s.bartender.name,
        role: 'staff',
        energy: s.bartender.energy,
        mood: s.bartender.mood,
        skill: s.bartender.skill,
        state: s.bartender.state,
      });
    }
    this.refreshBuildButtons();
  };

  private onNightStarted = (s: HudState): void => {
    this.summary.setVisible(false);
    this.openBtn.setVisible(false);
    this.closeBtn.setVisible(true);
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
    // Patrons are cleared — if a patron was selected, close panel
    if (this.selectedNpc?.role === 'patron') {
      this.hidePanel();
    } else if (s.bartender && this.panelVisible) {
      this.refreshPanel({
        id: this.selectedNpc?.id ?? 'bartender',
        name: s.bartender.name,
        role: 'staff',
        energy: s.bartender.energy,
        mood: s.bartender.mood,
        skill: s.bartender.skill,
        state: s.bartender.state,
      });
    }
    this.refreshBuildButtons();
  };

  private onResize = (gameSize: Phaser.Structs.Size): void => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.openBtn.setX(w - 150);
    this.closeBtn.setX(w - 150);
    this.buildBtn.setPosition(16, h - 48);
    this.doneBuildBtn.setPosition(16, h - 48);
    this.staffBtn.setPosition(136, h - 48);
    this.panel.setX(w - 20);
    this.timerText.setX(w / 2);
    this.summary.setPosition(w / 2, h / 2);
    this.staffPanel.setPosition(w / 2, h / 2);
  };

  private createStaffPanel(): void {
    const cam = this.cameras.main;
    this.staffPanel = this.add.container(cam.width / 2, cam.height / 2).setScrollFactor(0).setVisible(false).setDepth(9600);
    const bg = this.add.rectangle(0, 0, 400, 460, 0x140a22, 0.96);
    bg.setStrokeStyle(2, 0xff3ca0);
    bg.setInteractive();
    const title = this.add
      .text(0, -210, 'Personal', {
        fontSize: '22px',
        color: '#ff9ad5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('staffTitle');
    const close = this.makeLocalButton(160, -220, 36, 32, '✕', () => this.hideStaffPanel());
    this.staffPanel.add([bg, title, close]);
  }

  private toggleStaffPanel(): void {
    if (this.staffPanelVisible) this.hideStaffPanel();
    else this.showStaffPanel();
  }

  private showStaffPanel(): void {
    this.hidePanel();
    this.staffPanelVisible = true;
    this.staffPanel.setVisible(true);
    this.game.events.emit('cmd-request-staff-roster');
    this.rebuildStaffPanel();
  }

  private hideStaffPanel(): void {
    if (!this.staffPanelVisible) return;
    this.staffPanelVisible = false;
    this.staffPanel.setVisible(false);
  }

  private onStaffRoster = (payload: StaffRosterPayload): void => {
    this.staffRoster = payload;
    if (this.staffPanelVisible) this.rebuildStaffPanel();
  };

  private onHireFailed = (info: { id: string; reason: string }): void => {
    if (info.reason === 'money') {
      // brief flash via title color
      const title = this.staffPanel.getByName('staffTitle') as Phaser.GameObjects.Text | null;
      if (title) {
        title.setText('Personal — sin dinero');
        title.setColor('#ff6688');
        this.time.delayedCall(1600, () => {
          title.setText('Personal');
          title.setColor('#ff9ad5');
        });
      }
    }
  };

  private clearStaffRows(): void {
    for (const g of this.staffRows) g.destroy();
    this.staffRows = [];
  }

  private rebuildStaffPanel(): void {
    if (!this.staffPanel) return;
    this.clearStaffRows();
    const roster = this.staffRoster;
    if (!roster) {
      const wait = this.add
        .text(0, 0, 'Cargando…', { fontSize: '14px', color: '#c8a0e0' })
        .setOrigin(0.5);
      this.staffPanel.add(wait);
      this.staffRows.push(wait);
      return;
    }

    let y = -175;
    const section = (label: string) => {
      const t = this.add
        .text(-180, y, label, { fontSize: '14px', color: '#2ad6ff', fontStyle: 'bold' })
        .setOrigin(0, 0);
      this.staffPanel.add(t);
      this.staffRows.push(t);
      y += 22;
    };

    section('Plantilla actual');
    for (const e of roster.current) {
      y = this.addStaffCurrentRow(e, y);
      y += 8;
    }

    y += 6;
    section('Contratar');
    if (!roster.hireable.length) {
      const empty = this.add
        .text(-180, y, 'No hay candidatos disponibles.', {
          fontSize: '13px',
          color: '#a080c0',
        })
        .setOrigin(0, 0);
      this.staffPanel.add(empty);
      this.staffRows.push(empty);
    } else {
      for (const e of roster.hireable) {
        y = this.addStaffHireRow(e, y, roster.money);
        y += 8;
      }
    }
  }

  private addStaffCurrentRow(e: StaffRosterEntry, y: number): number {
    const rowH = 86;
    const card = this.add.rectangle(0, y + rowH / 2, 360, rowH, 0x1a0e28, 0.95).setOrigin(0.5);
    card.setStrokeStyle(1, 0x6a3a78);
    this.staffPanel.add(card);
    this.staffRows.push(card);

    const px = -160;
    if (this.textures.exists(e.portrait)) {
      const img = this.add.image(px, y + rowH / 2, e.portrait).setDisplaySize(56, 56);
      this.staffPanel.add(img);
      this.staffRows.push(img);
    } else {
      const ph = this.add.rectangle(px, y + rowH / 2, 56, 56, 0x2a1838).setOrigin(0.5);
      this.staffPanel.add(ph);
      this.staffRows.push(ph);
    }

    const estado = STATE_ES[e.state] || e.state;
    const info = this.add
      .text(
        -120,
        y + 8,
        `${e.name}  ·  ${e.roleLabel}\nEnergía ${e.energy}  ·  Ánimo ${e.mood}  ·  Hab. ${e.skill}\nEstado: ${estado}`,
        { fontSize: '12px', color: '#e8d0ff', lineSpacing: 4 }
      )
      .setOrigin(0, 0);
    this.staffPanel.add(info);
    this.staffRows.push(info);

    const sel = this.makeLocalButton(70, y + 48, 100, 28, 'Seleccionar', () => {
      this.game.events.emit('cmd-select-staff', e.id);
      this.hideStaffPanel();
    });
    // shrink font via children
    this.staffPanel.add(sel);
    this.staffRows.push(sel);

    if (e.canRest) {
      const rest = this.makeLocalButton(178, y + 48, 90, 28, 'Descansar', () => {
        this.game.events.emit('cmd-rest-staff', e.id);
        this.game.events.emit('cmd-request-staff-roster');
      });
      this.staffPanel.add(rest);
      this.staffRows.push(rest);
    }

    return y + rowH;
  }

  private addStaffHireRow(e: StaffRosterEntry, y: number, money: number): number {
    const rowH = 92;
    const card = this.add.rectangle(0, y + rowH / 2, 360, rowH, 0x1a0e28, 0.95).setOrigin(0.5);
    card.setStrokeStyle(1, 0x3a6a88);
    this.staffPanel.add(card);
    this.staffRows.push(card);

    const px = -160;
    if (this.textures.exists(e.portrait)) {
      const img = this.add.image(px, y + rowH / 2, e.portrait).setDisplaySize(56, 56);
      this.staffPanel.add(img);
      this.staffRows.push(img);
    }

    const cost = e.cost ?? 0;
    const can = money >= cost;
    const info = this.add
      .text(
        -120,
        y + 8,
        `${e.name}  ·  ${e.roleLabel}\nCosto: $${cost}  ·  Hab. ${e.skill}\n${e.blurb ?? ''}`,
        { fontSize: '12px', color: '#e8d0ff', lineSpacing: 4 }
      )
      .setOrigin(0, 0);
    this.staffPanel.add(info);
    this.staffRows.push(info);

    const hire = this.makeLocalButton(120, y + 52, 110, 28, 'Contratar', () => {
      this.game.events.emit('cmd-hire-staff', e.id);
    });
    hire.setAlpha(can ? 1 : 0.4);
    this.staffPanel.add(hire);
    this.staffRows.push(hire);

    return y + rowH;
  }
}
