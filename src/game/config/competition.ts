/**
 * Gradual staff competitiveness (Phase 6).
 * Tuning only — balance later without rewriting behaviour.
 * Competitiveness never bypasses personality requirements or energy/mood gates.
 */

/** Game-time ms between peer observations while the night is open. */
export const OBSERVE_INTERVAL_MS = 20_000;

/**
 * Relative gap before she cares: peer rolling tips must exceed hers by this
 * fraction (e.g. 0.25 = peer earns >25% more).
 */
export const GAP_THRESHOLD = 0.25;

/** Base rise per observation when behind (scaled by ambition²). */
export const RISE_RATE = 0.03;

/** Slow relax per observation when she is not behind. */
export const DECAY_RATE = 0.015;

export const MAX_COMPETITIVENESS = 1.0;

/** Cap absolute |Δ| per single observation (keeps evolution gradual). */
export const MAX_DELTA_PER_OBS = 0.08;

/**
 * Rolling history decay applied each observation so one lucky tip does not
 * dominate — "consistently more" earnings matter.
 */
export const HISTORY_DECAY = 0.97;

/** special-action weight multiplier = 1 + competitiveness * this. */
export const SPECIAL_WEIGHT_BONUS = 0.6;

/** basic-service weight multiplier = 1 - competitiveness * this (floored). */
export const BASIC_WEIGHT_REDUCTION = 0.25;

/** Minimum basic-service weight factor after competitiveness reduction. */
export const BASIC_WEIGHT_FLOOR = 0.55;

/** Panel: only show the line when competitiveness exceeds this. */
export const PANEL_SHOW_THRESHOLD = 0.15;

/** Panel label bands (inclusive lower bounds). */
export const PANEL_LABEL_BANDS = {
  unPoco: 0.15,
  bastante: 0.4,
  mucho: 0.7,
} as const;

/** Spanish panel text for a competitiveness value (caller checks threshold). */
export function competitivenessLabel(c: number): string {
  if (c >= PANEL_LABEL_BANDS.mucho) return 'mucho';
  if (c >= PANEL_LABEL_BANDS.bastante) return 'bastante';
  return 'un poco';
}
