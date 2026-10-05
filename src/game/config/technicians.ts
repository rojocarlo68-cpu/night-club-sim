/**
 * Repair technicians. Reputation is useful but imperfect info (no exact %).
 * Hidden quality is rolled per job around a stars-based mean — never deterministic.
 */
export interface TechnicianDef {
  id: string;
  name: string;
  /** 1..5 shown as ★. */
  stars: number;
  /** Paid when he ARRIVES and starts the service. */
  consultFee: number;
  /** Multiplier on the quoted repair cost (cheap techs sometimes quote odd). */
  quoteMult: number;
}

export const TECHNICIANS: readonly TechnicianDef[] = [
  { id: 'raul', name: 'Técnico Raúl', stars: 2, consultFee: 35, quoteMult: 0.85 },
  { id: 'chuy', name: 'Técnica Chuy', stars: 3, consultFee: 55, quoteMult: 0.95 },
  { id: 'martin', name: 'Técnico Martín', stars: 4, consultFee: 80, quoteMult: 1.05 },
  { id: 'esteban', name: 'Técnico Esteban', stars: 5, consultFee: 120, quoteMult: 1.2 },
];

/** Real-time ms (1 game minute = 1 real second; always within the same day). */
export const REPAIR_TIMING = {
  arrivalMs: [12000, 45000] as [number, number],
  inspectMs: [20000, 35000] as [number, number],
  repairWorkMs: [6000, 10000] as [number, number],
  /** If the player never answers the verdict (should not happen: dismiss = no reparar). */
  verdictTimeoutMs: 60000,
} as const;

/** Quality model (0..1). mean = base + stars × perStar; sd adds uncertainty. */
export const REPAIR_QUALITY = {
  base: 0.22,
  perStar: 0.145,
  sd: 0.17,
  /** Durability restored = (restoreMin + restoreSpan × q) of the new max. */
  restoreMin: 0.55,
  restoreSpan: 0.45,
  /** Every repair permanently shrinks maxDurability (nothing lasts forever). */
  maxShrinkMin: 0.04,
  maxShrinkBadExtra: 0.12,
  /** Durability decay multiplier after repair = 1 + (1-q) × this (sloppy work wears faster). */
  fragilityPerBad: 1.8,
  /** Sudden failure chance per real minute = (1-q)^2 × this (bad repairs can fail the same day). */
  suddenFailPerMin: 0.4,
  /** Below this new max → the piece is basically spent (still repairable, but barely). */
  minMaxDurability: 12,
} as const;

/** Quote: price × (base + span × damage) × jitter × tech.quoteMult, rounded to $5. */
export const REPAIR_COST = {
  base: 0.25,
  span: 0.6,
  jitter: [0.85, 1.25] as [number, number],
  min: 15,
} as const;

/** Short diagnosis lines by function tag (Spanish). {name} = piece name (lowercase). */
export const DIAGNOSES: Record<string, string[]> = {
  service_beer: [
    'El grifo necesita reemplazo de una válvula.',
    'La manguera del grifo está rajada.',
    'El serpentín está tapado de sarro.',
  ],
  service_bar: [
    'La cubierta de la barra está desprendida.',
    'Una bisagra del mostrador está rota.',
    'La tarja de la barra tiene una fuga.',
  ],
  seating: [
    'Una pata está floja y astillada.',
    'El tapiz está desgarrado y hay que cambiar el relleno.',
    'La estructura está vencida de un lado.',
  ],
  entertainment_future: ['Un mecanismo interno está trabado.', 'Faltan piezas y hay que ajustarlo.'],
  default: ['Tiene piezas sueltas que hay que cambiar.', 'El {name} está dañado por el uso.'],
};

/** Pieces that can break and be repaired. Pure decoration (posters, velas…) is excluded. */
export const NON_BREAKABLE_FUNCTIONS = new Set(['identity']);
export const NON_BREAKABLE_IDS = new Set([
  'poster_club', 'cartel_abierto', 'cartel_bebidas', 'cartel_cerveza', 'vela_grande', 'planta_interior',
  'bandeja_decorativa', 'craneo_decorativo', 'cajas_madera', 'barril_decorativo', 'alfombra_medieval',
  'tapiz_medieval', 'banderas_club', 'escudo_decorativo', 'coleccion_jarras', 'copas_expuestas',
]);

export function starsLabel(n: number): string {
  const s = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}
