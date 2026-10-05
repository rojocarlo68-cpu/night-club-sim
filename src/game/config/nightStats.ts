/**
 * Prompt A Phase 10: nightly sales/stats log + summary snippets.
 * Balance / caps only — do not scatter magic numbers.
 */

/** Rolling night history kept in save. */
export const NIGHT_STATS_HISTORY_CAP = 30;

/** Spanish summary line templates (UI). No satisfaction numbers. */
export const NIGHT_SUMMARY_LINES = {
  /** Bebidas: {sold} vendidas · ${revenue} */
  drinks: (sold: number, revenue: number) =>
    `Bebidas: ${sold} vendidas · $${Math.round(revenue)}`,
  /** Agotado: Name1, Name2 — omit entirely when empty. */
  stockout: (names: string[]) =>
    names.length ? `Agotado: ${names.join(', ')}` : null,
  /** Atendidos: N */
  served: (n: number) => `Atendidos: ${n}`,
} as const;
