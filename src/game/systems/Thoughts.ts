/**
 * Customer thoughts: display + anti-spam only. Satisfaction is applied by the event
 * that perceived something (existing perception systems); this never reads global state.
 */
import { THOUGHTS, THOUGHT_RULES, ThoughtDef } from '../config/thoughts';

export interface ThoughtLogEntry {
  key: string;
  text: string;
  emoji: string;
  tone: ThoughtDef['tone'];
  at: number;
  shown: boolean;
}

interface VisitThoughts {
  lastShownAt: number;
  shownCount: number;
  keys: Set<string>;
  log: ThoughtLogEntry[];
}

const visits = new WeakMap<object, VisitThoughts>();
let totalShown = 0;
const recent: Array<{ patron: string; key: string; text: string; at: number; shown: boolean }> = [];

function stateOf(patron: object): VisitThoughts {
  let v = visits.get(patron);
  if (!v) {
    v = { lastShownAt: -1e9, shownCount: 0, keys: new Set(), log: [] };
    visits.set(patron, v);
  }
  return v;
}

function fill(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

export interface ThoughtDecision {
  show: boolean;
  text: string;
  emoji: string;
  tone: ThoughtDef['tone'];
  key: string;
}

/**
 * Decide whether a perceived event becomes a visible thought.
 * - each key at most once per visit (repeat events stay silent)
 * - per-patron min gap (shorter for priority 3)
 * - soft cap per visit (priority 3 may exceed a bit)
 * - global on-screen cap (selected patron exempt)
 * Returns null if the key was already used this visit.
 */
export function decideThought(
  patron: { profile: { name: string } },
  key: string,
  now: number,
  ctx: { onScreen: number; selected: boolean; vars?: Record<string, string>; rng?: () => number }
): ThoughtDecision | null {
  const def = THOUGHTS[key];
  if (!def) return null;
  const v = stateOf(patron);
  if (v.keys.has(key)) return null;
  v.keys.add(key);
  const rng = ctx.rng ?? Math.random;
  const text = fill(def.texts[Math.floor(rng() * def.texts.length)] ?? def.texts[0], ctx.vars);
  const gap = def.priority >= 3 ? THOUGHT_RULES.minGapHighMs : THOUGHT_RULES.minGapMs;
  const cap = THOUGHT_RULES.maxPerVisit + (def.priority >= 3 ? THOUGHT_RULES.highExtra : 0);
  let show = now - v.lastShownAt >= gap && v.shownCount < cap;
  if (show && !ctx.selected && ctx.onScreen >= THOUGHT_RULES.maxOnScreen && def.priority < 3) show = false;
  if (show && !ctx.selected && ctx.onScreen >= THOUGHT_RULES.maxOnScreen + 1) show = false;
  if (show) {
    v.lastShownAt = now;
    v.shownCount += 1;
    totalShown += 1;
  }
  v.log.push({ key, text, emoji: def.emoji, tone: def.tone, at: now, shown: show });
  if (v.log.length > THOUGHT_RULES.logSize) v.log.shift();
  recent.push({ patron: patron.profile.name, key, text, at: now, shown: show });
  if (recent.length > 60) recent.shift();
  return { show, text, emoji: def.emoji, tone: def.tone, key };
}

export function hasThought(patron: object, key: string): boolean {
  return stateOf(patron).keys.has(key);
}

export function thoughtLog(patron: object): ThoughtLogEntry[] {
  return [...stateOf(patron).log];
}

export function getThoughtsDebug() {
  return { totalShown, recent: [...recent] };
}
