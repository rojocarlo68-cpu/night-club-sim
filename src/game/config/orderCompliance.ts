/**
 * Player-order compliance. Normal energy/mood ALWAYS obey.
 * Only at EXTREME low energy and/or mood (or very drunk) she may refuse / delay / abandon.
 * Probabilistic — "esta mujer ya está hasta aquí", never a hard rule.
 */
export const ORDER_COMPLIANCE = {
  /** Below these (0..100) the staff is "at her limit". Above both → always obey. */
  extremeEnergy: 12,
  extremeMood: 12,
  /** Very drunk also counts as at-limit. */
  extremeIntox: 0.7,
  /** Max probability of NOT simply obeying (cap). */
  maxDisobey: 0.75,
  /** Split of disobedience outcomes. */
  outcomeWeights: { refuse: 0.55, delay: 0.3, abandon: 0.15 },
  /** Delay before reacting (ms). */
  delayMs: [1500, 4000] as [number, number],
  /** After refusing, chance she goes to rest on her own. */
  restAfterRefuse: 0.5,
} as const;

export const REFUSE_LINES = [
  'Ahora no… ya no puedo más.',
  'Dame un respiro, por favor.',
  'No. Necesito sentarme.',
  '¿Otra vez? Hoy no.',
];
export const DRUNK_REFUSE_LINES = ['Jeje… ¿qué dijiste?', 'Ahorita voy… *hic*', 'Mmm… no.'];
export const DELAY_LINES = ['Ya voy… ya voy…', 'Uff… un segundo.', 'Mmm… está bien.'];
export const ABANDON_LINES = ['No… lo dejo para luego.', 'Ya no puedo con esto.'];
