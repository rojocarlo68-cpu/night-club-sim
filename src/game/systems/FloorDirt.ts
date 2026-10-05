/**
 * Floor dirt zones for prep sweep/mop + local perception (Prompt day-start).
 * Does NOT replace furniture cleanliness — feeds the same ExperiencePerception path.
 */

import {
  FLOOR_ZONE_SIZE,
  FLOOR_DIRT_BANDS,
  SWEEP_THRESHOLD,
  MOP_THRESHOLD,
  SWEEP_RESTORE,
  MOP_RESTORE,
  FLOOR_SEED_AFTER_USED_NIGHT,
  FLOOR_SEED_QUIET_NIGHT,
} from '../config/floorDirt';

export type FloorDirtBand = 'clean' | 'slight' | 'dirty' | 'very_dirty';

export interface FloorZone {
  id: string;
  /** Inclusive tile bounds. */
  col0: number;
  row0: number;
  col1: number;
  row1: number;
  /** Dry litter — reduced by sweeping. */
  dryDirt: number;
  /** Sticky grime — reduced by mopping. */
  grime: number;
}

export interface FloorDirtPersist {
  zones?: Array<{ id: string; dryDirt: number; grime: number }>;
}

let zones: FloorZone[] = [];
let mapCols = 12;
let mapRows = 12;
/** Perception episodes: zoneId → episode when cleaned past dirty. */
const floorEpisodes = new Map<string, { episode: number; dirty: boolean }>();

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function initFloorDirt(cols: number, rows: number): void {
  mapCols = Math.max(1, cols);
  mapRows = Math.max(1, rows);
  zones = [];
  floorEpisodes.clear();
  const zs = Math.max(1, FLOOR_ZONE_SIZE);
  for (let r0 = 0; r0 < mapRows; r0 += zs) {
    for (let c0 = 0; c0 < mapCols; c0 += zs) {
      const c1 = Math.min(mapCols - 1, c0 + zs - 1);
      const r1 = Math.min(mapRows - 1, r0 + zs - 1);
      const id = `fz_${c0}_${r0}`;
      zones.push({
        id,
        col0: c0,
        row0: r0,
        col1: c1,
        row1: r1,
        dryDirt: 0,
        grime: 0,
      });
    }
  }
}

export function getFloorZones(): readonly FloorZone[] {
  return zones;
}

export function floorDirtIntensity(z: FloorZone): number {
  return Math.max(z.dryDirt, z.grime);
}

export function floorDirtBand(z: FloorZone): FloorDirtBand {
  const v = floorDirtIntensity(z);
  if (v < FLOOR_DIRT_BANDS.cleanBelow) return 'clean';
  if (v < FLOOR_DIRT_BANDS.slightBelow) return 'slight';
  if (v < FLOOR_DIRT_BANDS.dirtyBelow) return 'dirty';
  return 'very_dirty';
}

export function floorDirtDelta(band: FloorDirtBand): number {
  return FLOOR_DIRT_BANDS.delta[band];
}

export function isFloorVisiblyDirty(z: FloorZone): boolean {
  const b = floorDirtBand(z);
  return b === 'slight' || b === 'dirty' || b === 'very_dirty';
}

function noteFloorDirty(id: string, dirty: boolean): number {
  let r = floorEpisodes.get(id);
  if (!r) {
    r = { episode: 0, dirty: false };
    floorEpisodes.set(id, r);
  }
  if (dirty) r.dirty = true;
  else if (r.dirty) {
    r.dirty = false;
    r.episode++;
  }
  return r.episode;
}

export function floorDirtEpisodeKey(z: FloorZone): string {
  const dirty = isFloorVisiblyDirty(z);
  return `floor:${z.id}:${noteFloorDirty(z.id, dirty)}`;
}

export function markFloorZoneCleaned(id: string): void {
  const r = floorEpisodes.get(id) ?? { episode: 0, dirty: false };
  r.episode++;
  r.dirty = false;
  floorEpisodes.set(id, r);
}

/** Center tile of a zone (for pathing). */
export function floorZoneCenter(z: FloorZone): { col: number; row: number } {
  return {
    col: Math.floor((z.col0 + z.col1) / 2),
    row: Math.floor((z.row0 + z.row1) / 2),
  };
}

export function zoneContaining(col: number, row: number): FloorZone | null {
  for (const z of zones) {
    if (col >= z.col0 && col <= z.col1 && row >= z.row0 && row <= z.row1) return z;
  }
  return null;
}

/** Chebyshev distance from tile to zone rectangle. */
export function distToFloorZone(col: number, row: number, z: FloorZone): number {
  const dx =
    col < z.col0 ? z.col0 - col : col > z.col1 ? col - z.col1 : 0;
  const dy =
    row < z.row0 ? z.row0 - row : row > z.row1 ? row - z.row1 : 0;
  return Math.max(dx, dy);
}

export function findDirtiestSweepZone(claimed: Set<string>): FloorZone | null {
  let best: FloorZone | null = null;
  let bestV = -1;
  for (const z of zones) {
    if (claimed.has(z.id)) continue;
    if (z.dryDirt < SWEEP_THRESHOLD) continue;
    if (z.dryDirt > bestV) {
      bestV = z.dryDirt;
      best = z;
    }
  }
  return best;
}

export function findDirtiestMopZone(claimed: Set<string>): FloorZone | null {
  let best: FloorZone | null = null;
  let bestV = -1;
  for (const z of zones) {
    if (claimed.has(z.id)) continue;
    // Prefer mopping after dry litter is reduced.
    if (z.grime < MOP_THRESHOLD) continue;
    if (z.dryDirt > SWEEP_THRESHOLD + 10) continue;
    if (z.grime > bestV) {
      bestV = z.grime;
      best = z;
    }
  }
  return best;
}

export function applySweep(z: FloorZone): void {
  z.dryDirt = clamp01_100(z.dryDirt - SWEEP_RESTORE);
  if (!isFloorVisiblyDirty(z)) markFloorZoneCleaned(z.id);
}

export function applyMop(z: FloorZone): void {
  z.grime = clamp01_100(z.grime - MOP_RESTORE);
  // Mop also lightly clears residual dry dirt.
  z.dryDirt = clamp01_100(z.dryDirt - Math.round(SWEEP_RESTORE * 0.25));
  if (!isFloorVisiblyDirty(z)) markFloorZoneCleaned(z.id);
}

function randInt(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Seed dirt at day start. `usedNight` = previous night had patrons/sales. */
export function seedFloorDirtForDay(usedNight: boolean): void {
  if (zones.length === 0) return;
  const cfg = usedNight ? FLOOR_SEED_AFTER_USED_NIGHT : FLOOR_SEED_QUIET_NIGHT;
  const n = randInt(cfg.zonesMin, cfg.zonesMax);
  if (n <= 0) return;
  const idxs = zones.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  for (let k = 0; k < n && k < idxs.length; k++) {
    const z = zones[idxs[k]];
    z.dryDirt = clamp01_100(z.dryDirt + randInt(cfg.dryMin, cfg.dryMax));
    z.grime = clamp01_100(z.grime + randInt(cfg.grimeMin, cfg.grimeMax));
  }
}

/** Mild overnight dirt accrual while closed (optional slow tick). */
export function tickFloorDirtOvernight(gameMinutes: number): void {
  if (gameMinutes <= 0 || zones.length === 0) return;
  // Very light passive accumulation so prep stays relevant if player waits.
  const add = Math.min(3, gameMinutes * 0.04);
  if (add < 0.5) return;
  for (const z of zones) {
    if (Math.random() < 0.15) {
      z.dryDirt = clamp01_100(z.dryDirt + add);
    }
  }
}

export function serializeFloorDirt(): FloorDirtPersist {
  return {
    zones: zones.map((z) => ({ id: z.id, dryDirt: z.dryDirt, grime: z.grime })),
  };
}

export function loadFloorDirt(raw: FloorDirtPersist | null | undefined): void {
  if (!raw?.zones || !Array.isArray(raw.zones)) return;
  const byId = new Map(raw.zones.map((z) => [z.id, z]));
  for (const z of zones) {
    const s = byId.get(z.id);
    if (!s) continue;
    if (typeof s.dryDirt === 'number') z.dryDirt = clamp01_100(s.dryDirt);
    if (typeof s.grime === 'number') z.grime = clamp01_100(s.grime);
  }
}

export function getFloorDirtDebug() {
  return {
    zoneCount: zones.length,
    zones: zones.map((z) => ({
      id: z.id,
      dryDirt: Math.round(z.dryDirt),
      grime: Math.round(z.grime),
      band: floorDirtBand(z),
      center: floorZoneCenter(z),
    })),
    dirtyCount: zones.filter((z) => isFloorVisiblyDirty(z)).length,
  };
}

export function resetFloorDirtState(): void {
  for (const z of zones) {
    z.dryDirt = 0;
    z.grime = 0;
  }
  floorEpisodes.clear();
}
