/**
 * Central tunables for customer visit satisfaction (Prompt A Phase 1).
 * Invisible to the player. Balance here — do not scatter magic numbers.
 */

export const SAT_MIN = 0;
export const SAT_MAX = 100;
/** Starting satisfaction when a patron arrives. */
export const BASE_SATISFACTION = 70;

/** Inclusive ranges for rolled traits (0..1). Stable per patron identity name. */
export const TRAIT_RANGES = {
  cleanSens: { min: 0.15, max: 0.95 },
  comfortSens: { min: 0.15, max: 0.95 },
  priceSens: { min: 0.1, max: 0.9 },
  availSens: { min: 0.15, max: 0.95 },
  generosity: { min: 0.2, max: 0.95 },
  tolerance: { min: 0.2, max: 0.95 },
} as const;

export type SatisfactionTraitName = keyof typeof TRAIT_RANGES;

/** How strongly a trait scales a base delta (Phase 2+). Phase 1 stores only. */
export const TRAIT_SCALE = {
  /** high trait → larger |delta| when traitName provided */
  intensity: 0.5,
  /** tolerance dampens negative deltas */
  toleranceDampNeg: 0.4,
} as const;

/** Ring buffer size for finalized visits (future reputation hook). */
export const VISIT_HISTORY_CAP = 40;

/** Debug ring for getExperienceDebug last visits. */
export const VISIT_DEBUG_CAP = 20;

/* ───────────── Prompt A Phase 2: comfort / cleanliness perception ───────────── */

/**
 * Comfort bands read from the EXISTING furniture stats (comfort / maxComfort ratio).
 * Checked top→bottom; first band whose minRatio ≤ ratio wins. Applied once per seat used.
 */
export const COMFORT_BANDS = [
  { band: 'comfortable', minRatio: 0.75, delta: 4 },
  { band: 'ok', minRatio: 0.5, delta: 0 },
  { band: 'uncomfortable', minRatio: 0.3, delta: -4 },
  { band: 'very_uncomfortable', minRatio: 0, delta: -8 },
] as const;

/**
 * Existing durability condition labels (conditionFromDurability) that force a worse comfort band.
 * Worst of (comfort band, durability band) is used.
 */
export const DURABILITY_COMFORT_BAND: Record<string, string> = {
  'Daños visibles': 'uncomfortable',
  'Se rompió': 'very_uncomfortable',
  Inservible: 'very_uncomfortable',
};

/**
 * Dirt bands from EXISTING cleanliness / maxCleanliness ratio.
 * `dirty` starts at DIRT_VISUAL_THRESHOLD (60) so it matches the visible stain overlay.
 * `clean` bonus only applies to the item the patron actually uses (never from proximity).
 */
export const DIRT_BANDS = {
  /** ratio < this → very dirty */
  veryDirtyBelow: 0.3,
  /** ratio < this → dirty (keep = DIRT_VISUAL_THRESHOLD / 100: only visible stains count) */
  dirtyBelow: 0.6,
  /** ratio ≥ this on the used item → small clean bonus */
  cleanAtOrAbove: 0.75,
  delta: { clean: 2, dirty: -4, very_dirty: -8 },
} as const;

/** Patron perceives dirty items within this Chebyshev tile distance of the footprint. */
export const PERCEPTION_RADIUS_TILES = 2;
/** How often each patron scans its surroundings (ms). Not every frame. */
export const PERCEPTION_INTERVAL_MS = 1000;

/**
 * Trait scaling for perceived deltas.
 * Negatives: delta * lerp(negMin, negMax, sensitivity) * (1 - tolerance * toleranceDamp).
 * Positives: delta * lerp(posMin, posMax, sensitivity) (milder).
 */
export const PERCEPTION_SCALE = {
  negMin: 0.3,
  negMax: 1.6,
  toleranceDamp: 0.25,
  posMin: 0.7,
  posMax: 1.2,
} as const;

/* ───────────── Prompt A Phase 6: price / availability perception ───────────── */

/**
 * Reasonable price = basePrice * lerp(factorLowSens, factorHighSens, priceSens)
 *                   * (1 + stableVariation(name, drinkId)).
 * Low priceSens (tolerant/"rich") accepts higher prices; high priceSens wants cheaper.
 */
export const PRICE_PERCEPTION = {
  /** Multiplier on basePrice at priceSens=0 (tolerant). */
  factorLowSens: 1.4,
  /** Multiplier on basePrice at priceSens=1 (sensitive). */
  factorHighSens: 0.8,
  /** Stable per-patron per-drink jitter on the reasonable price (±). */
  variationMin: -0.08,
  variationMax: 0.08,
  /**
   * Ratio = publicPrice / reasonable. First band whose maxRatio ≥ ratio wins.
   * Base deltas are then scaled by priceSens via applyPerceivedExperience.
   */
  bands: [
    { band: 'cheap', maxRatio: 0.85, delta: 2 },
    { band: 'reasonable', maxRatio: 1.1, delta: 0 },
    { band: 'slightly_high', maxRatio: 1.35, delta: -3 },
    { band: 'very_high', maxRatio: 1.7, delta: -7 },
    { band: 'extreme', maxRatio: Number.POSITIVE_INFINITY, delta: -12 },
  ] as const,
  /** Refuse chance at very_high: lerp(min, max, priceSens). */
  veryHighRefuseMin: 0.12,
  veryHighRefuseMax: 0.5,
  /** Refuse chance at extreme: lerp(min, max, priceSens). Never 100%. */
  extremeRefuseMin: 0.4,
  extremeRefuseMax: 0.92,
} as const;

/**
 * Out-of-stock reaction for the patron's WANTED drink only (never global).
 * Base penalty is scaled by preference strength, then by availSens + tolerance
 * via applyPerceivedExperience (PERCEPTION_SCALE).
 */
export const AVAIL_REACTION = {
  /** Base sat delta when preferred drink stock is 0 (before pref / trait scale). */
  basePenalty: -6,
  /** After applying penalty: P(skip buying an alternative). */
  skipBase: 0.08,
  /** Extra skip chance per |appliedPenalty| point. */
  skipPerPenaltyPoint: 0.035,
  /** Tolerance reduces skip chance. */
  skipTolDamp: 0.45,
  /** Cap so some patrons always try an alternative. */
  skipMax: 0.55,
} as const;

/** Debug ring size for getPricingDebug(). */
export const PRICING_DEBUG_CAP = 40;
