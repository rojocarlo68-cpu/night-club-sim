/**
 * Physical restock orders (supplier → entrance → staff carry → behind the bar) and
 * customer trash (consumption → floor / container → bag → taken out).
 * Times: game minutes for deliveries (1 game min = 1 real s); real ms for on-floor actions
 * (same scale as technicians / spoilage).
 */

/** Universal packaging. Every drink uses crates of 6 (remainder = loose bottles). */
export const PACKAGING = {
  drinkCrateUnits: 6,
  /** Botanas travel in sacks; one sack = 100 units of inventory. */
  snackSackUnits: 100,
} as const;

export const DELIVERY_TIMING = {
  /**
   * Ordered before midnight (game clock 17:00–23:59) while the shift is still running
   * (prep / open / closing): arrives this many game minutes later (rolled per order; tripled
   * from the old 8–12). May pass midnight — that is fine.
   */
  sameNightMinutes: [24, 36] as [number, number],
  /**
   * The supplier NEVER shows up while the club is closed. Next-day orders (placed at/after 00:00,
   * or after the night ended) and same-night orders whose time elapsed before Abrir noche are
   * scheduled only once the club OPENS, this many game minutes after opening (never instant).
   */
  afterOpenMinutes: [3, 10] as [number, number],
  /** Game hours >= this (and < 24) count as "before midnight" for the same-night rule. */
  sameNightFromHour: 17,
} as const;

/** Drop zone next to the entrance (packages are not obstacles; visual + logistic only). */
export const DROP_ZONE = {
  /** Packages that fit visually on one tile before the pile spills to the next tile. */
  perTile: 6,
  /** Search radius (tiles) around the entrance for drop tiles. */
  maxRadius: 5,
} as const;

/** Carry: EXACTLY 1 crate, OR 1 sack, OR up to 2 loose bottles per trip. */
export const CARRY_RULES = {
  maxBottles: 2,
  maxCrates: 1,
} as const;

/** Energy cost per package carried (moderate; scaled by load). */
export const CARRY_ENERGY = {
  crate: 3,
  sack: 3.5,
  bottle: 0.75,
} as const;

/** Walking a little slower while loaded (restored after the trip). */
export const CARRY_SPEED_MULT = {
  crate: 0.85,
  sack: 0.82,
  bottle: 0.96,
} as const;

export const HAUL_TIMING = {
  pickMs: 550,
  storeMs: 650,
} as const;

/** Autonomous hauling / trash work needs at least this much energy. */
export const LOGISTICS_MIN_ENERGY = 12;
/** Below this mood, an idle staff member skips logistics ~half of the time (procrastinates). */
export const LOGISTICS_LOW_MOOD = 22;

/**
 * Texture keys for every placeholder. If a real texture with this key is loaded (BootScene),
 * the procedural placeholder is NOT generated and the real art is used as-is (no tint).
 */
export const LOGISTICS_ASSETS = {
  /** Supplier uses the patron sprite (tinted) until final art exists. */
  supplierSprite: 'patron',
  supplierTint: 0xffc070,
  crate: 'ph_logi_crate',
  bottle: 'ph_logi_bottle',
  sack: 'ph_logi_sack',
  trashBagFull: 'ph_trash_bag_full',
  trash: {
    servilleta: 'ph_trash_servilleta',
    envoltura: 'ph_trash_envoltura',
    vaso_vacio: 'ph_trash_vaso',
    botella_vacia: 'ph_trash_botella',
    bolsa: 'ph_trash_bolsa',
    restos_botana: 'ph_trash_restos',
  } as Record<string, string>,
} as const;

/** Placeholder tint per product (only applied to generated placeholders). */
export const PRODUCT_TINT: Record<string, number> = {
  cerveza: 0xf2b632,
  refresco: 0xd8443a,
  shot_barato: 0xc8c8c8,
  vodka: 0xbfe6ff,
  whiskey: 0xb8762e,
  ron: 0x8a4a1e,
  cafe: 0x6b4226,
  agua: 0x6ac8ff,
  botanas: 0xe0b060,
};

/** Catalog id of the trash container furniture. */
export const TRASH_CONTAINER_ID = 'contenedor_basura';

export type TrashKind = 'servilleta' | 'envoltura' | 'vaso_vacio' | 'botella_vacia' | 'bolsa' | 'restos_botana';

export const TRASH = {
  /** Chance that one consumption leaves 1 piece of trash (moderate — not every time). */
  chanceByProduct: {
    botanas: 0.42,
    cerveza: 0.26,
    refresco: 0.26,
    agua: 0.2,
    cafe: 0.2,
    default: 0.2,
  } as Record<string, number>,
  /** With a container most trash goes in the bin; this share still ends on the floor. */
  containerFloorShare: 0.15,
  /** Trash appears when the customer finishes (ms after consuming), at their position then. */
  delayMs: [6000, 16000] as [number, number],
  kindsByProduct: {
    botanas: ['envoltura', 'restos_botana', 'servilleta', 'bolsa'],
    cerveza: ['botella_vacia', 'vaso_vacio', 'servilleta'],
    refresco: ['vaso_vacio', 'botella_vacia', 'servilleta'],
    agua: ['botella_vacia', 'vaso_vacio'],
    cafe: ['vaso_vacio', 'servilleta'],
    default: ['vaso_vacio', 'servilleta'],
  } as Record<string, TrashKind[]>,
  /** Bag capacity rolled ONCE per bag cycle (inclusive ranges). */
  bagCapacity: {
    noContainer: [10, 15] as [number, number],
    container: [18, 25] as [number, number],
  },
  pickMs: 650,
  placeBagMs: 500,
  /** Sacar basura: time outside before she walks back in (~20 s with variation). */
  takeOutAwayMs: [17500, 22500] as [number, number],
  pickEnergy: 0.6,
  takeOutEnergy: 2.5,
} as const;

export const TRASH_NAMES: Record<TrashKind, string> = {
  servilleta: 'Servilleta',
  envoltura: 'Envoltura',
  vaso_vacio: 'Vaso vacío',
  botella_vacia: 'Botella vacía',
  bolsa: 'Bolsita',
  restos_botana: 'Restos de botana',
};

/** Local perception of trash (no global penalty). */
export const TRASH_PERCEPTION = {
  /** Chebyshev radius for loose trash. */
  itemRadius: 2,
  /** Full bag is more noticeable. */
  bagRadius: 3,
  /** Weight per item by distance: ≤1 tile / 2 tiles. */
  nearWeight: 1,
  farWeight: 0.5,
  bagNearWeight: 2.5,
  bagFarWeight: 1.5,
  /** First notice: -(base + perWeight·score), capped. */
  firstBase: 1,
  firstPerWeight: 0.8,
  firstCap: 4,
  /** Lingering next to it: extra one-shots after this exposure (ms). */
  exposureSteps: [12000, 30000] as number[],
  exposurePerWeight: 0.6,
  exposureCap: 2.5,
  /** One-shot for seeing a full bag lying in the club. */
  bagDelta: -2.5,
  /** Score at/above which the stronger "asqueroso" thought is used. */
  strongScore: 2.5,
} as const;
