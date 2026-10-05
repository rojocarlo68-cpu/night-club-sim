/**
 * Prompt B Phase B10 — occasional contextual toasts when a new day begins (after Dormir).
 * Not shown every day — probabilistic / rotating.
 */

export const DAY_START_TOAST_CHANCE = 0.35;

export const DAY_START_MESSAGES = [
  'Las chicas llegan 5 minutos antes de abrir, como siempre.',
  'El club huele a madera limpia esta tarde.',
  'Nova revisa el inventario antes de que llegue nadie.',
  'Luna estira las piernas junto al sofá.',
  'Otra noche por delante. El horario sugerido sigue siendo 18:00 — 02:00.',
] as const;

/** Fade to black / from black duration for Dormir (ms). */
export const SLEEP_FADE_MS = 1000;
