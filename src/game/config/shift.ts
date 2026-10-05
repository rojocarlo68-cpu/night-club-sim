/**
 * Prompt B — central tunables for the shift / game-time clock.
 * Day-start correction: clock TICKS while CLOSED from 17:00; Abrir opens at current time.
 */

/** Recommended club hours (informational; not a hard lock). */
export const RECOMMENDED_OPEN_HOUR = 18;
export const RECOMMENDED_OPEN_MINUTE = 0;
export const RECOMMENDED_CLOSE_HOUR = 2;
export const RECOMMENDED_CLOSE_MINUTE = 0;

/** Default wall-clock when a day starts closed (before Abrir noche). Clock ticks from here. */
export const PRE_OPEN_HOUR = 17;
export const PRE_OPEN_MINUTE = 0;

/**
 * Real seconds that must elapse for one game-minute to advance while CLOSED/OPEN/CLOSING.
 * 1 → one game minute per real second (easy to verify in smoke tests).
 */
export const REAL_SECONDS_PER_GAME_MINUTE = 1;

/** Derived helper (game minutes advanced per real second). */
export const CLOCK_SPEED_GAME_MINUTES_PER_REAL_SECOND =
  1 / REAL_SECONDS_PER_GAME_MINUTE;

/** Desktop schedule hint under the clock. */
export const SCHEDULE_LABEL = 'Horario sugerido: Lun–Dom · 18:00 — 02:00';

/** Shorter hint for narrow / mobile HUD. */
export const SCHEDULE_LABEL_MOBILE = 'Horario: 18:00 — 02:00';

/** Compact recommended range (debug / short lines). */
export const SCHEDULE_RANGE_SHORT = '18:00 — 02:00';

/**
 * B7 CLOSING: after this many real ms, nudge remaining patrons to leave via sendPatronHome.
 * They finish walking out; not an instant despawn.
 */
export const CLOSING_NUDGE_AFTER_MS = 20000;

/**
 * B7 CLOSING safety: if patrons still on the floor after this, force SUMMARY
 * (destroys leftovers). Generous so normal visits can finish.
 */
export const CLOSING_FORCE_SUMMARY_MS = 120000;

/**
 * When true, Abrir snaps clock to recommended open (18:00).
 * Day-start correction: false — open at the current ticking CLOSED clock.
 */
export const USE_SNAP_TO_RECOMMENDED_OPEN = false;

/**
 * Staff (Luna/Nova) become visible this many game minutes after day start (17:00).
 * With REAL_SECONDS_PER_GAME_MINUTE=1 → ~5 real seconds.
 */
export const STAFF_ARRIVE_GAME_MINUTES_AFTER_DAY_START = 5;

/** Optional ± jitter (game minutes) around staff arrival. 0 = exact. */
export const STAFF_ARRIVE_JITTER_GAME_MINUTES = 1;
