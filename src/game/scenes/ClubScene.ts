import Phaser from 'phaser';
import { IsoConfig, tileToScreen, screenToTile, depthForTile } from '../systems/IsoUtils';
import { Pathfinder } from '../systems/Pathfinding';
import { Bartender, BartenderData } from '../entities/Bartender';
import { Patron, PatronData } from '../entities/Patron';

interface Drink {
  id: string;
  name: string;
  price: number;
  serveTimeMs: number;
}

type SofaFacing = 'se' | 'sw' | 'ne' | 'nw';

interface FurnitureDef {
  id: string;
  type: string;
  sprite: string;
  facing?: SofaFacing;
  sprites?: Partial<Record<SofaFacing, string>>;
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
  facing?: SofaFacing;
}

interface SavedLayout {
  furniture: SavedLayoutItem[];
}

const SOFA_FACINGS: SofaFacing[] = ['se', 'sw', 'nw', 'ne'];
const LAYOUT_KEY = 'night-club-layout-v1';
const TAP_THRESH = 10;
const HUD_TOP = 56;

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

  private spawnLeft = 0;
  private queueTiles: Set<string> = new Set();
  private barInteract!: { col: number; row: number };
  private sofaRest!: { col: number; row: number };
  private staffSpot!: { col: number; row: number };
  private drinks: Drink[] = [];

  private sofaDef!: FurnitureDef;
  private barDef!: FurnitureDef;
  private sofaFacing: SofaFacing = 'se';
  private sofaImage!: Phaser.GameObjects.Image;
  private barImage!: Phaser.GameObjects.Image;
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

  // Furniture drag in build mode
  private furnDragging = false;
  private furnDragId: SelectedFurniture = null;
  private blockPanGesture = false;

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
    this.requireTexture('furn_bar');
    for (const facing of SOFA_FACINGS) {
      this.requireTexture(`furn_sofa_${facing}`);
    }
    this.requireTexture(this.chars.bartender.sprite || 'bartender');

    this.rebuildPathfinder();
    this.syncSpotsFromFurniture();

    this.drawRoom(cols, rows);
    this.placeFurniture();
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
    this.bartender.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.panDragging || this.furnDragging || this.skipNextTap) return;
      if (p.getDistance() > TAP_THRESH) return;
      if (this.buildMode) return;
      this.clearFurnitureSelection();
      this.bartender.setSelected(true);
      this.game.events.emit('select-bartender', this.bartender);
    });

    this.setupPointerPan();
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
    this.game.events.on('cmd-deselect-bartender', () => {
      this.bartender.setSelected(false);
    }, this);
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
        if (def.type === 'sofa' && item.facing && SOFA_FACINGS.includes(item.facing)) {
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
        facing: f.type === 'sofa' ? (f.facing as SofaFacing) : undefined,
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
    const wall = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
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

  private drawRoom(cols: number, rows: number): void {
    const { originX, originY, tileWidth, tileHeight } = this.iso;
    const midCol = (cols - 1) / 2;
    const midRow = (rows - 1) / 2;
    const center = tileToScreen(midCol, midRow, this.iso);

    const gridW = cols * tileWidth * 0.92;
    const gridH = rows * tileHeight * 1.35;
    this.roomImage = this.add.image(center.x, center.y + 8, 'room_floor');
    this.roomImage.setDisplaySize(gridW * 1.55, gridH * 1.55);
    this.roomImage.setDepth(0);
    this.roomImage.setAlpha(1);

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
    const room = this.roomImage;
    const pad = 100;
    const bw = room.displayWidth + pad * 2;
    const bh = room.displayHeight + pad * 2;
    cam.setBounds(
      room.x - room.displayWidth / 2 - pad,
      room.y - room.displayHeight / 2 - pad,
      bw,
      bh
    );

    // Slight zoom-out on narrow / mobile viewports
    const w = cam.width;
    let zoom = 1;
    if (w < 420) zoom = 0.72;
    else if (w < 560) zoom = 0.8;
    else if (w < 720) zoom = 0.9;
    cam.setZoom(zoom);
    cam.centerOn(room.x, room.y + 20);
  }

  private setupPointerPan(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      if (this.isPointerOverHud(p)) return;
      if (this.furnDragging || this.blockPanGesture) return;
      this.panActive = true;
      this.panDragging = false;
      this.panStartX = p.x;
      this.panStartY = p.y;
      this.panScrollX = this.cameras.main.scrollX;
      this.panScrollY = this.cameras.main.scrollY;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
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
      if (this.panDragging) {
        this.skipNextTap = true;
        this.time.delayedCall(0, () => {
          this.skipNextTap = false;
        });
      }
      this.panActive = false;
      this.panDragging = false;
      this.blockPanGesture = false;
      void p;
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

  private sofaTextureKey(facing: SofaFacing, def?: FurnitureDef): string {
    const src = def ?? this.sofaDef;
    const fromScenario = src?.sprites?.[facing];
    if (fromScenario) return fromScenario;
    return `furn_sofa_${facing}`;
  }

  private placeFurniture(): void {
    for (const f of this.scenario.furniture) {
      const { x, y } = tileToScreen(f.tile[0], f.tile[1], this.iso);
      if (f.type === 'bar') {
        this.barDef = f;
        this.requireTexture('furn_bar');
        this.barImage = this.add.image(x, y - 10, 'furn_bar');
        this.barImage.setDepth(depthForTile(f.tile[0], f.tile[1], 3));
        this.barGlow = this.add.circle(x, y - 20, 40, 0xffaa44, 0.12);
        this.barGlow.setDepth(depthForTile(f.tile[0], f.tile[1], 2));
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
        this.sofaFacing = (f.facing as SofaFacing) || 'se';
        if (!SOFA_FACINGS.includes(this.sofaFacing)) this.sofaFacing = 'se';
        const key = this.sofaTextureKey(this.sofaFacing, f);
        this.requireTexture(key);
        this.sofaImage = this.add.image(x, y - 6, key);
        this.sofaImage.setDisplaySize(110, 84);
        this.sofaImage.setDepth(depthForTile(f.tile[0], f.tile[1], 3));
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
        this.buildRotateUi(x, y);
      }
    }
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
    this.moveFurnitureTo(this.furnDragId, tile.col, tile.row, false);
  }

  private endFurnitureDrag(): void {
    if (this.furnDragId) {
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncSpotsFromFurniture();
      if (this.bartender && this.phase !== 'open') {
        this.bartender.snapTo(this.staffSpot);
      }
    }
    this.furnDragging = false;
    this.furnDragId = null;
  }

  private moveFurnitureTo(
    id: SelectedFurniture,
    col: number,
    row: number,
    persist: boolean
  ): void {
    if (!id) return;
    const def = id === 'sofa' ? this.sofaDef : this.barDef;
    if (!this.canPlaceFurniture(def, col, row)) return;
    if (def.tile[0] === col && def.tile[1] === row) return;
    def.tile = [col, row];
    this.syncSpotsFromFurniture();
    this.repositionFurnitureVisual(id);
    if (persist) {
      this.persistLayout();
      this.rebuildPathfinder();
      if (this.bartender && this.phase !== 'open') {
        this.bartender.snapTo(this.staffSpot);
      }
    }
  }

  private repositionFurnitureVisual(id: SelectedFurniture): void {
    if (id === 'sofa') {
      const { x, y } = tileToScreen(this.sofaDef.tile[0], this.sofaDef.tile[1], this.iso);
      this.sofaImage.setPosition(x, y - 6);
      this.sofaImage.setDepth(depthForTile(this.sofaDef.tile[0], this.sofaDef.tile[1], 3));
      if (this.selectedFurniture === 'sofa') {
        this.rotateUi.setPosition(x, y - 72);
      }
    } else if (id === 'bar') {
      const { x, y } = tileToScreen(this.barDef.tile[0], this.barDef.tile[1], this.iso);
      this.barImage.setPosition(x, y - 10);
      this.barImage.setDepth(depthForTile(this.barDef.tile[0], this.barDef.tile[1], 3));
      this.barGlow.setPosition(x, y - 20);
      this.barGlow.setDepth(depthForTile(this.barDef.tile[0], this.barDef.tile[1], 2));
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
        this.rotateSofa(dir);
      });
      c.add([b, t]);
      return c;
    };

    this.rotateUi.add([bg, mk(-40, 'Girar ⟲', -1), mk(40, 'Girar ⟳', 1)]);
  }

  private selectFurniture(id: SelectedFurniture): void {
    if (!this.buildMode || !id) return;
    this.bartender.setSelected(false);
    this.game.events.emit('cmd-deselect-bartender');
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
      this.rotateUi.setVisible(false);
      this.buildHint.setText('Arrastra la barra (sin girar)').setVisible(true);
    }
  }

  private clearFurnitureSelection(): void {
    if (this.selectedFurniture === 'sofa' && this.sofaImage) {
      this.sofaImage.clearTint();
    }
    if (this.selectedFurniture === 'bar' && this.barImage) {
      this.barImage.clearTint();
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
    this.bartender.setSelected(false);
    this.game.events.emit('cmd-deselect-bartender');
    if (on) {
      this.buildHint
        .setText('Modo Construir: toca y arrastra muebles')
        .setVisible(true);
    } else {
      this.buildHint.setVisible(false);
      this.persistLayout();
      this.rebuildPathfinder();
      this.syncSpotsFromFurniture();
      if (this.bartender) this.bartender.snapTo(this.staffSpot);
    }
    this.game.events.emit('build-mode-changed', this.buildMode);
  };

  private rotateSofa(dir: number): void {
    if (!this.buildMode) return;
    const idx = SOFA_FACINGS.indexOf(this.sofaFacing);
    const next = SOFA_FACINGS[(idx + dir + SOFA_FACINGS.length) % SOFA_FACINGS.length];
    this.sofaFacing = next;
    this.sofaDef.facing = next;
    this.sofaImage.setTexture(this.sofaTextureKey(next));
    this.sofaImage.setDisplaySize(110, 84);
    this.persistLayout();
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
    const patron = new Patron(
      this,
      pdata.sprite,
      spawn,
      this.iso,
      this.pathfinder,
      pdata
    );
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
    this.bartender.setSelected(true);
    this.game.events.emit('select-bartender', this.bartender);
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
    this.patrons.forEach((p) => {
      this.releaseTile(p.grid);
      p.destroy();
    });
    this.patrons = [];
    this.queueTiles.clear();
    this.bartender.state = 'idle';
    this.bartender.snapTo(this.staffSpot);
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
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
      buildMode: this.buildMode,
    };
  }

  update(_t: number, dt: number): void {
    if (this.phase !== 'open') return;
    this.nightTimer -= dt / 1000;
    if (Math.floor(this.nightTimer * 2) !== Math.floor((this.nightTimer + dt / 1000) * 2)) {
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
  }
}
