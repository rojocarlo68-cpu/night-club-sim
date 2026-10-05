/**
 * Gradual competitiveness from observing peer tip earnings (Phase 6).
 * Staff who are present observe periodically; ambition² scales the reaction.
 * Never bypasses personality requirements or Phase 4 energy/mood gates.
 */

import { getPersonality } from '../config/personality';
import { getTips } from './Tips';
import {
  DECAY_RATE,
  GAP_THRESHOLD,
  HISTORY_DECAY,
  MAX_COMPETITIVENESS,
  MAX_DELTA_PER_OBS,
  RISE_RATE,
} from '../config/competition';

export interface StaffCompetition {
  competitiveness: number;
  lastObservedGap: number;
  /** Slowly decaying tip history (boosted on each recorded tip). */
  rollingTips: number;
}

type CompMap = Record<string, StaffCompetition>;

const empty = (): StaffCompetition => ({
  competitiveness: 0,
  lastObservedGap: 0,
  rollingTips: 0,
});

let byStaff: CompMap = {};

function ensure(staffId: string): StaffCompetition {
  if (!byStaff[staffId]) byStaff[staffId] = empty();
  return byStaff[staffId];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(MAX_COMPETITIVENESS, n));
}

/** Effective recent earnings: tonight + rolling history. */
export function effectiveTips(staffId: string): number {
  const tips = getTips(staffId);
  const st = ensure(staffId);
  return Math.max(0, tips.tipsNight + st.rollingTips);
}

/** Call after recordTip so rolling history tracks consistent earnings. */
export function noteTip(staffId: string, amount: number): void {
  if (!staffId || !(amount > 0) || !Number.isFinite(amount)) return;
  const st = ensure(staffId);
  st.rollingTips += Math.max(0, Math.floor(amount));
}

/**
 * Observe peers. Only `presentIds` (staff currently working) update.
 * Compares each against the best-earning peer; gradual capped Δ.
 */
export function observe(presentIds: string[]): void {
  const ids = presentIds.filter((id) => typeof id === 'string' && id);
  if (ids.length < 2) {
    // Still decay history so a lone worker's rolling tips fade.
    for (const id of ids) {
      const st = ensure(id);
      st.rollingTips *= HISTORY_DECAY;
    }
    return;
  }

  // Decay rolling history first (consistent earnings matter more than one tip).
  for (const id of ids) {
    ensure(id).rollingTips *= HISTORY_DECAY;
  }

  const scores = new Map<string, number>();
  let best = 0;
  for (const id of ids) {
    const s = effectiveTips(id);
    scores.set(id, s);
    if (s > best) best = s;
  }

  for (const id of ids) {
    const mine = scores.get(id) ?? 0;
    const peers = ids.filter((p) => p !== id);
    let peerBest = 0;
    for (const p of peers) {
      const v = scores.get(p) ?? 0;
      if (v > peerBest) peerBest = v;
    }

    const denom = Math.max(peerBest, 1);
    const gap = (peerBest - mine) / denom; // >0 when behind
    const st = ensure(id);
    st.lastObservedGap = gap;

    const ambition = getPersonality(id).ambition;
    const ambitionScale = ambition * ambition; // low ambition barely reacts

    let delta = 0;
    if (gap > GAP_THRESHOLD) {
      delta = RISE_RATE * ambitionScale;
    } else {
      delta = -DECAY_RATE;
    }

    // Cap per-observation change
    if (delta > MAX_DELTA_PER_OBS) delta = MAX_DELTA_PER_OBS;
    if (delta < -MAX_DELTA_PER_OBS) delta = -MAX_DELTA_PER_OBS;

    st.competitiveness = clamp01(st.competitiveness + delta);
  }
}

export function getCompetitiveness(staffId: string): number {
  return ensure(staffId).competitiveness;
}

export function getCompetitionState(staffId: string): StaffCompetition {
  const s = ensure(staffId);
  return {
    competitiveness: s.competitiveness,
    lastObservedGap: s.lastObservedGap,
    rollingTips: s.rollingTips,
  };
}

/** Persistable snapshot. */
export function serializeCompetition(): CompMap {
  const out: CompMap = {};
  for (const id of Object.keys(byStaff)) {
    const s = byStaff[id];
    out[id] = {
      competitiveness: clamp01(s.competitiveness),
      lastObservedGap: Number.isFinite(s.lastObservedGap) ? s.lastObservedGap : 0,
      rollingTips: Math.max(0, s.rollingTips),
    };
  }
  return out;
}

/** Load from save; corrupt entries → zeros. */
export function loadCompetition(raw: unknown): void {
  byStaff = {};
  if (!raw || typeof raw !== 'object') return;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== 'string' || !id) continue;
    if (!v || typeof v !== 'object') {
      byStaff[id] = empty();
      continue;
    }
    const o = v as Record<string, unknown>;
    const num = (x: unknown, lo = 0, hi = Number.POSITIVE_INFINITY) => {
      if (typeof x !== 'number' || !Number.isFinite(x)) return lo;
      return Math.max(lo, Math.min(hi, x));
    };
    byStaff[id] = {
      competitiveness: num(o.competitiveness, 0, MAX_COMPETITIVENESS),
      lastObservedGap: num(o.lastObservedGap, -10, 10),
      rollingTips: num(o.rollingTips, 0),
    };
  }
}

/** Test helper. */
export function resetCompetitionForTests(): void {
  byStaff = {};
}

/** Debug snapshot for ClubScene.getCompetitionDebug(). */
export function getCompetitionDebug(): {
  byStaff: CompMap;
  effective: Record<string, number>;
} {
  const snap: CompMap = {};
  const effective: Record<string, number> = {};
  for (const id of Object.keys(byStaff)) {
    snap[id] = { ...byStaff[id] };
    effective[id] = effectiveTips(id);
  }
  return { byStaff: snap, effective };
}
