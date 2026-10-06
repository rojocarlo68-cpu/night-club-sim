import { BANKRUPTCY_TEXT } from '../config/bankruptcy';
import Phaser from 'phaser';
import { NpcInfo } from '../types/Npc';
import { StaffRosterEntry, StaffRosterPayload } from '../types/Staff';
import { ShopCatalogPayload } from '../types/Shop';
import { FurnitureInspectPayload } from '../systems/FurnitureStats';
import { listInventory } from '../systems/Inventory';
import { SNACK_LOCKED_HINT } from '../config/snacks';
import {
  describePackages,
  estimateDeliveryText,
  lineCost,
  normalizeOrderUnits,
  orderUnitStep,
  packUnits,
  unitsAtEntrance,
  unitsInTransit,
} from '../systems/Deliveries';
import { getShiftSnapshot, getShiftState } from '../systems/Shift';
import { PACKAGING } from '../config/logistics';
import { ContextMenuPayload, RepairVerdictPayload, TechListPayload } from '../types/Intervention';
import { formatSavedAt, listSlots, readAutosaveSummary, readSlot, SlotSummary } from '../systems/SaveSlots';

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
  /** Prompt B Phase B2: game-time clock from Shift (source of truth). */
  gameHour?: number;
  gameMinute?: number;
  gameClock?: string;
  shiftState?: string;
  currentDay?: number;
  scheduleLabel?: string;
  scheduleLabelMobile?: string;
  isClosing?: boolean;
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
  /** Days left until the next weekly salaries / monthly services charge (existing calendar). */
  payrollDue?: { daysLeft: number; amount: number };
  utilitiesDue?: { daysLeft: number; amount: number };
  /** Unpaid obligation (negative balance after a due charge) with grace days left. */
  debt?: { amount: number; daysLeft: number; line: string } | null;
  bankrupt?: boolean;
  /** Prompt A Phase 10: compact drink/stockout/served lines for summary. */
  nightSales?: {
    drinksSold: number;
    drinksRevenue: number;
    stockedOutNames: string[];
    servedCount: number;
    summaryLines: string[];
  };
  /** Prompt B Phase B9: open/close/duration/staff lines. */
  shiftSummary?: {
    openHhmm: string | null;
    closeHhmm: string | null;
    durationLabel: string | null;
    staffNames: string[];
    staffHours: { name: string; durationLabel: string }[];
    summaryLines: string[];
  };
  /** Botanas unlock: club has ≥1 functional table. */
  snacksUnlocked?: boolean;
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
  sweeping: 'Barriendo',
  mopping: 'Trapeando',
  inspecting: 'Revisando',
  consuming: 'Tomando algo',
  hauling: 'Llevando mercancía',
  picking_trash: 'Recogiendo basura',
  taking_trash_out: 'Sacando la basura',
};


/** Display money as $N or -$N (never $-N). */
/** "hoy" / "mañana" / "en N días" from days left on the existing night calendar. */
function daysLabel(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  return `en ${d} días`;
}

function formatMoney(n: number): string {
  const v = Math.floor(Number.isFinite(n) ? n : 0);
  if (v < 0) return `-$${Math.abs(v)}`;
  return `$${v}`;
}

type ShopTabId = 'funcional' | 'ambiente' | 'entretenimiento' | 'identidad';

const PANEL_W = 260;
const PANEL_H = 400;
/** Gap above bottom edge (clears Construir/Staff row ~48px). */
const PANEL_BOTTOM_MARGIN = 60;
/** PAUSA button x = width − this (left of Abrir/Cerrar noche at width − 150). */
const PAUSE_BTN_RIGHT = 218;
type PauseView = 'main' | 'save' | 'overwrite' | 'load' | 'loading' | 'confirmNew' | 'options' | 'confirmTitle';
/** Max finger/mouse travel (px) for a tap outside a window to count as "close". */
const OUTSIDE_TAP_SLOP = 16;

/**
 * A closable overlay window. 'modal' = centered window with the shared backdrop
 * (tap outside closes it). 'side' = non-blocking inspector (bottom-right) whose
 * outside taps keep going to the club (ClubScene already closes them on empty taps).
 */
interface DismissWin {
  key: string;
  root: Phaser.GameObjects.Container;
  kind: 'modal' | 'side';
  isOpen: () => boolean;
  close: () => void;
}

/**
 * A window that can be moved by its title bar (drag handle). `posKey` groups windows that share a
 * remembered position (staff/customer/furniture inspectors share 'selection': one slot).
 */
interface DragWin {
  key: string;
  posKey: string;
  root: Phaser.GameObjects.Container;
  bg: () => Phaser.GameObjects.Rectangle | null;
  handleH: number;
  /** Room left free at the right end of the bar for the ✕ button. */
  closeW: number;
  handle?: Phaser.GameObjects.Rectangle;
  grip?: Phaser.GameObjects.Text;
}

export class UIScene extends Phaser.Scene {
  private moneyText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  /** Prompt B Phase B2: discreet recommended hours under the clock. */
  private scheduleText!: Phaser.GameObjects.Text;
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
  /** Prompt B Phase B10 */
  private summarySleep!: Phaser.GameObjects.Container;
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
  /** Supplier order being built in the inventory window (units per product). Nothing is paid yet. */
  private orderDraft = new Map<string, number>();
  private orderConfirm!: Phaser.GameObjects.Container;
  private orderConfirmVisible = false;
  private orderConfirmRows: Phaser.GameObjects.GameObject[] = [];
  private orderConfirmMsg = '';
  private lastMoney = 0;
  private inventoryBg: Phaser.GameObjects.Rectangle | null = null;
  private staffRoster: StaffRosterPayload | null = null;
  private staffRows: Phaser.GameObjects.GameObject[] = [];

  private shopBtn!: Phaser.GameObjects.Container;
  private shopPanel!: Phaser.GameObjects.Container;
  private shopPanelVisible = false;
  private shopCatalog: ShopCatalogPayload | null = null;
  private shopRows: Phaser.GameObjects.GameObject[] = [];
  private shopTab: ShopTabId = 'funcional';
  private shopScroll = 0;
  private snacksUnlocked = false;

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

  // ---- Shared window dismiss (✕ / tap outside / right-click on PC) ----
  private dismissWins: DismissWin[] = [];
  /** downTime of the last right-click that closed a window (ClubScene skips that click). */
  lastRightDismissDownTime = -1;
  private ctxMenu!: Phaser.GameObjects.Container;
  private ctxMenuVisible = false;
  private ctxPayload: ContextMenuPayload | null = null;
  private techPanel!: Phaser.GameObjects.Container;
  private techVisible = false;
  private techPayload: TechListPayload | null = null;
  private verdictPanel!: Phaser.GameObjects.Container;
  private verdictVisible = false;
  private verdictPayload: RepairVerdictPayload | null = null;
  private toasts: Phaser.GameObjects.Text[] = [];
  private toastLog: string[] = [];
  private furnActionsBtn!: Phaser.GameObjects.Container;
  private panelEBg!: Phaser.GameObjects.Rectangle;
  private panelMBg!: Phaser.GameObjects.Rectangle;
  private furnSelectedId: string | null = null;
  /** Dim layer behind centered modal windows; tap on it = close topmost modal. */
  private modalBackdrop!: Phaser.GameObjects.Rectangle;
  private readonly modalBackdropAlpha = 0.25;
  private hudBg!: Phaser.GameObjects.Rectangle;
  /** Primary press that started on an "outside" surface while a modal was open. */
  private outsidePress: { id: number; downTime: number } | null = null;
  /** HUD button to reopen the night summary after closing it. */
  private summaryBtn!: Phaser.GameObjects.Container;
  /** Persistent Dormir while phase===summary and the summary panel is closed (never trap the player). */
  private sleepHudBtn!: Phaser.GameObjects.Container;

  // ---- Draggable windows (title bar = drag handle; positions remembered for the session) ----
  private dragWins: DragWin[] = [];
  private winPos = new Map<string, { x: number; y: number }>();
  private winDrag: { win: DragWin; pid: number; downTime: number; offX: number; offY: number } | null = null;
  /** downTime of the last press that dragged a window (ClubScene must never treat it as a world tap). */
  lastWinDragDownTime = -1;
  private furnFlipBtn!: Phaser.GameObjects.Container;
  private furnActionsBtnW = 118;

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
    this.hudBg = hudBg;

    // Shared backdrop for centered modals. Depth -1 keeps it under the HUD so the
    // bottom/top buttons still work (e.g. Staff <-> Inventario switch) while it
    // swallows taps on the club and closes the window instead.
    this.modalBackdrop = this.add
      .rectangle(0, 0, 8000, 8000, 0x000000, 0.25)
      .setScrollFactor(0)
      .setDepth(-1)
      .setVisible(false)
      .setInteractive();

    this.moneyText = this.add
      .text(16, 14, 'Dinero: $40', {
        fontSize: '18px',
        color: '#ffe066',
        fontStyle: 'bold',
      })
      .setScrollFactor(0);

    this.timerText = this.add
      .text(cam.width / 2, 14, '17:00', {
        fontSize: '18px',
        color: '#f0e6ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.scheduleText = this.add
      .text(cam.width / 2, 34, 'Horario sugerido: Lun–Dom · 18:00 — 02:00', {
        fontSize: '11px',
        color: '#9a80b0',
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
    this.summaryBtn = this.makeButton(cam.width - 150, 8, 130, 36, 'Ver resumen', () => {
      this.reopenSummary();
    });
    this.summaryBtn.setVisible(false);
    this.sleepHudBtn = this.makeButton(cam.width - 150, 48, 130, 36, 'Dormir', () => {
      if (this.buildMode) return;
      if (this.phase !== 'summary') return;
      this.summary.setVisible(false);
      this.game.events.emit('cmd-sleep');
    });
    this.sleepHudBtn.setVisible(false);

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
      .text(-250, 58, '', { fontSize: '14px', color: '#e8d0ff', lineSpacing: 6, wordWrap: { width: 236 } })
      .setOrigin(0, 0);

    this.panelPortrait = this.add
      .image(-60, 78, 'luna_portrait')
      .setDisplaySize(56, 56)
      .setVisible(false);

    this.energyLabel = this.add.text(-250, 200, 'Energía', { fontSize: '12px', color: '#a080c0' });
    this.moodLabel = this.add.text(-250, 240, 'Ánimo', { fontSize: '12px', color: '#a080c0' });
    const eBg = this.add.rectangle(-250, 220, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    const mBg = this.add.rectangle(-250, 260, 220, 12, 0x2a1838).setOrigin(0, 0.5);
    this.panelEBg = eBg;
    this.panelMBg = mBg;
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
    // Opens the staff context menu for this item (touch-friendly path to RMB actions).
    this.furnActionsBtn = this.makeLocalButton(-250, 226, this.furnActionsBtnW, 34, 'Acciones', () => {
      if (!this.furnSelectedId) return;
      this.game.events.emit('cmd-open-furniture-actions', { furnitureId: this.furnSelectedId });
    });
    this.furnPanel.add(this.furnActionsBtn);
    // Voltear: normal ↔ mirror (the only two orientations — no rotation control exists).
    this.furnFlipBtn = this.makeLocalButton(-124, 226, 96, 34, '⇋ Voltear', () => {
      if (!this.furnSelectedId) return;
      this.game.events.emit('cmd-flip-furniture', { id: this.furnSelectedId });
    });
    this.furnFlipBtn.setName('furnFlip');
    this.furnPanel.add(this.furnFlipBtn);

    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-ESC', () => {
        // Pause menu is the topmost layer: ESC = back (subpanel) or CONTINUAR (main panel).
        if (this.pauseOpen) {
          if (this.pauseView === 'loading') return;
          if (this.pauseView === 'main') this.closePause();
          else if (this.pauseView === 'overwrite') this.renderPauseView('save');
          else this.renderPauseView('main');
          return;
        }
        if (!this.scene.isActive('ClubScene')) return;
        if (this.gameOverVisible) {
          this.openPause();
          return;
        }
        // Same stacking as outside/right-click: topmost window first.
        if (this.dismissTopmost()) return;
        if (this.buildMode) {
          this.game.events.emit('cmd-set-build-mode', false);
          return;
        }
        // Nothing open: ESC opens the pause menu.
        this.openPause();
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
    // B10: primary action is Dormir (ends day). Abrir noche is on the HUD after waking.
    this.summarySleep = this.makeLocalButton(-100, 0, 200, 40, 'Dormir', () => {
      if (this.buildMode) return;
      this.summary.setVisible(false);
      this.game.events.emit('cmd-sleep');
    });
    this.summaryAgain = this.makeLocalButton(-100, 0, 200, 40, 'Abrir noche', () => {
      // Kept hidden; Abrir is HUD-only after Dormir (B10 UX split).
      if (this.buildMode) return;
      this.summary.setVisible(false);
      this.game.events.emit('cmd-open-night');
    });
    this.summaryAgain.setVisible(false);
    this.summaryClose = this.makeLocalButton(0, 0, 36, 32, '✕', () => {
      this.closeSummary();
    });
    this.summary.add([
      this.summaryBg,
      this.summaryTitle,
      this.summaryBody,
      this.summarySleep,
      this.summaryAgain,
      this.summaryClose,
    ]);

    this.createStaffPanel();
    this.createInventoryPanel();
    this.createShopPanel();
    this.createDeleteConfirm();
    this.createInterventionUi();
    this.setupWindowDismiss();

    this.game.events.on('club-ready', this.onStats, this);
    this.game.events.on('stats-updated', this.onStats, this);
    this.game.events.on('night-started', this.onNightStarted, this);
    this.game.events.on('night-closing', this.onNightClosing, this);
    this.game.events.on('night-summary', this.onSummary, this);
    this.game.events.on('day-started', this.onDayStarted, this);
    this.game.events.on('game-over', this.onGameOver, this);
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
    this.game.events.on('order-result', this.onOrderResult, this);
    this.game.events.on('select-furniture', this.onSelectFurniture, this);
    this.game.events.on('furniture-deselected', this.onFurnitureDeselected, this);
    this.game.events.on('ui-delete-confirm', this.onDeleteConfirm, this);
    this.game.events.on('ui-delete-confirm-hide', this.hideDeleteConfirm, this);

    this.scale.on('resize', this.onResize, this);
    this.refreshBuildButtons();
    this.createPauseUi();
    this.game.events.emit('cmd-request-staff-roster');
    this.uiReady = true;
    this.game.events.emit('ui-ready');
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
      // Right/middle click never activates buttons (right-click = close window)
      if (!this.isPrimaryPress(p)) return;
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
      // Right/middle click never activates buttons (right-click = close window)
      if (!this.isPrimaryPress(p)) return;
      p.event.stopPropagation();
      cb();
    });
    c.add([bg, t]);
    return c;
  }



  // ---------------------------------------------------------------------------
  // Direct-intervention UI: toasts, staff context menu, technician list, verdict.
  // ---------------------------------------------------------------------------

  private createInterventionUi(): void {
    this.ctxMenu = this.add.container(0, 0).setScrollFactor(0).setVisible(false).setDepth(9700);
    this.techPanel = this.add.container(0, 0).setScrollFactor(0).setVisible(false).setDepth(9720);
    this.verdictPanel = this.add.container(0, 0).setScrollFactor(0).setVisible(false).setDepth(9740);
    const ev = this.game.events;
    ev.on('ui-toast', this.onUiToast, this);
    ev.on('context-menu-open', this.onContextMenuOpen, this);
    ev.on('repair-tech-list', this.onRepairTechList, this);
    ev.on('repair-verdict', this.onRepairVerdict, this);
    ev.on('repair-hire-failed', this.onRepairHireFailed, this);
    ev.on('repair-ui-close', this.onRepairUiClose, this);
    this.events.once('shutdown', () => {
      ev.off('ui-toast', this.onUiToast, this);
      ev.off('context-menu-open', this.onContextMenuOpen, this);
      ev.off('repair-tech-list', this.onRepairTechList, this);
      ev.off('repair-verdict', this.onRepairVerdict, this);
      ev.off('repair-hire-failed', this.onRepairHireFailed, this);
      ev.off('repair-ui-close', this.onRepairUiClose, this);
    });
  }

  /** Small button with an enabled/disabled look; disabled = grey, no-op. */
  private makeCtxButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    enabled: boolean,
    cb: () => void,
    fontSize = 13
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const base = enabled ? 0x6a2a7a : 0x3a2a48;
    const bg = this.add.rectangle(0, 0, w, h, base, 1).setOrigin(0);
    bg.setStrokeStyle(1, enabled ? 0xff7ac8 : 0x5a4a68);
    bg.setInteractive({ useHandCursor: enabled });
    const t = this.add
      .text(8, h / 2, label, {
        fontSize: `${fontSize}px`,
        color: enabled ? '#ffffff' : '#8a7a9a',
        fontStyle: enabled ? 'bold' : 'normal',
        wordWrap: { width: w - 12 },
      })
      .setOrigin(0, 0.5);
    if (enabled) {
      bg.on('pointerover', () => bg.setFillStyle(0x9a3aa8));
      bg.on('pointerout', () => bg.setFillStyle(base));
    }
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isPrimaryPress(p)) return;
      p.event.stopPropagation();
      if (!enabled) return;
      cb();
    });
    c.add([bg, t]);
    c.setData('enabled', enabled);
    c.setName(label);
    return c;
  }

  private onUiToast = (msg: string): void => {
    if (!msg) return;
    const cam = this.cameras.main;
    const t = this.add
      .text(cam.width / 2, 0, msg, {
        fontSize: '14px',
        color: '#fff2c4',
        backgroundColor: '#2a1238ee',
        padding: { x: 10, y: 5 },
        align: 'center',
        wordWrap: { width: Math.min(440, cam.width - 30) },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(9900);
    this.toasts.push(t);
    while (this.toasts.length > 4) this.toasts.shift()?.destroy();
    this.layoutToasts();
    this.toastLog.push(msg);
    if (this.toastLog.length > 30) this.toastLog.shift();
    this.time.delayedCall(3200, () => {
      this.tweens.add({
        targets: t,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          this.toasts = this.toasts.filter((x) => x !== t);
          t.destroy();
          this.layoutToasts();
        },
      });
    });
  };

  private layoutToasts(): void {
    const cam = this.cameras.main;
    let y = 66;
    for (const t of this.toasts) {
      if (!t.active) continue;
      t.setPosition(cam.width / 2, y);
      y += t.height + 4;
    }
  }

  private onContextMenuOpen = (m: ContextMenuPayload): void => {
    if (this.buildMode || !m) return;
    this.ctxPayload = m;
    this.buildCtxMenu();
    this.ctxMenuVisible = true;
    this.ctxMenu.setVisible(true);
    this.syncModalBackdrop();
  };

  private buildCtxMenu(): void {
    const m = this.ctxPayload;
    if (!m) return;
    this.ctxMenu.removeAll(true);
    const cam = this.cameras.main;
    const n = Math.max(1, m.actions.length);
    const cols = n > 7 && cam.width >= 380 ? 2 : 1;
    const bw = cols === 2 ? Math.min(170, Math.floor((cam.width - 40) / 2)) : 220;
    const bh = 28;
    const gap = 5;
    const rows = Math.ceil(n / cols);
    const chips = m.staffOptions.length > 1;
    const w = cols * bw + (cols - 1) * gap + 20;
    const headerH = 48 + (chips ? 30 : 0);
    const h = headerH + rows * (bh + gap) + 8;
    const bg = this.add.rectangle(0, 0, w, h, 0x1a0e28, 0.97).setOrigin(0);
    bg.setStrokeStyle(2, 0xffb84d);
    bg.setInteractive();
    const title = this.add.text(10, 7, m.title, { fontSize: '15px', color: '#ffd27a', fontStyle: 'bold' });
    const sub = this.add.text(10, 27, m.subtitle, {
      fontSize: '11px',
      color: '#c8a0e0',
      wordWrap: { width: w - 50 },
    });
    const close = this.makeLocalButton(w - 32, 5, 26, 22, '✕', () => this.hideCtxMenu());
    this.ctxMenu.add([bg, title, sub, close]);
    if (chips) {
      let cx = 10;
      for (const o of m.staffOptions) {
        const active = o.id === m.staffId;
        const chip = this.makeCtxButton(cx, 48, 76, 24, active ? `● ${o.name}` : o.name, true, () => {
          if (active) return;
          this.game.events.emit('cmd-context-menu-staff', { staffId: o.id });
        }, 12);
        chip.setAlpha(active ? 1 : 0.6);
        this.ctxMenu.add(chip);
        cx += 82;
      }
    }
    if (!m.actions.length) {
      this.ctxMenu.add(
        this.add.text(10, headerH + 6, 'No hay acciones disponibles.', { fontSize: '12px', color: '#8a7a9a' })
      );
    }
    m.actions.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const label = a.enabled || !a.hint ? a.label : `${a.label} · ${a.hint}`;
      const btn = this.makeCtxButton(
        10 + col * (bw + gap),
        headerH + row * (bh + gap),
        bw,
        bh,
        label,
        a.enabled,
        () => {
          const p = this.ctxPayload;
          this.hideCtxMenu();
          if (!p) return;
          this.game.events.emit('cmd-staff-action', { staffId: p.staffId, target: p.target, actionId: a.id });
        },
        cols === 2 ? 11 : 12
      );
      btn.setData('actionId', a.id);
      this.ctxMenu.add(btn);
    });
    const x = Phaser.Math.Clamp(m.x + 14, 6, Math.max(6, cam.width - w - 6));
    const y = Phaser.Math.Clamp(m.y - 12, 58, Math.max(58, cam.height - h - 6));
    this.ctxMenu.setPosition(x, y);
  }

  private hideCtxMenu(): void {
    this.ctxMenuVisible = false;
    this.ctxMenu.setVisible(false);
    this.syncModalBackdrop();
  }

  private onRepairTechList = (p: TechListPayload): void => {
    if (!p) return;
    this.hideCtxMenu();
    this.techPayload = p;
    this.techPanel.removeAll(true);
    const cam = this.cameras.main;
    const w = Math.min(380, cam.width - 20);
    const rowH = 58;
    const top = 92;
    const h = top + p.techs.length * rowH + 36;
    const bg = this.add.rectangle(0, 0, w, h, 0x140a22, 0.97).setOrigin(0);
    bg.setStrokeStyle(2, 0x2ad6ff);
    bg.setInteractive();
    const title = this.add.text(12, 10, 'Solicitar técnico', { fontSize: '18px', color: '#7ad7ff', fontStyle: 'bold' });
    const sub = this.add.text(12, 36, `${p.staffName}: “Hay que llamar a alguien para ${p.furnitureName}.”`, {
      fontSize: '12px',
      color: '#e8d0ff',
      wordWrap: { width: w - 24 },
    });
    const note = this.add.text(12, 70, `La consulta se paga cuando llega el técnico · Dinero: $${p.money}`, {
      fontSize: '11px',
      color: '#a080c0',
    });
    const close = this.makeLocalButton(w - 42, 8, 34, 28, '✕', () => this.hideTechPanel());
    this.techPanel.add([bg, title, sub, note, close]);
    p.techs.forEach((t, i) => {
      const y = top + i * rowH;
      const line = this.add.rectangle(12, y - 4, w - 24, 1, 0x3a2a58).setOrigin(0);
      const name = this.add.text(12, y + 2, t.name, { fontSize: '15px', color: '#ffffff', fontStyle: 'bold' });
      const stars = this.add.text(12, y + 20, `Reputación: ${'★'.repeat(t.stars)}${'☆'.repeat(Math.max(0, 5 - t.stars))}`, {
        fontSize: '12px',
        color: '#ffd27a',
      });
      const fee = this.add.text(12, y + 36, `Consulta: $${t.fee}`, { fontSize: '12px', color: '#e8d0ff' });
      const btn = this.makeCtxButton(
        w - 118,
        y + 6,
        106,
        34,
        t.canAfford ? 'Contratar' : 'Fondos insuficientes.',
        t.canAfford,
        () => {
          const pp = this.techPayload;
          this.hideTechPanel();
          if (!pp) return;
          this.game.events.emit('cmd-hire-technician', { furnitureId: pp.furnitureId, techId: t.id });
        },
        t.canAfford ? 13 : 10
      );
      btn.setData('techId', t.id);
      this.techPanel.add([line, name, stars, fee, btn]);
    });
    const hint = this.add.text(12, h - 26, 'La reputación es orientativa: ningún técnico es infalible.', {
      fontSize: '10px',
      color: '#8a7a9a',
    });
    this.techPanel.add(hint);
    this.techPanel.setPosition(Math.round((cam.width - w) / 2), Math.round(Math.max(60, (cam.height - h) / 2)));
    this.applySavedWinPos('techList');
    this.techVisible = true;
    this.techPanel.setVisible(true);
    this.syncModalBackdrop();
  };

  private hideTechPanel(): void {
    this.techVisible = false;
    this.techPanel.setVisible(false);
    this.syncModalBackdrop();
  }

  private onRepairVerdict = (p: RepairVerdictPayload): void => {
    if (!p) return;
    this.verdictPayload = p;
    this.verdictPanel.removeAll(true);
    const cam = this.cameras.main;
    const w = Math.min(360, cam.width - 20);
    const h = 244;
    const bg = this.add.rectangle(0, 0, w, h, 0x140a22, 0.97).setOrigin(0);
    bg.setStrokeStyle(2, 0xffb84d);
    bg.setInteractive();
    const title = this.add.text(12, 10, `${p.techName} terminó la inspección.`, {
      fontSize: '16px',
      color: '#ffd27a',
      fontStyle: 'bold',
      wordWrap: { width: w - 60 },
    });
    const body = this.add.text(
      12,
      title.y + title.height + 10,
      // Only diagnosis + repair cost: no new-item price, no money comparison (the player decides).
      `${p.furnitureName}: ${p.diagnosis}\n\nReparación: $${p.cost}`,
      { fontSize: '13px', color: '#f0e0ff', lineSpacing: 4, wordWrap: { width: w - 24 } }
    );
    const close = this.makeLocalButton(w - 42, 8, 34, 28, '✕', () => this.dismissVerdict());
    const bw = Math.floor((w - 36) / 2);
    const rep = this.makeCtxButton(12, h - 50, bw, 38, p.canAfford ? 'REPARAR' : 'REPARAR · Fondos insuficientes.', p.canAfford, () => {
      this.closeVerdictPanel();
      this.game.events.emit('cmd-repair-decision', { jobId: p.jobId, repair: true });
    }, p.canAfford ? 14 : 10);
    rep.setData('verdict', 'repair');
    const no = this.makeCtxButton(24 + bw, h - 50, bw, 38, 'NO REPARAR', true, () => this.dismissVerdict(), 14);
    no.setData('verdict', 'no');
    this.verdictPanel.add([bg, title, body, close, rep, no]);
    this.verdictPanel.setPosition(Math.round((cam.width - w) / 2), Math.round(Math.max(60, (cam.height - h) / 2)));
    this.applySavedWinPos('repairVerdict');
    this.verdictVisible = true;
    this.verdictPanel.setVisible(true);
    this.syncModalBackdrop();
  };

  /** Any dismiss path on the verdict (✕, outside, right-click, ESC) = NO REPARAR. */
  private dismissVerdict(): void {
    const p = this.verdictPayload;
    this.closeVerdictPanel();
    if (p) this.game.events.emit('cmd-repair-decision', { jobId: p.jobId, repair: false });
  }

  private closeVerdictPanel(): void {
    this.verdictVisible = false;
    this.verdictPanel.setVisible(false);
    this.verdictPayload = null;
    this.syncModalBackdrop();
  }

  private onRepairHireFailed = (p: { reason?: string }): void => {
    this.onUiToast(p?.reason ?? 'Fondos insuficientes.');
  };

  private onRepairUiClose = (): void => {
    if (this.techVisible) this.hideTechPanel();
    if (this.verdictVisible) this.closeVerdictPanel();
  };

  /** Playwright/debug: what the intervention UI is showing. */
  getInterventionUiDebug(): {
    ctxOpen: boolean;
    ctxTitle: string;
    ctxActions: Array<{ id: string; label: string; enabled: boolean }>;
    techOpen: boolean;
    techs: Array<{ id: string; canAfford: boolean }>;
    verdictOpen: boolean;
    verdict: RepairVerdictPayload | null;
    toasts: string[];
  } {
    return {
      ctxOpen: this.ctxMenuVisible,
      ctxTitle: this.ctxPayload?.title ?? '',
      ctxActions: (this.ctxPayload?.actions ?? []).map((a) => ({ id: a.id, label: a.label, enabled: a.enabled })),
      techOpen: this.techVisible,
      techs: (this.techPayload?.techs ?? []).map((t) => ({ id: t.id, canAfford: t.canAfford })),
      verdictOpen: this.verdictVisible,
      verdict: this.verdictPayload,
      toasts: [...this.toastLog],
    };
  }

  /** Debug: press a context-menu action button exactly like a click would. */
  debugPressCtxAction(actionId: string): boolean {
    const p = this.ctxPayload;
    if (!this.ctxMenuVisible || !p) return false;
    const a = p.actions.find((x) => x.id === actionId);
    if (!a || !a.enabled) return false;
    this.hideCtxMenu();
    this.game.events.emit('cmd-staff-action', { staffId: p.staffId, target: p.target, actionId });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Shared window dismiss: ✕ (per-window button), tap/click outside, right-click.
  // ---------------------------------------------------------------------------

  /** Left mouse button or any touch. Right/middle mouse clicks are not "presses". */
  private isPrimaryPress(p: Phaser.Input.Pointer): boolean {
    return p.wasTouch || p.button === 0;
  }

  /** Desktop right-click (never true on touch). */
  private isRightClick(p: Phaser.Input.Pointer): boolean {
    return !p.wasTouch && (p.button === 2 || p.rightButtonDown());
  }

  /** Register every overlay window once; all close paths go through this list. */
  private setupWindowDismiss(): void {
    const reg = (w: DismissWin) => this.dismissWins.push(w);
    reg({
      key: 'deleteConfirm',
      root: this.deleteConfirm,
      kind: 'modal',
      isOpen: () => this.deleteConfirmVisible,
      // Outside / right-click on the confirm = "No" (never deletes)
      close: () => this.handleDeleteConfirmChoice(false),
    });
    reg({ key: 'shop', root: this.shopPanel, kind: 'modal', isOpen: () => this.shopPanelVisible, close: () => this.hideShopPanel() });
    reg({ key: 'inventory', root: this.inventoryPanel, kind: 'modal', isOpen: () => this.inventoryPanelVisible, close: () => this.hideInventoryPanel() });
    // Order confirm sits above the inventory: dismissing it = "Cancelar" (never pays).
    reg({ key: 'orderConfirm', root: this.orderConfirm, kind: 'modal', isOpen: () => this.orderConfirmVisible, close: () => this.hideOrderConfirm() });
    reg({ key: 'staff', root: this.staffPanel, kind: 'modal', isOpen: () => this.staffPanelVisible, close: () => this.hideStaffPanel() });
    reg({
      key: 'furniture',
      root: this.furnPanel,
      kind: 'side',
      isOpen: () => this.furnPanelVisible,
      close: () => {
        this.hideFurnPanel();
        this.game.events.emit('cmd-deselect-furniture');
      },
    });
    reg({ key: 'npc', root: this.panel, kind: 'side', isOpen: () => this.panelVisible, close: () => this.hidePanel() });
    reg({ key: 'summary', root: this.summary, kind: 'modal', isOpen: () => this.summary.visible, close: () => this.closeSummary() });
    // Intervention windows (registered last = stack on top of everything above).
    reg({ key: 'techList', root: this.techPanel, kind: 'modal', isOpen: () => this.techVisible, close: () => this.hideTechPanel() });
    reg({ key: 'repairVerdict', root: this.verdictPanel, kind: 'modal', isOpen: () => this.verdictVisible, close: () => this.dismissVerdict() });
    reg({ key: 'ctxMenu', root: this.ctxMenu, kind: 'modal', isOpen: () => this.ctxMenuVisible, close: () => this.hideCtxMenu() });

    // Browser context menu off on the canvas so right-click can close windows.
    this.input.mouse?.disableContextMenu();
    this.setupDraggableWindows();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.outsidePress = null;
      if (this.pauseOpen) return; // paused: windows underneath are inert (no right-click/outside close)
      if (this.gameOverVisible) return; // game over: nothing closes it except Nueva partida
      if (this.isRightClick(p)) {
        if (this.handleRightClickDismiss(over)) this.lastRightDismissDownTime = p.downTime;
        return;
      }
      if (!this.isPrimaryPress(p)) return;
      if (!this.topmostOpen('modal')) return;
      if (over.every((o) => this.isOutsideSurface(o))) {
        this.outsidePress = { id: p.id, downTime: p.downTime };
      }
    });

    // Close on release (not press) so the same tap never falls through to the club.
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const press = this.outsidePress;
      this.outsidePress = null;
      if (this.pauseOpen) return;
      if (!press || press.id !== p.id || press.downTime !== p.downTime) return;
      if (!over.every((o) => this.isOutsideSurface(o))) return;
      if (p.getDistance() > OUTSIDE_TAP_SLOP) return; // drag, not a tap
      const top = this.topmostOpen('modal');
      if (!top) return;
      top.close();
      this.syncModalBackdrop();
    });
  }

  // ---------------------------------------------------------------------------
  // Draggable windows: press the title bar, drag, release — the window stays there.
  // Never moves the camera / scene and never selects anything underneath.
  // ---------------------------------------------------------------------------

  private setupDraggableWindows(): void {
    const firstRect = (c: Phaser.GameObjects.Container) => () =>
      (c.list.find((o) => o instanceof Phaser.GameObjects.Rectangle && o.name !== 'dragHandle') as
        | Phaser.GameObjects.Rectangle
        | undefined) ?? null;
    const reg = (key: string, posKey: string, root: Phaser.GameObjects.Container, handleH: number, closeW = 50) => {
      const w: DragWin = { key, posKey, root, bg: firstRect(root), handleH, closeW };
      this.dragWins.push(w);
      this.ensureDragHandle(w);
    };
    // Selection windows share one slot ('selection'): Luna → Nova → mesa keep the dragged spot.
    reg('npc', 'selection', this.panel, 40);
    reg('furniture', 'selection', this.furnPanel, 40);
    reg('inventory', 'inventory', this.inventoryPanel, 40);
    reg('staff', 'staff', this.staffPanel, 44);
    reg('shop', 'shop', this.shopPanel, 40);
    reg('summary', 'summary', this.summary, 46);
    reg('techList', 'techList', this.techPanel, 34);
    reg('repairVerdict', 'repairVerdict', this.verdictPanel, 34);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.winDrag;
      if (!d || d.pid !== p.id) return;
      if (!p.isDown) {
        this.endWinDrag(p);
        return;
      }
      d.win.root.setPosition(p.x - d.offX, p.y - d.offY);
      this.clampWin(d.win);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.endWinDrag(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.endWinDrag(p));
  }

  /** (Re)create the title-bar handle (tech/verdict windows are rebuilt with removeAll). */
  private ensureDragHandle(w: DragWin): void {
    if (w.handle && w.handle.active && w.handle.parentContainer === w.root) return;
    const handle = this.add.rectangle(0, 0, 10, w.handleH, 0x3a2058, 0.9).setOrigin(0, 0);
    handle.setName('dragHandle');
    handle.setStrokeStyle(1, 0x6a4a8a, 0.8);
    handle.setInteractive({ cursor: 'move' });
    const grip = this.add
      .text(0, 0, '⋮⋮', { fontSize: '14px', color: '#b090d0', fontStyle: 'bold' })
      .setOrigin(1, 0.5)
      .setName('dragGrip');
    handle.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isPrimaryPress(p)) return;
      p.event?.stopPropagation?.();
      this.winDrag = { win: w, pid: p.id, downTime: p.downTime, offX: p.x - w.root.x, offY: p.y - w.root.y };
      this.lastWinDragDownTime = p.downTime;
    });
    // Just above the background: title text / ✕ / content stay on top of the bar.
    const bgIdx = Math.max(0, w.root.list.indexOf(w.bg() as Phaser.GameObjects.GameObject));
    w.root.addAt(handle, bgIdx + 1);
    w.root.addAt(grip, bgIdx + 2);
    w.handle = handle;
    w.grip = grip;
    this.syncDragHandle(w);
  }

  /** Keep the bar on the window's top edge (windows resize when rebuilt). */
  private syncDragHandle(w: DragWin): void {
    const bg = w.bg();
    const h = w.handle;
    if (!bg || !h || !h.active) return;
    const left = bg.x - bg.width * bg.originX;
    const top = bg.y - bg.height * bg.originY;
    const width = Math.max(40, bg.width - 4 - w.closeW);
    if (h.x !== left + 2 || h.y !== top + 2) h.setPosition(left + 2, top + 2);
    if (h.width !== width) h.setSize(width, w.handleH);
    const hit = h.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (hit && (hit.width !== width || hit.height !== w.handleH)) hit.setSize(width, w.handleH);
    // Same for the window background: a resized bg must swallow clicks over its whole area.
    const bhit = bg.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (bhit && (bhit.width !== bg.width || bhit.height !== bg.height)) bhit.setSize(bg.width, bg.height);
    w.grip?.setPosition(left + 2 + width - 6, top + 2 + w.handleH / 2);
  }

  /** Window rect relative to its container origin (from its background rectangle). */
  private winLocalRect(w: DragWin): { left: number; top: number; right: number; bottom: number } | null {
    const bg = w.bg();
    if (!bg) return null;
    const left = bg.x - bg.width * bg.originX;
    const top = bg.y - bg.height * bg.originY;
    return { left, top, right: left + bg.width, bottom: top + bg.height };
  }

  /** Keep the window on screen (if it is bigger than the screen, keep its title bar reachable). */
  private clampWin(w: DragWin): void {
    const r = this.winLocalRect(w);
    if (!r) return;
    const cam = this.cameras.main;
    const ww = r.right - r.left;
    const wh = r.bottom - r.top;
    let x = w.root.x;
    let y = w.root.y;
    if (ww <= cam.width) x = Phaser.Math.Clamp(x, -r.left, cam.width - r.right);
    else x = Phaser.Math.Clamp(x, cam.width - r.right, -r.left);
    if (wh <= cam.height) y = Phaser.Math.Clamp(y, -r.top, cam.height - r.bottom);
    else y = Phaser.Math.Clamp(y, -r.top - (wh - w.handleH - 8), -r.top);
    if (x !== w.root.x || y !== w.root.y) w.root.setPosition(x, y);
  }

  private endWinDrag(p: Phaser.Input.Pointer): void {
    const d = this.winDrag;
    if (!d || d.pid !== p.id) return;
    this.winDrag = null;
    this.lastWinDragDownTime = d.downTime;
    this.clampWin(d.win);
    this.winPos.set(d.win.posKey, { x: d.win.root.x, y: d.win.root.y });
  }

  /** After a window took its default spot: move it to where the player left it this session. */
  private applySavedWinPos(key: string): void {
    const w = this.dragWins.find((x) => x.key === key);
    if (!w) return;
    this.ensureDragHandle(w);
    this.syncDragHandle(w);
    if (this.winDrag?.win === w) return;
    const saved = this.winPos.get(w.posKey);
    if (saved) w.root.setPosition(saved.x, saved.y);
    this.clampWin(w);
  }

  /** Screen rect of an open draggable window (null when hidden). */
  private winScreenRect(key: string): Phaser.Geom.Rectangle | null {
    const w = this.dragWins.find((x) => x.key === key);
    if (!w || !w.root.visible) return null;
    const r = this.winLocalRect(w);
    if (!r) return null;
    return new Phaser.Geom.Rectangle(w.root.x + r.left, w.root.y + r.top, r.right - r.left, r.bottom - r.top);
  }

  /** Playwright/debug: window positions + drag-handle rects in screen px. */
  getWindowDebug() {
    const out: Record<string, unknown> = {};
    for (const w of this.dragWins) {
      const r = this.winScreenRect(w.key);
      const h = w.handle;
      out[w.key] = {
        visible: w.root.visible,
        x: w.root.x,
        y: w.root.y,
        rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        handle:
          h && h.active && w.root.visible
            ? { x: w.root.x + h.x, y: w.root.y + h.y, w: h.width, h: h.height }
            : null,
        saved: this.winPos.get(w.posKey) ?? null,
      };
    }
    return {
      wins: out,
      dragging: this.winDrag?.win.key ?? null,
      npcOpen: this.panelVisible,
      furnOpen: this.furnPanelVisible,
      npcName: this.selectedNpc?.name ?? null,
      furnId: this.furnSelectedId,
      furnName: this.inspectedFurniture?.name ?? null,
    };
  }

  /** Empty space around a modal: the shared backdrop, the delete dim or the HUD bar. */
  private isOutsideSurface(o: Phaser.GameObjects.GameObject): boolean {
    return o === this.modalBackdrop || o === this.hudBg || o.name === 'deleteDim';
  }

  /** Open windows, topmost first (delete confirm, then by depth; ties = registration order). */
  private openWindowsTopFirst(kind?: DismissWin['kind']): DismissWin[] {
    return this.dismissWins
      .filter((w) => w.isOpen() && (!kind || w.kind === kind))
      .map((w, i) => ({ w, i }))
      .sort((a, b) => {
        if (a.w.key === 'deleteConfirm') return -1;
        if (b.w.key === 'deleteConfirm') return 1;
        return b.w.root.depth - a.w.root.depth || a.i - b.i;
      })
      .map((e) => e.w);
  }

  private topmostOpen(kind?: DismissWin['kind']): DismissWin | null {
    return this.openWindowsTopFirst(kind)[0] ?? null;
  }

  /** Close only the topmost window (nested confirm closes before the shop underneath). */
  private dismissTopmost(kind?: DismissWin['kind']): boolean {
    const top = this.topmostOpen(kind);
    if (!top) return false;
    top.close();
    this.syncModalBackdrop();
    return true;
  }

  /** Which registered window (if any) a hit object belongs to. */
  private windowForObject(o: Phaser.GameObjects.GameObject): DismissWin | null {
    let cur: Phaser.GameObjects.GameObject | null = o;
    while (cur) {
      const hit = this.dismissWins.find((w) => w.root === cur);
      if (hit) return hit;
      cur = (cur as Phaser.GameObjects.GameObject & { parentContainer?: Phaser.GameObjects.Container | null })
        .parentContainer ?? null;
    }
    return null;
  }

  /** PC right-click: on a window → close that window; elsewhere → close topmost modal. */
  private handleRightClickDismiss(over: Phaser.GameObjects.GameObject[]): boolean {
    const order = this.openWindowsTopFirst();
    if (!order.length) return false;
    const hitWins = new Set(over.map((o) => this.windowForObject(o)).filter((w): w is DismissWin => !!w));
    const target = order.find((w) => hitWins.has(w)) ?? this.topmostOpen('modal');
    if (!target) return false;
    target.close();
    this.syncModalBackdrop();
    return true;
  }

  /** Backdrop only behind centered modals (delete confirm has its own dim). */
  private syncModalBackdrop(): void {
    if (!this.modalBackdrop) return;
    const open = this.dismissWins.filter((w) => w.kind === 'modal' && w.key !== 'deleteConfirm' && w.isOpen());
    const show = open.length > 0;
    if (this.modalBackdrop.visible !== show) this.modalBackdrop.setVisible(show);
    // A context menu alone should not dim the club (it is a small popover).
    const alpha = show && open.every((w) => w.key === 'ctxMenu') ? 0.01 : this.modalBackdropAlpha;
    if (this.modalBackdrop.fillAlpha !== alpha) this.modalBackdrop.setFillStyle(this.modalBackdrop.fillColor, alpha);
  }

  update(): void {
    this.syncModalBackdrop();
    for (const w of this.dragWins) {
      if (!w.root.visible) continue;
      this.ensureDragHandle(w);
      this.syncDragHandle(w);
    }
  }

  /** Hide the night summary without sleeping; HUD "Ver resumen" brings it back. */
  private closeSummary(): void {
    this.summary.setVisible(false);
    this.refreshBuildButtons();
  }

  private reopenSummary(): void {
    if (this.phase !== 'summary' || !this.lastSummaryBody) return;
    this.layoutSummary(this.lastSummaryBody);
    this.summary.setVisible(true);
    this.refreshBuildButtons();
  }

  /** Bottom-right NPC panel position (responsive). */
  private layoutNpcPanel(w: number, h: number): void {
    this.panel.setPosition(w - 20, h - PANEL_BOTTOM_MARGIN - PANEL_H);
  }

  // ---------------------------------------------------------------------------
  // PAUSA: real simulation pause (ClubScene paused → its clock, update loop, timers, tweens and
  // input all stop) + classic pause menu. One layer, subpanels replace its content.
  // ---------------------------------------------------------------------------

  private pauseBtn!: Phaser.GameObjects.Container;
  private pauseLayer?: Phaser.GameObjects.Container;
  private pausePanel?: Phaser.GameObjects.Container;
  /** True while the pause menu is open (simulation frozen). */
  pauseOpen = false;
  private pauseView: PauseView = 'main';
  private pauseViewArg: number | null = null;
  private pauseStatus = '';
  private pauseButtons: { label: string; x: number; y: number; w: number; h: number; enabled: boolean }[] = [];
  /** downTime of the last press that hit the pause UI (ClubScene must never treat it as a world tap). */
  lastPauseUiDownTime = -1;
  uiReady = false;

  private createPauseUi(): void {
    const cam = this.cameras.main;
    this.pauseBtn = this.makeButton(cam.width - PAUSE_BTN_RIGHT, 8, 62, 36, 'PAUSA', () => this.openPause());
    this.pauseBtn.setDepth(25000).setName('pauseBtn');
    (this.pauseBtn.getByName('label') as Phaser.GameObjects.Text | null)?.setFontSize(13);
    this.pauseBtn.list.forEach((o) => {
      if (o instanceof Phaser.GameObjects.Rectangle) o.on('pointerdown', (p: Phaser.Input.Pointer) => (this.lastPauseUiDownTime = p.downTime));
    });

    const layer = this.add.container(0, 0).setScrollFactor(0).setDepth(30000).setVisible(false).setName('pauseLayer');
    const dim = this.add.rectangle(0, 0, 8000, 8000, 0x000000, 0.45).setOrigin(0).setName('pauseDim');
    dim.setInteractive();
    // Outside the panel does nothing (never unpauses by accident); it only swallows the press.
    dim.on('pointerdown', (p: Phaser.Input.Pointer) => (this.lastPauseUiDownTime = p.downTime));
    const panel = this.add.container(0, 0);
    layer.add([dim, panel]);
    this.pauseLayer = layer;
    this.pausePanel = panel;
    this.game.events.on('save-result', this.onSaveResult, this);
    this.events.once('shutdown', () => this.game.events.off('save-result', this.onSaveResult, this));
  }

  openPause(): void {
    if (this.pauseOpen || !this.pauseLayer) return; // single instance: never stack
    this.pauseOpen = true;
    this.outsidePress = null;
    if (this.winDrag) this.winDrag = null;
    if (this.scene.isActive('ClubScene')) this.scene.pause('ClubScene');
    this.pauseLayer.setVisible(true);
    this.pauseBtn.setVisible(false);
    this.renderPauseView('main');
  }

  /** CONTINUAR: close the menu and resume the simulation from the exact same instant. */
  closePause(): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.pauseLayer?.setVisible(false);
    this.pauseBtn.setVisible(true);
    this.pauseStatus = '';
    if (this.scene.isPaused('ClubScene')) this.scene.resume('ClubScene');
  }

  private onSaveResult = (r: { slot?: number; ok?: boolean }): void => {
    this.pauseStatus = r?.ok ? `Partida guardada en Ranura ${r.slot}.` : 'No se pudo guardar la partida.';
    if (this.pauseOpen && (this.pauseView === 'save' || this.pauseView === 'overwrite')) this.renderPauseView('save');
  };

  private pauseButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    cb: () => void,
    opts: { enabled?: boolean; fontSize?: number; color?: number; align?: 'center' | 'left' } = {}
  ): Phaser.GameObjects.Container {
    const enabled = opts.enabled !== false;
    const base = opts.color ?? 0xb43282;
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, enabled ? base : 0x3a2a44, 1).setOrigin(0);
    bg.setStrokeStyle(1, enabled ? 0xff7ac8 : 0x5a4a66);
    const t = this.add
      .text(opts.align === 'left' ? 12 : w / 2, h / 2, label, {
        fontSize: `${opts.fontSize ?? 15}px`,
        color: enabled ? '#ffffff' : '#9a8aa8',
        fontStyle: 'bold',
        align: opts.align === 'left' ? 'left' : 'center',
        lineSpacing: 2,
      })
      .setOrigin(opts.align === 'left' ? 0 : 0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: enabled });
    // Fire on release of a press that STARTED on this button (never the opener's tail).
    let pressed = -1;
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.lastPauseUiDownTime = p.downTime;
      if (!this.isPrimaryPress(p)) return;
      pressed = p.downTime;
    });
    bg.on('pointerout', () => {
      if (enabled) bg.setFillStyle(base);
    });
    bg.on('pointerover', () => {
      if (enabled) bg.setFillStyle(0xd44a9a);
    });
    bg.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!enabled || pressed < 0 || p.downTime !== pressed) return;
      pressed = -1;
      cb();
    });
    return c;
  }

  private renderPauseView(view: PauseView, arg: number | null = null): void {
    const panel = this.pausePanel;
    if (!panel) return;
    if (view !== 'save' && view !== 'overwrite') this.pauseStatus = '';
    this.pauseView = view;
    this.pauseViewArg = arg;
    panel.removeAll(true);
    this.pauseButtons = [];
    const cam = this.cameras.main;
    const W = Math.min(400, cam.width - 24);
    const bw = Math.min(280, W - 40);
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = 0;
    const text = (s: string, size: number, color: string, bold = false) => {
      const t = this.add
        .text(0, y, s, { fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align: 'center', wordWrap: { width: W - 36 } })
        .setOrigin(0.5, 0);
      items.push(t);
      y += t.height + 10;
      return t;
    };
    const btn = (label: string, cb: () => void, o: { enabled?: boolean; h?: number; w?: number; fontSize?: number; color?: number; align?: 'center' | 'left' } = {}) => {
      const w = o.w ?? bw;
      const h = o.h ?? 40;
      const b = this.pauseButton(-w / 2, y, w, h, label, cb, o);
      items.push(b);
      this.pauseButtons.push({ label, x: -w / 2, y, w, h, enabled: o.enabled !== false });
      y += h + 10;
      return b;
    };
    const slotLine = (s: SlotSummary) =>
      s.empty || !s.meta
        ? `${s.label} — Vacía`
        : `${s.label} — Día ${s.meta.day} · ${s.meta.clock} · ${formatMoney(s.meta.money)}\n${s.meta.phaseLabel} · ${formatSavedAt(s.savedAt)}`;

    y = 18;
    if (view === 'main') {
      text('PAUSA', 26, '#ff3ca0', true);
      text('El juego está detenido.', 13, '#c9b4dc');
      btn('CONTINUAR', () => this.closePause());
      btn('GUARDAR PARTIDA', () => this.renderPauseView('save'));
      btn('CARGAR PARTIDA', () => this.renderPauseView('load'));
      btn('NUEVA PARTIDA', () => this.renderPauseView('confirmNew'));
      btn('OPCIONES', () => this.renderPauseView('options'));
      btn('VOLVER AL TÍTULO', () => this.renderPauseView('confirmTitle'));
    } else if (view === 'save') {
      text('GUARDAR PARTIDA', 22, '#ff3ca0', true);
      text('Elige una ranura.', 13, '#c9b4dc');
      for (const s of listSlots()) {
        const n = Number(s.id);
        btn(slotLine(s), () => (s.empty ? this.game.events.emit('cmd-save-slot', { slot: n }) : this.renderPauseView('overwrite', n)), {
          h: 52,
          w: Math.min(340, W - 30),
          fontSize: 13,
          align: 'left',
          color: s.empty ? 0x5a2a6e : 0xb43282,
        });
      }
      const auto = readAutosaveSummary();
      if (auto?.meta) text(`Autoguardado (inicio de día): Día ${auto.meta.day} · ${formatMoney(auto.meta.money)}`, 12, '#9a80b0');
      if (this.pauseStatus) text(this.pauseStatus, 14, '#7dffb0', true);
      btn('VOLVER', () => this.renderPauseView('main'));
    } else if (view === 'overwrite') {
      const n = arg ?? 1;
      const s = listSlots()[n - 1];
      text(`¿SOBRESCRIBIR RANURA ${n}?`, 20, '#ff3ca0', true);
      text(s && !s.empty && s.meta ? `Se reemplazará: Día ${s.meta.day} · ${s.meta.clock} · ${formatMoney(s.meta.money)}` : '', 13, '#f0e0ff');
      btn('SÍ, SOBRESCRIBIR', () => this.game.events.emit('cmd-save-slot', { slot: n }));
      btn('CANCELAR', () => this.renderPauseView('save'));
    } else if (view === 'load') {
      text('CARGAR PARTIDA', 22, '#ff3ca0', true);
      const slots = listSlots().filter((s) => !s.empty);
      if (!slots.length) {
        y += 6;
        text('NO HAY PARTIDAS GUARDADAS', 17, '#ffd6e0', true);
        y += 6;
      } else {
        text('Elige la partida que quieres cargar.', 13, '#c9b4dc');
        for (const s of slots) {
          btn(slotLine(s), () => this.loadSlotFromMenu(Number(s.id)), { h: 52, w: Math.min(340, W - 30), fontSize: 13, align: 'left' });
        }
      }
      btn('VOLVER', () => this.renderPauseView('main'));
    } else if (view === 'loading') {
      text('Cargando partida…', 20, '#ff3ca0', true);
    } else if (view === 'confirmNew') {
      text('¿COMENZAR UNA NUEVA PARTIDA?', 19, '#ff3ca0', true);
      text('Se perderá el progreso de la partida actual si no está guardado.', 14, '#f0e0ff');
      btn('SÍ, NUEVA PARTIDA', () => {
        this.renderPauseView('loading');
        this.game.events.emit('cmd-new-game');
      });
      btn('CANCELAR', () => this.renderPauseView('main'));
    } else if (view === 'options') {
      text('OPCIONES', 22, '#ff3ca0', true);
      text('Todavía no hay opciones configurables.\nAquí aparecerán cuando el juego las tenga.', 14, '#f0e0ff');
      btn('VOLVER', () => this.renderPauseView('main'));
    } else if (view === 'confirmTitle') {
      text('¿VOLVER AL TÍTULO?', 20, '#ff3ca0', true);
      text('Asegúrate de guardar tu partida antes de salir.', 14, '#f0e0ff');
      btn('SÍ, VOLVER AL TÍTULO', () => this.goToTitle());
      btn('CANCELAR', () => this.renderPauseView('main'));
    }
    const H = y + 8;
    const bg = this.add.rectangle(0, 0, W, H, 0x140a22, 0.97).setOrigin(0.5, 0).setStrokeStyle(2, 0xff3ca0);
    bg.setInteractive(); // panel body swallows presses (never reaches the club)
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => (this.lastPauseUiDownTime = p.downTime));
    panel.add([bg, ...items]);
    this.layoutPause();
  }

  private layoutPause(): void {
    if (!this.pausePanel) return;
    const cam = this.cameras.main;
    const bg = this.pausePanel.list[0] as Phaser.GameObjects.Rectangle | undefined;
    const H = bg ? bg.height : 300;
    this.pausePanel.setPosition(cam.width / 2, Math.max(8, Math.round((cam.height - H) / 2)));
  }

  private loadSlotFromMenu(n: number): void {
    if (!readSlot(n)) {
      this.renderPauseView('load');
      return;
    }
    this.renderPauseView('loading');
    this.game.events.emit('cmd-load-slot', { slot: n });
  }

  /** VOLVER AL TÍTULO: autosave, freeze the club (sleep keeps it intact) and show the title. */
  private goToTitle(): void {
    this.game.events.emit('cmd-autosave-now');
    this.pauseOpen = false;
    this.pauseLayer?.setVisible(false);
    this.pauseBtn.setVisible(true);
    // Sleeping requires a running scene: resume + sleep in the same queued step (no tick between).
    if (this.scene.isPaused('ClubScene')) this.scene.resume('ClubScene');
    this.scene.sleep('ClubScene');
    this.scene.run('TitleScene');
    this.scene.sleep();
  }

  /** Test hook: pause menu state (button rects in UI coords). */
  getPauseDebug() {
    const texts: string[] = [];
    const walk = (o: Phaser.GameObjects.GameObject) => {
      if (o instanceof Phaser.GameObjects.Text) texts.push(o.text);
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(walk);
    };
    if (this.pausePanel) walk(this.pausePanel);
    const px = this.pausePanel?.x ?? 0;
    const py = this.pausePanel?.y ?? 0;
    const layers = this.children.list.filter((o) => o.name === 'pauseLayer').length;
    return {
      open: this.pauseOpen,
      visible: !!this.pauseLayer?.visible,
      view: this.pauseView,
      arg: this.pauseViewArg,
      layers,
      texts,
      buttons: this.pauseButtons.map((b) => ({ ...b, x: b.x + px, y: b.y + py })),
      pauseBtn: { x: this.pauseBtn.x, y: this.pauseBtn.y, w: 62, h: 36, visible: this.pauseBtn.visible },
    };
  }

  isPointerOnUi(p: Phaser.Input.Pointer): boolean {
    const h = this.cameras.main.height;
    // Pause menu owns every gesture (and the PAUSA tap itself never reaches the club).
    if (this.pauseOpen) return true;
    if (p.downTime === this.lastPauseUiDownTime && p.downTime > 0) return true;
    // A window drag owns the gesture from press to release (never a world tap / pan / zoom).
    if (this.winDrag) return true;
    if (p.downTime === this.lastWinDragDownTime && p.downTime > 0) return true;
    // Full-screen modal: block all ClubScene gestures underneath
    if (this.deleteConfirmVisible) return true;
    if (this.modalBackdrop?.visible) return true;
    if (p.y < 56) return true;
    if (p.x < 350 && p.y > h - 60) return true;
    // Windows can be dragged anywhere: hit-test their real on-screen rectangles.
    for (const key of ['npc', 'furniture', 'staff', 'inventory', 'shop', 'summary', 'techList', 'repairVerdict']) {
      const r = this.winScreenRect(key);
      if (r && Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(r), 4, 4).contains(p.x, p.y)) return true;
    }
    if (this.buildMode && p.x < 260 && p.y > h - 60) return true;
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
    const wasOpen = this.furnPanelVisible;
    this.furnPanelVisible = true;
    if (!wasOpen) {
      // Newly shown (or replacing the staff/customer window): default spot, then the shared
      // 'selection' position the player dragged to. Re-emits while open never move it.
      const cam = this.cameras.main;
      this.furnPanel.setPosition(cam.width - 20, cam.height - PANEL_BOTTOM_MARGIN - 280);
      this.applySavedWinPos('furniture');
    }
    this.furnPanel.setVisible(true);
    this.refreshFurnPanel(payload);
  };

  private onFurnitureDeselected = (): void => {
    this.hideFurnPanel();
  };

  private refreshFurnPanel(f: FurnitureInspectPayload): void {
    this.furnName.setText(f.name);
    this.furnSelectedId = f.id;
    if (this.furnFlipBtn) {
      const canFlip = f.flippable !== false;
      this.furnFlipBtn.setVisible(canFlip);
      // Flipping is done with the club closed (no one is using the piece mid-service).
      this.furnFlipBtn.setAlpha(this.phase === 'open' ? 0.45 : 1);
    }
    this.furnCondition.setText(
      `Condición: ${f.condition}` +
        (f.repairStatus ? `\n${f.repairStatus}` : f.repairCount ? ` · Reparado ×${f.repairCount}` : '')
    );
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
    const wasOpen = this.panelVisible;
    this.panelVisible = true;
    if (!wasOpen) {
      // Luna → Nova keeps the window where it is; a fresh open uses the remembered spot.
      this.layoutNpcPanel(this.cameras.main.width, this.cameras.main.height);
      this.applySavedWinPos('npc');
    }
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
      void tipsNight;
      void tipsTotal;
      const wallet = typeof npc.walletMoney === 'number' ? `\nDinero propio: $${npc.walletMoney}` : '';
      const cond = npc.condition ? ` (${npc.condition})` : '';
      this.panelStats.setText(
        `Estado: ${estado}${cond}\nHabilidad: ${npc.skill ?? '—'}\n` +
          `Propinas de hoy: $${tipsDay}` +
          wallet +
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
      const lines = [`Estado: ${estado}`];
      if (npc.servedDrink) lines.push(`Bebe: ${npc.servedDrink}`);
      else if (npc.wantedDrink) lines.push(`Quiere: ${npc.wantedDrink}`);
      // Thought history (newest first). Only place where thoughts are readable — never over heads.
      const th = (npc.thoughts ?? []).slice(-4).reverse();
      if (th.length) {
        lines.push('Piensa:');
        for (const t of th) lines.push(`${t.emoji} “${t.text}”`);
      }
      this.panelStats.setText(lines.join('\n'));
      this.energyLabel.setText('Ánimo de la noche');
      const mood = npc.mood ?? 100;
      this.energyBar.width = 220 * Phaser.Math.Clamp(mood / 100, 0, 1);
      this.energyBar.setFillStyle(mood < 30 ? 0xff4466 : 0x2ad6ff);
      this.moodBar.setVisible(false);
      this.moodLabel.setVisible(false);
      this.restBtn.setVisible(false);
    }
    this.layoutNpcPanelBars();
  }

  /** Push bars/button below the stats text so long staff/patron text never overlaps them. */
  private layoutNpcPanelBars(): void {
    this.panelStats.setFontSize(14);
    if (58 + this.panelStats.height > 262) this.panelStats.setFontSize(12);
    const y = Math.max(200, Math.min(270, Math.round(58 + this.panelStats.height + 10)));
    this.energyLabel.setY(y);
    this.panelEBg.setY(y + 20);
    this.energyBar.setY(y + 20);
    this.moodLabel.setY(y + 40);
    this.panelMBg.setY(y + 60);
    this.moodBar.setY(y + 60);
    this.restBtn.setY(Math.min(PANEL_H - 44, y + 86));
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
    const canBuild = this.phase === 'prep' || this.phase === 'summary';
    this.buildBtn.setVisible(canBuild && !this.buildMode);
    this.doneBuildBtn.setVisible(canBuild && this.buildMode);
    this.staffBtn.setVisible(!this.buildMode);
    this.inventBtn.setVisible(true);
    this.shopBtn.setVisible(canBuild && this.buildMode);
    this.openBtn.setAlpha(this.buildMode ? 0.35 : 1);
    // B10: Abrir only when CLOSED (prep). Summary uses Dormir.
    const showOpen = this.phase === 'prep' && !this.buildMode;
    const showClose = this.phase === 'open';
    this.openBtn.setVisible(showOpen);
    this.closeBtn.setVisible(showClose);
    // Summary closed → persistent Ver resumen + Dormir (player must never be stuck).
    const summaryIdle = this.phase === 'summary' && !this.summary.visible;
    if (this.summaryBtn) this.summaryBtn.setVisible(summaryIdle);
    if (this.sleepHudBtn) this.sleepHudBtn.setVisible(summaryIdle);
  }

  private nightLabel(s: HudState): string {
    const n = typeof s.nightNumber === 'number' && s.nightNumber > 0 ? s.nightNumber : null;
    return n != null ? `Noche ${n}` : 'Noche';
  }

  private onStats = (s: HudState): void => {
    this.phase = s.phase;
    if (typeof s.snacksUnlocked === 'boolean') this.snacksUnlocked = s.snacksUnlocked;
    if (typeof s.money === 'number') this.lastMoney = s.money;
    if (this.inventoryPanelVisible) this.rebuildInventoryPanel();
    if (this.orderConfirmVisible) this.rebuildOrderConfirm();
    this.moneyText.setText(`Dinero: ${formatMoney(s.money)}`);
    // Prompt B Phase B2: one visible time source = game clock (hide 75s countdown).
    this.applyClockHud(s);
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

  /** Prompt B Phase B7: soft close in progress — hide Cerrar, keep clock. */
  private onNightClosing = (s: HudState): void => {
    this.closeBtn.setVisible(false);
    this.openBtn.setVisible(false);
    this.onStats(s);
  };

  private onSummary = (s: HudState): void => {
    this.phase = s.phase;
    this.openBtn.setVisible(false);
    this.closeBtn.setVisible(false);
    if (this.summarySleep) this.summarySleep.setVisible(true);
    const label = this.nightLabel(s);
    this.applyClockHud(s);
    this.moneyText.setText(`Dinero: ${formatMoney(s.money)}`);

    const lines: string[] = [
      label,
      `Ganado esta noche: ${formatMoney(s.nightEarned ?? 0)}`,
      `Clientes que se sentaron: ${s.servedCount ?? 0}`,
      `Dinero total: ${formatMoney(s.money)}`,
    ];
    // Prompt B Phase B9: apertura / cierre / duración / empleadas.
    if (s.shiftSummary?.summaryLines?.length) {
      lines.push(...s.shiftSummary.summaryLines);
    }
    // Prompt A Phase 10: small drink sales / stockout / attended lines (no sat numbers).
    if (s.nightSales?.summaryLines?.length) {
      lines.push(...s.nightSales.summaryLines);
    }
    if (s.payroll && s.payroll.total > 0) {
      lines.push(`Sueldos semanales: -$${s.payroll.total}`);
      for (const l of s.payroll.lines) {
        lines.push(`  ${l.name}: $${l.amount}`);
      }
    }
    if (s.payrollDue) {
      lines.push(`Próximo pago de sueldos: ${daysLabel(s.payrollDue.daysLeft)}${s.payrollDue.amount > 0 ? ` ($${s.payrollDue.amount})` : ''}`);
    } else if (typeof s.nextPayrollNight === 'number' && s.nextPayrollNight > 0) {
      lines.push(`Próximo pago de sueldos: ${daysLabel(s.nextPayrollNight - (s.nightNumber ?? 0))}`);
    }
    if (s.utilities && s.utilities.total > 0) {
      lines.push(`Servicios del mes: -$${s.utilities.total}`);
      for (const l of s.utilities.lines) {
        lines.push(`  ${l.label}: $${l.amount}`);
      }
    }
    if (s.utilitiesDue) {
      lines.push(`Próximo pago de servicios: ${daysLabel(s.utilitiesDue.daysLeft)}${s.utilitiesDue.amount > 0 ? ` ($${s.utilitiesDue.amount})` : ''}`);
    } else if (typeof s.nextUtilitiesNight === 'number' && s.nextUtilitiesNight > 0) {
      lines.push(`Próximo pago de servicios: ${daysLabel(s.nextUtilitiesNight - (s.nightNumber ?? 0))}`);
    }
    if (s.debt) {
      lines.push(s.debt.line);
    } else if (s.money < 0) {
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
  /** Prompt B Phase B10: after Dormir — closed @ 17:00, optional toast. */
  private onDayStarted = (s: HudState & { toast?: string | null }): void => {
    this.summary.setVisible(false);
    this.lastSummaryBody = '';
    this.phase = s.phase;
    this.onStats(s);
    this.refreshBuildButtons();
    const msg = typeof s.toast === 'string' && s.toast.trim() ? s.toast.trim() : null;
    if (msg) this.showDayToast(msg);
  };

  private dayToast?: Phaser.GameObjects.Text;

  // ── BANCARROTA / GAME OVER ──────────────────────────────────────────────────
  private gameOver?: Phaser.GameObjects.Container;
  gameOverVisible = false;

  private onGameOver = (p: {
    nightsPlayed: number;
    money: number;
    debt: number;
    worstDebt: number;
    servedTotal: number;
    bestNightRevenue: number;
  }): void => {
    this.gameOverVisible = true;
    this.summary.setVisible(false);
    for (const w of this.dismissWins) if (w.isOpen() && w.key !== 'summary') w.close();
    if (this.summaryBtn) this.summaryBtn.setVisible(false);
    if (this.sleepHudBtn) this.sleepHudBtn.setVisible(false);
    this.openBtn.setVisible(false);
    this.closeBtn.setVisible(false);
    this.gameOver?.destroy();
    const cam = this.cameras.main;
    const c = this.add.container(0, 0).setScrollFactor(0).setDepth(20000).setName('gameOver');
    const dim = this.add.rectangle(0, 0, cam.width, cam.height, 0x050208, 0.88).setOrigin(0).setInteractive();
    const w = Math.min(460, cam.width - 32);
    const h = 330;
    const x0 = (cam.width - w) / 2;
    const y0 = Math.max(16, (cam.height - h) / 2);
    const box = this.add.rectangle(x0, y0, w, h, 0x1a0710, 0.97).setOrigin(0).setStrokeStyle(2, 0xff4466).setInteractive();
    const title = this.add
      .text(cam.width / 2, y0 + 26, BANKRUPTCY_TEXT.title, { fontSize: '30px', color: '#ff4466', fontStyle: 'bold' })
      .setOrigin(0.5, 0);
    const sub = this.add
      .text(cam.width / 2, y0 + 70, BANKRUPTCY_TEXT.subtitle, {
        fontSize: '15px',
        color: '#ffd6e0',
        align: 'center',
        wordWrap: { width: w - 40 },
      })
      .setOrigin(0.5, 0);
    const stats = [
      `Noches jugadas: ${p.nightsPlayed}`,
      `Deuda sin cubrir: $${p.debt}`,
      `Clientes atendidos: ${p.servedTotal}`,
      `Mejor noche en bebidas: $${p.bestNightRevenue}`,
    ].join('\n');
    const body = this.add
      .text(cam.width / 2, y0 + 112, stats, { fontSize: '15px', color: '#f0e0ff', align: 'center', lineSpacing: 6 })
      .setOrigin(0.5, 0);
    const btn = this.makeLocalButton(cam.width / 2 - 100, y0 + h - 62, 200, 42, 'Nueva partida', () => {
      this.game.events.emit('cmd-new-game');
    });
    btn.setName('newGameBtn');
    c.add([dim, box, title, sub, body, btn]);
    this.gameOver = c;
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 500 });
  };

  /** Test hook: game-over UI state. */
  getGameOverDebug() {
    const texts: string[] = [];
    this.gameOver?.each((o: Phaser.GameObjects.GameObject) => {
      if (o instanceof Phaser.GameObjects.Text) texts.push(o.text);
    });
    return { visible: this.gameOverVisible && !!this.gameOver?.visible, texts, hasNewGame: !!this.gameOver?.getByName('newGameBtn') };
  }

  private showDayToast(msg: string): void {
    this.dayToast?.destroy();
    const cam = this.cameras.main;
    this.dayToast = this.add
      .text(cam.width / 2, cam.height - 90, msg, {
        fontSize: '14px',
        color: '#f0e6ff',
        backgroundColor: '#12081ecc',
        padding: { x: 12, y: 8 },
        align: 'center',
        wordWrap: { width: Math.min(420, cam.width - 40) },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9600)
      .setAlpha(0);
    this.tweens.add({
      targets: this.dayToast,
      alpha: 1,
      duration: 400,
      yoyo: true,
      hold: 2800,
      onComplete: () => {
        this.dayToast?.destroy();
        this.dayToast = undefined;
      },
    });
  }

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
    this.summarySleep.setPosition(-100, btnY);
    this.summaryAgain.setPosition(-100, btnY);
    this.summaryAgain.setVisible(false);

    // makeLocalButton is top-left anchored
    const closeX = panelW / 2 - 36 - 8;
    const closeY = topY + 8;
    this.summaryClose.setPosition(closeX, closeY);

    this.summary.setPosition(cam.width / 2, cam.height / 2);
    this.applySavedWinPos('summary');
  }

  /**
   * Prompt B Phase B2: permanent game clock HH:MM + discreet schedule hint.
   * Narrow screens: under the money line (left). Desktop: centered top.
   */
  private layoutTimerText(w: number): void {
    const mobile = w < 640;
    if (mobile) {
      this.timerText.setOrigin(0, 0).setPosition(16, 34).setFontSize(16);
      this.scheduleText.setOrigin(0, 0).setPosition(16, 52).setFontSize(10);
    } else {
      this.timerText.setOrigin(0.5, 0).setPosition(w / 2, 10).setFontSize(20);
      this.scheduleText.setOrigin(0.5, 0).setPosition(w / 2, 32).setFontSize(11);
    }
  }

  /** Drive clock + schedule from Shift fields in HudState (not nightTimer seconds). */
  private applyClockHud(s: HudState): void {
    const hh =
      typeof s.gameHour === 'number' && Number.isFinite(s.gameHour)
        ? ((Math.floor(s.gameHour) % 24) + 24) % 24
        : 17;
    const mm =
      typeof s.gameMinute === 'number' && Number.isFinite(s.gameMinute)
        ? Math.max(0, Math.min(59, Math.floor(s.gameMinute)))
        : 0;
    const clock =
      typeof s.gameClock === 'string' && /^\d{1,2}:\d{2}$/.test(s.gameClock)
        ? s.gameClock
        : `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const night = this.nightLabel(s);
    const mobile = this.scale.width < 640;
    const closing = !!s.isClosing || s.shiftState === 'closing';
    if (closing) {
      this.timerText.setText(clock);
      this.timerText.setColor('#ffc878');
    } else if (s.phase === 'open') {
      this.timerText.setText(clock);
      this.timerText.setColor('#f0e6ff');
    } else if (s.phase === 'prep') {
      this.timerText.setText(clock);
      this.timerText.setColor('#c8a0e0');
    } else {
      this.timerText.setText(clock);
      this.timerText.setColor('#a090b0');
    }
    const full = s.scheduleLabel || 'Horario sugerido: Lun–Dom · 18:00 — 02:00';
    const short = s.scheduleLabelMobile || 'Horario: 18:00 — 02:00';
    let schedule = mobile ? short : full;
    if (closing) {
      schedule = mobile ? `${short} · cerrando…` : `${full} · Cerrando…`;
    } else if (s.phase === 'summary') {
      schedule = mobile ? `${short} · cerrada` : `${full} · ${night} cerrada`;
    }
    this.scheduleText.setText(schedule);
  }

  private onResize = (gameSize: Phaser.Structs.Size): void => {
    const w = gameSize.width;
    const h = gameSize.height;
    this.openBtn.setX(w - 150);
    this.closeBtn.setX(w - 150);
    this.summaryBtn.setX(w - 150);
    if (this.sleepHudBtn) {
      this.sleepHudBtn.setX(w - 150);
      this.sleepHudBtn.setY(48);
    }
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
    if (this.pauseBtn) this.pauseBtn.setPosition(w - PAUSE_BTN_RIGHT, 8);
    if (this.pauseOpen) this.renderPauseView(this.pauseView, this.pauseViewArg);
    for (const dw of this.dragWins) {
      if (dw.key === 'techList' || dw.key === 'repairVerdict') {
        this.clampWin(dw);
        continue;
      }
      this.applySavedWinPos(dw.key);
    }
  };

  private onInventoryUpdated = (): void => {
    if (this.inventoryPanelVisible) this.rebuildInventoryPanel();
  };

  private onRestockFailed = (info: { id?: string; reason?: string }): void => {
    if (!this.inventoryPanelVisible) return;
    const msg =
      info?.reason === 'money'
        ? 'Sin dinero'
        : info?.reason === 'need_table'
          ? SNACK_LOCKED_HINT
          : 'No se pudo comprar';
    this.flashInventoryMsg(msg);
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
    flash.setY(this.inventoryFlashY);
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
    this.orderConfirm = this.add
      .container(cam.width / 2, cam.height / 2)
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(9650);
  }

  private inventoryFlashY = 188;

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
    this.applySavedWinPos('inventory');
  }

  /** Closing the window (✕ / outside / right-click / CANCELAR) discards the unconfirmed order. */
  private hideInventoryPanel(): void {
    if (!this.inventoryPanelVisible) return;
    this.inventoryPanelVisible = false;
    this.inventoryPanel.setVisible(false);
    this.orderDraft.clear();
    this.hideOrderConfirm();
  }

  // ─── Supplier order (draft → confirm → paid → delivered physically later) ─────────

  private draftLines(): Array<{ productId: string; units: number }> {
    const out: Array<{ productId: string; units: number }> = [];
    for (const [productId, units] of this.orderDraft) {
      const n = normalizeOrderUnits(productId, units);
      if (n > 0) out.push({ productId, units: n });
    }
    return out;
  }

  private draftTotal(): number {
    return this.draftLines().reduce((a, l) => a + lineCost(l.productId, l.units), 0);
  }

  private bumpDraft(id: string, delta: number): void {
    const cur = this.orderDraft.get(id) ?? 0;
    const next = Math.max(0, Math.min(600, cur + delta));
    if (next <= 0) this.orderDraft.delete(id);
    else this.orderDraft.set(id, next);
    if (this.inventoryPanelVisible) this.rebuildInventoryPanel();
  }

  private pressInventoryAccept(): void {
    if (!this.draftLines().length) {
      this.flashInventoryMsg('Agrega productos al pedido.');
      return;
    }
    this.orderConfirmMsg = '';
    this.orderConfirmVisible = true;
    this.orderConfirm.setVisible(true);
    this.rebuildOrderConfirm();
  }

  private pressInventoryCancel(): void {
    this.orderDraft.clear();
    this.hideInventoryPanel();
  }

  private hideOrderConfirm(): void {
    if (!this.orderConfirmVisible) return;
    this.orderConfirmVisible = false;
    this.orderConfirm.setVisible(false);
    this.orderConfirmMsg = '';
  }

  private pressOrderConfirm(): void {
    const lines = this.draftLines();
    if (!lines.length) return;
    if (this.lastMoney < this.draftTotal()) {
      this.orderConfirmMsg = 'No tienes suficiente dinero para realizar este pedido.';
      this.rebuildOrderConfirm();
      return;
    }
    this.game.events.emit('cmd-place-order', { lines });
  }

  private onOrderResult = (res: { ok: boolean; message?: string }): void => {
    if (!this.orderConfirmVisible) return;
    if (res?.ok) {
      this.orderDraft.clear();
      this.hideOrderConfirm();
      this.hideInventoryPanel();
      this.syncModalBackdrop();
      return;
    }
    this.orderConfirmMsg = res?.message || 'No se pudo hacer el pedido.';
    this.rebuildOrderConfirm();
  };

  private rebuildOrderConfirm(): void {
    for (const g of this.orderConfirmRows) g.destroy();
    this.orderConfirmRows = [];
    const cam = this.cameras.main;
    this.orderConfirm.setPosition(cam.width / 2, cam.height / 2);
    const lines = this.draftLines();
    const total = this.draftTotal();
    const snap = getShiftSnapshot();
    const eta = estimateDeliveryText(getShiftState(), snap.gameHour, snap.gameMinute);
    const short = this.lastMoney < total;
    const w = Math.min(380, Math.max(290, cam.width - 30));
    const lineH = 20;
    const h = 196 + lines.length * lineH + (short || this.orderConfirmMsg ? 22 : 0);
    const add = (o: Phaser.GameObjects.GameObject) => {
      this.orderConfirm.add(o);
      this.orderConfirmRows.push(o);
    };
    const bg = this.add.rectangle(0, 0, w, h, 0x160a24, 1).setStrokeStyle(2, 0xffcc66);
    bg.setInteractive();
    add(bg);
    const txt = (x: number, y: number, t: string, color = '#e8d0ff', size = '13px', bold = false, ox = 0.5) =>
      add(
        this.add
          .text(x, y, t, { fontSize: size, color, fontStyle: bold ? 'bold' : 'normal', align: 'center', wordWrap: { width: w - 28 } })
          .setOrigin(ox, 0)
      );
    let y = -h / 2 + 12;
    txt(0, y, '¿Confirmar pedido?', '#ffcc66', '17px', true);
    y += 26;
    txt(0, y, 'El pedido será entregado durante la próxima ventana disponible.', '#c8b0e0', '12px');
    y += 34;
    for (const l of lines) {
      const packs = describePackages(packUnits(l.productId, l.units));
      const name = this.productLabel(l.productId);
      txt(-w / 2 + 16, y, `${name} × ${l.units}  (${packs})`, '#e8d0ff', '12px', false, 0);
      add(
        this.add
          .text(w / 2 - 16, y, this.fmtMoney(lineCost(l.productId, l.units)), { fontSize: '12px', color: '#7ad7ff', fontStyle: 'bold' })
          .setOrigin(1, 0)
      );
      y += lineH;
    }
    y += 4;
    txt(0, y, `Total: ${this.fmtMoney(total)}   ·   Dinero del club: ${this.fmtMoney(this.lastMoney)}`, '#ffffff', '13px', true);
    y += 22;
    txt(0, y, eta, '#3cff9a', '12px');
    y += 22;
    const msg = this.orderConfirmMsg || (short ? 'No tienes suficiente dinero para realizar este pedido.' : '');
    if (msg) {
      txt(0, y, msg, '#ff6688', '12px', true);
      y += 22;
    }
    const bw = 116;
    const by = h / 2 - 44;
    const ok = this.makeInvBtn(-bw - 8, by, bw, 32, 'CONFIRMAR', () => this.pressOrderConfirm(), !short && lines.length > 0);
    ok.setName('orderConfirmOk');
    const no = this.makeInvBtn(8, by, bw, 32, 'CANCELAR', () => {
      this.hideOrderConfirm();
      this.syncModalBackdrop();
    });
    add(ok);
    add(no);
  }

  private productLabel(id: string): string {
    const line = listInventory({ snacksUnlocked: true, snackLockHint: '' }).find((l) => l.id === id);
    return line?.name ?? id;
  }

  // Test hooks (UI-level order flow).
  debugOrderDraft(id: string, units: number): void {
    if (!this.inventoryPanelVisible) this.showInventoryPanel();
    if (units <= 0) this.orderDraft.delete(id);
    else this.orderDraft.set(id, units);
    this.rebuildInventoryPanel();
  }
  debugPressInvAccept(): void {
    this.pressInventoryAccept();
  }
  debugPressInvCancel(): void {
    this.pressInventoryCancel();
  }
  debugPressOrderConfirm(): void {
    this.pressOrderConfirm();
  }
  debugDismissTop(): boolean {
    return this.dismissTopmost();
  }
  getOrderUiDebug() {
    return {
      inventoryOpen: this.inventoryPanelVisible,
      confirmOpen: this.orderConfirmVisible,
      draft: this.draftLines(),
      total: this.draftTotal(),
      message: this.orderConfirmMsg,
      money: this.lastMoney,
    };
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
        if (!this.isPrimaryPress(p)) return;
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
    const lines = listInventory({
      snacksUnlocked: this.snacksUnlocked,
      snackLockHint: SNACK_LOCKED_HINT,
    });
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    // Wide: one row per product. Narrow (phones): row 1 = data, row 2 = [−] price [+] and restock.
    const twoRow = camW < 600;
    const panelW = twoRow ? Math.max(300, camW - 16) : 580;
    const half = panelW / 2 - 14;
    const font = twoRow ? '11px' : '12px';
    const rowH = twoRow ? 54 : 38;
    const footerH = 84;
    const panelH = Math.min(camH - 70, 64 + 24 + lines.length * rowH + 40 + footerH + (this.snacksUnlocked ? 0 : 14));
    if (this.inventoryBg) this.inventoryBg.setSize(panelW, panelH);
    const title = this.inventoryPanel.getByName('invTitle') as Phaser.GameObjects.Text | null;
    if (title) title.setY(-panelH / 2 + 22);
    const closeBtn = this.inventoryPanel.list.find(
      (o) => o instanceof Phaser.GameObjects.Container && o !== this.inventoryPanel && !this.inventoryRows.includes(o)
    ) as Phaser.GameObjects.Container | undefined;
    if (closeBtn) closeBtn.setPosition(panelW / 2 - 40, -panelH / 2 + 8);

    const cols = twoRow
      ? { name: -half, stock: -half + 96, sold: -half + 142, cost: -half + 188, margin: -half + 244, price: -half + 52, rest: half - 112 }
      : { name: -half, stock: -half + 98, sold: -half + 146, cost: -half + 194, price: -half + 250, margin: -half + 348, rest: half - 132 };

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
    if (!twoRow) mkH(cols.rest, 'Pedir');

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
      const nameColor = (line as { kind?: string }).kind === 'snack' ? '#ffcc66' : '#ff9ad5';
      mk(cols.name, y + 4, line.name, nameColor);
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
      // Pedir: [−] qty [+] (+caja). Builds the draft only; nothing is paid until CONFIRMAR.
      const snackLocked = !!(line as { locked?: boolean }).locked;
      const isSnack = (line as { kind?: string }).kind === 'snack';
      const ostep = orderUnitStep(line.id);
      const qty = this.orderDraft.get(line.id) ?? 0;
      if (twoRow) mk(cols.rest - 34, rowY2 + 6, 'Pedir', '#a080c0');
      const ob = 24;
      const qW = isSnack ? 34 : 30;
      const oMinus = this.makeInvBtn(cols.rest, rowY2, ob, btn - 2, '−', () => this.bumpDraft(line.id, -ostep), !snackLocked && qty > 0);
      const qtyLabel = this.add
        .text(cols.rest + ob + qW / 2, rowY2 + (btn - 2) / 2, String(qty), {
          fontSize: font,
          color: qty > 0 ? '#ffcc66' : '#806890',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const oPlus = this.makeInvBtn(cols.rest + ob + qW, rowY2, ob, btn - 2, '+', () => {
        if (snackLocked) {
          this.flashInventoryMsg((line as { lockHint?: string }).lockHint || SNACK_LOCKED_HINT);
          return;
        }
        this.bumpDraft(line.id, ostep);
      }, !snackLocked);
      const rowObjs: Phaser.GameObjects.GameObject[] = [minus, priceLabel, plus, oMinus, qtyLabel, oPlus];
      if (!isSnack) {
        const boxW = twoRow ? 30 : 46;
        const box = this.makeInvBtn(cols.rest + ob * 2 + qW + 4, rowY2, boxW, btn - 2, twoRow ? `+${PACKAGING.drinkCrateUnits}` : `+caja`, () =>
          this.bumpDraft(line.id, PACKAGING.drinkCrateUnits)
        );
        rowObjs.push(box);
      } else {
        const sackT = this.add
          .text(cols.rest + ob * 2 + qW + 6, rowY2 + (btn - 2) / 2, `costal`, { fontSize: '10px', color: '#a080c0' })
          .setOrigin(0, 0.5);
        rowObjs.push(sackT);
      }
      for (const o of rowObjs) {
        this.inventoryPanel.add(o);
        this.inventoryRows.push(o);
      }
      if (snackLocked) {
        const lock = this.add
          .text(twoRow ? cols.rest - 34 : cols.rest, rowY2 + 28, SNACK_LOCKED_HINT, {
            fontSize: '10px',
            color: '#ff8866',
          })
          .setOrigin(0, 0);
        this.inventoryPanel.add(lock);
        this.inventoryRows.push(lock);
      }
      y += rowH + (snackLocked ? 14 : 0);
    }

    // Footer: what is already coming / waiting at the door, draft total, ACEPTAR / CANCELAR.
    {
      const nameOf = (id: string) => lines.find((l) => l.id === id)?.name ?? id;
      const fmt = (rec: Record<string, number>) =>
        Object.entries(rec)
          .filter(([, n]) => n > 0)
          .map(([id, n]) => `${nameOf(id)} ${n}`)
          .join(', ');
      const coming = fmt(unitsInTransit());
      const atDoor = fmt(unitsAtEntrance());
      const info = [coming ? `En camino: ${coming}` : '', atDoor ? `En la entrada: ${atDoor}` : '']
        .filter(Boolean)
        .join('  ·  ');
      const fy = panelH / 2 - 20 - footerH;
      const infoT = this.add
        .text(0, fy, info || 'Sin pedidos pendientes.', {
          fontSize: '10px',
          color: info ? '#ffcc66' : '#806890',
          align: 'center',
          wordWrap: { width: panelW - 24 },
        })
        .setOrigin(0.5, 0);
      const total = this.draftTotal();
      const nUnits = this.draftLines().reduce((a, l) => a + l.units, 0);
      const totT = this.add
        .text(-half, fy + 32, nUnits > 0 ? `Pedido: ${nUnits} u. · ${this.fmtMoney(total)}` : 'Pedido vacío', {
          fontSize: font,
          color: nUnits > 0 ? (total > this.lastMoney ? '#ff6688' : '#ffffff') : '#806890',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5);
      const bw = twoRow ? 84 : 100;
      const acc = this.makeInvBtn(half - bw * 2 - 8, fy + 18, bw, 30, 'ACEPTAR', () => this.pressInventoryAccept(), nUnits > 0);
      const can = this.makeInvBtn(half - bw, fy + 18, bw, 30, 'CANCELAR', () => this.pressInventoryCancel());
      for (const o of [infoT, totT, acc, can]) {
        this.inventoryPanel.add(o);
        this.inventoryRows.push(o);
      }
      this.inventoryFlashY = fy - 14;
    }

    const hint = this.add
      .text(0, panelH / 2 - 20, '−/+ precio · Pedir: arma el pedido (cajas de 6, botanas por costal de 100) · llega a la entrada y el personal lo lleva a la barra', {
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
    this.applySavedWinPos('staff');
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
    const bg = this.add.rectangle(0, 0, 440, 500, 0x140a22, 0.96);
    bg.setStrokeStyle(2, 0xff3ca0);
    bg.setInteractive();
    const title = this.add
      .text(0, -228, 'Tienda — Funcional', {
        fontSize: '18px',
        color: '#ff9ad5',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setName('shopTitle');
    const close = this.makeLocalButton(180, -236, 36, 32, '✕', () => this.hideShopPanel());
    this.shopPanel.add([bg, title, close]);
    this.input.on('wheel', this.onShopWheel);
  }

  private shopTabTitle(tab: ShopTabId): string {
    const map: Record<string, string> = {
      funcional: 'Tienda — Funcional',
      ambiente: 'Tienda — Ambiente',
      entretenimiento: 'Tienda — Entretenimiento',
      identidad: 'Tienda — Identidad',
    };
    return map[tab] ?? 'Tienda';
  }

  private shopItemMatchesTab(it: { category?: string }, tab: ShopTabId): boolean {
    const cat = (it.category || 'funcional').toLowerCase();
    if (tab === 'funcional') {
      return cat === 'funcional' || cat === 'muebles' || cat === 'furniture';
    }
    if (tab === 'ambiente') {
      return cat === 'ambiente' || cat === 'decoracion' || cat === 'decor' || cat === 'decoration';
    }
    if (tab === 'entretenimiento') return cat === 'entretenimiento' || cat === 'entertainment';
    if (tab === 'identidad') return cat === 'identidad' || cat === 'identity';
    return false;
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
        // Right-click anywhere on the confirm = cancel (handled in setupWindowDismiss)
        if (!this.isPrimaryPress(p)) return;
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
      if (!this.isPrimaryPress(p)) return;
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
    this.applySavedWinPos('shop');
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
      title.setText(this.shopTabTitle(this.shopTab));
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

    const tabY = -198;
    const tabs: Array<{ label: string; tab: ShopTabId; x: number }> = [
      { label: 'Funcional', tab: 'funcional', x: -165 },
      { label: 'Ambiente', tab: 'ambiente', x: -55 },
      { label: 'Ocio', tab: 'entretenimiento', x: 50 },
      { label: 'Identidad', tab: 'identidad', x: 155 },
    ];
    for (const tb of tabs) {
      const active = this.shopTab === tb.tab;
      const btn = this.makeLocalButton(tb.x - 45, tabY, 90, 26, tb.label, () => {
        this.shopTab = tb.tab;
        this.shopScroll = 0;
        const title = this.shopPanel.getByName('shopTitle') as Phaser.GameObjects.Text | null;
        if (title) {
          title.setText(this.shopTabTitle(tb.tab));
          title.setColor('#ff9ad5');
        }
        this.rebuildShopPanel();
      });
      btn.setAlpha(active ? 1 : 0.5);
      this.shopPanel.add(btn);
      this.shopRows.push(btn);
    }

    if (!catalog) {
      const wait = this.add
        .text(0, 0, 'Cargando…', { fontSize: '14px', color: '#c8a0e0' })
        .setOrigin(0.5);
      this.shopPanel.add(wait);
      this.shopRows.push(wait);
      return;
    }

    const moneyHint = this.add
      .text(0, -165, `Dinero: ${formatMoney(catalog.money)}`, {
        fontSize: '13px',
        color: '#ffe066',
      })
      .setOrigin(0.5);
    this.shopPanel.add(moneyHint);
    this.shopRows.push(moneyHint);

    const items = catalog.items.filter((it) => this.shopItemMatchesTab(it, this.shopTab));
    const pageSize = 3;
    const maxScroll = Math.max(0, items.length - pageSize);
    if (this.shopScroll > maxScroll) this.shopScroll = maxScroll;
    if (this.shopScroll < 0) this.shopScroll = 0;

    if (!items.length) {
      const empty = this.add
        .text(0, -40, 'Nada en esta sección todavía.', {
          fontSize: '13px',
          color: '#a080c0',
          align: 'center',
        })
        .setOrigin(0.5);
      this.shopPanel.add(empty);
      this.shopRows.push(empty);
      return;
    }

    let y = -150;
    const slice = items.slice(this.shopScroll, this.shopScroll + pageSize);
    for (const it of slice) {
      y = this.addShopItemRow(it, y, catalog.money);
      y += 8;
    }

    // Scroll controls — added AFTER the cards (on top) in their own bottom bar so no card covers them.
    if (items.length > pageSize) {
      const canUp = this.shopScroll > 0;
      const canDown = this.shopScroll < maxScroll;
      const up = this.makeLocalButton(-200, 208, 110, 30, '▲ Subir', () => {
        if (this.shopScroll <= 0) return;
        this.shopScroll = Math.max(0, this.shopScroll - 1);
        this.rebuildShopPanel();
      });
      up.setName('shopUp');
      up.setAlpha(canUp ? 1 : 0.3);
      up.setData('enabled', canUp);
      const down = this.makeLocalButton(90, 208, 110, 30, '▼ Bajar', () => {
        if (this.shopScroll >= maxScroll) return;
        this.shopScroll = Math.min(maxScroll, this.shopScroll + 1);
        this.rebuildShopPanel();
      });
      down.setName('shopDown');
      down.setAlpha(canDown ? 1 : 0.3);
      down.setData('enabled', canDown);
      const last = Math.min(items.length, this.shopScroll + pageSize);
      const page = this.add
        .text(0, 223, `${this.shopScroll + 1}–${last} de ${items.length}`, {
          fontSize: '12px',
          color: '#c8a0e0',
        })
        .setOrigin(0.5);
      this.shopPanel.add(up);
      this.shopPanel.add(down);
      this.shopPanel.add(page);
      this.shopRows.push(up, down, page);
    }
  }

  /** Mouse wheel over the open shop scrolls the same list (no second navigation system). */
  private onShopWheel = (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void => {
    if (!this.shopPanelVisible || !this.shopCatalog) return;
    const cam = this.cameras.main;
    if (Math.abs(p.x - cam.width / 2) > 220 || Math.abs(p.y - cam.height / 2) > 250) return;
    const items = this.shopCatalog.items.filter((it) => this.shopItemMatchesTab(it, this.shopTab));
    const maxScroll = Math.max(0, items.length - 3);
    const next = Phaser.Math.Clamp(this.shopScroll + (dy > 0 ? 1 : dy < 0 ? -1 : 0), 0, maxScroll);
    if (next === this.shopScroll) return;
    this.shopScroll = next;
    this.rebuildShopPanel();
  };

  /** Test/debug: shop scroll state. */
  getShopNavDebug() {
    const up = this.shopPanel?.getByName('shopUp') as Phaser.GameObjects.Container | null;
    const down = this.shopPanel?.getByName('shopDown') as Phaser.GameObjects.Container | null;
    const items = this.shopCatalog
      ? this.shopCatalog.items.filter((it) => this.shopItemMatchesTab(it, this.shopTab)).length
      : 0;
    return {
      scroll: this.shopScroll,
      items,
      upEnabled: up ? !!up.getData('enabled') : null,
      downEnabled: down ? !!down.getData('enabled') : null,
      tab: this.shopTab,
    };
  }

  /** Test helper: press the shop ▲/▼ buttons exactly like a click would. */
  debugShopScroll(dir: 'up' | 'down'): void {
    const btn = this.shopPanel?.getByName(dir === 'up' ? 'shopUp' : 'shopDown') as Phaser.GameObjects.Container | null;
    const bg = btn?.list[0] as Phaser.GameObjects.Rectangle | undefined;
    bg?.emit('pointerdown', { wasTouch: true, button: 0, event: { stopPropagation() {} } });
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
