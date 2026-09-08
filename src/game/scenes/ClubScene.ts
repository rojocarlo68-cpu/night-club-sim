import Phaser from 'phaser';
import {
  IsoConfig,
  tileToScreen,
  screenToTile,
  depthForFurniture,
  depthForCharacter,
} from '../systems/IsoUtils';
import {
  Point,
  ROOM_NEON_MATCH_FRAC,
  computePlayableFloorPolygon,
  canPlaceVisual,
} from '../systems/FloorBounds';
import { Pathfinder } from '../systems/Pathfinding';
import { Bartender, BartenderData, StaffAiJob } from '../entities/Bartender';
import { Patron, PatronData } from '../entities/Patron';
import { NpcInfo } from '../types/Npc';
import { StaffCandidate, StaffPoolFile, StaffRosterEntry, StaffRosterPayload } from '../types/Staff';
import { ShopCatalogPayload, ShopFurnitureFile, ShopFurnitureItem } from '../types/Shop';

interface Drink {
  id: string;
  name: string;
  price: number;
  serveTimeMs: number;
}

type IsoFacing = 'se' | 'sw' | 'ne' | 'nw';

interface FurnitureDef {
  id: string;
  type: string;
  sprite: string;
  facing?: IsoFacing;
  sprites?: Partial<Record<IsoFacing, string>>;
  tile: [number, number];
  footprint: [number, number];
  interact?: [number, number];
  staffSpot?: [number, number];
  restSpot?: [number, number];
  /** Shop catalog id when this instance was purchased. */
  catalogId?: string;
  /** Horizontal mirror for single-angle shop sprites. */
  flipX?: boolean;
  fromShop?: boolean;
  displayW?: number;
  displayH?: number;
  yBias?: number;
  facingSupport?: 'full' | 'flip' | 'none';
}

interface Scenario {
  id: string;
  title: string;
  startingMoney: number;
  nightDurationSec: number;
  patronSpawnCount: [number, number];
  spawnIntervalMs: number;
  map: { cols: number; rows: number; tileWidth: number; tileHeight: number };
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
  facing?: IsoFacing;
  catalogId?: string;
  flipX?: boolean;
  footprint?: [number, number];
}

interface SavedLayout {
  furniture: SavedLayoutItem[];
  /** Hired staff ids from staff_pool (excludes starter Luna). */
  hiredStaff?: string[];
  /** Persist cash so hires survive reload. */
  money?: number;
}

const FACINGS: IsoFacing[] = ['se', 'sw', 'nw', 'ne'];
const LAYOUT_KEY = 'night-club-layout-v1';
/** Soft wall rim: outermost tile ring sits under neon wall geometry. */
const BUILD_MARGIN = 1;
const TAP_THRESH = 10;
const HUD_TOP = 56;
/** Pinch / wheel zoom clamps (initial narrow-viewport zoom still applied in setupCamera). */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.7;
const WHEEL_ZOOM_STEP = 0.08;
export type NightPhase = 'prep' | 'open' | 'summary';

/** 'sofa' | 'bar' | shop instance id */
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
  /** Floating bar action menu (Pedir bebidas / Limpiar barra). */
  private barMenu: Phaser.GameObjects.Container | null = null;
  private barMenuVisible = false;
  private barActionBusy = false;
  private statusFloat?: Phaser.GameObjects.Text;

  private spawnLeft = 0;
  private queueTiles: Set<string> = new Set();
  private barInteract!: { col: number; row: number };
  private sofaRest!: { col: number; row: number };
  private staffSpot!: { col: number; row: number };
  private drinks: Drink[] = [];

  private sofaDef!: FurnitureDef;
  private barDef!: FurnitureDef;
  private sofaFacing: IsoFacing = 'se';
  private barFacing: IsoFacing = 'se';
  private sofaImage!: Phaser.GameObjects.Image;
  private barImage!: Phaser.GameObjects.Image;
  private barGlow!: Phaser.GameObjects.Arc;
  private roomImage!: Phaser.GameObjects.Image;
  /** Purchased / decor furniture images keyed by instance id. */
  private shopImages = new Map<string, Phaser.GameObjects.Image>();
  private shopCatalog: ShopFurnitureItem[] = [];
  private shopCatalogById = new Map<string, ShopFurnitureItem>();
  private shopInstanceSeq = 0;

  private selectedFurniture: SelectedFurniture = null;
  private rotateUi!: Phaser.GameObjects.Container;
  private buildHint!: Phaser.GameObjects.Text;

  // Relative offsets from furniture tile (computed on load / after layout apply)
  private sofaRestOff: [number, number] = [0, 0];
  private sofaInteractOff: [number, number] = [0, -1];
  private barInteractOff: [number, number] = [-1, 0];
  private barStaffOff: [number, number] = [-1, 1];

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

  /** Glossy floor inside neon rim (world/screen space). Authority for sprite-vs-neon. */
  private floorPoly: Point[] = [];

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
    this.cameras.main.setBackgroundColor('#05030a');
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
    this.drinks = this.scenario.drinks;
    this.buildMode = false;
    this.selectedFurniture = null;

    const { cols, rows, tileWidth, tileHeight } = this.scenario.map;
    const originX = this.cameras.main.width / 2;
    const originY = 70;
    this.iso = { tileWidth, tileHeight, originX, originY };

    // Resolve furniture defs
    const bar = this.scenario.furniture.find((f) => f.type === 'bar');
    const sofa = this.scenario.furniture.find((f) => f.type === 'sofa');
    if (!bar) throw new Error('Furniture bar missing in scenario');
    if (!sofa) throw new Error('Furniture sofa missing in scenario');
    if (!bar.interact) throw new Error('bar.interact missing');
    if (!bar.staffSpot) throw new Error('bar.staffSpot missing');
    if (!sofa.restSpot) throw new Error('sofa.restSpot missing');

    this.barDef = bar;
    this.sofaDef = sofa;
    this.captureOffsets();

    this.applySavedLayout();

    this.requireTexture('room_floor');
    for (const facing of FACINGS) {
      this.requireTexture(`furn_sofa_${facing}`);
      this.requireTexture(`furn_bar_${facing}`);
    }
    this.loadShopCatalog();
    this.upgradeAllShopFurnitureFromCatalog();
    for (const facing of FACINGS) {
      const key = `furn_dj_booth_${facing}`;
      if (this.textures.exists(key)) this.requireTexture(key);
    }
    for (const f of this.scenario.furniture) {
      if (f.fromShop || f.catalogId) {
        const key = this.furnitureTextureKey(f.type, (f.facing as IsoFacing) || 'se', f);
        this.requireTexture(key);
      }
    }
    this.requireTexture(this.chars.bartender.sprite || 'bartender');

    this.rebuildPathfinder();
    this.syncSpotsFromFurniture();

    this.drawRoom(cols, rows);
    this.placeFurniture();
    this.ensureAllFurnitureInsideFloor();
    this.setupCamera();

    const bd = this.chars.bartender;
    // Luna is free staff like Nova — spawn on the floor near sofa, not glued to bar.
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
    this.loadShopCatalog();
    this.ensureFreeStarterStaff();
    this.spawnHiredExtraStaff();

    this.setupPointerPan();
    this.setupZoom();
    this.input.mouse?.disableContextMenu();
    this.buildBarMenu();
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

    this.cameras.main.setBackgroundColor('#05030a');

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
    this.emitStaffRoster();
    this.emitShopCatalog();
  }

  private drinkDisplayName(id: string): string {
    return this.drinks.find((d) => d.id === id)?.name ?? id;
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
    return {
      id: b.profile.id,
      name: b.displayName,
      role: 'staff',
      energy: Math.round(b.energy),
      mood: Math.round(b.mood),
      skill: Math.round(b.skill),
      state: b.getAiStateKey(),
      portrait,
    };
  }

  private selectNpcStaff(id?: string): void {
    const target = id ? this.findStaffById(id) : this.bartender;
    if (!target) return;
    this.hideBarMenu();
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
    this.hideBarMenu();
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

  private captureOffsets(): void {
    const s = this.sofaDef;
    const b = this.barDef;
    if (s.restSpot) {
      this.sofaRestOff = [s.restSpot[0] - s.tile[0], s.restSpot[1] - s.tile[1]];
    }
    if (s.interact) {
      this.sofaInteractOff = [s.interact[0] - s.tile[0], s.interact[1] - s.tile[1]];
    }
    if (b.interact) {
      this.barInteractOff = [b.interact[0] - b.tile[0], b.interact[1] - b.tile[1]];
    }
    if (b.staffSpot) {
      this.barStaffOff = [b.staffSpot[0] - b.tile[0], b.staffSpot[1] - b.tile[1]];
    }
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
      if (!saved?.furniture?.length) return;
      // Ensure shop catalog available before restoring purchased pieces
      this.loadShopCatalog();
      for (const item of saved.furniture) {
        let def = this.scenario.furniture.find((f) => f.id === item.id);
        if (!def && item.catalogId) {
          const spawned = this.defFromShopCatalog(item.catalogId, item.id);
          if (spawned) {
            if (Array.isArray(item.footprint) && item.footprint.length === 2) {
              spawned.footprint = [item.footprint[0], item.footprint[1]];
            }
            this.scenario.furniture.push(spawned);
            def = spawned;
          }
        }
        if (!def) continue;
        if (
          Array.isArray(item.tile) &&
          item.tile.length === 2 &&
          this.tileInBounds(item.tile[0], item.tile[1], def.footprint)
        ) {
          def.tile = [item.tile[0], item.tile[1]];
        }
        if (item.facing && FACINGS.includes(item.facing)) {
          def.facing = item.facing;
        }
        if (typeof item.flipX === 'boolean') {
          def.flipX = item.flipX;
        }
      }
      // Re-apply relative spots from offsets
      this.sofaDef = this.scenario.furniture.find((f) => f.type === 'sofa')!;
      this.barDef = this.scenario.furniture.find((f) => f.type === 'bar')!;
      this.applyOffsetsToDef(this.sofaDef, this.sofaRestOff, this.sofaInteractOff, 'sofa');
      this.applyOffsetsToDef(this.barDef, this.barStaffOff, this.barInteractOff, 'bar');
    } catch {
      // ignore corrupt layout
    }
  }

  private applyOffsetsToDef(
    def: FurnitureDef,
    primaryOff: [number, number],
    interactOff: [number, number],
    kind: 'sofa' | 'bar'
  ): void {
    if (kind === 'sofa') {
      def.restSpot = [def.tile[0] + primaryOff[0], def.tile[1] + primaryOff[1]];
      def.interact = [def.tile[0] + interactOff[0], def.tile[1] + interactOff[1]];
    } else {
      def.staffSpot = [def.tile[0] + primaryOff[0], def.tile[1] + primaryOff[1]];
      def.interact = [def.tile[0] + interactOff[0], def.tile[1] + interactOff[1]];
    }
  }

  private persistLayout(): void {
    const payload: SavedLayout = {
      furniture: this.scenario.furniture.map((f) => ({
        id: f.id,
        tile: [...f.tile] as [number, number],
        facing: f.facing as IsoFacing | undefined,
        catalogId: f.catalogId,
        flipX: f.flipX,
        footprint: [...f.footprint] as [number, number],
      })),
      hiredStaff: [...this.hiredStaffIds],
      money: this.money,
    };
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    } catch {
      // private mode / quota
    }
  }

  private syncSpotsFromFurniture(): void {
    this.applyOffsetsToDef(this.sofaDef, this.sofaRestOff, this.sofaInteractOff, 'sofa');
    this.applyOffsetsToDef(this.barDef, this.barStaffOff, this.barInteractOff, 'bar');
    this.barInteract = { col: this.barDef.interact![0], row: this.barDef.interact![1] };
    this.staffSpot = { col: this.barDef.staffSpot![0], row: this.barDef.staffSpot![1] };
    this.sofaRest = { col: this.sofaDef.restSpot![0], row: this.sofaDef.restSpot![1] };
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
    this.scenario.furniture.forEach((f) => {
      for (let dc = 0; dc < f.footprint[0]; dc++) {
        for (let dr = 0; dr < f.footprint[1]; dr++) {
          blocked.add(`${f.tile[0] + dc},${f.tile[1] + dr}`);
        }
      }
    });
    this.pathfinder = new Pathfinder(cols, rows, blocked);
    if (this.bartender) {
      this.bartender.setPathfinder(this.pathfinder);
    }
    for (const s of this.extraStaff) {
      s.setPathfinder(this.pathfinder);
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
    const { cols, rows } = this.scenario.map;
    const wall = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    for (let dc = 0; dc < def.footprint[0]; dc++) {
      for (let dr = 0; dr < def.footprint[1]; dr++) {
        const c = col + dc;
        const r = row + dr;
        // 1-tile outer rim = neon wall (reject even if scenario.blocked empty)
        if (
          c < BUILD_MARGIN ||
          r < BUILD_MARGIN ||
          c >= cols - BUILD_MARGIN ||
          r >= rows - BUILD_MARGIN
        ) {
          return false;
        }
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

  /** Display size for any furniture type (extend when adding shop items). */
  private furnitureDisplaySize(kind: string, def?: FurnitureDef): { w: number; h: number } {
    if (def?.displayW && def?.displayH) return { w: def.displayW, h: def.displayH };
    const cat = this.shopCatalogById.get(def?.catalogId ?? kind) ?? this.shopCatalogById.get(kind);
    if (cat) return { w: cat.displaySize[0], h: cat.displaySize[1] };
    if (kind === 'bar') return { w: 168, h: 124 };
    if (kind === 'sofa') return { w: 110, h: 84 };
    return { w: 96, h: 72 };
  }

  /** World draw position (tile center + per-type vertical bias). */
  private furnitureWorldPos(
    kind: string,
    col: number,
    row: number,
    def?: FurnitureDef
  ): { x: number; y: number } {
    const { x, y } = tileToScreen(col, row, this.iso);
    if (typeof def?.yBias === 'number') return { x, y: y + def.yBias };
    const cat = this.shopCatalogById.get(def?.catalogId ?? kind) ?? this.shopCatalogById.get(kind);
    if (cat) return { x, y: y + (cat.yBias ?? -8) };
    if (kind === 'bar') return { x, y: y - 16 };
    if (kind === 'sofa') return { x, y: y - 6 };
    return { x, y: y - 8 };
  }

  private furnitureTextureFor(
    kind: string,
    facing: IsoFacing,
    def?: FurnitureDef
  ): string {
    return this.furnitureTextureKey(kind, facing, def);
  }

  /**
   * Sprite-vs-neon authority: opaque visual AABB must stay inside floorPoly.
   * Used by all furniture types (present and future purchasable decorations).
   */
  private canPlaceVisualAt(
    kind: string,
    col: number,
    row: number,
    facing: IsoFacing,
    def?: FurnitureDef
  ): boolean {
    const size = this.furnitureDisplaySize(kind, def);
    const pos = this.furnitureWorldPos(kind, col, row, def);
    const key = this.furnitureTextureFor(kind, facing, def);
    return canPlaceVisual(
      this.textures,
      this.floorPoly,
      key,
      pos.x,
      pos.y,
      size.w,
      size.h
    );
  }

  private poseAllowed(
    def: FurnitureDef,
    col: number,
    row: number,
    facing: IsoFacing
  ): boolean {
    if (!this.canPlaceFurniture(def, col, row)) return false;
    return this.canPlaceVisualAt(def.type, col, row, facing, def);
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
    if (id === 'sofa') img.setTint(0xffc0e8);
    else if (id === 'bar') img.setTint(0xffe0a0);
    else img.setTint(0xc8b0ff);
  }

  /**
   * If a saved/default pose fails sprite-vs-neon, spiral-search a nearby valid tile.
   * Keeps old localStorage layouts from spawning already overflowing.
   */
  private ensureAllFurnitureInsideFloor(): void {
    for (const def of this.scenario.furniture) {
      const facing = (def.facing as IsoFacing) || 'se';
      if (this.poseAllowed(def, def.tile[0], def.tile[1], facing)) continue;
      const found = this.findNearestValidTile(def, facing);
      if (!found) continue;
      def.tile = found;
      if (def.type === 'sofa') {
        this.sofaDef = def;
        this.sofaFacing = facing;
        this.syncSpotsFromFurniture();
        this.repositionFurnitureVisual('sofa');
      } else if (def.type === 'bar') {
        this.barDef = def;
        this.barFacing = facing;
        this.syncSpotsFromFurniture();
        this.repositionFurnitureVisual('bar');
        // Luna stays on the floor — do not snap her into the bar when furniture moves.
        this.syncBartenderBarDepth();
      } else if (def.fromShop || def.catalogId) {
        this.repositionFurnitureVisual(def.id);
      }
    }
    this.rebuildPathfinder();
  }

  private findNearestValidTile(
    def: FurnitureDef,
    facing: IsoFacing
  ): [number, number] | null {
    const { cols, rows } = this.scenario.map;
    const [sc, sr] = def.tile;
    for (let rad = 0; rad < Math.max(cols, rows); rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (rad > 0 && Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = sc + dc;
          const r = sr + dr;
          if (this.poseAllowed(def, c, r, facing)) return [c, r];
        }
      }
    }
    return null;
  }

  private drawRoom(cols: number, rows: number): void {
    const { originX, originY, tileWidth, tileHeight } = this.iso;
    const midCol = (cols - 1) / 2;
    const midRow = (rows - 1) / 2;
    const center = tileToScreen(midCol, midRow, this.iso);

    // Size room art so the neon platform border hugs the outer placeable tiles
    // (art neon bbox covers ~87% of the image; match that to the iso diamond).
    const diamondW = (cols + rows - 2) * (tileWidth / 2);
    const diamondH = (cols + rows - 2) * (tileHeight / 2);
    // neon bbox ~87% of art; ROOM_NEON_MATCH_FRAC pushes wall slightly outward so
    // BUILD_MARGIN rim sits on/under neon while placeable tiles hug glossy floor.
    const neonFrac = ROOM_NEON_MATCH_FRAC;
    this.roomImage = this.add.image(center.x, center.y + 6, 'room_floor');
    this.roomImage.setDisplaySize(diamondW / neonFrac, diamondH / neonFrac);
    this.roomImage.setDepth(0);
    this.roomImage.setAlpha(1);

    // Playable floor = neon diamond inset ~6% (sprite-vs-neon authority).
    this.floorPoly = computePlayableFloorPolygon(
      this.roomImage.x,
      this.roomImage.y,
      this.roomImage.displayWidth,
      this.roomImage.displayHeight
    );

    const blockedWall = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (blockedWall.has(`${col},${row}`)) continue;
        const { x, y } = tileToScreen(col, row, this.iso);
        const dot = this.add.circle(x, y, 1.5, 0x2ad6ff, 0.08);
        dot.setDepth(1);
      }
    }

    this.add
      .rectangle(originX, originY + 200, 640, 420, 0x000000, 0.12)
      .setDepth(1);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    this.refreshCameraBounds();

    // Slight zoom-out on narrow / mobile viewports (pinch/wheel can still go to ZOOM_MIN/MAX)
    const w = cam.width;
    let zoom = 1;
    if (w < 420) zoom = 0.72;
    else if (w < 560) zoom = 0.8;
    else if (w < 720) zoom = 0.9;
    cam.setZoom(Phaser.Math.Clamp(zoom, ZOOM_MIN, ZOOM_MAX));
    cam.centerOn(this.roomImage.x, this.roomImage.y + 20);
  }

  /** World scroll bounds around the room — call after zoom so corners stay reachable. */
  private refreshCameraBounds(): void {
    const cam = this.cameras.main;
    const room = this.roomImage;
    if (!room) return;
    const pad = 100;
    const bw = room.displayWidth + pad * 2;
    const bh = room.displayHeight + pad * 2;
    cam.setBounds(
      room.x - room.displayWidth / 2 - pad,
      room.y - room.displayHeight / 2 - pad,
      bw,
      bh
    );
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

      // World tap with staff selected: bar menu / walk / ignore scenery
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
        this.hideBarMenu();
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
    if (p.y < HUD_TOP) return true;
    const ui = this.scene.get('UIScene') as Phaser.Scene & {
      isPointerOnUi?: (p: Phaser.Input.Pointer) => boolean;
    };
    if (ui?.isPointerOnUi?.(p)) return true;
    return false;
  }

  private furnitureTextureKey(kind: string, facing: IsoFacing, def?: FurnitureDef): string {
    const src =
      def ??
      (kind === 'sofa'
        ? this.sofaDef
        : kind === 'bar'
          ? this.barDef
          : this.scenario.furniture.find((f) => f.id === kind || f.type === kind));
    const fromScenario = src?.sprites?.[facing];
    if (fromScenario) return fromScenario;
    const cat =
      this.shopCatalogById.get(src?.catalogId ?? '') ||
      this.shopCatalogById.get(src?.type ?? '') ||
      this.shopCatalogById.get(kind);
    if (cat?.sprites?.[facing]) return cat.sprites[facing] as string;
    if (cat?.sprites?.se && (src?.fromShop || src?.catalogId || cat.id === kind)) {
      return cat.sprites.se as string;
    }
    // Single-angle shop sprites (same key for all facings)
    if (src?.fromShop || src?.catalogId) {
      if (cat) return cat.sprite;
      if (src.sprite && this.textures.exists(src.sprite)) return src.sprite;
    }
    if (cat) return cat.sprite;
    return `furn_${kind}_${facing}`;
  }

  private applyBarDisplaySize(): void {
    const size = this.furnitureDisplaySize('bar');
    this.barImage.setDisplaySize(size.w, size.h);
    this.barImage.setAlpha(1);
    this.barImage.setBlendMode(Phaser.BlendModes.NORMAL);
  }


  private placeFurniture(): void {
    for (const f of this.scenario.furniture) {
      const { x, y } = tileToScreen(f.tile[0], f.tile[1], this.iso);
      if (f.type === 'bar') {
        this.barDef = f;
        this.barFacing = (f.facing as IsoFacing) || 'se';
        if (!FACINGS.includes(this.barFacing)) this.barFacing = 'se';
        const bkey = this.furnitureTextureKey('bar', this.barFacing, f);
        this.requireTexture(bkey);
        this.barImage = this.add.image(x, y - 16, bkey);
        this.applyBarDisplaySize();
        const barDepth = depthForFurniture(f.tile[0], f.tile[1], f.footprint);
        this.barImage.setDepth(barDepth);
        this.barGlow = this.add.circle(x, y - 20, 36, 0xaa44ff, 0.08);
        this.barGlow.setDepth(depthForFurniture(f.tile[0], f.tile[1], f.footprint, 2));
        this.barImage.setInteractive({ useHandCursor: true, draggable: false });
        this.barImage.on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (p.rightButtonDown()) return;
          if (!this.buildMode) return;
          this.beginFurniturePointer(p, 'bar');
        });
        this.barImage.on('pointerup', (p: Phaser.Input.Pointer) => {
          if (this.panDragging || this.skipNextTap) return;
          if (!this.buildMode) return;
          if (p.getDistance() > TAP_THRESH && !this.furnDragging) return;
          if (!this.furnDragging || this.furnDragId !== 'bar') {
            this.selectFurniture('bar');
          }
        });
      } else if (f.type === 'sofa') {
        this.sofaDef = f;
        this.sofaFacing = (f.facing as IsoFacing) || 'se';
        if (!FACINGS.includes(this.sofaFacing)) this.sofaFacing = 'se';
        const key = this.furnitureTextureKey('sofa', this.sofaFacing, f);
        this.requireTexture(key);
        this.sofaImage = this.add.image(x, y - 6, key);
        this.sofaImage.setDisplaySize(110, 84);
        this.sofaImage.setDepth(depthForFurniture(f.tile[0], f.tile[1], f.footprint));
        this.sofaImage.setInteractive({ useHandCursor: true });
        this.sofaImage.on('pointerdown', (p: Phaser.Input.Pointer) => {
          if (p.rightButtonDown()) return;
          if (!this.buildMode) return;
          this.beginFurniturePointer(p, 'sofa');
        });
        this.sofaImage.on('pointerup', (p: Phaser.Input.Pointer) => {
          if (this.panDragging || this.skipNextTap) return;
          if (!this.buildMode) return;
          if (p.getDistance() > TAP_THRESH && !this.furnDragging) return;
          if (!this.furnDragging || this.furnDragId !== 'sofa') {
            this.selectFurniture('sofa');
          }
        });
      } else if (f.fromShop || f.catalogId) {
        this.spawnShopFurnitureVisual(f);
      }
    }
    const anchor = this.sofaDef || this.barDef;
    const pos = tileToScreen(anchor.tile[0], anchor.tile[1], this.iso);
    this.buildRotateUi(pos.x, pos.y);
  }

  private beginFurniturePointer(p: Phaser.Input.Pointer, id: SelectedFurniture): void {
    if (!this.buildMode || !id) return;
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
    const facing = this.getFurnitureFacing(id);
    const ok = this.poseAllowed(def, tile.col, tile.row, facing);
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
      this.syncSpotsFromFurniture();
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
    const facing = this.getFurnitureFacing(id);
    // Tile/rim first filter; sprite-vs-neon is the authority for looking inside
    if (!this.poseAllowed(def, col, row, facing)) return;
    if (def.tile[0] === col && def.tile[1] === row) return;
    def.tile = [col, row];
    if (id === 'sofa' || id === 'bar') this.syncSpotsFromFurniture();
    this.repositionFurnitureVisual(id);
    if (persist) {
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncBartenderBarDepth();
    }
  }

  private repositionFurnitureVisual(id: SelectedFurniture): void {
    if (!id) return;
    if (id === 'sofa') {
      const pos = this.furnitureWorldPos('sofa', this.sofaDef.tile[0], this.sofaDef.tile[1]);
      this.sofaImage.setPosition(pos.x, pos.y);
      this.sofaImage.setDepth(
        depthForFurniture(this.sofaDef.tile[0], this.sofaDef.tile[1], this.sofaDef.footprint)
      );
      if (this.selectedFurniture === 'sofa') {
        this.rotateUi.setPosition(pos.x, pos.y - 66);
      }
    } else if (id === 'bar') {
      const pos = this.furnitureWorldPos('bar', this.barDef.tile[0], this.barDef.tile[1]);
      const barDepth = depthForFurniture(
        this.barDef.tile[0],
        this.barDef.tile[1],
        this.barDef.footprint
      );
      this.barImage.setPosition(pos.x, pos.y);
      this.barImage.setDepth(barDepth);
      this.barGlow.setPosition(pos.x, pos.y - 4);
      this.barGlow.setDepth(
        depthForFurniture(this.barDef.tile[0], this.barDef.tile[1], this.barDef.footprint, 2)
      );
      if (this.selectedFurniture === 'bar') {
        this.rotateUi.setPosition(pos.x, pos.y - 70);
      }
      this.syncBartenderBarDepth();
    } else {
      const def = this.getFurnitureDef(id);
      const img = this.shopImages.get(id);
      if (!def || !img) return;
      const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
      img.setPosition(pos.x, pos.y);
      if ((def.facingSupport ?? 'flip') === 'flip') {
        img.setFlipX(!!def.flipX);
      }
      img.setDepth(depthForFurniture(def.tile[0], def.tile[1], def.footprint));
      if (this.selectedFurniture === id) {
        this.rotateUi.setPosition(pos.x, pos.y - 78);
      }
    }
  }

  private buildRotateUi(x: number, y: number): void {
    this.rotateUi = this.add.container(x, y - 70).setDepth(9000).setVisible(false);

    const bg = this.add.rectangle(0, 0, 168, 40, 0x1a0e28, 0.92);
    bg.setStrokeStyle(1, 0xff3ca0);

    const mk = (ox: number, label: string, dir: number) => {
      const c = this.add.container(ox, 0);
      const b = this.add.rectangle(0, 0, 72, 28, 0xb43282, 1);
      b.setStrokeStyle(1, 0xff7ac8);
      b.setInteractive({ useHandCursor: true });
      const t = this.add
        .text(0, 0, label, { fontSize: '12px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5);
      b.on('pointerover', () => b.setFillStyle(0xd44a9a));
      b.on('pointerout', () => b.setFillStyle(0xb43282));
      b.on('pointerdown', (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        this.blockPanGesture = true;
        this.panActive = false;
        this.rotateSelected(dir);
      });
      c.add([b, t]);
      return c;
    };

    this.rotateUi.add([bg, mk(-40, 'Girar ⟲', -1), mk(40, 'Girar ⟳', 1)]);
  }

  private selectFurniture(id: SelectedFurniture): void {
    if (!this.buildMode || !id) return;
    this.deselectNpc();
    this.game.events.emit('npc-deselected');
    this.clearFurnitureSelection();
    this.selectedFurniture = id;
    if (id === 'sofa') {
      this.sofaImage.setTint(0xffc0e8);
      this.rotateUi.setVisible(true);
      const { x, y } = tileToScreen(this.sofaDef.tile[0], this.sofaDef.tile[1], this.iso);
      this.rotateUi.setPosition(x, y - 72);
      this.buildHint.setText('Arrastra el sofá · Girar ⟲ ⟳').setVisible(true);
    } else if (id === 'bar') {
      this.barImage.setTint(0xffe0a0);
      this.rotateUi.setVisible(true);
      const { x, y } = tileToScreen(this.barDef.tile[0], this.barDef.tile[1], this.iso);
      this.rotateUi.setPosition(x, y - 86);
      this.buildHint.setText('Arrastra la barra · Girar ⟲ ⟳').setVisible(true);
    } else {
      const def = this.getFurnitureDef(id);
      const img = this.shopImages.get(id);
      if (!def || !img) return;
      img.setTint(0xc8b0ff);
      const support = def.facingSupport ?? 'flip';
      this.rotateUi.setVisible(support !== 'none');
      const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
      this.rotateUi.setPosition(pos.x, pos.y - 78);
      const name = this.shopCatalogById.get(def.catalogId ?? '')?.name ?? 'mueble';
      const rotHint =
        support === 'flip'
          ? ' · Girar refleja (1 ángulo)'
          : support === 'full'
            ? ' · Girar ⟲ ⟳'
            : '';
      this.buildHint.setText(`Arrastra ${name}${rotHint}`).setVisible(true);
    }
  }

  private clearFurnitureSelection(): void {
    if (this.selectedFurniture === 'sofa' && this.sofaImage) {
      this.sofaImage.clearTint();
    } else if (this.selectedFurniture === 'bar' && this.barImage) {
      this.barImage.clearTint();
    } else if (this.selectedFurniture) {
      this.shopImages.get(this.selectedFurniture)?.clearTint();
    }
    this.selectedFurniture = null;
    if (this.rotateUi) this.rotateUi.setVisible(false);
  }

  setBuildMode = (on: boolean): void => {
    if (on && this.phase === 'open') {
      this.game.events.emit('build-mode-changed', false);
      return;
    }
    this.buildMode = on;
    this.clearFurnitureSelection();
    this.hideBarMenu();
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
      this.syncSpotsFromFurniture();
      this.syncBartenderBarDepth();
    }
    this.game.events.emit('build-mode-changed', this.buildMode);
  };

  private rotateSelected(dir: number): void {
    if (!this.buildMode) return;
    if (this.selectedFurniture === 'bar') this.rotateBar(dir);
    else if (this.selectedFurniture === 'sofa') this.rotateSofa(dir);
    else if (this.selectedFurniture) this.rotateShopFurniture(this.selectedFurniture, dir);
  }

  private rotateSofa(dir: number): void {
    if (!this.buildMode) return;
    const idx = FACINGS.indexOf(this.sofaFacing);
    const next = FACINGS[(idx + dir + FACINGS.length) % FACINGS.length];
    const prevFacing = this.sofaFacing;
    const prevFp: [number, number] = [...this.sofaDef.footprint] as [number, number];
    const prevRest = [...this.sofaRestOff] as [number, number];
    const prevInteract = [...this.sofaInteractOff] as [number, number];

    // 90° grid rotate: footprint swaps; offsets rotate with facing
    this.sofaDef.footprint = [prevFp[1], prevFp[0]];
    if (dir > 0) {
      this.sofaRestOff = [-prevRest[1], prevRest[0]];
      this.sofaInteractOff = [-prevInteract[1], prevInteract[0]];
    } else {
      this.sofaRestOff = [prevRest[1], -prevRest[0]];
      this.sofaInteractOff = [prevInteract[1], -prevInteract[0]];
    }

    const tileOk = this.canPlaceFurniture(
      this.sofaDef,
      this.sofaDef.tile[0],
      this.sofaDef.tile[1]
    );
    const visualOk =
      tileOk &&
      this.canPlaceVisualAt(
        'sofa',
        this.sofaDef.tile[0],
        this.sofaDef.tile[1],
        next,
        this.sofaDef
      );
    if (!visualOk) {
      // Keep previous facing — rotated sprite would cross neon
      this.sofaDef.footprint = prevFp;
      this.sofaRestOff = prevRest;
      this.sofaInteractOff = prevInteract;
      return;
    }

    this.sofaFacing = next;
    this.sofaDef.facing = next;
    const size = this.furnitureDisplaySize('sofa');
    this.sofaImage.setTexture(this.furnitureTextureKey('sofa', next));
    this.sofaImage.setDisplaySize(size.w, size.h);
    this.syncSpotsFromFurniture();
    this.persistLayout();
    this.rebuildPathfinder();
    void prevFacing;
  }

  private rotateBar(dir: number): void {
    if (!this.buildMode) return;
    const idx = FACINGS.indexOf(this.barFacing);
    const next = FACINGS[(idx + dir + FACINGS.length) % FACINGS.length];
    const prevFp: [number, number] = [...this.barDef.footprint] as [number, number];
    const prevStaff = [...this.barStaffOff] as [number, number];
    const prevInteract = [...this.barInteractOff] as [number, number];

    this.barDef.footprint = [prevFp[1], prevFp[0]];
    if (dir > 0) {
      this.barStaffOff = [-prevStaff[1], prevStaff[0]];
      this.barInteractOff = [-prevInteract[1], prevInteract[0]];
    } else {
      this.barStaffOff = [prevStaff[1], -prevStaff[0]];
      this.barInteractOff = [prevInteract[1], -prevInteract[0]];
    }

    const tileOk = this.canPlaceFurniture(
      this.barDef,
      this.barDef.tile[0],
      this.barDef.tile[1]
    );
    const visualOk =
      tileOk &&
      this.canPlaceVisualAt(
        'bar',
        this.barDef.tile[0],
        this.barDef.tile[1],
        next,
        this.barDef
      );
    if (!visualOk) {
      // Keep previous facing — rotated sprite would cross neon
      this.barDef.footprint = prevFp;
      this.barStaffOff = prevStaff;
      this.barInteractOff = prevInteract;
      return;
    }

    this.barFacing = next;
    this.barDef.facing = next;
    this.barImage.setTexture(this.furnitureTextureKey('bar', next));
    this.applyBarDisplaySize();
    this.syncSpotsFromFurniture();
    this.syncBartenderBarDepth();
    this.persistLayout();
    this.rebuildPathfinder();
  }

  openNight = (): void => {
    if (this.buildMode) return;
    if (this.phase !== 'prep' && this.phase !== 'summary') return;
    if (this.phase === 'summary') {
      this.resetForNewNight();
    }
    this.clearFurnitureSelection();
    this.rebuildPathfinder();
    this.syncSpotsFromFurniture();
    this.phase = 'open';
    this.nightEarned = 0;
    this.servedCount = 0;
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
    const drinkName = this.drinkDisplayName(pdata.preferredDrink);
    const patron = new Patron(
      this,
      pdata.sprite,
      spawn,
      this.iso,
      this.pathfinder,
      pdata,
      drinkName
    );
    // Spawning / first walk play can race texture bind — lock size again.
    patron.reapplyDisplaySize();
    this.wirePatronClick(patron);
    this.patrons.push(patron);

    const goSofa = Math.random() < 0.35;
    if (goSofa) {
      patron.goal = 'sofa';
      const spot = this.findFreeNear(this.sofaRest);
      patron.walkTo(spot, () => {
        patron.waiting = true;
        patron.showBubble('😌');
        this.time.delayedCall(4000 + Math.random() * 3000, () => {
          if (!patron.active || this.phase !== 'open') return;
          this.sendPatronHome(patron);
        });
      });
    } else {
      patron.goal = 'bar';
      const spot = this.findFreeNear(this.barInteract);
      patron.walkTo(spot, () => {
        patron.waiting = true;
        const drink = this.drinks.find((d) => d.id === pdata.preferredDrink) || this.drinks[0];
        patron.showBubble(drink.name);
        this.tryServe(patron, drink);
      });
    }
  }

  private findFreeNear(center: { col: number; row: number }): { col: number; row: number } {
    const candidates = [
      center,
      { col: center.col - 1, row: center.row },
      { col: center.col, row: center.row + 1 },
      { col: center.col - 1, row: center.row + 1 },
      { col: center.col + 1, row: center.row },
    ];
    for (const c of candidates) {
      const k = `${c.col},${c.row}`;
      if (this.pathfinder.isWalkable(c.col, c.row) && !this.queueTiles.has(k)) {
        this.queueTiles.add(k);
        return c;
      }
    }
    return center;
  }

  private releaseTile(pos: { col: number; row: number }): void {
    this.queueTiles.delete(`${pos.col},${pos.row}`);
  }

  /**
   * Patron arrived at bar and is waiting. Staff AI (Luna/Nova) will Atender;
   * drink is resolved again when a staff member picks up the job.
   */
  private tryServe(patron: Patron, drink: Drink): void {
    if (this.phase !== 'open' || !patron.active) return;
    void drink;
    // Immediate try: if a free waitress is available, assign now.
    this.tryAssignServeAi(patron);
  }

  private sendPatronHome(patron: Patron): void {
    if (!patron.active) return;
    patron.waiting = false;
    this.releaseTile(patron.grid);
    patron.goal = 'leave';
    const exit = {
      col: this.scenario.exitTile[0],
      row: this.scenario.exitTile[1],
    };
    patron.walkTo(exit, () => {
      if (this.selectedNpcId === patron.profile.id) {
        this.deselectNpc();
        this.game.events.emit('npc-deselected');
      }
      this.patrons = this.patrons.filter((p) => p !== patron);
      patron.destroy();
    });
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

  /**
   * Free walkable tile near sofa/floor for Luna & Nova (not inside the bar).
   * Both are independent waitresses — bar is only a destination for menu actions.
   */
  private findFloorStaffSpawnTile(): { col: number; row: number } {
    const base = this.sofaRest ?? {
      col: this.sofaDef?.tile[0] ?? 3,
      row: this.sofaDef?.tile[1] ?? 5,
    };
    const offsets: [number, number][] = [
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
    // Fallback: south of bar interact (still on floor, not staffSpot)
    const alt = this.barInteract ?? { col: 4, row: 4 };
    for (const [dc, dr] of [
      [0, 2],
      [-1, 2],
      [1, 2],
      [0, 3],
    ] as [number, number][]) {
      const col = alt.col + dc;
      const row = alt.row + dr;
      if (this.isTileFreeForStaff(col, row)) return { col, row };
    }
    return { col: 4, row: 6 };
  }

  /** Alias — hired Nova uses the same floor spawn as Luna. */
  private findStaffSpawnTile(): { col: number; row: number } {
    return this.findFloorStaffSpawnTile();
  }

  private isTileFreeForStaff(col: number, row: number): boolean {
    if (!this.pathfinder?.isWalkable(col, row)) return false;
    if (this.bartender && this.bartender.grid.col === col && this.bartender.grid.row === row) return false;
    if (this.extraStaff.some((s) => s.grid.col === col && s.grid.row === row)) return false;
    if (this.staffSpot && this.staffSpot.col === col && this.staffSpot.row === row) return false;
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


  /** Furniture is interactive only in Construir — otherwise it steals staff taps (Luna under bar). */
  private syncFurnitureInteractive(): void {
    if (this.barImage) {
      if (this.buildMode) {
        this.barImage.setInteractive({ useHandCursor: true, draggable: false });
      } else if (this.barImage.input) {
        this.barImage.disableInteractive();
      }
    }
    if (this.sofaImage) {
      if (this.buildMode) {
        this.sofaImage.setInteractive({ useHandCursor: true });
      } else if (this.sofaImage.input) {
        this.sofaImage.disableInteractive();
      }
    }
    for (const img of this.shopImages.values()) {
      if (this.buildMode) {
        img.setInteractive({ useHandCursor: true });
      } else if (img.input) {
        img.disableInteractive();
      }
    }
  }

  private buildBarMenu(): void {
    this.barMenu = this.add.container(0, 0).setDepth(9200).setVisible(false);
    const bg = this.add.rectangle(0, 0, 168, 78, 0x1a0e28, 0.94);
    bg.setStrokeStyle(1, 0xff3ca0);
    const mk = (oy: number, label: string, action: 'serve' | 'clean') => {
      const c = this.add.container(0, oy);
      const b = this.add.rectangle(0, 0, 148, 28, 0xb43282, 1);
      b.setStrokeStyle(1, 0xff7ac8);
      b.setInteractive({ useHandCursor: true });
      const t = this.add
        .text(0, 0, label, { fontSize: '12px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5);
      b.on('pointerover', () => b.setFillStyle(0xd44a9a));
      b.on('pointerout', () => b.setFillStyle(0xb43282));
      b.on('pointerdown', (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        this.blockPanGesture = true;
        this.panActive = false;
        this.npcTapHandled = true;
        if (action === 'serve') this.doBarServeDrinks();
        else this.doBarClean();
      });
      c.add([b, t]);
      return c;
    };
    this.barMenu.add([bg, mk(-18, 'Pedir bebidas', 'serve'), mk(18, 'Limpiar barra', 'clean')]);
  }

  private showBarMenu(): void {
    if (!this.barMenu || !this.barImage) return;
    const x = this.barImage.x;
    const y = this.barImage.y - 78;
    this.barMenu.setPosition(x, y);
    this.barMenu.setVisible(true);
    this.barMenuVisible = true;
  }

  private hideBarMenu(): void {
    if (this.barMenu) this.barMenu.setVisible(false);
    this.barMenuVisible = false;
  }

  private isPointerOverGameObject(
    p: Phaser.Input.Pointer,
    go: Phaser.GameObjects.Image | undefined
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

    if (staff) {
      // Interactive scenery: bar → menu; sofa → no move
      if (this.isPointerOverGameObject(p, this.barImage)) {
        this.showBarMenu();
        return;
      }
      if (this.isPointerOverGameObject(p, this.sofaImage)) {
        this.hideBarMenu();
        return;
      }
      this.hideBarMenu();
      this.moveSelectedStaffToPointer(p, staff);
      return;
    }

    // No staff selected: empty tap deselects any leftover selection / closes menu
    this.hideBarMenu();
    if (this.selectedNpcId) {
      this.deselectNpc();
      this.game.events.emit('npc-deselected');
    }
  }

  private moveSelectedStaffToPointer(p: Phaser.Input.Pointer, staff: Bartender): void {
    if (this.barActionBusy && staff.playerCommanded) return;
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

  private selectedStaffOrNull(): Bartender | null {
    if (!this.selectedNpcId) return null;
    return this.findStaffById(this.selectedNpcId);
  }

  private doBarServeDrinks(): void {
    const staff = this.selectedStaffOrNull();
    if (!staff || this.barActionBusy || this.buildMode) return;
    if (staff.state === 'resting') return;
    this.hideBarMenu();
    this.barActionBusy = true;
    this.releaseStaffAiClaims(staff);
    staff.cancelWalk();
    staff.beginPlayerCommand('serve');
    staff.servingDrinkId = 'generic';
    staff.state = 'busy';
    const finish = () => {
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      staff.setServeLabel('Sirviendo bebida');
      this.playStaffActionTween(staff, () => {
        const earned = Phaser.Math.Between(8, 15);
        this.money += earned;
        this.nightEarned += earned;
        staff.profile.mood = Math.min(100, staff.profile.mood + Phaser.Math.Between(2, 5));
        staff.profile.energy = Math.max(
          0,
          staff.profile.energy - Math.max(2, Math.floor(staff.profile.energyDrainPerServe / 2))
        );
        staff.state = 'idle';
        staff.servingDrinkId = null;
        staff.clearServeLabel();
        this.releaseStaffTileClaims(staff);
        staff.clearPlayerCommand();
        staff.startBob();
        this.barActionBusy = false;
        this.showStatusFloat(`+$${earned} · Bebidas`);
        this.persistLayout();
        this.game.events.emit('stats-updated', this.getHudState());
        this.emitStaffRoster();
      });
    };
    const go = () => {
      if (!this.claimBarSpot(staff)) {
        this.time.delayedCall(300, go);
        return;
      }
      const ok = staff.walkTo(this.staffSpot, finish);
      if (!ok) finish();
    };
    go();
  }

  private doBarClean(): void {
    const staff = this.selectedStaffOrNull();
    if (!staff || this.barActionBusy || this.buildMode) return;
    if (staff.state === 'resting') return;
    this.hideBarMenu();
    this.barActionBusy = true;
    this.releaseStaffAiClaims(staff);
    staff.cancelWalk();
    staff.beginPlayerCommand('clean');
    staff.state = 'busy';
    this.claimBarSpot(staff);
    const finish = () => {
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      this.playStaffActionTween(staff, () => {
        const tip = Phaser.Math.Between(3, 6);
        this.money += tip;
        this.nightEarned += tip;
        staff.profile.energy = Math.max(0, staff.profile.energy - Phaser.Math.Between(8, 14));
        staff.profile.mood = Math.min(100, staff.profile.mood + Phaser.Math.Between(1, 3));
        staff.state = 'idle';
        this.releaseStaffTileClaims(staff);
        staff.clearPlayerCommand();
        staff.startBob();
        this.barActionBusy = false;
        this.showStatusFloat(`Barra limpia · +$${tip}`);
        this.persistLayout();
        this.game.events.emit('stats-updated', this.getHudState());
        this.emitStaffRoster();
      });
    };
    const ok = staff.walkTo(this.staffSpot, finish);
    if (!ok) {
      finish();
    }
  }

  /** Short bob / scale tween while serving or cleaning (no new sheets required). */
  private playStaffActionTween(staff: Bartender, onDone: () => void): void {
    const spr = staff.sprite;
    const baseY = spr.y;
    const baseSX = spr.scaleX;
    const baseSY = spr.scaleY;
    this.tweens.add({
      targets: spr,
      y: baseY - 5,
      scaleX: baseSX * 1.05,
      scaleY: baseSY * 0.95,
      duration: 220,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        spr.y = baseY;
        spr.setScale(baseSX, baseSY);
        staff.reapplyDisplaySize();
        onDone();
      },
    });
  }

  private showStatusFloat(msg: string): void {
    if (this.statusFloat) {
      this.statusFloat.destroy();
      this.statusFloat = undefined;
    }
    const x = this.barImage?.x ?? this.cameras.main.centerX;
    const y = (this.barImage?.y ?? 120) - 100;
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
    this.serveClaim.clear();
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

  private waitingBarPatrons(): Patron[] {
    return this.patrons.filter(
      (p) => p.active && p.waiting && !p.served && p.goal === 'bar' && !this.serveClaim.has(p.profile.id)
    );
  }

  /** patronId → staffId while an Atender job is in flight. */
  private serveClaim = new Map<string, string>();
  /** Destination / job tile → staffId (bar staffSpot, sofa, wander). */
  private staffTileClaims = new Map<string, string>();
  /** Soft bar queue: only one staff may occupy staffSpot at a time. */
  private barSpotHolderId: string | null = null;

  private releaseStaffAiClaims(staff: Bartender): void {
    for (const [pid, sid] of [...this.serveClaim.entries()]) {
      if (sid === staff.profile.id) this.serveClaim.delete(pid);
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

  private claimBarSpot(staff: Bartender): boolean {
    if (this.barSpotHolderId && this.barSpotHolderId !== staff.profile.id) return false;
    this.barSpotHolderId = staff.profile.id;
    this.claimStaffTile(staff, this.staffSpot);
    return true;
  }

  /** Adjacent wait tile near bar when staffSpot is held. */
  private findStaffWaitNearBar(staff: Bartender): { col: number; row: number } {
    const c = this.staffSpot;
    const candidates = [
      { col: c.col - 1, row: c.row },
      { col: c.col, row: c.row + 1 },
      { col: c.col + 1, row: c.row },
      { col: c.col, row: c.row - 1 },
      { col: c.col - 1, row: c.row + 1 },
      { col: c.col + 1, row: c.row + 1 },
      { col: c.col - 1, row: c.row - 1 },
      { col: c.col + 1, row: c.row - 1 },
    ];
    for (const pos of candidates) {
      if (!this.pathfinder.isWalkable(pos.col, pos.row)) continue;
      if (pos.col === c.col && pos.row === c.row) continue;
      if (this.isStaffTileBlocked(pos, staff)) continue;
      return pos;
    }
    // Last resort: stay put
    return { col: staff.grid.col, row: staff.grid.row };
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

  private tryAssignServeAi(patron: Patron): boolean {
    if (!patron.active || !patron.waiting || patron.served || patron.goal !== 'bar') return false;
    if (this.serveClaim.has(patron.profile.id)) return false;
    if (this.buildMode || this.phase !== 'open') return false;
    const staff = this.allStaff().find(
      (s) =>
        !s.playerCommanded &&
        s.aiJob === 'none' &&
        s.state === 'idle' &&
        s.profile.energy >= s.profile.energyDrainPerServe
    );
    if (!staff) return false;
    this.beginAiServe(staff, patron);
    return true;
  }

  private beginAiServe(staff: Bartender, patron: Patron): void {
    const drink =
      this.drinks.find((d) => d.id === patron.profile.preferredDrink) || this.drinks[0];
    staff.aiJob = 'serve';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.servingDrinkId = drink.id;
    this.serveClaim.set(patron.profile.id, staff.profile.id);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    const release = () => {
      this.serveClaim.delete(patron.profile.id);
      staff.servingDrinkId = null;
      staff.clearServeLabel();
      this.releaseStaffTileClaims(staff);
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
      if (staff === this.bartender) this.syncBartenderBarDepth();
    };

    const completeServe = () => {
      if (!patron.active || this.phase !== 'open') {
        release();
        this.game.events.emit('stats-updated', this.getHudState());
        this.emitStaffRoster();
        return;
      }
      staff.applyServeDrain();
      let earned = drink.price;
      if (Math.random() < patron.profile.tipChance) {
        earned += Math.ceil(drink.price * 0.25);
        patron.showBubble('¡Propina!');
      } else {
        patron.showBubble('¡Gracias!');
      }
      this.money += earned;
      this.nightEarned += earned;
      this.servedCount++;
      patron.served = true;
      patron.waiting = false;
      this.releaseTile(patron.grid);
      staff.clearServeLabel();
      staff.servingDrinkId = null;
      release();
      this.persistLayout();
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
      this.time.delayedCall(600, () => this.sendPatronHome(patron));
    };

    const startPrepare = () => {
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      if (!patron.active || !patron.waiting || patron.served || this.phase !== 'open') {
        release();
        this.game.events.emit('stats-updated', this.getHudState());
        this.emitStaffRoster();
        return;
      }

      const label =
        drink.id === 'cerveza' ? 'Sirviendo cerveza' : 'Sirviendo bebida';
      staff.setServeLabel(label);
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();

      // Cerveza: fixed 2000ms + Luna/Nova pour anim. Others: skill-scaled serveTime.
      const skillBonus = staff.skill / 200;
      const prepareMs =
        drink.id === 'cerveza'
          ? drink.serveTimeMs
          : drink.serveTimeMs * (1 - skillBonus * 0.3);

      let playedBeer = false;
      if (drink.id === 'cerveza') {
        playedBeer = staff.playServeBeerAnim();
      }
      if (!playedBeer) {
        // Missing pour sheet: keep idle/bob during prepare
        staff.startBob();
      }

      this.time.delayedCall(prepareMs, () => {
        completeServe();
      });
    };

    const goToBarAndServe = () => {
      if (!this.claimBarSpot(staff)) {
        // Soft queue: wait nearby until spot frees
        const wait = this.findStaffWaitNearBar(staff);
        this.claimStaffTile(staff, wait);
        const okWait = staff.walkTo(wait, () => {
          const poll = () => {
            if (!patron.active || !patron.waiting || patron.served || this.phase !== 'open') {
              release();
              this.game.events.emit('stats-updated', this.getHudState());
              this.emitStaffRoster();
              return;
            }
            if (this.barSpotHolderId && this.barSpotHolderId !== staff.profile.id) {
              this.time.delayedCall(280, poll);
              return;
            }
            if (!this.claimBarSpot(staff)) {
              this.time.delayedCall(280, poll);
              return;
            }
            const okBar = staff.walkTo(this.staffSpot, startPrepare);
            if (!okBar) startPrepare();
          };
          poll();
        });
        if (!okWait) {
          this.time.delayedCall(400, goToBarAndServe);
        }
        return;
      }
      const ok = staff.walkTo(this.staffSpot, startPrepare);
      if (!ok) startPrepare();
    };

    goToBarAndServe();
  }

  private beginAiClean(staff: Bartender): void {
    if (this.barActionBusy) return;
    // Soft queue: only one cleaner/server at staffSpot
    if (this.barSpotHolderId && this.barSpotHolderId !== staff.profile.id) {
      staff.aiNextThinkAt = this.time.now + 600;
      return;
    }
    if (!this.claimBarSpot(staff)) {
      staff.aiNextThinkAt = this.time.now + 600;
      return;
    }
    staff.aiJob = 'clean';
    staff.playerCommanded = false;
    staff.state = 'busy';
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();
    const finish = () => {
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      this.playStaffActionTween(staff, () => {
        const tip = Phaser.Math.Between(2, 5);
        this.money += tip;
        this.nightEarned += tip;
        staff.profile.energy = Math.max(0, staff.profile.energy - Phaser.Math.Between(6, 12));
        staff.profile.mood = Math.min(100, staff.profile.mood + 2);
        staff.state = 'idle';
        this.releaseStaffTileClaims(staff);
        staff.clearAiJob();
        staff.aiNextThinkAt = this.time.now + Phaser.Math.Between(8000, 14000);
        staff.startBob();
        this.showStatusFloat(`Limpieza · +$${tip}`);
        this.persistLayout();
        this.game.events.emit('stats-updated', this.getHudState());
        this.emitStaffRoster();
      });
    };
    const ok = staff.walkTo(this.staffSpot, finish);
    if (!ok) finish();
  }

  private beginStaffRest(npc: Bartender, asPlayer: boolean): void {
    const restGoal = this.findFreeStaffGoal(npc, this.sofaRest);
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
      const col = Phaser.Math.Between(1, cols - 2);
      const row = Phaser.Math.Between(1, rows - 2);
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
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();
    const ok = staff.walkTo(goal, () => {
      staff.state = 'idle';
      this.releaseStaffTileClaims(staff);
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

  /**
   * RimWorld-lite priorities when not player-commanded:
   * 1 Atender → 2 Limpiar → 3 Descansar (low energy) → 4 Vagar
   */
  private tickStaffAi(): void {
    if (this.buildMode) return;
    const now = this.time.now;
    const waiting = this.waitingBarPatrons();

    // First pass: claim serves for waiting patrons
    for (const patron of waiting) {
      this.tryAssignServeAi(patron);
    }

    for (const staff of this.allStaff()) {
      if (staff.playerCommanded) continue;
      if (staff.aiJob !== 'none') continue;
      if (staff.state !== 'idle') continue;
      if (now < staff.aiNextThinkAt) continue;

      const barQueue = this.phase === 'open' ? this.waitingBarPatrons().length : 0;

      // 1) Atender handled above. While patrons wait, don't clean/wander;
      //    exhausted staff may still Descansar.
      if (barQueue > 0) {
        if (staff.profile.energy < 32) {
          this.beginStaffRest(staff, false);
        } else {
          staff.aiNextThinkAt = now + 400;
        }
        continue;
      }

      // 2) Limpiar — occasionally when nobody is waiting
      if (this.phase === 'open' && Math.random() < 0.22) {
        this.beginAiClean(staff);
        continue;
      }

      // 3) Descansar — low energy
      if (staff.profile.energy < 32) {
        this.beginStaffRest(staff, false);
        continue;
      }

      // 4) Vagar
      if (Math.random() < 0.55) {
        this.beginAiWander(staff);
      } else {
        staff.aiNextThinkAt = now + Phaser.Math.Between(1800, 3500);
      }
    }
  }

  update(_t: number, dt: number): void {
    this.syncBartenderBarDepth();
    // AI runs in prep + open (wander/rest/clean); serve only when open.
    if (!this.buildMode) this.tickStaffAi();
    if (this.phase !== 'open') return;
    const dtSec = dt / 1000;
    this.nightTimer -= dtSec;

    for (const patron of [...this.patrons]) {
      if (!patron.active) continue;
      if (patron.tickPatience(dtSec)) {
        patron.showBubble('¡Me voy!');
        patron.waiting = false;
        this.serveClaim.delete(patron.profile.id);
        this.sendPatronHome(patron);
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

  private shopSpritesFromCatalog(
    cat: ShopFurnitureItem
  ): Partial<Record<IsoFacing, string>> {
    if (cat.sprites) {
      return {
        se: cat.sprites.se ?? cat.sprite,
        sw: cat.sprites.sw ?? cat.sprites.se ?? cat.sprite,
        ne: cat.sprites.ne ?? cat.sprites.se ?? cat.sprite,
        nw: cat.sprites.nw ?? cat.sprites.se ?? cat.sprite,
      };
    }
    return { se: cat.sprite, sw: cat.sprite, ne: cat.sprite, nw: cat.sprite };
  }

  /** Refresh texture keys / facingSupport from catalog (upgrades old localStorage DJ booth). */
  private upgradeShopFurnitureFromCatalog(def: FurnitureDef): void {
    const cat = this.shopCatalogById.get(def.catalogId ?? def.type);
    if (!cat) return;
    def.sprite = cat.sprite;
    def.sprites = this.shopSpritesFromCatalog(cat);
    def.facingSupport = cat.facingSupport;
    def.displayW = cat.displaySize[0];
    def.displayH = cat.displaySize[1];
    if (typeof cat.yBias === 'number') def.yBias = cat.yBias;
    if (cat.facingSupport === 'full') {
      def.flipX = false;
    }
  }

  private upgradeAllShopFurnitureFromCatalog(): void {
    for (const f of this.scenario.furniture) {
      if (f.fromShop || f.catalogId) this.upgradeShopFurnitureFromCatalog(f);
    }
  }

  private defFromShopCatalog(catalogId: string, instanceId?: string): FurnitureDef | null {
    const cat = this.shopCatalogById.get(catalogId);
    if (!cat) return null;
    const id = instanceId || this.nextShopInstanceId(catalogId);
    const facing = (cat.defaultFacing as IsoFacing) || 'se';
    return {
      id,
      type: cat.id,
      sprite: cat.sprite,
      catalogId: cat.id,
      fromShop: true,
      facing,
      flipX: false,
      sprites: this.shopSpritesFromCatalog(cat),
      tile: [4, 4],
      footprint: [cat.footprint[0], cat.footprint[1]],
      displayW: cat.displaySize[0],
      displayH: cat.displaySize[1],
      yBias: cat.yBias ?? -8,
      facingSupport: cat.facingSupport,
    };
  }

  private nextShopInstanceId(catalogId: string): string {
    this.shopInstanceSeq += 1;
    // Keep ids unique across reloads by including money-tick-ish seq + existing count
    const n = this.scenario.furniture.filter((f) => f.catalogId === catalogId).length + 1;
    return `${catalogId}_${n}_${this.shopInstanceSeq}`;
  }

  private getFurnitureDef(id: string): FurnitureDef | null {
    if (id === 'sofa') return this.sofaDef;
    if (id === 'bar') return this.barDef;
    return this.scenario.furniture.find((f) => f.id === id) ?? null;
  }

  private getFurnitureImage(id: string): Phaser.GameObjects.Image | null {
    if (id === 'sofa') return this.sofaImage ?? null;
    if (id === 'bar') return this.barImage ?? null;
    return this.shopImages.get(id) ?? null;
  }

  private getFurnitureFacing(id: string): IsoFacing {
    if (id === 'sofa') return this.sofaFacing;
    if (id === 'bar') return this.barFacing;
    const def = this.getFurnitureDef(id);
    const f = (def?.facing as IsoFacing) || 'se';
    return FACINGS.includes(f) ? f : 'se';
  }

  /** True when DJ booth idle sheets are loaded (optional subtle loop). */
  private djBoothIdleReady(): boolean {
    return (
      this.textures.exists('dj_booth_front_sheet') &&
      this.textures.exists('dj_booth_back_sheet') &&
      this.anims.exists('dj-booth-idle-front') &&
      this.anims.exists('dj-booth-idle-back')
    );
  }

  private applyDjBoothIdleVisual(
    img: Phaser.GameObjects.Image,
    facing: IsoFacing,
    size: { w: number; h: number }
  ): void {
    if (!(img instanceof Phaser.GameObjects.Sprite) || !this.djBoothIdleReady()) return;
    const front = facing === 'se' || facing === 'sw';
    const sheet = front ? 'dj_booth_front_sheet' : 'dj_booth_back_sheet';
    const anim = front ? 'dj-booth-idle-front' : 'dj-booth-idle-back';
    img.setTexture(sheet, 0);
    img.setFlipX(facing === 'sw' || facing === 'nw');
    img.setDisplaySize(size.w, size.h);
    img.play(anim);
  }

  private spawnShopFurnitureVisual(def: FurnitureDef): void {
    const facing = (def.facing as IsoFacing) || 'se';
    const key = this.furnitureTextureKey(def.type, facing, def);
    this.requireTexture(key);
    const pos = this.furnitureWorldPos(def.type, def.tile[0], def.tile[1], def);
    const size = this.furnitureDisplaySize(def.type, def);
    const useDjIdle = def.catalogId === 'dj_booth' && this.djBoothIdleReady();
    const img = useDjIdle
      ? this.add.sprite(pos.x, pos.y, key)
      : this.add.image(pos.x, pos.y, key);
    img.setDisplaySize(size.w, size.h);
    if (useDjIdle) {
      this.applyDjBoothIdleVisual(img, facing, size);
    } else {
      img.setFlipX(!!def.flipX);
    }
    img.setDepth(depthForFurniture(def.tile[0], def.tile[1], def.footprint));
    img.setInteractive({ useHandCursor: true });
    const instanceId = def.id;
    img.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      if (!this.buildMode) return;
      this.beginFurniturePointer(p, instanceId);
    });
    img.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.panDragging || this.skipNextTap) return;
      if (!this.buildMode) return;
      if (p.getDistance() > TAP_THRESH && !this.furnDragging) return;
      if (!this.furnDragging || this.furnDragId !== instanceId) {
        this.selectFurniture(instanceId);
      }
    });
    this.shopImages.set(def.id, img);
  }

  private rotateShopFurniture(id: string, dir: number): void {
    const def = this.getFurnitureDef(id);
    const img = this.shopImages.get(id);
    if (!def || !img) return;
    const support = def.facingSupport ?? 'flip';
    if (support === 'none') return;

    if (support === 'flip') {
      // Single-angle asset: mirror until more facings exist
      def.flipX = !def.flipX;
      img.setFlipX(!!def.flipX);
      const idx = FACINGS.indexOf(this.getFurnitureFacing(id));
      const next = FACINGS[(idx + dir + FACINGS.length) % FACINGS.length];
      def.facing = next;
      this.persistLayout();
      return;
    }

    // full: cycle facing like sofa/bar (swap footprint axes)
    const idx = FACINGS.indexOf(this.getFurnitureFacing(id));
    const next = FACINGS[(idx + dir + FACINGS.length) % FACINGS.length];
    const prevFp: [number, number] = [...def.footprint] as [number, number];
    def.footprint = [prevFp[1], prevFp[0]];
    const tileOk = this.canPlaceFurniture(def, def.tile[0], def.tile[1]);
    const visualOk =
      tileOk && this.canPlaceVisualAt(def.type, def.tile[0], def.tile[1], next, def);
    if (!visualOk) {
      def.footprint = prevFp;
      return;
    }
    def.facing = next;
    def.flipX = false;
    const size = this.furnitureDisplaySize(def.type, def);
    if (def.catalogId === 'dj_booth' && this.djBoothIdleReady()) {
      this.applyDjBoothIdleVisual(img, next, size);
    } else {
      img.setTexture(this.furnitureTextureKey(def.type, next, def));
      img.setFlipX(false);
      img.setDisplaySize(size.w, size.h);
    }
    this.persistLayout();
    this.rebuildPathfinder();
  }

  private findFreeShopTile(def: FurnitureDef, facing: IsoFacing): [number, number] | null {
    const found = this.findNearestValidTile(def, facing);
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
          if (this.poseAllowed(def, c, r, facing)) return [c, r];
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
    const facing = (def.facing as IsoFacing) || 'se';
    const tile = this.findFreeShopTile(def, facing);
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
  }
}
