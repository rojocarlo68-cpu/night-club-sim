/**
 * Per-patron visit satisfaction (Prompt A Phase 1).
 * Parallel to patience/nightMood — does NOT replace them.
 * Traits stable per profile.name (like Affinity). Events applied once per key.
 */

import {
  SAT_MIN,
  SAT_MAX,
  BASE_SATISFACTION,
  TRAIT_RANGES,
  TRAIT_SCALE,
  SatisfactionTraitName,
  VISIT_HISTORY_CAP,
  VISIT_DEBUG_CAP,
} from '../config/satisfaction';
import { scalePerceivedDelta } from './ExperiencePerception';

export interface CustomerTraits {
  cleanSens: number;
  comfortSens: number;
  priceSens: number;
  availSens: number;
  generosity: number;
  tolerance: number;
}

export interface ExperienceEvent {
  key: string;
  delta: number;
  atMs: number;
  /** Optional human-readable detail for debug (Phase 2+: band, furniture). */
  detail?: string;
}

export interface PatronExperience {
  satisfaction: number;
  traits: CustomerTraits;
  perceived: Set<string>;
  events: ExperienceEvent[];
  patronKey: string;
  patronId: string;
  name: string;
}

export interface VisitRecord {
  name: string;
  patronKey: string;
  satisfaction: number;
  events: ExperienceEvent[];
  traits: CustomerTraits;
}

type TraitCache = Record<string, CustomerTraits>;

const active = new Map<string, PatronExperience>();
let traitCache: TraitCache = {};
const visitHistory: VisitRecord[] = [];
const visitDebug: VisitRecord[] = [];
type VisitCb = (record: VisitRecord) => void;
const onVisitFinished: VisitCb[] = [];

/** Stable key: display name (Kai/Mika/Ryo/Yuri), else stripped id. */
export function patronExperienceKey(patron: {
  profile: { name?: string; id?: string };
}): string {
  const name = (patron.profile?.name || '').trim();
  if (name) return name;
  const id = patron.profile?.id || 'unknown';
  const base = id.replace(/_\d+_[a-z0-9]+$/i, '');
  return base || id;
}

function clampSat(v: number): number {
  return Math.max(SAT_MIN, Math.min(SAT_MAX, Math.round(v)));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rollTrait(
  range: { min: number; max: number },
  rng: () => number
): number {
  return clamp01(range.min + rng() * (range.max - range.min));
}

function rollTraits(rng: () => number): CustomerTraits {
  return {
    cleanSens: rollTrait(TRAIT_RANGES.cleanSens, rng),
    comfortSens: rollTrait(TRAIT_RANGES.comfortSens, rng),
    priceSens: rollTrait(TRAIT_RANGES.priceSens, rng),
    availSens: rollTrait(TRAIT_RANGES.availSens, rng),
    generosity: rollTrait(TRAIT_RANGES.generosity, rng),
    tolerance: rollTrait(TRAIT_RANGES.tolerance, rng),
  };
}

function traitsForKey(key: string, rng: () => number = Math.random): CustomerTraits {
  const existing = traitCache[key];
  if (existing) return { ...existing };
  const rolled = rollTraits(rng);
  traitCache[key] = rolled;
  return { ...rolled };
}

/**
 * Create (or replace) experience state for a living patron instance.
 * Call on spawn/arrival. Does not alter patience/nightMood.
 */
export function createExperience(
  patron: { profile: { name?: string; id?: string } },
  rng: () => number = Math.random
): PatronExperience {
  const patronKey = patronExperienceKey(patron);
  const patronId = patron.profile?.id || patronKey;
  const name = (patron.profile?.name || patronKey).trim() || patronKey;
  const exp: PatronExperience = {
    satisfaction: BASE_SATISFACTION,
    traits: traitsForKey(patronKey, rng),
    perceived: new Set(),
    events: [],
    patronKey,
    patronId,
    name,
  };
  active.set(patronId, exp);
  return exp;
}

export function getExperience(patron: {
  profile: { name?: string; id?: string };
}): PatronExperience | null {
  const id = patron.profile?.id;
  if (id && active.has(id)) return active.get(id)!;
  return null;
}

/**
 * Apply a one-shot experience delta. Same `key` never applies twice this visit.
 * Optional traitName scales magnitude; tolerance dampens negatives.
 * Phase 1: API ready; callers in later phases.
 */
export function applyExperience(
  patron: { profile: { name?: string; id?: string } },
  key: string,
  baseDelta: number,
  traitName?: SatisfactionTraitName
): number {
  const exp = getExperience(patron);
  if (!exp || !key) return 0;
  if (exp.perceived.has(key)) return 0;
  exp.perceived.add(key);

  let delta = baseDelta;
  if (traitName && traitName in exp.traits) {
    const t = exp.traits[traitName];
    const intensity = 1 + (t - 0.5) * 2 * TRAIT_SCALE.intensity;
    delta = baseDelta * intensity;
  }
  if (delta < 0) {
    delta *= 1 - exp.traits.tolerance * TRAIT_SCALE.toleranceDampNeg;
  }
  delta = Math.round(delta * 10) / 10;
  exp.satisfaction = clampSat(exp.satisfaction + delta);
  exp.events.push({ key, delta, atMs: Date.now() });
  return delta;
}

export function hasPerceived(
  patron: { profile: { name?: string; id?: string } },
  key: string
): boolean {
  const exp = getExperience(patron);
  return !!exp && exp.perceived.has(key);
}

/**
 * Prompt A Phase 2: one-shot perceived delta with perception scaling
 * (sensitive clients hurt more, tolerance damps negatives, positives milder).
 * Zero-delta perceptions are still recorded (so they are not re-evaluated).
 */
export function applyPerceivedExperience(
  patron: { profile: { name?: string; id?: string } },
  key: string,
  baseDelta: number,
  sensTrait: SatisfactionTraitName,
  detail?: string
): number | null {
  const exp = getExperience(patron);
  if (!exp || !key || exp.perceived.has(key)) return null;
  exp.perceived.add(key);
  const delta = scalePerceivedDelta(baseDelta, exp.traits[sensTrait], exp.traits);
  exp.satisfaction = clampSat(exp.satisfaction + delta);
  exp.events.push({ key, delta, atMs: Date.now(), detail });
  return delta;
}

/**
 * End-of-visit snapshot. Removes active state. Fires onVisitFinished hooks
 * (future reputation / return chance — not implemented here).
 */
export function finalizeVisit(patron: {
  profile: { name?: string; id?: string };
}): VisitRecord | null {
  const id = patron.profile?.id;
  const exp = id ? active.get(id) : null;
  if (!exp) return null;
  active.delete(id!);
  const record: VisitRecord = {
    name: exp.name,
    patronKey: exp.patronKey,
    satisfaction: exp.satisfaction,
    events: exp.events.map((e) => ({ ...e })),
    traits: { ...exp.traits },
  };
  visitHistory.push(record);
  while (visitHistory.length > VISIT_HISTORY_CAP) visitHistory.shift();
  visitDebug.push(record);
  while (visitDebug.length > VISIT_DEBUG_CAP) visitDebug.shift();
  for (const cb of onVisitFinished) {
    try {
      cb(record);
    } catch {
      // never block leave path
    }
  }
  return record;
}

/** Register future reputation / return-chance listener. Phase 1: hook only. */
export function onVisitFinishedCallback(cb: VisitCb): () => void {
  onVisitFinished.push(cb);
  return () => {
    const i = onVisitFinished.indexOf(cb);
    if (i >= 0) onVisitFinished.splice(i, 1);
  };
}

export function getVisitHistory(): VisitRecord[] {
  return visitHistory.map((r) => ({
    ...r,
    events: r.events.map((e) => ({ ...e })),
    traits: { ...r.traits },
  }));
}

export function getVisitDebug(): VisitRecord[] {
  return visitDebug.map((r) => ({
    ...r,
    events: r.events.map((e) => ({ ...e })),
    traits: { ...r.traits },
  }));
}

/** Persistable trait map (patronKey → traits). */
export function serializeCustomerTraits(): TraitCache {
  const out: TraitCache = {};
  for (const [k, t] of Object.entries(traitCache)) {
    out[k] = { ...t };
  }
  return out;
}

export function loadCustomerTraits(raw: unknown): void {
  traitCache = {};
  if (!raw || typeof raw !== 'object') return;
  const keys = Object.keys(TRAIT_RANGES) as SatisfactionTraitName[];
  for (const [pk, row] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof pk !== 'string' || !pk || !row || typeof row !== 'object') continue;
    const src = row as Record<string, unknown>;
    const traits: Partial<CustomerTraits> = {};
    let ok = true;
    for (const k of keys) {
      const v = src[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      traits[k] = clamp01(v);
    }
    if (ok && keys.every((k) => typeof traits[k] === 'number')) {
      traitCache[pk] = traits as CustomerTraits;
    }
  }
}

/** Test helper. */
export function resetCustomerExperienceForTests(): void {
  active.clear();
  traitCache = {};
  visitHistory.length = 0;
  visitDebug.length = 0;
  onVisitFinished.length = 0;
}

export function getActiveExperiences(): PatronExperience[] {
  return [...active.values()];
}

// ─── Save slots (pause menu): exact live state of this module (versioned by SaveSlots). ───

export function exportExperience(patron: { profile: { name?: string; id?: string } }) {
  const exp = getExperience(patron);
  if (!exp) return null;
  return { ...exp, traits: { ...exp.traits }, perceived: [...exp.perceived], events: exp.events.map((e) => ({ ...e })) };
}

/** Re-attach a saved visit (satisfaction, perceived keys, events) to a restored patron. */
export function importExperience(patron: { profile: { name?: string; id?: string } }, raw: unknown): void {
  const id = patron.profile?.id;
  if (!id || !raw || typeof raw !== 'object') return;
  const o = raw as ReturnType<typeof exportExperience> & object;
  const base = createExperience(patron);
  if (typeof o.satisfaction === 'number') base.satisfaction = o.satisfaction;
  if (o.traits && typeof o.traits === 'object') base.traits = { ...base.traits, ...o.traits };
  base.perceived = new Set(Array.isArray(o.perceived) ? o.perceived : []);
  base.events = Array.isArray(o.events) ? o.events.map((e) => ({ ...e })) : [];
  active.set(id, base);
}
