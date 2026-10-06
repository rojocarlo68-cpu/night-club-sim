/**
 * Staff consumption of club products (café, agua, refresco, alcohol…).
 * Staff PAY with their own money (tips) — never free, always real inventory.
 * Tuning only; behaviour lives in systems/StaffNeeds.ts + ClubScene.
 */

import { drinkAlcoholUnits } from './drinks';

export interface ConsumableEffect {
  /** Immediate energy change (0..100 scale). */
  energy: number;
  /** Immediate mood change (0..100 scale). */
  mood: number;
  /** Alcohol units (0 = none). Intoxication grows by units / tolerance. */
  alcohol: number;
  /** Café: brief energy boost with diminishing returns (CAFÉ ≠ DORMIR). */
  caffeine: boolean;
  /** Spanish phrase after "<Nombre> bebió …" / "<Nombre> comió …". */
  phrase: string;
  verb: 'bebió' | 'comió';
}

/** Per product. Products missing here are not offered to staff. Alcohol units come from drinks.ts. */
export const CONSUMABLE_EFFECTS: Record<string, ConsumableEffect> = {
  agua: { energy: 2, mood: 1, alcohol: 0, caffeine: false, phrase: 'un vaso con agua', verb: 'bebió' },
  refresco: { energy: 3, mood: 4, alcohol: 0, caffeine: false, phrase: 'un refresco', verb: 'bebió' },
  cafe: { energy: 0, mood: 2, alcohol: 0, caffeine: true, phrase: 'un shot de café', verb: 'bebió' },
  cerveza: { energy: 0, mood: 5, alcohol: drinkAlcoholUnits('cerveza'), caffeine: false, phrase: 'una cerveza', verb: 'bebió' },
  shot_barato: { energy: 0, mood: 5, alcohol: drinkAlcoholUnits('shot_barato'), caffeine: false, phrase: 'un shot barato', verb: 'bebió' },
  vodka: { energy: 0, mood: 6, alcohol: drinkAlcoholUnits('vodka'), caffeine: false, phrase: 'un shot de vodka', verb: 'bebió' },
  ron: { energy: 0, mood: 6, alcohol: drinkAlcoholUnits('ron'), caffeine: false, phrase: 'un trago de ron', verb: 'bebió' },
  whiskey: { energy: 0, mood: 6, alcohol: drinkAlcoholUnits('whiskey'), caffeine: false, phrase: 'un whiskey', verb: 'bebió' },
  botanas: { energy: 4, mood: 3, alcohol: 0, caffeine: false, phrase: 'unas botanas', verb: 'comió' },
};

/** Café: first cup gives `boost`; each extra cup in the same day × `diminish`. Crash after `buffMs`. */
export const CAFFEINE = {
  boost: 14,
  diminish: 0.55,
  buffMs: 45000,
  /** Energy lost when the buff wears off (scaled like the boost). */
  crash: 5,
} as const;

/** Alcohol model — fun & emergent, not medical. Intoxication 0..1. */
export const ALCOHOL = {
  /** Intoxication added per unit at tolerance 0.5 (scaled by 0.5/tolerance). */
  perUnit: 0.2,
  /** Intoxication decays this much per real second. */
  decayPerSec: 0.0025,
  /** Energy drain per second × intoxication (after the initial lift). */
  energyDrainPerSec: 0.05,
  /** Thresholds for labels / behaviour. */
  tipsyAt: 0.3,
  drunkAt: 0.65,
  /** Service tip-chance multiplier at intoxication 1 (lerp from 1). */
  serviceFactorAtMax: 0.6,
  /** Chance a serve is fumbled (spilled → merma + re-pour) = intox × this. */
  spillChancePerIntox: 0.28,
  /** Serve prep time multiplier at intoxication 1. */
  slowServeAtMax: 1.6,
} as const;

export interface StaffConsumptionProfile {
  /** Product id → 0..1 liking (affects buy probability). */
  prefs: Record<string, number>;
  /** 0..1 fraction of tips the staff is willing to spend (ambitious = low). */
  spendRate: number;
  /** 0.2 (lightweight) .. 1 (strong). Higher = slower intoxication. */
  alcoholTolerance: number;
  /** Max alcoholic drinks she'll take AUTONOMOUSLY per shift (player orders ignore this). */
  autoAlcoholCap: number;
  /** Starting pocket money for new saves. */
  startMoney: number;
}

export const STAFF_CONSUMPTION: Record<string, StaffConsumptionProfile> = {
  // Luna: ambitious saver, loves coffee, occasional water, little vodka.
  bartender_luna: {
    prefs: { cafe: 0.9, agua: 0.55, refresco: 0.3, cerveza: 0.25, vodka: 0.05, ron: 0.12, whiskey: 0.08, shot_barato: 0.06, botanas: 0.35 },
    spendRate: 0.25,
    alcoholTolerance: 0.4,
    autoAlcoholCap: 1,
    startMoney: 10,
  },
  // Nova: prefers soda, likes beer, drinks alcohol more easily.
  staff_nova: {
    prefs: { refresco: 0.85, cerveza: 0.75, agua: 0.3, cafe: 0.2, vodka: 0.45, ron: 0.5, whiskey: 0.3, shot_barato: 0.4, botanas: 0.5 },
    spendRate: 0.6,
    alcoholTolerance: 0.65,
    autoAlcoholCap: 3,
    startMoney: 8,
  },
};

/** Seeded fallback for future hires (stable per id). */
export function consumptionProfileFor(id: string): StaffConsumptionProfile {
  const known = STAFF_CONSUMPTION[id];
  if (known) return known;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const u = (salt: number) => {
    let t = (h + salt * 0x9e3779b9) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const prefs: Record<string, number> = {};
  Object.keys(CONSUMABLE_EFFECTS).forEach((k, i) => (prefs[k] = 0.1 + u(i + 1) * 0.8));
  return {
    prefs,
    spendRate: 0.2 + u(20) * 0.6,
    alcoholTolerance: 0.3 + u(21) * 0.6,
    autoAlcoholCap: 1 + Math.floor(u(22) * 3),
    startMoney: 6,
  };
}

/** Autonomous consumption (idle priority #4). */
export const AUTO_CONSUME = {
  /** How often an idle staff considers buying something (ms). */
  checkEveryMs: 14000,
  /** Base chance per check (scaled by need + spendRate + shift length). */
  baseChance: 0.1,
  /** Energy below this boosts café weight. */
  tiredEnergy: 45,
  /** Mood below this boosts alcohol weight (× disinhibition-ish via prefs). */
  lowMood: 45,
  /** Never autonomously drink alcohol at/above this intoxication. */
  maxAutoIntox: 0.4,
  /** Extra chance multiplier per real minute of open shift (long nights → more drinking). */
  perShiftMinute: 0.06,
} as const;

/** Leaving the club at Dormir: they spend part of their own money outside (personality). */
export const OUTSIDE_SPEND = { min: 0.05, max: 0.35 } as const;
