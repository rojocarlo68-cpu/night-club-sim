/**
 * Per-staff personality (Phase 2).
 * Tuning values — balance later without rewriting behaviour code.
 * Floats are 0..1. actionAffinity predisposes tip-actions ('dance','kiss','photo').
 */

export interface Personality {
  ambition: number;
  sociability: number;
  stamina: number;
  moodBase: number;
  disinhibition: number;
  /** Predisposition per tip-action id (0 = avoid, 1 = eager). */
  actionAffinity: Record<string, number>;
}

/** Named profiles for known staff. Values are tuning knobs, not final balance. */
export const STAFF_PERSONALITIES: Record<string, Personality> = {
  bartender_luna: {
    ambition: 0.85,
    sociability: 0.85,
    stamina: 0.7,
    moodBase: 0.75,
    disinhibition: 0.85,
    actionAffinity: { dance: 0.9, kiss: 0.8, photo: 0.7 },
  },
  staff_nova: {
    ambition: 0.5,
    sociability: 0.55,
    stamina: 0.6,
    moodBase: 0.65,
    disinhibition: 0.2,
    actionAffinity: { dance: 0.05, kiss: 0.3, photo: 0.75 },
  },
};

/** Simple deterministic hash of a string → uint32. */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32-ish next float in [0,1) from a seed counter. */
function seededUnit(seed: number, salt: number): number {
  let t = (seed + salt * 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Personality for a staff id; known profiles first, else seeded-random (stable per id). */
export function getPersonality(id: string): Personality {
  const known = STAFF_PERSONALITIES[id];
  if (known) return known;
  const seed = hashId(id || 'staff');
  return {
    ambition: clamp01(0.25 + seededUnit(seed, 1) * 0.7),
    sociability: clamp01(0.2 + seededUnit(seed, 2) * 0.75),
    stamina: clamp01(0.35 + seededUnit(seed, 3) * 0.55),
    moodBase: clamp01(0.35 + seededUnit(seed, 4) * 0.55),
    disinhibition: clamp01(0.1 + seededUnit(seed, 5) * 0.85),
    actionAffinity: {
      dance: clamp01(seededUnit(seed, 6)),
      kiss: clamp01(seededUnit(seed, 7)),
      photo: clamp01(seededUnit(seed, 8)),
    },
  };
}

/** Map 0..1 to Spanish level labels. */
export function personalityLevel(v: number): string {
  if (v < 0.35) return 'baja';
  if (v < 0.7) return 'media';
  return 'alta';
}

/** Compact summary rows for the selection panel. */
export function personalitySummary(
  p: Personality
): { label: string; level: string }[] {
  return [
    { label: 'Ambición', level: personalityLevel(p.ambition) },
    { label: 'Sociable', level: personalityLevel(p.sociability) },
    { label: 'Desinhibida', level: personalityLevel(p.disinhibition) },
  ];
}
