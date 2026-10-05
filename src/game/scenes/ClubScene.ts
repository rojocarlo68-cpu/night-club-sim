import Phaser from 'phaser';
import {
  IsoConfig,
  tileToScreen,
  screenToTile,
  depthForFurniture,
  depthForCharacter,
} from '../systems/IsoUtils';
import { FloorData, buildFloorTexture } from '../systems/FloorRenderer';
import { Pathfinder } from '../systems/Pathfinding';
import { Bartender, BartenderData, StaffAiJob } from '../entities/Bartender';
import { Patron, PatronData } from '../entities/Patron';
import { NpcInfo } from '../types/Npc';
import { StaffCandidate, StaffPoolFile, StaffRosterEntry, StaffRosterPayload } from '../types/Staff';
import { ShopCatalogPayload, ShopFurnitureFile, ShopFurnitureItem } from '../types/Shop';
import {
  AI_TUNABLES,
  SEATABLE_TYPES,
  STATUS_ES,
  lerp,
} from '../systems/AiTunables';
import {
  getTips,
  loadTips,
  recordTip,
  resetNightTips,
  serializeTips,
} from '../systems/Tips';
import { getPersonality, personalitySummary } from '../config/personality';
import {
  FurnitureInspectPayload,
  FurnitureRuntimeStats,
  STARTER_FURNITURE_PRICE,
  CLEAN_THRESHOLD,
  DIRT_VISUAL_THRESHOLD,
  CLEAN_DURATION_MS,
  applyDecay,
  applyCleanRestore,
  conditionFromDurability,
  freshStatsForPrice,
  mergeSavedStats,
  refundForWear,
} from '../systems/FurnitureStats';

/** Single fixed orientation for every piece (Ultima Online style: fixed camera, no rotation).
 *  The medieval sofa's natural pose faces lower-left (SW): long side toward the viewer's left. */
type IsoFacing = 'sw';

interface Drink {
  id: string;
  name: string;
  price: number;
  serveTimeMs: number;
}

interface FurnitureDef {
  id: string;
  type: string;
  sprite: string;
  facing?: IsoFacing;
  /** Texture key of the (only) art. */
  sprites?: { sw?: string };
  tile: [number, number];
  footprint: [number, number];
  /** Shop catalog id when this instance was purchased. */
  catalogId?: string;
  fromShop?: boolean;
  displayW?: number;
  displayH?: number;
  yBias?: number;
  /** Art-px (2x) base-vertex anchor pinned to the footprint bottom vertex (catalog baseVertex). */
  baseVertex?: [number, number];
  /** Catalog price used for max stats / decay (starters use STARTER_FURNITURE_PRICE). */
  price?: number;
  durability?: number;
  comfort?: number;
  cleanliness?: number;
  maxDurability?: number;
  maxComfort?: number;
  maxCleanliness?: number;
}

interface Scenario {
  id: string;
  title: string;
  startingMoney: number;
  nightDurationSec: number;
  patronSpawnCount: [number, number];
  spawnIntervalMs: number;
  map: { cols: number; rows: number; tileWidth: number; tileHeight: number };
  /** Non-walkable / non-placeable tiles (empty now that the stage is gone). */
  blocked: [number, number][];
  furniture: FurnitureDef[];
  spawnTile: [number, number];
  exitTile: [number, number];
  drinks: Drink[];
}

interface CharactersFile {
  bartender: BartenderData & { sprite: string; role: string; portrait?: string };
  patrons: PatronData[];
  staff?: Array<
    BartenderData & {
      sprite: string;
      role: string;
      roleLabel?: string;
      portrait?: string;
      starter?: boolean;
    }
  >;
}

interface SavedLayoutItem {
  id: string;
  tile: [number, number];
  /** Legacy: old saves may carry a rotated facing/footprint; both are ignored (migrated to SE). */
  facing?: string;
  catalogId?: string;
  flipX?: boolean;
  footprint?: [number, number];
  /** Purchase / catalog price for wear refunds. */
  price?: number;
  durability?: number;
  comfort?: number;
  cleanliness?: number;
  maxDurability?: number;
  maxComfort?: number;
  maxCleanliness?: number;
}

interface SavedLayout {
  furniture: SavedLayoutItem[];
  /** Hired staff ids from staff_pool (excludes starter Luna). */
  hiredStaff?: string[];
  /** Persist cash so hires survive reload. */
  money?: number;
  /** Starter pieces already offered to this save (so a deleted starter bar stays deleted). */
  seeded?: string[];
  /** Per-staff tip ledger (Phase 1). Old saves omit this → zeros. */
  staffTips?: Record<string, { tipsNight?: number; tipsDay?: number; tipsTotal?: number }>;
}

/** Every piece uses this single orientation (the sofa's front looks toward the lower-left). */
const FIXED_FACING: IsoFacing = 'sw';

/** Backdrop beyond the floor: deep warm charcoal-brown (medieval tavern), no neon. */
const BG_COLOR = '#1a1411';

const LAYOUT_KEY = 'night-club-layout-v1';
const TAP_THRESH = 10;
const HUD_TOP = 56;
/** Pinch / wheel zoom clamps (initial narrow-viewport zoom still applied in setupCamera). */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.1;
const WHEEL_ZOOM_STEP = 0.08;
export type NightPhase = 'prep' | 'open' | 'summary';

/** Furniture instance id (the starter sofa is 'sofa'). */
type SelectedFurniture = string | null;

export class ClubScene extends Phaser.Scene {
  iso!: IsoConfig;
  pathfinder!: Pathfinder;
  scenario!: Scenario;
  chars!: CharactersFile;
  bartender!: Bartender;
  /** Extra hired staff NPCs (not the primary serving bartender). */
  extraStaff: Bartender[] = [];
  private staffPool: StaffCandidate[] = [];
  private hiredStaffIds: string[] = [];
  patrons: Patron[] = [];
  money = 0;
  nightEarned = 0;
  servedCount = 0;
  phase: NightPhase = 'prep';
  nightTimer = 0;
  buildMode = false;
  /** Currently selected NPC id (bartender profile id or patron runtime id). */
  private selectedNpcId: string | null = null;
  /** Set by NPC sprite handlers so empty-world tap can deselect / move. */
  private npcTapHandled = false;
  private statusFloat?: Phaser.GameObjects.Text;

  private spawnLeft = 0;
  private queueTiles: Set<string> = new Set();
  private drinks: Drink[] = [];
  private roomImage!: Phaser.GameObjects.Image;
  /** Faint tile-diamond grid, visible only in Construir mode. */
  private buildGrid: Phaser.GameObjects.Graphics | null = null;
  private floorPixelSize = { w: 768, h: 384 };
  /** Furniture images keyed by instance id (the starter sofa is 'sofa'). */
  private shopImages = new Map<string, Phaser.GameObjects.Image>();
  private shopCatalog: ShopFurnitureItem[] = [];
  private shopCatalogById = new Map<string, ShopFurnitureItem>();
  private shopInstanceSeq = 0;
  /** Procedural dirt Graphics overlays keyed by furniture instance id. */
  private dirtOverlays = new Map<string, Phaser.GameObjects.Graphics>();
  /** furnitureId → staffId while Limpiar AI job runs. */
  private cleanClaim = new Map<string, string>();
  /** Inspect panel selection outside Construir. */
  private inspectedFurnitureId: string | null = null;

  private selectedFurniture: SelectedFurniture = null;
  /** Floating Eliminar HUD above the selected piece (no rotation any more). */
  private selectionHud!: Phaser.GameObjects.Container;
  private deleteBtn!: Phaser.GameObjects.Container;
  private selectionHudBg!: Phaser.GameObjects.Rectangle;
  /** Set when a loaded save held rotated pieces / stale footprints (re-persisted after the nudge). */
  private layoutMigrated = false;
  /** True while UIScene delete-confirm modal is open (blocks Club input). */
  private deleteConfirmOpen = false;
  private buildHint!: Phaser.GameObjects.Text;

  // Camera pan
  private panActive = false;
  private panDragging = false;
  private panStartX = 0;
  private panStartY = 0;
  private panScrollX = 0;
  private panScrollY = 0;
  private skipNextTap = false;

  // Pinch / wheel zoom
  private pinching = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchMidX = 0;
  private pinchMidY = 0;

  // Furniture drag in build mode
  private furnDragging = false;
  private furnDragId: SelectedFurniture = null;
  private blockPanGesture = false;
  private dragPoseValid = true;

  constructor() {
    super('ClubScene');
  }

  create(): void {
    try {
      this.bootstrapClub();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ClubScene] create failed:', err);
      this.showFatalError(`Error en ClubScene: ${msg}`);
    }
  }

  private showFatalError(message: string): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.cameras.main.setBackgroundColor(BG_COLOR);
    this.add
      .text(w / 2, h / 2 - 20, 'Night Club — error', {
        fontSize: '22px',
        color: '#ff3ca0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(w / 2, h / 2 + 24, message, {
        fontSize: '14px',
        color: '#ff99aa',
        align: 'center',
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5);
  }

  private requireTexture(key: string): void {
    if (!this.textures.exists(key)) {
      throw new Error(`Falta textura: ${key}`);
    }
  }

  private bootstrapClub(): void {
    this.scenario = this.cache.json.get('scenario') as Scenario;
    this.chars = this.cache.json.get('characters') as CharactersFile;
    if (!this.scenario) throw new Error('Falta JSON scenario');
    if (!this.chars) throw new Error('Falta JSON characters');

    this.money = this.scenario.startingMoney;
    this.nightEarned = 0;
    this.servedCount = 0;
    this.phase = 'prep';
    this.patrons = [];
    this.drinks = Array.isArray(this.scenario.drinks) ? this.scenario.drinks : [];
    this.buildMode = false;
    this.selectedFurniture = null;

    const { cols, rows, tileWidth, tileHeight } = this.scenario.map;
    // Integer origin: the floor art is pixel-exact, so tile vertices must sit on whole pixels.
    const originX = Math.round(this.cameras.main.width / 2);
    const originY = 70;
    this.iso = { tileWidth, tileHeight, originX, originY };

    // Saved layout first: it drops pieces that no longer exist (bar, DJ, pinball, neon placeholders)
    // and keeps the sofa (and its wear / tile) when present.
    this.applySavedLayout();

    if (!this.cache.json.get('floor')) throw new Error('Falta JSON floor');
    this.loadShopCatalog();
    this.upgradeAllShopFurnitureFromCatalog();
    for (const f of this.scenario.furniture) {
      this.ensureShopFlags(f);
      this.requireTexture(this.furnitureTextureKey(f.type, f));
    }
    this.requireTexture(this.chars.bartender.sprite || 'bartender');

    this.rebuildPathfinder();

    this.drawRoom(cols, rows);
    this.placeFurniture();
    this.ensureAllFurnitureInsideFloor();
    if (this.layoutMigrated) {
      this.persistLayout();
      this.layoutMigrated = false;
    }
    this.ensureAllFurnitureStats();
    this.refreshAllDirtOverlays();
    this.setupCamera();

    const bd = this.chars.bartender;
    // Luna is free staff like Nova — spawn on the floor near the sofa.
    const lunaSpawn = this.findFloorStaffSpawnTile();
    this.bartender = new Bartender(
      this,
      bd.sprite || 'bartender',
      lunaSpawn,
      this.iso,
      this.pathfinder,
      bd
    );
    this.syncBartenderBarDepth();
    this.wireStaffClick(this.bartender);
    this.bartender.refreshHitArea();

    this.loadStaffPool();
    this.ensureFreeStarterStaff();
    this.spawnHiredExtraStaff();

    this.setupPointerPan();
    this.setupZoom();
    this.input.mouse?.disableContextMenu();
    this.syncFurnitureInteractive();

    this.buildHint = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height - 28, '', {
        fontSize: '13px',
        color: '#c8a0e0',
        backgroundColor: '#12081ecc',
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9500)
      .setVisible(false);

    this.cameras.main.setBackgroundColor(BG_COLOR);

    this.game.events.emit('club-ready', this.getHudState());
    this.game.events.on('cmd-open-night', this.openNight, this);
    this.game.events.on('cmd-close-night', this.closeNight, this);
    this.game.events.on('cmd-rest', this.orderRest, this);
    this.game.events.on('cmd-rest-staff', this.orderRestStaff, this);
    this.game.events.on('cmd-select-staff', this.onCmdSelectStaff, this);
    this.game.events.on('cmd-hire-staff', this.onCmdHireStaff, this);
    this.game.events.on('cmd-request-staff-roster', this.emitStaffRoster, this);
    this.game.events.on('cmd-set-build-mode', this.setBuildMode, this);
    this.game.events.on('cmd-deselect-npc', this.deselectNpc, this);
    this.game.events.on('cmd-deselect-bartender', this.deselectNpc, this);
    this.game.events.on('cmd-request-shop-catalog', this.emitShopCatalog, this);
    this.game.events.on('cmd-buy-shop-furniture', this.onCmdBuyShopFurniture, this);
    this.game.events.on('cmd-deselect-furniture', this.onCmdDeselectFurniture, this);
    this.game.events.on('cmd-confirm-delete-furniture', this.onCmdConfirmDeleteFurniture, this);
    this.game.events.on('cmd-cancel-delete-furniture', this.onCmdCancelDeleteFurniture, this);
    this.emitStaffRoster();
    this.emitShopCatalog();
  }

  private bartenderNpcInfo(): NpcInfo {
    return {
      id: this.bartender.profile.id,
      name: this.bartender.displayName,
      role: 'staff',
      energy: Math.round(this.bartender.energy),
      mood: Math.round(this.bartender.mood),
      skill: Math.round(this.bartender.skill),
      state: this.bartender.getAiStateKey(),
    };
  }

  private patronNpcInfo(p: Patron): NpcInfo {
    return {
      id: p.profile.id,
      name: p.displayName,
      role: 'patron',
      patience: Math.round(p.patienceRemaining * 10) / 10,
      patienceMax: p.profile.patience,
      preferredDrink: p.preferredDrinkName,
      mood: p.nightMood,
      state: p.getActionKey(),
      portrait: this.textures.exists('patron_portrait') ? 'patron_portrait' : undefined,
    };
  }

  private getSelectedNpcInfo(): NpcInfo | null {
    if (!this.selectedNpcId) return null;
    const staff = this.findStaffById(this.selectedNpcId);
    if (staff) return this.staffNpcInfo(staff);
    const patron = this.patrons.find((p) => p.profile.id === this.selectedNpcId);
    if (patron) return this.patronNpcInfo(patron);
    return null;
  }

  private findStaffById(id: string): Bartender | null {
    if (this.bartender && this.bartender.profile.id === id) return this.bartender;
    return this.extraStaff.find((s) => s.profile.id === id) ?? null;
  }

  private staffNpcInfo(b: Bartender): NpcInfo {
    let portrait: string | undefined;
    if (b === this.bartender) {
      portrait =
        this.chars?.bartender?.portrait ||
        (this.textures.exists('luna_portrait') ? 'luna_portrait' : undefined);
    } else {
      portrait = this.staffPool.find((c) => c.id === b.profile.id)?.portrait;
    }
    const tips = getTips(b.profile.id);
    const personality = personalitySummary(getPersonality(b.profile.id));
    return {
      id: b.profile.id,
      name: b.displayName,
      role: 'staff',
      energy: Math.round(b.energy),
      mood: Math.round(b.mood),
      skill: Math.round(b.skill),
      state: b.getAiStateKey(),
      portrait,
      tipsNight: tips.tipsNight,
      tipsDay: tips.tipsDay,
      tipsTotal: tips.tipsTotal,
      personality,
    };
  }

  private selectNpcStaff(id?: string): void {
    const target = id ? this.findStaffById(id) : this.bartender;
    if (!target) return;
    this.clearFurnitureSelection();
    this.patrons.forEach((p) => p.setSelected(false));
    this.bartender.setSelected(target === this.bartender);
    this.extraStaff.forEach((s) => s.setSelected(s === target));
    this.selectedNpcId = target.profile.id;
    const info = this.staffNpcInfo(target);
    this.game.events.emit('select-npc', info);
    if (target === this.bartender) {
      this.game.events.emit('select-bartender', this.bartender);
    }
  }

  private onCmdSelectStaff = (id: string): void => {
    if (this.buildMode) return;
    this.selectNpcStaff(id);
  };

  private selectNpcPatron(patron: Patron): void {
    this.clearFurnitureSelection();
    this.bartender.setSelected(false);
    this.extraStaff.forEach((s) => s.setSelected(false));
    this.patrons.forEach((p) => p.setSelected(p === patron));
    this.selectedNpcId = patron.profile.id;
    this.game.events.emit('select-npc', this.patronNpcInfo(patron));
  }

  deselectNpc = (): void => {
    this.selectedNpcId = null;
    if (this.bartender) this.bartender.setSelected(false);
    this.extraStaff.forEach((s) => s.setSelected(false));
    this.patrons.forEach((p) => p.setSelected(false));
  };

  private wirePatronClick(patron: Patron): void {
    patron.sprite.on('pointerdown', () => {
      if (!this.buildMode) this.npcTapHandled = true;
    });
    patron.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.panDragging || this.furnDragging || this.skipNextTap) return;
      if (p.getDistance() > TAP_THRESH) return;
      if (this.buildMode) return;
      p.event.stopPropagation();
      this.npcTapHandled = true;
      this.selectNpcPatron(patron);
    });
  }

  private applySavedLayout(): void {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedLayout;
      if (Array.isArray(saved?.hiredStaff)) {
        this.hiredStaffIds = saved.hiredStaff.filter((id) => typeof id === 'string');
      }
      if (typeof saved?.money === 'number' && Number.isFinite(saved.money)) {
        this.money = Math.max(0, Math.floor(saved.money));
      }
      loadTips(saved?.staffTips);
      if (!Array.isArray(saved?.furniture)) return;
      // Ensure shop catalog available before restoring purchased pieces
      this.loadShopCatalog();
      const kept = new Set<string>();
      for (const item of saved.furniture) {
        if (!item || typeof item.id !== 'string') {
          this.layoutMigrated = true;
          continue;
        }
        let def = this.scenario.furniture.find((f) => f.id === item.id);
        if (!def && item.catalogId) {
          // Footprint always comes from the catalog (single fixed pose): a saved footprint may be a
          // rotated / older one, so it is never trusted.
          const spawned = this.defFromShopCatalog(item.catalogId, item.id);
          if (spawned) {
            this.scenario.furniture.push(spawned);
            def = spawned;
          }
        }
        if (!def) {
          // Removed piece (bar, DJ booth, pinball, neon placeholder furniture): drop it from the save.
          this.layoutMigrated = true;
          continue;
        }
        kept.add(def.id);
        // Old saves: rotated pieces / other footprints (the old sofa was 1x2) / mirror flags are forced
        // to the one fixed pose; the saved tile is kept (clamped to the map) and
        // ensureAllFurnitureInsideFloor() nudges it to the nearest valid tile.
        const savedFp = Array.isArray(item.footprint) ? item.footprint : null;
        if (
          (item.facing && item.facing !== FIXED_FACING) ||
          item.flipX ||
          (savedFp && (savedFp[0] !== def.footprint[0] || savedFp[1] !== def.footprint[1]))
        ) {
          this.layoutMigrated = true;
        }
        def.facing = FIXED_FACING;
        if (
          Array.isArray(item.tile) &&
          item.tile.length === 2 &&
          Number.isFinite(item.tile[0]) &&
          Number.isFinite(item.tile[1])
        ) {
          const { cols, rows } = this.scenario.map;
          def.tile = [
            Phaser.Math.Clamp(Math.round(item.tile[0]), 0, Math.max(0, cols - def.footprint[0])),
            Phaser.Math.Clamp(Math.round(item.tile[1]), 0, Math.max(0, rows - def.footprint[1])),
          ];
        }
        if (typeof item.price === 'number' && item.price > 0) {
          def.price = item.price;
        }
        this.applyStatsFromSaved(def, item);
      }
      // Starter pieces added after this save was made (the drink bar) are offered ONCE: a save
      // without the `seeded` marker gets the bar at its starting spot (nearest free tile if taken);
      // after that the saved list is authoritative, so a deleted bar stays deleted.
      const seeded = new Set(Array.isArray(saved.seeded) ? saved.seeded : []);
      for (const starter of ['bar']) {
        if (seeded.has(starter)) continue;
        const def = this.scenario.furniture.find((f) => f.id === starter);
        if (!def || kept.has(def.id)) continue;
        kept.add(def.id);
        this.layoutMigrated = true;
        // Place it relative to the pieces the save already holds
        this.scenario.furniture = this.scenario.furniture.filter((f) => kept.has(f.id));
        if (!this.poseAllowed(def, def.tile[0], def.tile[1])) {
          const found = this.findNearestValidTile(def);
          if (found) def.tile = found;
        }
      }
      // Saved list is authoritative: deleted pieces stay gone across reload
      this.scenario.furniture = this.scenario.furniture.filter((f) => kept.has(f.id));
    } catch {
      // ignore corrupt layout
    }
  }

  private persistLayout(): void {
    const payload: SavedLayout = {
      furniture: this.scenario.furniture.map((f) => ({
        id: f.id,
        tile: [...f.tile] as [number, number],
        facing: FIXED_FACING,
        catalogId: f.catalogId,
        footprint: [...f.footprint] as [number, number],
        price: f.price,
        durability: f.durability,
        comfort: f.comfort,
        cleanliness: f.cleanliness,
        maxDurability: f.maxDurability,
        maxComfort: f.maxComfort,
        maxCleanliness: f.maxCleanliness,
      })),
      hiredStaff: [...this.hiredStaffIds],
      money: this.money,
      seeded: ['bar'],
      staffTips: serializeTips(),
    };
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    } catch {
      // private mode / quota
    }
  }

  /** Normal character depth vs furniture — Luna always full-body visible. */
  private syncBartenderBarDepth(): void {
    if (!this.bartender) return;
    const g = this.bartender.grid;
    this.bartender.setVisible(true);
    this.bartender.setDepth(depthForCharacter(g.col, g.row));
  }

  private rebuildPathfinder(): void {
    const { cols, rows } = this.scenario.map;
    const blocked = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    // Solid collision: every placed piece footprint blocks pathfinding.
    for (const f of this.scenario.furniture) {
      const fw = Math.max(1, f.footprint?.[0] ?? 1);
      const fh = Math.max(1, f.footprint?.[1] ?? 1);
      for (let dc = 0; dc < fw; dc++) {
        for (let dr = 0; dr < fh; dr++) {
          blocked.add(`${f.tile[0] + dc},${f.tile[1] + dr}`);
        }
      }
    }
    this.pathfinder = new Pathfinder(cols, rows, blocked);
    if (this.bartender) {
      this.bartender.setPathfinder(this.pathfinder);
    }
    for (const s of this.extraStaff) {
      s.setPathfinder(this.pathfinder);
    }
    // Critical: patrons kept stale pathfinders and could walk through moved/shop furniture.
    for (const p of this.patrons) {
      p.setPathfinder(this.pathfinder);
    }
  }

  private tileInBounds(col: number, row: number, footprint: [number, number]): boolean {
    const { cols, rows } = this.scenario.map;
    return (
      col >= 0 &&
      row >= 0 &&
      col + footprint[0] - 1 < cols &&
      row + footprint[1] - 1 < rows
    );
  }

  private canPlaceFurniture(def: FurnitureDef, col: number, row: number): boolean {
    if (!this.tileInBounds(col, row, def.footprint)) return false;
    const wall = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    // Never block where patrons enter / leave.
    wall.add(`${this.scenario.spawnTile[0]},${this.scenario.spawnTile[1]}`);
    wall.add(`${this.scenario.exitTile[0]},${this.scenario.exitTile[1]}`);
    for (let dc = 0; dc < def.footprint[0]; dc++) {
      for (let dr = 0; dr < def.footprint[1]; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (wall.has(`${c},${r}`)) return false;
        // collide with other furniture
        for (const other of this.scenario.furniture) {
          if (other.id === def.id) continue;
          for (let oc = 0; oc < other.footprint[0]; oc++) {
            for (let or_ = 0; or_ < other.footprint[1]; or_++) {
              if (other.tile[0] + oc === c && other.tile[1] + or_ === r) return false;
            }
          }
        }
      }
    }
    return true;
  }

  /** Display size (px) of a piece: per-instance override, else its catalog entry. */
  private furnitureDisplaySize(kind: string, def?: FurnitureDef): { w: number; h: number } {
    if (def?.displayW && def?.displayH) return { w: def.displayW, h: def.displayH };
    const cat = this.shopCatalogById.get(def?.catalogId ?? kind) ?? this.shopCatalogById.get(kind);
    if (cat) return { w: cat.displaySize[0], h: cat.displaySize[1] };
    return { w: 96, h: 72 };
  }

  private furnitureWorldPos(
    kind: string,
    col: number,
    row: number,
    def?: FurnitureDef
  ): { x: number; y: number } {
    const { x, y } = tileToScreen(col, row, this.iso);
    const cat = this.shopCatalogById.get(def?.catalogId ?? kind) ?? this.shopCatalogById.get(kind);
    const bv = def?.baseVertex ?? cat?.baseVertex;
    if (def && bv) {
      // Exact tile snapping: the sprite's measured base vertex (2x art px) is pinned to the footprint's
      // bottom vertex, so the art's ground contact lands on the footprint diamond.
      const frame = this.textures.getFrame(this.furnitureTextureKey(kind, def));
      const size = this.furnitureDisplaySize(kind, def);
      const sx = size.w / frame.realWidth;
      const sy = size.h / frame.realHeight;
      const fw = Math.max(1, def.footprint?.[0] ?? 1);
      const fh = Math.max(1, def.footprint?.[1] ?? 1);
      const half = this.iso.tileWidth / 2;
      const q = this.iso.tileHeight / 2;
      return {
        x: x + (fw - fh) * half - (bv[0] - frame.realWidth / 2) * sx,
        y: y + (fw + fh - 1) * q - (bv[1] - frame.realHeight / 2) * sy,
      };
    }
    if (typeof def?.yBias === 'number') return { x, y: y + def.yBias };
    return { x, y: y + (cat?.yBias ?? -8) };
  }

  /**
   * Tile-integer, footprint-only placement: 12x12 map bounds + blocked tiles (stage) + other
   * furniture. Every piece has one fixed orientation, so there is no facing to consider.
   */
  private poseAllowed(def: FurnitureDef, col: number, row: number): boolean {
    return this.canPlaceFurniture(def, col, row);
  }

  private setFurnitureDragTint(id: SelectedFurniture, valid: boolean): void {
    if (!id) return;
    const img = this.getFurnitureImage(id);
    if (!img) return;
    if (!valid) {
      img.setTint(0xff4466);
      return;
    }
    // Restore selection tint while dragging/selected
    img.setTint(0xffd8a8);
  }

  private ensureAllFurnitureInsideFloor(): void {
    for (const def of this.scenario.furniture) {
      def.facing = FIXED_FACING;
      if (this.poseAllowed(def, def.tile[0], def.tile[1])) continue;
      const found = this.findNearestValidTile(def);
      if (!found) continue;
      def.tile = found;
      this.layoutMigrated = true;
      this.repositionFurnitureVisual(def.id);
    }
    this.rebuildPathfinder();
  }

  private findNearestValidTile(def: FurnitureDef): [number, number] | null {
    const { cols, rows } = this.scenario.map;
    const [sc, sr] = def.tile;
    for (let rad = 0; rad < Math.max(cols, rows); rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (rad > 0 && Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = sc + dc;
          const r = sr + dr;
          if (this.poseAllowed(def, c, r)) return [c, r];
        }
      }
    }
    return null;
  }

  private drawRoom(cols: number, rows: number): void {
    const { originX, originY, tileWidth, tileHeight } = this.iso;
    const floor = this.cache.json.get('floor') as FloorData;
    const S = floor.textureScale || 2;
    const dispW = ((cols + rows) * tileWidth) / 2;
    const dispH = ((cols + rows) * tileHeight) / 2;
    const vx = originX;
    const vy = originY - tileHeight / 2; // top vertex of tile (0,0)

    if (floor.image && this.textures.exists(floor.image.texture)) {
      // Single-image floor: ONE picture of the whole 12x12 diamond (1536x768 px at 2x), exact 2:1
      // edges, top vertex pinned to tile (0,0)'s top vertex, shown at 1/textureScale. No tiles, no seams.
      const frame = this.textures.getFrame(floor.image.texture);
      this.roomImage = this.add.image(vx, vy, floor.image.texture);
      this.roomImage.setOrigin(0.5, 0);
      this.roomImage.setDisplaySize(dispW, dispH);
      if (Math.abs(frame.realWidth / S - dispW) > 0.5 || Math.abs(frame.realHeight / S - dispH) > 0.5) {
        console.warn(
          `[floor] image ${frame.realWidth}x${frame.realHeight} is not ${dispW * S}x${dispH * S}; stretched to fit the grid`
        );
      }
      this.roomImage.setDepth(0);
      this.floorPixelSize = { w: dispW, h: dispH };
    } else {
      for (const t of floor.types) this.requireTexture(t.texture);
      // Tile mode: every tile (its own 128x64 diamond texture, masked to the exact 2:1 pixel diamond)
      // is stamped into one canvas texture at startup: no seams/gaps at any zoom.
      const built = buildFloorTexture(this, floor, cols, rows);
      this.roomImage = this.add.image(vx, vy, built.key);
      this.roomImage.setOrigin(built.vertexX / built.width, 0);
      this.roomImage.setScale(1 / S);
      this.roomImage.setDepth(0);
      this.floorPixelSize = { w: built.width / S, h: built.height / S };
    }

    // Construir-only faint grid of tile diamonds (never shown in normal play).
    const g = this.add.graphics();
    g.lineStyle(1, 0xf2dcae, 0.20);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = tileToScreen(col, row, this.iso);
        const hw = tileWidth / 2;
        const hh = tileHeight / 2;
        g.beginPath();
        g.moveTo(x, y - hh);
        g.lineTo(x + hw, y);
        g.lineTo(x, y + hh);
        g.lineTo(x - hw, y);
        g.closePath();
        g.strokePath();
      }
    }
    g.setDepth(1);
    g.setVisible(this.buildMode);
    this.buildGrid = g;
  }

  /** World centre of the 12x12 floor diamond. */
  private floorCenter(): { x: number; y: number } {
    const { cols, rows } = this.scenario.map;
    return tileToScreen((cols - 1) / 2, (rows - 1) / 2, this.iso);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;

    // Slight zoom-out on narrow / mobile viewports (pinch/wheel can still go to ZOOM_MIN/MAX)
    const w = cam.width;
    let zoom = 1;
    if (w < 420) zoom = 0.72;
    else if (w < 560) zoom = 0.8;
    else if (w < 720) zoom = 0.9;
    cam.setZoom(Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX));
    this.refreshCameraBounds();
    const fc = this.floorCenter();
    cam.centerOn(fc.x, fc.y + 20);
  }

  /** World scroll bounds around the room — call after zoom so corners stay reachable. */
  private refreshCameraBounds(): void {
    const cam = this.cameras.main;
    if (!this.roomImage) return;
    const pad = 100;
    const c = this.floorCenter();
    const w = this.floorPixelSize.w;
    const h = this.floorPixelSize.h;
    // Bounds hug the 768x384 diamond (+pad), but are never smaller than the visible world area:
    // Phaser pins an undersized bounds box to its top-left corner, which would push the floor off
    // centre on wide screens / when zoomed out. A bigger box stays centred on the floor.
    const bw = Math.max(w + pad * 2, cam.width / cam.zoom);
    const bh = Math.max(h + pad * 2 + 40, cam.height / cam.zoom);
    const bcx = c.x;
    const bcy = c.y - 20;
    cam.setBounds(bcx - bw / 2, bcy - bh / 2, bw, bh);
  }

  /**
   * Set zoom while keeping the given screen point (pinch midpoint / cursor) stable in world space.
   */
  private setZoomAt(nextZoom: number, screenX: number, screenY: number): void {
    const cam = this.cameras.main;
    const z = Phaser.Math.Clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(z - cam.zoom) < 0.0001) {
      this.refreshCameraBounds();
      return;
    }
    const before = cam.getWorldPoint(screenX, screenY);
    cam.setZoom(z);
    const after = cam.getWorldPoint(screenX, screenY);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.refreshCameraBounds();
  }

  private setupZoom(): void {
    // Second finger for pinch-to-zoom on mobile
    this.input.addPointer(2);

    this.input.on(
      'wheel',
      (
        pointer: Phaser.Input.Pointer,
        _gos: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number
      ) => {
        if (this.isPointerOverHud(pointer)) return;
        const cam = this.cameras.main;
        const factor = dy > 0 ? 1 - WHEEL_ZOOM_STEP : 1 + WHEEL_ZOOM_STEP;
        this.setZoomAt(cam.zoom * factor, pointer.x, pointer.y);
      }
    );

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.activePinchPointers() >= 2) {
        this.beginPinch();
      }
      void p;
    });

    this.input.on('pointermove', () => {
      if (this.activePinchPointers() >= 2) {
        if (!this.pinching) this.beginPinch();
        else this.updatePinch();
      }
    });

    const endPinch = () => {
      if (this.pinching) {
        this.pinching = false;
        // Avoid treating pinch release as a world tap
        this.skipNextTap = true;
        this.time.delayedCall(0, () => {
          this.skipNextTap = false;
        });
      }
    };
    this.input.on('pointerup', endPinch);
    this.input.on('pointerupoutside', endPinch);
  }

  private activePinchPointers(): number {
    let n = 0;
    for (const ptr of this.input.manager.pointers) {
      if (ptr && ptr.active && ptr.isDown) n++;
    }
    return n;
  }

  private beginPinch(): void {
    const pts = this.input.manager.pointers.filter((p) => p && p.active && p.isDown);
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    this.pinching = true;
    this.pinchStartDist = Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y));
    this.pinchStartZoom = this.cameras.main.zoom;
    this.pinchMidX = (a.x + b.x) / 2;
    this.pinchMidY = (a.y + b.y) / 2;
    // Pinch ≠ pan: cancel any one-finger pan / furniture drag start
    this.panActive = false;
    this.panDragging = false;
    this.blockPanGesture = true;
  }

  private updatePinch(): void {
    const pts = this.input.manager.pointers.filter((p) => p && p.active && p.isDown);
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    const dist = Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y));
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const scale = dist / this.pinchStartDist;
    this.setZoomAt(this.pinchStartZoom * scale, midX, midY);
    this.pinchMidX = midX;
    this.pinchMidY = midY;
  }

  private setupPointerPan(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      if (this.isPointerOverHud(p)) return;
      if (this.furnDragging || this.blockPanGesture) return;
      // Two-finger touch is pinch zoom, not pan
      if (this.activePinchPointers() >= 2 || this.pinching) return;
      this.panActive = true;
      this.panDragging = false;
      this.panStartX = p.x;
      this.panStartY = p.y;
      this.panScrollX = this.cameras.main.scrollX;
      this.panScrollY = this.cameras.main.scrollY;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pinching || this.activePinchPointers() >= 2) {
        // Pinch owns the gesture — do not pan or drag furniture
        this.panActive = false;
        this.panDragging = false;
        return;
      }
      if (this.furnDragging && this.furnDragId) {
        this.dragFurnitureToPointer(p);
        return;
      }
      if (!this.panActive || !p.isDown) return;
      const dx = p.x - this.panStartX;
      const dy = p.y - this.panStartY;
      if (!this.panDragging) {
        if (Math.hypot(dx, dy) < TAP_THRESH) return;
        this.panDragging = true;
      }
      // Drag moves the world with the finger (scroll opposite to delta)
      const cam = this.cameras.main;
      cam.setScroll(this.panScrollX - dx / cam.zoom, this.panScrollY - dy / cam.zoom);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.furnDragging) {
        this.endFurnitureDrag();
      }
      const wasPanDrag = this.panDragging;
      if (wasPanDrag) {
        this.skipNextTap = true;
        this.time.delayedCall(0, () => {
          this.skipNextTap = false;
        });
      }
      this.panActive = false;
      this.panDragging = false;
      this.blockPanGesture = false;

      // World tap with staff selected: walk / inspect furniture
      // (NPC handlers set npcTapHandled first; ✕ still deselects via panel)
      if (
        !wasPanDrag &&
        !this.npcTapHandled &&
        !this.buildMode &&
        p.getDistance() <= TAP_THRESH &&
        !this.isPointerOverHud(p)
      ) {
        this.handleWorldTap(p);
      } else if (!wasPanDrag && !this.npcTapHandled) {
      }
      this.npcTapHandled = false;
    });

    this.input.on('pointerupoutside', () => {
      if (this.furnDragging) this.endFurnitureDrag();
      this.panActive = false;
      this.panDragging = false;
      this.blockPanGesture = false;
    });
  }

  private isPointerOverHud(p: Phaser.Input.Pointer): boolean {
    if (this.deleteConfirmOpen) return true;
    if (p.y < HUD_TOP) return true;
    const ui = this.scene.get('UIScene') as Phaser.Scene & {
      isPointerOnUi?: (p: Phaser.Input.Pointer) => boolean;
    };
    if (ui?.isPointerOnUi?.(p)) return true;
    return false;
  }

  /** Texture key of a piece's single art. */
  private furnitureTextureKey(kind: string, def?: FurnitureDef): string {
    const src = def ?? this.scenario.furniture.find((f) => f.id === kind || f.type === kind);
    const fromScenario = src?.sprites?.sw;
    if (fromScenario) return fromScenario;
    const cat =
      this.shopCatalogById.get(src?.catalogId ?? '') ||
      this.shopCatalogById.get(src?.type ?? '') ||
      this.shopCatalogById.get(kind);
    if (cat) return cat.sprite;
    if (src?.sprite && this.textures.exists(src.sprite)) return src.sprite;
    return `furn_${kind}`;
  }


  private placeFurniture(): void {
    for (const f of this.scenario.furniture) {
      this.ensureShopFlags(f);
      if (f.fromShop || f.catalogId) this.spawnShopFurnitureVisual(f);
    }
    const anchor = this.scenario.furniture[0];
    const pos = anchor
      ? tileToScreen(anchor.tile[0], anchor.tile[1], this.iso)
      : { x: this.iso.originX, y: this.iso.originY + 120 };
    this.buildSelectionHud(pos.x, pos.y);
  }

  private beginFurniturePointer(p: Phaser.Input.Pointer, id: SelectedFurniture): void {
    if (!this.buildMode || !id) return;
    if (this.deleteConfirmOpen || this.isPointerOverHud(p)) return;
    this.selectFurniture(id);
    this.furnDragging = true;
    this.furnDragId = id;
    // Prevent camera pan from starting on the same gesture
    this.blockPanGesture = true;
    this.panActive = false;
    this.panDragging = false;
    void p;
  }

  private dragFurnitureToPointer(p: Phaser.Input.Pointer): void {
    if (!this.furnDragId) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const tile = screenToTile(world.x, world.y, this.iso);
    const id = this.furnDragId;
    const def = this.getFurnitureDef(id);
    if (!def) return;
    const ok = this.poseAllowed(def, tile.col, tile.row);
    this.dragPoseValid = ok;
    this.setFurnitureDragTint(id, ok);
    if (!ok) return; // keep last valid tile (snap-back authority)
    this.moveFurnitureTo(id, tile.col, tile.row, false);
  }

  private endFurnitureDrag(): void {
    if (this.furnDragId) {
      // Ensure selection tint (not red) after a rejected edge drag
      this.setFurnitureDragTint(this.furnDragId, true);
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncBartenderBarDepth();
    }
    this.furnDragging = false;
    this.furnDragId = null;
    this.dragPoseValid = true;
  }

  private moveFurnitureTo(
    id: SelectedFurniture,
    col: number,
    row: number,
    persist: boolean
  ): void {
    if (!id) return;
    const def = this.getFurnitureDef(id);
    if (!def) return;
    if (!this.poseAllowed(def, col, row)) return;
    if (def.tile[0] === col && def.tile[1] === row) return;
    def.tile = [col, row];
    this.repositionFurnitureVisual(id);
    if (persist) {
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncBartenderBarDepth();
    }
  }

  private repositionFurnitureVisual(id: SelectedFurniture): void {
    if (!id) return;
    const def = this.getFurnitureDef(id);
    const img = this.shopImages.get(def?.id ?? id);
    if (!def || !img) return;
    const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
    img.setPosition(pos.x, pos.y);
    img.setDepth(depthForFurniture(def.tile[0], def.tile[1], def.footprint));
    if (this.selectedFurniture === def.id) {
      this.selectionHud.setPosition(pos.x, pos.y - 78);
    }
    this.refreshDirtOverlay(def);
  }

  private buildSelectionHud(x: number, y: number): void {
    this.selectionHud = this.add.container(x, y - 70).setDepth(9000).setVisible(false);

    this.selectionHudBg = this.add.rectangle(0, 0, 108, 40, 0x1a0e28, 0.92);
    this.selectionHudBg.setStrokeStyle(1, 0xff3ca0);

    const c = this.add.container(0, 0);
    const b = this.add.rectangle(0, 0, 84, 28, 0x8a2048, 1);
    b.setStrokeStyle(1, 0xff6a9a);
    b.setInteractive({ useHandCursor: true });
    const t = this.add
      .text(0, 0, 'Eliminar', { fontSize: '12px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5);
    b.on('pointerover', () => b.setFillStyle(0xaa3060));
    b.on('pointerout', () => b.setFillStyle(0x8a2048));
    b.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      if (this.deleteConfirmOpen) return;
      this.blockPanGesture = true;
      this.panActive = false;
      this.requestDeleteSelected();
    });
    c.add([b, t]);
    this.deleteBtn = c;
    this.selectionHud.add([this.selectionHudBg, this.deleteBtn]);
  }

  private requestDeleteSelected(): void {
    if (!this.buildMode || !this.selectedFurniture || this.deleteConfirmOpen) return;
    const def = this.getFurnitureDef(this.selectedFurniture);
    if (!def || !def.id) return;
    const refund = this.refundForFurniture(def);
    this.deleteConfirmOpen = true;
    this.blockPanGesture = true;
    this.panActive = false;
    this.furnDragging = false;
    this.furnDragId = null;
    // Pass id in the open payload so UIScene can echo it back on Sí (selection may race-clear).
    this.game.events.emit('ui-delete-confirm', { id: def.id, refund });
  }

  /** Wear-scaled sell-back; 0 when price unknown or durability < 50%. */
  private refundForFurniture(def: FurnitureDef): number {
    this.ensureFurnitureStats(def);
    const price = this.purchasePriceOf(def);
    if (price <= 0) return 0;
    const st = this.statsOf(def);
    return refundForWear(price, st.durability, st.maxDurability);
  }

  private purchasePriceOf(def: FurnitureDef): number {
    if (typeof def.price === 'number' && def.price > 0) return Math.floor(def.price);
    if (def.catalogId) {
      const cat = this.shopCatalogById.get(def.catalogId);
      if (cat && cat.price > 0) return Math.floor(cat.price);
    }
    const cat = this.shopCatalogById.get(def.type);
    if (cat && cat.price > 0) return Math.floor(cat.price);
    return 0;
  }

  private hideDeleteConfirmUi(): void {
    const wasOpen = this.deleteConfirmOpen;
    this.deleteConfirmOpen = false;
    if (wasOpen) this.game.events.emit('ui-delete-confirm-hide');
  }

  /**
   * Sí from UIScene — delete ONLY payload.id. Do not fall back to selectedFurniture
   * (pointer races can clear selection while the modal is open).
   */
  private onCmdConfirmDeleteFurniture = (payload?: { id?: string }): void => {
    this.deleteConfirmOpen = false;
    // Prefer the id the modal carried; fall back to the current selection so a Sí never no-ops.
    let id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id || !this.getFurnitureDef(id)) id = this.selectedFurniture ?? '';
    if (!id) {
      this.buildHint.setText('No se pudo eliminar: selecciona el mueble otra vez').setVisible(true);
      return;
    }
    if (!this.buildMode) return;
    this.confirmDeleteFurniture(id);
  };

  private onCmdCancelDeleteFurniture = (): void => {
    this.deleteConfirmOpen = false;
  };

  private confirmDeleteFurniture(id: SelectedFurniture): void {
    if (!this.buildMode || !id) return;
    this.deleteFurniture(id);
  }

  /** Remove by id only — never requires selectedFurniture to still match. */
  private deleteFurniture(id: SelectedFurniture): void {
    if (!id || !this.buildMode) return;
    const def = this.getFurnitureDef(id);
    if (!def || !def.id) return;

    const refund = this.refundForFurniture(def);
    if (refund > 0) {
      this.money += refund;
    }

    const fid = def.id;
    // Side effects must never block the removal itself (a throw here used to leave the piece in place).
    const safe = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        console.warn('[delete] side effect failed', err);
      }
    };
    safe(() => this.destroyDirtOverlay(fid));
    safe(() => this.cleanClaim.delete(fid));
    safe(() => this.releasePatronsAtFurniture(fid));
    safe(() => {
      if (this.inspectedFurnitureId === fid) this.closeFurnitureInspect();
    });

    // Destroy the sprite (keyed by instance id; also try the selection alias)
    for (const key of new Set([fid, id])) {
      const img = this.shopImages.get(key);
      if (img) {
        img.destroy();
        this.shopImages.delete(key);
      }
    }

    this.scenario.furniture = this.scenario.furniture.filter((f) => f.id !== fid);
    this.clearFurnitureSelection();
    this.rebuildPathfinder();
    this.persistLayout();
    this.syncFurnitureInteractive();
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitShopCatalog();
    const hint =
      refund > 0
        ? `Mueble eliminado · +$${refund} reembolsados`
        : 'Mueble eliminado · sin reembolso';
    this.buildHint.setText(hint).setVisible(true);
  }

  private releasePatronsAtFurniture(furnitureId: string): void {
    for (const patron of this.patrons) {
      if (patron.seatedFurnitureId !== furnitureId) continue;
      this.releasePatronSlot(patron);
      patron.seated = false;
      patron.refreshStatusLabel();
      // Continue the visit on foot instead of freezing where the sofa used to be.
      if (patron.active && this.phase === 'open') this.sendPatronWandering(patron);
    }
  }

  private selectFurniture(id: SelectedFurniture): void {
    if (!this.buildMode || !id || this.deleteConfirmOpen) return;
    this.deselectNpc();
    this.game.events.emit('npc-deselected');
    this.clearFurnitureSelection();
    const def = this.getFurnitureDef(id);
    const img = def ? this.shopImages.get(def.id) : null;
    if (!def || !img) return;
    this.selectedFurniture = def.id;
    img.setTint(0xffd8a8);
    this.selectionHud.setVisible(true);
    const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
    this.selectionHud.setPosition(pos.x, pos.y - 78);
    const name = this.furnitureDisplayName(def).toLowerCase();
    this.buildHint.setText(`Arrastra ${name} · Eliminar`).setVisible(true);
  }

  private clearFurnitureSelection(): void {
    if (this.selectedFurniture) this.shopImages.get(this.selectedFurniture)?.clearTint();
    this.selectedFurniture = null;
    if (this.selectionHud) this.selectionHud.setVisible(false);
    // Do NOT hide delete confirm here — UIScene holds pendingDelete.id for Sí;
    // selection may clear from pointer races while the modal is open.
  }

  setBuildMode = (on: boolean): void => {
    if (on && this.phase === 'open') {
      this.game.events.emit('build-mode-changed', false);
      return;
    }
    this.buildMode = on;
    this.buildGrid?.setVisible(on);
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    this.closeFurnitureInspect();
    this.deselectNpc();
    this.game.events.emit('npc-deselected');
    this.syncFurnitureInteractive();
    if (on) {
      this.buildHint
        .setText('Modo Construir: toca y arrastra muebles · Tienda Muebles')
        .setVisible(true);
      this.emitShopCatalog();
    } else {
      this.buildHint.setVisible(false);
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncBartenderBarDepth();
    }
    this.game.events.emit('build-mode-changed', this.buildMode);
  };

  openNight = (): void => {
    if (this.buildMode) return;
    if (this.phase !== 'prep' && this.phase !== 'summary') return;
    if (this.phase === 'summary') {
      this.resetForNewNight();
    }
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    this.rebuildPathfinder();
    this.phase = 'open';
    this.nightEarned = 0;
    this.servedCount = 0;
    resetNightTips();
    this.nightTimer = this.scenario.nightDurationSec;
    const [min, max] = this.scenario.patronSpawnCount;
    this.spawnLeft = Phaser.Math.Between(min, max);
    this.game.events.emit('night-started', this.getHudState());
    this.scheduleSpawns();
  };

  private resetForNewNight(): void {
    this.patrons.forEach((p) => p.destroy());
    this.patrons = [];
    // Keep Luna/Nova where they are on the floor (free staff).
    this.syncBartenderBarDepth();
    this.bartender.state = 'idle';
    this.bartender.profile.energy = Math.min(100, this.bartender.profile.energy + 25);
    this.bartender.startBob();
    for (const s of this.extraStaff) {
      s.state = 'idle';
      s.startBob();
    }
  }

  private scheduleSpawns(): void {
    if (this.phase !== 'open' || this.spawnLeft <= 0) return;
    this.time.delayedCall(400, () => this.spawnPatron());
    for (let i = 1; i < this.spawnLeft; i++) {
      this.time.delayedCall(400 + i * this.scenario.spawnIntervalMs, () => {
        if (this.phase === 'open') this.spawnPatron();
      });
    }
  }

  private spawnPatron(): void {
    if (this.spawnLeft <= 0 || this.phase !== 'open') return;
    this.spawnLeft--;
    const pool = this.chars.patrons;
    const pdata = { ...pool[Phaser.Math.Between(0, pool.length - 1)] };
    pdata.id = `${pdata.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const spawn = {
      col: this.scenario.spawnTile[0],
      row: this.scenario.spawnTile[1],
    };
    const patron = new Patron(
      this,
      pdata.sprite,
      spawn,
      this.iso,
      this.pathfinder,
      pdata,
      this.drinkDisplayName(pdata.preferredDrink)
    );
    patron.reapplyDisplaySize();
    this.wirePatronClick(patron);
    this.patrons.push(patron);
    this.chooseMainPatronGoal(patron);
  }

  private drinkDisplayName(id: string): string {
    return this.drinks.find((d) => d.id === id)?.name ?? id;
  }

  private chooseMainPatronGoal(patron: Patron): void {
    if (!patron.active || this.phase !== 'open') return;
    // With a working bar everyone goes to order first (then sits or wanders); without one they
    // sit on a sofa (placeholder income) or wander.
    if (this.barUsable()) {
      this.sendPatronToBar(patron);
      return;
    }
    const bestSeat = this.listFreeSeats(patron.profile.id)[0] ?? null;
    if (
      !bestSeat ||
      Math.random() >= AI_TUNABLES.seatChance ||
      !this.claimPatronSlot(patron, bestSeat)
    ) {
      // No sofa (or none free / not feeling like sitting): just wander the floor, then leave.
      this.sendPatronWandering(patron);
      return;
    }
    this.sendPatronToSeat(patron, bestSeat);
  }

  /** Walk to an already-claimed seat tile, sit for a while, then leave. */
  private sendPatronToSeat(
    patron: Patron,
    seat: { col: number; row: number; furnitureId: string }
  ): void {
    patron.goal = 'sofa';
    patron.seatedFurnitureId = seat.furnitureId;
    const ok = patron.walkTo(seat, () => {
      if (!patron.active || this.phase !== 'open') return;
      patron.seated = true;
      patron.waiting = false;
      // Face the sofa (the tile behind the standing spot is the footprint's front row).
      patron.faceToward({ col: seat.col, row: seat.row - 1 });
      patron.refreshStatusLabel();
      patron.showBubble('😌');
      // Nearby dirt / broken furniture hurts mood while seated
      if (this.qualityNearPatron(patron) < 0.4) patron.showBubble('¡Qué sucio!');
      const sitMs = Phaser.Math.Between(AI_TUNABLES.sitDurationMinMs, AI_TUNABLES.sitDurationMaxMs);
      this.time.delayedCall(sitMs, () => {
        if (!patron.active || this.phase !== 'open' || !patron.seated) return;
        patron.seated = false;
        // Filler income only when this patron did not already pay at a bar
        if (!patron.served) this.paySofaSit(patron);
        this.releasePatronSlot(patron);
        this.sendPatronHome(patron);
      });
    });
    if (!ok) {
      this.releasePatronSlot(patron);
      this.sendPatronWandering(patron);
    }
  }

  /** Fallback income when no bar exists: a patron pays when they finish sitting on a sofa. */
  private paySofaSit(patron: Patron): void {
    const q = this.qualityNearPatron(patron);
    const base = Phaser.Math.Between(AI_TUNABLES.sofaSitPayMin, AI_TUNABLES.sofaSitPayMax);
    const earned = Math.max(
      1,
      Math.round(base * lerp(AI_TUNABLES.payQualityMin, AI_TUNABLES.payQualityMax, q))
    );
    this.money += earned;
    this.nightEarned += earned;
    this.servedCount++;
    patron.showBubble(`+$${earned}`);
    this.persistLayout();
    this.game.events.emit('stats-updated', this.getHudState());
  }

  /** Random free, walkable tile for a wandering patron (not the one they are standing on). */
  private pickWanderTile(patron: Patron): { col: number; row: number } | null {
    const { cols, rows } = this.scenario.map;
    for (let i = 0; i < 30; i++) {
      const pos = { col: Phaser.Math.Between(0, cols - 1), row: Phaser.Math.Between(0, rows - 1) };
      if (Math.abs(pos.col - patron.grid.col) + Math.abs(pos.row - patron.grid.row) < 3) continue;
      if (!this.isPatronSlotFree(pos, patron.profile.id)) continue;
      return pos;
    }
    return null;
  }

  /**
   * Walk to a few random tiles (pausing at each), then leave. This is what patrons do whenever they
   * do not sit (after their drink at the bar, or when there is no bar at all).
   */
  private sendPatronWandering(patron: Patron, stopsLeft?: number): void {
    if (!patron.active || this.phase !== 'open') return;
    const stops =
      stopsLeft ?? Phaser.Math.Between(AI_TUNABLES.wanderStopsMin, AI_TUNABLES.wanderStopsMax);
    patron.goal = 'wander';
    patron.waiting = false;
    patron.seated = false;
    if (stops <= 0) {
      this.sendPatronHome(patron);
      return;
    }
    const spot = this.pickWanderTile(patron);
    if (!spot || !this.claimPatronSlot(patron, spot)) {
      this.sendPatronHome(patron);
      return;
    }
    const ok = patron.walkTo(spot, () => {
      if (!patron.active || this.phase !== 'open') return;
      const idleMs = Phaser.Math.Between(
        AI_TUNABLES.wanderStopIdleMinMs,
        AI_TUNABLES.wanderStopIdleMaxMs
      );
      this.time.delayedCall(idleMs, () => {
        if (!patron.active || this.phase !== 'open' || patron.goal !== 'wander') return;
        this.releasePatronSlot(patron);
        this.sendPatronWandering(patron, stops - 1);
      });
    });
    if (!ok) {
      this.releasePatronSlot(patron);
      this.sendPatronHome(patron);
    }
  }

  // ─── Drink bar: patrons order at its front (SW) side, staff pour from the tile beside ─────────

  /** The first drink bar that still works (a destroyed one stops serving, like a broken sofa). */
  private activeBar(): FurnitureDef | null {
    for (const f of this.scenario.furniture) {
      if (f.type !== 'bar' && f.catalogId !== 'bar') continue;
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      if (conditionFromDurability(st.durability, st.maxDurability) === 'Inservible' || st.durability <= 0) {
        continue;
      }
      return f;
    }
    return null;
  }

  /**
   * Service tiles of the bar. Its fixed SW pose faces +row, so the front row is where people stand:
   * patrons order at the left front tile (`interact`), staff pour from the right front tile
   * (`staffSpot`). If the front is boxed in, staff use any free tile touching the bar and patrons queue.
   */
  private barSpots(): {
    bar: FurnitureDef;
    interact: { col: number; row: number } | null;
    staffSpot: { col: number; row: number };
  } | null {
    const bar = this.activeBar();
    if (!bar || !this.pathfinder) return null;
    const front = this.frontTiles(bar).filter((t) => this.pathfinder.isWalkable(t.col, t.row));
    if (front.length >= 2) return { bar, interact: front[0], staffSpot: front[1] };
    if (front.length === 1) return { bar, interact: null, staffSpot: front[0] };
    const fw = Math.max(1, bar.footprint[0]);
    const fh = Math.max(1, bar.footprint[1]);
    for (let c = bar.tile[0] - 1; c <= bar.tile[0] + fw; c++) {
      for (let r = bar.tile[1] - 1; r <= bar.tile[1] + fh; r++) {
        const inside = c >= bar.tile[0] && c < bar.tile[0] + fw && r >= bar.tile[1] && r < bar.tile[1] + fh;
        if (!inside && this.pathfinder.isWalkable(c, r)) return { bar, interact: null, staffSpot: { col: c, row: r } };
      }
    }
    return null;
  }

  /** True when a working bar exists and the entrance can reach its service tile. */
  private barUsable(): boolean {
    if (!this.drinks.length) return false;
    const spots = this.barSpots();
    if (!spots) return false;
    const spawn = { col: this.scenario.spawnTile[0], row: this.scenario.spawnTile[1] };
    return this.pathfinder.findPath(spawn, spots.staffSpot).length > 0;
  }

  /** Free tiles where patrons wait for service: the order tile first, then the closest ones to it. */
  private listBarQueueSlots(exceptPatronId?: string): Array<{ col: number; row: number }> {
    const spots = this.barSpots();
    if (!spots) return [];
    const centre = spots.interact ?? spots.staffSpot;
    const cands: Array<{ col: number; row: number; d: number }> = [];
    for (let dc = -3; dc <= 3; dc++) {
      for (let dr = -3; dr <= 3; dr++) {
        const col = centre.col + dc;
        const row = centre.row + dr;
        if (col === spots.staffSpot.col && row === spots.staffSpot.row) continue;
        if (!this.isPatronSlotFree({ col, row }, exceptPatronId)) continue;
        // Never queue on a tile a staff member stands on / is heading to
        if (this.allStaff().some((st) => st.grid.col === col && st.grid.row === row)) continue;
        if (this.staffTileClaims.has(this.tileKey({ col, row }))) continue;
        const toCentre = Math.abs(dc) + Math.abs(dr);
        // Prefer the front side of the bar (rows below it), where the order tile is
        cands.push({ col, row, d: toCentre + (row < centre.row ? 3 : 0) });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    const out = cands.slice(0, AI_TUNABLES.barQueueMaxSlots).map((c) => ({ col: c.col, row: c.row }));
    return out;
  }

  /** Walk to a free queue tile at the bar and wait for a staff member to serve the preferred drink. */
  private sendPatronToBar(patron: Patron): void {
    const slots = this.listBarQueueSlots(patron.profile.id);
    const spot = slots[0];
    if (!spot || !this.claimPatronSlot(patron, spot)) {
      // Bar is packed: skip the drink and just wander.
      this.sendPatronWandering(patron);
      return;
    }
    patron.goal = 'bar';
    const ok = patron.walkTo(spot, () => {
      if (!patron.active || this.phase !== 'open') return;
      patron.waiting = true;
      patron.seated = false;
      const bar = this.barSpots()?.bar;
      if (bar) patron.faceToward({ col: spot.col, row: spot.row - 1 });
      patron.refreshStatusLabel();
      patron.showBubble(this.drinkDisplayName(patron.profile.preferredDrink));
      this.tryAssignServeAi(patron);
    });
    if (!ok) {
      this.releasePatronSlot(patron);
      this.sendPatronWandering(patron);
    }
  }

  /** After paying at the bar: sit on a free sofa seat (if they feel like it) or wander, then leave. */
  private afterBarService(patron: Patron): void {
    if (!patron.active || this.phase !== 'open') return;
    const seat = this.listFreeSeats(patron.profile.id)[0] ?? null;
    if (seat && Math.random() < AI_TUNABLES.seatChance && this.claimPatronSlot(patron, seat)) {
      this.sendPatronToSeat(patron, seat);
    } else {
      this.sendPatronWandering(patron);
    }
  }

  /** Pay + tip from drink price scaled by venue quality / patience / broken furniture. */
  private computeServePayout(
    patron: Patron,
    drink: Drink
  ): { earned: number; tipped: boolean; tipAmount: number } {
    const q = this.qualityNearPatron(patron);
    const payMult = lerp(AI_TUNABLES.payQualityMin, AI_TUNABLES.payQualityMax, q);
    let tipChance = patron.profile.tipChance * (0.55 + 0.9 * q);
    if (patron.impatient) tipChance *= AI_TUNABLES.impatientTipChanceScale;
    for (const f of this.scenario.furniture) {
      const dist = Math.abs(f.tile[0] - patron.grid.col) + Math.abs(f.tile[1] - patron.grid.row);
      if (dist > 3) continue;
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      if (cond === 'Inservible' || cond === 'Se rompió') {
        tipChance *= 0.4;
        break;
      }
    }
    const drinkPay = Math.max(1, Math.round(drink.price * payMult));
    let tipAmount = 0;
    let tipped = false;
    if (Math.random() < tipChance) {
      const tipBase = Math.max(1, Math.ceil(drink.price * 0.25));
      tipAmount = Math.max(
        1,
        Math.round(tipBase * lerp(AI_TUNABLES.tipQualityMin, AI_TUNABLES.tipQualityMax, q))
      );
      tipped = true;
    }
    return { earned: drinkPay + tipAmount, tipped, tipAmount };
  }

  // ─── Patron seats / queues / venue quality ───────────────────────────

  private slotKey(pos: { col: number; row: number }): string {
    return `${pos.col},${pos.row}`;
  }

  private releasePatronSlot(patron: Patron): void {
    if (patron.claimedSlotKey) {
      const holder = this.patronSlotClaims.get(patron.claimedSlotKey);
      if (holder === patron.profile.id) this.patronSlotClaims.delete(patron.claimedSlotKey);
      patron.claimedSlotKey = null;
    }
    patron.seatedFurnitureId = null;
    this.releaseTile(patron.grid);
  }

  private isPatronSlotFree(pos: { col: number; row: number }, exceptId?: string): boolean {
    const k = this.slotKey(pos);
    const claimed = this.patronSlotClaims.get(k);
    if (claimed && claimed !== exceptId) return false;
    if (this.queueTiles.has(k) && claimed !== exceptId) {
      // queueTiles used by legacy findFreeNear — treat as occupied unless we own it
      if (!exceptId || claimed !== exceptId) {
        // allow if only reserved via queueTiles without claim map (legacy)
      }
    }
    for (const p of this.patrons) {
      if (!p.active) continue;
      if (exceptId && p.profile.id === exceptId) continue;
      if (p.grid.col === pos.col && p.grid.row === pos.row) return false;
      if (p.claimedSlotKey === k) return false;
    }
    return this.pathfinder.isWalkable(pos.col, pos.row);
  }

  private claimPatronSlot(patron: Patron, pos: { col: number; row: number }): boolean {
    if (!this.isPatronSlotFree(pos, patron.profile.id)) return false;
    this.releasePatronSlot(patron);
    const k = this.slotKey(pos);
    this.patronSlotClaims.set(k, patron.profile.id);
    patron.claimedSlotKey = k;
    this.queueTiles.add(k);
    return true;
  }

  /** Row of tiles just in front of a piece (its fixed SW pose faces +row): where patrons stand to sit. */
  private frontTiles(def: FurnitureDef): Array<{ col: number; row: number }> {
    const fw = Math.max(1, def.footprint[0]);
    const fh = Math.max(1, def.footprint[1]);
    const out: Array<{ col: number; row: number }> = [];
    for (let i = 0; i < fw; i++) out.push({ col: def.tile[0] + i, row: def.tile[1] + fh });
    return out;
  }

  /** Walkable seat tiles for a seatable piece (the sofa: its front row). */
  private seatSlotsForFurniture(def: FurnitureDef): Array<{ col: number; row: number; comfort: number; furnitureId: string }> {
    this.ensureFurnitureStats(def);
    const st = this.statsOf(def);
    const cond = conditionFromDurability(st.durability, st.maxDurability);
    if (cond === 'Inservible' || st.durability <= 0) return [];
    const comfortScore = st.comfort * (0.55 + 0.45 * (st.cleanliness / Math.max(1, st.maxCleanliness)));
    const out: Array<{ col: number; row: number; comfort: number; furnitureId: string }> = [];
    for (const pos of this.frontTiles(def)) {
      if (!this.pathfinder.isWalkable(pos.col, pos.row)) continue;
      out.push({ col: pos.col, row: pos.row, comfort: comfortScore, furnitureId: def.id });
    }
    return out;
  }

  private listFreeSeats(exceptPatronId?: string): Array<{ col: number; row: number; comfort: number; furnitureId: string }> {
    const seats: Array<{ col: number; row: number; comfort: number; furnitureId: string }> = [];
    for (const f of this.scenario.furniture) {
      const type = (f.type || '').toLowerCase();
      const catalog = (f.catalogId || '').toLowerCase();
      if (!SEATABLE_TYPES.has(type) && !SEATABLE_TYPES.has(catalog)) continue;
      for (const s of this.seatSlotsForFurniture(f)) {
        if (this.isPatronSlotFree(s, exceptPatronId)) seats.push(s);
      }
    }
    seats.sort((a, b) => b.comfort - a.comfort);
    return seats;
  }

  /** 0–1 venue quality from club-average cleanliness & comfort (broken pieces hurt). */
  private clubVenueQuality(): number {
    const furniture = this.scenario.furniture;
    if (!furniture.length) return 0.55;
    let cleanSum = 0;
    let comfortSum = 0;
    let broken = 0;
    for (const f of furniture) {
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      const cleanR = st.cleanliness / Math.max(1, st.maxCleanliness);
      cleanSum += cleanR;
      comfortSum += st.maxComfort > 0 ? st.comfort / st.maxComfort : cleanR;
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      if (cond === 'Inservible' || cond === 'Se rompió') broken++;
    }
    const n = furniture.length;
    let q = 0.55 * (cleanSum / n) + 0.45 * (comfortSum / n);
    q -= (broken / n) * 0.35;
    return Math.max(0, Math.min(1, q));
  }

  private qualityNearPatron(patron: Patron): number {
    const club = this.clubVenueQuality();
    // Blend club average with nearest furniture stats
    let best = club;
    let bestDist = 99;
    for (const f of this.scenario.furniture) {
      this.ensureFurnitureStats(f);
      const dist = Math.abs(f.tile[0] - patron.grid.col) + Math.abs(f.tile[1] - patron.grid.row);
      if (dist > 4 || dist >= bestDist) continue;
      const st = this.statsOf(f);
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      const cleanR = st.cleanliness / Math.max(1, st.maxCleanliness);
      let local =
        0.55 * cleanR + 0.45 * (st.maxComfort > 0 ? st.comfort / st.maxComfort : cleanR);
      if (cond === 'Inservible' || cond === 'Se rompió') local *= 0.25;
      best = local;
      bestDist = dist;
    }
    return Math.max(0, Math.min(1, club * 0.45 + best * 0.55));
  }


  private releaseTile(pos: { col: number; row: number }): void {
    this.queueTiles.delete(`${pos.col},${pos.row}`);
  }

  private sendPatronHome(patron: Patron): void {
    if (!patron.active) return;
    patron.waiting = false;
    patron.seated = false;
    this.releasePatronSlot(patron);
    this.releaseTile(patron.grid);
    patron.goal = 'leave';
    const exit = {
      col: this.scenario.exitTile[0],
      row: this.scenario.exitTile[1],
    };
    const gone = () => {
      if (this.selectedNpcId === patron.profile.id) {
        this.deselectNpc();
        this.game.events.emit('npc-deselected');
      }
      this.patrons = this.patrons.filter((p) => p !== patron);
      patron.destroy();
    };
    // No route to the exit (boxed in by furniture): leave on the spot instead of freezing forever.
    if (!patron.walkTo(exit, gone)) gone();
  }


  private loadStaffPool(): void {
    const pool = this.cache.json.get('staff_pool') as StaffPoolFile | undefined;
    this.staffPool = Array.isArray(pool?.candidates) ? pool!.candidates : [];
  }

  /** Nova (and any cost-0 / starter candidates) always spawn as free staff. */
  private ensureFreeStarterStaff(): void {
    for (const c of this.staffPool) {
      if (!(c.starter || c.cost <= 0)) continue;
      if (this.hiredStaffIds.includes(c.id) || this.findStaffById(c.id)) continue;
      this.hiredStaffIds.push(c.id);
    }
  }

  private candidateToBartenderData(c: StaffCandidate): BartenderData {
    return {
      id: c.id,
      name: c.name,
      energy: c.energy,
      mood: c.mood,
      skill: c.skill,
      energyDrainPerServe: c.energyDrainPerServe,
      energyRegenOnRest: c.energyRegenOnRest,
      restDurationMs: c.restDurationMs,
      serveDurationMs: c.serveDurationMs,
      moveSpeed: c.moveSpeed,
    };
  }

  private findFloorStaffSpawnTile(): { col: number; row: number } {
    const base = this.restTile();
    const offsets: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
      [1, 0],
      [-1, 0],
      [0, 2],
      [2, 1],
      [-2, 1],
      [2, 0],
      [-2, 0],
      [0, -1],
      [1, 2],
      [-1, 2],
    ];
    for (const [dc, dr] of offsets) {
      const col = base.col + dc;
      const row = base.row + dr;
      if (this.isTileFreeForStaff(col, row)) return { col, row };
    }
    // Any free walkable tile at all.
    const { cols, rows } = this.scenario.map;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.isTileFreeForStaff(c, r)) return { col: c, row: r };
      }
    }
    return { col: base.col, row: base.row };
  }

  /** Tile in front of the first sofa (staff rest / spawn anchor); mid-floor when there is no sofa. */
  private restTile(): { col: number; row: number } {
    for (const f of this.scenario.furniture) {
      if (f.type !== 'sofa') continue;
      for (const t of this.frontTiles(f)) {
        if (this.pathfinder?.isWalkable(t.col, t.row)) return t;
      }
    }
    const { cols, rows } = this.scenario.map;
    return { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  }

  /** Alias — hired Nova uses the same floor spawn as Luna. */
  private findStaffSpawnTile(): { col: number; row: number } {
    return this.findFloorStaffSpawnTile();
  }

  private isTileFreeForStaff(col: number, row: number): boolean {
    if (!this.pathfinder?.isWalkable(col, row)) return false;
    if (this.bartender && this.bartender.grid.col === col && this.bartender.grid.row === row) return false;
    if (this.extraStaff.some((s) => s.grid.col === col && s.grid.row === row)) return false;
    return true;
  }

  private wireStaffClick(npc: Bartender): void {
    npc.refreshHitArea();
    npc.sprite.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.buildMode) return;
      this.npcTapHandled = true;
      p.event?.stopPropagation?.();
    });
    npc.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.panDragging || this.furnDragging || this.skipNextTap) return;
      if (p.getDistance() > TAP_THRESH) return;
      if (this.buildMode) return;
      p.event?.stopPropagation?.();
      this.npcTapHandled = true;
      // Keep selection; do not deselect before a subsequent floor walk.
      this.selectNpcStaff(npc.profile.id);
    });
  }

  private spawnHiredExtraStaff(): void {
    for (const id of this.hiredStaffIds) {
      if (this.findStaffById(id)) continue;
      const cand = this.staffPool.find((c) => c.id === id);
      if (!cand) continue;
      this.spawnExtraStaffFromCandidate(cand, false);
    }
  }

  private spawnExtraStaffFromCandidate(cand: StaffCandidate, walkIn: boolean): Bartender {
    const tile = this.findStaffSpawnTile();
    const tex = this.textures.exists(cand.sprite) ? cand.sprite : 'bartender';
    const npc = new Bartender(
      this,
      tex,
      tile,
      this.iso,
      this.pathfinder,
      this.candidateToBartenderData(cand)
    );
    this.wireStaffClick(npc);
    npc.refreshHitArea();
    this.extraStaff.push(npc);
    this.syncCharacterInput();
    if (walkIn) {
      const near = this.findStaffSpawnTile();
      npc.state = 'walking';
      npc.walkTo(near, () => {
        npc.state = 'idle';
        npc.startBob();
      });
    }
    return npc;
  }

  private onCmdHireStaff = (id: string): void => {
    if (this.buildMode) return;
    if (this.hiredStaffIds.includes(id) || this.findStaffById(id)) {
      this.emitStaffRoster();
      return;
    }
    const cand = this.staffPool.find((c) => c.id === id);
    if (!cand) return;
    if (this.money < cand.cost) {
      this.game.events.emit('staff-hire-failed', { id, reason: 'money' });
      this.emitStaffRoster();
      return;
    }
    this.money -= cand.cost;
    this.hiredStaffIds.push(id);
    this.spawnExtraStaffFromCandidate(cand, true);
    this.persistLayout();
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();
  };

  private orderRestStaff = (id?: string): void => {
    if (this.buildMode) return;
    const targetId = id || this.selectedNpcId || this.bartender?.profile.id;
    if (!targetId) return;
    const npc = this.findStaffById(targetId);
    if (!npc) return;
    if (npc.state === 'walking' || npc.state === 'busy' || npc.state === 'resting') return;
    this.selectNpcStaff(npc.profile.id);
    this.beginStaffRest(npc, true);
  };

  emitStaffRoster = (): void => {
    const lunaPortrait =
      this.chars?.bartender?.portrait ||
      (this.textures.exists('luna_portrait') ? 'luna_portrait' : 'bartender');
    const current: StaffRosterEntry[] = [];
    if (this.bartender) {
      current.push({
        id: this.bartender.profile.id,
        name: this.bartender.displayName,
        roleLabel: 'Camarera',
        portrait: lunaPortrait,
        energy: Math.round(this.bartender.energy),
        mood: Math.round(this.bartender.mood),
        skill: Math.round(this.bartender.skill),
        state: this.bartender.getAiStateKey(),
        hired: true,
        starter: true,
        canRest: !['walking', 'busy', 'resting'].includes(this.bartender.state),
      });
    }
    for (const s of this.extraStaff) {
      const cand = this.staffPool.find((c) => c.id === s.profile.id);
      current.push({
        id: s.profile.id,
        name: s.displayName,
        roleLabel: cand?.roleLabel ?? 'Personal',
        portrait: cand?.portrait ?? s.sprite.texture.key,
        energy: Math.round(s.energy),
        mood: Math.round(s.mood),
        skill: Math.round(s.skill),
        state: s.getAiStateKey(),
        hired: true,
        starter: !!(cand?.starter || (cand && cand.cost <= 0)),
        canRest: !['walking', 'busy', 'resting'].includes(s.state),
      });
    }
    const hireable: StaffRosterEntry[] = this.staffPool
      .filter((c) => !this.hiredStaffIds.includes(c.id) && !this.findStaffById(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        roleLabel: c.roleLabel,
        portrait: c.portrait,
        energy: c.energy,
        mood: c.mood,
        skill: c.skill,
        state: 'idle',
        hired: false,
        cost: c.cost,
        blurb: c.blurb,
        canHire: this.money >= c.cost,
      }));
    const payload: StaffRosterPayload = {
      money: this.money,
      current,
      hireable,
    };
    this.game.events.emit('staff-roster', payload);
  };

  orderRest = (): void => {
    const id =
      this.selectedNpcId && this.findStaffById(this.selectedNpcId)
        ? this.selectedNpcId
        : this.bartender?.profile.id;
    this.orderRestStaff(id);
  };


  /** Furniture is interactive only in Construir — otherwise it steals staff taps (Luna on the sofa). */
  /**
   * In Construir characters must not take input: their hit areas (64x120) sit on top of furniture
   * and, since Phaser only routes a press to the top-most interactive object, a wandering staff
   * member standing on the sofa swallowed the tap that should select (and so Eliminar) it.
   */
  private syncCharacterInput(): void {
    const sprites = [
      this.bartender?.sprite,
      ...this.extraStaff.map((s) => s.sprite),
      ...this.patrons.map((p) => p.sprite),
    ];
    for (const sp of sprites) {
      if (sp?.input) sp.input.enabled = !this.buildMode;
    }
  }

  private syncFurnitureInteractive(): void {
    this.syncCharacterInput();
    for (const img of this.shopImages.values()) {
      if (this.buildMode) {
        img.setInteractive({ useHandCursor: true });
      } else if (img.input) {
        img.disableInteractive();
      }
    }
  }

  private isPointerOverGameObject(
    p: Phaser.Input.Pointer,
    go: Phaser.GameObjects.Image | null | undefined
  ): boolean {
    if (!go || !go.active) return false;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const b = go.getBounds();
    return b.contains(world.x, world.y);
  }

  private handleWorldTap(p: Phaser.Input.Pointer): void {
    const staff =
      this.selectedNpcId && this.findStaffById(this.selectedNpcId)
        ? this.findStaffById(this.selectedNpcId)
        : null;

    const furnId = this.furnitureIdAtPointer(p);

    if (staff) {
      // Furniture → inspect panel (no walk-through); empty floor → walk there
      if (furnId) {
        this.openFurnitureInspect(furnId);
        return;
      }
      this.closeFurnitureInspect();
      this.moveSelectedStaffToPointer(p, staff);
      return;
    }

    // No staff selected: tap furniture → inspect panel; empty → deselect
    if (furnId) {
      this.openFurnitureInspect(furnId);
      return;
    }
    this.closeFurnitureInspect();
    if (this.selectedNpcId) {
      this.deselectNpc();
      this.game.events.emit('npc-deselected');
    }
  }

  private moveSelectedStaffToPointer(p: Phaser.Input.Pointer, staff: Bartender): void {
    if (staff.state === 'resting') return;
    // Player override: cancel autonomous AI job
    if (!staff.playerCommanded && staff.aiJob !== 'none') {
      this.releaseStaffAiClaims(staff);
      staff.cancelWalk();
      staff.clearAiJob();
      staff.state = 'idle';
    } else if (staff.state === 'busy' && staff.playerCommanded) {
      return;
    }
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const tile = screenToTile(world.x, world.y, this.iso);
    if (!this.pathfinder.isWalkable(tile.col, tile.row)) {
      // Try nearest walkable via pathfinder goal snap
      const path = this.pathfinder.findPath(staff.grid, tile);
      if (!path.length) return;
      const goal = path[path.length - 1];
      this.issueStaffWalk(staff, goal);
      return;
    }
    this.issueStaffWalk(staff, { col: tile.col, row: tile.row });
  }

  private issueStaffWalk(
    staff: Bartender,
    goal: { col: number; row: number },
    opts?: { player?: boolean; aiJob?: StaffAiJob }
  ): void {
    if (staff.grid.col === goal.col && staff.grid.row === goal.row) return;
    // Avoid piling onto another staff's tile — pick adjacent alternate
    let dest = goal;
    if (this.isStaffTileBlocked(goal, staff)) {
      const alt = this.findFreeStaffGoal(staff, goal);
      if (!alt) return;
      dest = alt;
    }
    const asPlayer = opts?.player !== false && !opts?.aiJob;
    if (asPlayer) {
      this.releaseStaffAiClaims(staff);
      staff.beginPlayerCommand('player');
    } else if (opts?.aiJob) {
      staff.aiJob = opts.aiJob;
      staff.playerCommanded = false;
    }
    this.claimStaffTile(staff, dest);
    // Cancel AI wander/serve mid-path when player overrides
    staff.state = 'walking';
    const ok = staff.walkTo(dest, () => {
      staff.state = 'idle';
      this.releaseStaffTileClaims(staff);
      staff.startBob();
      if (asPlayer) staff.clearPlayerCommand();
      else staff.clearAiJob();
      if (staff === this.bartender) this.syncBartenderBarDepth();
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
    });
    if (!ok) {
      staff.state = 'idle';
      this.releaseStaffTileClaims(staff);
      staff.startBob();
      if (asPlayer) staff.clearPlayerCommand();
      else staff.clearAiJob();
    } else {
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
    }
  }

  /** Short bob / scale tween while serving or cleaning (no new sheets required). */
  private playStaffActionTween(staff: Bartender, onDone: () => void, totalMs = 900): void {
    const spr = staff.sprite;
    const baseY = spr.y;
    const baseSX = spr.scaleX;
    const baseSY = spr.scaleY;
    const cycles = Math.max(2, Math.round(totalMs / 450));
    this.tweens.add({
      targets: spr,
      y: baseY - 5,
      scaleX: baseSX * 1.05,
      scaleY: baseSY * 0.95,
      duration: Math.max(180, Math.floor(totalMs / (cycles * 2))),
      yoyo: true,
      repeat: cycles - 1,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        spr.y = baseY;
        spr.setScale(baseSX, baseSY);
        staff.reapplyDisplaySize();
        onDone();
      },
    });
  }

  private showStatusFloat(msg: string, at?: { x: number; y: number }): void {
    if (this.statusFloat) {
      this.statusFloat.destroy();
      this.statusFloat = undefined;
    }
    const x = at?.x ?? this.cameras.main.midPoint.x;
    const y = (at?.y ?? this.cameras.main.midPoint.y) - 60;
    this.statusFloat = this.add
      .text(x, y, msg, {
        fontSize: '14px',
        color: '#ffe066',
        fontStyle: 'bold',
        backgroundColor: '#12081ecc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(9300);
    this.tweens.add({
      targets: this.statusFloat,
      y: y - 28,
      alpha: 0,
      duration: 1400,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.statusFloat?.destroy();
        this.statusFloat = undefined;
      },
    });
  }


  closeNight = (): void => {
    if (this.phase !== 'open') return;
    this.finishNight();
  };

  private finishNight(): void {
    this.phase = 'summary';
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    if (this.selectedNpcId && this.selectedNpcId !== this.bartender?.profile.id) {
      this.deselectNpc();
      this.game.events.emit('npc-deselected');
    }
    this.patrons.forEach((p) => {
      this.releaseTile(p.grid);
      p.destroy();
    });
    this.patrons = [];
    this.queueTiles.clear();
    this.patronSlotClaims.clear();
    this.serveClaim.clear();
    this.barSpotHolderId = null;
    this.staffTileClaims.clear();
    for (const s of this.allStaff()) {
      s.clearAiJob();
      s.state = 'idle';
      s.startBob();
    }
    this.syncBartenderBarDepth();
    this.persistLayout();
    this.game.events.emit('night-summary', {
      ...this.getHudState(),
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
    });
    this.emitStaffRoster();
  }

  getHudState() {
    return {
      money: this.money,
      phase: this.phase,
      nightTimer: Math.ceil(this.nightTimer),
      bartender: this.bartender
        ? {
            name: this.bartender.displayName,
            energy: Math.round(this.bartender.energy),
            mood: Math.round(this.bartender.mood),
            skill: Math.round(this.bartender.skill),
            state: this.bartender.getAiStateKey(),
          }
        : null,
      selectedNpc: this.getSelectedNpcInfo(),
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
      buildMode: this.buildMode,
    };
  }


  private allStaff(): Bartender[] {
    const list: Bartender[] = [];
    if (this.bartender) list.push(this.bartender);
    list.push(...this.extraStaff);
    return list;
  }

  /** Destination / job tile → staffId (rest spot, cleaning, wander). */
  private staffTileClaims = new Map<string, string>();
  /** Seat / wander tile key `col,row` → patron id (anti-stack + occupy). */
  private patronSlotClaims = new Map<string, string>();

  private releaseStaffAiClaims(staff: Bartender): void {
    for (const [pid, sid] of [...this.serveClaim.entries()]) {
      if (sid === staff.profile.id) this.serveClaim.delete(pid);
    }
    for (const [fid, sid] of [...this.cleanClaim.entries()]) {
      if (sid === staff.profile.id) this.cleanClaim.delete(fid);
    }
    this.releaseStaffTileClaims(staff);
    staff.servingDrinkId = null;
    staff.clearServeLabel();
  }

  private tileKey(pos: { col: number; row: number }): string {
    return `${pos.col},${pos.row}`;
  }

  private releaseStaffTileClaims(staff: Bartender): void {
    const id = staff.profile.id;
    for (const [k, sid] of [...this.staffTileClaims.entries()]) {
      if (sid === id) this.staffTileClaims.delete(k);
    }
    if (this.barSpotHolderId === id) this.barSpotHolderId = null;
  }

  /** True if another staff occupies or has reserved this tile. */
  private isStaffTileBlocked(
    pos: { col: number; row: number },
    except?: Bartender
  ): boolean {
    const exceptId = except?.profile.id;
    const claimed = this.staffTileClaims.get(this.tileKey(pos));
    if (claimed && claimed !== exceptId) return true;
    for (const s of this.allStaff()) {
      if (except && s === except) continue;
      if (s.grid.col === pos.col && s.grid.row === pos.row) return true;
    }
    return false;
  }

  private claimStaffTile(staff: Bartender, pos: { col: number; row: number }): boolean {
    if (this.isStaffTileBlocked(pos, staff)) return false;
    // Drop prior claims for this staff, then claim destination
    for (const [k, sid] of [...this.staffTileClaims.entries()]) {
      if (sid === staff.profile.id) this.staffTileClaims.delete(k);
    }
    this.staffTileClaims.set(this.tileKey(pos), staff.profile.id);
    return true;
  }

  private findFreeStaffGoal(
    staff: Bartender,
    preferred: { col: number; row: number }
  ): { col: number; row: number } | null {
    if (!this.isStaffTileBlocked(preferred, staff) && this.pathfinder.isWalkable(preferred.col, preferred.row)) {
      return preferred;
    }
    const candidates = [
      preferred,
      { col: preferred.col - 1, row: preferred.row },
      { col: preferred.col + 1, row: preferred.row },
      { col: preferred.col, row: preferred.row - 1 },
      { col: preferred.col, row: preferred.row + 1 },
      { col: preferred.col - 1, row: preferred.row + 1 },
      { col: preferred.col + 1, row: preferred.row + 1 },
    ];
    for (const pos of candidates) {
      if (!this.pathfinder.isWalkable(pos.col, pos.row)) continue;
      if (this.isStaffTileBlocked(pos, staff)) continue;
      return pos;
    }
    return null;
  }

  /** Waiting at the bar with nobody on their order yet. */
  private waitingBarPatrons(): Patron[] {
    return this.patrons.filter(
      (p) => p.active && p.waiting && !p.served && p.goal === 'bar' && !this.serveClaim.has(p.profile.id)
    );
  }

  /** patronId → staffId while an Atender job is in flight. */
  private serveClaim = new Map<string, string>();
  /** Only one staff member pours at the bar's staff tile at a time. */
  private barSpotHolderId: string | null = null;

  private claimBarSpot(staff: Bartender, spot: { col: number; row: number }): boolean {
    if (this.barSpotHolderId && this.barSpotHolderId !== staff.profile.id) return false;
    this.barSpotHolderId = staff.profile.id;
    this.claimStaffTile(staff, spot);
    return true;
  }

  /** A free tile touching the staff tile where a second staff member waits their turn. */
  private findStaffWaitNearBar(
    staff: Bartender,
    spot: { col: number; row: number }
  ): { col: number; row: number } {
    for (const [dc, dr] of [
      [1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [-1, 0], [-2, 1],
    ] as Array<[number, number]>) {
      const pos = { col: spot.col + dc, row: spot.row + dr };
      if (!this.pathfinder.isWalkable(pos.col, pos.row)) continue;
      if (this.isStaffTileBlocked(pos, staff)) continue;
      if (!this.isPatronSlotFree(pos)) continue;
      return pos;
    }
    return { col: staff.grid.col, row: staff.grid.row };
  }

  private tryAssignServeAi(patron: Patron): boolean {
    if (!patron.active || !patron.waiting || patron.served || patron.goal !== 'bar') return false;
    if (this.serveClaim.has(patron.profile.id)) return false;
    if (this.buildMode || this.phase !== 'open') return false;
    const staff = this.allStaff().find(
      (st) =>
        !st.playerCommanded &&
        st.aiJob === 'none' &&
        st.state === 'idle' &&
        st.profile.energy >= st.profile.energyDrainPerServe
    );
    if (!staff) return false;
    return this.beginAiServe(staff, patron);
  }

  /** Staff walks to the bar, pours the patron's drink ('Sirviendo …'), the patron pays and moves on. */
  private beginAiServe(staff: Bartender, patron: Patron): boolean {
    const spots = this.barSpots();
    const drink =
      this.drinks.find((d) => d.id === patron.profile.preferredDrink) || this.drinks[0];
    if (!spots || !drink) return false;
    const spot = spots.staffSpot;
    staff.aiJob = 'serve';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.servingDrinkId = drink.id;
    staff.setServeLabel('Atendiendo');
    this.serveClaim.set(patron.profile.id, staff.profile.id);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    // The job is still ours (a player order or a night change releases the claim).
    const mine = () => this.serveClaim.get(patron.profile.id) === staff.profile.id;
    const release = () => {
      if (mine()) this.serveClaim.delete(patron.profile.id);
      staff.servingDrinkId = null;
      staff.clearServeLabel();
      this.releaseStaffTileClaims(staff);
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
      if (staff === this.bartender) this.syncBartenderBarDepth();
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
    };
    const patronGone = () =>
      !patron.active || this.phase !== 'open' || !patron.waiting || patron.served || patron.goal !== 'bar';

    const completeServe = () => {
      if (!mine()) return;
      if (patronGone()) {
        release();
        return;
      }
      staff.applyServeDrain();
      const payout = this.computeServePayout(patron, drink);
      this.money += payout.earned;
      this.nightEarned += payout.earned;
      this.servedCount++;
      if (payout.tipAmount > 0) {
        recordTip(staff.profile.id, payout.tipAmount);
      }
      patron.showBubble(payout.tipped ? `¡Propina! +$${payout.earned}` : `+$${payout.earned}`);
      patron.served = true;
      patron.waiting = false;
      this.releasePatronSlot(patron);
      this.releaseTile(patron.grid);
      patron.refreshStatusLabel();
      release();
      this.persistLayout();
      this.game.events.emit('stats-updated', this.getHudState());
      this.time.delayedCall(700, () => this.afterBarService(patron));
    };

    const startPrepare = () => {
      if (!mine()) return;
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      if (patronGone()) {
        release();
        return;
      }
      // Face the bar (one tile back = the bar's front row)
      staff.faceToward({ col: staff.grid.col, row: staff.grid.row - 1 });
      staff.setServeLabel(drink.id === 'cerveza' ? 'Sirviendo cerveza' : 'Sirviendo bebida');
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
      const prepareMs =
        drink.id === 'cerveza'
          ? drink.serveTimeMs
          : drink.serveTimeMs * (1 - (staff.skill / 200) * 0.3);
      // Cerveza has a pour animation for Luna / Nova; other drinks keep the idle animation
      if (!(drink.id === 'cerveza' && staff.playServeBeerAnim())) staff.startBob();
      this.time.delayedCall(prepareMs, completeServe);
    };

    const goToBarAndServe = () => {
      if (!mine()) return;
      if (patronGone()) {
        release();
        return;
      }
      if (!this.claimBarSpot(staff, spot)) {
        // Someone else is pouring: wait beside the bar until the spot frees up
        const wait = this.findStaffWaitNearBar(staff, spot);
        this.claimStaffTile(staff, wait);
        const poll = () => {
          if (!mine()) return;
          if (patronGone()) {
            release();
            return;
          }
          if (!this.claimBarSpot(staff, spot)) {
            this.time.delayedCall(280, poll);
            return;
          }
          if (!staff.walkTo(spot, startPrepare)) startPrepare();
        };
        if (!staff.walkTo(wait, poll)) this.time.delayedCall(280, poll);
        return;
      }
      if (!staff.walkTo(spot, startPrepare)) startPrepare();
    };

    goToBarAndServe();
    return true;
  }

  /** Walk adjacent to furniture, bob 2–3s, restore cleanliness (+bit comfort). */
  private beginAiCleanFurniture(staff: Bartender, def: FurnitureDef): void {
    if (this.cleanClaim.has(def.id) && this.cleanClaim.get(def.id) !== staff.profile.id) {
      staff.aiNextThinkAt = this.time.now + 700;
      return;
    }
    this.ensureFurnitureStats(def);
    const adj = this.findAdjacentWalkable(def, staff);
    if (!adj) {
      staff.aiNextThinkAt = this.time.now + 900;
      return;
    }
    this.cleanClaim.set(def.id, staff.profile.id);
    staff.aiJob = 'clean';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.setServeLabel('Limpiando');
    this.claimStaffTile(staff, adj);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    const release = () => {
      if (this.cleanClaim.get(def.id) === staff.profile.id) this.cleanClaim.delete(def.id);
      this.releaseStaffTileClaims(staff);
      staff.clearServeLabel();
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
    };

    const finish = () => {
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      staff.setServeLabel('Limpiando');
      this.playStaffActionTween(
        staff,
        () => {
          this.ensureFurnitureStats(def);
          const st = this.statsOf(def);
          applyCleanRestore(st);
          this.writeStatsToDef(def, st);
          this.refreshDirtOverlay(def);
          staff.profile.energy = Math.max(0, staff.profile.energy - Phaser.Math.Between(5, 10));
          staff.profile.mood = Math.min(100, staff.profile.mood + 2);
          staff.aiNextThinkAt = this.time.now + Phaser.Math.Between(5000, 9000);
          release();
          this.showStatusFloat(`Limpió ${this.furnitureDisplayName(def).toLowerCase()}`, this.shopImages.get(def.id));
          this.persistLayout();
          this.game.events.emit('stats-updated', this.getHudState());
          this.emitStaffRoster();
          this.reemitFurnitureInspectIf(def.id);
        },
        CLEAN_DURATION_MS
      );
    };
    const ok = staff.walkTo(adj, finish);
    if (!ok) finish();
  }

  private beginStaffRest(npc: Bartender, asPlayer: boolean): void {
    const restGoal = this.findFreeStaffGoal(npc, this.restTile());
    if (!restGoal) {
      if (!asPlayer) npc.aiNextThinkAt = this.time.now + 800;
      return;
    }
    if (asPlayer) {
      this.releaseStaffAiClaims(npc);
      npc.cancelWalk();
      npc.beginPlayerCommand('rest');
    } else {
      npc.aiJob = 'rest';
      npc.playerCommanded = false;
    }
    npc.setServeLabel('Descansando');
    this.claimStaffTile(npc, restGoal);
    npc.state = 'busy';
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();
    npc.walkTo(restGoal, () => {
      npc.state = 'resting';
      npc.stopBob();
      const dur = npc.profile.restDurationMs;
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
      this.time.delayedCall(dur, () => {
        npc.applyRest();
        npc.clearServeLabel();
        npc.state = 'idle';
        this.releaseStaffTileClaims(npc);
        if (asPlayer) npc.clearPlayerCommand();
        else npc.clearAiJob();
        npc.startBob();
        const home = this.findFloorStaffSpawnTile();
        const homeGoal = this.findFreeStaffGoal(npc, home) ?? home;
        this.claimStaffTile(npc, homeGoal);
        npc.walkTo(homeGoal, () => {
          this.releaseStaffTileClaims(npc);
          this.syncBartenderBarDepth();
          npc.aiNextThinkAt = this.time.now + 1500;
          this.game.events.emit('stats-updated', this.getHudState());
          this.emitStaffRoster();
        });
      });
    });
  }

  private beginAiWander(staff: Bartender): void {
    const { cols, rows } = this.scenario.map;
    let goal: { col: number; row: number } | null = null;
    for (let i = 0; i < 16; i++) {
      const col = Phaser.Math.Between(0, cols - 1);
      const row = Phaser.Math.Between(0, rows - 1);
      if (!this.pathfinder.isWalkable(col, row)) continue;
      if (col === staff.grid.col && row === staff.grid.row) continue;
      if (this.isStaffTileBlocked({ col, row }, staff)) continue;
      goal = { col, row };
      break;
    }
    if (!goal) {
      staff.aiNextThinkAt = this.time.now + 2000;
      return;
    }
    this.claimStaffTile(staff, goal);
    staff.aiJob = 'wander';
    staff.playerCommanded = false;
    staff.state = 'walking';
    staff.setServeLabel('Deambulando');
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();
    const ok = staff.walkTo(goal, () => {
      staff.state = 'idle';
      this.releaseStaffTileClaims(staff);
      staff.clearServeLabel();
      staff.clearAiJob();
      staff.startBob();
      staff.aiNextThinkAt = this.time.now + Phaser.Math.Between(2500, 5000);
      if (staff === this.bartender) this.syncBartenderBarDepth();
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
    });
    if (!ok) {
      staff.state = 'idle';
      this.releaseStaffTileClaims(staff);
      staff.clearAiJob();
      staff.startBob();
      staff.aiNextThinkAt = this.time.now + 2000;
    }
  }

  private tickStaffAi(): void {
    if (this.buildMode) return;
    const now = this.time.now;

    // Priority 1 — Atender: hand every waiting patron to a free staff member
    const waiting = this.phase === 'open' ? this.waitingBarPatrons() : [];
    for (const patron of waiting) this.tryAssignServeAi(patron);

    for (const staff of this.allStaff()) {
      // Player command ALWAYS outranks autonomous AI
      if (staff.playerCommanded) continue;
      if (staff.aiJob !== 'none') continue;
      if (staff.state !== 'idle') continue;
      if (now < staff.aiNextThinkAt) continue;

      // While patrons wait, free staff stay ready (they only rest if too tired to serve)
      if (this.phase === 'open' && this.waitingBarPatrons().length > 0) {
        if (
          staff.profile.energy < staff.profile.energyDrainPerServe &&
          staff.profile.energy < AI_TUNABLES.restEnergyThreshold
        ) {
          this.beginStaffRest(staff, false);
        } else {
          staff.aiNextThinkAt = now + 400;
        }
        continue;
      }

      // 1) Limpiar — ANY furniture with cleanliness < threshold
      const dirty = this.findDirtiestFurniture(AI_TUNABLES.cleanThreshold);
      if (dirty && !this.cleanClaim.has(dirty.id)) {
        this.beginAiCleanFurniture(staff, dirty);
        continue;
      }

      // 2) Descansar — low energy
      if (staff.profile.energy < AI_TUNABLES.restEnergyThreshold) {
        this.beginStaffRest(staff, false);
        continue;
      }

      // 3) Deambular
      if (Math.random() < 0.55) {
        this.beginAiWander(staff);
      } else {
        staff.aiNextThinkAt =
          now +
          Phaser.Math.Between(AI_TUNABLES.wanderIdleMinMs, AI_TUNABLES.wanderIdleMaxMs);
      }
    }
  }

  update(_t: number, dt: number): void {
    this.syncBartenderBarDepth();
    // AI runs in prep + open (wander/rest/clean); serve only when open.
    if (!this.buildMode) this.tickStaffAi();
    const dtSec = dt / 1000;
    if (!this.buildMode && (this.phase === 'open' || this.phase === 'prep')) {
      this.tickFurnitureDecay(dtSec);
    }
    if (this.phase !== 'open') return;
    this.nightTimer -= dtSec;

    for (const patron of [...this.patrons]) {
      if (!patron.active) continue;
      // The bar broke / was removed while they queued: give up on the drink
      if (patron.goal === 'bar' && patron.waiting && !patron.served && !this.activeBar()) {
        this.serveClaim.delete(patron.profile.id);
        patron.waiting = false;
        this.releasePatronSlot(patron);
        this.sendPatronWandering(patron);
        continue;
      }
      if (patron.tickPatience(dtSec)) {
        patron.angry = true;
        patron.waiting = false;
        patron.refreshStatusLabel();
        patron.showBubble('¡Enfadado!');
        this.serveClaim.delete(patron.profile.id);
        this.releasePatronSlot(patron);
        // Walk out with no pay / no tip
        this.sendPatronHome(patron);
      } else {
        patron.refreshStatusLabel();
      }
    }

    if (Math.floor(this.nightTimer * 2) !== Math.floor((this.nightTimer + dtSec) * 2)) {
      this.game.events.emit('stats-updated', this.getHudState());
    }
    if (this.nightTimer <= 0) {
      this.nightTimer = 0;
      this.finishNight();
    }
  }


  private loadShopCatalog(): void {
    if (this.shopCatalog.length) return;
    const raw = this.cache.json.get('shop_furniture') as ShopFurnitureFile | undefined;
    const items = Array.isArray(raw?.items) ? raw!.items : [];
    this.shopCatalog = items;
    this.shopCatalogById.clear();
    for (const it of items) this.shopCatalogById.set(it.id, it);
  }

  private upgradeShopFurnitureFromCatalog(def: FurnitureDef): void {
    const cat = this.shopCatalogById.get(def.catalogId ?? def.type);
    if (!cat) return;
    def.sprite = cat.sprite;
    def.sprites = { sw: cat.sprite };
    def.facing = FIXED_FACING;
    def.footprint = [cat.footprint[0], cat.footprint[1]];
    def.displayW = cat.displaySize[0];
    def.displayH = cat.displaySize[1];
    if (typeof cat.yBias === 'number') def.yBias = cat.yBias;
    def.baseVertex = cat.baseVertex;
  }

  private ensureShopFlags(def: FurnitureDef): void {
    if (!def.catalogId && this.shopCatalogById.has(def.type)) {
      def.catalogId = def.type;
    }
    if (def.catalogId) def.fromShop = true;
  }

  private upgradeAllShopFurnitureFromCatalog(): void {
    for (const f of this.scenario.furniture) {
      this.ensureShopFlags(f);
      if (f.fromShop || f.catalogId) this.upgradeShopFurnitureFromCatalog(f);
    }
  }

  private defFromShopCatalog(catalogId: string, instanceId?: string): FurnitureDef | null {
    const cat = this.shopCatalogById.get(catalogId);
    if (!cat) return null;
    const id = instanceId || this.nextShopInstanceId(catalogId);
    const price = cat.price ?? STARTER_FURNITURE_PRICE;
    const stats = freshStatsForPrice(price);
    return {
      id,
      type: cat.id,
      sprite: cat.sprite,
      catalogId: cat.id,
      fromShop: true,
      facing: FIXED_FACING,
      sprites: { sw: cat.sprite },
      tile: [4, 4],
      footprint: [cat.footprint[0], cat.footprint[1]],
      displayW: cat.displaySize[0],
      displayH: cat.displaySize[1],
      yBias: cat.yBias ?? -8,
      baseVertex: cat.baseVertex,
      price,
      ...stats,
    };
  }

  private nextShopInstanceId(catalogId: string): string {
    // Ids must be unique among ALL current pieces (the counter restarts on reload and a deleted
    // piece frees a slot, so `${catalogId}_${n}_${seq}` could collide with a saved piece; a
    // duplicate id made Eliminar remove two pieces at once and orphaned a sprite).
    const used = new Set(this.scenario.furniture.map((f) => f.id));
    let id = '';
    do {
      this.shopInstanceSeq += 1;
      const n = this.scenario.furniture.filter((f) => f.catalogId === catalogId).length + 1;
      id = `${catalogId}_${n}_${this.shopInstanceSeq}`;
    } while (used.has(id) || this.shopImages.has(id));
    return id;
  }

  private getFurnitureDef(id: string): FurnitureDef | null {
    if (!id) return null;
    // Instance id is authoritative (the starter sofa is 'sofa', bought ones sofa_1_2, …)
    const byId = this.scenario.furniture.find((f) => f.id === id);
    if (byId) return byId;
    // Legacy / unique catalog-id-as-instance-id
    const byCat = this.scenario.furniture.filter((f) => f.catalogId === id || f.type === id);
    if (byCat.length === 1) return byCat[0];
    return null;
  }

  private getFurnitureImage(id: string): Phaser.GameObjects.Image | null {
    return this.shopImages.get(id) ?? null;
  }

  private spawnShopFurnitureVisual(def: FurnitureDef): void {
    const key = this.furnitureTextureKey(def.type, def);
    this.requireTexture(key);
    const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
    const size = this.furnitureDisplaySize(def.type, def);
    const img = this.add.image(pos.x, pos.y, key);
    img.setDisplaySize(size.w, size.h);
    img.setDepth(depthForFurniture(def.tile[0], def.tile[1], def.footprint));
    img.setInteractive({ useHandCursor: true });
    const instanceId = def.id;
    img.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      if (!this.buildMode) return;
      this.beginFurniturePointer(p, instanceId);
    });
    img.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.deleteConfirmOpen) return;
      if (this.panDragging || this.skipNextTap) return;
      if (!this.buildMode) return;
      if (p.getDistance() > TAP_THRESH && !this.furnDragging) return;
      if (!this.furnDragging || this.furnDragId !== instanceId) {
        this.selectFurniture(instanceId);
      }
    });
    this.shopImages.set(def.id, img);
  }

  private findFreeShopTile(def: FurnitureDef): [number, number] | null {
    const found = this.findNearestValidTile(def);
    if (found) return found;
    // Fallback: spiral from center
    const { cols, rows } = this.scenario.map;
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    for (let rad = 0; rad < Math.max(cols, rows); rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
          const c = cx + dc;
          const r = cy + dr;
          if (this.poseAllowed(def, c, r)) return [c, r];
        }
      }
    }
    return null;
  }

  emitShopCatalog = (): void => {
    this.loadShopCatalog();
    const payload: ShopCatalogPayload = {
      money: this.money,
      items: this.shopCatalog.map((it) => {
        const ownedCount = this.scenario.furniture.filter((f) => f.catalogId === it.id).length;
        return {
          ...it,
          ownedCount,
          canBuy: this.money >= it.price,
        };
      }),
    };
    this.game.events.emit('shop-catalog', payload);
  };

  private onCmdBuyShopFurniture = (catalogId: string): void => {
    if (!this.buildMode) return;
    this.loadShopCatalog();
    const cat = this.shopCatalogById.get(catalogId);
    if (!cat) {
      this.game.events.emit('shop-buy-failed', { id: catalogId, reason: 'missing' });
      return;
    }
    if (this.money < cat.price) {
      this.game.events.emit('shop-buy-failed', { id: catalogId, reason: 'money' });
      return;
    }
    const def = this.defFromShopCatalog(catalogId);
    if (!def) return;
    const tile = this.findFreeShopTile(def);
    if (!tile) {
      this.game.events.emit('shop-buy-failed', { id: catalogId, reason: 'space' });
      return;
    }
    def.tile = tile;
    this.money -= cat.price;
    this.scenario.furniture.push(def);
    this.spawnShopFurnitureVisual(def);
    this.rebuildPathfinder();
    this.persistLayout();
    this.syncFurnitureInteractive();
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitShopCatalog();
    this.selectFurniture(def.id);
    this.buildHint
      .setText(`Comprado: ${cat.name} — arrástrala a su lugar`)
      .setVisible(true);
  };


  // --- Furniture runtime stats / dirt / inspect / clean helpers ---

  private furniturePrice(def: FurnitureDef): number {
    if (typeof def.price === 'number' && def.price > 0) return def.price;
    if (def.catalogId) {
      const cat = this.shopCatalogById.get(def.catalogId);
      if (cat) return cat.price;
    }
    const cat = this.shopCatalogById.get(def.type);
    return cat?.price ?? STARTER_FURNITURE_PRICE;
  }

  private furnitureDisplayName(def: FurnitureDef): string {
    const cat =
      this.shopCatalogById.get(def.catalogId ?? '') || this.shopCatalogById.get(def.type);
    return cat?.name ?? 'Mueble';
  }

  private statsOf(def: FurnitureDef): FurnitureRuntimeStats {
    this.ensureFurnitureStats(def);
    return {
      durability: def.durability!,
      comfort: def.comfort!,
      cleanliness: def.cleanliness!,
      maxDurability: def.maxDurability!,
      maxComfort: def.maxComfort!,
      maxCleanliness: def.maxCleanliness!,
    };
  }

  private writeStatsToDef(def: FurnitureDef, st: FurnitureRuntimeStats): void {
    def.durability = st.durability;
    def.comfort = st.comfort;
    def.cleanliness = st.cleanliness;
    def.maxDurability = st.maxDurability;
    def.maxComfort = st.maxComfort;
    def.maxCleanliness = st.maxCleanliness;
  }

  private ensureFurnitureStats(def: FurnitureDef): void {
    const price = this.furniturePrice(def);
    def.price = price;
    if (
      typeof def.durability === 'number' &&
      typeof def.comfort === 'number' &&
      typeof def.cleanliness === 'number' &&
      typeof def.maxDurability === 'number' &&
      typeof def.maxComfort === 'number' &&
      typeof def.maxCleanliness === 'number'
    ) {
      return;
    }
    const st = freshStatsForPrice(price);
    this.writeStatsToDef(def, st);
  }

  private ensureAllFurnitureStats(): void {
    for (const f of this.scenario.furniture) this.ensureFurnitureStats(f);
  }

  private applyStatsFromSaved(def: FurnitureDef, item: SavedLayoutItem): void {
    const price = this.furniturePrice(def);
    def.price = price;
    const st = mergeSavedStats(price, item);
    this.writeStatsToDef(def, st);
  }

  private tickFurnitureDecay(dtSec: number): void {
    if (dtSec <= 0) return;
    for (const f of this.scenario.furniture) {
      this.ensureFurnitureStats(f);
      const before = f.cleanliness ?? 100;
      const st = this.statsOf(f);
      // Dirt snowballs: already-dirty pieces decay faster (stains escalate)
      const boost =
        before < DIRT_VISUAL_THRESHOLD ? AI_TUNABLES.dirtyDecayBoost : before < 75 ? 1.2 : 1;
      applyDecay(st, dtSec * boost, this.furniturePrice(f));
      this.writeStatsToDef(f, st);
      const crossed =
        (before >= DIRT_VISUAL_THRESHOLD) !== (st.cleanliness >= DIRT_VISUAL_THRESHOLD) ||
        Math.floor(before / 8) !== Math.floor(st.cleanliness / 8);
      if (crossed) this.refreshDirtOverlay(f);
    }
    if (Math.random() < 0.012) this.persistLayout();
    if (this.inspectedFurnitureId) this.reemitFurnitureInspectIf(this.inspectedFurnitureId);
  }

  private findDirtiestFurniture(below: number): FurnitureDef | null {
    let best: FurnitureDef | null = null;
    let bestClean = Infinity;
    for (const f of this.scenario.furniture) {
      this.ensureFurnitureStats(f);
      const c = f.cleanliness ?? 100;
      if (c >= below) continue;
      if (this.cleanClaim.has(f.id)) continue;
      if (c < bestClean) {
        bestClean = c;
        best = f;
      }
    }
    return best;
  }

  /** Walkable tile adjacent to any cell of the furniture footprint. */
  private findAdjacentWalkable(
    def: FurnitureDef,
    staff: Bartender
  ): { col: number; row: number } | null {
    const fw = Math.max(1, def.footprint[0]);
    const fh = Math.max(1, def.footprint[1]);
    const candidates: Array<{ col: number; row: number }> = [];
    for (let dc = 0; dc < fw; dc++) {
      for (let dr = 0; dr < fh; dr++) {
        const bc = def.tile[0] + dc;
        const br = def.tile[1] + dr;
        for (const [oc, or_] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as Array<[number, number]>) {
          candidates.push({ col: bc + oc, row: br + or_ });
        }
      }
    }
    candidates.sort((a, b) => {
      const da = Math.abs(a.col - staff.grid.col) + Math.abs(a.row - staff.grid.row);
      const db = Math.abs(b.col - staff.grid.col) + Math.abs(b.row - staff.grid.row);
      return da - db;
    });
    const seen = new Set<string>();
    for (const pos of candidates) {
      const k = `${pos.col},${pos.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!this.pathfinder.isWalkable(pos.col, pos.row)) continue;
      if (this.isStaffTileBlocked(pos, staff)) continue;
      return pos;
    }
    return null;
  }

  private furnitureIdAtPointer(p: Phaser.Input.Pointer): string | null {
    type Hit = { id: string; depth: number };
    const hits: Hit[] = [];
    for (const [id, img] of this.shopImages) {
      if (this.isPointerOverGameObject(p, img)) hits.push({ id, depth: img.depth });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => b.depth - a.depth);
    return hits[0].id;
  }

  private openFurnitureInspect(id: string): void {
    const def = this.getFurnitureDef(id);
    if (!def) return;
    if (this.selectedNpcId) {
      this.deselectNpc();
      this.game.events.emit('npc-deselected');
    }
    this.inspectedFurnitureId = id;
    this.game.events.emit('select-furniture', this.buildFurnitureInspectPayload(def));
  }

  private closeFurnitureInspect(): void {
    if (!this.inspectedFurnitureId) return;
    this.inspectedFurnitureId = null;
    this.game.events.emit('furniture-deselected');
  }

  private reemitFurnitureInspectIf(id: string | undefined | null): void {
    if (!id || this.inspectedFurnitureId !== id) return;
    const def = this.getFurnitureDef(id);
    if (!def) return;
    this.game.events.emit('select-furniture', this.buildFurnitureInspectPayload(def));
  }

  private buildFurnitureInspectPayload(def: FurnitureDef): FurnitureInspectPayload {
    this.ensureFurnitureStats(def);
    const st = this.statsOf(def);
    return {
      id: def.id,
      name: this.furnitureDisplayName(def),
      condition: conditionFromDurability(st.durability, st.maxDurability),
      durability: Math.round(st.durability),
      comfort: Math.round(st.comfort),
      cleanliness: Math.round(st.cleanliness),
      maxDurability: Math.round(st.maxDurability),
      maxComfort: Math.round(st.maxComfort),
      maxCleanliness: Math.round(st.maxCleanliness),
    };
  }

  private destroyDirtOverlay(id: string): void {
    const g = this.dirtOverlays.get(id);
    if (g) {
      g.destroy();
      this.dirtOverlays.delete(id);
    }
  }

  private refreshAllDirtOverlays(): void {
    for (const f of this.scenario.furniture) this.refreshDirtOverlay(f);
  }

  /** Procedural blotches when cleanliness < 60; denser when dirtier. */
  private refreshDirtOverlay(def: FurnitureDef): void {
    this.ensureFurnitureStats(def);
    const clean = def.cleanliness ?? 100;
    const img = this.getFurnitureImage(def.id);
    if (!img) {
      this.destroyDirtOverlay(def.id);
      return;
    }
    if (clean >= DIRT_VISUAL_THRESHOLD) {
      this.destroyDirtOverlay(def.id);
      return;
    }
    let g = this.dirtOverlays.get(def.id);
    if (!g) {
      g = this.add.graphics();
      this.dirtOverlays.set(def.id, g);
    }
    g.clear();
    // Escalating stains: more blotches + darker as cleanliness drops
    const dirtiness = 1 - clean / DIRT_VISUAL_THRESHOLD;
    const n = Math.max(3, Math.min(14, Math.round(3 + dirtiness * 11)));
    const alpha = 0.28 + dirtiness * 0.55;
    const size = this.furnitureDisplaySize(def.type, def);
    let seed = 0;
    for (let i = 0; i < def.id.length; i++) seed = (seed * 31 + def.id.charCodeAt(i)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < n; i++) {
      const ox = (rnd() - 0.5) * size.w * 0.55;
      const oy = (rnd() - 0.55) * size.h * 0.4;
      const rw = 4 + rnd() * 10 * (0.6 + dirtiness);
      const rh = 3 + rnd() * 7 * (0.6 + dirtiness);
      g.fillStyle(0x3a2818, alpha);
      g.fillEllipse(img.x + ox, img.y + oy, rw, rh);
      if (rnd() > 0.55) {
        g.fillStyle(0x2a1a10, alpha * 0.85);
        g.fillEllipse(img.x + ox + 2, img.y + oy + 1, rw * 0.6, rh * 0.55);
      }
    }
    g.setDepth(img.depth + 0.5);
  }


  shutdown(): void {
    this.game.events.off('cmd-open-night', this.openNight, this);
    this.game.events.off('cmd-close-night', this.closeNight, this);
    this.game.events.off('cmd-rest', this.orderRest, this);
    this.game.events.off('cmd-rest-staff', this.orderRestStaff, this);
    this.game.events.off('cmd-select-staff', this.onCmdSelectStaff, this);
    this.game.events.off('cmd-hire-staff', this.onCmdHireStaff, this);
    this.game.events.off('cmd-request-staff-roster', this.emitStaffRoster, this);
    this.game.events.off('cmd-set-build-mode', this.setBuildMode, this);
    this.game.events.off('cmd-deselect-npc', this.deselectNpc, this);
    this.game.events.off('cmd-deselect-bartender', this.deselectNpc, this);
    this.game.events.off('cmd-request-shop-catalog', this.emitShopCatalog, this);
    this.game.events.off('cmd-buy-shop-furniture', this.onCmdBuyShopFurniture, this);
    this.game.events.off('cmd-deselect-furniture', this.onCmdDeselectFurniture, this);
    this.game.events.off('cmd-confirm-delete-furniture', this.onCmdConfirmDeleteFurniture, this);
    this.game.events.off('cmd-cancel-delete-furniture', this.onCmdCancelDeleteFurniture, this);
  }

  private onCmdDeselectFurniture = (): void => {
    this.closeFurnitureInspect();
  };
}

