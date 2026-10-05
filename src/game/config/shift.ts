/**
 * Prompt B — central tunables for the shift / game-time clock.
 * B1: structure + defaults only. Clock tick / UI / organic spawn come in later phases.
 */

/** Recommended club hours (informational; not a hard lock). */
export const RECOMMENDED_OPEN_HOUR = 18;
export const RECOMMENDED_OPEN_MINUTE = 0;
export const RECOMMENDED_CLOSE_HOUR = 2;
export const RECOMMENDED_CLOSE_MINUTE = 0;

/** Default wall-clock when a day starts closed (before Abrir noche). */
export const PRE_OPEN_HOUR = 17;
export const PRE_OPEN_MINUTE = 0;

/**
 * How many game-minutes advance per real second while the shift is OPEN.
 * Placeholder for B2 — not driven yet in B1.
 */
export const CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND = 1;

/** Discreet schedule label for future HUD (B2). */
export const SCHEDULE_LABEL = 'Lunes a Domingo · 18:00 — 02:00';

/** Compact recommended range for short HUD lines. */
export const SCHEDULE_RANGE_SHORT = '18:00 — 02:00';
