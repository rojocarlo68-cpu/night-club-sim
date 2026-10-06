/**
 * Customer thought catalog (tone guide, not a closed list).
 * Every thought is fired by a REAL perceived event; satisfaction is applied by the
 * event itself (existing perception paths or the `sat` here for new events).
 * Placeholders: {staff}, {drink}, {item}.
 */
export type ThoughtTone = 'pos' | 'neg' | 'neutral';

export interface ThoughtDef {
  texts: string[];
  emoji: string;
  tone: ThoughtTone;
  /** 1 = minor, 2 = normal, 3 = important (problems / affinity) — may bypass the soft cap. */
  priority: 1 | 2 | 3;
}

export const THOUGHTS: Record<string, ThoughtDef> = {
  // ── Negative ──
  dirty_floor: { texts: ['Ugh… este lugar es asqueroso.', 'Qué piso tan pegajoso…'], emoji: '🤢', tone: 'neg', priority: 3 },
  dirty_furniture: { texts: ['Esto está mugroso…', 'Nadie limpia aquí, ¿o qué?'], emoji: '🤢', tone: 'neg', priority: 2 },
  flies: { texts: ['¿Eso son moscas? Qué asco.', 'Hay moscas por aquí…'], emoji: '🪰', tone: 'neg', priority: 3 },
  no_seat: { texts: ['No encuentro dónde sentarme.', 'No hay ni un lugar libre…'], emoji: '😒', tone: 'neg', priority: 3 },
  no_beer: { texts: ['No tienen cerveza… veré si se me antoja algo más.'], emoji: '😒', tone: 'neg', priority: 3 },
  no_drink: { texts: ['No tienen {drink}… veré si se me antoja algo más.'], emoji: '😒', tone: 'neg', priority: 3 },
  nothing_left: { texts: ['¿No les queda nada? Me voy.'], emoji: '😠', tone: 'neg', priority: 3 },
  too_expensive: { texts: ['Está muy caro para lo que es.'], emoji: '😒', tone: 'neg', priority: 2 },
  broken_furniture: { texts: ['¿Por qué tienen esto así?', 'Esto está roto…'], emoji: '😕', tone: 'neg', priority: 2 },
  uncomfortable: { texts: ['Qué incómodo es esto.'], emoji: '😣', tone: 'neg', priority: 1 },
  long_wait: { texts: ['¿Cuánto falta para que me atiendan?', 'Llevo un buen rato esperando…'], emoji: '😐', tone: 'neg', priority: 2 },
  stale_beer: { texts: ['Esta cerveza ya está tibia…'], emoji: '😕', tone: 'neg', priority: 2 },
  stale_snack: { texts: ['Estas botanas ya están aguadas…'], emoji: '😕', tone: 'neg', priority: 2 },
  spoiled_seen: { texts: ['Esa cerveza lleva horas ahí… qué asco.'], emoji: '🤢', tone: 'neg', priority: 2 },
  angry_leave: { texts: ['¡Ya me cansé de esperar!'], emoji: '😠', tone: 'neg', priority: 3 },
  // Trash (only what this customer can see right next to them).
  trash_seen: { texts: ['¿Por qué hay basura aquí?', 'Alguien debería recoger eso…'], emoji: '😒', tone: 'neg', priority: 2 },
  trash_dirty: { texts: ['Ugh… este lugar está sucio.', 'Qué asco…'], emoji: '🤢', tone: 'neg', priority: 3 },
  trash_bag: { texts: ['Esto se ve descuidado.', '¿Una bolsa de basura aquí?'], emoji: '😒', tone: 'neg', priority: 2 },
  // Hook for entertainment (only fires once entertainment exists).
  boring: { texts: ['Está bastante aburrido aquí.'], emoji: '🥱', tone: 'neg', priority: 1 },

  // ── Positive ──
  impressive_armor: { texts: ['¡Wow! ¿Esta armadura medieval es real?'], emoji: '😮', tone: 'pos', priority: 2 },
  impressive_decor: { texts: ['¡Qué {item} tan impresionante!', 'Mira nada más ese {item}…'], emoji: '😮', tone: 'pos', priority: 2 },
  clean_place: { texts: ['Está bastante limpio aquí.'], emoji: '🙂', tone: 'pos', priority: 1 },
  good_seat: { texts: ['Perfecto, aquí me quedo.', 'Qué cómodo está esto.'], emoji: '😊', tone: 'pos', priority: 1 },
  fast_drink: { texts: ['¡Eso fue rápido!'], emoji: '😃', tone: 'pos', priority: 1 },
  ready_beer: { texts: ['¡Ya estaba servida! Eso fue rápido.'], emoji: '😃', tone: 'pos', priority: 2 },
  snack_found: { texts: ['Perfecto, también tienen botanas.'], emoji: '😋', tone: 'pos', priority: 2 },
  tap_great: { texts: ['¡Wow! Ese grifo de cerveza está genial.', 'Este lugar tiene buen grifo.'], emoji: '🍺', tone: 'pos', priority: 2 },
  like_place: { texts: ['Me gusta este lugar.'], emoji: '😍', tone: 'pos', priority: 2 },

  // ── Affinity ──
  affinity_fav: { texts: ['¡Ay Dios! {staff} es mi favorita.', '¡{staff} está aquí hoy!'], emoji: '😍', tone: 'pos', priority: 3 },
  affinity_spark: { texts: ['Cielos… esa chica es hermosa.', '¿Quién es ella? Qué guapa…'], emoji: '😍', tone: 'pos', priority: 3 },
  affinity_served: { texts: ['Me encanta que me atienda {staff}.'], emoji: '❤️', tone: 'pos', priority: 2 },
  affinity_goodbye: { texts: ['Me encantó que me atendiera {staff}. Mañana regreso.', 'Espero que {staff} esté aquí mañana.'], emoji: '😊', tone: 'pos', priority: 3 },
};

/** Anti-spam rules (display only; satisfaction from events always applies). */
export const THOUGHT_RULES = {
  /** On-screen duration. */
  showMs: 3400,
  /** Min gap between two thoughts of the same patron (priority 3 uses the short gap). */
  minGapMs: 6500,
  minGapHighMs: 3000,
  /** Soft cap per visit (priority 3 may exceed by `highExtra`). */
  maxPerVisit: 5,
  highExtra: 2,
  /** Max simultaneous thought bubbles on screen (selected patron is exempt). */
  maxOnScreen: 3,
  /** Panel shows the last N thoughts of the selected patron. */
  logSize: 4,
} as const;

/** Decor that can impress customers nearby (catalog id → thought key + sat). */
export const IMPRESSIVE_DECOR: Record<string, { thought: string; sat: number; chance: number }> = {
  armadura_decorativa: { thought: 'impressive_armor', sat: 3, chance: 0.6 },
  estatua_medieval: { thought: 'impressive_decor', sat: 2.5, chance: 0.45 },
  chimenea_decorativa: { thought: 'impressive_decor', sat: 2.5, chance: 0.45 },
  fuente_pequena: { thought: 'impressive_decor', sat: 2, chance: 0.4 },
  letrero_neon_medieval: { thought: 'impressive_decor', sat: 2, chance: 0.4 },
  candelabro_grande: { thought: 'impressive_decor', sat: 1.5, chance: 0.3 },
  pequeno_escenario: { thought: 'impressive_decor', sat: 2, chance: 0.35 },
};

/** New-event satisfaction deltas (moderate; existing clamps apply). */
export const THOUGHT_SAT = {
  noSeat: -3,
  longWait: -3,
  fastDrink: 2,
  cleanPlace: 1.5,
  likePlace: 0,
  affinitySpark: 4,
  affinityFav: 2,
  affinityGoodbye: 1,
  spoiledSeen: -2,
  /** Affinity spark chance when a patron with no opinion sees a staff member up close. */
  sparkChance: 0.12,
  /** Seconds inside before "clean place" can be thought. */
  cleanPlaceAfterMs: 15000,
  cleanPlaceChance: 0.35,
  /** Waited less than this (ms) at the bar → "¡Eso fue rápido!". */
  fastServeMs: 7000,
} as const;
