/**
 * Phase 4: energy / mood behaviour bands for tip actions.
 * Uses the EXISTING staff stats (Bartender.profile.energy / .mood, scale 0..100).
 * All values are tuning knobs — balance later.
 */

export type StatBand = 'high' | 'medium' | 'low' | 'critical';

/** Scale of the existing energy / mood stats. */
export const STAFF_STAT_MAX = 100;

/** Normalized (0..1) lower bounds; below LOW is CRITICAL. */
export const ENERGY_BANDS = { high: 0.6, medium: 0.35, low: 0.15 };
export const MOOD_BANDS = { high: 0.6, medium: 0.35, low: 0.15 };

/** Special-action weight multiplier per band (critical = no special actions). */
export const ENERGY_BAND_MULT: Record<StatBand, number> = {
  high: 1.0,
  medium: 0.5,
  low: 0.15,
  critical: 0,
};
export const MOOD_BAND_MULT: Record<StatBand, number> = {
  high: 1.0,
  medium: 0.5,
  low: 0.15,
  critical: 0,
};

/**
 * Effort scaling: the band penalty applies at EFFORT_MIN_SCALE for the cheapest
 * action and at full strength for the costliest one (dance suppressed more than kiss).
 */
export const EFFORT_MIN_SCALE = 0.6;

/** Multiplier on the "basic service" (no special) weight — bad mood / tiredness → more basic. */
export const MOOD_BASIC_BOOST: Record<StatBand, number> = {
  high: 1.0,
  medium: 1.3,
  low: 1.8,
  critical: 2.5,
};
export const ENERGY_BASIC_BOOST: Record<StatBand, number> = {
  high: 1.0,
  medium: 1.15,
  low: 1.5,
  critical: 2.0,
};

/** Service-quality factor on the base tip chance by mood band. */
export const MOOD_SERVICE_TIP_FACTOR: Record<StatBand, number> = {
  high: 1.0,
  medium: 0.95,
  low: 0.85,
  critical: 0.75,
};

export function bandOf(value: number, bands: { high: number; medium: number; low: number }): StatBand {
  const v = Math.max(0, Math.min(1, value / STAFF_STAT_MAX));
  if (v >= bands.high) return 'high';
  if (v >= bands.medium) return 'medium';
  if (v >= bands.low) return 'low';
  return 'critical';
}

export const energyBand = (energy: number): StatBand => bandOf(energy, ENERGY_BANDS);
export const moodBand = (mood: number): StatBand => bandOf(mood, MOOD_BANDS);

/** Compact performance label for the selection panel. */
export function performanceLabel(energy: number, mood: number): 'alto' | 'medio' | 'bajo' {
  const e = energyBand(energy);
  const m = moodBand(mood);
  if (e === 'high' && m === 'high') return 'alto';
  if (e === 'low' || e === 'critical' || m === 'low' || m === 'critical') return 'bajo';
  return 'medio';
}
