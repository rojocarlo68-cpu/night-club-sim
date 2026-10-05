/**
 * Prompt B Phase B4 — organic patron arrivals (early-night conservative).
 * Times are in GAME minutes (see REAL_SECONDS_PER_GAME_MINUTE in shift.ts).
 * Soft cap is a ceiling, NOT a fill target.
 */

/** Soft max patrons that may spawn in an early night (do not force-fill). */
export const EARLY_NIGHT_SOFT_CAP = 6;

/** Placeholder base demand (B5+/B11 will scale this). */
export const BASE_DEMAND = 1;

/** First arrival delay after Abrir (game minutes). Never 0. */
export const FIRST_ARRIVAL_MIN_GAME_MINUTES = 3;
export const FIRST_ARRIVAL_MAX_GAME_MINUTES = 10;

/** Gap between arrival events (solo or after a group finishes). */
export const MIN_INTERVAL_GAME_MINUTES = 4;
export const MAX_INTERVAL_GAME_MINUTES = 18;

/** Chance an arrival event is a small group (size 2). */
export const GROUP_CHANCE = 0.18;
export const MAX_GROUP_SIZE = 2;
/** Extra members arrive this many game minutes after the first of the group. */
export const GROUP_STAGGER_GAME_MINUTES = 1;

/** After scheduling a normal interval, chance to stretch it (quiet period). */
export const QUIET_STRETCH_CHANCE = 0.32;
export const QUIET_INTERVAL_MULT = 1.75;

/** Stop new arrivals when legacy nightTimer is below this (seconds). */
export const STOP_SPAWN_WHEN_NIGHT_TIMER_BELOW_SEC = 8;

/**
 * Mild mid-evening peak: multiplies demand (shorter intervals when > 1).
 * Keys = game hour. Default 1 if missing.
 */
export const HOUR_DEMAND_MULT: Record<number, number> = {
  18: 0.9,
  19: 1.15,
  20: 1.2,
  21: 1.05,
  22: 0.85,
  23: 0.75,
  0: 0.7,
  1: 0.65,
  2: 0.6,
};

/** Extra random jitter (±) applied to rolled intervals (game minutes). */
export const INTERVAL_JITTER_GAME_MINUTES = 1;
