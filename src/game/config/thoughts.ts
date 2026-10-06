/**
 * Customer thought catalog (tone guide, not a closed list).
 * Every thought is fired by a REAL perceived event; satisfaction is applied by the
 * event itself (existing perception paths or the `sat` here for new events).
 * Placeholders: {staff}, {drink}, {item}.
 */
export type ThoughtTone = 'pos' | 'neg' | 'neutral';

/** Customer trait that picks a sensitivity variant (same problem, different reaction). */
export type ThoughtSensTrait = 'cleanSens' | 'comfortSens' | 'priceSens' | 'availSens' | 'tolerance' | 'generosity';

export interface ThoughtDef {
  /** Default texts (used when no variant applies). Logged in the customer window only. */
  texts: string[];
  /** Icon shown next to the text in the customer window log. */
  emoji: string;
  tone: ThoughtTone;
  /** 1 = minor, 2 = normal, 3 = important (problems / affinity). Log ordering / anti-spam only. */
  priority: 1 | 2 | 3;
  /**
   * SIGNIFICANCE FLAG: emoji that may pop over the customer's head for this kind of thought.
   * Omitted = the thought is logged SILENTLY (window only, nothing over the head).
   * Even significant thoughts are throttled by EMOTE_RULES (per-customer cooldown, on-screen cap).
   */
  emote?: string;
  /**
   * Optional sensitivity variants: the customer's trait picks the wording, so two customers facing
   * the same problem react differently (very sensitive vs. relaxed). Trait 0..1.
   */
  variants?: { trait: ThoughtSensTrait; high: string[]; low: string[]; highAt?: number; lowAt?: number };
}

export const THOUGHTS: Record<string, ThoughtDef> = {
  // ── Negative ──
  dirty_floor: {
    texts: ['Ugh… este lugar es asqueroso.', 'Qué piso tan pegajoso…'],
    emoji: '🤢', tone: 'neg', priority: 3, emote: '🤢',
    variants: { trait: 'cleanSens', high: ['Ugh… este lugar es asqueroso.', 'Qué piso tan pegajoso… qué asco.'], low: ['Mmm, el piso podría estar más limpio.', 'Está algo pegajoso aquí, pero bueno.'] },
  },
  dirty_furniture: {
    texts: ['Esto está mugroso…', 'Nadie limpia aquí, ¿o qué?'], emoji: '🤢', tone: 'neg', priority: 2,
    variants: { trait: 'cleanSens', high: ['Esto está mugroso…', 'Nadie limpia aquí, ¿o qué?'], low: ['Le falta una limpiadita a esto.'] },
  },
  flies: { texts: ['¿Eso son moscas? Qué asco.', 'Hay moscas por aquí…'], emoji: '🪰', tone: 'neg', priority: 3, emote: '🤢' },
  no_seat: {
    texts: ['No encuentro dónde sentarme.', 'No hay ni un lugar libre…'], emoji: '😒', tone: 'neg', priority: 3,
    variants: { trait: 'comfortSens', high: ['No encuentro dónde sentarme.', 'No hay ni un lugar libre… qué incómodo.'], low: ['No hay dónde sentarse… me quedo de pie.'] },
  },
  no_beer: { texts: ['No tienen cerveza… veré si se me antoja algo más.'], emoji: '😒', tone: 'neg', priority: 3 },
  no_drink: { texts: ['No tienen {drink}… veré si se me antoja algo más.'], emoji: '😒', tone: 'neg', priority: 3 },
  nothing_left: { texts: ['¿No les queda nada? Me voy.'], emoji: '😠', tone: 'neg', priority: 3, emote: '😡' },
  too_expensive: {
    texts: ['Está muy caro para lo que es.'], emoji: '😒', tone: 'neg', priority: 2,
    variants: { trait: 'priceSens', high: ['Está demasiado caro…', 'Está muy caro para lo que es.'], low: ['Hoy no me lo voy a gastar en eso.'] },
  },
  // Price perceived and bought anyway (wording depends on the customer's price sensitivity / generosity).
  price_steep_sensitive: { texts: ['Está demasiado caro…'], emoji: '😒', tone: 'neg', priority: 2 },
  price_steep_tolerant: { texts: ['Bueno… supongo que vale la pena.'], emoji: '😐', tone: 'neutral', priority: 1 },
  price_steep_generous: { texts: ['Está caro, pero me atendieron muy bien.'], emoji: '🙂', tone: 'pos', priority: 2 },
  price_cheap: { texts: ['¡Qué buen precio!', 'Aquí sí está barato.'], emoji: '🙂', tone: 'pos', priority: 1 },
  bar_broken: { texts: ['La barra está rota… no puedo pedir nada.', 'Con la barra así no me pueden servir.'], emoji: '😕', tone: 'neg', priority: 3, emote: '😕' },
  broken_furniture: { texts: ['¿Por qué tienen esto así?', 'Esto está roto…'], emoji: '😕', tone: 'neg', priority: 2 },
  uncomfortable: { texts: ['Qué incómodo es esto.'], emoji: '😣', tone: 'neg', priority: 1 },
  long_wait: {
    texts: ['¿Cuánto falta para que me atiendan?', 'Llevo un buen rato esperando…'], emoji: '😐', tone: 'neg', priority: 2,
    // tolerance HIGH = patient wording.
    variants: { trait: 'tolerance', high: ['Están ocupados… espero un poco más.'], low: ['¿Cuánto falta para que me atiendan?', 'Llevo un buen rato esperando…'] },
  },
  stale_beer: { texts: ['Esta cerveza ya está tibia…'], emoji: '😕', tone: 'neg', priority: 2 },
  stale_snack: { texts: ['Estas botanas ya están aguadas…'], emoji: '😕', tone: 'neg', priority: 2 },
  spoiled_seen: { texts: ['Esa cerveza lleva horas ahí… qué asco.'], emoji: '🤢', tone: 'neg', priority: 2, emote: '🤢' },
  angry_leave: { texts: ['¡Ya me cansé de esperar!'], emoji: '😠', tone: 'neg', priority: 3, emote: '😡' },
  // Trash (only what this customer can see right next to them).
  trash_seen: {
    texts: ['¿Por qué hay basura aquí?', 'Alguien debería recoger eso…'], emoji: '😒', tone: 'neg', priority: 2,
    variants: { trait: 'cleanSens', high: ['¿Por qué hay basura aquí?', 'Qué asco… hay basura por aquí.'], low: ['Alguien debería recoger eso…'] },
  },
  trash_dirty: { texts: ['Ugh… este lugar está sucio.', 'Qué asco…'], emoji: '🤢', tone: 'neg', priority: 3, emote: '🤢' },
  trash_bag: { texts: ['Esto se ve descuidado.', '¿Una bolsa de basura aquí?'], emoji: '😒', tone: 'neg', priority: 2 },
  // Capacity: peeked in, no room, left (only logged on the passer-by — never shown).
  club_full: { texts: ['Está lleno… mejor otro día.'], emoji: '😕', tone: 'neutral', priority: 1 },
  // Hook for entertainment (only fires once entertainment exists).
  boring: { texts: ['Está bastante aburrido aquí.'], emoji: '🥱', tone: 'neg', priority: 1 },

  // ── Positive ──
  impressive_armor: { texts: ['¡Wow! ¿Esta armadura medieval es real?'], emoji: '😮', tone: 'pos', priority: 2, emote: '😮' },
  impressive_decor: { texts: ['¡Qué {item} tan impresionante!', 'Mira nada más ese {item}…'], emoji: '😮', tone: 'pos', priority: 2, emote: '😮' },
  clean_place: { texts: ['Está bastante limpio aquí.'], emoji: '🙂', tone: 'pos', priority: 1 },
  good_seat: { texts: ['Perfecto, aquí me quedo.', 'Qué cómodo está esto.'], emoji: '😊', tone: 'pos', priority: 1 },
  fast_drink: { texts: ['¡Eso fue rápido!'], emoji: '😃', tone: 'pos', priority: 1 },
  ready_beer: { texts: ['¡Ya estaba servida! Eso fue rápido.'], emoji: '😃', tone: 'pos', priority: 2 },
  snack_found: { texts: ['Perfecto, también tienen botanas.'], emoji: '😋', tone: 'pos', priority: 2 },
  tap_great: { texts: ['¡Wow! Ese grifo de cerveza está genial.', 'Este lugar tiene buen grifo.'], emoji: '🍺', tone: 'pos', priority: 2 },
  like_place: { texts: ['Me gusta este lugar.'], emoji: '😍', tone: 'pos', priority: 2, emote: '😊' },
  returning: { texts: ['Otra vez aquí. Me gustó la última vez.'], emoji: '🙂', tone: 'pos', priority: 1 },

  // ── Affinity ──
  affinity_fav: { texts: ['¡Ay Dios! {staff} es mi favorita.', '¡{staff} está aquí hoy!'], emoji: '😍', tone: 'pos', priority: 3, emote: '😍' },
  affinity_spark: { texts: ['Cielos… esa chica es hermosa.', '¿Quién es ella? Qué guapa…'], emoji: '😍', tone: 'pos', priority: 3, emote: '😍' },
  affinity_served: { texts: ['Me encanta que me atienda {staff}.'], emoji: '❤️', tone: 'pos', priority: 2, emote: '❤️' },
  affinity_goodbye: { texts: ['Me encantó que me atendiera {staff}. Mañana regreso.', 'Espero que {staff} esté aquí mañana.'], emoji: '😊', tone: 'pos', priority: 3, emote: '😄' },
};

/**
 * Emojis reserved for the FUTURE customer intoxication system (see systems/PatronIntoxication.ts).
 * Never used as emotes by current thoughts.
 */
export const RESERVED_INTOX_EMOTES = ['🍺', '😵‍💫', '🤪'] as const;

/**
 * Emotes over heads: rare, only for significant thoughts (ThoughtDef.emote). Text never appears
 * over the head — thoughts are read in the customer window.
 */
export const EMOTE_RULES = {
  /** How long an emote stays over the head. */
  showMs: 2200,
  /** Per-customer cooldown between two emotes. */
  perPatronCooldownMs: 30000,
  /** Max emotes per customer visit. */
  maxPerVisit: 3,
  /** Max emotes visible at once in the whole club. */
  maxOnScreen: 2,
} as const;

/** Thought log rules (satisfaction from events always applies, logged or not). */
export const THOUGHT_RULES = {
  /** History kept per customer visit (customer window log). */
  logSize: 12,
  /** Customer window shows the last N thoughts (newest first). */
  panelShow: 5,
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
