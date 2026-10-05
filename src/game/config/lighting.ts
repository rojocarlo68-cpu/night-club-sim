/**
 * Prompt B Phase B3 — closed/open club lighting (visual only).
 * Does not affect gameplay, spawn, or the 75s timer.
 */

/** Full-screen dim overlay color while the club is closed / in summary. */
export const CLOSED_OVERLAY_COLOR = 0x08060f;

/** Overlay alpha when CLOSED or SUMMARY (0 = full bright, 1 = blackout). */
export const CLOSED_OVERLAY_ALPHA = 0.55;

/** Overlay alpha when OPEN or CLOSING. */
export const OPEN_OVERLAY_ALPHA = 0;

/** Fade duration when switching closed ↔ open (ms). */
export const LIGHTS_FADE_MS = 600;

/** Camera / void background while closed (slightly darker than open). */
export const CLOSED_BG_COLOR = '#100c0a';

/** Camera / void background while open (matches ClubScene BG_COLOR). */
export const OPEN_BG_COLOR = '#1a1411';

/** Depth of the dim overlay: above iso sprites, below selection/build HUD. */
export const LIGHTS_OVERLAY_DEPTH = 8500;
