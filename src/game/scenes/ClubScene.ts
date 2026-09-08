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
import { Bartender, BartenderData } from '../entities/Bartender';
import { Patron, PatronData } from '../entities/Patron';
import { NpcInfo } from '../types/Npc';

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
  bartender: BartenderData & { sprite: string; role: string };
  patrons: PatronData[];
}

interface SavedLayoutItem {
  id: string;
  tile: [number, number];
  facing?: IsoFacing;
}

interface SavedLayout {
  furniture: SavedLayoutItem[];
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
/**
 * Bottom fraction of bar opaque AABB kept in barFront (counter mass over Luna).
 * SE/SW = customer FRONT: light keep so head→navel/waist clears the counter.
 * NE/NW = service BACK: Luna is fully hidden at staffSpot (keep unused for crop;
 *   still generated; hide is the authority).
 */
const BAR_FRONT_KEEP_FRAC: Record<IsoFacing, number> = {
  se: 0.62,
  sw: 0.62,
  ne: 1.0,
  nw: 1.0,
};
/** Customer-facing (front) bar angles — neon panels toward camera. */
const BAR_FRONT_FACINGS: ReadonlySet<IsoFacing> = new Set(['se', 'sw']);
/** Service-facing (back) bar angles — bottles toward camera. */
const BAR_BACK_FACINGS: ReadonlySet<IsoFacing> = new Set(['ne', 'nw']);
/** barFront depth = bartenderDepth + this (counter always above Luna). */
const BAR_FRONT_DEPTH_ABOVE = 20;
/** Luna sprite.y when not tucked behind a front counter. */
const LUNA_SPRITE_Y_DEFAULT = 6;
/** Raise Luna at front staffSpot so waist clears the counter top. */
const LUNA_SPRITE_Y_AT_FRONT_BAR = -2;

export type NightPhase = 'prep' | 'open' | 'summary';

type SelectedFurniture = 'sofa' | 'bar' | null;

export class ClubScene extends Phaser.Scene {
  iso!: IsoConfig;
  pathfinder!: Pathfinder;
  scenario!: Scenario;
  chars!: CharactersFile;
  bartender!: Bartender;
  patrons: Patron[] = [];
  money = 0;
  nightEarned = 0;
  servedCount = 0;
  phase: NightPhase = 'prep';
  nightTimer = 0;
  buildMode = false;
  /** Currently selected NPC id (bartender profile id or patron runtime id). */
  private selectedNpcId: string | null = null;
  /** Set by NPC sprite handlers so empty-world tap can deselect. */
  private npcTapHandled = false;

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
  /** Counter-only overlay (lower crop of bar) drawn above Luna for occlusion. */
  private barFrontImage!: Phaser.GameObjects.Image;
  private barGlow!: Phaser.GameObjects.Arc;
  private roomImage!: Phaser.GameObjects.Image;

  private selectedFurniture: SelectedFurniture = null;
  private rotateUi!: Phaser.GameObjects.Container;
  private buildHint!: Phaser.GameObjects.Text;

  // Relative offsets from furniture tile (computed on load / after layout apply)
  private sofaRestOff: [number, number] = [0, 0];
  private sofaInteractOff: [number, number] = [0, -1];
  private barInteractOff: [number, number] = [-1, 0];
  private barStaffOff: [number, number] = [0, 1];

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
    this.requireTexture(this.chars.bartender.sprite || 'bartender');

    this.rebuildPathfinder();
    this.syncSpotsFromFurniture();

    this.drawRoom(cols, rows);
    this.ensureBarFrontTextures();
    this.placeFurniture();
    this.ensureAllFurnitureInsideFloor();
    this.setupCamera();

    const bd = this.chars.bartender;
    this.bartender = new Bartender(
      this,
      bd.sprite || 'bartender',
      { ...this.staffSpot },
      this.iso,
      this.pathfinder,
      bd
    );
    this.syncBartenderBarDepth();
    this.bartender.sprite.on('pointerdown', () => {
      if (!this.buildMode) this.npcTapHandled = true;
    });
    this.bartender.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.panDragging || this.furnDragging || this.skipNextTap) return;
      if (p.getDistance() > TAP_THRESH) return;
      if (this.buildMode) return;
      p.event.stopPropagation();
      this.npcTapHandled = true;
      this.selectNpcStaff();
    });

    this.setupPointerPan();
    this.setupZoom();
    this.input.mouse?.disableContextMenu();

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
    this.game.events.on('cmd-set-build-mode', this.setBuildMode, this);
    this.game.events.on('cmd-deselect-npc', this.deselectNpc, this);
    this.game.events.on('cmd-deselect-bartender', this.deselectNpc, this);
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
      state: this.bartender.state,
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
    };
  }

  private getSelectedNpcInfo(): NpcInfo | null {
    if (!this.selectedNpcId) return null;
    if (this.bartender && this.selectedNpcId === this.bartender.profile.id) {
      return this.bartenderNpcInfo();
    }
    const patron = this.patrons.find((p) => p.profile.id === this.selectedNpcId);
    if (patron) return this.patronNpcInfo(patron);
    return null;
  }

  private selectNpcStaff(): void {
    this.clearFurnitureSelection();
    this.patrons.forEach((p) => p.setSelected(false));
    this.bartender.setSelected(true);
    this.selectedNpcId = this.bartender.profile.id;
    const info = this.bartenderNpcInfo();
    this.game.events.emit('select-npc', info);
    this.game.events.emit('select-bartender', this.bartender);
  }

  private selectNpcPatron(patron: Patron): void {
    this.clearFurnitureSelection();
    this.bartender.setSelected(false);
    this.patrons.forEach((p) => p.setSelected(p === patron));
    this.selectedNpcId = patron.profile.id;
    this.game.events.emit('select-npc', this.patronNpcInfo(patron));
  }

  deselectNpc = (): void => {
    this.selectedNpcId = null;
    if (this.bartender) this.bartender.setSelected(false);
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
      if (!saved?.furniture?.length) return;
      for (const item of saved.furniture) {
        const def = this.scenario.furniture.find((f) => f.id === item.id);
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
      })),
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

  /**
   * Layered 2D counter occlusion by bar facing:
   *   FRONT (SE/SW): full bar < Luna < barFront — head→waist above counter.
   *   BACK  (NE/NW): Luna fully hidden at staffSpot (service side / bottles to camera).
   * Away from staffSpot (sofa/rest/walk): Luna always fully visible.
   */
  private syncBartenderBarDepth(): void {
    if (!this.bartender || !this.barDef) return;
    const g = this.bartender.grid;
    const barD = depthForFurniture(
      this.barDef.tile[0],
      this.barDef.tile[1],
      this.barDef.footprint
    );
    let d = depthForCharacter(g.col, g.row);
    const atStaff = g.col === this.staffSpot.col && g.row === this.staffSpot.row;
    const facing = this.barFacing;
    const backAtBar = atStaff && BAR_BACK_FACINGS.has(facing);
    const frontAtBar = atStaff && BAR_FRONT_FACINGS.has(facing);

    // BACK: completely invisible behind service-side bar
    this.bartender.setVisible(!backAtBar);

    if (frontAtBar) {
      // Between full bar and counter overlay
      d = Math.max(d, barD + 10);
    }
    this.bartender.setDepth(d);
    if (this.barFrontImage) {
      this.barFrontImage.setDepth(Math.max(d, barD) + BAR_FRONT_DEPTH_ABOVE);
    }

    // Front: crop Luna to head→navel + counter overlay; else full body
    this.bartender.setFrontBarPeek(frontAtBar);
    const spr = this.bartender.sprite;
    if (spr?.texture?.key === 'luna_idle') {
      spr.y = frontAtBar ? LUNA_SPRITE_Y_AT_FRONT_BAR : LUNA_SPRITE_Y_DEFAULT;
    }
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
  private furnitureDisplaySize(kind: string): { w: number; h: number } {
    if (kind === 'bar') return { w: 168, h: 124 };
    if (kind === 'sofa') return { w: 110, h: 84 };
    return { w: 96, h: 72 };
  }

  /** World draw position (tile center + per-type vertical bias). */
  private furnitureWorldPos(
    kind: string,
    col: number,
    row: number
  ): { x: number; y: number } {
    const { x, y } = tileToScreen(col, row, this.iso);
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
    const size = this.furnitureDisplaySize(kind);
    const pos = this.furnitureWorldPos(kind, col, row);
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
    const img = id === 'sofa' ? this.sofaImage : this.barImage;
    if (!img) return;
    if (!valid) {
      img.setTint(0xff4466);
      this.barFrontImage?.setTint(0xff4466);
      return;
    }
    // Restore selection tint while dragging/selected
    if (id === 'sofa') {
      img.setTint(0xffc0e8);
    } else {
      img.setTint(0xffe0a0);
      this.barFrontImage?.setTint(0xffe0a0);
    }
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
        if (this.bartender && this.phase !== 'open') {
          this.bartender.snapTo(this.staffSpot);
          this.syncBartenderBarDepth();
        }
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

      // Empty-world tap deselects NPC (NPC handlers set npcTapHandled first)
      if (
        !wasPanDrag &&
        !this.npcTapHandled &&
        !this.buildMode &&
        p.getDistance() <= TAP_THRESH &&
        !this.isPointerOverHud(p) &&
        this.selectedNpcId
      ) {
        this.deselectNpc();
        this.game.events.emit('npc-deselected');
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
      (kind === 'sofa' ? this.sofaDef : kind === 'bar' ? this.barDef : undefined);
    const fromScenario = src?.sprites?.[facing];
    if (fromScenario) return fromScenario;
    return `furn_${kind}_${facing}`;
  }

  private applyBarDisplaySize(): void {
    const size = this.furnitureDisplaySize('bar');
    this.barImage.setDisplaySize(size.w, size.h);
    this.barImage.setAlpha(1);
    this.barImage.setBlendMode(Phaser.BlendModes.NORMAL);
    if (this.barFrontImage) {
      this.barFrontImage.setDisplaySize(size.w, size.h);
      this.barFrontImage.setAlpha(1);
      this.barFrontImage.setBlendMode(Phaser.BlendModes.NORMAL);
    }
  }

  /**
   * Build furn_bar_front_* canvases: same RGB as full bar, top of opaque AABB
   * cleared so only the customer-facing counter mass remains for overlay draw.
   */
  private ensureBarFrontTextures(): void {
    for (const facing of FACINGS) {
      const srcKey = `furn_bar_${facing}`;
      const frontKey = `furn_bar_front_v2_${facing}`;
      if (this.textures.exists(frontKey)) continue;
      this.requireTexture(srcKey);
      const srcImg = this.textures.get(srcKey).getSourceImage() as
        | HTMLImageElement
        | HTMLCanvasElement;
      const w = srcImg.width;
      const h = srcImg.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable for bar front');
      ctx.drawImage(srcImg, 0, 0);
      const { data } = ctx.getImageData(0, 0, w, h);
      let minY = h;
      let maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 10) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const keepFrac = BAR_FRONT_KEEP_FRAC[facing];
      let cutY: number;
      if (maxY < minY) {
        cutY = Math.floor(h * (1 - keepFrac));
      } else {
        const aabbH = maxY - minY + 1;
        const keepH = Math.max(1, Math.floor(aabbH * keepFrac));
        cutY = maxY - keepH + 1;
      }
      if (cutY > 0) ctx.clearRect(0, 0, w, cutY);
      this.textures.addCanvas(frontKey, canvas);
    }
  }

  private barFrontTextureKey(facing: IsoFacing): string {
    return `furn_bar_front_v2_${facing}`;
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
        const fkey = this.barFrontTextureKey(this.barFacing);
        this.requireTexture(fkey);
        this.barFrontImage = this.add.image(x, y - 16, fkey);
        this.applyBarDisplaySize();
        const barDepth = depthForFurniture(f.tile[0], f.tile[1], f.footprint);
        this.barImage.setDepth(barDepth);
        // Temporary; syncBartenderBarDepth refines once Luna exists
        this.barFrontImage.setDepth(barDepth + BAR_FRONT_DEPTH_ABOVE);
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
    const def = id === 'sofa' ? this.sofaDef : this.barDef;
    const facing = id === 'sofa' ? this.sofaFacing : this.barFacing;
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
      if (this.bartender && this.phase !== 'open') {
        this.bartender.snapTo(this.staffSpot);
        this.syncBartenderBarDepth();
      }
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
    const def = id === 'sofa' ? this.sofaDef : this.barDef;
    const facing = id === 'sofa' ? this.sofaFacing : this.barFacing;
    // Tile/rim first filter; sprite-vs-neon is the authority for looking inside
    if (!this.poseAllowed(def, col, row, facing)) return;
    if (def.tile[0] === col && def.tile[1] === row) return;
    def.tile = [col, row];
    this.syncSpotsFromFurniture();
    this.repositionFurnitureVisual(id);
    if (persist) {
      this.persistLayout();
      this.rebuildPathfinder();
      if (this.bartender && this.phase !== 'open') {
        this.bartender.snapTo(this.staffSpot);
        this.syncBartenderBarDepth();
      }
    }
  }

  private repositionFurnitureVisual(id: SelectedFurniture): void {
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
      if (this.barFrontImage) {
        this.barFrontImage.setPosition(pos.x, pos.y);
        this.barFrontImage.setDepth(barDepth + BAR_FRONT_DEPTH_ABOVE);
      }
      this.barGlow.setPosition(pos.x, pos.y - 4);
      this.barGlow.setDepth(
        depthForFurniture(this.barDef.tile[0], this.barDef.tile[1], this.barDef.footprint, 2)
      );
      if (this.selectedFurniture === 'bar') {
        this.rotateUi.setPosition(pos.x, pos.y - 70);
      }
      this.syncBartenderBarDepth();
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
    } else {
      this.barImage.setTint(0xffe0a0);
      this.barFrontImage?.setTint(0xffe0a0);
      this.rotateUi.setVisible(true);
      const { x, y } = tileToScreen(this.barDef.tile[0], this.barDef.tile[1], this.iso);
      this.rotateUi.setPosition(x, y - 86);
      this.buildHint.setText('Arrastra la barra · Girar ⟲ ⟳').setVisible(true);
    }
  }

  private clearFurnitureSelection(): void {
    if (this.selectedFurniture === 'sofa' && this.sofaImage) {
      this.sofaImage.clearTint();
    }
    if (this.selectedFurniture === 'bar' && this.barImage) {
      this.barImage.clearTint();
      this.barFrontImage?.clearTint();
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
    this.deselectNpc();
    this.game.events.emit('npc-deselected');
    if (on) {
      this.buildHint
        .setText('Modo Construir: toca y arrastra muebles')
        .setVisible(true);
    } else {
      this.buildHint.setVisible(false);
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncSpotsFromFurniture();
      if (this.bartender) {
        this.bartender.snapTo(this.staffSpot);
        this.syncBartenderBarDepth();
      }
    }
    this.game.events.emit('build-mode-changed', this.buildMode);
  };

  private rotateSelected(dir: number): void {
    if (!this.buildMode) return;
    if (this.selectedFurniture === 'bar') this.rotateBar(dir);
    else this.rotateSofa(dir);
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
    this.barFrontImage.setTexture(this.barFrontTextureKey(next));
    this.applyBarDisplaySize();
    this.syncSpotsFromFurniture();
    if (this.bartender) {
      if (this.phase !== 'open') {
        this.bartender.snapTo(this.staffSpot);
      }
      // Occlusion (front keep / back hide) must update immediately on rotate
      this.syncBartenderBarDepth();
    }
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
    this.bartender.snapTo(this.staffSpot);
    this.syncBartenderBarDepth();
    this.bartender.state = 'idle';
    this.bartender.profile.energy = Math.min(100, this.bartender.profile.energy + 25);
    this.bartender.startBob();
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

  private tryServe(patron: Patron, drink: Drink): void {
    if (this.phase !== 'open' || !patron.active) return;
    if (!this.bartender.canServe()) {
      this.time.delayedCall(800, () => {
        if (patron.active && patron.waiting && !patron.served) this.tryServe(patron, drink);
      });
      return;
    }
    if (this.bartender.state !== 'idle') {
      this.time.delayedCall(600, () => {
        if (patron.active && patron.waiting && !patron.served) this.tryServe(patron, drink);
      });
      return;
    }

    this.bartender.state = 'busy';
    this.bartender.walkTo(this.staffSpot, () => {
      this.syncBartenderBarDepth();
      this.bartender.stopBob();
      const skillBonus = this.bartender.skill / 200;
      const serveTime = drink.serveTimeMs * (1 - skillBonus * 0.3);
      this.time.delayedCall(serveTime, () => {
        if (!patron.active || this.phase !== 'open') {
          this.bartender.state = 'idle';
          this.bartender.startBob();
          return;
        }
        this.bartender.applyServeDrain();
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
        this.bartender.state = 'idle';
        this.bartender.startBob();
        this.game.events.emit('stats-updated', this.getHudState());

        this.time.delayedCall(600, () => this.sendPatronHome(patron));
      });
    });
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

  orderRest = (): void => {
    if (this.buildMode) return;
    if (!this.bartender || this.bartender.state === 'walking' || this.bartender.state === 'busy') {
      return;
    }
    if (this.bartender.state === 'resting') return;
    this.clearFurnitureSelection();
    this.selectNpcStaff();
    this.bartender.state = 'busy';
    this.bartender.walkTo(this.sofaRest, () => {
      this.bartender.state = 'resting';
      this.bartender.stopBob();
      const dur = this.bartender.profile.restDurationMs;
      this.game.events.emit('bartender-resting', true);
      this.time.delayedCall(dur, () => {
        this.bartender.applyRest();
        this.bartender.state = 'idle';
        this.bartender.startBob();
        this.bartender.walkTo(this.staffSpot, () => {
          this.syncBartenderBarDepth();
          this.game.events.emit('stats-updated', this.getHudState());
          this.game.events.emit('bartender-resting', false);
        });
      });
    });
  };

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
    this.bartender.state = 'idle';
    this.bartender.snapTo(this.staffSpot);
    this.syncBartenderBarDepth();
    this.bartender.startBob();
    this.game.events.emit('night-summary', {
      ...this.getHudState(),
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
    });
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
            state: this.bartender.state,
          }
        : null,
      selectedNpc: this.getSelectedNpcInfo(),
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
      buildMode: this.buildMode,
    };
  }

  update(_t: number, dt: number): void {
    // Keep bar < Luna < barFront occlusion stack (any facing / rotate)
    this.syncBartenderBarDepth();
    if (this.phase !== 'open') return;
    const dtSec = dt / 1000;
    this.nightTimer -= dtSec;

    for (const patron of [...this.patrons]) {
      if (!patron.active) continue;
      if (patron.tickPatience(dtSec)) {
        patron.showBubble('¡Me voy!');
        patron.waiting = false;
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

  shutdown(): void {
    this.game.events.off('cmd-open-night', this.openNight, this);
    this.game.events.off('cmd-close-night', this.closeNight, this);
    this.game.events.off('cmd-rest', this.orderRest, this);
    this.game.events.off('cmd-set-build-mode', this.setBuildMode, this);
    this.game.events.off('cmd-deselect-npc', this.deselectNpc, this);
    this.game.events.off('cmd-deselect-bartender', this.deselectNpc, this);
  }
}
