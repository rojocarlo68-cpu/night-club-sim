/**
 * Prompt A Phase 2: perception-based comfort / cleanliness experience.
 * Pure helpers: READ existing furniture stats only (never mutate wear / dirt / cleaning).
 */

import {
  COMFORT_BANDS,
  DURABILITY_COMFORT_BAND,
  DIRT_BANDS,
  PERCEPTION_SCALE,
  PERCEPTION_RADIUS_TILES,
} from '../config/satisfaction';
import type { CustomerTraits } from './CustomerExperience';

export interface PerceivedStats {
  comfort: number;
  maxComfort: number;
  cleanliness: number;
  maxCleanliness: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/** Comfort band from comfort ratio + existing durability condition label (worst wins). */
export function comfortBandFor(
  st: PerceivedStats,
  condition: string
): { band: string; delta: number } {
  const ratio = st.maxComfort > 0 ? st.comfort / st.maxComfort : 1;
  let idx = COMFORT_BANDS.findIndex((b) => ratio >= b.minRatio);
  if (idx < 0) idx = COMFORT_BANDS.length - 1;
  const forced = DURABILITY_COMFORT_BAND[condition];
  if (forced) {
    const fIdx = COMFORT_BANDS.findIndex((b) => b.band === forced);
    if (fIdx > idx) idx = fIdx;
  }
  const b = COMFORT_BANDS[idx];
  return { band: b.band, delta: b.delta };
}

/** Dirt band from cleanliness ratio. `used` enables the small clean bonus. */
export function dirtBandFor(
  st: PerceivedStats,
  used: boolean
): { band: 'clean' | 'neutral' | 'dirty' | 'very_dirty'; delta: number } {
  const ratio = st.maxCleanliness > 0 ? st.cleanliness / st.maxCleanliness : 1;
  if (ratio < DIRT_BANDS.veryDirtyBelow) return { band: 'very_dirty', delta: DIRT_BANDS.delta.very_dirty };
  if (ratio < DIRT_BANDS.dirtyBelow) return { band: 'dirty', delta: DIRT_BANDS.delta.dirty };
  if (used && ratio >= DIRT_BANDS.cleanAtOrAbove) return { band: 'clean', delta: DIRT_BANDS.delta.clean };
  return { band: 'neutral', delta: 0 };
}

export function isVisiblyDirty(st: PerceivedStats): boolean {
  const ratio = st.maxCleanliness > 0 ? st.cleanliness / st.maxCleanliness : 1;
  return ratio < DIRT_BANDS.dirtyBelow;
}

/** Sensitive → bigger negatives; tolerant → smaller. Positives scaled mildly. */
export function scalePerceivedDelta(
  base: number,
  sensitivity: number,
  traits: Pick<CustomerTraits, 'tolerance'>
): number {
  if (base === 0) return 0;
  let d: number;
  if (base < 0) {
    d =
      base *
      lerp(PERCEPTION_SCALE.negMin, PERCEPTION_SCALE.negMax, sensitivity) *
      (1 - traits.tolerance * PERCEPTION_SCALE.toleranceDamp);
  } else {
    d = base * lerp(PERCEPTION_SCALE.posMin, PERCEPTION_SCALE.posMax, sensitivity);
  }
  return Math.round(d * 10) / 10;
}

/** Chebyshev distance from a tile to a footprint rectangle (0 = on/adjacent edge inside). */
export function distToFootprint(
  col: number,
  row: number,
  tile: [number, number],
  footprint: [number, number]
): number {
  const fw = Math.max(1, footprint?.[0] ?? 1);
  const fh = Math.max(1, footprint?.[1] ?? 1);
  const dx = col < tile[0] ? tile[0] - col : col > tile[0] + fw - 1 ? col - (tile[0] + fw - 1) : 0;
  const dy = row < tile[1] ? tile[1] - row : row > tile[1] + fh - 1 ? row - (tile[1] + fh - 1) : 0;
  return Math.max(dx, dy);
}

export function withinPerception(
  col: number,
  row: number,
  tile: [number, number],
  footprint: [number, number]
): boolean {
  return distToFootprint(col, row, tile, footprint) <= PERCEPTION_RADIUS_TILES;
}

/* ── Dirt episodes: a new episode starts each time an item goes from dirty → clean. ── */

const dirtEpisodes = new Map<string, { episode: number; dirty: boolean }>();

function rec(id: string) {
  let r = dirtEpisodes.get(id);
  if (!r) {
    r = { episode: 0, dirty: false };
    dirtEpisodes.set(id, r);
  }
  return r;
}

/** Observe current dirty state (lazy transition detection). Returns the current episode. */
export function noteDirtState(id: string, dirty: boolean): number {
  const r = rec(id);
  if (dirty) r.dirty = true;
  else if (r.dirty) {
    r.dirty = false;
    r.episode++;
  }
  return r.episode;
}

/** Explicit hook from the existing clean job: closes the current dirt episode. */
export function markItemCleaned(id: string): void {
  const r = rec(id);
  r.episode++;
  r.dirty = false;
}

export function dirtEpisodeKey(id: string, dirty: boolean): string {
  return `dirt:${id}:${noteDirtState(id, dirty)}`;
}

export function getDirtEpisodesDebug(): Record<string, { episode: number; dirty: boolean }> {
  const out: Record<string, { episode: number; dirty: boolean }> = {};
  for (const [k, v] of dirtEpisodes) out[k] = { ...v };
  return out;
}
