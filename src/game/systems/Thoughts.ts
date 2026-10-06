/**
 * Customer thoughts: LOG + rare emotes only. Satisfaction is applied by the event that
 * perceived something (existing perception systems); this never reads global state.
 *
 * - Every perceived thought is recorded in the customer's visit log (customer window), whether
 *   the customer is selected or not. No text ever appears over the head.
 * - Only "significant" kinds (ThoughtDef.emote) may pop an emoji over the head, throttled by
 *   EMOTE_RULES (per-customer cooldown, per-visit cap, club-wide on-screen cap).
 */
import { THOUGHTS, THOUGHT_RULES, EMOTE_RULES, ThoughtDef, ThoughtSensTrait } from '../config/thoughts';

export interface ThoughtLogEntry {
  key: string;
  text: string;
  emoji: string;
  tone: ThoughtDef['tone'];
  at: number;
  /** True when this thought also popped an emote over the head. */
  emoted: boolean;
}

interface VisitThoughts {
  lastEmoteAt: number;
  emoteCount: number;
  keys: Set<string>;
  log: ThoughtLogEntry[];
}

const visits = new WeakMap<object, VisitThoughts>();
let totalLogged = 0;
let totalEmotes = 0;
const recent: Array<{ patron: string; key: string; text: string; at: number; emoted: boolean }> = [];

function stateOf(patron: object): VisitThoughts {
  let v = visits.get(patron);
  if (!v) {
    v = { lastEmoteAt: -1e9, emoteCount: 0, keys: new Set(), log: [] };
    visits.set(patron, v);
  }
  return v;
}

function fill(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

/** Pick the wording: sensitivity variant from the customer's trait, else the default texts. */
export function pickThoughtTexts(def: ThoughtDef, traits?: Partial<Record<ThoughtSensTrait, number>> | null): string[] {
  const v = def.variants;
  if (!v || !traits) return def.texts;
  const t = traits[v.trait];
  if (typeof t !== 'number' || !Number.isFinite(t)) return def.texts;
  if (t >= (v.highAt ?? 0.6) && v.high.length) return v.high;
  if (t <= (v.lowAt ?? 0.4) && v.low.length) return v.low;
  return def.texts;
}

export interface ThoughtDecision {
  /** Emoji to pop over the head now (null = log only). */
  emote: string | null;
  text: string;
  emoji: string;
  tone: ThoughtDef['tone'];
  key: string;
}

/**
 * Record a perceived event as a thought (always logged, once per key per visit) and decide
 * whether it is significant enough to pop an emote over the head.
 * Returns null if the key was already used this visit.
 */
export function decideThought(
  patron: { profile: { name: string } },
  key: string,
  now: number,
  ctx: {
    /** Emotes currently visible in the club. */
    emotesOnScreen: number;
    vars?: Record<string, string>;
    traits?: Partial<Record<ThoughtSensTrait, number>> | null;
    rng?: () => number;
  }
): ThoughtDecision | null {
  const def = THOUGHTS[key];
  if (!def) return null;
  const v = stateOf(patron);
  if (v.keys.has(key)) return null;
  v.keys.add(key);
  const rng = ctx.rng ?? Math.random;
  const pool = pickThoughtTexts(def, ctx.traits);
  const text = fill(pool[Math.floor(rng() * pool.length)] ?? def.texts[0], ctx.vars);
  let emote: string | null = null;
  if (
    def.emote &&
    now - v.lastEmoteAt >= EMOTE_RULES.perPatronCooldownMs &&
    v.emoteCount < EMOTE_RULES.maxPerVisit &&
    ctx.emotesOnScreen < EMOTE_RULES.maxOnScreen
  ) {
    emote = def.emote;
    v.lastEmoteAt = now;
    v.emoteCount += 1;
    totalEmotes += 1;
  }
  totalLogged += 1;
  v.log.push({ key, text, emoji: def.emoji, tone: def.tone, at: now, emoted: !!emote });
  if (v.log.length > THOUGHT_RULES.logSize) v.log.shift();
  recent.push({ patron: patron.profile.name, key, text, at: now, emoted: !!emote });
  if (recent.length > 80) recent.shift();
  return { emote, text, emoji: def.emoji, tone: def.tone, key };
}

export function hasThought(patron: object, key: string): boolean {
  return stateOf(patron).keys.has(key);
}

export function thoughtLog(patron: object): ThoughtLogEntry[] {
  return [...stateOf(patron).log];
}

export function getThoughtsDebug() {
  return { totalLogged, totalEmotes, recent: [...recent] };
}

// ─── Save slots (pause menu): exact live state of this module (versioned by SaveSlots). ───

export function exportThoughts(patron: object) {
  const v = stateOf(patron);
  return { lastEmoteAt: v.lastEmoteAt, emoteCount: v.emoteCount, keys: [...v.keys], log: v.log.map((l) => ({ ...l })) };
}

export function importThoughts(patron: object, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const o = raw as ReturnType<typeof exportThoughts>;
  visits.set(patron, {
    lastEmoteAt: typeof o.lastEmoteAt === 'number' ? o.lastEmoteAt : -1e9,
    emoteCount: typeof o.emoteCount === 'number' ? o.emoteCount : 0,
    keys: new Set(Array.isArray(o.keys) ? o.keys : []),
    log: Array.isArray(o.log) ? o.log.map((l) => ({ ...l })) : [],
  });
}
