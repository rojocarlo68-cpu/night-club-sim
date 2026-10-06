/**
 * FUTURE customer intoxication — ARCHITECTURE ONLY. Does NOT alter gameplay.
 *
 * Data on each Patron (entities/Patron.ts):
 *   alcoholTolerance  stable per customer identity (rolled here from the name hash)
 *   alcoholIntake     alcohol units consumed this visit (accumulated on every consumption)
 *   lastAlcoholAt     time of the last alcoholic drink
 * Computed:
 *   patronIntoxication(p, now) → 0..1     patronIntoxicationLevel(p, now) → 'sober' | 'tipsy' | 'drunk'
 *
 * Alcohol per drink comes from config/drinks.ts (alcoholUnits), shared with the staff model.
 *
 * HOOK POINTS for the future system (none of them read the level today):
 *   1. ClubScene.noteConsumptionTrash → notePatronConsumption (every consumption already flows here)
 *   2. ClubScene.chooseMainPatronGoal / afterBarService → "another round?" decision (longer stays)
 *   3. ClubScene.patronThink → intoxication emotes (🍺 / 🤪 / 😵‍💫 reserved in config/thoughts.ts)
 *   4. Patron walk speed / wander target → staggering
 *   5. Satisfaction / tips (systems/SatisfactionTips.ts) → generous-when-tipsy, trouble-when-drunk
 */
import { drinkAlcoholUnits } from '../config/drinks';
import { PATRON_ALCOHOL } from '../config/intoxication';

export type IntoxicationLevel = 'sober' | 'tipsy' | 'drunk';

export interface IntoxicationSubject {
  profile: { name?: string; id?: string };
  alcoholTolerance: number;
  alcoholIntake: number;
  lastAlcoholAt: number;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Stable tolerance per customer identity (same person → same tolerance on every visit). */
export function rollPatronAlcoholTolerance(identity: string): number {
  const [a, b] = PATRON_ALCOHOL.toleranceRange;
  const u = (hashStr(`tol|${identity || 'x'}`) % 10000) / 10000;
  return Math.round((a + u * (b - a)) * 100) / 100;
}

/** Initialise the fields on spawn (no behaviour attached). */
export function initPatronIntoxication(p: IntoxicationSubject): void {
  p.alcoholTolerance = rollPatronAlcoholTolerance((p.profile.name || p.profile.id || '').trim());
  p.alcoholIntake = 0;
  p.lastAlcoholAt = 0;
}

/** Accumulate alcohol for a consumed product (0-unit products are ignored). */
export function notePatronConsumption(p: IntoxicationSubject, productId: string, now: number): number {
  const units = drinkAlcoholUnits(productId);
  if (units <= 0) return 0;
  p.alcoholIntake = Math.round((p.alcoholIntake + units) * 100) / 100;
  p.lastAlcoholAt = now;
  return units;
}

/** 0..1 — computed only; not consumed by any behaviour yet. */
export function patronIntoxication(p: IntoxicationSubject, now: number): number {
  if (!(p.alcoholIntake > 0)) return 0;
  const tol = Math.max(0.2, Math.min(1, p.alcoholTolerance || 0.6));
  const raw = p.alcoholIntake * PATRON_ALCOHOL.perUnit * (0.5 / tol);
  const elapsedSec = p.lastAlcoholAt > 0 ? Math.max(0, (now - p.lastAlcoholAt) / 1000) : 0;
  return Math.max(0, Math.min(1, raw - elapsedSec * PATRON_ALCOHOL.decayPerSec));
}

export function patronIntoxicationLevel(p: IntoxicationSubject, now: number): IntoxicationLevel {
  const x = patronIntoxication(p, now);
  if (x >= PATRON_ALCOHOL.drunkAt) return 'drunk';
  if (x >= PATRON_ALCOHOL.tipsyAt) return 'tipsy';
  return 'sober';
}
