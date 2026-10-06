/**
 * Prompt A Phase 10: placeholder reputation / return-chance config.
 * getReturnChanceHint() uses these — NOT wired to spawning yet (TODO).
 */

/** Recent visit sats kept per patron identity name. */
export const REPUTATION_VISIT_CAP = 12;

/**
 * Piecewise return-chance hint from average recent satisfaction (0..100 → 0..1).
 * Placeholder curves for future spawn weighting — do not use in spawnPatron yet.
 */
export const RETURN_CHANCE = {
  atSat0: 0.12,
  atSat50: 0.48,
  atSat100: 0.88,
  /** Blend toward this when no history yet. */
  defaultWhenUnknown: 0.55,
} as const;

/* ───────────── Club demand (hidden) — reputation with inertia ───────────── */

/**
 * Hidden club reputation 0..100 (never shown). Fed ONCE per night from what actually happened,
 * with inertia: one bad customer / one bad night → small change; streaks compound; long
 * excellent management → notable growth. Feeds the organic arrival scheduler (demand.ts).
 */
export const CLUB_REPUTATION = {
  start: 50,
  min: 0,
  max: 100,
  /** Fraction of the gap (nightQuality − reputation) applied per night (before streak boost). */
  alpha: 0.16,
  /** Bounded per-night change (one night can never swing it much). */
  maxUpPerNight: 4,
  maxDownPerNight: 5,
  /** Consecutive good/bad nights compound: alpha × (1 + boost × min(streak−1, cap)). */
  streakBoostPerNight: 0.18,
  streakBoostCap: 4,
  /** Night quality ≥ goodAt counts toward a good streak; ≤ badAt toward a bad streak. */
  goodAt: 60,
  badAt: 45,
  /** Visits needed for a night to count as full evidence (fewer → proportionally smaller step). */
  evidenceVisits: 4,
  /**
   * Empty night (nobody came): no artificial punishment — reputation drifts very slightly toward
   * what the venue itself offers (amenities), so an empty club can recover by improving.
   */
  emptyNightDrift: 0.05,
  /** Exit satisfaction below this = an unhappy customer. */
  unhappySatBelow: 45,
} as const;

/** Night-quality ingredients (0..100 scale). Moderate weights; no single factor dominates. */
export const NIGHT_QUALITY = {
  /**
   * Base: 50 + (avgExitSat − satPivot) × satGain. Exit sat 70 is the neutral visit (BASE_SATISFACTION),
   * so an unremarkable night ≈ 50 (stable reputation); better experiences raise it, worse lower it.
   */
  satPivot: 70,
  satGain: 1.6,
  /** Unhappy exits share → up to −22. */
  unhappyShareWeight: 22,
  /** Left without buying (price / out of stock / nothing left) share → up to −14. */
  leftWithoutBuyWeight: 14,
  /** Each product that ran out tonight. */
  stockoutEach: 2.5,
  stockoutCap: 10,
  /** Each broken / unusable piece left unrepaired at closing. */
  brokenEach: 3,
  brokenCap: 9,
  /** Floor trash at closing beyond `trashFree` pieces; a full bag lying around. */
  trashFree: 3,
  trashEach: 0.8,
  trashCap: 6,
  fullBag: 2,
  /** Staff ended the night exhausted (average energy below this). */
  exhaustedBelow: 18,
  exhausted: 4,
  /** Venue amenities (seats, comfort, decor, entertainment, variety) → up to +12. */
  amenityMax: 12,
} as const;

/** Reputation → organic arrival multiplier (interval divisor + soft-cap ceiling). */
export const REPUTATION_DEMAND_MULT = { at0: 0.35, at50: 1.0, at100: 2.3 } as const;

/**
 * Returning visitors (hook kept simple): when a visit ends we roll a hidden return intent from
 * recent satisfaction (getReturnChanceHint) + affinity. Intentions wait in a small pool; on later
 * nights some arrivals come from it (flagged `recurrent`, remembering their favourite staff).
 */
export const RETURNING = {
  poolCap: 12,
  /** Intentions fade after this many nights. */
  expireNights: 7,
  /** Chance an arrival is taken from the pool (when non-empty). */
  pickChance: 0.55,
  /** Bonus to the return roll when the customer liked who served them. */
  affinityBonus: 0.12,
  /** Visits below this exit satisfaction never create a return intent. */
  minSat: 40,
  /** Extra soft-cap potential from loyal customers (min(pool, max)). */
  softCapBonusMax: 2,
} as const;
