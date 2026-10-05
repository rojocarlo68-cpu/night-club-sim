/**
 * Served/prepared products left out (beer mugs, botanas plates).
 * Times in real ms — experienceable within one night (1 game min = 1 real s).
 */
export interface SpoilProfile {
  /** Fresh until this age. */
  freshMs: number;
  /** Stale (still accepted, small quality penalty) until this age; then spoiled. */
  staleMs: number;
  /** Spoiled items are auto-collected as merma after this extra time (if nobody picks them up). */
  removeAfterSpoiledMs: number;
  /** One-shot sat delta when a customer takes it fresh / stale. */
  freshSat: number;
  staleSat: number;
  /** Floor dirt added to the zone when it spoils (feeds flies). */
  spoilGrime: number;
  spoilDry: number;
  /** Extra grime per second while a spoiled item sits there. */
  spoiledGrimePerSec: number;
}

export const SPOIL_PROFILES: Record<string, SpoilProfile> = {
  cerveza: {
    freshMs: 40000,
    staleMs: 95000,
    removeAfterSpoiledMs: 40000,
    freshSat: 2,
    staleSat: -3,
    spoilGrime: 14,
    spoilDry: 6,
    spoiledGrimePerSec: 0.25,
  },
  botanas: {
    freshMs: 60000,
    staleMs: 140000,
    removeAfterSpoiledMs: 45000,
    freshSat: 2,
    staleSat: -3,
    spoilGrime: 18,
    spoilDry: 10,
    spoiledGrimePerSec: 0.3,
  },
};

/** Max items waiting on one service point / table (avoid infinite stacks). */
export const MAX_ITEMS_PER_SPOT = 4;

/** Flies: local consequence of dirt left too long. */
export const FLIES = {
  /** Zone dirt intensity (max dry/grime) needed before flies can appear. */
  minIntensity: 50,
  /** Dirt must persist this long (ms) before flies appear (never instant). */
  appearAfterMs: 35000,
  /** Flies leave when intensity drops below this. */
  clearBelow: 35,
  /** Patron perceives flies within this Chebyshev distance of the zone. */
  perceiveDist: 1,
  /** Satisfaction delta (cleanSens), once per fly episode per patron. */
  satDelta: -5,
} as const;
