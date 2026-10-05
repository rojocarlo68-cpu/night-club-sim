/**
 * Prompt A Phase 6: per-patron drink price / availability perception.
 * Does NOT mutate inventory or invent navigation — ClubScene decides buy/alt/skip.
 */

import {
  PRICE_PERCEPTION,
  AVAIL_REACTION,
  PRICING_DEBUG_CAP,
  PERCEPTION_SCALE,
} from '../config/satisfaction';
import { getDrinkProduct } from '../config/drinks';
import {
  applyPerceivedExperience,
  getExperience,
  patronExperienceKey,
  type CustomerTraits,
} from './CustomerExperience';
import { prefFor } from './DrinkPreferences';

export type PriceBand =
  (typeof PRICE_PERCEPTION.bands)[number]['band'];

export type PricingDecision = 'bought' | 'alt' | 'skip' | 'oos_penalty';

export interface PricingDebugEntry {
  patronName: string;
  drinkId: string;
  price: number;
  reasonable: number;
  ratio: number;
  band?: PriceBand;
  decision: PricingDecision;
  penalty: number;
  refused?: boolean;
  atMs: number;
}

export interface PriceEval {
  drinkId: string;
  price: number;
  reasonable: number;
  ratio: number;
  band: PriceBand;
  baseDelta: number;
  refuse: boolean;
}

export interface OosEval {
  drinkId: string;
  prefStrength: number;
  baseDelta: number;
  skipBuy: boolean;
}

const lerp = (a: number, b: number, t: number) =>
  a + (b - a) * Math.max(0, Math.min(1, t));

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Stable unit float in [0,1) from name+drink (+salt). */
function stableUnit(name: string, drinkId: string, salt = 0): number {
  let t = (hashStr(`${name}|${drinkId}`) + salt * 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * What this patron considers a fair price for the drink.
 * Uses catalogue basePrice (not current public price) so player markups are visible as ratios.
 */
export function reasonablePriceFor(
  patron: { profile: { name?: string; id?: string } },
  drinkId: string,
  traits: Pick<CustomerTraits, 'priceSens'>
): number {
  const prod = getDrinkProduct(drinkId);
  const base = prod?.basePrice ?? 1;
  const factor = lerp(
    PRICE_PERCEPTION.factorLowSens,
    PRICE_PERCEPTION.factorHighSens,
    traits.priceSens
  );
  const key = patronExperienceKey(patron);
  const u = stableUnit(key, drinkId, 1);
  const variation =
    PRICE_PERCEPTION.variationMin +
    u * (PRICE_PERCEPTION.variationMax - PRICE_PERCEPTION.variationMin);
  const reasonable = base * factor * (1 + variation);
  return Math.max(0.5, Math.round(reasonable * 100) / 100);
}

function bandForRatio(ratio: number): (typeof PRICE_PERCEPTION.bands)[number] {
  for (const b of PRICE_PERCEPTION.bands) {
    if (ratio <= b.maxRatio) return b;
  }
  return PRICE_PERCEPTION.bands[PRICE_PERCEPTION.bands.length - 1];
}

function refuseChance(band: PriceBand, priceSens: number): number {
  if (band === 'extreme') {
    return lerp(
      PRICE_PERCEPTION.extremeRefuseMin,
      PRICE_PERCEPTION.extremeRefuseMax,
      priceSens
    );
  }
  if (band === 'very_high') {
    return lerp(
      PRICE_PERCEPTION.veryHighRefuseMin,
      PRICE_PERCEPTION.veryHighRefuseMax,
      priceSens
    );
  }
  return 0;
}

/**
 * Evaluate public price vs this patron's reasonable price.
 * Does not apply satisfaction — caller applies via applyPricePerception.
 */
export function evaluateDrinkPrice(
  patron: { profile: { name?: string; id?: string } },
  drinkId: string,
  publicPrice: number,
  traits: CustomerTraits,
  rng: () => number = Math.random
): PriceEval {
  const reasonable = reasonablePriceFor(patron, drinkId, traits);
  const price = Math.max(0, publicPrice);
  const ratio = reasonable > 0 ? price / reasonable : 1;
  const bandRow = bandForRatio(ratio);
  const refuseRoll = refuseChance(bandRow.band, traits.priceSens);
  const refuse = refuseRoll > 0 && rng() < refuseRoll;
  return {
    drinkId,
    price,
    reasonable,
    ratio: Math.round(ratio * 1000) / 1000,
    band: bandRow.band,
    baseDelta: bandRow.delta,
    refuse,
  };
}

/**
 * Apply one-shot price perception (`price:<drinkId>`). Returns applied delta (0 if already seen).
 */
export function applyPricePerception(
  patron: { profile: { name?: string; id?: string } },
  ev: PriceEval
): number {
  const detail = `${ev.band} ratio=${ev.ratio} $${ev.price}/~$${ev.reasonable}`;
  const applied = applyPerceivedExperience(
    patron,
    `price:${ev.drinkId}`,
    ev.baseDelta,
    'priceSens',
    detail
  );
  return applied ?? 0;
}

/**
 * Evaluate OOS of the wanted drink. skipBuy probability rises with |penalty| and low tolerance.
 */
export function evaluateOutOfStock(
  patron: { profile: { name?: string; id?: string; preferredDrink?: string } },
  drinkId: string,
  traits: CustomerTraits,
  rng: () => number = Math.random
): OosEval {
  const prefStrength = Math.max(0.05, prefFor(patron, drinkId));
  const baseDelta = AVAIL_REACTION.basePenalty * prefStrength;
  // Preview scaled magnitude for skip roll (same formula as applyPerceivedExperience).
  const sens = traits.availSens;
  const negScale =
    lerp(PERCEPTION_SCALE.negMin, PERCEPTION_SCALE.negMax, sens) *
    (1 - traits.tolerance * PERCEPTION_SCALE.toleranceDamp);
  const previewMag = Math.abs(baseDelta * negScale);
  let skipChance =
    AVAIL_REACTION.skipBase +
    previewMag * AVAIL_REACTION.skipPerPenaltyPoint -
    traits.tolerance * AVAIL_REACTION.skipTolDamp;
  skipChance = Math.max(0, Math.min(AVAIL_REACTION.skipMax, skipChance));
  return {
    drinkId,
    prefStrength: Math.round(prefStrength * 100) / 100,
    baseDelta: Math.round(baseDelta * 10) / 10,
    skipBuy: rng() < skipChance,
  };
}

/**
 * Apply one-shot OOS perception (`oos:<drinkId>`).
 */
export function applyOosPerception(
  patron: { profile: { name?: string; id?: string } },
  ev: OosEval
): number {
  const detail = `pref=${ev.prefStrength} skip=${ev.skipBuy}`;
  const applied = applyPerceivedExperience(
    patron,
    `oos:${ev.drinkId}`,
    ev.baseDelta,
    'availSens',
    detail
  );
  return applied ?? 0;
}

/* ── Debug ring ── */

const pricingDebug: PricingDebugEntry[] = [];

export function pushPricingDebug(entry: Omit<PricingDebugEntry, 'atMs'>): void {
  pricingDebug.push({ ...entry, atMs: Date.now() });
  while (pricingDebug.length > PRICING_DEBUG_CAP) pricingDebug.shift();
}

export function getPricingDebug(): PricingDebugEntry[] {
  return pricingDebug.map((e) => ({ ...e }));
}

export function clearPricingDebug(): void {
  pricingDebug.length = 0;
}

/** Traits helper — null if experience not created yet. */
export function traitsOf(
  patron: { profile: { name?: string; id?: string } }
): CustomerTraits | null {
  return getExperience(patron)?.traits ?? null;
}
