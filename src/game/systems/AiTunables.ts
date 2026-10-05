/**
 * Tunable AI / economy knobs for patron patience, seating, tips, staff priorities.
 * Adjust here without hunting magic numbers across ClubScene.
 */
export const AI_TUNABLES = {
  /** Multiplier on each patron's profile.patience (seconds waiting at bar). */
  patienceScale: 1.75,
  /** Extra seconds after scale (keeps short profiles playable). */
  patienceBonusSec: 6,
  /**
   * When remaining/max patience drops below this → Impaciente.
   * At 0 remaining → Enfadado and leave (no pay).
   */
  impatientAtRatio: 0.45,
  /** Energy below this → AI may Descansar (after serve/clean). */
  restEnergyThreshold: 32,
  /** Cleanliness below this → AI Limpiar (any furniture). */
  cleanThreshold: 70,
  /** Tip size multiplier range from venue quality (0–1). */
  tipQualityMin: 0.35,
  tipQualityMax: 1.55,
  /** Drink pay multiplier range from venue quality. */
  payQualityMin: 0.85,
  payQualityMax: 1.2,
  /** Mood hit when near Inservible / Se rompió furniture. */
  brokenFurnitureMoodPenalty: 18,
  /** Tip chance scale while Impaciente. */
  impatientTipChanceScale: 0.35,
  /** Sit duration on furniture before leaving happily (ms). */
  sitDurationMinMs: 5500,
  sitDurationMaxMs: 10000,
  /** Extra cleanliness decay multiplier when already dirty (<60). */
  dirtyDecayBoost: 1.55,
  wanderIdleMinMs: 1800,
  wanderIdleMaxMs: 3500,
  postJobThinkMinMs: 500,
  postJobThinkMaxMs: 900,

  /** Max patrons queued around the bar waiting for service (the rest skip the drink and wander). */
  barQueueMaxSlots: 5,

  // ── Sofa seating (after the drink; also the fallback income when there is no bar) ──
  /** Chance a patron heads for a free sofa seat (after the drink, or on arrival with no bar); otherwise they wander and leave. */
  seatChance: 0.75,
  /** Fallback only (no bar in the club): pay ($) when a patron finishes sitting, before the venue-quality multiplier. */
  sofaSitPayMin: 3,
  sofaSitPayMax: 6,
  /** Wander stops (tiles walked to) before leaving, and idle time at each stop (ms). */
  wanderStopsMin: 1,
  wanderStopsMax: 3,
  wanderStopIdleMinMs: 1200,
  wanderStopIdleMaxMs: 3200,
} as const;

/** Furniture types patrons can sit at (one claimed tile per seat). */
export const SEATABLE_TYPES = new Set(['sofa']);

/** Spanish floating / panel status keys → label */
export const STATUS_ES: Record<string, string> = {
  waiting: 'Esperando',
  impatient: 'Impaciente',
  angry: 'Enfadado',
  seated: 'Sentado',
  cleaning: 'Limpiando',
  sweeping: 'Barriendo',
  mopping: 'Trapeando',
  resting: 'Descansando',
  serving: 'Atendiendo',
  wandering: 'Deambulando',
  walking: 'Caminando',
  drinking: 'Bebiendo',
  leaving: 'Saliendo',
  idle: 'Libre',
  busy: 'Ocupada',
  relaxing: 'Sentado',
};

export function scaledPatienceSeconds(profilePatience: number): number {
  return Math.max(
    4,
    profilePatience * AI_TUNABLES.patienceScale + AI_TUNABLES.patienceBonusSec
  );
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
