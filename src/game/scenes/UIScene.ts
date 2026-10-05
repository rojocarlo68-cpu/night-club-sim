import Phaser from 'phaser';
import { NpcInfo } from '../types/Npc';
import { StaffRosterEntry, StaffRosterPayload } from '../types/Staff';
import { ShopCatalogPayload } from '../types/Shop';
import { FurnitureInspectPayload } from '../systems/FurnitureStats';
import { listInventory } from '../systems/Inventory';

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
  /** Phase 7: absolute night index (1-based). */
  nightNumber?: number;
  bartender: HudBartender | null;
  selectedNpc?: NpcInfo | null;
  nightEarned?: number;
  servedCount?: number;
  buildMode?: boolean;
  /** Phase 8: payroll paid on this night end (if any). */
  payroll?: { total: number; lines: { name: string; amount: number }[] } | null;
  /** Phase 8: next night that triggers weekly salaries. */
  nextPayrollNight?: number;
  /** Phase 9: utilities paid on this night end (if any). */
  utilities?: { total: number; lines: { label: string; amount: number }[] } | null;
  /** Phase 9: next night that triggers monthly utilities. */
  nextUtilitiesNight?: number;
}

const STATE_ES: Record<string, string> = {
  idle: 'Libre',
  walking: 'Caminando',
  busy: 'Ocupada',
  resting: 'Descansando',
  waiting: 'Esperando',
  impatient: 'Impaciente',
  angry: 'Enfadado',
  seated: 'Sentado',
  drinking: 'Bebiendo',
  leaving: 'Saliendo',
  relaxing: 'Sentado',
  serving: 'Atendiendo',
  serving_cerveza: 'Sirviendo cerveza',
  serving_drink: 'Sirviendo bebida',
  cleaning: 'Limpiando',
  wandering: 'Deambulando',
};


/** Display money as $N or -$N (never $-N). */
function formatMoney(n: number): string {
  const v = Math.floor(Number.isFinite(n) ? n : 0);
  if (v < 0) return `-$${Math.abs(v)}`;
  return `$${v}`;
}

const PANEL_W = 260;
const PANEL_H = 400;
/** Gap above bottom edge (clears Construir/Staff row ~48px). */
const PANEL_BOTTOM_MARGIN = 60;

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
  private summaryBg!: Phaser.GameObjects.Rectangle;
  private summaryTitle!: Phaser.GameObjects.Text;
  private summaryBody!: Phaser.GameObjects.Text;
  private summaryAgain!: Phaser.GameObjects.Container;
  private summaryClose!: Phaser.GameObjects.Container;
  private lastSummaryBody = '';
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
  private inventBtn!: Phaser.GameObjects.Container;
  private staffPanel!: Phaser.GameObjects.Container;
  private staffPanelVisible = false;
  private inventoryPanel!: Phaser.GameObjects.Container;
  private inventoryPanelVisible = false;
  private inventoryRows: Phaser.GameObjects.GameObject[] = [];
  private inventoryFlash: Phaser.GameObjects.Text | null = null;
  private inventoryBg: Phaser.GameObjects.Rectangle | null = null;
  private staffRoster: StaffRosterPayload | null = null;
  private staffRows: Phaser.GameObjects.GameObject[] = [];

  private shopBtn!: Phaser.GameObjects.Container;
  private shopPanel!: Phaser.GameObjects.Container;
  private shopPanelVisible = false;
  private shopCatalog: ShopCatalogPayload | null = null;
  private shopRows: Phaser.GameObjects.GameObject[] = [];
  private shopTab: 'muebles' | 'decoracion' = 'muebles';

  private deleteConfirm!: Phaser.GameObjects.Container;
  private deleteConfirmVisible = false;
  private deleteConfirmMsg!: Phaser.GameObjects.Text;
  /** Id+refund snapshotted on the modal — Sí emits this id; never trust ClubScene selection. */
  private pendingDelete: { id: string; refund: number } | null = null;
  /** Game-loop clock (same clock as Pointer.downTime) when the delete modal opened. */
  private deleteOpenedAt = 0;

  private furnPanel!: Phaser.GameObjects.Container;
  private furnPanelVisible = false;
  private furnName!: Phaser.GameObjects.Text;
  private furnCondition!: Phaser.GameObjects.Text;
  private furnDurLabel!: Phaser.GameObjects.Text;
  private furnComLabel!: Phaser.GameObjects.Text;
  private furnCleLabel!: Phaser.GameObjects.Text;
  private furnDurBar!: Phaser.GameObjects.Rectangle;
  private furnComBar!: Phaser.GameObjects.Rectangle;
  private furnCleBar!: Phaser.GameObjects.Rectangle;
  private furnDurVal!: Phaser.GameObjects.Text;
  private furnComVal!: Phaser.GameObjects.Text;
  private furnCleVal!: Phaser.GameObjects.Text;
  private inspectedFurniture: FurnitureInspectPayload | null = null;

  constructor() {
    super({ key: 'UIScene', active: false });
  }

  create(): void {
    // Keep HUD/modals above ClubScene for pointer hit-testing
    this.scene.bringToTop();
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
    this.layoutTimerText(cam.width);

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

    this.staffBtn = this.makeButton(136, cam.height - 48, 90, 36, 'Staff', () => {
      this.toggleStaffPanel();
    });
    // Fits 390px width: Construir(16+110) · Staff(136+90) · Inventario(232+110) → 342
    this.inventBtn = this.makeButton(232, cam.height - 48, 110, 36, 'Inventario', () => {
      this.toggleInventoryPanel();
    });
    this.shopBtn = this.makeButton(136, cam.height - 48, 110, 36, 'Muebles', () => {
      this.toggleShopPanel();
    });
    this.shopBtn.setVisible(false);

    // NPC stats panel — bottom-right so it does not cover the club view
    this.panel = this.add
      .container(cam.width - 20, cam.height - PANEL_BOTTOM_MARGIN - PANEL_H)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9500);
    const panelBg = this.add.rectangle(0, 0, PANEL_W, PANEL_H, 0x1a0e28, 0.92).setOrigin(1, 0);
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

    this.energyLabel = this.add.text(-250, 200, 'Energía', { fontSize: '12px', color: '#a080c0' });
    this.moodLabel = this.add.text(-250, 240, 'Ánimo', { fontSize: '12px', color: '#a080c0' });
    const eBg = this.add.rectangle(-250, 220, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const mBg = this.add.rectangle(-250, 260, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(-250, 220, 220, 12, 0x3cff9a).setOrigin(0, 0.5);
    this.moodBar = this.add.rectangle(-250, 260, 220, 12, 0xffb84d).setOrigin(0, 0.5);
    this.restBtn = this.makeLocalButton(-250, 310, 200, 36, 'Descansar', () => {
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

    // Furniture inspect panel (bottom-right, same pattern as staff panel)
    const FURN_H = 280;
    this.furnPanel = this.add
      .container(cam.width - 20, cam.height - PANEL_BOTTOM_MARGIN - FURN_H)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9500);
    const fBg = this.add.rectangle(0, 0, PANEL_W, FURN_H, 0x1a0e28, 0.92).setOrigin(1, 0);
    fBg.setStrokeStyle(2, 0x2ad6ff);
    fBg.setInteractive();
    this.furnName = this.add
      .text(-250, 12, '', { fontSize: '20px', color: '#7ad7ff', fontStyle: 'bold' })
      .setOrigin(0, 0);
    this.furnCondition = this.add
      .text(-250, 40, '', { fontSize: '14px', color: '#ffe066' })
      .setOrigin(0, 0);
    this.furnDurLabel = this.add.text(-250, 78, 'Durabilidad', { fontSize: '12px', color: '#a080c0' });
    this.furnComLabel = this.add.text(-250, 128, 'Confort', { fontSize: '12px', color: '#a080c0' });
    this.furnCleLabel = this.add.text(-250, 178, 'Limpieza', { fontSize: '12px', color: '#a080c0' });
    const fdBg = this.add.rectangle(-250, 98, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const fcBg = this.add.rectangle(-250, 148, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const flBg = this.add.rectangle(-250, 198, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    this.furnDurBar = this.add.rectangle(-250, 98, 220, 12, 0x3cff9a).setOrigin(0, 0.5);
    this.furnComBar = this.add.rectangle(-250, 148, 220, 12, 0xffb84d).setOrigin(0, 0.5);
    this.furnCleBar = this.add.rectangle(-250, 198, 220, 12, 0x2ad6ff).setOrigin(0, 0.5);
    this.furnDurVal = this.add.text(-30, 98, '', { fontSize: '11px', color: '#e8d0ff' }).setOrigin(1, 0.5);
    this.furnComVal = this.add.text(-30, 148, '', { fontSize: '11px', color: '#e8d0ff' }).setOrigin(1, 0.5);
    this.furnCleVal = this.add.text(-30, 198, '', { fontSize: '11px', color: '#e8d0ff' }).setOrigin(1, 0.5);
    const furnDismiss = this.makeLocalButton(-56, 8, 36, 32, '✕', () => {
      this.hideFurnPanel();
      this.game.events.emit('cmd-deselect-furniture');
    });
    this.furnPanel.add([
      fBg,
      this.furnName,
      this.furnCondition,
      this.furnDurLabel,
      this.furnComLabel,
      this.furnCleLabel,
      fdBg,
      fcBg,
      flBg,
      this.furnDurBar,
      this.furnComBar,
      this.furnCleBar,
      this.furnDurVal,
      this.furnComVal,
      this.furnCleVal,
      furnDismiss,
    ]);

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ESC', () => {
        if (this.shopPanelVisible) this.hideShopPanel();
        else if (this.inventoryPanelVisible) this.hideInventoryPanel();
        else if (this.staffPanelVisible) this.hideStaffPanel();
        else if (this.furnPanelVisible) {
          this.hideFurnPanel();
          this.game.events.emit('cmd-deselect-furniture');
        } else if (this.panelVisible) this.hidePanel();
        else if (this.buildMode) this.game.events.emit('cmd-set-build-mode', false);
      });
    }

    // Summary overlay (auto-sized in layoutSummary)
    this.summary = this.add.container(cam.width / 2, cam.height / 2).setScrollFactor(0).setVisible(false);
    this.summaryBg = this.add.rectangle(0, 0, 400, 320, 0x140a22, 0.95);
    this.summaryBg.setStrokeStyle(2, 0x2ad6ff);
    this.summaryBg.setInteractive();
    this.summaryTitle = this.add
      .text(0, 0, 'Fin de la noche', {
        fontSize: '24px',
        color: '#2ad6ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('title');
    this.summaryBody = this.add
      .text(0, 0, '', {
        fontSize: '15px',
        color: '#f0e0ff',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0)
      .setName('body');
    this.summaryAgain = this.makeLocalButton(-100, 0, 200, 40, 'Abrir noche', () => {
      if (this.buildMode) return;
      this.summary.setVisible(false);
      this.game.events.emit('cmd-open-night');
    });
    this.summaryClose = this.makeLocalButton(0, 0, 36, 32, '✕', () => {
      this.summary.setVisible(false);
    });
    this.summary.add([
      this.summaryBg,
      this.summaryTitle,
      this.summaryBody,
      this.summaryAgain,
      this.summaryClose,
    ]);

    this.createStaffPanel();
    this.createInventoryPanel();
    this.createShopPanel();
    this.createDeleteConfirm();

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
    this.game.events.on('shop-catalog', this.onShopCatalog, this);
    this.game.events.on('shop-buy-failed', this.onShopBuyFailed, this);
    this.game.events.on('inventory-updated', this.onInventoryUpdated, this);
    this.game.events.on('restock-failed', this.onRestockFailed, this);
    this.game.events.on('select-furniture', this.onSelectFurniture, this);
    this.game.events.on('furniture-deselected', this.onFurnitureDeselected, this);
    this.game.events.on('ui-delete-confirm', this.onDeleteConfirm, this);
    this.game.events.on('ui-delete-confirm-hide', this.hideDeleteConfirm, this);

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


  /** Bottom-right NPC panel position (responsive). */
  private layoutNpcPanel(w: number, h: number): void {
    this.panel.setPosition(w - 20, h - PANEL_BOTTOM_MARGIN - PANEL_H);
  }

  isPointerOnUi(p: Phaser.Input.Pointer): boolean {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    // Full-screen modal: block all ClubScene gestures underneath
    if (this.deleteConfirmVisible) return true;
    if (p.y < 56) return true;
    if (p.x < 350 && p.y > h - 60) return true;
    if (this.panelVisible) {
      const panelTop = h - PANEL_BOTTOM_MARGIN - PANEL_H;
      const panelBottom = h - PANEL_BOTTOM_MARGIN + 8;
      if (p.x > w - PANEL_W - 24 && p.y > panelTop - 8 && p.y < panelBottom) return true;
    }
    if (this.furnPanelVisible) {
      const furnH = 280;
      const panelTop = h - PANEL_BOTTOM_MARGIN - furnH;
      const panelBottom = h - PANEL_BOTTOM_MARGIN + 8;
      if (p.x > w - PANEL_W - 24 && p.y > panelTop - 8 && p.y < panelBottom) return true;
    }
    if (this.staffPanelVisible) {
      const cx = w / 2;
      const cy = h / 2;
      if (Math.abs(p.x - cx) < 210 && Math.abs(p.y - cy) < 250) return true;
    }
    if (this.inventoryPanelVisible) {
      const cx = w / 2;
      const cy = h / 2;
      if (Math.abs(p.x - cx) < 200 && Math.abs(p.y - cy) < 250) return true;
    }
    if (this.shopPanelVisible) {
      const cx = w / 2;
      const cy = h / 2;
      if (Math.abs(p.x - cx) < 230 && Math.abs(p.y - cy) < 260) return true;
    }
    if (this.buildMode && p.x < 260 && p.y > h - 60) return true;
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

  private hideFurnPanel(): void {
    if (!this.furnPanelVisible) return;
    this.furnPanelVisible = false;
    this.furnPanel.setVisible(false);
    this.inspectedFurniture = null;
  }

  private onSelectFurniture = (payload: FurnitureInspectPayload): void => {
    if (this.buildMode) return;
    this.hidePanel();
    this.inspectedFurniture = payload;
    this.furnPanelVisible = true;
    const cam = this.cameras.main;
    this.furnPanel.setPosition(cam.width - 20, cam.height - PANEL_BOTTOM_MARGIN - 280);
    this.furnPanel.setVisible(true);
    this.refreshFurnPanel(payload);
  };

  private onFurnitureDeselected = (): void => {
    this.hideFurnPanel();
  };

  private refreshFurnPanel(f: FurnitureInspectPayload): void {
    this.furnName.setText(f.name);
    this.furnCondition.setText(`Condición: ${f.condition}`);
    const setBar = (
      bar: Phaser.GameObjects.Rectangle,
      valText: Phaser.GameObjects.Text,
      cur: number,
      max: number,
      okColor: number
    ) => {
      const m = Math.max(1, max);
      const ratio = Phaser.Math.Clamp(cur / m, 0, 1);
      bar.width = 220 * ratio;
      bar.setFillStyle(ratio < 0.3 ? 0xff4466 : ratio < 0.55 ? 0xffb84d : okColor);
      valText.setText(`${Math.round(cur)}/${Math.round(max)}`);
    };
    setBar(this.furnDurBar, this.furnDurVal, f.durability, f.maxDurability, 0x3cff9a);
    setBar(this.furnComBar, this.furnComVal, f.comfort, f.maxComfort, 0xffb84d);
    setBar(this.furnCleBar, this.furnCleVal, f.cleanliness, f.maxCleanliness, 0x2ad6ff);
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
    this.hideFurnPanel();
    this.selectedNpc = npc;
    this.panelVisible = true;
    this.layoutNpcPanel(this.cameras.main.width, this.cameras.main.height);
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
      const tipsNight = npc.tipsNight ?? 0;
      const tipsDay = npc.tipsDay ?? 0;
      const tipsTotal = npc.tipsTotal ?? 0;
      const tipAct = npc.tipActionLabel;
      const seeking = tipAct
        ? `\n${tipAct} para el cliente`
        : npc.seekingTip ||
            ['serving', 'serving_cerveza', 'serving_drink', 'busy'].includes(npc.state)
          ? '\nBuscando propina…'
          : '';
      const pers = npc.personality ?? [];
      const persLine =
        pers.length > 0
          ? '\n' + pers.map((x) => `${x.label}: ${x.level}`).join(' · ')
          : '';
      const compLine = npc.competitivenessLabel
        ? `\nCompetitiva: ${npc.competitivenessLabel}`
        : '';
      const salaryLine =
        typeof npc.weeklySalary === 'number' && npc.weeklySalary > 0
          ? `\nSueldo: $${npc.weeklySalary}/semana`
          : '';
      this.panelStats.setText(
        `Estado: ${estado}\nHabilidad: ${npc.skill ?? '—'}\n` +
          `Propinas esta noche: $${tipsNight}\n` +
          `Propinas de la jornada: $${tipsDay}\n` +
          `Propinas totales: $${tipsTotal}` +
          salaryLine +
          (npc.performance ? `\nRendimiento: ${npc.performance}` : '') +
          persLine +
          compLine +
          seeking
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
      const canRest = !['walking', 'busy', 'resting', 'serving', 'cleaning', 'wandering'].includes(npc.state);
      this.restBtn.setVisible(canRest);
      this.restBtn.setAlpha(canRest ? 1 : 0.4);
    } else {
      this.panelStats.setText(`Estado: ${estado}`);
      this.energyLabel.setText('Ánimo de la noche');
      const mood = npc.mood ?? 100;
      this.energyBar.width = 220 * Phaser.Math.Clamp(mood / 100, 0, 1);
      this.energyBar.setFillStyle(mood < 30 ? 0xff4466 : 0x2ad6ff);
      this.moodBar.setVisible(false);
      this.moodLabel.setVisible(false);
      this.restBtn.setVisible(false);
    }
  }

  private onBuildModeChanged = (on: boolean): void => {
    this.buildMode = on;
    if (on) {
      this.hidePanel();
      this.hideFurnPanel();
      this.hideStaffPanel();
      this.game.events.emit('cmd-request-shop-catalog');
    } else {
      this.hideShopPanel();
      this.hideDeleteConfirm();
    }
    this.refreshBuildButtons();
  };

  private refreshBuildButtons(): void {
    const canBuild = this.phase !== 'open';
    this.buildBtn.setVisible(canBuild && !this.buildMode);
    this.doneBuildBtn.setVisible(canBuild && this.buildMode);
    this.staffBtn.setVisible(!this.buildMode);
    this.inventBtn.setVisible(true);
    this.shopBtn.setVisible(canBuild && this.buildMode);
    this.openBtn.setAlpha(this.buildMode ? 0.35 : 1);
    if (this.buildMode) {
      this.openBtn.setVisible(this.phase !== 'open');
    }
  }

  private nightLabel(s: HudState): string {
    const n = typeof s.nightNumber === 'number' && s.nightNumber > 0 ? s.nightNumber : null;
    return n != null ? `Noche ${n}` : 'Noche';
  }

  private onStats = (s: HudState): void => {
    this.phase = s.phase;
    if (this.inventoryPanelVisible) this.rebuildInventoryPanel();
    this.moneyText.setText(`Dinero: ${formatMoney(s.money)}`);
    const label = this.nightLabel(s);
    if (s.phase === 'open') {
      this.timerText.setText(`${label} · ${s.nightTimer}s`);
    } else if (s.phase === 'prep') {
      this.timerText.setText(`${label} · lista`);
    } else if (s.phase === 'summary') {
      this.timerText.setText(`${label} · cerrada`);
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
        tipsNight: this.selectedNpc.tipsNight,
        tipsDay: this.selectedNpc.tipsDay,
        tipsTotal: this.selectedNpc.tipsTotal,
        tipActionLabel: this.selectedNpc.tipActionLabel,
        seekingTip: this.selectedNpc.seekingTip,
        personality: this.selectedNpc.personality,
        competitivenessLabel: this.selectedNpc.competitivenessLabel,
        performance: this.selectedNpc.performance,
        weeklySalary: this.selectedNpc.weeklySalary,
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
    const label = this.nightLabel(s);
    this.timerText.setText(`${label} · cerrada`);
    this.moneyText.setText(`Dinero: ${formatMoney(s.money)}`);

    const lines: string[] = [
      label,
      `Ganado esta noche: ${formatMoney(s.nightEarned ?? 0)}`,
      `Clientes que se sentaron: ${s.servedCount ?? 0}`,
      `Dinero total: ${formatMoney(s.money)}`,
    ];
    if (s.payroll && s.payroll.total > 0) {
      lines.push(`Sueldos semanales: -$${s.payroll.total}`);
      for (const l of s.payroll.lines) {
        lines.push(`  ${l.name}: $${l.amount}`);
      }
    }
    if (typeof s.nextPayrollNight === 'number' && s.nextPayrollNight > 0) {
      lines.push(`Próximo pago de sueldos: noche ${s.nextPayrollNight}`);
    }
    if (s.utilities && s.utilities.total > 0) {
      lines.push(`Servicios del mes: -$${s.utilities.total}`);
      for (const l of s.utilities.lines) {
        lines.push(`  ${l.label}: $${l.amount}`);
      }
    }
    if (typeof s.nextUtilitiesNight === 'number' && s.nextUtilitiesNight > 0) {
      lines.push(`Próximo pago de servicios: noche ${s.nextUtilitiesNight}`);
    }
    if (s.money < 0) {
      lines.push('⚠ Dinero negativo: el club está en números rojos');
    }

    this.layoutSummary(lines.join('\n'));
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

  /**
   * Auto-size the night-summary panel so payroll + utilities lines never
   * overlap the title or spill past the box / viewport.
   */
  private layoutSummary(bodyText: string): void {
    this.lastSummaryBody = bodyText;
    const cam = this.cameras.main;
    const maxW = Math.min(520, Math.max(280, cam.width - 32));
    const maxH = Math.max(220, cam.height - 48);
    const padX = 28;
    const padTop = 22;
    const padBot = 18;
    const titleGap = 14;
    const btnH = 40;
    const btnGap = 16;
    const closeSize = 36;

    let fontSize = 15;
    let lineSpacing = 6;
    let useColumns = false;

    const measure = (fs: number, ls: number, wrapW: number, twoCol: boolean) => {
      this.summaryBody.setStyle({
        fontSize: `${fs}px`,
        color: '#f0e0ff',
        align: twoCol ? 'left' : 'center',
        lineSpacing: ls,
        wordWrap: { width: wrapW, useAdvancedWrap: true },
      });
      this.summaryBody.setOrigin(twoCol ? 0 : 0.5, 0);
      this.summaryBody.setText(bodyText);
      return {
        bw: Math.ceil(this.summaryBody.width),
        bh: Math.ceil(this.summaryBody.height),
      };
    };

    // Title size may shrink on very short viewports
    let titleFs = 24;
    this.summaryTitle.setFontSize(titleFs);
    let titleH = Math.ceil(this.summaryTitle.height);

    let panelW = Math.min(400, maxW);
    let wrapW = panelW - padX * 2;
    let m = measure(fontSize, lineSpacing, wrapW, false);
    let contentH = padTop + titleH + titleGap + m.bh + btnGap + btnH + padBot;

    // Grow width if wrapped lines are still too tall or text is wider
    if (contentH > maxH || m.bw + padX * 2 > panelW) {
      panelW = maxW;
      wrapW = panelW - padX * 2;
      m = measure(fontSize, lineSpacing, wrapW, false);
      contentH = padTop + titleH + titleGap + m.bh + btnGap + btnH + padBot;
    }

    // Shrink font / spacing if still too tall
    while (contentH > maxH && fontSize > 11) {
      fontSize -= 1;
      lineSpacing = Math.max(3, lineSpacing - 1);
      if (titleFs > 18) {
        titleFs -= 1;
        this.summaryTitle.setFontSize(titleFs);
        titleH = Math.ceil(this.summaryTitle.height);
      }
      m = measure(fontSize, lineSpacing, wrapW, false);
      contentH = padTop + titleH + titleGap + m.bh + btnGap + btnH + padBot;
    }

    // Last resort on tiny screens: left-aligned two-ish column feel via wider wrap already;
    // if still overflowing, clip body height conceptually by smaller spacing already applied.
    if (contentH > maxH) {
      useColumns = true;
      wrapW = panelW - padX * 2;
      m = measure(Math.max(11, fontSize - 1), 3, wrapW, true);
      contentH = padTop + titleH + titleGap + m.bh + btnGap + btnH + padBot;
    }

    const panelH = Math.min(maxH, Math.max(280, contentH));
    // If still too tall, leave a bit of scroll room by clamping body visually inside
    const availableBody = panelH - padTop - titleH - titleGap - btnGap - btnH - padBot;
    if (m.bh > availableBody) {
      // Prefer smaller font one more step rather than overflow
      fontSize = Math.max(10, fontSize - 1);
      m = measure(fontSize, 3, wrapW, useColumns);
    }

    this.summaryBg.setSize(panelW, panelH);
    // Phaser Rectangle origin is center by default
    this.summaryBg.setPosition(0, 0);

    const topY = -panelH / 2;
    const titleY = topY + padTop + titleH / 2;
    this.summaryTitle.setPosition(0, titleY);

    const bodyY = titleY + titleH / 2 + titleGap;
    if (useColumns) {
      this.summaryBody.setPosition(-wrapW / 2, bodyY);
    } else {
      this.summaryBody.setPosition(0, bodyY);
    }

    const btnY = panelH / 2 - padBot - btnH / 2;
    this.summaryAgain.setPosition(-100, btnY);

    const closeX = panelW / 2 - closeSize / 2 - 10;
    const closeY = topY + closeSize / 2 + 8;
    this.summaryClose.setPosition(closeX, closeY);

    this.summary.setPosition(cam.width / 2, cam.height / 2);
  }

  /** Narrow screens: 'Noche N' goes under the money line (left) so it can't overlap it or the button. */
  private layoutTimerText(w: number): void {
    if (w < 640) {
      this.timerText.setOrigin(0, 0).setPosition(16, 34).setFontSize(12);
    } else {
      this.timerText.setOrigin(0.5, 0).setPosition(w / 2, 14).setFontSize(16);
    }
  }

  private onResize = (gameSize: Phaser.Structs.Size): void => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.openBtn.setX(w - 150);
    this.closeBtn.setX(w - 150);
    this.buildBtn.setPosition(16, h - 48);
    this.doneBuildBtn.setPosition(16, h - 48);
    this.staffBtn.setPosition(136, h - 48);
    this.inventBtn.setPosition(232, h - 48);
    this.shopBtn.setPosition(136, h - 48);
    if (this.inventoryPanel) this.inventoryPanel.setPosition(w / 2, h / 2);
    this.layoutNpcPanel(w, h);
    if (this.furnPanel) {
      this.furnPanel.setPosition(w - 20, h - PANEL_BOTTOM_MARGIN - 280);
    }
    this.layoutTimerText(w);
    if (this.summary.visible && this.lastSummaryBody) {
      this.layoutSummary(this.lastSummaryBody);
    } else {
      this.summary.setPosition(w / 2, h / 2);
    }
    this.staffPanel.setPosition(w / 2, h / 2);
    if (this.shopPanel) this.shopPanel.setPosition(w / 2, h / 2);
    this.layoutDeleteConfirm(w, h);
  };

  private onInventoryUpdated = (): void => {
    if (this.inventoryPanelVisible) this.rebuildInventoryPanel();
  };

  private onRestockFailed = (info: { id?: string; reason?: string }): void => {
    if (!this.inventoryPanelVisible) return;
    this.flashInventoryMsg(info?.reason === 'money' ? 'Sin dinero' : 'No se pudo comprar');
  };

  private flashInventoryMsg(msg: string): void {
    if (!this.inventoryPanel) return;
    if (this.inventoryFlash) {
      this.inventoryFlash.destroy();
      this.inventoryFlash = null;
    }
    const flash = this.add
      .text(0, 188, msg, {
        fontSize: '14px',
        color: '#ff6688',
        fontStyle: 'bold',
        backgroundColor: '#2a1020',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5);
    this.inventoryPanel.add(flash);
    this.inventoryFlash = flash;
    this.time.delayedCall(1400, () => {
      if (this.inventoryFlash === flash) {
        flash.destroy();
        this.inventoryFlash = null;
      }
    });
  }

  private createInventoryPanel(): void {
    const cam = this.cameras.main;
    this.inventoryPanel = this.add
      .container(cam.width / 2, cam.height / 2)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9600);
    // Opaque enough to read over the club floor; width fits 390px screens.
    const panelW = Math.min(360, Math.max(300, cam.width - 24));
    const bg = this.add.rectangle(0, 0, panelW, 460, 0x12081c, 1);
    bg.setStrokeStyle(2, 0x2ad6ff);
    bg.setInteractive();
    this.inventoryBg = bg;
    const title = this.add
      .text(0, -210, 'Inventario', {
        fontSize: '18px',
        color: '#2ad6ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('invTitle');
    const close = this.makeLocalButton(panelW / 2 - 28, -218, 32, 28, '✕', () =>
      this.hideInventoryPanel()
    );
    this.inventoryPanel.add([bg, title, close]);
  }

  private toggleInventoryPanel(): void {
    if (this.inventoryPanelVisible) this.hideInventoryPanel();
    else this.showInventoryPanel();
  }

  private showInventoryPanel(): void {
    this.hidePanel();
    this.hideStaffPanel();
    this.hideShopPanel();
    this.inventoryPanelVisible = true;
    this.inventoryPanel.setVisible(true);
    this.rebuildInventoryPanel();
  }

  private hideInventoryPanel(): void {
    if (!this.inventoryPanelVisible) return;
    this.inventoryPanelVisible = false;
    this.inventoryPanel.setVisible(false);
  }

  private clearInventoryRows(): void {
    for (const g of this.inventoryRows) g.destroy();
    this.inventoryRows = [];
  }

  private fmtMoney(n: number): string {
    if (!Number.isFinite(n)) return '$0';
    const r = Math.round(Math.abs(n) * 100) / 100;
    const sign = n < 0 && r > 0 ? '-' : '';
    return Number.isInteger(r) ? `${sign}$${r}` : `${sign}$${r.toFixed(1)}`;
  }

  /** Compact inventory button; greys out when disabled (price min/max). */
  private makeInvBtn(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    cb: () => void,
    enabled = true
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const fill = enabled ? 0xb43282 : 0x3a2a44;
    const stroke = enabled ? 0xff7ac8 : 0x5a4a64;
    const bg = this.add.rectangle(0, 0, w, h, fill, 1).setOrigin(0);
    bg.setStrokeStyle(1, stroke);
    const t = this.add
      .text(w / 2, h / 2, label, {
        fontSize: h <= 22 ? '12px' : '13px',
        color: enabled ? '#ffffff' : '#887898',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(0xd44a9a));
      bg.on('pointerout', () => bg.setFillStyle(0xb43282));
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        cb();
      });
    }
    c.add([bg, t]);
    return c;
  }

  private rebuildInventoryPanel(): void {
    if (!this.inventoryPanel) return;
    this.clearInventoryRows();
    if (this.inventoryFlash) {
      this.inventoryFlash.destroy();
      this.inventoryFlash = null;
    }
    const lines = listInventory();
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    // Wide: one row per product. Narrow (phones): row 1 = data, row 2 = [−] price [+] and restock.
    const twoRow = camW < 600;
    const panelW = twoRow ? Math.max(300, camW - 16) : 580;
    const half = panelW / 2 - 14;
    const font = twoRow ? '11px' : '12px';
    const rowH = twoRow ? 54 : 38;
    const panelH = Math.min(camH - 70, 64 + 24 + lines.length * rowH + 40);
    if (this.inventoryBg) this.inventoryBg.setSize(panelW, panelH);
    const title = this.inventoryPanel.getByName('invTitle') as Phaser.GameObjects.Text | null;
    if (title) title.setY(-panelH / 2 + 22);
    const closeBtn = this.inventoryPanel.list.find(
      (o) => o instanceof Phaser.GameObjects.Container && o !== this.inventoryPanel && !this.inventoryRows.includes(o)
    ) as Phaser.GameObjects.Container | undefined;
    if (closeBtn) closeBtn.setPosition(panelW / 2 - 40, -panelH / 2 + 8);

    const cols = twoRow
      ? { name: -half, stock: -half + 96, sold: -half + 142, cost: -half + 188, margin: -half + 244, price: -half + 52, rest: half - 76 }
      : { name: -half, stock: -half + 98, sold: -half + 146, cost: -half + 194, price: -half + 250, margin: -half + 352, rest: half - 76 };

    const headerY = -panelH / 2 + 50;
    const mkH = (x: number, label: string) => {
      const tt = this.add.text(x, headerY, label, { fontSize: font, color: '#a080c0', fontStyle: 'bold' }).setOrigin(0, 0);
      this.inventoryPanel.add(tt);
      this.inventoryRows.push(tt);
    };
    mkH(cols.name, 'Producto');
    mkH(cols.stock, 'Exis.');
    mkH(cols.sold, 'Vend.');
    mkH(cols.cost, 'Costo');
    if (!twoRow) mkH(cols.price, 'Precio');
    mkH(cols.margin, 'Margen');
    if (!twoRow) mkH(cols.rest, 'Comprar');

    let y = headerY + 22;
    for (const line of lines) {
      const mk = (x: number, yy: number, label: string, color = '#e8d0ff', bold = false) => {
        const tt = this.add
          .text(x, yy, label, { fontSize: font, color, fontStyle: bold ? 'bold' : 'normal' })
          .setOrigin(0, 0);
        this.inventoryPanel.add(tt);
        this.inventoryRows.push(tt);
      };
      const stockColor = line.stock <= 0 ? '#ff6688' : '#e8d0ff';
      const marginColor = line.margin < 0 ? '#ff6688' : '#3cff9a';
      mk(cols.name, y + 4, line.name, '#ff9ad5');
      mk(cols.stock, y + 4, String(line.stock), stockColor);
      mk(cols.sold, y + 4, String(line.soldTonight));
      mk(cols.cost, y + 4, this.fmtMoney(line.supplierCost));
      mk(cols.margin, y + 4, this.fmtMoney(line.margin), marginColor);

      // [−] $N [+] — emits cmd-set-drink-price
      const step = Math.max(1, line.priceStep || 1);
      const atMin = line.price <= line.minPrice;
      const atMax = line.price >= line.maxPrice;
      const btn = 26;
      const priceW = 38;
      const rowY2 = twoRow ? y + 24 : y;
      if (twoRow) mk(cols.name, rowY2 + 6, 'Precio', '#a080c0');
      const minus = this.makeInvBtn(cols.price, rowY2, btn, btn - 2, '−', () => {
        this.game.events.emit('cmd-set-drink-price', { id: line.id, delta: -step });
      }, !atMin);
      const priceLabel = this.add
        .text(cols.price + btn + priceW / 2, rowY2 + (btn - 2) / 2, this.fmtMoney(line.price), {
          fontSize: font,
          color: '#7ad7ff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const plus = this.makeInvBtn(cols.price + btn + priceW, rowY2, btn, btn - 2, '+', () => {
        this.game.events.emit('cmd-set-drink-price', { id: line.id, delta: step });
      }, !atMax);
      // Restock +5 / +20
      const b5 = this.makeInvBtn(cols.rest, rowY2, 34, btn - 2, '+5', () => {
        this.game.events.emit('cmd-restock-drink', { id: line.id, units: 5 });
      });
      const b20 = this.makeInvBtn(cols.rest + 38, rowY2, 38, btn - 2, '+20', () => {
        this.game.events.emit('cmd-restock-drink', { id: line.id, units: 20 });
      });
      for (const o of [minus, priceLabel, plus, b5, b20]) {
        this.inventoryPanel.add(o);
        this.inventoryRows.push(o);
      }
      y += rowH;
    }

    const hint = this.add
      .text(0, panelH / 2 - 20, '−/+ cambia el precio · +5/+20 compra al proveedor · Vendidas = esta noche', {
        fontSize: '10px',
        color: '#8060a0',
        align: 'center',
        wordWrap: { width: panelW - 24 },
      })
      .setOrigin(0.5);
    this.inventoryPanel.add(hint);
    this.inventoryRows.push(hint);
  }

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
    this.hideInventoryPanel();
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

  private createShopPanel(): void {
    const cam = this.cameras.main;
    this.shopPanel = this.add
      .container(cam.width / 2, cam.height / 2)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9650);
    const bg = this.add.rectangle(0, 0, 420, 480, 0x140a22, 0.96);
    bg.setStrokeStyle(2, 0xff3ca0);
    bg.setInteractive();
    const title = this.add
      .text(0, -218, 'Tienda — Muebles', {
        fontSize: '20px',
        color: '#ff9ad5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('shopTitle');
    const close = this.makeLocalButton(170, -228, 36, 32, '✕', () => this.hideShopPanel());
    this.shopPanel.add([bg, title, close]);
  }

  private createDeleteConfirm(): void {
    const cam = this.cameras.main;
    // Screen-space modal in UIScene (zoom=1) so Sí/No hit areas match visuals on mobile.
    // Confirm path carries furniture id in the event payload (see pendingDelete) — do not
    // rely on ClubScene.selectedFurniture surviving pointer races while the modal is open.
    this.deleteConfirm = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9800);

    const dim = this.add
      .rectangle(cam.width / 2, cam.height / 2, cam.width + 40, cam.height + 40, 0x000000, 0.5)
      .setName('deleteDim')
      .setInteractive();
    dim.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
    });
    dim.on('pointerup', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
    });

    const panel = this.add
      .rectangle(cam.width / 2, cam.height / 2, 300, 150, 0x1a0e28, 0.96)
      .setName('deletePanel');
    panel.setStrokeStyle(2, 0xff3ca0);
    // Absorb taps on panel chrome so they do not fall through to ClubScene
    panel.setInteractive();
    panel.on('pointerdown', (p: Phaser.Input.Pointer) => p.event.stopPropagation());
    panel.on('pointerup', (p: Phaser.Input.Pointer) => p.event.stopPropagation());

    this.deleteConfirmMsg = this.add
      .text(cam.width / 2, cam.height / 2 - 28, '¿Quitar este mueble?', {
        fontSize: '15px',
        color: '#ffe8f8',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setName('deleteConfirmMsg');

    const BTN_W = 120;
    const BTN_H = 52;
    const mk = (ox: number, label: string, yes: boolean) => {
      const c = this.add.container(cam.width / 2 + ox, cam.height / 2 + 36).setName(yes ? 'deleteYes' : 'deleteNo');
      // Depth above dim/panel so hit-testing prefers the buttons
      c.setDepth(2);
      const fill = yes ? 0xb43282 : 0x3a2a48;
      const b = this.add.rectangle(0, 0, BTN_W, BTN_H, fill, 1);
      b.setStrokeStyle(1, yes ? 0xff7ac8 : 0x8870a0);
      // Large explicit hit area — reliable on touch / mobile
      b.setInteractive({
        useHandCursor: true,
        hitArea: new Phaser.Geom.Rectangle(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      });
      const t = this.add
        .text(0, 0, label, { fontSize: '18px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5);
      b.on('pointerover', () => b.setFillStyle(yes ? 0xd44a9a : 0x4a3a58));
      b.on('pointerout', () => b.setFillStyle(fill));
      const onPress = (p: Phaser.Input.Pointer) => {
        p.event?.stopPropagation?.();
        // Ignore the tail of the press that opened the modal (Eliminar tap whose finger/mouse
        // lifts on top of Sí/No) — only presses that STARTED after the modal opened count.
        if (!this.isFreshDeletePress(p)) return;
        this.handleDeleteConfirmChoice(yes);
      };
      b.on('pointerdown', onPress);
      b.on('pointerup', onPress);
      c.add([b, t]);
      return c;
    };

    // Display list: dim first, then panel/msg, then buttons last (higher for input)
    this.deleteConfirm.add([dim, panel, this.deleteConfirmMsg, mk(-70, 'Sí', true), mk(70, 'No', false)]);

    // Geometric fallback: if object hit-testing ever misses (zoom/resize/touch quirks), a fresh press
    // inside the Sí/No rectangles (generous 150x80 zones) still resolves the modal.
    const geometric = (p: Phaser.Input.Pointer) => {
      if (!this.deleteConfirmVisible || !this.isFreshDeletePress(p)) return;
      const c = this.cameras.main;
      const cx = c.width / 2;
      const cy = c.height / 2 + 36;
      const inZone = (zx: number) => Math.abs(p.x - zx) <= 75 && Math.abs(p.y - cy) <= 40;
      if (inZone(cx - 70)) this.handleDeleteConfirmChoice(true);
      else if (inZone(cx + 70)) this.handleDeleteConfirmChoice(false);
    };
    this.input.on('pointerdown', geometric);
    this.input.on('pointerup', geometric);
  }

  /** True when this pointer's press began after the delete modal opened (not the opener's tail). */
  private isFreshDeletePress(p: Phaser.Input.Pointer): boolean {
    if (!this.deleteConfirmVisible) return false;
    const now = this.game.loop.time;
    if (now - this.deleteOpenedAt < 200) return false; // accidental double-tap guard
    return p.downTime > this.deleteOpenedAt;
  }

  /** Sí/No — emit confirm with { id } from pendingDelete; pointerdown+up both guarded. */
  private handleDeleteConfirmChoice(yes: boolean): void {
    if (!this.deleteConfirmVisible) return;
    const pending = this.pendingDelete;
    this.hideDeleteConfirm();
    if (yes) {
      if (pending?.id) {
        this.game.events.emit('cmd-confirm-delete-furniture', { id: pending.id });
      }
    } else {
      this.game.events.emit('cmd-cancel-delete-furniture');
    }
  }

  private layoutDeleteConfirm(w: number, h: number): void {
    if (!this.deleteConfirm) return;
    const dim = this.deleteConfirm.getByName('deleteDim') as Phaser.GameObjects.Rectangle | null;
    const panel = this.deleteConfirm.getByName('deletePanel') as Phaser.GameObjects.Rectangle | null;
    const yes = this.deleteConfirm.getByName('deleteYes') as Phaser.GameObjects.Container | null;
    const no = this.deleteConfirm.getByName('deleteNo') as Phaser.GameObjects.Container | null;
    if (dim) {
      dim.setPosition(w / 2, h / 2);
      dim.setSize(w + 40, h + 40);
    }
    if (panel) panel.setPosition(w / 2, h / 2);
    if (this.deleteConfirmMsg) this.deleteConfirmMsg.setPosition(w / 2, h / 2 - 28);
    if (yes) yes.setPosition(w / 2 - 70, h / 2 + 36);
    if (no) no.setPosition(w / 2 + 70, h / 2 + 36);
  }

  private onDeleteConfirm = (payload: { id?: string; refund?: number }): void => {
    if (!this.deleteConfirm) return;
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return; // refuse to open without a concrete furniture id
    this.hideShopPanel();
    this.hideStaffPanel();
    const refund = typeof payload?.refund === 'number' ? payload.refund : 0;
    this.pendingDelete = { id, refund };
    this.deleteConfirmMsg.setText(
      refund > 0
        ? `¿Quitar este mueble?\n(+$${refund})`
        : '¿Quitar este mueble?\n(sin reembolso)'
    );
    const cam = this.cameras.main;
    this.layoutDeleteConfirm(cam.width, cam.height);
    this.deleteConfirmVisible = true;
    this.deleteOpenedAt = this.game.loop.time;
    this.deleteConfirm.setVisible(true);
    this.deleteConfirm.setDepth(9800);
    // UIScene above ClubScene for input; topOnly so dim does not steal Sí/No
    this.scene.bringToTop();
    this.input.setTopOnly(true);
  };

  private hideDeleteConfirm = (): void => {
    if (!this.deleteConfirm) return;
    this.deleteConfirmVisible = false;
    this.deleteConfirm.setVisible(false);
    this.pendingDelete = null;
    this.input.setTopOnly(false);
  };


  private toggleShopPanel(): void {
    if (this.shopPanelVisible) this.hideShopPanel();
    else this.showShopPanel();
  }

  private showShopPanel(): void {
    if (!this.buildMode) return;
    this.hideStaffPanel();
    this.hideInventoryPanel();
    this.hidePanel();
    this.shopPanelVisible = true;
    this.shopPanel.setVisible(true);
    this.game.events.emit('cmd-request-shop-catalog');
    this.rebuildShopPanel();
  }

  private hideShopPanel(): void {
    if (!this.shopPanelVisible) return;
    this.shopPanelVisible = false;
    this.shopPanel.setVisible(false);
  }

  private onShopCatalog = (payload: ShopCatalogPayload): void => {
    this.shopCatalog = payload;
    if (this.shopPanelVisible) this.rebuildShopPanel();
  };

  private onShopBuyFailed = (info: { id: string; reason: string }): void => {
    const title = this.shopPanel.getByName('shopTitle') as Phaser.GameObjects.Text | null;
    if (!title) return;
    const msg =
      info.reason === 'money'
        ? 'Tienda — sin dinero'
        : info.reason === 'space'
          ? 'Tienda — sin espacio'
          : 'Tienda — error';
    title.setText(msg);
    title.setColor('#ff6688');
    this.time.delayedCall(1600, () => {
      title.setText(this.shopTab === 'muebles' ? 'Tienda — Muebles' : 'Tienda — Decoración');
      title.setColor('#ff9ad5');
    });
  };

  private clearShopRows(): void {
    for (const g of this.shopRows) g.destroy();
    this.shopRows = [];
  }

  private rebuildShopPanel(): void {
    if (!this.shopPanel) return;
    this.clearShopRows();
    const catalog = this.shopCatalog;

    const tabY = -185;
    const mkTab = (x: number, label: string, tab: 'muebles' | 'decoracion') => {
      const active = this.shopTab === tab;
      const btn = this.makeLocalButton(x, tabY, 120, 30, label, () => {
        this.shopTab = tab;
        const title = this.shopPanel.getByName('shopTitle') as Phaser.GameObjects.Text | null;
        if (title) {
          title.setText(tab === 'muebles' ? 'Tienda — Muebles' : 'Tienda — Decoración');
          title.setColor('#ff9ad5');
        }
        this.rebuildShopPanel();
      });
      btn.setAlpha(active ? 1 : 0.55);
      this.shopPanel.add(btn);
      this.shopRows.push(btn);
    };
    mkTab(-130, 'Muebles', 'muebles');
    mkTab(10, 'Decoración', 'decoracion');

    if (!catalog) {
      const wait = this.add
        .text(0, 0, 'Cargando…', { fontSize: '14px', color: '#c8a0e0' })
        .setOrigin(0.5);
      this.shopPanel.add(wait);
      this.shopRows.push(wait);
      return;
    }

    const moneyHint = this.add
      .text(0, -148, `Dinero: ${formatMoney(catalog.money)}`, {
        fontSize: '13px',
        color: '#ffe066',
      })
      .setOrigin(0.5);
    this.shopPanel.add(moneyHint);
    this.shopRows.push(moneyHint);

    const items = catalog.items.filter((it) => {
      const cat = (it.category || 'muebles').toLowerCase();
      if (this.shopTab === 'muebles') return cat === 'muebles' || cat === 'furniture';
      return cat === 'decoracion' || cat === 'decor' || cat === 'decoration';
    });

    let y = -120;
    if (!items.length) {
      const empty = this.add
        .text(0, y + 40, 'Nada en esta sección todavía.', {
          fontSize: '13px',
          color: '#a080c0',
          align: 'center',
        })
        .setOrigin(0.5);
      this.shopPanel.add(empty);
      this.shopRows.push(empty);
      return;
    }

    for (const it of items) {
      y = this.addShopItemRow(it, y, catalog.money);
      y += 10;
    }
  }

  private addShopItemRow(
    it: ShopCatalogPayload['items'][number],
    y: number,
    money: number
  ): number {
    const rowH = 110;
    const card = this.add.rectangle(0, y + rowH / 2, 380, rowH, 0x1a0e28, 0.95).setOrigin(0.5);
    card.setStrokeStyle(1, 0x6a3a78);
    this.shopPanel.add(card);
    this.shopRows.push(card);

    const px = -150;
    if (this.textures.exists(it.sprite)) {
      const img = this.add.image(px, y + rowH / 2, it.sprite);
      if (it.baseVertex) {
        // Real art: keep aspect (placeholders are stretched to the legacy 72x50 slot)
        const f = img.frame;
        const k = Math.min(72 / f.realWidth, 64 / f.realHeight);
        img.setDisplaySize(f.realWidth * k, f.realHeight * k);
      } else {
        img.setDisplaySize(72, 50);
      }
      this.shopPanel.add(img);
      this.shopRows.push(img);
    } else {
      const ph = this.add.rectangle(px, y + rowH / 2, 72, 50, 0x2a1838).setOrigin(0.5);
      this.shopPanel.add(ph);
      this.shopRows.push(ph);
    }

    const can = money >= it.price;
    const owned = it.ownedCount > 0 ? `  ·  En club: ${it.ownedCount}` : '';
    const info = this.add
      .text(
        -100,
        y + 12,
        `${it.name}
Precio: $${it.price}${owned}
${it.blurb ?? ''}`,
        { fontSize: '12px', color: '#e8d0ff', lineSpacing: 4, wordWrap: { width: 200 } }
      )
      .setOrigin(0, 0);
    this.shopPanel.add(info);
    this.shopRows.push(info);

    const buy = this.makeLocalButton(110, y + 68, 100, 28, 'Comprar', () => {
      this.game.events.emit('cmd-buy-shop-furniture', it.id);
    });
    buy.setAlpha(can ? 1 : 0.4);
    this.shopPanel.add(buy);
    this.shopRows.push(buy);

    return y + rowH;
  }
}
