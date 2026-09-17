/**
 * Runtime furniture durability / comfort / cleanliness + condition labels.
 * Expensive catalog items → higher maxDurability and slower decay.
 */

export type FurnitureConditionEs =
  | 'Óptimo'
  | 'Usado'
  | 'Daños visibles'
  | 'Se rompió'
  | 'Inservible';

export interface FurnitureRuntimeStats {
  durability: number;
  comfort: number;
  cleanliness: number;
  maxDurability: number;
  maxComfort: number;
  maxCleanliness: number;
}

/** Baseline “price” for free starter sofa/bar (drives decay + max stats). */
export const STARTER_FURNITURE_PRICE = 40;

/** Clean AI picks pieces below this cleanliness. */
export const CLEAN_THRESHOLD = 70;

/** Procedural dirt stains appear below this. */
export const DIRT_VISUAL_THRESHOLD = 60;

/** Clean bob duration (ms). */
export const CLEAN_DURATION_MS = 2500;

/** Cleanliness restored per clean job. */
export const CLEAN_RESTORE = { cleanliness: 42, comfort: 8 };

/**
 * Per-second decay while phase is prep or open (not summary / build).
 * Cleanliness drops faster. Scaled by STARTER_PRICE / effectivePrice.
 */
export const DECAY_PER_SEC = {
  durability: 0.09,
  comfort: 0.14,
  cleanliness: 0.48,
};

export function clampStat(n: number, max = 100): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/** Higher price → higher max durability / comfort. */
export function maxStatsForPrice(price: number): {
  maxDurability: number;
  maxComfort: number;
  maxCleanliness: number;
} {
  const p = Math.max(10, price);
  return {
    maxDurability: clampStat(Math.round(48 + p * 0.42)),
    maxComfort: clampStat(Math.round(52 + p * 0.28)),
    maxCleanliness: 100,
  };
}

export function decayScaleForPrice(price: number): number {
  return STARTER_FURNITURE_PRICE / Math.max(20, price);
}

export function freshStatsForPrice(price: number): FurnitureRuntimeStats {
  const max = maxStatsForPrice(price);
  return {
    durability: max.maxDurability,
    comfort: max.maxComfort,
    cleanliness: max.maxCleanliness,
    ...max,
  };
}

export function conditionFromDurability(
  durability: number,
  maxDurability: number
): FurnitureConditionEs {
  const max = Math.max(1, maxDurability);
  const pct = (durability / max) * 100;
  if (pct >= 80) return 'Óptimo';
  if (pct >= 55) return 'Usado';
  if (pct >= 30) return 'Daños visibles';
  if (pct >= 10) return 'Se rompió';
  return 'Inservible';
}

export function applyDecay(
  stats: FurnitureRuntimeStats,
  dtSec: number,
  price: number
): void {
  if (dtSec <= 0) return;
  const scale = decayScaleForPrice(price);
  stats.durability = clampStat(
    stats.durability - DECAY_PER_SEC.durability * scale * dtSec,
    stats.maxDurability
  );
  stats.comfort = clampStat(
    stats.comfort - DECAY_PER_SEC.comfort * scale * dtSec,
    stats.maxComfort
  );
  stats.cleanliness = clampStat(
    stats.cleanliness - DECAY_PER_SEC.cleanliness * scale * dtSec,
    stats.maxCleanliness
  );
}

export function applyCleanRestore(stats: FurnitureRuntimeStats): void {
  stats.cleanliness = clampStat(
    stats.cleanliness + CLEAN_RESTORE.cleanliness,
    stats.maxCleanliness
  );
  stats.comfort = clampStat(stats.comfort + CLEAN_RESTORE.comfort, stats.maxComfort);
}

/** Persistable subset. */
export interface SavedFurnitureStats {
  durability?: number;
  comfort?: number;
  cleanliness?: number;
  maxDurability?: number;
  maxComfort?: number;
  maxCleanliness?: number;
}

export function mergeSavedStats(
  price: number,
  saved?: SavedFurnitureStats | null
): FurnitureRuntimeStats {
  const fresh = freshStatsForPrice(price);
  if (!saved) return fresh;
  const maxD =
    typeof saved.maxDurability === 'number' && saved.maxDurability > 0
      ? clampStat(saved.maxDurability)
      : fresh.maxDurability;
  const maxC =
    typeof saved.maxComfort === 'number' && saved.maxComfort > 0
      ? clampStat(saved.maxComfort)
      : fresh.maxComfort;
  const maxCl =
    typeof saved.maxCleanliness === 'number' && saved.maxCleanliness > 0
      ? clampStat(saved.maxCleanliness)
      : fresh.maxCleanliness;
  return {
    maxDurability: maxD,
    maxComfort: maxC,
    maxCleanliness: maxCl,
    durability: clampStat(
      typeof saved.durability === 'number' ? saved.durability : maxD,
      maxD
    ),
    comfort: clampStat(typeof saved.comfort === 'number' ? saved.comfort : maxC, maxC),
    cleanliness: clampStat(
      typeof saved.cleanliness === 'number' ? saved.cleanliness : maxCl,
      maxCl
    ),
  };
}

export interface FurnitureInspectPayload {
  id: string;
  name: string;
  condition: FurnitureConditionEs;
  durability: number;
  comfort: number;
  cleanliness: number;
  maxDurability: number;
  maxComfort: number;
  maxCleanliness: number;
}
