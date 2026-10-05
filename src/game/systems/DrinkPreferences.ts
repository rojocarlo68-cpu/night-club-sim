/**
 * Per-patron drink preferences (Prompt A Phase 4).
 * Stable per profile.name (like CustomerExperience traits). Invisible to player.
 */

import { DRINKS_CATALOG, DRINK_PREF } from '../config/drinks';
import { patronExperienceKey } from './CustomerExperience';

export type DrinkPrefs = Record<string, number>;

type PrefCache = Record<string, DrinkPrefs>;

const cache: PrefCache = {};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rollPrefs(preferredDrink: string, rng: () => number): DrinkPrefs {
  const prefs: DrinkPrefs = {};
  const preferred = (preferredDrink || '').trim();
  for (const d of DRINKS_CATALOG) {
    if (d.id === preferred) {
      prefs[d.id] = clamp01(
        DRINK_PREF.preferredForce + rng() * DRINK_PREF.preferredJitter
      );
    } else {
      prefs[d.id] = clamp01(
        DRINK_PREF.otherMin + rng() * (DRINK_PREF.otherMax - DRINK_PREF.otherMin)
      );
    }
  }
  // Guarantee preferred is highest (or tied) among catalogue.
  if (preferred && prefs[preferred] != null) {
    let maxOther = 0;
    for (const [id, v] of Object.entries(prefs)) {
      if (id !== preferred && v > maxOther) maxOther = v;
    }
    if (prefs[preferred] <= maxOther) {
      prefs[preferred] = clamp01(Math.max(DRINK_PREF.preferredForce, maxOther + 0.05));
    }
  }
  return prefs;
}

/** Get or roll stable prefs for this patron profile name. */
export function getDrinkPrefs(
  patron: { profile: { name?: string; id?: string; preferredDrink?: string } },
  rng: () => number = Math.random
): DrinkPrefs {
  const key = patronExperienceKey(patron);
  const existing = cache[key];
  if (existing) return { ...existing };
  const preferred = patron.profile?.preferredDrink || '';
  const rolled = rollPrefs(preferred, rng);
  cache[key] = rolled;
  return { ...rolled };
}

/** Preference score for one drink (0 if unknown). */
export function prefFor(
  patron: { profile: { name?: string; id?: string; preferredDrink?: string } },
  drinkId: string
): number {
  const prefs = getDrinkPrefs(patron);
  return prefs[drinkId] ?? 0;
}

export function serializeDrinkPrefs(): PrefCache {
  const out: PrefCache = {};
  for (const [k, v] of Object.entries(cache)) {
    out[k] = { ...v };
  }
  return out;
}

export function loadDrinkPrefs(raw: unknown): void {
  for (const k of Object.keys(cache)) delete cache[k];
  if (!raw || typeof raw !== 'object') return;
  for (const [pk, row] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof pk !== 'string' || !pk || !row || typeof row !== 'object') continue;
    const prefs: DrinkPrefs = {};
    let any = false;
    for (const d of DRINKS_CATALOG) {
      const v = (row as Record<string, unknown>)[d.id];
      if (typeof v === 'number' && Number.isFinite(v)) {
        prefs[d.id] = clamp01(v);
        any = true;
      }
    }
    // Fill missing catalogue ids with mid defaults so new drinks appear later.
    if (any) {
      for (const d of DRINKS_CATALOG) {
        if (prefs[d.id] == null) {
          prefs[d.id] = clamp01((DRINK_PREF.otherMin + DRINK_PREF.otherMax) / 2);
        }
      }
      cache[pk] = prefs;
    }
  }
}

export function resetDrinkPrefsForTests(): void {
  for (const k of Object.keys(cache)) delete cache[k];
}
