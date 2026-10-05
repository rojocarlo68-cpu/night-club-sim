/**
 * Prompt A Phase 9: per-patron hidden tastes for staff tip actions.
 * Stable per profile.name. Invisible to player. Does not affect action picking.
 */

import {
  TIP_ACTIONS,
  TipAction,
  ActionTasteDist,
  ACTION_TASTE_SCORES,
  getTipAction,
  tasteDistFor,
} from '../config/tipActions';
import {
  applyExperience,
  getExperience,
  patronExperienceKey,
} from './CustomerExperience';

/** Taste score in [−1, +1] per action id. */
export type ActionTastes = Record<string, number>;

type TasteCache = Record<string, ActionTastes>;

const cache: TasteCache = {};

function clampTaste(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function rollCategory(
  dist: ActionTasteDist,
  rng: () => number
): keyof typeof ACTION_TASTE_SCORES {
  const like = Math.max(0, dist.like);
  const neutral = Math.max(0, dist.neutral);
  const dislike = Math.max(0, dist.dislike);
  const total = like + neutral + dislike || 1;
  let r = rng() * total;
  if ((r -= like) < 0) return 'like';
  if ((r -= neutral) < 0) return 'neutral';
  return 'dislike';
}

function rollTastes(rng: () => number): ActionTastes {
  const tastes: ActionTastes = {};
  for (const a of TIP_ACTIONS) {
    const cat = rollCategory(tasteDistFor(a), rng);
    tastes[a.id] = ACTION_TASTE_SCORES[cat];
  }
  return tastes;
}

/** Get or roll stable action tastes for this patron identity. */
export function getActionTastes(
  patron: { profile: { name?: string; id?: string } },
  rng: () => number = Math.random
): ActionTastes {
  const key = patronExperienceKey(patron);
  const existing = cache[key];
  if (existing) return { ...existing };
  const rolled = rollTastes(rng);
  cache[key] = rolled;
  return { ...rolled };
}

/** Taste score for one action (−1..+1); 0 if unknown. */
export function tasteFor(
  patron: { profile: { name?: string; id?: string } },
  actionId: string
): number {
  const tastes = getActionTastes(patron);
  return tastes[actionId] ?? 0;
}

/**
 * Apply one-shot sat from a performed tip action (`act:<actionId>`).
 * delta = satisfactionMod * tasteScore; negatives damped by tolerance via applyExperience.
 * Returns applied delta (0 if already perceived / no action / no experience).
 */
export function applyActionSatisfaction(
  patron: { profile: { name?: string; id?: string } },
  action: TipAction | string | null | undefined
): number {
  if (!action) return 0;
  const act = typeof action === 'string' ? getTipAction(action) : action;
  if (!act) return 0;
  const score = tasteFor(patron, act.id);
  const base = (act.satisfactionMod ?? 0) * score;
  // Even zero (neutral≈small non-zero usually) is recorded once so it won't re-fire.
  return applyExperience(patron, `act:${act.id}`, base);
}

/** Test/debug: force taste score for patronName × actionId. */
export function setActionTaste(
  patronName: string,
  actionId: string,
  score: number
): boolean {
  const name = (patronName || '').trim();
  if (!name || !actionId) return false;
  if (!getTipAction(actionId) && !TIP_ACTIONS.some((a) => a.id === actionId)) {
    // Allow forcing even before catalogue knows it (future actions); still require id.
  }
  if (!cache[name]) cache[name] = rollTastes(Math.random);
  cache[name][actionId] = clampTaste(score);
  return true;
}

export function peekActionTaste(
  patronName: string,
  actionId: string
): number | null {
  const name = (patronName || '').trim();
  if (!name || !actionId) return null;
  const v = cache[name]?.[actionId];
  return typeof v === 'number' ? v : null;
}

export function serializeActionTastes(): TasteCache {
  const out: TasteCache = {};
  for (const [k, v] of Object.entries(cache)) out[k] = { ...v };
  return out;
}

export function loadActionTastes(raw: unknown): void {
  for (const k of Object.keys(cache)) delete cache[k];
  if (!raw || typeof raw !== 'object') return;
  for (const [pk, row] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof pk !== 'string' || !pk || !row || typeof row !== 'object') continue;
    const tastes: ActionTastes = {};
    let any = false;
    for (const [aid, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        tastes[aid] = clampTaste(v);
        any = true;
      }
    }
    // Fill missing catalogue actions so new ones appear later with mid neutral.
    if (any) {
      for (const a of TIP_ACTIONS) {
        if (tastes[a.id] == null) tastes[a.id] = ACTION_TASTE_SCORES.neutral;
      }
      cache[pk] = tastes;
    }
  }
}

export function resetActionTastesForTests(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** Sat after last apply — helper for debug. */
export function satAfterAction(patron: {
  profile: { name?: string; id?: string };
}): number | null {
  return getExperience(patron)?.satisfaction ?? null;
}
