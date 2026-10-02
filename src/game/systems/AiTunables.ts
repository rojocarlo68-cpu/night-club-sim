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
  /** Soft comfort score used when comparing bar vs seats. */
  barComfortEquivalent: 48,
  /** Weight (0–1) toward seating when best seat beats bar equivalent. */
  seatPreferBias: 0.72,
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
  /** Max bar queue slots near interact. */
  barQueueMaxSlots: 5,
  /** Extra cleanliness decay multiplier when already dirty (<60). */
  dirtyDecayBoost: 1.55,
  wanderIdleMinMs: 1800,
  wanderIdleMaxMs: 3500,
  postJobThinkMinMs: 500,
  postJobThinkMaxMs: 900,

  // ── Pinball (placeholder) ──
  /** Chance an arriving patron plays pinball first (needs a free, walkable front tile). */
  pinballPlayChance: 0.4,
  /** Standing play time at the machine (ms). */
  pinballPlayMinMs: 6000,
  pinballPlayMaxMs: 10000,
  /** Pay per play ($, rounded) before the condition / cleanliness scale. */
  pinballPayMin: 2,
  pinballPayMax: 5,
  /** Pay scale at worst (0% quality) → best (100%); quality = condition x cleanliness. */
  pinballQualityMin: 0.4,
  pinballQualityMax: 1.0,
  /** Durability / cleanliness cost per play (on top of normal decay). */
  pinballPlayWear: 1.2,
  pinballPlayDirt: 3,
  /** Passive wear multiplier vs. the price-based decay (moderate: ~2x a DJ booth). */
  pinballDecayMul: 2,
} as const;

/** Tile in front of the pinball (where patrons stand) per facing: [dCol, dRow] from its tile.
 *  The machine "faces" the screen direction of its name: se = lower-right (+col), sw = lower-left
 *  (+row), nw = upper-left (-col), ne = upper-right (-row). Adjust here if the art changes. */
export const PINBALL_FRONT_OFFSET: Record<'se' | 'sw' | 'ne' | 'nw', [number, number]> = {
  se: [1, 0],
  sw: [0, 1],
  nw: [-1, 0],
  ne: [0, -1],
};

/** Furniture types patrons can sit at (one claimed tile per seat). */
export const SEATABLE_TYPES = new Set([
  'sofa',
  'silla',
  'banqueta',
  'mesa_vip',
  'mesa_cocktail',
]);

/** Spanish floating / panel status keys → label */
export const STATUS_ES: Record<string, string> = {
  waiting: 'Esperando',
  impatient: 'Impaciente',
  angry: 'Enfadado',
  seated: 'Sentado',
  cleaning: 'Limpiando',
  resting: 'Descansando',
  serving: 'Atendiendo',
  wandering: 'Deambulando',
  walking: 'Caminando',
  drinking: 'Bebiendo',
  playing: 'Jugando pinball',
  leaving: 'Saliendo',
  idle: 'Libre',
  busy: 'Ocupada',
  relaxing: 'Sentado',
  serving_cerveza: 'Sirviendo cerveza',
  serving_drink: 'Sirviendo bebida',
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
