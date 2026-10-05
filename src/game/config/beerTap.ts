/**
 * Beer tap (grifo) as specialized cerveza service point.
 * Subtle bonuses only — specialization, not a huge auto-upgrade.
 */

/** Drink id served at the tap (uses existing cerveza inventory). */
export const BEER_TAP_DRINK_ID = 'cerveza';

/** Catalog / furniture type id for a functional beer tap. */
export const BEER_TAP_CATALOG_ID = 'beer_tap';

/**
 * Small outcome bonuses when cerveza is served at a working tap
 * (vs the same cerveza at the bar). Kept tiny on purpose.
 */
export const BEER_TAP_BONUS = {
  /** One-shot satisfaction delta when served at tap (beer-preferring clients). */
  satDeltaPreferBeer: 2.2,
  /** Smaller sat delta when indifferent / non-beer primary. */
  satDeltaOther: 1.0,
  /** Added to tip chance (absolute, e.g. 0.04 = +4%). */
  tipChanceBonus: 0.035,
  /** Multiplier on tip amount when a tip lands. */
  tipAmountMult: 1.06,
} as const;

/** Per-visit beer-service preference (behaviour hook, not a UI meter). */
export type BeerServicePref = 'tap' | 'bar' | 'indifferent';

/** Weights when rolling beerServicePref on patron spawn. */
export const BEER_SERVICE_PREF_WEIGHTS = {
  tap: 0.22,
  bar: 0.18,
  indifferent: 0.6,
} as const;

/** Roll a beer-service preference for a new visit. */
export function rollBeerServicePref(rand = Math.random): BeerServicePref {
  const u = rand();
  if (u < BEER_SERVICE_PREF_WEIGHTS.tap) return 'tap';
  if (u < BEER_SERVICE_PREF_WEIGHTS.tap + BEER_SERVICE_PREF_WEIGHTS.bar) return 'bar';
  return 'indifferent';
}

/**
 * Should this patron walk to the tap (when a functional tap exists)?
 * Pref 'bar' mostly stays at the bar; 'tap' / indifferent use the tap.
 */
export function prefersBeerTap(pref: BeerServicePref, rand = Math.random): boolean {
  if (pref === 'tap') return true;
  if (pref === 'indifferent') return true;
  // Rarely still try the tap even if they "prefer bar beer"
  return rand() < 0.12;
}
