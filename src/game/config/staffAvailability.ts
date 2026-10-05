/**
 * Prompt B Phase B11 — staff absence hooks (future).
 *
 * TODO (not implemented): rare “someone called in sick” event that flips
 * StaffAvailability to false for one night and reduces arrivals staffCount.
 * Spawn / arrivals already receive staffCount from the scene — only the
 * absence event + UI are missing.
 */

/** Default: everyone scheduled is available. */
export const STAFF_AVAILABLE_BY_DEFAULT = true;
