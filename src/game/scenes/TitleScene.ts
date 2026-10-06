import Phaser from 'phaser';
import { bootIntoSave, bootNewGame, formatSavedAt, listSlots, readSlot, SlotSummary } from '../systems/SaveSlots';

type TitleView = 'main' | 'load' | 'confirmNew' | 'loading';

/**
 * Minimal title screen. Only reached from Pausa → VOLVER AL TÍTULO (the app still boots straight
 * into the club). The club scenes are asleep underneath with their exact state, so CONTINUAR just
 * wakes them; CARGAR / NUEVA reuse the same save-slot boot paths as the pause menu.
 */
export class TitleScene extends Phaser.Scene {
  private root?: Phaser.GameObjects.Container;
  private view: TitleView = 'main';
  private buttons: { label: string; x: number; y: number; w: number; h: number; enabled: boolean }[] = [];

  constructor() {
    super({ key: 'TitleScene', active: false });
  }

  create(): void {
    this.scene.bringToTop();
    this.cameras.main.setBackgroundColor('#1a1411');
    this.render('main');
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.view === 'load' || this.view === 'confirmNew') this.render('main');
    });
  }

  private onResize = (): void => {
    if (this.scene.isActive()) this.render(this.view);
  };

  private formatMoney(n: number): string {
    return `$${Math.round(n)}`;
  }

  private button(x: number, y: number, w: number, h: number, label: string, cb: () => void, enabled = true, fontSize = 17): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, enabled ? 0xb43282 : 0x3a2a44, 1).setOrigin(0).setStrokeStyle(1, enabled ? 0xff7ac8 : 0x5a4a66);
    const t = this.add
      .text(w / 2, h / 2, label, { fontSize: `${fontSize}px`, color: enabled ? '#ffffff' : '#9a8aa8', fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: enabled });
    let pressed = -1;
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      pressed = p.downTime;
    });
    bg.on('pointerover', () => enabled && bg.setFillStyle(0xd44a9a));
    bg.on('pointerout', () => enabled && bg.setFillStyle(0xb43282));
    bg.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!enabled || pressed < 0 || p.downTime !== pressed) return;
      pressed = -1;
      cb();
    });
    this.buttons.push({ label, x, y, w, h, enabled });
    return c;
  }

  private render(view: TitleView): void {
    this.view = view;
    this.root?.destroy();
    this.buttons = [];
    const cam = this.cameras.main;
    const W = cam.width;
    const cx = W / 2;
    const root = this.add.container(0, 0);
    this.root = root;
    const bw = Math.min(300, W - 40);
    let y = Math.max(40, cam.height * 0.18);
    const text = (s: string, size: number, color: string, bold = false) => {
      const t = this.add
        .text(cx, y, s, { fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align: 'center', wordWrap: { width: W - 40 } })
        .setOrigin(0.5, 0);
      root.add(t);
      y += t.height + 12;
    };
    const btn = (label: string, cb: () => void, enabled = true, h = 46, w = bw, fs = 17) => {
      root.add(this.button(cx - w / 2, y, w, h, label, cb, enabled, fs));
      y += h + 12;
    };
    text('Night Club', 46, '#ff3ca0', true);
    y += 16;
    if (view === 'main') {
      btn('CONTINUAR', () => this.continueGame());
      btn('CARGAR PARTIDA', () => this.render('load'));
      btn('NUEVA PARTIDA', () => this.render('confirmNew'));
    } else if (view === 'load') {
      text('CARGAR PARTIDA', 22, '#ff3ca0', true);
      const slots = listSlots().filter((s) => !s.empty);
      if (!slots.length) text('NO HAY PARTIDAS GUARDADAS', 17, '#ffd6e0', true);
      for (const s of slots) btn(this.slotLine(s), () => this.loadSlot(Number(s.id)), true, 54, Math.min(360, W - 30), 13);
      btn('VOLVER', () => this.render('main'));
    } else if (view === 'confirmNew') {
      text('¿COMENZAR UNA NUEVA PARTIDA?', 20, '#ff3ca0', true);
      text('Se perderá el progreso de la partida actual si no está guardado.', 14, '#f0e0ff');
      btn('SÍ, NUEVA PARTIDA', () => {
        this.render('loading');
        bootNewGame();
      });
      btn('CANCELAR', () => this.render('main'));
    } else {
      text('Cargando…', 20, '#ff3ca0', true);
    }
  }

  private slotLine(s: SlotSummary): string {
    if (s.empty || !s.meta) return `${s.label} — Vacía`;
    return `${s.label} — Día ${s.meta.day} · ${s.meta.clock} · ${this.formatMoney(s.meta.money)}\n${s.meta.phaseLabel} · ${formatSavedAt(s.savedAt)}`;
  }

  private loadSlot(n: number): void {
    const d = readSlot(n);
    if (!d) {
      this.render('load');
      return;
    }
    this.render('loading');
    bootIntoSave(d);
  }

  /** Back to the exact game that was left (it slept intact, paused-clock included). */
  private continueGame(): void {
    this.scene.wake('ClubScene');
    this.scene.wake('UIScene');
    this.scene.get('UIScene')?.scene.bringToTop();
    this.scene.stop();
  }

  /** Test hook. */
  getTitleDebug() {
    const texts: string[] = [];
    this.root?.each((o: Phaser.GameObjects.GameObject) => {
      if (o instanceof Phaser.GameObjects.Text) texts.push(o.text);
      if (o instanceof Phaser.GameObjects.Container) o.each((q: Phaser.GameObjects.GameObject) => q instanceof Phaser.GameObjects.Text && texts.push(q.text));
    });
    return { view: this.view, texts, buttons: this.buttons };
  }
}
