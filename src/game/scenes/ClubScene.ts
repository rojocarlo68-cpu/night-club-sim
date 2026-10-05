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
  TABLE_TYPES,
  STATUS_ES,
  lerp,
} from '../systems/AiTunables';
import {
  BEER_TAP_BONUS,
  BEER_TAP_CATALOG_ID,
  BEER_TAP_DRINK_ID,
  prefersBeerTap,
  rollBeerServicePref,
} from '../config/beerTap';
import {
  SNACK_EXPERIENCE,
  SNACK_LOCKED_HINT,
  TABLE_CATALOG_IDS,
  getSnackProduct,
  isTableCatalogId,
} from '../config/snacks';
import {
  getSupplierCost as inventorySupplierCost,
  isSnackId,
  productExists as inventoryProductExists,
} from '../systems/Inventory';
import { ensureShopPlaceholders } from '../systems/PlaceholderFurniture';
import {
  getTips,
  loadTips,
  recordTip,
  resetNightTips,
  serializeTips,
} from '../systems/Tips';
import { onNightEnd, resetNightCycleState } from '../systems/NightCycle';
import {
  initShift,
  loadShift,
  serializeShift,
  beginShiftOpen,
  beginShiftClosing,
  beginShiftSummary,
  beginShiftClosed,
  openShiftAt as shiftOpenAt,
  debugSetGameTime as shiftDebugSetGameTime,
  syncShiftDay,
  legacyPhaseFromShift,
  getShiftDebug as readShiftDebug,
  getShiftSnapshot,
  getShiftOpenCloseTimes,
  resetShiftState,
  tickShiftClock,
  formatGameClock,
  debugAdvanceGameMinutes as shiftAdvanceGameMinutes,
  getShiftState,
  type ShiftPersist,
} from '../systems/Shift';
import {
  SCHEDULE_LABEL,
  SCHEDULE_LABEL_MOBILE,
  REAL_SECONDS_PER_GAME_MINUTE,
  CLOSING_NUDGE_AFTER_MS,
  CLOSING_FORCE_SUMMARY_MS,
  PRE_OPEN_HOUR,
  PRE_OPEN_MINUTE,
  STAFF_ARRIVE_GAME_MINUTES_AFTER_DAY_START,
  STAFF_ARRIVE_JITTER_GAME_MINUTES,
} from '../config/shift';
import {
  SWEEP_DURATION_MS,
  MOP_DURATION_MS,
  FLOOR_JOB_ENERGY,
  FLOOR_VISUAL,
} from '../config/floorDirt';
import {
  initFloorDirt,
  getFloorZones,
  seedFloorDirtForDay,
  findDirtiestSweepZone,
  findDirtiestMopZone,
  applySweep,
  applyMop,
  floorZoneCenter,
  floorDirtBand,
  floorDirtDelta,
  floorDirtEpisodeKey,
  isFloorVisiblyDirty,
  distToFloorZone,
  getFloorDirtDebug as readFloorDirtDebug,
  serializeFloorDirt,
  loadFloorDirt,
  resetFloorDirtState,
  type FloorZone,
} from '../systems/FloorDirt';
import {
  DAY_START_TOAST_CHANCE,
  DAY_START_MESSAGES,
  SLEEP_FADE_MS,
} from '../config/dayMessages';
import {
  beginArrivalsNight,
  stopArrivals,
  tickArrivals,
  getArrivalsDebug as readArrivalsDebug,
  setArrivalsSeed,
} from '../systems/Arrivals';
import {
  recordStaffShiftStart,
  recordStaffShiftEnd,
  getStaffHoursDebug as readStaffHoursDebug,
  getLastStaffHours,
  formatDurationHm,
  resetStaffHours,
} from '../systems/StaffHours';
import {
  getAvailableStaff,
  getStaffAvailabilityDebug as readStaffAvailabilityDebug,
  resetStaffAvailability,
} from '../systems/StaffAvailability';
import {
  beginLateOpenNight,
  applyLateOpenExperience,
  getLateOpenDebug as readLateOpenDebug,
  resetLateOpenNight,
} from '../systems/LateOpen';
import {
  CLOSED_OVERLAY_COLOR,
  CLOSED_OVERLAY_ALPHA,
  OPEN_OVERLAY_ALPHA,
  LIGHTS_FADE_MS,
  CLOSED_BG_COLOR,
  OPEN_BG_COLOR,
  LIGHTS_OVERLAY_DEPTH,
} from '../config/lighting';
import {
  resetNightAccumulators,
  noteLeaveWithoutBuy,
  snapshotNightStats,
  serializeNightStatsHistory,
  loadNightStatsHistory,
  getNightStatsDebug as readNightStatsDebug,
} from '../systems/NightStats';
import {
  installReputationHook,
  serializeReputation,
  loadReputation,
  getReputationDebug as readReputationDebug,
  getReturnChanceHint,
} from '../systems/Reputation';
import { NIGHT_SUMMARY_LINES } from '../config/nightStats';
import {
  takeLastPayroll,
  serializePayrollHistory,
  loadPayrollHistory,
} from '../systems/Payroll';
import {
  takeLastUtilities,
  serializeUtilitiesHistory,
  loadUtilitiesHistory,
} from '../systems/Utilities';
import { ALLOW_NEGATIVE_BALANCE, weeklySalaryFor } from '../config/salaries';
import {
  initInventory,
  loadInventory,
  resetNightInventory,
  serializeInventory,
  getInventoryDebug as readInventoryDebug,
  getPrice as inventoryGetPrice,
  setPrice as inventorySetPrice,
  canSell as inventoryCanSell,
  recordSale as inventoryRecordSale,
  addStock as inventoryAddStock,
  setStock as inventorySetStock,
  getStock as inventoryGetStock,
} from '../systems/Inventory';
import { getDrinkProduct, DRINKS_CATALOG, DRINK_PREF } from '../config/drinks';
import {
  getDrinkPrefs,
  serializeDrinkPrefs,
  loadDrinkPrefs,
  prefFor,
} from '../systems/DrinkPreferences';
import {
  evaluateDrinkPrice,
  applyPricePerception,
  evaluateOutOfStock,
  applyOosPerception,
  pushPricingDebug,
  getPricingDebug as readPricingDebug,
  traitsOf,
} from '../systems/PricePerception';
import {
  computeSatisfactionTipMods,
  applySatisfactionToTipChance,
  satisfactionAmountScale,
  pushTipDebug,
  getTipDebug as readTipDebug,
} from '../systems/SatisfactionTips';
import { BASE_SATISFACTION } from '../config/satisfaction';
import { nextWeekEndNight, nextMonthEndNight } from '../config/calendar';
import { getPersonality, personalitySummary } from '../config/personality';
import { TipAction } from '../config/tipActions';
import {
  MOOD_SERVICE_TIP_FACTOR,
  moodBand,
  performanceLabel,
} from '../config/staffThresholds';
import {
  pickTipAction,
  recordActionPerformed,
  getActionCounts,
} from '../systems/TipActionPicker';
import { getTipAction } from '../config/tipActions';
import {
  getActionTastes,
  applyActionSatisfaction,
  serializeActionTastes,
  loadActionTastes,
  setActionTaste,
  peekActionTaste,
} from '../systems/ActionTastes';
import {
  getAffinity,
  applyAffinityToTipChance,
  applyAffinityToSatisfaction,
  applySatisfactionBonus,
  pushAffinityDebug,
  getAffinityDebug as readAffinityDebug,
  serializeAffinities,
  loadAffinities,
  setAffinity,
  peekAffinity,
} from '../systems/Affinity';
import {
  createExperience,
  finalizeVisit,
  getActiveExperiences,
  getExperience,
  getVisitDebug,
  serializeCustomerTraits,
  loadCustomerTraits,
  applyPerceivedExperience,
} from '../systems/CustomerExperience';
import {
  comfortBandFor,
  dirtBandFor,
  isVisiblyDirty,
  withinPerception,
  dirtEpisodeKey,
  markItemCleaned,
  getDirtEpisodesDebug,
} from '../systems/ExperiencePerception';
import { PERCEPTION_INTERVAL_MS } from '../config/satisfaction';
import {
  getCompetitiveness,
  observe as observeCompetition,
  noteTip,
  serializeCompetition,
  loadCompetition,
  getCompetitionDebug as readCompetitionDebug,
} from '../systems/Competition';
import {
  OBSERVE_INTERVAL_MS,
  PANEL_SHOW_THRESHOLD,
  competitivenessLabel,
} from '../config/competition';
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
import {
  withdrawStock as inventoryWithdraw,
  recordPrepouredSale as inventoryRecordPrepoured,
  recordWaste as inventoryRecordWaste,
  recordStaffConsumption as inventoryRecordStaffUse,
  getNightWaste,
  getNightStaffConsumption,
} from '../systems/Inventory';
import { CONSUMABLE_EFFECTS } from '../config/staffConsumption';
import {
  ORDER_COMPLIANCE,
  REFUSE_LINES,
  DRUNK_REFUSE_LINES,
  DELAY_LINES,
  ABANDON_LINES,
} from '../config/orderCompliance';
import {
  TECHNICIANS,
  TechnicianDef,
  REPAIR_TIMING,
  REPAIR_QUALITY,
  REPAIR_COST,
  DIAGNOSES,
  NON_BREAKABLE_FUNCTIONS,
  NON_BREAKABLE_IDS,
} from '../config/technicians';
import { FLIES } from '../config/spoilage';
import { THOUGHT_RULES, THOUGHT_SAT, IMPRESSIVE_DECOR } from '../config/thoughts';
import {
  getWallet,
  creditWallet,
  debitWallet,
  loadStaffWallets,
  serializeStaffWallets,
  intoxOf,
  intoxLabel,
  isCaffeinated,
  applyConsumption,
  tickStaffNeeds,
  serviceFactor as staffServiceFactor,
  spillChance as staffSpillChance,
  slowServeFactor,
  rollCompliance,
  pickAutoConsumption,
  noteAutoConsumption,
  onStaffSleep,
  getStaffNeedsDebug,
  debugSetIntox,
  debugSetWallet,
} from '../systems/StaffNeeds';
import {
  addServedItem,
  canAddAt as canAddServed,
  claimServed,
  itemsAt as servedItemsAt,
  listServed,
  removeServed,
  stateOf as servedStateOf,
  tickServed,
  clearServed,
  getServedDebug,
  ServedItem,
  profileFor as spoilProfileFor,
} from '../systems/ServedItems';
import { decideThought, hasThought, thoughtLog, getThoughtsDebug } from '../systems/Thoughts';
import { addFloorDirtAt, getFloorZoneById, zoneContaining } from '../systems/FloorDirt';
import {
  CtxTarget,
  CtxAction,
  ContextMenuPayload,
  TechListPayload,
  RepairVerdictPayload,
} from '../types/Intervention';

/** Products a staff member can order at the bar (in-stock ones only are shown). */
/** A customer waiting this long (ms) lets AI pull a staff off routine cleaning to serve. */
const URGENT_PREEMPT_MS = 9000;

const BAR_STAFF_DRINKS = ['cafe', 'agua', 'refresco', 'cerveza', 'shot_barato', 'vodka', 'ron', 'whiskey'];

interface RepairJob {
  id: string;
  furnitureId: string;
  tech: TechnicianDef;
  stage: 'en_route' | 'walking' | 'inspecting' | 'verdict' | 'repairing';
  arriveAt: number;
  stageEndsAt: number;
  quote?: number;
  diagnosis?: string;
  /** Hidden 0..1 job quality rolled from reputation (never shown). */
  quality?: number;
  sprite?: Patron;
}

interface FlyZoneState {
  dirtySince: number;
  active: boolean;
  episode: number;
  gfx?: Phaser.GameObjects.Container;
}

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
  /** Repair history (technicians): count, wear multiplier and sudden-failure chance per minute. */
  repairCount?: number;
  fragility?: number;
  failChance?: number;
  lastRepairQuality?: number;
}

interface Scenario {
  id: string;
  title: string;
  startingMoney: number;
  /** @deprecated B7 — legacy 75s auto-close length; unused by organic arrivals. */
  nightDurationSec: number;
  /** @deprecated B4+ — unused (organic Arrivals). Kept for JSON compat. */
  patronSpawnCount: [number, number];
  /** @deprecated B4+ — unused (organic Arrivals). Kept for JSON compat. */
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
  repairCount?: number;
  fragility?: number;
  failChance?: number;
  lastRepairQuality?: number;
}

interface SavedLayout {
  /** Staff personal money (tips − own purchases). Old saves omit → starting pocket money. */
  staffWallets?: Record<string, number>;
  furniture: SavedLayoutItem[];
  /** Hired staff ids from staff_pool (excludes starter Luna). */
  hiredStaff?: string[];
  /** Persist cash so hires survive reload. */
  money?: number;
  /** Starter pieces already offered to this save (so a deleted starter bar stays deleted). */
  seeded?: string[];
  /** Per-staff tip ledger (Phase 1). Old saves omit this → zeros. */
  staffTips?: Record<string, { tipsNight?: number; tipsDay?: number; tipsTotal?: number }>;
  /** Phase 5: hidden patronName→staffId affinity map. Old saves omit → empty. */
  affinities?: Record<string, Record<string, 'baja' | 'normal' | 'alta'>>;
  /** Phase 6: per-staff competitiveness + rolling tips. Old saves omit → zeros. */
  competition?: Record<
    string,
    { competitiveness?: number; lastObservedGap?: number; rollingTips?: number }
  >;
  /** Phase 7: absolute night counter (starts at 1). Old saves omit → 1. */
  nightNumber?: number;
  /** Prompt B Phase B1: day/game-clock/shift FSM. Old saves omit → day=nightNumber @ 17:00 closed. */
  shift?: ShiftPersist;
  /** Phase 8: short weekly payroll history. Old saves omit → []. */
  payrollHistory?: {
    night: number;
    total: number;
    lines: { id: string; name: string; amount: number }[];
  }[];
  /** Phase 9: short monthly utilities history. Old saves omit → []. */
  utilitiesHistory?: {
    night: number;
    total: number;
    lines: { label: string; amount: number }[];
  }[];
  /** Prompt A Phase 1: stable patronName→satisfaction traits. Old saves omit → rolled fresh. */
  customerTraits?: Record<
    string,
    {
      cleanSens?: number;
      comfortSens?: number;
      priceSens?: number;
      availSens?: number;
      generosity?: number;
      tolerance?: number;
    }
  >;
  /** Prompt A Phase 3: drink stock + public prices. Old saves omit → catalogue defaults. */
  inventory?: {
    stock?: Record<string, number>;
    prices?: Record<string, number>;
  };
  /** Prompt A Phase 4: stable patronName→drink preferences. Old saves omit → rolled fresh. */
  drinkPrefs?: Record<string, Record<string, number>>;
  /** Prompt A Phase 9: stable patronName→actionId taste (−1..+1). Old saves omit → rolled fresh. */
  actionTastes?: Record<string, Record<string, number>>;
  /** Prompt A Phase 10: rolling night sales/stats history (last ~30). */
  nightStatsHistory?: unknown[];
  /** Prompt A Phase 10: per-name recent visit sats (reputation placeholder). */
  reputation?: Record<string, number[]>;
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
  /** @deprecated B7 — no longer auto-closes; kept 0 for HUD compat. */
  nightTimer = 0;
  /** B7: real-time ms when CLOSING began (0 if not closing). */
  private closingStartedAt = 0;
  private closingNudged = false;
  /** B10: guard against double Dormir. */
  private sleepInProgress = false;
  /**
   * Day-start: staff hidden until game clock reaches staffArriveTotalMinutes.
   * AI / visibility gated by staffPresent.
   */
  private staffPresent = false;
  /** Absolute game-minute-of-day (hour*60+minute) when staff appear while CLOSED. */
  private staffArriveTotalMinutes = PRE_OPEN_HOUR * 60 + PRE_OPEN_MINUTE + STAFF_ARRIVE_GAME_MINUTES_AFTER_DAY_START;
  /** Previous night had patrons/sales — seeds floor dirt on next day start. */
  private lastNightUsed = false;
  /** Floor zone id → staff id while sweep/mop runs. */
  private floorClaim = new Map<string, string>();
  private floorDirtGfx = new Map<string, Phaser.GameObjects.Ellipse>();
  /** Phase 7: absolute night index (1-based). Increments when a night ends. */
  nightNumber = 1;
  /** Phase 6: ms accumulator toward next peer-observation tick. */
  private competitionObserveAccum = 0;
  /** Phase 9 test: when set, completeServe uses this tip action id (picker unchanged otherwise). */
  private forcedTipActionId: string | null = null;
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
  /** Prompt B Phase B3: full-view dim overlay (closed club). */
  private lightsOverlay!: Phaser.GameObjects.Rectangle;
  private lightsTween?: Phaser.Tweens.Tween;
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
    // Prompt B Phase B1: shift FSM (day/hour). Spawn + 75s timer unchanged.
    resetShiftState();
    initShift({ currentDay: this.nightNumber, shiftState: 'closed' });
    this.phase = legacyPhaseFromShift();
    this.patrons = [];
    this.drinks = Array.isArray(this.scenario.drinks) ? this.scenario.drinks : [];
    // Prompt A Phase 3: inventory catalogue (serving still uses this.drinks / scenario prices).
    initInventory();
    installReputationHook();
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

    // Day-start: floor dirt zones + hide staff until ~17:05.
    initFloorDirt(cols, rows);
    seedFloorDirtForDay(true); // first load: mild demo dirt so prep is visible
    this.refreshFloorDirtVisuals();
    this.beginDayStaffHidden();

    // Prompt B Phase B3: overlay created here; dim applied after camera BG is set.
    this.createLightsOverlay();

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
    // Prompt B Phase B3: start closed (dim) — must run after the default BG set above.
    this.applyClubLighting('closed', false);

    this.game.events.emit('club-ready', this.getHudState());
    this.game.events.on('cmd-open-night', this.openNight, this);
    this.game.events.on('cmd-close-night', this.closeNight, this);
    this.game.events.on('cmd-sleep', this.sleepDay, this);
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
    this.game.events.on('cmd-restock-drink', this.onCmdRestockDrink, this);
    this.game.events.on('cmd-set-drink-price', this.onCmdSetDrinkPrice, this);
    this.game.events.on('cmd-deselect-furniture', this.onCmdDeselectFurniture, this);
    this.game.events.on('cmd-confirm-delete-furniture', this.onCmdConfirmDeleteFurniture, this);
    this.game.events.on('cmd-cancel-delete-furniture', this.onCmdCancelDeleteFurniture, this);
    this.registerInterventionEvents();
    this.emitStaffRoster();
    this.emitShopCatalog();
    this.scale.on('resize', this.onClubResize, this);
  }

  private onClubResize = (): void => {
    this.layoutLightsOverlay();
  };

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
      wantedDrink: p.servedDrinkId ? undefined : p.preferredDrinkName,
      servedDrink: p.servedDrinkId ? this.drinkDisplayName(p.servedDrinkId) : undefined,
      thoughts: thoughtLog(p)
        .slice(-3)
        .map((t) => ({ text: t.text, emoji: t.emoji, tone: t.tone })),
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
    const tipActionLabel = b.getActiveTipActionLabel(this.time.now);
    const stateKey = b.getAiStateKey();
    const seekingTip = ['serving', 'serving_cerveza', 'serving_drink', 'busy'].includes(
      stateKey
    );
    const comp = getCompetitiveness(b.profile.id);
    return {
      id: b.profile.id,
      name: b.displayName,
      role: 'staff',
      energy: Math.round(b.energy),
      mood: Math.round(b.mood),
      skill: Math.round(b.skill),
      state: stateKey,
      portrait,
      tipsNight: tips.tipsNight,
      tipsDay: tips.tipsDay,
      tipsTotal: tips.tipsTotal,
      personality,
      tipActionLabel,
      seekingTip,
      performance: performanceLabel(b.energy, b.mood),
      competitivenessLabel:
        comp > PANEL_SHOW_THRESHOLD ? competitivenessLabel(comp) : null,
      weeklySalary: weeklySalaryFor(b.profile.id),
      walletMoney: getWallet(b.profile.id),
      condition:
        [intoxLabel(b.profile.id), isCaffeinated(b.profile.id, this.time.now) ? 'Con café' : null]
          .filter(Boolean)
          .join(' · ') || null,
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
    this.lastSelectedStaffId = target.profile.id;
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
    patron.sprite.on('pointerdown', (p?: Phaser.Input.Pointer) => {
      if (p && !p.wasTouch && p.button === 2) return;
      if (!this.buildMode) this.npcTapHandled = true;
    });
    patron.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch && p.button === 2) return;
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
        const m = Math.floor(saved.money);
        this.money = ALLOW_NEGATIVE_BALANCE ? m : Math.max(0, m);
      }
      loadTips(saved?.staffTips);
      loadStaffWallets(saved?.staffWallets);
      loadAffinities(saved?.affinities);
      loadCustomerTraits(saved?.customerTraits);
      loadInventory(saved?.inventory);
      loadDrinkPrefs(saved?.drinkPrefs);
      loadActionTastes(saved?.actionTastes);
      loadCompetition(saved?.competition);
      loadPayrollHistory(saved?.payrollHistory);
      loadUtilitiesHistory(saved?.utilitiesHistory);
      resetNightCycleState();
      if (typeof saved?.nightNumber === 'number' && Number.isFinite(saved.nightNumber)) {
        this.nightNumber = Math.max(1, Math.floor(saved.nightNumber));
      } else {
        this.nightNumber = 1;
      }
      // Prompt B Phase B1: restore day/hour; mid-open saves force closed @ pre-open.
      loadShift(saved?.shift, this.nightNumber);
      syncShiftDay(this.nightNumber);
      this.phase = legacyPhaseFromShift();
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
        if (typeof item.repairCount === 'number') def.repairCount = item.repairCount;
        if (typeof item.fragility === 'number') def.fragility = item.fragility;
        if (typeof item.failChance === 'number') def.failChance = item.failChance;
        if (typeof item.lastRepairQuality === 'number') def.lastRepairQuality = item.lastRepairQuality;
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
        repairCount: f.repairCount,
        fragility: f.fragility,
        failChance: f.failChance,
        lastRepairQuality: f.lastRepairQuality,
      })),
      staffWallets: serializeStaffWallets(),
      hiredStaff: [...this.hiredStaffIds],
      money: this.money,
      seeded: ['bar'],
      staffTips: serializeTips(),
      affinities: serializeAffinities(),
      customerTraits: serializeCustomerTraits(),
      inventory: serializeInventory(),
      drinkPrefs: serializeDrinkPrefs(),
      actionTastes: serializeActionTastes(),
      nightStatsHistory: serializeNightStatsHistory(),
      reputation: serializeReputation(),
      competition: serializeCompetition(),
      nightNumber: this.nightNumber,
      shift: serializeShift(),
      payrollHistory: serializePayrollHistory(),
      utilitiesHistory: serializeUtilitiesHistory(),
    };
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    } catch {
      // private mode / quota
    }
  }

  /** Normal character depth vs furniture — respect day-start hide until staff arrive. */
  private syncBartenderBarDepth(): void {
    if (!this.bartender) return;
    const g = this.bartender.grid;
    if (this.staffPresent) this.bartender.setVisible(true);
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


  /**
   * Full-viewport dim overlay. scrollFactor 0 objects still scale with camera zoom,
   * so size must be viewport/zoom (plus margin) or lit edges show around a small rectangle.
   */
  private createLightsOverlay(): void {
    const cam = this.cameras.main;
    const { w, h } = this.lightsOverlayCoverSize(cam);
    this.lightsOverlay = this.add
      .rectangle(cam.width / 2, cam.height / 2, w, h, CLOSED_OVERLAY_COLOR, 1)
      .setScrollFactor(0)
      .setDepth(LIGHTS_OVERLAY_DEPTH)
      .setOrigin(0.5)
      .setAlpha(CLOSED_OVERLAY_ALPHA);
    // Never steal taps from the floor / NPCs.
    this.lightsOverlay.disableInteractive();
  }

  /** Cover the entire screen even when zoomed out (mobile + PC). */
  private lightsOverlayCoverSize(cam: Phaser.Cameras.Scene2D.Camera): { w: number; h: number } {
    const z = Math.max(cam.zoom, 0.05);
    // Generous padding so pinch-zoom / letterboxing never shows bright rims.
    const pad = 240;
    return {
      w: cam.width / z + pad,
      h: cam.height / z + pad,
    };
  }

  private layoutLightsOverlay(): void {
    if (!this.lightsOverlay) return;
    const cam = this.cameras.main;
    const { w, h } = this.lightsOverlayCoverSize(cam);
    // scrollFactor 0 → screen space; keep anchored to the viewport centre (not world midPoint).
    this.lightsOverlay.setPosition(cam.width / 2, cam.height / 2);
    this.lightsOverlay.setSize(w, h);
    // Phaser Rectangle: also refresh display size after setSize
    this.lightsOverlay.setDisplaySize(w, h);
  }

  /**
   * Dim when closed/summary; bright when open.
   * Staff visibility is owned by staffPresent / day-start arrival (not lighting).
   */
  private applyClubLighting(mode: 'closed' | 'open', animate: boolean): void {
    if (!this.lightsOverlay) return;
    const targetAlpha = mode === 'open' ? OPEN_OVERLAY_ALPHA : CLOSED_OVERLAY_ALPHA;
    const bg = mode === 'open' ? OPEN_BG_COLOR : CLOSED_BG_COLOR;
    this.cameras.main.setBackgroundColor(bg);

    if (this.lightsTween) {
      this.lightsTween.stop();
      this.lightsTween = undefined;
    }

    if (!animate || LIGHTS_FADE_MS <= 0) {
      this.lightsOverlay.setAlpha(targetAlpha);
      this.lightsOverlay.setVisible(targetAlpha > 0.001);
      return;
    }

    this.lightsOverlay.setVisible(true);
    this.lightsTween = this.tweens.add({
      targets: this.lightsOverlay,
      alpha: targetAlpha,
      duration: LIGHTS_FADE_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.lightsTween = undefined;
        if (targetAlpha <= 0.001) this.lightsOverlay.setVisible(false);
      },
    });

    // Soft "wake" pulse on present staff when lights come on.
    if (mode === 'open' && this.staffPresent) {
      for (const s of this.allStaff()) {
        if (!s?.active || !s.visible) continue;
        const prev = s.alpha;
        s.setAlpha(Math.min(prev, 0.65));
        this.tweens.add({
          targets: s,
          alpha: 1,
          duration: Math.min(LIGHTS_FADE_MS, 500),
          ease: 'Sine.easeOut',
        });
      }
    }
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
    this.layoutLightsOverlay();
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
    this.layoutLightsOverlay();
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
      // Mobile: long-press with a staff selected opens the context menu (= PC right-click).
      this.startLongPress(p);
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
      this.longPressTimer?.remove(false);
      this.longPressTimer = undefined;
      if (!p.wasTouch && p.button === 2) {
        // Right-click: context menu for the selected staff (windows are closed by UIScene first).
        if (!this.buildMode && !this.isPointerOverHud(p) && !this.uiConsumedRightClick(p)) {
          this.handleWorldRightClick(p);
        }
        this.npcTapHandled = false;
        return;
      }
      if (this.longPressFired) {
        this.longPressFired = false;
        this.panActive = false;
        this.panDragging = false;
        this.npcTapHandled = false;
        return;
      }
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
    // Prompt B Phase B10: Abrir only from CLOSED (prep). Use Dormir to leave SUMMARY.
    if (this.phase !== 'prep') return;
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    this.rebuildPathfinder();
    // Prompt B Phase B1: CLOSED/SUMMARY → OPEN (spawn + 75s timer still below).
    syncShiftDay(this.nightNumber);
    if (!beginShiftOpen()) return;
    this.phase = legacyPhaseFromShift();
    // If player opens before ~17:05, staff arrive immediately for the shift.
    if (!this.staffPresent) this.revealStaffForShift(true);
    // Lights fade on; clock stays at current time (no 18:00 snap).
    this.applyClubLighting('open', true);
    this.nightEarned = 0;
    this.servedCount = 0;
    resetNightTips();
    resetNightInventory();
    resetNightAccumulators();
    this.competitionObserveAccum = 0;
    // Prompt B Phase B7: no 75s auto-close — nightTimer unused (Infinity for Arrivals).
    this.nightTimer = Number.POSITIVE_INFINITY;
    this.closingStartedAt = 0;
    this.closingNudged = false;
    // Prompt B Phase B4: organic arrivals (replaces fixed 3–5 @ 400ms/2200ms).
    this.spawnLeft = 0;
    const snap = getShiftSnapshot();
    // B11: available staff only (absence map defaults true; rare event TODO).
    const working = getAvailableStaff(
      this.allStaff().map((s) => ({ id: s.profile.id, name: s.displayName }))
    );
    const staffCount = working.length;
    beginArrivalsNight(snap.gameHour, snap.gameMinute, staffCount, this.nightNumber);
    beginLateOpenNight(snap.gameHour, snap.gameMinute);
    // Prompt B Phase B8: record who is working and shift start clock.
    recordStaffShiftStart(working, snap.gameHour, snap.gameMinute);
    this.game.events.emit('night-started', this.getHudState());
  };

  private resetForNewNight(): void {
    this.patrons.forEach((p) => {
      finalizeVisit(p);
      p.destroy();
    });
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

  /**
   * @deprecated Prompt B Phase B4 — fixed real-time spawn schedule removed.
   * Arrivals are driven by tickArrivals() on the game clock.
   */
  private scheduleSpawns(): void {
    // no-op (kept so any stray call is harmless)
  }

  private spawnPatron(): void {
    if (this.phase !== 'open') return;
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
    this.patronSpawnAt.set(patron, this.time.now);
    // Prompt A Phase 1: invisible satisfaction (does not alter nightMood/patience).
    createExperience(patron);
    // B11: optional late-open sat stub (first N patrons only if open was late).
    applyLateOpenExperience(patron);
    // Prompt A Phase 4: roll/persist drink prefs (stable per profile.name).
    getDrinkPrefs(patron);
    // Prompt A Phase 9: roll/persist action tastes (stable per profile.name).
    getActionTastes(patron);
    patron.beerServicePref = rollBeerServicePref();
    patron.servedAtBeerTap = false;
    patron.ateSnack = false;
    this.chooseMainPatronGoal(patron);
  }

  private drinkDisplayName(id: string): string {
    const fromScenario = this.drinks.find((d) => d.id === id)?.name;
    if (fromScenario) return fromScenario;
    return getDrinkProduct(id)?.name ?? id;
  }

  /** Resolve a Drink for serving: scenario entry or synthesised catalogue product. Price from inventory. */
  private resolveServeDrink(id: string): Drink | null {
    const price = inventoryGetPrice(id);
    const existing = this.drinks.find((d) => d.id === id);
    if (existing) {
      return { id: existing.id, name: existing.name, price, serveTimeMs: existing.serveTimeMs };
    }
    const prod = getDrinkProduct(id);
    if (!prod) return null;
    // New catalogue spirits: serve timing like shot_barato when missing from scenario.
    const fallbackMs =
      this.drinks.find((d) => d.id === 'shot_barato')?.serveTimeMs ?? prod.serveTimeMs;
    return {
      id: prod.id,
      name: prod.name,
      price,
      serveTimeMs: prod.serveTimeMs || fallbackMs,
    };
  }

  /**
   * Prompt A Phase 4+6: preferred if in stock & price-ok; else best priced alternative.
   * Phase 6: price perception + OOS reaction (once per drink). Skip uses existing leave path.
   */
  private pickServeDrink(
    patron: Patron
  ):
    | { ok: true; drink: Drink; wantedId: string; substituted: boolean }
    | { ok: false; reason: 'empty' | 'price' | 'oos_skip' } {
    const prefs = getDrinkPrefs(patron);
    const wantedId =
      patron.profile.preferredDrink || Object.keys(prefs)[0] || DRINKS_CATALOG[0].id;
    const traits = traitsOf(patron);
    const name = (patron.profile?.name || wantedId).trim() || wantedId;

    // Cache price evals so refuse rolls are not re-rolled when applying.
    const evalCache = new Map<
      string,
      { drink: Drink; refuse: boolean; ev: ReturnType<typeof evaluateDrinkPrice> | null }
    >();

    const resolveEval = (drinkId: string) => {
      const cached = evalCache.get(drinkId);
      if (cached) return cached;
      if (!inventoryCanSell(drinkId)) {
        const miss = { drink: null as unknown as Drink, refuse: true, ev: null };
        return miss;
      }
      const drink = this.resolveServeDrink(drinkId);
      if (!drink) {
        return { drink: null as unknown as Drink, refuse: true, ev: null };
      }
      if (!traits) {
        const row = { drink, refuse: false, ev: null };
        evalCache.set(drinkId, row);
        return row;
      }
      const ev = evaluateDrinkPrice(patron, drinkId, drink.price, traits);
      const row = { drink, refuse: ev.refuse, ev };
      evalCache.set(drinkId, row);
      return row;
    };

    const applyEval = (
      drinkId: string,
      role: 'preferred' | 'alt'
    ): number => {
      const row = resolveEval(drinkId);
      if (!row.ev || !traits) return 0;
      const penalty = applyPricePerception(patron, row.ev);
      pushPricingDebug({
        patronName: name,
        drinkId,
        price: row.ev.price,
        reasonable: row.ev.reasonable,
        ratio: row.ev.ratio,
        band: row.ev.band,
        decision: row.refuse ? 'skip' : role === 'alt' ? 'alt' : 'bought',
        penalty,
        refused: row.refuse,
      });
      return penalty;
    };

    // Preferred in stock → price-check (apply once).
    if (inventoryCanSell(wantedId)) {
      const pref = resolveEval(wantedId);
      if (pref.drink && !pref.refuse) {
        applyEval(wantedId, 'preferred');
        return { ok: true, drink: pref.drink, wantedId, substituted: false };
      }
      if (pref.drink && pref.refuse) {
        applyEval(wantedId, 'preferred');
        // fall through to alternatives
      }
    } else if (traits) {
      // OOS of wanted drink only (never a global stock penalty).
      const oos = evaluateOutOfStock(patron, wantedId, traits);
      const penalty = applyOosPerception(patron, oos);
      pushPricingDebug({
        patronName: name,
        drinkId: wantedId,
        price: 0,
        reasonable: 0,
        ratio: 0,
        decision: 'oos_penalty',
        penalty,
        refused: oos.skipBuy,
      });
      if (oos.skipBuy) return { ok: false, reason: 'oos_skip' };
    }

    // Alternatives among in-stock.
    const inStock: Array<{ id: string; pref: number }> = [];
    for (const d of DRINKS_CATALOG) {
      if (d.id === wantedId) continue;
      if (!inventoryCanSell(d.id)) continue;
      inStock.push({ id: d.id, pref: prefs[d.id] ?? 0 });
    }
    if (!inStock.length) {
      return { ok: false, reason: inventoryCanSell(wantedId) ? 'price' : 'empty' };
    }
    inStock.sort((a, b) => b.pref - a.pref);
    const top = inStock[0].pref;
    const band = inStock.filter((x) => x.pref >= top - DRINK_PREF.topBand);
    const acceptable: Array<{ drink: Drink; pref: number; id: string }> = [];
    for (const x of band) {
      const checked = resolveEval(x.id);
      if (checked.drink && !checked.refuse) {
        acceptable.push({ drink: checked.drink, pref: x.pref, id: x.id });
      }
    }
    if (!acceptable.length) {
      applyEval(band[0].id, 'alt');
      return { ok: false, reason: 'price' };
    }
    const total = acceptable.reduce((s, x) => s + Math.max(0.01, x.pref), 0);
    let r = Math.random() * total;
    let chosen = acceptable[0];
    for (const x of acceptable) {
      r -= Math.max(0.01, x.pref);
      if (r <= 0) {
        chosen = x;
        break;
      }
    }
    applyEval(chosen.id, 'alt');
    return {
      ok: true,
      drink: chosen.drink,
      wantedId,
      substituted: chosen.drink.id !== wantedId,
    };
  }

  restockDrink(id: string, units: number): boolean {
    const n = Math.max(0, Math.floor(units));
    if (!inventoryProductExists(id) || n <= 0) return false;
    if (isSnackId(id) && !this.hasFunctionalTable()) {
      this.game.events.emit('restock-failed', { id, reason: 'need_table' });
      return false;
    }
    const supplier = inventorySupplierCost(id);
    const cost = Math.max(1, Math.round(supplier * n));
    if (this.money < cost) return false;
    this.deductClubMoney(cost);
    inventoryAddStock(id, n);
    this.persistLayout();
    this.game.events.emit('stats-updated', this.getHudState());
    this.game.events.emit('inventory-updated');
    return true;
  }

  /** Prompt A Phase 4 test/debug: set absolute stock for a drink. */
  setDrinkStock(id: string, units: number): boolean {
    const ok = inventorySetStock(id, units);
    if (ok) {
      this.persistLayout();
      this.game.events.emit('inventory-updated');
    }
    return ok;
  }

  /** Prompt A Phase 4 test/debug: current stock for a drink. */
  getDrinkStock(id: string): number {
    return inventoryGetStock(id);
  }

  /** Prompt A Phase 5: set public sale price (clamped to catalogue min/max/step). */
  setDrinkPrice(id: string, value: number): boolean {
    const ok = inventorySetPrice(id, value);
    if (ok) {
      this.persistLayout();
      this.game.events.emit('inventory-updated');
    }
    return ok;
  }

  /** Prompt A Phase 5 test/debug: current public sale price. */
  getDrinkPrice(id: string): number {
    return inventoryGetPrice(id);
  }

  private chooseMainPatronGoal(patron: Patron): void {
    if (!patron.active || this.phase !== 'open') return;
    // Beer + functional tap → specialized service point; other drinks → bar.
    if (this.shouldRoutePatronToBeerTap(patron)) {
      this.sendPatronToBeerTap(patron);
      return;
    }
    // With a working bar everyone goes to order first (then sits or wanders); without one they
    // sit on a sofa (placeholder income) or wander.
    if (this.barUsable()) {
      this.sendPatronToBar(patron);
      return;
    }
    const bestSeat = this.listFreeSeats(patron.profile.id)[0] ?? null;
    if (!bestSeat && Math.random() < AI_TUNABLES.seatChance) this.patronNoSeat(patron);
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
      // Prompt A Phase 2: perceive the seat actually used (comfort + cleanliness), once.
      this.perceiveUsedFurniture(patron, seat.furnitureId, true);
      let sitMs = Phaser.Math.Between(AI_TUNABLES.sitDurationMinMs, AI_TUNABLES.sitDurationMaxMs);
      const seatDef = this.scenario.furniture.find((f) => f.id === seat.furnitureId);
      if (seatDef && this.isTableFurniture(seatDef)) {
        sitMs = this.tryTableSnack(patron, sitMs);
      }
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

  /**
   * Table snack utility: optional botanas while seated.
   * Uses existing botanas inventory; slight sat + longer stay. Returns adjusted sitMs.
   */
  private tryTableSnack(patron: Patron, sitMs: number): number {
    if (patron.ateSnack) return sitMs;
    const snack = getSnackProduct('botanas');
    if (!snack) return sitMs;
    // A plate already prepared on a table is eaten first (no new stock used).
    const ready = claimServed('botanas', ['table:'], this.time.now);
    if (ready) {
      this.patronEatsServedSnack(patron, ready.item, ready.state);
      const boostedReady = Math.round(sitMs * SNACK_EXPERIENCE.sitDurationMult + SNACK_EXPERIENCE.sitDurationBonusMs);
      return Math.max(sitMs, boostedReady);
    }
    if (!inventoryCanSell('botanas')) return sitMs;
    if (Math.random() >= snack.orderChance) return sitMs;
    const price = inventoryGetPrice('botanas');
    if (!inventoryRecordSale('botanas')) return sitMs;
    this.money += price;
    this.nightEarned += price;
    patron.ateSnack = true;
    applyPerceivedExperience(
      patron,
      `snack:botanas:${patron.profile.id}`,
      SNACK_EXPERIENCE.satDelta,
      'comfortSens',
      'Botanas en la mesa'
    );
    patron.showBubble('Botanas');
    this.patronThink(patron, 'snack_found');
    this.game.events.emit('stats-updated', this.getHudState());
    this.game.events.emit('inventory-updated');
    const boosted = Math.round(
      sitMs * SNACK_EXPERIENCE.sitDurationMult + SNACK_EXPERIENCE.sitDurationBonusMs
    );
    return Math.max(sitMs, boosted);
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

  /** First functional beer tap (catalog beer_tap, not destroyed). */
  private activeBeerTap(): FurnitureDef | null {
    for (const f of this.scenario.furniture) {
      const id = (f.catalogId || f.type || '').toLowerCase();
      if (id !== BEER_TAP_CATALOG_ID && f.type !== 'beer_tap') continue;
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      if (conditionFromDurability(st.durability, st.maxDurability) === 'Inservible' || st.durability <= 0) {
        continue;
      }
      return f;
    }
    return null;
  }

  /** Service tiles for the beer tap (front row = order / pour). */
  private beerTapSpots(): {
    tap: FurnitureDef;
    interact: { col: number; row: number } | null;
    staffSpot: { col: number; row: number };
  } | null {
    const tap = this.activeBeerTap();
    if (!tap || !this.pathfinder) return null;
    const front = this.frontTiles(tap).filter((t) => this.pathfinder.isWalkable(t.col, t.row));
    if (front.length >= 2) return { tap, interact: front[0], staffSpot: front[1] };
    if (front.length === 1) return { tap, interact: null, staffSpot: front[0] };
    const fw = Math.max(1, tap.footprint[0]);
    const fh = Math.max(1, tap.footprint[1]);
    for (let c = tap.tile[0] - 1; c <= tap.tile[0] + fw; c++) {
      for (let r = tap.tile[1] - 1; r <= tap.tile[1] + fh; r++) {
        const inside =
          c >= tap.tile[0] && c < tap.tile[0] + fw && r >= tap.tile[1] && r < tap.tile[1] + fh;
        if (!inside && this.pathfinder.isWalkable(c, r)) {
          return { tap, interact: null, staffSpot: { col: c, row: r } };
        }
      }
    }
    return null;
  }

  private beerTapUsable(): boolean {
    const spots = this.beerTapSpots();
    if (!spots) return false;
    const spawn = { col: this.scenario.spawnTile[0], row: this.scenario.spawnTile[1] };
    return this.pathfinder.findPath(spawn, spots.staffSpot).length > 0;
  }

  /** Patron wants cerveza strongly enough to use beer service routing. */
  private patronWantsBeer(patron: Patron): boolean {
    const pref = patron.profile.preferredDrink;
    if (pref === BEER_TAP_DRINK_ID) return true;
    try {
      return prefFor(patron, BEER_TAP_DRINK_ID) >= 0.78;
    } catch {
      return false;
    }
  }

  private shouldRoutePatronToBeerTap(patron: Patron): boolean {
    if (!this.beerTapUsable()) return false;
    if (!this.patronWantsBeer(patron)) return false;
    if (!inventoryCanSell(BEER_TAP_DRINK_ID) && this.barUsable()) {
      // No cerveza stock — fall through to bar for alternatives.
      return false;
    }
    return prefersBeerTap(patron.beerServicePref);
  }

  private listBeerTapQueueSlots(exceptPatronId?: string): Array<{ col: number; row: number }> {
    const spots = this.beerTapSpots();
    if (!spots) return [];
    const centre = spots.interact ?? spots.staffSpot;
    const cands: Array<{ col: number; row: number; d: number }> = [];
    for (let dc = -3; dc <= 3; dc++) {
      for (let dr = -3; dr <= 3; dr++) {
        const col = centre.col + dc;
        const row = centre.row + dr;
        if (col === spots.staffSpot.col && row === spots.staffSpot.row) continue;
        if (!this.isPatronSlotFree({ col, row }, exceptPatronId)) continue;
        if (this.allStaff().some((st) => st.grid.col === col && st.grid.row === row)) continue;
        if (this.staffTileClaims.has(this.tileKey({ col, row }))) continue;
        const toCentre = Math.abs(dc) + Math.abs(dr);
        cands.push({ col, row, d: toCentre + (row < centre.row ? 3 : 0) });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    return cands.slice(0, AI_TUNABLES.barQueueMaxSlots).map((c) => ({ col: c.col, row: c.row }));
  }

  /** Walk to the beer tap queue and wait for cerveza service. */
  private sendPatronToBeerTap(patron: Patron): void {
    const slots = this.listBeerTapQueueSlots(patron.profile.id);
    const spot = slots[0];
    if (!spot || !this.claimPatronSlot(patron, spot)) {
      // Tap packed — try the bar if usable, else wander.
      if (this.barUsable()) {
        this.sendPatronToBar(patron);
      } else {
        this.sendPatronWandering(patron);
      }
      return;
    }
    patron.goal = 'beer_tap';
    const ok = patron.walkTo(spot, () => {
      if (!patron.active || this.phase !== 'open') return;
      patron.waiting = true;
      patron.seated = false;
      const tap = this.beerTapSpots()?.tap;
      if (tap) patron.faceToward({ col: spot.col, row: spot.row - 1 });
      const used = this.activeBeerTap();
      if (used) this.perceiveUsedFurniture(patron, used.id, false);
      patron.refreshStatusLabel();
      patron.showBubble(this.drinkDisplayName(BEER_TAP_DRINK_ID));
      // A beer already poured at the tap → take it (no wait for staff).
      if (this.tryPatronTakeServedBeer(patron, 'tap')) return;
      this.tryAssignServeAi(patron);
    });
    if (!ok) {
      this.releasePatronSlot(patron);
      if (this.barUsable()) this.sendPatronToBar(patron);
      else this.sendPatronWandering(patron);
    }
  }

  private hasFunctionalTable(): boolean {
    for (const f of this.scenario.furniture) {
      const id = (f.catalogId || f.type || '').toLowerCase();
      if (!TABLE_TYPES.has(id) && !TABLE_CATALOG_IDS.has(id) && !isTableCatalogId(id)) continue;
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      if (conditionFromDurability(st.durability, st.maxDurability) === 'Inservible' || st.durability <= 0) {
        continue;
      }
      return true;
    }
    return false;
  }

  private isTableFurniture(def: FurnitureDef): boolean {
    const id = (def.catalogId || def.type || '').toLowerCase();
    return TABLE_TYPES.has(id) || TABLE_CATALOG_IDS.has(id) || isTableCatalogId(id);
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
      // Prompt A Phase 2: the bar is used (cleanliness only; patrons stand there).
      const usedBar = this.activeBar();
      if (usedBar) this.perceiveUsedFurniture(patron, usedBar.id, false);
      patron.refreshStatusLabel();
      patron.showBubble(this.drinkDisplayName(patron.profile.preferredDrink));
      if (this.tryPatronTakeServedBeer(patron, 'bar')) return;
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
    const wantsSit = Math.random() < AI_TUNABLES.seatChance;
    if (seat && wantsSit && this.claimPatronSlot(patron, seat)) {
      this.sendPatronToSeat(patron, seat);
    } else {
      // Wanted to sit but there's nowhere to → teaches "more seats" without a meter.
      if (wantsSit && !seat) this.patronNoSeat(patron);
      this.sendPatronWandering(patron);
    }
  }

  /** Pay + tip from drink price scaled by venue quality / patience / broken furniture.
   *  Optional tipAction (Phase 3) adds chance bonus + amount mult; does not alter serve flow.
   *  Phase 5: hidden client↔staff affinity only modifies chance/amount/satisfaction here.
   *  Phase 7: visit customerSatisfaction + generosity multiply chance/amount (capped 0.92). */
  private computeServePayout(
    patron: Patron,
    drink: Drink,
    tipAction: TipAction | null = null,
    staffMood?: number,
    staffId?: string
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
    // Phase 4: staff mood → service quality (small configurable factor)
    if (typeof staffMood === 'number') {
      tipChance *= MOOD_SERVICE_TIP_FACTOR[moodBand(staffMood)];
    }
    // Drunk staff give worse service (1 when sober).
    if (staffId) tipChance *= staffServiceFactor(staffId);
    if (tipAction) {
      tipChance += tipAction.tipChanceBonus;
    }
    // Phase 5: affinity (outcome only — staff never reads this for decisions)
    let affinityAmountMult = 1;
    let satisfactionBonus = 0;
    let affinityLevel: 'baja' | 'normal' | 'alta' = 'normal';
    let affinitySatDelta = 0;
    if (staffId) {
      affinityLevel = getAffinity(patron, staffId);
      // Prompt A Phase 8: one-shot hidden sat from this emergent serve (before Phase 7 tip mods).
      affinitySatDelta = applyAffinityToSatisfaction(patron, staffId, affinityLevel);
      const mods = applyAffinityToTipChance(tipChance, affinityLevel);
      tipChance = mods.tipChance;
      affinityAmountMult = mods.tipAmountMult;
      satisfactionBonus = mods.satisfactionBonus; // existing patience/nightMood — unchanged
    }
    // Prompt A Phase 7: multiply existing tip chance/amount by visit sat + generosity.
    const exp = getExperience(patron);
    const satNow = exp?.satisfaction ?? BASE_SATISFACTION;
    const generosity = exp?.traits.generosity ?? 0.5;
    const satMods = computeSatisfactionTipMods(satNow, generosity);
    const chanceBeforeSat = tipChance;
    tipChance = applySatisfactionToTipChance(tipChance, satMods);

    // Beer tap specialization: subtle sat + tip bump when cerveza served at the grifo.
    let tapSatApplied = 0;
    if (patron.servedAtBeerTap && drink.id === BEER_TAP_DRINK_ID) {
      tipChance += BEER_TAP_BONUS.tipChanceBonus;
      const beerPref =
        patron.profile.preferredDrink === BEER_TAP_DRINK_ID ||
        (() => {
          try {
            return prefFor(patron, BEER_TAP_DRINK_ID) >= 0.55;
          } catch {
            return false;
          }
        })();
      const satDelta = beerPref ? BEER_TAP_BONUS.satDeltaPreferBeer : BEER_TAP_BONUS.satDeltaOther;
      const applied = applyPerceivedExperience(
        patron,
        `tap_beer:${patron.profile.id}`,
        satDelta,
        'comfortSens',
        'Cerveza de grifo'
      );
      tapSatApplied = applied ?? 0;
      void tapSatApplied;
    }

    const drinkPay = Math.max(1, Math.round(drink.price * payMult));
    let tipAmount = 0;
    let tipped = false;
    let satAmountMultApplied = satMods.amountMult;
    if (Math.random() < tipChance) {
      const tipBase = Math.max(1, Math.ceil(drink.price * 0.25));
      let amt = Math.max(
        1,
        Math.round(tipBase * lerp(AI_TUNABLES.tipQualityMin, AI_TUNABLES.tipQualityMax, q))
      );
      if (tipAction) {
        amt = Math.max(1, Math.round(amt * tipAction.tipAmountMult));
      }
            amt = Math.max(1, Math.round(amt * affinityAmountMult));
      if (patron.servedAtBeerTap && drink.id === BEER_TAP_DRINK_ID) {
        amt = Math.max(1, Math.round(amt * BEER_TAP_BONUS.tipAmountMult));
      }
      // Phase 7: sat/generosity amount scale + tiny jitter (after existing mults).
      const amtScale = satisfactionAmountScale(satMods);
      satAmountMultApplied = Math.round(amtScale * 1000) / 1000;
      amt = Math.max(1, Math.round(amt * amtScale));
      tipAmount = amt;
      tipped = true;
    }
    // Phase 5: satisfaction → existing nightMood (patienceRemaining)
    if (satisfactionBonus) {
      applySatisfactionBonus(patron, satisfactionBonus);
      patron.refreshStatusLabel();
    }
    if (staffId) {
      pushAffinityDebug({
        patronName: patron.profile.name,
        staffId,
        level: affinityLevel,
        tipped,
        amount: tipAmount,
        satDelta: affinitySatDelta,
        satAfter: getExperience(patron)?.satisfaction ?? satNow,
      });
    }
    pushTipDebug({
      patronName: patron.profile.name,
      staffId: staffId || '',
      sat: satNow,
      generosity,
      chanceBefore: Math.round(chanceBeforeSat * 1000) / 1000,
      chanceAfter: tipChance,
      chanceMult: satMods.chanceMult,
      amountMult: satAmountMultApplied,
      tipAmount,
      tipped,
    });
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

  /** Prompt A Phase 2: accumulator for proximity perception (ms). */
  private perceptionAccum = 0;

  /**
   * Prompt A Phase 2: a patron uses a furniture piece. READS existing stats only.
   * comfort:<id> once per visit (seats); dirt:<id>:<episode> or clean:<id> once.
   */
  private perceiveUsedFurniture(patron: Patron, furnitureId: string, seat: boolean): void {
    const def = this.scenario.furniture.find((f) => f.id === furnitureId);
    if (!def) return;
    const st = this.statsOf(def);
    const name = this.furnitureDisplayName(def);
    if (seat) {
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      const c = comfortBandFor(st, cond);
      const applied = applyPerceivedExperience(patron, `comfort:${def.id}`, c.delta, 'comfortSens', `${name}: ${c.band} (${cond})`);
      if (applied != null) {
        if (cond === 'Se rompió' || cond === 'Inservible') this.patronThink(patron, 'broken_furniture');
        else if (c.delta > 0) this.patronThink(patron, 'good_seat');
        else if (c.delta < 0) this.patronThink(patron, 'uncomfortable');
      }
    }
    const d = dirtBandFor(st, true);
    if (d.band === 'dirty' || d.band === 'very_dirty') {
      const applied = applyPerceivedExperience(patron, dirtEpisodeKey(def.id, true), d.delta, 'cleanSens', `${name}: ${d.band} (usado)`);
      if (applied != null && applied < 0) this.patronThink(patron, 'dirty_furniture');
    } else {
      dirtEpisodeKey(def.id, false); // lazy episode bookkeeping
      if (d.band === 'clean') {
        applyPerceivedExperience(patron, `clean:${def.id}`, d.delta, 'cleanSens', `${name}: clean (usado)`);
      }
    }
  }

  /** Prompt A Phase 2: only items within PERCEPTION_RADIUS_TILES of this patron (no global scan of state). */
  private perceiveNearbyDirt(patron: Patron): void {
    const { col, row } = patron.grid;
    for (const def of this.scenario.furniture) {
      if (!withinPerception(col, row, def.tile, def.footprint)) continue;
      const st = this.statsOf(def);
      const dirty = isVisiblyDirty(st);
      const key = dirtEpisodeKey(def.id, dirty);
      if (!dirty) continue;
      const d = dirtBandFor(st, false);
      const applied = applyPerceivedExperience(patron, key, d.delta, 'cleanSens', `${this.furnitureDisplayName(def)}: ${d.band} (visto)`);
      if (applied != null && applied < 0) this.patronThink(patron, 'dirty_furniture');
    }
    // Floor dirt: local zone perception only (same radius / cleanSens path).
    for (const z of getFloorZones()) {
      if (!isFloorVisiblyDirty(z)) continue;
      if (distToFloorZone(col, row, z) > 2) continue; // PERCEPTION_RADIUS_TILES
      const band = floorDirtBand(z);
      const delta = floorDirtDelta(band);
      if (delta === 0) continue;
      const key = floorDirtEpisodeKey(z);
      const applied = applyPerceivedExperience(patron, key, delta, 'cleanSens', `Piso: ${band} (visto)`);
      if (applied != null && applied < 0) this.patronThink(patron, 'dirty_floor');
    }
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
    if (patron.goal !== 'leave') this.patronGoodbyeThought(patron);
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
      // Prompt A Phase 1: snapshot visit satisfaction (no behaviour change yet).
      finalizeVisit(patron);
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
      if (!p.wasTouch && p.button === 2) return;
      this.npcTapHandled = true;
      p.event?.stopPropagation?.();
    });
    npc.sprite.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch && p.button === 2) return;
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
    // Exhausted / fed-up / very drunk staff may not obey (probabilistic, never at normal levels).
    const comp = rollCompliance(staff.profile.id, staff.profile.energy, staff.profile.mood);
    if (comp === 'refuse') {
      const drunk = intoxOf(staff.profile.id) >= ORDER_COMPLIANCE.extremeIntox;
      this.staffSay(staff, this.pick(drunk ? DRUNK_REFUSE_LINES : REFUSE_LINES));
      this.logOrder(staff, 'walk', 'refuse');
      return;
    }
    // Player order = priority #1: interrupt any AI job or previous order.
    if (staff.aiJob !== 'none' || staff.state === 'busy') {
      this.interruptStaff(staff);
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
    const tok = staff.jobToken;
    staff.actionTweenBase = { y: baseY, sx: baseSX, sy: baseSY };
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
        staff.actionTweenBase = null;
        // Interrupted by a player order meanwhile → the old job's completion is void.
        if (staff.jobToken !== tok) return;
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



  /**
   * Prompt B Phase B10: Dormir — end the day from SUMMARY.
   * Fade out → CLOSED @ 17:00 (currentDay already advanced by NightCycle) → fade in.
   * Does NOT auto-open. Does NOT bump nightNumber again.
   */
  sleepDay = (): void => {
    if (this.phase !== 'summary') return;
    if (this.sleepInProgress) return;
    this.sleepInProgress = true;
    const cam = this.cameras.main;
    const fade = Math.max(200, SLEEP_FADE_MS);

    // Apply day-roll immediately so headless / paused clocks still advance.
    // Fade is cosmetic; do not gate state on camerafadeoutcomplete.
    // nightNumber already next day from finishNight / onNightEnd.
    beginShiftClosed(this.nightNumber);
    syncShiftDay(this.nightNumber);
    this.phase = legacyPhaseFromShift(); // prep
    // Same-day services end; staff sleep it off (alcohol / café reset) and spend some money outside.
    this.cancelAllRepairJobs();
    this.wasteAllServed();
    this.clearAllFlies();
    onStaffSleep(this.allStaff().map((s) => s.profile.id));
    this.resetForNewNight();
    // Day-start: empty + dark + staff arrive ~17:05; seed floor dirt from last night.
    seedFloorDirtForDay(this.lastNightUsed);
    this.lastNightUsed = false;
    this.refreshFloorDirtVisuals();
    this.beginDayStaffHidden();
    this.applyClubLighting('closed', false);
    this.game.events.emit('stats-updated', this.getHudState());
    this.game.events.emit('day-started', {
      ...this.getHudState(),
      toast: this.rollDayStartToast(),
    });
    // Clear guard now — fade must not block a later Dormir if camera events stall.
    this.sleepInProgress = false;

    let fadedIn = false;
    const endFade = () => {
      if (fadedIn) return;
      fadedIn = true;
      try {
        cam.fadeIn(fade, 0, 0, 0);
      } catch {
        /* ignore */
      }
    };
    try {
      cam.fadeOut(fade, 0, 0, 0);
      cam.once('camerafadeoutcomplete', endFade);
      this.time.delayedCall(fade + 80, endFade);
    } catch {
      endFade();
    }
  };

  private rollDayStartToast(): string | null {
    if (Math.random() > DAY_START_TOAST_CHANCE) return null;
    const i = Math.floor(Math.random() * DAY_START_MESSAGES.length);
    return DAY_START_MESSAGES[i] ?? null;
  }

  closeNight = (): void => {
    const st = getShiftState();
    if (st === 'closing') return;
    if (this.phase !== 'open' || st !== 'open') return;
    // Prompt B Phase B7: enter CLOSING — stop arrivals, do NOT kick patrons instantly.
    if (!beginShiftClosing()) return;
    this.phase = legacyPhaseFromShift(); // still 'open' for AI / patron loops
    stopArrivals();
    {
      const c = getShiftSnapshot();
      recordStaffShiftEnd(c.gameHour, c.gameMinute);
    }
    this.closingStartedAt = this.time.now;
    this.closingNudged = false;
    this.game.events.emit('night-closing', this.getHudState());
    this.game.events.emit('stats-updated', this.getHudState());
    const active = this.patrons.filter((p) => p.active);
    if (active.length === 0) {
      this.finishNight();
    }
  };

  /** B7: while CLOSING, wait for patrons to leave; nudge then force-summary. */
  private tickClosing(): void {
    if (getShiftState() !== 'closing') return;
    const active = this.patrons.filter((p) => p.active);
    if (active.length === 0) {
      this.finishNight();
      return;
    }
    const elapsed = this.time.now - this.closingStartedAt;
    if (!this.closingNudged && elapsed >= CLOSING_NUDGE_AFTER_MS) {
      this.closingNudged = true;
      for (const p of active) {
        if (p.goal === 'leave') continue;
        this.serveClaim.delete(p.profile.id);
        this.sendPatronHome(p);
      }
    }
    if (elapsed >= CLOSING_FORCE_SUMMARY_MS) {
      this.finishNight();
    }
  }

  private finishNight(): void {
    // Day-start floor seed: remember if this night had activity.
    this.lastNightUsed = this.servedCount > 0 || this.nightEarned > 0 || this.patrons.length > 0;

    const st = getShiftState();
    if (this.phase !== 'open' && st !== 'closing') return;
    // Prompt B Phase B7: CLOSING (or open fallback) → SUMMARY.
    beginShiftSummary();
    // Ensure hours closed even if finishNight skipped CLOSING (debugForceSummary).
    {
      const c = getShiftSnapshot();
      recordStaffShiftEnd(c.gameHour, c.gameMinute);
    }
    syncShiftDay(this.nightNumber);
    this.phase = legacyPhaseFromShift();
    stopArrivals();
    this.closingStartedAt = 0;
    this.closingNudged = false;
    // Prompt B Phase B3: lights down for summary / closed look.
    this.applyClubLighting('closed', true);
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    if (this.selectedNpcId && this.selectedNpcId !== this.bartender?.profile.id) {
      this.deselectNpc();
      this.game.events.emit('npc-deselected');
    }
    this.patrons.forEach((p) => {
      finalizeVisit(p);
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
      this.interruptStaff(s);
      s.state = 'idle';
      s.startBob();
    }
    // Served-but-unsold mugs / plates become merma (money already spent is not recovered).
    this.wasteAllServed();
    const waste = getNightWaste();
    const staffUse = getNightStaffConsumption();
    const wasteUnits = Object.values(waste.units).reduce((a, b) => a + b, 0);
    const staffUnits = Object.values(staffUse.units).reduce((a, b) => a + b, 0);
    const interventionLines: string[] = [];
    if (wasteUnits > 0) interventionLines.push(`Merma: ${wasteUnits} (costo $${Math.round(waste.cost)})`);
    if (staffUnits > 0) interventionLines.push(`Consumo del personal: ${staffUnits} ($${Math.round(staffUse.revenue)})`);
    this.syncBartenderBarDepth();
    // Phase 7: roll-up + weekly/monthly hooks, then bump nightNumber.
    // Tips night/jornada stay visible for the summary; resetNightTips runs on openNight.
    const endedNight = onNightEnd(this);
    syncShiftDay(this.nightNumber); // post night-end bump
    // Prompt A Phase 10: snapshot sales/tips/leaves/sat BEFORE openNight resets soldTonight.
    const oc = getShiftOpenCloseTimes();
    const hours = getLastStaffHours();
    const durationMin =
      hours.length > 0
        ? Math.max(...hours.map((h) => h.durationWorkedGameMinutes))
        : oc.openTimeHour != null &&
            oc.openTimeMinute != null &&
            oc.closeTimeHour != null &&
            oc.closeTimeMinute != null
          ? (() => {
              let a = oc.openTimeHour! * 60 + oc.openTimeMinute!;
              let b = oc.closeTimeHour! * 60 + oc.closeTimeMinute!;
              if (b < a) b += 24 * 60;
              return b - a;
            })()
          : 0;
    const durationLabel = formatDurationHm(durationMin);
    const staffWorked = hours.map((h) => ({
      id: h.staffId,
      name: h.name,
      durationGameMinutes: h.durationWorkedGameMinutes,
      durationLabel: formatDurationHm(h.durationWorkedGameMinutes),
    }));
    const nightStats = snapshotNightStats({
      nightNumber: endedNight,
      servedCount: this.servedCount,
      staff: this.listPayrollStaff(),
      openHhmm: oc.openTime,
      closeHhmm: oc.closeTime,
      durationGameMinutes: durationMin,
      durationLabel,
      staffWorked,
    });
    this.persistLayout();
    const payroll = takeLastPayroll();
    const utilities = takeLastUtilities();
    this.game.events.emit('night-summary', {
      ...this.getHudState(),
      nightNumber: endedNight,
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
      payroll: payroll
        ? { total: payroll.total, lines: payroll.lines.map((l) => ({ name: l.name, amount: l.amount })) }
        : null,
      nextPayrollNight: nextWeekEndNight(endedNight),
      utilities: utilities
        ? {
            total: utilities.total,
            lines: utilities.lines.map((l) => ({ label: l.label, amount: l.amount })),
          }
        : null,
      nextUtilitiesNight: nextMonthEndNight(endedNight),
      // Phase 10: small drink/stockout/served lines (no hidden sat numbers).
      nightSales: {
        drinksSold: nightStats.drinksSoldTotal,
        drinksRevenue: nightStats.drinksRevenueTotal,
        stockedOutNames: nightStats.stockedOutNames,
        servedCount: nightStats.servedCount,
        summaryLines: [
          NIGHT_SUMMARY_LINES.drinks(nightStats.drinksSoldTotal, nightStats.drinksRevenueTotal),
          NIGHT_SUMMARY_LINES.stockout(nightStats.stockedOutNames),
          NIGHT_SUMMARY_LINES.served(nightStats.servedCount),
          ...interventionLines,
        ].filter((x): x is string => !!x),
      },
      // Prompt B Phase B9
      shiftSummary: {
        openHhmm: nightStats.openHhmm ?? null,
        closeHhmm: nightStats.closeHhmm ?? null,
        durationLabel: nightStats.durationLabel ?? null,
        staffNames: staffWorked.map((s) => s.name),
        staffHours: staffWorked.map((s) => ({ name: s.name, durationLabel: s.durationLabel })),
        summaryLines: [
          nightStats.openHhmm ? NIGHT_SUMMARY_LINES.openAt(nightStats.openHhmm) : null,
          nightStats.closeHhmm ? NIGHT_SUMMARY_LINES.closeAt(nightStats.closeHhmm) : null,
          nightStats.durationLabel ? NIGHT_SUMMARY_LINES.duration(nightStats.durationLabel) : null,
          NIGHT_SUMMARY_LINES.staffWorked(staffWorked.map((s) => s.name)),
          ...staffWorked.map((s) => NIGHT_SUMMARY_LINES.staffHoursLine(s.name, s.durationLabel)),
        ].filter((x): x is string => !!x),
      },
    });
    this.emitStaffRoster();
  }

  /** Phase 8: employed staff for weekly payroll (NightCycle weekly hook). */
  listPayrollStaff(): { id: string; name: string }[] {
    return this.allStaff().map((s) => ({
      id: s.profile.id,
      name: s.displayName,
    }));
  }

  /**
   * Phase 8: money mutation path used by Payroll (same as hire/shop: mutate this.money).
   * Tips are never touched. May go negative when ALLOW_NEGATIVE_BALANCE.
   */
  deductClubMoney(amount: number): void {
    const n = Math.max(0, Math.floor(amount));
    if (n <= 0) return;
    this.money -= n;
    if (!ALLOW_NEGATIVE_BALANCE && this.money < 0) {
      this.money = 0;
    }
  }

    /** Phase 7/B7 test: start soft close (CLOSING). Use debugForceSummary for instant end. */
  debugEndNight(): void {
    this.closeNight();
  }

  /** B7 test: skip CLOSING dwell and go straight to SUMMARY (destroys patrons). */
  debugForceSummary(): void {
    if (getShiftState() === 'closed' || getShiftState() === 'summary') return;
    if (getShiftState() === 'open') {
      beginShiftClosing();
      stopArrivals();
    }
    this.finishNight();
  }

  /** Phase 3 test/debug: per-staff tip-action performance counts. */
  getTipActionCounts(staffId?: string) {
    return getActionCounts(staffId);
  }
  /** Phase 9 test: force next serves to use this tip action id (null = normal picker). */
  debugForceTipAction(actionId: string | null): void {
    this.forcedTipActionId = actionId && getTipAction(actionId) ? actionId : null;
  }

  /** Phase 9 test: force patron taste score (−1..+1) for an action. */
  debugSetActionTaste(patronName: string, actionId: string, score: number): boolean {
    const ok = setActionTaste(patronName, actionId, score);
    if (ok) this.persistLayout();
    return ok;
  }

  debugPeekActionTaste(patronName: string, actionId: string) {
    return peekActionTaste(patronName, actionId);
  }


  /** Phase 5 test/debug: recent served affinity outcomes (ring ~50). */
  getAffinityDebug() {
    return readAffinityDebug();
  }

  /** Phase 8 test/debug: force patronName × staffId affinity (alta|normal|baja). */
  debugSetAffinity(
    patronName: string,
    staffId: string,
    level: 'alta' | 'normal' | 'baja'
  ): boolean {
    const ok = setAffinity(patronName, staffId, level);
    if (ok) this.persistLayout();
    return ok;
  }

  /** Phase 8 test/debug: peek cached affinity without rolling. */
  debugPeekAffinity(patronName: string, staffId: string) {
    return peekAffinity(patronName, staffId);
  }

  /** Prompt A Phase 4: UI restock request { id, units }. */
  private onCmdRestockDrink = (payload: { id?: string; units?: number }): void => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const units = typeof payload?.units === 'number' ? payload.units : 0;
    if (!id || units <= 0) return;
    const ok = this.restockDrink(id, units);
    if (!ok) {
      if (isSnackId(id) && !this.hasFunctionalTable()) return;
      this.game.events.emit('restock-failed', { id, reason: 'money' });
    }
  };

  /** Prompt A Phase 5: UI price edit { id, price } or { id, delta }. */
  private onCmdSetDrinkPrice = (payload: {
    id?: string;
    price?: number;
    delta?: number;
  }): void => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return;
    let next: number;
    if (typeof payload?.price === 'number' && Number.isFinite(payload.price)) {
      next = payload.price;
    } else if (typeof payload?.delta === 'number' && Number.isFinite(payload.delta)) {
      next = inventoryGetPrice(id) + payload.delta;
    } else {
      return;
    }
    this.setDrinkPrice(id, next);
  };

  /** Prompt A Phase 3/4 test/debug: drink stock / prices / nightly sold. */
  getInventoryDebug() {
    return readInventoryDebug();
  }

  /** Prompt A Phase 1 test/debug: active patron satisfaction + last ~20 visits. */
  getExperienceDebug() {
    const active = getActiveExperiences().map((e) => ({
      name: e.name,
      satisfaction: e.satisfaction,
      traits: { ...e.traits },
      events: e.events.map((ev) => ({ ...ev })),
    }));
    return { active, visits: getVisitDebug(), dirtEpisodes: getDirtEpisodesDebug() };
  }

  /** Prompt A Phase 6 test/debug: recent price / OOS buy-alt-skip decisions. */
  getPricingDebug() {
    return readPricingDebug();
  }

  /** Prompt A Phase 7 test/debug: sat/generosity tip chance before→after + amounts. */
  getTipDebug() {
    return readTipDebug();
  }

  /** Prompt A Phase 10 test/debug: nightly sales history + live leave/sat counters. */
  getNightStatsDebug() {
    return readNightStatsDebug();
  }


  /** Catch up any due arrivals at the current game clock (lag / multi-minute safe). */
  private processArrivalsForAdvancedMinutes(_minutesAdvanced: number): void {
    for (let guard = 0; guard < 8; guard++) {
      if (this.phase !== 'open') return;
      const snap = getShiftSnapshot();
      const n = tickArrivals({
        gameHour: snap.gameHour,
        gameMinute: snap.gameMinute,
        nightTimerSec: Number.POSITIVE_INFINITY,
        shiftState: getShiftState(),
        staffCount: getAvailableStaff(
          this.allStaff().map((s) => ({ id: s.profile.id, name: s.displayName }))
        ).length,
      });
      if (n <= 0) return;
      for (let k = 0; k < n; k++) this.spawnPatron();
    }
  }

  /** Prompt B Phase B1 test/debug: day / game clock / shift FSM. */
  getShiftDebug() {
    return readShiftDebug();
  }

  /** Prompt B Phase B8 test/debug: per-staff hours / overtime / pending fatigue. */
  getStaffHoursDebug() {
    return readStaffHoursDebug();
  }

  /** Prompt B Phase B4 test/debug: arrival log / soft cap. */
  getArrivalsDebug() {
    return readArrivalsDebug();
  }

  /** Prompt B Phase B11 test/debug: staff availability / absence stub. */
  getStaffAvailabilityDebug() {
    return readStaffAvailabilityDebug();
  }

  /** Prompt B Phase B11 test/debug: late-open sat stub. */
  getLateOpenDebug() {
    return readLateOpenDebug();
  }

  /** B11 test: set game clock (frozen while CLOSED). */
  debugSetGameTime(hour: number, minute: number): void {
    shiftDebugSetGameTime(hour, minute);
    this.game.events.emit('stats-updated', this.getHudState());
  }

  /**
   * B11 debug: open at hour:minute from closed (ignores snap-to-18:00).
   * Prefer openNight() for normal Abrir.
   */
  openShiftAt(hour: number, minute: number): boolean {
    if (this.buildMode) return false;
    if (this.phase !== 'prep') return false;
    this.hideDeleteConfirmUi();
    this.clearFurnitureSelection();
    this.rebuildPathfinder();
    syncShiftDay(this.nightNumber);
    if (!shiftOpenAt(hour, minute)) return false;
    this.phase = legacyPhaseFromShift();
    if (!this.staffPresent) this.revealStaffForShift(true);
    this.applyClubLighting('open', true);
    this.nightEarned = 0;
    this.servedCount = 0;
    resetNightTips();
    resetNightInventory();
    resetNightAccumulators();
    this.competitionObserveAccum = 0;
    this.nightTimer = Number.POSITIVE_INFINITY;
    this.closingStartedAt = 0;
    this.closingNudged = false;
    this.spawnLeft = 0;
    const snap = getShiftSnapshot();
    const working = getAvailableStaff(
      this.allStaff().map((s) => ({ id: s.profile.id, name: s.displayName }))
    );
    beginArrivalsNight(snap.gameHour, snap.gameMinute, working.length, this.nightNumber);
    beginLateOpenNight(snap.gameHour, snap.gameMinute);
    recordStaffShiftStart(working, snap.gameHour, snap.gameMinute);
    this.game.events.emit('night-started', this.getHudState());
    return true;
  }

  /** Prompt B Phase B4 test: set arrivals RNG seed. */
  debugSetArrivalsSeed(seed: number): void {
    setArrivalsSeed(seed);
  }

  /**
   * Prompt B Phase B4/B7 test: advance game minutes + process arrivals.
   * Does not auto-close (B7: only Cerrar / CLOSING → SUMMARY).
   */
  debugAdvanceGameMinutes(n: number): number {
    const st = getShiftState();
    // Day-start: allow advancing while CLOSED (prep clock + staff arrival).
    if (st === 'closed' || this.phase === 'prep') {
      const steps = Math.max(0, Math.floor(n) || 0);
      let advanced = 0;
      for (let i = 0; i < steps; i++) {
        if (getShiftState() !== 'closed') break;
        const got = shiftAdvanceGameMinutes(1);
        if (got <= 0) break;
        advanced += got;
        this.checkStaffArrivalFromClock();
      }
      this.game.events.emit('stats-updated', this.getHudState());
      return advanced;
    }
    if (st === 'closing') {
      // Still advance clock while closing, but no new arrivals.
      const steps = Math.max(0, Math.floor(n) || 0);
      let advanced = 0;
      for (let i = 0; i < steps; i++) {
        if (getShiftState() !== 'closing') break;
        const got = shiftAdvanceGameMinutes(1);
        if (got <= 0) break;
        advanced += got;
      }
      this.game.events.emit('stats-updated', this.getHudState());
      return advanced;
    }
    if (this.phase !== 'open') return 0;
    const steps = Math.max(0, Math.floor(n) || 0);
    let advanced = 0;
    for (let i = 0; i < steps; i++) {
      if (this.phase !== 'open' || getShiftState() !== 'open') break;
      const got = shiftAdvanceGameMinutes(1);
      if (got <= 0) break;
      advanced += got;
      this.processArrivalsForAdvancedMinutes(got);
      this.game.events.emit('stats-updated', this.getHudState());
    }
    return advanced;
  }

  /** Prompt A Phase 10 test/debug: reputation visit sats + return-chance hints (unused by spawn). */
  getReputationDebug() {
    return readReputationDebug();
  }

  /** Prompt A Phase 10: expose placeholder hint (NOT used by spawning). */
  debugReturnChanceHint(patronName: string): number {
    return getReturnChanceHint(patronName);
  }

  /**
   * Test/debug: set cleanliness / comfort / durability as ratios of max (0..1)
   * on every furniture piece, then refresh dirt overlays.
   */
  debugSetFurnitureWear(opts: {
    cleanlinessRatio?: number;
    comfortRatio?: number;
    durabilityRatio?: number;
  }): void {
    const cr = opts.cleanlinessRatio;
    const cor = opts.comfortRatio;
    const dr = opts.durabilityRatio;
    for (const f of this.scenario.furniture) {
      this.ensureFurnitureStats(f);
      const st = this.statsOf(f);
      if (typeof cr === 'number' && Number.isFinite(cr)) {
        st.cleanliness = Math.max(0, Math.min(st.maxCleanliness, st.maxCleanliness * cr));
      }
      if (typeof cor === 'number' && Number.isFinite(cor)) {
        st.comfort = Math.max(0, Math.min(st.maxComfort, st.maxComfort * cor));
      }
      if (typeof dr === 'number' && Number.isFinite(dr)) {
        st.durability = Math.max(0, Math.min(st.maxDurability, st.maxDurability * dr));
      }
      this.writeStatsToDef(f, st);
      this.refreshDirtOverlay(f);
    }
  }

  /** Phase 6 test/debug: competitiveness + rolling tips per staff. */
  getCompetitionDebug() {
    return readCompetitionDebug();
  }

    getHudState() {
    const shift = getShiftSnapshot();
    return {
      money: this.money,
      phase: this.phase,
      nightTimer: 0, // B7: no countdown
      isClosing: getShiftState() === 'closing',
      nightNumber: this.nightNumber,
      shiftState: shift.shiftState,
      currentDay: shift.currentDay,
      gameHour: shift.gameHour,
      gameMinute: shift.gameMinute,
      gameClock: formatGameClock(shift.gameHour, shift.gameMinute),
      scheduleLabel: SCHEDULE_LABEL,
      scheduleLabelMobile: SCHEDULE_LABEL_MOBILE,
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
      snacksUnlocked: this.hasFunctionalTable(),
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
    if (this.tapSpotHolderId === id) this.tapSpotHolderId = null;
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

  /** Waiting at the bar or beer tap with nobody on their order yet. */
  private waitingBarPatrons(): Patron[] {
    return this.patrons.filter(
      (p) =>
        p.active &&
        p.waiting &&
        !p.served &&
        (p.goal === 'bar' || p.goal === 'beer_tap') &&
        !this.serveClaim.has(p.profile.id)
    );
  }

  /** patronId → staffId while an Atender job is in flight. */
  private serveClaim = new Map<string, string>();
  /** Only one staff member pours at the bar's staff tile at a time. */
  private barSpotHolderId: string | null = null;
  /** Only one staff member pours at the beer tap at a time. */
  private tapSpotHolderId: string | null = null;

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
    if (
      !patron.active ||
      !patron.waiting ||
      patron.served ||
      (patron.goal !== 'bar' && patron.goal !== 'beer_tap')
    )
      return false;
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

  /** Staff walks to the bar or beer tap, pours the patron's drink ('Sirviendo …'), the patron pays and moves on. */
  private beginAiServe(staff: Bartender, patron: Patron): boolean {
    const atTap = patron.goal === 'beer_tap';
    const barSpots = atTap ? null : this.barSpots();
    const tapSpots = atTap ? this.beerTapSpots() : null;
    if (atTap && !tapSpots) return false;
    if (!atTap && !barSpots) return false;

    let drink: Drink;
    let wantedId: string;
    let substituted = false;

    if (atTap) {
      // Tap only serves cerveza from the existing beer inventory.
      wantedId = BEER_TAP_DRINK_ID;
      patron.wantedDrinkId = wantedId;
      if (!inventoryCanSell(BEER_TAP_DRINK_ID)) {
        patron.servedDrinkId = null;
        patron.wasOutOfStock = true;
        noteLeaveWithoutBuy('empty');
        patron.showBubble('Se acabó la cerveza');
        this.patronThink(patron, 'no_beer');
        patron.waiting = false;
        patron.served = false;
        this.releasePatronSlot(patron);
        this.releaseTile(patron.grid);
        patron.refreshStatusLabel();
        this.sendPatronHome(patron);
        return false;
      }
      const resolved = this.resolveServeDrink(BEER_TAP_DRINK_ID);
      if (!resolved) return false;
      drink = resolved;
      patron.servedDrinkId = drink.id;
      patron.wasOutOfStock = false;
      patron.servedAtBeerTap = true;
    } else {
      // Prompt A Phase 4+6: stock + price/availability perception → buy / alt / skip.
      const pick = this.pickServeDrink(patron);
      if (!pick.ok) {
        patron.wantedDrinkId = patron.profile.preferredDrink || null;
        patron.servedDrinkId = null;
        patron.wasOutOfStock = pick.reason === 'empty' || pick.reason === 'oos_skip';
        noteLeaveWithoutBuy(pick.reason);
        if (pick.reason === 'empty') patron.showBubble('Se acabó todo');
        else if (pick.reason === 'price') patron.showBubble('Muy caro');
        else patron.showBubble('Sin mi bebida');
        const wantedName = this.drinkDisplayName(patron.profile.preferredDrink).toLowerCase();
        if (pick.reason === 'empty') this.patronThink(patron, 'nothing_left');
        else if (pick.reason === 'price') this.patronThink(patron, 'too_expensive');
        else if (patron.profile.preferredDrink === BEER_TAP_DRINK_ID) this.patronThink(patron, 'no_beer');
        else this.patronThink(patron, 'no_drink', { drink: wantedName });
        patron.waiting = false;
        patron.served = false;
        this.releasePatronSlot(patron);
        this.releaseTile(patron.grid);
        patron.refreshStatusLabel();
        this.sendPatronHome(patron);
        return false;
      }
      drink = pick.drink;
      wantedId = pick.wantedId;
      substituted = pick.substituted;
      if (substituted && !inventoryCanSell(wantedId)) {
        if (wantedId === BEER_TAP_DRINK_ID) this.patronThink(patron, 'no_beer');
        else this.patronThink(patron, 'no_drink', { drink: this.drinkDisplayName(wantedId).toLowerCase() });
      }
      patron.wantedDrinkId = wantedId;
      patron.servedDrinkId = drink.id;
      patron.wasOutOfStock = substituted;
      patron.servedAtBeerTap = false;
    }

    const spot = atTap ? tapSpots!.staffSpot : barSpots!.staffSpot;
    staff.aiJob = 'serve';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.servingDrinkId = drink.id;
    staff.setServeLabel('Atendiendo');
    this.serveClaim.set(patron.profile.id, staff.profile.id);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    // The job is still ours (a player order or a night change releases the claim / bumps the token).
    const tok = staff.jobToken;
    const mine = () =>
      staff.jobToken === tok && this.serveClaim.get(patron.profile.id) === staff.profile.id;
    let spilledOnce = false;
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
      !patron.active ||
      this.phase !== 'open' ||
      !patron.waiting ||
      patron.served ||
      (patron.goal !== 'bar' && patron.goal !== 'beer_tap');

    const abortEmptyStock = () => {
      patron.wasOutOfStock = true;
      patron.servedDrinkId = null;
      noteLeaveWithoutBuy('empty');
      patron.showBubble('Se acabó todo');
      patron.waiting = false;
      patron.served = false;
      this.releasePatronSlot(patron);
      this.releaseTile(patron.grid);
      patron.refreshStatusLabel();
      release();
      this.sendPatronHome(patron);
    };

    const completeServe = () => {
      if (!mine()) return;
      if (patronGone()) {
        release();
        return;
      }
      // Drunk hands: a fumbled pour is merma and gets re-poured (once).
      if (!spilledOnce && Math.random() < staffSpillChance(staff.profile.id) && inventoryWithdraw(drink.id)) {
        spilledOnce = true;
        inventoryRecordWaste(drink.id);
        addFloorDirtAt(staff.grid.col, staff.grid.row, 2, 6);
        this.refreshFloorDirtVisuals();
        this.staffSay(staff, '¡Ups! Se me cayó…');
        this.game.events.emit('inventory-updated');
        this.time.delayedCall(Math.max(600, drink.serveTimeMs), completeServe);
        return;
      }
      // Stock may have raced to 0 while walking to the bar.
      if (!inventoryCanSell(drink.id) || !inventoryRecordSale(drink.id)) {
        abortEmptyStock();
        return;
      }
      // Charge inventory public price (not the static scenario drink.price).
      drink.price = inventoryGetPrice(drink.id);
      patron.servedDrinkId = drink.id;
      staff.applyServeDrain();
      // Phase 3/4: personality-weighted tip action, gated by existing energy/mood
      const moodAtServe = staff.profile.mood;
      let tipAction = pickTipAction(
        staff.profile.id,
        Math.random,
        undefined,
        {
          energy: staff.profile.energy,
          mood: staff.profile.mood,
        },
        getCompetitiveness(staff.profile.id)
      );
      // Phase 9 test override only — does not change picker logic when unset.
      if (this.forcedTipActionId) {
        tipAction = getTipAction(this.forcedTipActionId) ?? tipAction;
      }
      if (tipAction) {
        staff.applyTipActionCost(tipAction.energyCost, tipAction.moodCost);
        staff.setTipAction(
          tipAction.id,
          tipAction.label,
          this.time.now + tipAction.durationMs
        );
        recordActionPerformed(staff.profile.id, tipAction.id);
        staff.setServeLabel(`${tipAction.label} para el cliente`);
        // Prompt A Phase 9: patron taste → one-shot act:<id> sat (before tip sat mods).
        applyActionSatisfaction(patron, tipAction);
      }
      const payout = this.computeServePayout(
        patron,
        drink,
        tipAction,
        moodAtServe,
        staff.profile.id
      );
      this.money += payout.earned;
      this.nightEarned += payout.earned;
      this.servedCount++;
      if (payout.tipAmount > 0) {
        recordTip(staff.profile.id, payout.tipAmount);
        // Tips are the employee's own money (club payout unchanged).
        creditWallet(staff.profile.id, payout.tipAmount);
        noteTip(staff.profile.id, payout.tipAmount);
      }
      patron.servedByStaffId = staff.profile.id;
      // Thoughts tied to what this customer just experienced.
      if (patron.waitSince && this.time.now - patron.waitSince < THOUGHT_SAT.fastServeMs) {
        const d = applyPerceivedExperience(patron, 'fast_drink', THOUGHT_SAT.fastDrink, 'tolerance', 'Servicio rápido');
        if (d != null) this.patronThink(patron, 'fast_drink');
      }
      if (peekAffinity(patron.profile.name, staff.profile.id) === 'alta') {
        this.patronThink(patron, 'affinity_served', { staff: staff.displayName });
      }
      if (patron.servedAtBeerTap && patron.beerServicePref === 'tap') this.patronThink(patron, 'tap_great');
      patron.showBubble(payout.tipped ? `¡Propina! +$${payout.earned}` : `+$${payout.earned}`);
      patron.served = true;
      patron.waitSince = 0;
      patron.waiting = false;
      this.releasePatronSlot(patron);
      this.releaseTile(patron.grid);
      patron.refreshStatusLabel();
      release();
      this.persistLayout();
      this.game.events.emit('stats-updated', this.getHudState());
      this.game.events.emit('inventory-updated');
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
        (drink.id === 'cerveza'
          ? drink.serveTimeMs
          : drink.serveTimeMs * (1 - (staff.skill / 200) * 0.3)) * slowServeFactor(staff.profile.id);
      // Cerveza has a pour animation for Luna / Nova; other drinks keep the idle animation
      if (!(drink.id === 'cerveza' && staff.playServeBeerAnim())) staff.startBob();
      this.time.delayedCall(prepareMs, completeServe);
    };

    const claimServeSpot = (): boolean => {
      if (atTap) {
        if (this.tapSpotHolderId && this.tapSpotHolderId !== staff.profile.id) return false;
        this.tapSpotHolderId = staff.profile.id;
        this.claimStaffTile(staff, spot);
        return true;
      }
      return this.claimBarSpot(staff, spot);
    };

    const goToBarAndServe = () => {
      if (!mine()) return;
      if (patronGone()) {
        release();
        return;
      }
      if (!claimServeSpot()) {
        // Someone else is pouring: wait beside the service point until the spot frees up
        const wait = this.findStaffWaitNearBar(staff, spot);
        this.claimStaffTile(staff, wait);
        const poll = () => {
          if (!mine()) return;
          if (patronGone()) {
            release();
            return;
          }
          if (!claimServeSpot()) {
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


  /** Day start / after Dormir: hide staff, roll arrival ~17:05 ± jitter. */
  private beginDayStaffHidden(): void {
    this.staffPresent = false;
    const base =
      PRE_OPEN_HOUR * 60 +
      PRE_OPEN_MINUTE +
      STAFF_ARRIVE_GAME_MINUTES_AFTER_DAY_START;
    const jit = Math.max(0, STAFF_ARRIVE_JITTER_GAME_MINUTES);
    const delta = jit > 0 ? Phaser.Math.Between(-jit, jit) : 0;
    this.staffArriveTotalMinutes = base + delta;
    for (const s of this.allStaff()) {
      if (!s) continue;
      this.interruptStaff(s);
      s.clearServeLabel();
      s.state = 'idle';
      s.setVisible(false);
      s.stopBob();
    }
    this.floorClaim.clear();
  }

  /** Show staff when clock hits arrival (or Abrir early). Optional walk-in from door. */
  private revealStaffForShift(fromDoor: boolean): void {
    if (this.staffPresent) return;
    this.staffPresent = true;
    this.staffShiftStartAt = this.time.now;
    const door = {
      col: this.scenario.spawnTile[0],
      row: this.scenario.spawnTile[1],
    };
    const staff = this.allStaff();
    staff.forEach((s, i) => {
      if (!s) return;
      const home = this.findFloorStaffSpawnTile();
      if (fromDoor) {
        s.snapTo(door);
        s.setVisible(true);
        s.setAlpha(1);
        s.state = 'walking';
        s.startBob();
        const goal = this.findFreeStaffGoal(s, home) ?? home;
        // Stagger slightly so they don't stack.
        const delay = i * 120;
        this.time.delayedCall(delay, () => {
          if (!s.active) return;
          s.walkTo(goal, () => {
            s.state = 'idle';
            s.startBob();
            if (s === this.bartender) this.syncBartenderBarDepth();
          });
        });
      } else {
        s.snapTo(home);
        s.setVisible(true);
        s.setAlpha(1);
        s.state = 'idle';
        s.startBob();
      }
    });
    this.syncBartenderBarDepth();
    this.game.events.emit('stats-updated', this.getHudState());
  }

  /** While CLOSED: reveal staff when game clock reaches staffArriveTotalMinutes. */
  private checkStaffArrivalFromClock(): void {
    if (this.staffPresent) return;
    if (getShiftState() !== 'closed') return;
    const snap = getShiftSnapshot();
    const nowMin = snap.gameHour * 60 + snap.gameMinute;
    // Handle wrap past midnight (unlikely in prep, but safe).
    const arrive = this.staffArriveTotalMinutes;
    if (nowMin >= arrive || (snap.gameHour < PRE_OPEN_HOUR && nowMin + 24 * 60 >= arrive)) {
      this.revealStaffForShift(true);
    }
  }

  private refreshFloorDirtVisuals(): void {
    const keep = new Set<string>();
    for (const z of getFloorZones()) {
      keep.add(z.id);
      const intensity = Math.max(z.dryDirt, z.grime) / 100;
      let g = this.floorDirtGfx.get(z.id);
      if (intensity < 0.12) {
        if (g) {
          g.destroy();
          this.floorDirtGfx.delete(z.id);
        }
        continue;
      }
      const c = floorZoneCenter(z);
      const scr = tileToScreen(c.col, c.row, this.iso);
      const alpha =
        FLOOR_VISUAL.alphaMin +
        (FLOOR_VISUAL.alphaMax - FLOOR_VISUAL.alphaMin) * Math.min(1, intensity);
      if (!g) {
        g = this.add.ellipse(scr.x, scr.y + 6, 48, 24, FLOOR_VISUAL.color, alpha);
        g.setDepth(FLOOR_VISUAL.depth);
        this.floorDirtGfx.set(z.id, g);
      } else {
        g.setPosition(scr.x, scr.y + 6);
        g.setFillStyle(FLOOR_VISUAL.color, alpha);
      }
    }
    for (const [id, g] of [...this.floorDirtGfx.entries()]) {
      if (!keep.has(id)) {
        g.destroy();
        this.floorDirtGfx.delete(id);
      }
    }
  }

  private beginAiSweep(staff: Bartender, z: FloorZone): void {
    if (this.floorClaim.has(z.id) && this.floorClaim.get(z.id) !== staff.profile.id) {
      staff.aiNextThinkAt = this.time.now + 700;
      return;
    }
    const center = floorZoneCenter(z);
    const goal =
      this.findFreeStaffGoal(staff, center) ??
      (this.pathfinder.isWalkable(center.col, center.row) ? center : null);
    if (!goal) {
      staff.aiNextThinkAt = this.time.now + 900;
      return;
    }
    this.floorClaim.set(z.id, staff.profile.id);
    staff.aiJob = 'sweep';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.setServeLabel('Barriendo');
    this.claimStaffTile(staff, goal);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    const release = () => {
      if (this.floorClaim.get(z.id) === staff.profile.id) this.floorClaim.delete(z.id);
      this.releaseStaffTileClaims(staff);
      staff.clearServeLabel();
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
    };

    const finish = () => {
      staff.stopBob();
      staff.setServeLabel('Barriendo');
      this.playStaffActionTween(
        staff,
        () => {
          applySweep(z);
          this.refreshFloorDirtVisuals();
          staff.profile.energy = Math.max(
            0,
            staff.profile.energy -
              Phaser.Math.Between(FLOOR_JOB_ENERGY.min, FLOOR_JOB_ENERGY.max)
          );
          staff.aiNextThinkAt = this.time.now + Phaser.Math.Between(4000, 7000);
          release();
          this.showStatusFloat('Barrió el piso', { x: staff.x, y: staff.y });
          this.game.events.emit('stats-updated', this.getHudState());
          this.emitStaffRoster();
        },
        SWEEP_DURATION_MS
      );
    };
    const ok = staff.walkTo(goal, finish);
    if (!ok) finish();
  }

  private beginAiMop(staff: Bartender, z: FloorZone): void {
    if (this.floorClaim.has(z.id) && this.floorClaim.get(z.id) !== staff.profile.id) {
      staff.aiNextThinkAt = this.time.now + 700;
      return;
    }
    const center = floorZoneCenter(z);
    const goal =
      this.findFreeStaffGoal(staff, center) ??
      (this.pathfinder.isWalkable(center.col, center.row) ? center : null);
    if (!goal) {
      staff.aiNextThinkAt = this.time.now + 900;
      return;
    }
    this.floorClaim.set(z.id, staff.profile.id);
    staff.aiJob = 'mop';
    staff.playerCommanded = false;
    staff.state = 'busy';
    staff.setServeLabel('Trapeando');
    this.claimStaffTile(staff, goal);
    this.game.events.emit('stats-updated', this.getHudState());
    this.emitStaffRoster();

    const release = () => {
      if (this.floorClaim.get(z.id) === staff.profile.id) this.floorClaim.delete(z.id);
      this.releaseStaffTileClaims(staff);
      staff.clearServeLabel();
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
    };

    const finish = () => {
      staff.stopBob();
      staff.setServeLabel('Trapeando');
      this.playStaffActionTween(
        staff,
        () => {
          applyMop(z);
          this.refreshFloorDirtVisuals();
          staff.profile.energy = Math.max(
            0,
            staff.profile.energy -
              Phaser.Math.Between(FLOOR_JOB_ENERGY.min, FLOOR_JOB_ENERGY.max)
          );
          staff.aiNextThinkAt = this.time.now + Phaser.Math.Between(4000, 7000);
          release();
          this.showStatusFloat('Trapéó el piso', { x: staff.x, y: staff.y });
          this.game.events.emit('stats-updated', this.getHudState());
          this.emitStaffRoster();
        },
        MOP_DURATION_MS
      );
    };
    const ok = staff.walkTo(goal, finish);
    if (!ok) finish();
  }

  /** Test/debug: floor dirt zones. */
  getFloorDirtDebug() {
    return readFloorDirtDebug();
  }

  /** Test/debug: day-start staff arrival. */
  getStaffArrivalDebug() {
    const snap = getShiftSnapshot();
    return {
      staffPresent: this.staffPresent,
      staffArriveTotalMinutes: this.staffArriveTotalMinutes,
      staffArriveHHMM: formatGameClock(
        Math.floor(this.staffArriveTotalMinutes / 60) % 24,
        this.staffArriveTotalMinutes % 60
      ),
      clockHHMM: formatGameClock(snap.gameHour, snap.gameMinute),
      visibleStaff: this.allStaff().filter((s) => s.visible).map((s) => s.displayName),
      overlayAlpha: this.lightsOverlay?.alpha ?? null,
      lastNightUsed: this.lastNightUsed,
    };
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
          // Prompt A Phase 2: close dirt episode so new clients aren't penalised for old dirt.
          markItemCleaned(def.id);
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
    const restTok = npc.jobToken;
    npc.walkTo(restGoal, () => {
      if (npc.jobToken !== restTok) return;
      npc.state = 'resting';
      npc.stopBob();
      const dur = npc.profile.restDurationMs;
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
      this.time.delayedCall(dur, () => {
        if (npc.jobToken !== restTok) return;
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
    // Day-start: no AI until staff have arrived (or Abrir forced reveal).
    if (!this.staffPresent) return;
    const now = this.time.now;
    const prep = this.phase === 'prep' && getShiftState() === 'closed';

    // Priority 1 — Atender: only while OPEN (never during prep)
    const waiting = this.phase === 'open' ? this.waitingBarPatrons() : [];
    for (const patron of waiting) this.tryAssignServeAi(patron);
    // Urgent work (#2) outranks idle wandering (#4) at once, and routine upkeep (#3) once a
    // customer has waited a while. Player orders (#1) are never preempted.
    if (this.phase === 'open') {
      for (const patron of this.waitingBarPatrons()) {
        const waitedMs = patron.waitSince ? now - patron.waitSince : 0;
        const pre = this.allStaff().find(
          (st) =>
            !st.playerCommanded &&
            st.visible &&
            st.profile.energy >= st.profile.energyDrainPerServe &&
            (st.aiJob === 'wander' ||
              (waitedMs >= URGENT_PREEMPT_MS && (st.aiJob === 'clean' || st.aiJob === 'sweep' || st.aiJob === 'mop')))
        );
        if (!pre) break;
        this.interruptStaff(pre);
        this.tryAssignServeAi(patron);
      }
    }

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

      // 1) Limpiar muebles — ANY furniture with cleanliness < threshold
      const dirty = this.findDirtiestFurniture(AI_TUNABLES.cleanThreshold);
      if (dirty && !this.cleanClaim.has(dirty.id)) {
        this.beginAiCleanFurniture(staff, dirty);
        continue;
      }

      // 1b) Barrer / trapear piso (prep priority; also OK while open if idle)
      const claimed = new Set(this.floorClaim.keys());
      const sweepZ = findDirtiestSweepZone(claimed);
      if (sweepZ) {
        this.beginAiSweep(staff, sweepZ);
        continue;
      }
      const mopZ = findDirtiestMopZone(claimed);
      if (mopZ) {
        this.beginAiMop(staff, mopZ);
        continue;
      }

      // 2) Descansar — low energy (skip forced rest spam during short prep)
      if (staff.profile.energy < AI_TUNABLES.restEnergyThreshold) {
        this.beginStaffRest(staff, false);
        continue;
      }

      // 2b) Idle: she may buy herself something (own money, real stock, personality).
      if (this.tryAutoConsume(staff)) continue;

      // 3) Prep: idle wait (no purposeless wander). Open: wander as before.
      if (prep) {
        staff.aiNextThinkAt = now + Phaser.Math.Between(2000, 4000);
      } else if (Math.random() < 0.55) {
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
    // AI runs in prep (after staff arrive) + open; serve only when open.
    if (!this.buildMode) this.tickStaffAi();
    const dtSec = dt / 1000;
    // Intervention layer ticks (cheap; each self-throttles).
    if (this.staffPresent) {
      const nowMs = this.time.now;
      for (const s of this.allStaff()) tickStaffNeeds(s.profile.id, s.profile, dtSec, nowMs);
    }
    this.tickRepairs();
    if (!this.buildMode && (this.phase === 'open' || this.phase === 'prep')) {
      this.tickServedItems(dt);
      this.tickFlies(dt);
    }
    if (!this.buildMode && (this.phase === 'open' || this.phase === 'prep')) {
      this.tickFurnitureDecay(dtSec);
    }
    const shiftNow = getShiftState();

    // Day-start correction: clock ticks while CLOSED (and OPEN/CLOSING). Not SUMMARY.
    if (shiftNow === 'closed' || shiftNow === 'open' || shiftNow === 'closing') {
      const minutesAdvanced = tickShiftClock(dtSec);
      if (minutesAdvanced > 0) {
        this.game.events.emit('stats-updated', this.getHudState());
        if (shiftNow === 'closed') {
          this.checkStaffArrivalFromClock();
        }
        if (shiftNow === 'open') {
          this.processArrivalsForAdvancedMinutes(minutesAdvanced);
        }
      }
    }

    if (shiftNow === 'closed' || (this.phase !== 'open' && shiftNow !== 'closing')) {
      // Prep / summary: no patrons / competition / closing logic.
      return;
    }
    // Prompt B Phase B7: no nightTimer auto-close. Clock may pass 02:00.

    if (shiftNow === 'closing') {
      this.tickClosing();
    }

    // Phase 6: periodic peer observation (gradual competitiveness)
    this.competitionObserveAccum += dt;
    if (this.competitionObserveAccum >= OBSERVE_INTERVAL_MS) {
      this.competitionObserveAccum = 0;
      const presentIds = this.allStaff().map((s) => s.profile.id);
      observeCompetition(presentIds);
    }

    // Prompt A Phase 2: low-rate proximity perception of visibly dirty furniture.
    this.perceptionAccum += dt;
    if (this.perceptionAccum >= PERCEPTION_INTERVAL_MS) {
      this.perceptionAccum = 0;
      for (const p of this.patrons) {
        if (!p.active) continue;
        this.perceiveNearbyDirt(p);
        this.perceiveInterventionEvents(p);
      }
    }

    for (const patron of [...this.patrons]) {
      if (!patron.active) continue;
      // Wait tracking for "¡Eso fue rápido!" / "¿Cuánto falta…?" (real experience only).
      if (patron.waiting && !patron.served) {
        if (!patron.waitSince) patron.waitSince = this.time.now;
      } else if (!patron.waiting) {
        patron.waitSince = 0;
      }
      if (patron.impatient && !this.patronWasImpatient.has(patron)) {
        this.patronWasImpatient.add(patron);
        const d = applyPerceivedExperience(patron, 'long_wait', THOUGHT_SAT.longWait, 'tolerance', 'Espera larga');
        if (d != null) this.patronThink(patron, 'long_wait');
      }
      // The bar broke / was removed while they queued: give up on the drink
      if (
        (patron.goal === 'bar' || patron.goal === 'beer_tap') &&
        patron.waiting &&
        !patron.served &&
        (patron.goal === 'beer_tap' ? !this.activeBeerTap() : !this.activeBar())
      ) {
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

  }


  private loadShopCatalog(): void {
    if (this.shopCatalog.length) return;
    const raw = this.cache.json.get('shop_furniture') as ShopFurnitureFile | undefined;
    const items = Array.isArray(raw?.items) ? raw!.items : [];
    this.shopCatalog = items;
    this.shopCatalogById.clear();
    for (const it of items) this.shopCatalogById.set(it.id, it);
    // Placeholders for catalog entries without final art (safe if BootScene already made them).
    try {
      ensureShopPlaceholders(
        this,
        items.map((it) => ({
          sprite: it.sprite,
          name: it.name,
          placeholderColor: it.placeholderColor,
        }))
      );
    } catch {
      /* ignore */
    }
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
      const durBefore = st.durability;
      // Dirt snowballs: already-dirty pieces decay faster (stains escalate)
      const boost =
        before < DIRT_VISUAL_THRESHOLD ? AI_TUNABLES.dirtyDecayBoost : before < 75 ? 1.2 : 1;
      applyDecay(st, dtSec * boost, this.furniturePrice(f));
      this.writeStatsToDef(f, st);
      if (f.repairCount) this.applyRepairAftereffects(f, durBefore, dtSec);
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
      repairStatus: (() => {
        const job = this.repairJobFor(def.id);
        return job ? this.repairStageLabel(job) : undefined;
      })(),
      repairCount: def.repairCount ?? 0,
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


  // ═══════════════════════════════════════════════════════════════════════════════════════
  // Direct intervention layer (right-click orders, compliance, repairs, staff consumption,
  // served mugs/plates + spoilage, flies, customer thoughts). Extends the existing jobs,
  // claims, inventory, satisfaction and affinity systems — nothing here is a parallel copy.
  // ═══════════════════════════════════════════════════════════════════════════════════════

  private lastSelectedStaffId: string | null = null;
  private longPressTimer?: Phaser.Time.TimerEvent;
  private longPressFired = false;
  private servedGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private servedTickAccum = 0;
  private repairJobs: RepairJob[] = [];
  private repairSeq = 0;
  private flyZones = new Map<string, FlyZoneState>();
  private flyTickAccum = 0;
  private staffShiftStartAt = 0;
  private patronSpawnAt = new WeakMap<Patron, number>();
  private patronWasImpatient = new WeakSet<Patron>();
  private patronDecorRolled = new WeakMap<Patron, Set<string>>();
  private patronSparkRolled = new WeakMap<Patron, Set<string>>();
  private orderLog: Array<{ at: number; staff: string; action: string; outcome: string }> = [];
  private ctxLast: { staffId: string; target: CtxTarget; x: number; y: number } | null = null;
  private staffSayText = new Map<string, Phaser.GameObjects.Text>();

  private registerInterventionEvents(): void {
    const ev = this.game.events;
    ev.on('cmd-staff-action', this.onCmdStaffAction, this);
    ev.on('cmd-context-menu-staff', this.onCmdContextMenuStaff, this);
    ev.on('cmd-open-furniture-actions', this.onCmdOpenFurnitureActions, this);
    ev.on('cmd-hire-technician', this.onCmdHireTechnician, this);
    ev.on('cmd-repair-decision', this.onCmdRepairDecision, this);
    this.events.once('shutdown', () => {
      ev.off('cmd-staff-action', this.onCmdStaffAction, this);
      ev.off('cmd-context-menu-staff', this.onCmdContextMenuStaff, this);
      ev.off('cmd-open-furniture-actions', this.onCmdOpenFurnitureActions, this);
      ev.off('cmd-hire-technician', this.onCmdHireTechnician, this);
      ev.off('cmd-repair-decision', this.onCmdRepairDecision, this);
    });
  }

  private uiToast(msg: string): void {
    this.game.events.emit('ui-toast', msg);
  }

  /** Short speech line above a staff member (+ toast so it's never missed). */
  private staffSay(staff: Bartender, text: string, toast = true): void {
    const prev = this.staffSayText.get(staff.profile.id);
    if (prev) prev.destroy();
    const t = this.add
      .text(staff.x, staff.y - 120, `“${text}”`, {
        fontSize: '12px',
        color: '#fff2c4',
        backgroundColor: '#2a1238dd',
        padding: { x: 6, y: 3 },
        stroke: '#1a0a22',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(9000);
    this.staffSayText.set(staff.profile.id, t);
    this.tweens.add({
      targets: t,
      y: t.y - 14,
      alpha: { from: 1, to: 0 },
      delay: 2000,
      duration: 700,
      onComplete: () => {
        t.destroy();
        if (this.staffSayText.get(staff.profile.id) === t) this.staffSayText.delete(staff.profile.id);
      },
    });
    if (toast) this.uiToast(`${staff.displayName}: “${text}”`);
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
  }

  private randBetween(range: readonly [number, number]): number {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Stop whatever a staff member is doing (AI or previous order) so a new order can take over.
   * Bumps jobToken so every pending callback of the old job bails out.
   */
  private interruptStaff(staff: Bartender): void {
    staff.jobToken++;
    this.releaseStaffAiClaims(staff);
    for (const [zid, sid] of [...this.floorClaim.entries()]) {
      if (sid === staff.profile.id) this.floorClaim.delete(zid);
    }
    staff.cancelWalk();
    if (staff.actionTweenBase) {
      this.tweens.killTweensOf(staff.sprite);
      const b = staff.actionTweenBase;
      staff.sprite.y = b.y;
      staff.sprite.setScale(b.sx, b.sy);
      staff.reapplyDisplaySize();
      staff.actionTweenBase = null;
    }
    staff.clearAiJob();
    staff.state = 'idle';
    if (staff.visible) staff.startBob();
  }

  // ─── Input: right-click / long-press on world ───────────────────────────────────────────

  private selectedStaff(): Bartender | null {
    return this.selectedNpcId ? this.findStaffById(this.selectedNpcId) : null;
  }

  /** UIScene consumed this right-click to close a window → don't also open a menu. */
  private uiConsumedRightClick(p: Phaser.Input.Pointer): boolean {
    const ui = this.scene.get('UIScene') as Phaser.Scene & { lastRightDismissDownTime?: number };
    return !!ui && ui.lastRightDismissDownTime === p.downTime;
  }

  private handleWorldRightClick(p: Phaser.Input.Pointer): void {
    if (this.buildMode) return;
    const staff = this.selectedStaff();
    if (!staff) return;
    if (!this.staffPresent || !staff.visible) {
      this.uiToast('El personal todavía no llega.');
      return;
    }
    const furnId = this.furnitureIdAtPointer(p);
    if (furnId) {
      this.openContextMenu(staff, { kind: 'furniture', id: furnId }, p.x, p.y);
      return;
    }
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const tile = screenToTile(world.x, world.y, this.iso);
    const z = zoneContaining(tile.col, tile.row);
    if (z) this.openContextMenu(staff, { kind: 'floor', id: z.id }, p.x, p.y);
  }

  private startLongPress(p: Phaser.Input.Pointer): void {
    this.longPressTimer?.remove(false);
    this.longPressFired = false;
    if (!p.wasTouch || this.buildMode || !this.selectedStaff()) return;
    this.longPressTimer = this.time.delayedCall(520, () => {
      if (!p.isDown || this.panDragging || this.pinching || p.getDistance() > TAP_THRESH) return;
      if (this.isPointerOverHud(p)) return;
      this.longPressFired = true;
      this.handleWorldRightClick(p);
    });
  }

  private onCmdOpenFurnitureActions = (payload: { furnitureId: string }): void => {
    if (this.buildMode || !payload?.furnitureId) return;
    const staff =
      this.selectedStaff() ??
      (this.lastSelectedStaffId ? this.findStaffById(this.lastSelectedStaffId) : null) ??
      this.allStaff().find((s) => s.visible) ??
      null;
    if (!staff || !this.staffPresent) {
      this.uiToast('El personal todavía no llega.');
      return;
    }
    const cam = this.cameras.main;
    this.openContextMenu(staff, { kind: 'furniture', id: payload.furnitureId }, cam.width / 2, cam.height / 2);
  };

  private onCmdContextMenuStaff = (payload: { staffId: string }): void => {
    const staff = payload?.staffId ? this.findStaffById(payload.staffId) : null;
    if (!staff || !this.ctxLast) return;
    this.selectNpcStaff(staff.profile.id);
    this.openContextMenu(staff, this.ctxLast.target, this.ctxLast.x, this.ctxLast.y);
  };

  private openContextMenu(staff: Bartender, target: CtxTarget, x: number, y: number): void {
    const built = this.buildContextActions(staff, target);
    if (!built) return;
    this.ctxLast = { staffId: staff.profile.id, target, x, y };
    this.game.events.emit('context-menu-open', {
      staffId: staff.profile.id,
      staffName: staff.displayName,
      staffOptions: this.allStaff()
        .filter((s) => s.visible)
        .map((s) => ({ id: s.profile.id, name: s.displayName })),
      target,
      title: built.title,
      subtitle: built.subtitle,
      actions: built.actions,
      x,
      y,
    } as ContextMenuPayload);
  }

  private unclaimedWaiting(goal: 'bar' | 'beer_tap'): Patron | null {
    return this.waitingBarPatrons().find((p) => p.goal === goal) ?? null;
  }

  private isBreakable(def: FurnitureDef): boolean {
    const cid = (def.catalogId || def.type || '').toLowerCase();
    if (NON_BREAKABLE_IDS.has(cid)) return false;
    const fn = this.shopCatalogById.get(cid)?.function ?? '';
    if (NON_BREAKABLE_FUNCTIONS.has(fn)) return false;
    return true;
  }

  private furnitureFunction(def: FurnitureDef): string {
    const cid = (def.catalogId || def.type || '').toLowerCase();
    return this.shopCatalogById.get(cid)?.function ?? (def.type === 'bar' ? 'service_bar' : 'seating');
  }

  private isBeerTapDef(def: FurnitureDef): boolean {
    const cid = (def.catalogId || def.type || '').toLowerCase();
    return cid === BEER_TAP_CATALOG_ID || def.type === 'beer_tap';
  }

  private isBarDef(def: FurnitureDef): boolean {
    return def.type === 'bar' || def.catalogId === 'bar';
  }

  private servedSpotFor(def: FurnitureDef): string {
    if (this.isBeerTapDef(def)) return `tap:${def.id}`;
    if (this.isBarDef(def)) return `bar:${def.id}`;
    return `table:${def.id}`;
  }

  private productName(pid: string): string {
    return getDrinkProduct(pid)?.name ?? getSnackProduct(pid)?.name ?? pid;
  }

  /** Context actions = capabilities of THIS object for THIS staff right now (never a universal list). */
  private buildContextActions(
    staff: Bartender,
    target: CtxTarget
  ): { title: string; subtitle: string; actions: CtxAction[] } | null {
    const name = staff.displayName;
    const actions: CtxAction[] = [];
    const add = (id: string, label: string, enabled = true, hint?: string) =>
      actions.push({ id, label, enabled, hint });
    const wallet = getWallet(staff.profile.id);
    const consumeOpt = (pid: string, verb: string) => {
      if (!CONSUMABLE_EFFECTS[pid] || !inventoryCanSell(pid)) return;
      const price = inventoryGetPrice(pid);
      const ok = wallet >= price;
      add(`drink:${pid}`, `${verb} ${this.productName(pid).toLowerCase()} ($${price})`, ok, ok ? undefined : 'Sin dinero');
    };

    if (target.kind === 'floor') {
      const z = getFloorZoneById(target.id);
      if (!z) return null;
      if (z.dryDirt >= 8) add(`sweep:${z.id}`, 'Barrer');
      if (z.grime >= 8) add(`mop:${z.id}`, 'Trapear');
      if (!actions.length) add('noop', 'Barrer', false, 'El piso está limpio');
      const flies = this.flyZones.get(z.id)?.active;
      const band = floorDirtBand(z);
      const bandEs: Record<string, string> = { clean: 'Limpio', slight: 'Algo sucio', dirty: 'Sucio', very_dirty: 'Muy sucio' };
      return {
        title: `${name} → Piso`,
        subtitle: `${bandEs[band] ?? band}${flies ? ' · Hay moscas' : ''}`,
        actions,
      };
    }

    const def = this.getFurnitureDef(target.id);
    if (!def) return null;
    const st = this.statsOf(def);
    const cond = conditionFromDurability(st.durability, st.maxDurability);
    const functional = cond !== 'Inservible' && st.durability > 0;
    const furnName = this.furnitureDisplayName(def);
    const isTap = this.isBeerTapDef(def);
    const isBar = this.isBarDef(def);
    const isTable = this.isTableFurniture(def);

    if (isTap) {
      if (!functional) add('serve_beer', 'Servir cerveza', false, 'Está averiado');
      else if (!inventoryCanSell(BEER_TAP_DRINK_ID)) add('serve_beer', 'Servir cerveza', false, 'Sin cerveza');
      else {
        const waiting = this.unclaimedWaiting('beer_tap');
        const room = canAddServed(`tap:${def.id}`);
        add(
          'serve_beer',
          waiting ? `Servir cerveza a ${waiting.displayName}` : 'Servir cerveza',
          !!waiting || room,
          waiting || room ? undefined : 'Ya hay tarros servidos'
        );
        consumeOpt('cerveza', 'Beber');
      }
    }
    if (isBar) {
      if (!functional) add('serve_patron', 'Atender', false, 'Está averiada');
      else {
        const w = this.unclaimedWaiting('bar');
        if (w) add('serve_patron', `Atender a ${w.displayName}`);
        if (!this.activeBeerTap() && inventoryCanSell(BEER_TAP_DRINK_ID)) {
          const room = canAddServed(`bar:${def.id}`);
          add('serve_beer_bar', 'Servir cerveza', room, room ? undefined : 'Ya hay tarros servidos');
        }
        for (const pid of BAR_STAFF_DRINKS) consumeOpt(pid, 'Beber');
      }
    }
    if (isTable && functional && this.hasFunctionalTable()) {
      const stock = inventoryCanSell('botanas');
      const room = canAddServed(`table:${def.id}`);
      add(
        'prep_snack',
        'Preparar botanas',
        stock && room,
        !stock ? 'Sin botanas' : !room ? 'Ya hay platos servidos' : undefined
      );
      consumeOpt('botanas', 'Comer');
    }
    const now = this.time.now;
    const old = servedItemsAt(this.servedSpotFor(def)).filter((i) => servedStateOf(i, now) !== 'fresh');
    if (old.length) {
      const what = old.every((i) => i.productId === 'botanas') ? 'platos' : 'tarros';
      add('collect', `Retirar ${old.length} ${what} viejos`);
    }
    const needsClean = st.cleanliness < st.maxCleanliness * 0.95;
    add('clean', 'Limpiar', needsClean, needsClean ? undefined : 'Ya está limpio');
    add('inspect', 'Revisar');
    if (this.isBreakable(def) && cond !== 'Óptimo') {
      const job = this.repairJobFor(def.id);
      add('repair', 'Reparar', !job, job ? this.repairStageLabel(job) : undefined);
    }
    const job = this.repairJobFor(def.id);
    return {
      title: `${name} → ${furnName}`,
      subtitle: `${cond} · Limpieza ${Math.round((st.cleanliness / Math.max(1, st.maxCleanliness)) * 100)}%${
        job ? ` · ${this.repairStageLabel(job)}` : ''
      }`,
      actions,
    };
  }

  // ─── Orders: priority #1, compliance exception, execution ───────────────────────────────

  private onCmdStaffAction = (payload: { staffId: string; target: CtxTarget; actionId: string }): void => {
    if (!payload) return;
    const staff = this.findStaffById(payload.staffId);
    if (!staff) return;
    this.issuePlayerOrder(staff, payload.target, payload.actionId);
  };

  private logOrder(staff: Bartender, action: string, outcome: string): void {
    this.orderLog.push({ at: Math.round(this.time.now), staff: staff.profile.id, action, outcome });
    if (this.orderLog.length > 40) this.orderLog.shift();
  }

  /** Player order: always obeyed at normal levels; only an exhausted / fed-up / very drunk staff may not. */
  issuePlayerOrder(staff: Bartender, target: CtxTarget, actionId: string): string {
    if (this.buildMode || !this.staffPresent || !staff.visible || actionId === 'noop') return 'ignored';
    const outcome = rollCompliance(staff.profile.id, staff.profile.energy, staff.profile.mood);
    const drunk = intoxOf(staff.profile.id) >= ORDER_COMPLIANCE.extremeIntox;
    if (outcome === 'refuse') {
      this.staffSay(staff, this.pick(drunk ? DRUNK_REFUSE_LINES : REFUSE_LINES));
      this.logOrder(staff, actionId, 'refuse');
      // At her limit she may go rest on her own (AI rest — not an order).
      if (
        Math.random() < ORDER_COMPLIANCE.restAfterRefuse &&
        staff.state !== 'resting' &&
        staff.aiJob !== 'rest' &&
        staff.aiJob !== 'serve'
      ) {
        this.interruptStaff(staff);
        this.beginStaffRest(staff, false);
      }
      return 'refuse';
    }
    if (outcome === 'delay') {
      this.staffSay(staff, this.pick(DELAY_LINES));
      this.logOrder(staff, actionId, 'delay');
      const tok = staff.jobToken;
      this.time.delayedCall(this.randBetween(ORDER_COMPLIANCE.delayMs), () => {
        if (staff.jobToken !== tok || !staff.active) return;
        this.executeOrder(staff, target, actionId, false);
      });
      return 'delay';
    }
    const ok = this.executeOrder(staff, target, actionId, outcome === 'abandon');
    this.logOrder(staff, actionId, ok ? outcome : 'failed');
    return ok ? outcome : 'failed';
  }

  private executeOrder(staff: Bartender, target: CtxTarget, actionId: string, abandon: boolean): boolean {
    const def = target.kind === 'furniture' ? this.getFurnitureDef(target.id) : null;
    const [verb, arg] = actionId.split(':');
    // Validate BEFORE interrupting so an impossible order doesn't wreck her current job.
    if (target.kind === 'furniture' && !def) return false;
    // Someone else already on it: a player order outranks her autonomous job (she goes back to
    // her own AI); only another *player-ordered* job blocks it.
    const takeOver = (claim: Map<string, string>, key: string, busyMsg: string): boolean => {
      const otherId = claim.get(key);
      if (!otherId || otherId === staff.profile.id) return true;
      const other = this.findStaffById(otherId);
      if (other && other.playerCommanded) {
        this.uiToast(`${other.displayName} ${busyMsg}`);
        return false;
      }
      if (other) this.interruptStaff(other);
      claim.delete(key);
      return true;
    };
    if (verb === 'clean' && def && !takeOver(this.cleanClaim, def.id, 'ya lo está limpiando.')) return false;
    if ((verb === 'sweep' || verb === 'mop') && arg && !takeOver(this.floorClaim, arg, 'ya está en esa zona.')) return false;
    this.interruptStaff(staff);
    const tok = staff.jobToken;
    let started = false;
    switch (verb) {
      case 'serve_patron': {
        const p = this.unclaimedWaiting('bar');
        started = !!p && this.beginAiServe(staff, p);
        if (!p) this.uiToast('No hay nadie esperando en la barra.');
        break;
      }
      case 'serve_beer': {
        const p = this.unclaimedWaiting('beer_tap');
        if (p) started = this.beginAiServe(staff, p);
        else if (def) started = this.beginPourMug(staff, 'tap', def);
        break;
      }
      case 'serve_beer_bar':
        if (def) started = this.beginPourMug(staff, 'bar', def);
        break;
      case 'clean':
        if (def) {
          this.beginAiCleanFurniture(staff, def);
          started = staff.aiJob === 'clean';
        }
        break;
      case 'sweep':
      case 'mop': {
        const z = arg ? getFloorZoneById(arg) : null;
        if (z) {
          if (verb === 'sweep') this.beginAiSweep(staff, z);
          else this.beginAiMop(staff, z);
          started = staff.aiJob === verb;
        }
        break;
      }
      case 'inspect':
        if (def) started = this.beginStaffInspect(staff, def);
        break;
      case 'repair':
        if (def) started = this.beginRepairRequest(staff, def);
        break;
      case 'drink':
        if (arg) started = this.beginStaffConsume(staff, arg, true, def);
        break;
      case 'prep_snack':
        if (def) started = this.beginPrepSnack(staff, def);
        break;
      case 'collect':
        if (def) started = this.beginCollectServed(staff, def);
        break;
      default:
        break;
    }
    if (!started) {
      staff.aiNextThinkAt = this.time.now + 600;
      this.emitStaffRoster();
      return false;
    }
    // Player order outranks AI: tickStaffAi / tryAssignServeAi skip playerCommanded staff.
    staff.playerCommanded = true;
    this.emitStaffRoster();
    this.game.events.emit('stats-updated', this.getHudState());
    if (abandon) {
      this.time.delayedCall(Phaser.Math.Between(1800, 4200), () => {
        if (staff.jobToken !== tok || staff.aiJob === 'none') return;
        this.interruptStaff(staff);
        this.staffSay(staff, this.pick(ABANDON_LINES));
        this.logOrder(staff, actionId, 'abandoned');
        if (Math.random() < ORDER_COMPLIANCE.restAfterRefuse) this.beginStaffRest(staff, false);
        else staff.aiNextThinkAt = this.time.now + 2500;
        this.emitStaffRoster();
      });
    }
    return true;
  }

  /** Generic: walk next to a piece, short action animation, then `onDone` (guarded by jobToken). */
  private beginStaffFurnitureTask(
    staff: Bartender,
    def: FurnitureDef,
    label: string,
    ms: number,
    onDone: () => void
  ): boolean {
    const adj = this.findAdjacentWalkable(def, staff);
    if (!adj) {
      this.staffSay(staff, 'No puedo llegar ahí.');
      return false;
    }
    const tok = staff.jobToken;
    staff.aiJob = 'player';
    staff.playerCommanded = true;
    staff.state = 'busy';
    staff.setServeLabel(label);
    this.claimStaffTile(staff, adj);
    const act = () => {
      if (staff.jobToken !== tok) return;
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      staff.faceToward({ col: def.tile[0], row: def.tile[1] });
      staff.setServeLabel(label);
      this.playStaffActionTween(
        staff,
        () => {
          this.releaseStaffTileClaims(staff);
          staff.clearAiJob();
          staff.state = 'idle';
          staff.startBob();
          staff.aiNextThinkAt = this.time.now + 1200;
          onDone();
          this.game.events.emit('stats-updated', this.getHudState());
          this.emitStaffRoster();
        },
        ms
      );
    };
    if (!staff.walkTo(adj, act)) act();
    return true;
  }

  private beginStaffInspect(staff: Bartender, def: FurnitureDef): boolean {
    return this.beginStaffFurnitureTask(staff, def, 'Revisando', 1400, () => {
      const st = this.statsOf(def);
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      const pct = Math.round((st.durability / Math.max(1, st.maxDurability)) * 100);
      const clean = st.cleanliness < DIRT_VISUAL_THRESHOLD ? ' Necesita limpieza.' : '';
      const repaired = def.repairCount ? ` Ya lo han reparado ${def.repairCount} ${def.repairCount === 1 ? 'vez' : 'veces'}.` : '';
      const fails = cond === 'Se rompió' || cond === 'Inservible' ? ' Así ya no sirve bien.' : '';
      this.staffSay(staff, `${this.furnitureDisplayName(def)}: ${cond.toLowerCase()} (${pct}%).${fails}${clean}${repaired}`);
      this.openFurnitureInspectKeepNpc(def.id);
    });
  }

  /** Show the furniture panel without dropping the staff selection (inspection result). */
  private openFurnitureInspectKeepNpc(id: string): void {
    const def = this.getFurnitureDef(id);
    if (!def) return;
    this.inspectedFurnitureId = id;
    this.game.events.emit('select-furniture', this.buildFurnitureInspectPayload(def));
  }

  // ─── Staff consumption (paid from personal money, real inventory) ──────────────────────

  private consumeSpotFor(pid: string): FurnitureDef | null {
    if (pid === 'botanas') {
      const table = this.scenario.furniture.find((f) => this.isTableFurniture(f) && this.statsOf(f).durability > 0);
      return table ?? this.activeBar();
    }
    if (pid === BEER_TAP_DRINK_ID && this.activeBeerTap()) return this.activeBeerTap();
    return this.activeBar() ?? (pid === BEER_TAP_DRINK_ID ? this.activeBeerTap() : null);
  }

  private beginStaffConsume(staff: Bartender, pid: string, asPlayer: boolean, at?: FurnitureDef | null): boolean {
    const fx = CONSUMABLE_EFFECTS[pid];
    if (!fx) return false;
    const price = inventoryGetPrice(pid);
    if (!inventoryCanSell(pid)) {
      if (asPlayer) this.staffSay(staff, `Ya no hay ${this.productName(pid).toLowerCase()}.`);
      return false;
    }
    if (getWallet(staff.profile.id) < price) {
      if (asPlayer) this.staffSay(staff, 'No me alcanza…');
      return false;
    }
    const spot = at ?? this.consumeSpotFor(pid);
    if (!spot) return false;
    const label = fx.verb === 'comió' ? 'Comiendo' : 'Tomando algo';
    const ok = this.beginStaffFurnitureTask(staff, spot, label, 1500, () => {
      this.finishStaffConsume(staff, pid, asPlayer);
    });
    if (ok && !asPlayer) staff.playerCommanded = false;
    return ok;
  }

  private finishStaffConsume(staff: Bartender, pid: string, asPlayer: boolean): void {
    const fx = CONSUMABLE_EFFECTS[pid];
    if (!fx) return;
    const price = inventoryGetPrice(pid);
    if (!inventoryCanSell(pid)) {
      this.staffSay(staff, `Se acabó ${this.productName(pid).toLowerCase()}.`);
      return;
    }
    if (!debitWallet(staff.profile.id, price)) {
      this.staffSay(staff, 'No me alcanza…');
      return;
    }
    if (!inventoryRecordStaffUse(pid, price)) {
      creditWallet(staff.profile.id, price);
      return;
    }
    // The club is paid like any customer sale (internal consumption).
    this.money += price;
    const before = intoxLabel(staff.profile.id);
    applyConsumption(staff.profile.id, staff.profile, pid, this.time.now);
    if (!asPlayer) noteAutoConsumption(staff.profile.id, pid);
    const msg = `${staff.displayName} ${fx.verb} ${fx.phrase}.`;
    this.showStatusFloat(msg, { x: staff.x, y: staff.y });
    this.uiToast(msg);
    const after = intoxLabel(staff.profile.id);
    if (after && after !== before) {
      this.uiToast(after === 'Borracha' ? `${staff.displayName} está borracha 🥴` : `${staff.displayName} está achispada 🍻`);
    }
    this.persistLayout();
    this.game.events.emit('inventory-updated');
  }

  /** Idle priority (#4): she may buy something on her own (personality + needs + money). */
  private tryAutoConsume(staff: Bartender): boolean {
    if (this.phase !== 'open' && this.phase !== 'prep') return false;
    const shiftMin = this.staffShiftStartAt ? (this.time.now - this.staffShiftStartAt) / 1000 : 0;
    const pid = pickAutoConsumption(
      staff.profile.id,
      staff.profile,
      this.time.now,
      shiftMin,
      (id) => inventoryCanSell(id) && !!this.consumeSpotFor(id),
      (id) => inventoryGetPrice(id)
    );
    if (!pid) return false;
    return this.beginStaffConsume(staff, pid, false);
  }

  // ─── Served mugs / plates (pre-poured, spoil over time) ────────────────────────────────

  /** Walk to the tap/bar staff tile (waiting for the pour spot like serving does), then `onReady`. */
  private walkToServiceSpot(
    staff: Bartender,
    kind: 'tap' | 'bar',
    spot: { col: number; row: number },
    tok: number,
    onReady: () => void
  ): void {
    const claim = (): boolean => {
      if (kind === 'tap') {
        if (this.tapSpotHolderId && this.tapSpotHolderId !== staff.profile.id) return false;
        this.tapSpotHolderId = staff.profile.id;
        this.claimStaffTile(staff, spot);
        return true;
      }
      return this.claimBarSpot(staff, spot);
    };
    const go = () => {
      if (staff.jobToken !== tok) return;
      if (!staff.walkTo(spot, onReady)) onReady();
    };
    if (claim()) {
      go();
      return;
    }
    const wait = this.findStaffWaitNearBar(staff, spot);
    this.claimStaffTile(staff, wait);
    const poll = () => {
      if (staff.jobToken !== tok) return;
      if (!claim()) {
        this.time.delayedCall(300, poll);
        return;
      }
      go();
    };
    if (!staff.walkTo(wait, poll)) this.time.delayedCall(300, poll);
  }

  private beginPourMug(staff: Bartender, kind: 'tap' | 'bar', def: FurnitureDef): boolean {
    const spots = kind === 'tap' ? this.beerTapSpots() : this.barSpots();
    if (!spots) return false;
    const spotKey = `${kind}:${def.id}`;
    if (!canAddServed(spotKey)) {
      this.staffSay(staff, 'Ya hay varios tarros servidos.');
      return false;
    }
    if (!inventoryCanSell(BEER_TAP_DRINK_ID)) {
      this.staffSay(staff, 'Se acabó la cerveza.');
      return false;
    }
    const tok = staff.jobToken;
    staff.aiJob = 'serve';
    staff.playerCommanded = true;
    staff.state = 'busy';
    staff.servingDrinkId = BEER_TAP_DRINK_ID;
    staff.setServeLabel('Sirviendo cerveza');
    const release = () => {
      this.releaseStaffTileClaims(staff);
      staff.clearAiJob();
      staff.state = 'idle';
      staff.startBob();
      staff.aiNextThinkAt = this.time.now + 800;
      if (staff === this.bartender) this.syncBartenderBarDepth();
      this.game.events.emit('stats-updated', this.getHudState());
      this.emitStaffRoster();
    };
    const pour = () => {
      if (staff.jobToken !== tok) return;
      if (staff === this.bartender) this.syncBartenderBarDepth();
      staff.stopBob();
      staff.faceToward({ col: staff.grid.col, row: staff.grid.row - 1 });
      if (!staff.playServeBeerAnim()) staff.startBob();
      const ms = (this.resolveServeDrink(BEER_TAP_DRINK_ID)?.serveTimeMs ?? 2000) * slowServeFactor(staff.profile.id);
      this.time.delayedCall(ms, () => {
        if (staff.jobToken !== tok) return;
        if (!inventoryWithdraw(BEER_TAP_DRINK_ID)) {
          this.staffSay(staff, 'Se acabó la cerveza.');
          release();
          return;
        }
        staff.profile.energy = Math.max(0, staff.profile.energy - 1);
        const item = addServedItem(
          BEER_TAP_DRINK_ID,
          spotKey,
          spots.interact ?? spots.staffSpot,
          staff.profile.id,
          this.time.now
        );
        this.refreshServedVisuals();
        this.game.events.emit('inventory-updated');
        // Someone already waiting for beer here takes it at once.
        const waiter = this.waitingBarPatrons().find((p) =>
          kind === 'tap' ? p.goal === 'beer_tap' : p.goal === 'bar' && this.patronWantsBeer(p)
        );
        if (waiter) {
          const claimed = claimServed(BEER_TAP_DRINK_ID, [spotKey], this.time.now);
          if (claimed) this.patronTakesServed(waiter, claimed.item, claimed.state);
        } else {
          this.showStatusFloat(`${staff.displayName} sirvió una cerveza`, { x: staff.x, y: staff.y });
        }
        void item;
        release();
      });
    };
    this.walkToServiceSpot(staff, kind, spots.staffSpot, tok, pour);
    this.emitStaffRoster();
    return true;
  }

  /** On arrival at tap/bar: a waiting (non-spoiled) mug is taken directly → faster service. */
  private tryPatronTakeServedBeer(patron: Patron, at: 'tap' | 'bar'): boolean {
    if (at === 'bar' && !this.patronWantsBeer(patron)) return false;
    const def = at === 'tap' ? this.activeBeerTap() : this.activeBar();
    if (!def) return false;
    const claimed = claimServed(BEER_TAP_DRINK_ID, [`${at}:${def.id}`], this.time.now);
    if (!claimed) return false;
    this.patronTakesServed(patron, claimed.item, claimed.state);
    return true;
  }

  /** Customer buys a pre-poured beer: sale + existing payout/tip/sat paths; freshness matters a bit. */
  private patronTakesServed(patron: Patron, item: ServedItem, state: 'fresh' | 'stale' | 'spoiled'): void {
    removeServed(item.id);
    this.refreshServedVisuals();
    const drink = this.resolveServeDrink(item.productId);
    if (!drink) return;
    drink.price = inventoryGetPrice(item.productId);
    inventoryRecordPrepoured(item.productId);
    this.serveClaim.delete(patron.profile.id);
    patron.wantedDrinkId = item.productId;
    patron.servedDrinkId = item.productId;
    patron.wasOutOfStock = false;
    patron.servedAtBeerTap = item.spot.startsWith('tap:');
    const prof = spoilProfileFor(item.productId);
    if (prof) {
      const delta = state === 'fresh' ? prof.freshSat : prof.staleSat;
      applyPerceivedExperience(patron, `prepoured:${patron.profile.id}`, delta, 'availSens', state === 'fresh' ? 'Cerveza ya servida' : 'Cerveza tibia');
    }
    this.patronThink(patron, state === 'fresh' ? 'ready_beer' : 'stale_beer');
    const pourer = this.findStaffById(item.pouredBy);
    const payout = this.computeServePayout(patron, drink, null, pourer?.profile.mood, pourer?.profile.id);
    this.money += payout.earned;
    this.nightEarned += payout.earned;
    this.servedCount++;
    if (payout.tipAmount > 0 && pourer) {
      recordTip(pourer.profile.id, payout.tipAmount);
      creditWallet(pourer.profile.id, payout.tipAmount);
      noteTip(pourer.profile.id, payout.tipAmount);
    }
    if (patron.servedAtBeerTap && patron.beerServicePref === 'tap') this.patronThink(patron, 'tap_great');
    patron.showBubble(payout.tipped ? `¡Propina! +$${payout.earned}` : `+$${payout.earned}`);
    patron.served = true;
    patron.waiting = false;
    patron.waitSince = 0;
    this.releasePatronSlot(patron);
    this.releaseTile(patron.grid);
    patron.refreshStatusLabel();
    this.persistLayout();
    this.game.events.emit('stats-updated', this.getHudState());
    this.game.events.emit('inventory-updated');
    this.time.delayedCall(700, () => this.afterBarService(patron));
  }

  private beginPrepSnack(staff: Bartender, def: FurnitureDef): boolean {
    const spotKey = `table:${def.id}`;
    if (!inventoryCanSell('botanas') || !canAddServed(spotKey)) return false;
    return this.beginStaffFurnitureTask(staff, def, 'Preparando botanas', 1600, () => {
      if (!inventoryWithdraw('botanas')) {
        this.staffSay(staff, 'Se acabaron las botanas.');
        return;
      }
      addServedItem('botanas', spotKey, { col: def.tile[0], row: def.tile[1] }, staff.profile.id, this.time.now);
      this.refreshServedVisuals();
      this.game.events.emit('inventory-updated');
      this.showStatusFloat(`${staff.displayName} preparó botanas`, { x: staff.x, y: staff.y });
      // A customer already sitting at this table digs in.
      const sitter = this.patrons.find((p) => p.active && p.seated && p.seatedFurnitureId === def.id && !p.ateSnack);
      if (sitter) {
        const claimed = claimServed('botanas', [spotKey], this.time.now);
        if (claimed) this.patronEatsServedSnack(sitter, claimed.item, claimed.state);
      }
    });
  }

  private patronEatsServedSnack(patron: Patron, item: ServedItem, state: 'fresh' | 'stale' | 'spoiled'): void {
    removeServed(item.id);
    this.refreshServedVisuals();
    const price = inventoryGetPrice('botanas');
    inventoryRecordPrepoured('botanas');
    this.money += price;
    this.nightEarned += price;
    patron.ateSnack = true;
    applyPerceivedExperience(patron, `snack:botanas:${patron.profile.id}`, SNACK_EXPERIENCE.satDelta, 'comfortSens', 'Botanas en la mesa');
    const prof = spoilProfileFor('botanas');
    if (prof && state === 'stale') {
      applyPerceivedExperience(patron, `prepared_snack:${patron.profile.id}`, prof.staleSat, 'availSens', 'Botanas aguadas');
      this.patronThink(patron, 'stale_snack');
    } else {
      this.patronThink(patron, 'snack_found');
    }
    patron.showBubble(`Botanas +$${price}`);
    this.game.events.emit('stats-updated', this.getHudState());
    this.game.events.emit('inventory-updated');
  }

  private beginCollectServed(staff: Bartender, def: FurnitureDef): boolean {
    const spotKey = this.servedSpotFor(def);
    return this.beginStaffFurnitureTask(staff, def, 'Recogiendo', 1200, () => {
      const now = this.time.now;
      const old = servedItemsAt(spotKey).filter((i) => servedStateOf(i, now) !== 'fresh');
      for (const it of old) {
        removeServed(it.id);
        inventoryRecordWaste(it.productId);
      }
      this.refreshServedVisuals();
      if (old.length) this.showStatusFloat(`Retiró ${old.length} (merma)`, { x: staff.x, y: staff.y });
    });
  }

  /** Spoilage: fresh → stale → spoiled (refused) → dirt + auto-collected as merma. */
  private tickServedItems(dt: number): void {
    if (!listServed().length) return;
    this.servedTickAccum += dt;
    if (this.servedTickAccum < 500) return;
    const dtSec = this.servedTickAccum / 1000;
    this.servedTickAccum = 0;
    const now = this.time.now;
    const { newlySpoiled, collect } = tickServed(now);
    for (const it of newlySpoiled) {
      const prof = spoilProfileFor(it.productId);
      if (prof) addFloorDirtAt(it.col, it.row, prof.spoilDry, prof.spoilGrime);
    }
    for (const it of listServed()) {
      if (servedStateOf(it, now) !== 'spoiled') continue;
      const prof = spoilProfileFor(it.productId);
      if (prof) addFloorDirtAt(it.col, it.row, 0, prof.spoiledGrimePerSec * dtSec);
    }
    for (const it of collect) {
      removeServed(it.id);
      inventoryRecordWaste(it.productId);
      const at = this.servedItemWorldPos(it, 0);
      this.showStatusFloat(it.productId === 'botanas' ? 'Botanas echadas a perder (merma)' : 'Cerveza echada a perder (merma)', at ?? undefined);
    }
    if (newlySpoiled.length) this.refreshFloorDirtVisuals();
    this.refreshServedVisuals();
  }

  private servedItemWorldPos(it: ServedItem, idx: number): { x: number; y: number } | null {
    const fid = it.spot.split(':')[1];
    const img = fid ? this.shopImages.get(fid) : undefined;
    if (!img) {
      const s = tileToScreen(it.col, it.row, this.iso);
      return { x: s.x + idx * 9 - 9, y: s.y - 18 };
    }
    return { x: img.x - 12 + idx * 10, y: img.y - img.displayHeight * 0.32 };
  }

  private refreshServedVisuals(): void {
    const now = this.time.now;
    const live = new Set<string>();
    const perSpot = new Map<string, number>();
    for (const it of listServed()) {
      live.add(it.id);
      const idx = perSpot.get(it.spot) ?? 0;
      perSpot.set(it.spot, idx + 1);
      const pos = this.servedItemWorldPos(it, idx);
      if (!pos) continue;
      let g = this.servedGfx.get(it.id);
      if (!g) {
        g = this.add.graphics();
        this.servedGfx.set(it.id, g);
      }
      const state = servedStateOf(it, now);
      g.clear();
      g.setPosition(pos.x, pos.y);
      const fid = it.spot.split(':')[1];
      const img = fid ? this.shopImages.get(fid) : undefined;
      g.setDepth((img?.depth ?? depthForCharacter(it.col, it.row)) + 0.6);
      if (it.productId === 'botanas') {
        g.fillStyle(0xf4efe6, 1);
        g.fillEllipse(0, 0, 14, 6);
        const c = state === 'fresh' ? 0xf0a030 : state === 'stale' ? 0xb08040 : 0x6b6a2a;
        g.fillStyle(c, 1);
        g.fillCircle(-3, -1, 2);
        g.fillCircle(1, -2, 2);
        g.fillCircle(3, 0, 2);
      } else {
        const beer = state === 'fresh' ? 0xf2b632 : state === 'stale' ? 0xc89a3a : 0x7d7a2c;
        g.fillStyle(0xdfeaf0, 0.55);
        g.fillRect(-4, -11, 8, 12);
        g.fillStyle(beer, 1);
        g.fillRect(-3, state === 'fresh' ? -8 : -6, 6, state === 'fresh' ? 8 : 6);
        if (state === 'fresh') {
          g.fillStyle(0xffffff, 1);
          g.fillRect(-4, -11, 8, 3);
        }
        g.lineStyle(1.5, 0xdfeaf0, 0.9);
        g.strokeRect(4, -8, 3, 5);
      }
      if (state === 'spoiled') {
        g.lineStyle(1, 0x9acd32, 0.9);
        g.beginPath();
        g.moveTo(-2, -14);
        g.lineTo(-1, -18);
        g.moveTo(2, -14);
        g.lineTo(3, -19);
        g.strokePath();
      }
    }
    for (const [id, g] of [...this.servedGfx.entries()]) {
      if (!live.has(id)) {
        g.destroy();
        this.servedGfx.delete(id);
      }
    }
  }

  /** End of night: leftovers are merma (stock already withdrawn, money not recovered). */
  private wasteAllServed(): void {
    for (const it of clearServed()) inventoryRecordWaste(it.productId);
    this.refreshServedVisuals();
  }

  // ─── Flies: local consequence of dirt left too long ───────────────────────────────────

  private tickFlies(dt: number): void {
    this.flyTickAccum += dt;
    if (this.flyTickAccum < 1000) return;
    this.flyTickAccum = 0;
    const now = this.time.now;
    for (const z of getFloorZones()) {
      const intensity = Math.max(z.dryDirt, z.grime);
      let s = this.flyZones.get(z.id);
      if (intensity >= FLIES.minIntensity) {
        if (!s) {
          s = { dirtySince: now, active: false, episode: 0 };
          this.flyZones.set(z.id, s);
        }
        if (!s.active && now - s.dirtySince >= FLIES.appearAfterMs) {
          s.active = true;
          s.episode += 1;
          this.spawnFlies(z.id, s);
        }
      } else if (s && intensity < FLIES.clearBelow) {
        this.clearFlies(s);
        this.flyZones.delete(z.id);
      } else if (s && !s.active) {
        s.dirtySince = now; // dipped below the threshold: timer restarts
      }
    }
  }

  private spawnFlies(zoneId: string, s: FlyZoneState): void {
    const z = getFloorZoneById(zoneId);
    if (!z) return;
    const c = floorZoneCenter(z);
    const base = tileToScreen(c.col, c.row, this.iso);
    const cont = this.add.container(base.x, base.y - 22).setDepth(depthForCharacter(c.col, c.row) + 2);
    for (let i = 0; i < 4; i++) {
      const fly = this.add.circle(0, 0, 1.6, 0x101010, 1);
      cont.add(fly);
      const r = 8 + Math.random() * 10;
      const ph = Math.random() * Math.PI * 2;
      this.tweens.addCounter({
        from: 0,
        to: Math.PI * 2,
        duration: 900 + Math.random() * 700,
        repeat: -1,
        onUpdate: (tw) => {
          const a = (tw.getValue() ?? 0) + ph;
          fly.setPosition(Math.cos(a) * r, Math.sin(a * 2) * r * 0.45);
        },
      });
    }
    s.gfx = cont;
  }

  private clearFlies(s: FlyZoneState): void {
    if (s.gfx) {
      for (const ch of s.gfx.list) this.tweens.killTweensOf(ch);
      s.gfx.destroy(true);
      s.gfx = undefined;
    }
    s.active = false;
  }

  private clearAllFlies(): void {
    for (const s of this.flyZones.values()) this.clearFlies(s);
    this.flyZones.clear();
  }

  // ─── Repairs via technicians ──────────────────────────────────────────────────────────

  private repairJobFor(furnitureId: string): RepairJob | null {
    return this.repairJobs.find((j) => j.furnitureId === furnitureId) ?? null;
  }

  private repairStageLabel(job: RepairJob): string {
    switch (job.stage) {
      case 'en_route':
        return 'Técnico en camino';
      case 'walking':
        return 'Técnico llegando';
      case 'inspecting':
        return 'Técnico inspeccionando';
      case 'verdict':
        return 'Esperando tu decisión';
      case 'repairing':
        return 'Técnico reparando';
      default:
        return 'Técnico';
    }
  }

  private beginRepairRequest(staff: Bartender, def: FurnitureDef): boolean {
    if (this.repairJobFor(def.id)) return false;
    return this.beginStaffFurnitureTask(staff, def, 'Revisando daño', 1300, () => {
      this.staffSay(staff, 'Esto no lo arreglo yo. Hay que llamar a un técnico.', false);
      this.emitTechnicianList(staff, def);
    });
  }

  private emitTechnicianList(staff: Bartender, def: FurnitureDef): void {
    this.game.events.emit('repair-tech-list', {
      furnitureId: def.id,
      furnitureName: this.furnitureDisplayName(def),
      staffName: staff.displayName,
      money: this.money,
      techs: TECHNICIANS.map((t) => ({
        id: t.id,
        name: t.name,
        stars: t.stars,
        fee: t.consultFee,
        canAfford: this.money >= t.consultFee,
      })),
    } as TechListPayload);
  }

  private onCmdHireTechnician = (payload: { furnitureId: string; techId: string }): void => {
    const def = payload ? this.getFurnitureDef(payload.furnitureId) : null;
    const tech = TECHNICIANS.find((t) => t.id === payload?.techId);
    if (!def || !tech) return;
    if (this.repairJobFor(def.id)) return;
    if (this.money < tech.consultFee) {
      this.game.events.emit('repair-hire-failed', { reason: 'Fondos insuficientes.' });
      return;
    }
    const job: RepairJob = {
      id: `rep_${++this.repairSeq}`,
      furnitureId: def.id,
      tech,
      stage: 'en_route',
      arriveAt: this.time.now + this.randBetween(REPAIR_TIMING.arrivalMs),
      stageEndsAt: 0,
    };
    this.repairJobs.push(job);
    this.uiToast(`${tech.name} viene en camino.`);
    this.reemitFurnitureInspectIf(def.id);
  };

  private tickRepairs(): void {
    if (!this.repairJobs.length) return;
    const now = this.time.now;
    for (const job of [...this.repairJobs]) {
      const def = this.getFurnitureDef(job.furnitureId);
      if (!def) {
        this.endRepairJob(job, false);
        continue;
      }
      if (job.stage === 'en_route' && now >= job.arriveAt) this.technicianArrives(job, def);
      else if (job.stage === 'inspecting' && now >= job.stageEndsAt) this.technicianVerdict(job, def);
      else if (job.stage === 'verdict' && now >= job.stageEndsAt) this.applyRepairDecision(job, false);
      else if (job.stage === 'repairing' && now >= job.stageEndsAt) this.finishRepair(job, def);
    }
  }

  private technicianArrives(job: RepairJob, def: FurnitureDef): void {
    // Consultation is charged when he arrives and starts — never into negative money.
    if (this.money < job.tech.consultFee) {
      this.uiToast(`${job.tech.name} llegó, pero no hay fondos para la consulta. Se fue.`);
      this.endRepairJob(job, false);
      return;
    }
    this.money -= job.tech.consultFee;
    this.persistLayout();
    this.game.events.emit('stats-updated', this.getHudState());
    this.uiToast(`Llegó ${job.tech.name}. Consulta: −$${job.tech.consultFee}`);
    const door = { col: this.scenario.spawnTile[0], row: this.scenario.spawnTile[1] };
    const sprite = new Patron(this, 'patron', door, this.iso, this.pathfinder, {
      id: `tech_${job.id}`,
      name: job.tech.name,
      sprite: 'patron',
      preferredDrink: 'agua',
      tipChance: 0,
      patience: 999,
    });
    sprite.reapplyDisplaySize();
    sprite.sprite.setTint(0x9fd4ff);
    sprite.statusLabel?.setText('Técnico').setColor('#9fd4ff').setVisible(true);
    sprite.sprite.disableInteractive();
    job.sprite = sprite;
    job.stage = 'walking';
    const dest = this.visitorTileNear(def) ?? door;
    const startInspect = () => {
      if (!this.repairJobs.includes(job)) return;
      sprite.faceToward({ col: def.tile[0], row: def.tile[1] });
      sprite.statusLabel?.setText('Inspeccionando…').setVisible(true);
      job.stage = 'inspecting';
      job.stageEndsAt = this.time.now + this.randBetween(REPAIR_TIMING.inspectMs);
      this.reemitFurnitureInspectIf(def.id);
    };
    if (!sprite.walkTo(dest, startInspect)) startInspect();
    this.reemitFurnitureInspectIf(def.id);
  }

  private visitorTileNear(def: FurnitureDef): { col: number; row: number } | null {
    const cands = [...this.frontTiles(def)];
    const fw = Math.max(1, def.footprint[0]);
    const fh = Math.max(1, def.footprint[1]);
    for (let c = def.tile[0] - 1; c <= def.tile[0] + fw; c++) {
      for (let r = def.tile[1] - 1; r <= def.tile[1] + fh; r++) cands.push({ col: c, row: r });
    }
    for (const t of cands) {
      if (!this.pathfinder.isWalkable(t.col, t.row)) continue;
      if (this.allStaff().some((s) => s.grid.col === t.col && s.grid.row === t.row)) continue;
      if (this.patrons.some((p) => p.active && p.grid.col === t.col && p.grid.row === t.row)) continue;
      return t;
    }
    return null;
  }

  private technicianVerdict(job: RepairJob, def: FurnitureDef): void {
    const st = this.statsOf(def);
    const damage = 1 - st.durability / Math.max(1, st.maxDurability);
    const price = this.furniturePrice(def);
    const raw =
      price * (REPAIR_COST.base + REPAIR_COST.span * damage) * this.randBetween(REPAIR_COST.jitter) * job.tech.quoteMult;
    job.quote = Math.max(REPAIR_COST.min, Math.round(raw / 5) * 5);
    const fn = this.furnitureFunction(def);
    const lines = DIAGNOSES[fn] ?? DIAGNOSES.default;
    job.diagnosis = this.pick(lines).replace('{name}', this.furnitureDisplayName(def).toLowerCase());
    // Hidden quality for this job (reputation shifts the odds, never guarantees).
    const mean = REPAIR_QUALITY.base + REPAIR_QUALITY.perStar * job.tech.stars;
    const gauss = (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; // ~N(0,1)-ish
    job.quality = Phaser.Math.Clamp(mean + gauss * REPAIR_QUALITY.sd, 0.03, 0.97);
    job.stage = 'verdict';
    job.stageEndsAt = this.time.now + REPAIR_TIMING.verdictTimeoutMs;
    job.sprite?.statusLabel?.setText('Esperando decisión').setVisible(true);
    this.game.events.emit('repair-verdict', {
      jobId: job.id,
      techName: job.tech.name,
      furnitureName: this.furnitureDisplayName(def),
      diagnosis: job.diagnosis,
      cost: job.quote,
      newPrice: price,
      money: this.money,
      canAfford: this.money >= job.quote,
    } as RepairVerdictPayload);
    this.reemitFurnitureInspectIf(def.id);
  }

  private onCmdRepairDecision = (payload: { jobId: string; repair: boolean }): void => {
    const job = this.repairJobs.find((j) => j.id === payload?.jobId);
    if (!job || job.stage !== 'verdict') return;
    this.applyRepairDecision(job, !!payload.repair);
  };

  private applyRepairDecision(job: RepairJob, repair: boolean): void {
    const def = this.getFurnitureDef(job.furnitureId);
    if (!def) {
      this.endRepairJob(job, false);
      return;
    }
    if (repair) {
      const cost = job.quote ?? 0;
      if (this.money < cost) {
        this.game.events.emit('repair-hire-failed', { reason: 'Fondos insuficientes.' });
        this.uiToast('Fondos insuficientes.');
        this.endRepairJob(job, true);
        return;
      }
      this.money -= cost;
      this.persistLayout();
      this.game.events.emit('stats-updated', this.getHudState());
      job.stage = 'repairing';
      job.stageEndsAt = this.time.now + this.randBetween(REPAIR_TIMING.repairWorkMs);
      job.sprite?.statusLabel?.setText('Reparando…').setVisible(true);
      this.uiToast(`${job.tech.name} está reparando (−$${cost}).`);
      this.reemitFurnitureInspectIf(def.id);
      return;
    }
    this.uiToast(`${this.furnitureDisplayName(def)}: sin reparar.`);
    this.endRepairJob(job, true);
  }

  private finishRepair(job: RepairJob, def: FurnitureDef): void {
    const q = job.quality ?? 0.5;
    const st = this.statsOf(def);
    const shrink = REPAIR_QUALITY.maxShrinkMin + REPAIR_QUALITY.maxShrinkBadExtra * (1 - q);
    const newMax = Math.max(REPAIR_QUALITY.minMaxDurability, st.maxDurability * (1 - shrink));
    st.maxDurability = newMax;
    st.durability = Math.min(newMax, newMax * (REPAIR_QUALITY.restoreMin + REPAIR_QUALITY.restoreSpan * q));
    this.writeStatsToDef(def, st);
    def.repairCount = (def.repairCount ?? 0) + 1;
    def.fragility = 1 + (1 - q) * REPAIR_QUALITY.fragilityPerBad;
    def.failChance = (1 - q) * (1 - q) * REPAIR_QUALITY.suddenFailPerMin;
    def.lastRepairQuality = Math.round(q * 100) / 100;
    this.uiToast(`${job.tech.name} terminó: ${this.furnitureDisplayName(def)} vuelve a funcionar.`);
    this.persistLayout();
    this.endRepairJob(job, true);
    this.game.events.emit('stats-updated', this.getHudState());
  }

  private endRepairJob(job: RepairJob, walkOut: boolean): void {
    this.repairJobs = this.repairJobs.filter((j) => j !== job);
    const sprite = job.sprite;
    job.sprite = undefined;
    if (sprite && sprite.active) {
      if (walkOut) {
        sprite.statusLabel?.setText('Técnico').setVisible(true);
        const exit = { col: this.scenario.exitTile[0], row: this.scenario.exitTile[1] };
        if (!sprite.walkTo(exit, () => sprite.destroy())) sprite.destroy();
      } else sprite.destroy();
    }
    this.reemitFurnitureInspectIf(job.furnitureId);
  }

  private cancelAllRepairJobs(): void {
    for (const j of [...this.repairJobs]) this.endRepairJob(j, false);
    this.game.events.emit('repair-ui-close');
  }

  /** Sloppy repairs wear faster and may fail suddenly (even the same day). */
  private applyRepairAftereffects(def: FurnitureDef, durBefore: number, dtSec: number): void {
    const frag = def.fragility ?? 1;
    const st = this.statsOf(def);
    if (frag > 1 && st.durability < durBefore) {
      st.durability = Math.max(0, st.durability - (durBefore - st.durability) * (frag - 1));
      this.writeStatsToDef(def, st);
    }
    const fc = def.failChance ?? 0;
    if (fc > 0 && st.durability > st.maxDurability * 0.1 && Math.random() < (fc / 60) * dtSec) {
      st.durability = st.maxDurability * 0.05;
      this.writeStatsToDef(def, st);
      const img = this.shopImages.get(def.id);
      this.showStatusFloat(`¡${this.furnitureDisplayName(def)} volvió a fallar!`, img ?? undefined);
      this.uiToast(`¡${this.furnitureDisplayName(def)} volvió a fallar!`);
      this.reemitFurnitureInspectIf(def.id);
    }
  }

  // ─── Customer thoughts (perceived events only; anti-spam in systems/Thoughts) ─────────

  private patronThink(patron: Patron, key: string, vars?: Record<string, string>): void {
    if (!patron.active) return;
    const onScreen = this.patrons.filter((p) => p.active && p.thoughtVisible).length;
    const selected = this.selectedNpcId === patron.profile.id;
    const d = decideThought(patron, key, this.time.now, { onScreen, selected, vars });
    if (!d) return;
    if (d.show) patron.showThought(d.text, d.emoji, THOUGHT_RULES.showMs, d.tone);
    if (selected) this.game.events.emit('stats-updated', this.getHudState());
  }

  /** Extra local perception (decor, broken pieces, flies, spoiled items, staff sparks, clean place). */
  private perceiveInterventionEvents(patron: Patron): void {
    const { col, row } = patron.grid;
    const now = this.time.now;
    // Decor that impresses (one roll per piece per visit).
    let rolled = this.patronDecorRolled.get(patron);
    if (!rolled) {
      rolled = new Set();
      this.patronDecorRolled.set(patron, rolled);
    }
    for (const def of this.scenario.furniture) {
      if (!withinPerception(col, row, def.tile, def.footprint)) continue;
      const st = this.statsOf(def);
      const cond = conditionFromDurability(st.durability, st.maxDurability);
      if (cond === 'Se rompió' || cond === 'Inservible') {
        const d = applyPerceivedExperience(patron, `broken:${def.id}`, -2, 'comfortSens', `${this.furnitureDisplayName(def)} roto (visto)`);
        if (d != null) this.patronThink(patron, 'broken_furniture');
        continue;
      }
      const cid = (def.catalogId || def.type || '').toLowerCase();
      const imp = IMPRESSIVE_DECOR[cid];
      if (imp && !rolled.has(def.id)) {
        rolled.add(def.id);
        if (st.cleanliness >= DIRT_VISUAL_THRESHOLD && Math.random() < imp.chance) {
          const d = applyPerceivedExperience(patron, `decor:${def.id}`, imp.sat, 'comfortSens', `${this.furnitureDisplayName(def)} (impresiona)`);
          if (d != null) this.patronThink(patron, imp.thought, { item: this.furnitureDisplayName(def).toLowerCase() });
        }
      }
    }
    // Flies: only zones right next to this patron.
    for (const [zid, s] of this.flyZones) {
      if (!s.active) continue;
      const z = getFloorZoneById(zid);
      if (!z || distToFloorZone(col, row, z) > FLIES.perceiveDist) continue;
      const d = applyPerceivedExperience(patron, `flies:${zid}:${s.episode}`, FLIES.satDelta, 'cleanSens', 'Moscas (cerca)');
      if (d != null) this.patronThink(patron, 'flies');
    }
    // Spoiled mugs / plates in view.
    for (const it of listServed()) {
      if (servedStateOf(it, now) !== 'spoiled') continue;
      if (Math.max(Math.abs(it.col - col), Math.abs(it.row - row)) > 2) continue;
      const d = applyPerceivedExperience(patron, `spoiled_seen:${it.id}`, THOUGHT_SAT.spoiledSeen, 'cleanSens', 'Comida/bebida echada a perder');
      if (d != null) this.patronThink(patron, 'spoiled_seen');
    }
    // Staff up close: favourite (already liked) or a spontaneous spark (no opinion yet).
    let sparks = this.patronSparkRolled.get(patron);
    if (!sparks) {
      sparks = new Set();
      this.patronSparkRolled.set(patron, sparks);
    }
    for (const s of this.allStaff()) {
      if (!s.visible || sparks.has(s.profile.id)) continue;
      if (Math.max(Math.abs(s.grid.col - col), Math.abs(s.grid.row - row)) > 3) continue;
      sparks.add(s.profile.id);
      const pname = patron.profile.name;
      const level = peekAffinity(pname, s.profile.id);
      if (level === 'alta') {
        applyPerceivedExperience(patron, `fav_seen:${s.profile.id}`, THOUGHT_SAT.affinityFav, 'tolerance', `Ve a ${s.displayName}`);
        this.patronThink(patron, 'affinity_fav', { staff: s.displayName });
      } else if (level === null || level === 'normal') {
        const chance = level === null ? THOUGHT_SAT.sparkChance : THOUGHT_SAT.sparkChance * 0.4;
        if (Math.random() < chance) {
          setAffinity(pname, s.profile.id, 'alta');
          applyPerceivedExperience(patron, `spark:${s.profile.id}`, THOUGHT_SAT.affinitySpark, 'tolerance', `Le gustó ${s.displayName}`);
          this.patronThink(patron, 'affinity_spark', { staff: s.displayName });
        }
      }
    }
    // Clean place (after a while inside, nothing dirty perceived nearby).
    const since = this.patronSpawnAt.get(patron) ?? now;
    if (now - since >= THOUGHT_SAT.cleanPlaceAfterMs && !hasThought(patron, 'clean_place')) {
      const dirtyNear = getFloorZones().some((z) => isFloorVisiblyDirty(z) && distToFloorZone(col, row, z) <= 2);
      const dirtyFurn = this.scenario.furniture.some(
        (f) => withinPerception(col, row, f.tile, f.footprint) && isVisiblyDirty(this.statsOf(f))
      );
      if (!dirtyNear && !dirtyFurn && this.clubVenueQuality() >= 0.7) {
        if (Math.random() < THOUGHT_SAT.cleanPlaceChance) {
          applyPerceivedExperience(patron, 'clean_place', THOUGHT_SAT.cleanPlace, 'cleanSens', 'Lugar limpio');
          this.patronThink(patron, 'clean_place');
        }
      }
    }
  }

  /** Leaving: a short goodbye thought from how the visit went (sat feeds return chance already). */
  private patronGoodbyeThought(patron: Patron): void {
    if (patron.angry) {
      this.patronThink(patron, 'angry_leave');
      return;
    }
    const exp = getExperience(patron);
    if (!exp) return;
    const servedBy = patron.servedByStaffId ? this.findStaffById(patron.servedByStaffId) : null;
    if (servedBy && peekAffinity(patron.profile.name, servedBy.profile.id) === 'alta' && exp.satisfaction >= 60) {
      applyPerceivedExperience(patron, 'goodbye_aff', THOUGHT_SAT.affinityGoodbye, 'tolerance', 'Se va contento');
      this.patronThink(patron, 'affinity_goodbye', { staff: servedBy.displayName });
      return;
    }
    if (exp.satisfaction >= 72) this.patronThink(patron, 'like_place');
  }

  // ─── Debug / test hooks ───────────────────────────────────────────────────────────────

  getInterventionDebug() {
    const now = this.time.now;
    return {
      served: getServedDebug(now),
      waste: getNightWaste(),
      staffUse: getNightStaffConsumption(),
      needs: getStaffNeedsDebug(),
      wallets: Object.fromEntries(this.allStaff().map((s) => [s.profile.id, getWallet(s.profile.id)])),
      repairs: this.repairJobs.map((j) => ({
        id: j.id,
        furnitureId: j.furnitureId,
        tech: j.tech.id,
        stage: j.stage,
        quote: j.quote ?? null,
        msToArrive: Math.max(0, Math.round(j.arriveAt - now)),
        msToStageEnd: Math.max(0, Math.round(j.stageEndsAt - now)),
      })),
      flies: [...this.flyZones.entries()].map(([id, s]) => ({ id, active: s.active, dirtyForMs: Math.round(now - s.dirtySince) })),
      orders: [...this.orderLog],
      thoughts: getThoughtsDebug(),
      staff: this.allStaff().map((s) => ({
        id: s.profile.id,
        aiJob: s.aiJob,
        state: s.state,
        playerCommanded: s.playerCommanded,
        energy: Math.round(s.profile.energy),
        mood: Math.round(s.profile.mood),
        intox: Math.round(intoxOf(s.profile.id) * 100) / 100,
        label: intoxLabel(s.profile.id),
        token: s.jobToken,
      })),
    };
  }

  debugContextActions(staffId: string, target: CtxTarget) {
    const staff = this.findStaffById(staffId);
    return staff ? this.buildContextActions(staff, target) : null;
  }

  debugOrder(staffId: string, target: CtxTarget, actionId: string): string {
    const staff = this.findStaffById(staffId);
    return staff ? this.issuePlayerOrder(staff, target, actionId) : 'no-staff';
  }

  debugSetStaffStats(staffId: string, stats: { energy?: number; mood?: number; intox?: number; wallet?: number }): void {
    const s = this.findStaffById(staffId);
    if (!s) return;
    if (typeof stats.energy === 'number') s.profile.energy = stats.energy;
    if (typeof stats.mood === 'number') s.profile.mood = stats.mood;
    if (typeof stats.intox === 'number') debugSetIntox(staffId, stats.intox);
    if (typeof stats.wallet === 'number') debugSetWallet(staffId, stats.wallet);
  }

  /** Age every served item by `ms` (test: spoilage without waiting minutes). */
  debugAgeServed(ms: number): void {
    for (const it of listServed()) it.createdAt -= ms;
    this.servedTickAccum = 500;
    this.tickServedItems(0);
  }

  debugRepairFastForward(): void {
    const now = this.time.now;
    for (const j of this.repairJobs) {
      if (j.stage === 'en_route') j.arriveAt = now;
      else if (j.stage === 'inspecting' || j.stage === 'repairing') j.stageEndsAt = now;
    }
    this.tickRepairs();
  }

  debugAgeFlies(ms: number): void {
    for (const s of this.flyZones.values()) s.dirtySince -= ms;
    this.flyTickAccum = 1000;
    this.tickFlies(0);
  }

  debugSetFloorDirt(zoneId: string, dry: number, grime: number): void {
    const z = getFloorZoneById(zoneId);
    if (!z) return;
    z.dryDirt = dry;
    z.grime = grime;
    this.refreshFloorDirtVisuals();
  }

  debugPatronThink(patronIndex: number, key: string): void {
    const p = this.patrons.filter((x) => x.active)[patronIndex];
    if (p) this.patronThink(p, key);
  }

  debugPerceive(): void {
    for (const p of this.patrons) if (p.active) {
      this.perceiveNearbyDirt(p);
      this.perceiveInterventionEvents(p);
    }
  }


  private patronNoSeat(patron: Patron): void {
    const d = applyPerceivedExperience(patron, 'no_seat', THOUGHT_SAT.noSeat, 'comfortSens', 'Sin asiento');
    if (d != null) this.patronThink(patron, 'no_seat');
  }

  shutdown(): void {
    this.scale.off('resize', this.onClubResize, this);
    this.game.events.off('cmd-open-night', this.openNight, this);
    this.game.events.off('cmd-close-night', this.closeNight, this);
    this.game.events.off('cmd-sleep', this.sleepDay, this);
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
    this.game.events.off('cmd-restock-drink', this.onCmdRestockDrink, this);
    this.game.events.off('cmd-set-drink-price', this.onCmdSetDrinkPrice, this);
    this.game.events.off('cmd-deselect-furniture', this.onCmdDeselectFurniture, this);
    this.game.events.off('cmd-confirm-delete-furniture', this.onCmdConfirmDeleteFurniture, this);
    this.game.events.off('cmd-cancel-delete-furniture', this.onCmdCancelDeleteFurniture, this);
  }

  private onCmdDeselectFurniture = (): void => {
    this.closeFurnitureInspect();
  };
}

