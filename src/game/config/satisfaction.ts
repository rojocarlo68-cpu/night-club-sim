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
