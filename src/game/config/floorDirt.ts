/**
 * Floor dirt / sweep / mop tunables (day-start prep).
 * Integrates with existing cleanliness perception — not a parallel satisfaction system.
 */

/** Zone size in tiles (12×12 map → 3×3 zones of 4×4). */
export const FLOOR_ZONE_SIZE = 4;

/** dryDirt / grime 0–100 thresholds → perception bands. */
export const FLOOR_DIRT_BANDS = {
  cleanBelow: 20,
  slightBelow: 45,
  dirtyBelow: 70,
  /** Perception deltas (scaled by cleanSens like furniture dirt). */
  delta: {
    clean: 0,
    slight: -2,
    dirty: -5,
    very_dirty: -9,
  },
} as const;

/** Staff AI picks a zone when dryDirt ≥ this. */
export const SWEEP_THRESHOLD = 28;
/** Staff AI picks a zone for mop when grime ≥ this (prefer after sweep). */
export const MOP_THRESHOLD = 22;

/** How much one sweep / mop job reduces. */
export const SWEEP_RESTORE = 38;
export const MOP_RESTORE = 42;

export const SWEEP_DURATION_MS = 2200;
export const MOP_DURATION_MS = 2600;

/** Energy cost ranges for floor jobs. */
export const FLOOR_JOB_ENERGY = { min: 4, max: 9 };

/**
 * Seed on day start after a used night (or first load demo dirt).
 * Applied as dryDirt / grime additions to random zones.
 */
export const FLOOR_SEED_AFTER_USED_NIGHT = {
  zonesMin: 2,
  zonesMax: 4,
  dryMin: 35,
  dryMax: 75,
  grimeMin: 25,
  grimeMax: 60,
} as const;

/** Light remnant even on a quiet night so prep is sometimes visible. */
export const FLOOR_SEED_QUIET_NIGHT = {
  zonesMin: 0,
  zonesMax: 2,
  dryMin: 20,
  dryMax: 45,
  grimeMin: 15,
  grimeMax: 35,
} as const;

/** Visual stain alpha range for overlays. */
export const FLOOR_VISUAL = {
  color: 0x3a2a18,
  alphaMin: 0.12,
  alphaMax: 0.48,
  depth: 35,
} as const;
