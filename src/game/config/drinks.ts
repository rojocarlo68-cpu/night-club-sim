/**
 * Central drinks catalogue (Prompt A Phase 3).
 * Tuning values — add products by appending to DRINKS_CATALOG.
 *
 * Existing scenario drinks (cerveza / refresco / shot_barato) keep their public
 * prices as basePrice. New spirits sit on the SAME price scale (~$5–$12), not
 * the prompt's illustrative $45 figures.
 *
 * Phase 3: inventory + UI only. Serving still reads scenario.json drinks/prices
 * until Phase 4 hooks stock and Phase 5 hooks editable prices into payout.
 */

export interface DrinkProduct {
  id: string;
  /** Spanish display name. */
  name: string;
  /** Cost paid to the supplier per unit restocked. */
  supplierCost: number;
  /** Default public sale price. */
  basePrice: number;
  /** Floor for player price edits (Phase 5). */
  minPrice: number;
  /** Ceiling for player price edits (Phase 5). */
  maxPrice: number;
  /** +/- step for price arrows (Phase 5). */
  priceStep: number;
  /** Relative popularity weight (higher = more requested). */
  demandWeight: number;
  /** Starting stock when no save exists. */
  startStock: number;
  /** Pour duration used when/if this drink is served (ms). */
  serveTimeMs: number;
  /** Scales patron preference rolls (staff-oriented products like café/agua ≈ low). Default 1. */
  patronPrefScale?: number;
  /**
   * Alcohol content in "units" per serving (0 = none). Single source for both staff
   * (config/staffConsumption.ts) and the future customer intoxication model.
   */
  alcoholUnits?: number;
}

/**
 * Full catalogue. First three ids match public/data/scenario.json exactly.
 * supplierCost ≈ 40–50% of basePrice for the legacy drinks.
 */
export const DRINKS_CATALOG: readonly DrinkProduct[] = [
  {
    id: 'cerveza',
    name: 'Cerveza',
    supplierCost: 3.5,
    basePrice: 8,
    minPrice: 3,
    maxPrice: 20,
    priceStep: 1,
    demandWeight: 1.2,
    startStock: 20,
    serveTimeMs: 2000,
    alcoholUnits: 1,
  },
  {
    id: 'refresco',
    name: 'Refresco',
    supplierCost: 2,
    basePrice: 5,
    minPrice: 2,
    maxPrice: 14,
    priceStep: 1,
    demandWeight: 1.0,
    startStock: 20,
    serveTimeMs: 1200,
    alcoholUnits: 0,
  },
  {
    id: 'shot_barato',
    name: 'Shot barato',
    supplierCost: 2.5,
    basePrice: 6,
    minPrice: 2,
    maxPrice: 16,
    priceStep: 1,
    demandWeight: 0.9,
    startStock: 20,
    serveTimeMs: 1000,
    alcoholUnits: 1.2,
  },
  {
    id: 'vodka',
    name: 'Vodka',
    supplierCost: 4,
    basePrice: 9,
    minPrice: 4,
    maxPrice: 22,
    priceStep: 1,
    demandWeight: 0.7,
    startStock: 20,
    serveTimeMs: 1600,
    alcoholUnits: 1.5,
  },
  {
    id: 'whiskey',
    name: 'Whiskey',
    supplierCost: 6,
    basePrice: 12,
    minPrice: 5,
    maxPrice: 28,
    priceStep: 1,
    demandWeight: 0.55,
    startStock: 20,
    serveTimeMs: 1800,
    alcoholUnits: 1.5,
  },
  {
    id: 'ron',
    name: 'Ron',
    supplierCost: 3.5,
    basePrice: 8,
    minPrice: 3,
    maxPrice: 20,
    priceStep: 1,
    demandWeight: 0.65,
    startStock: 20,
    serveTimeMs: 1500,
    alcoholUnits: 1.4,
  },
  {
    id: 'cafe',
    name: 'Café',
    supplierCost: 1.5,
    basePrice: 4,
    minPrice: 1,
    maxPrice: 12,
    priceStep: 1,
    demandWeight: 0.2,
    startStock: 10,
    serveTimeMs: 1400,
    patronPrefScale: 0.3,
    alcoholUnits: 0,
  },
  {
    id: 'agua',
    name: 'Agua',
    supplierCost: 0.5,
    basePrice: 2,
    minPrice: 1,
    maxPrice: 8,
    priceStep: 1,
    demandWeight: 0.15,
    startStock: 15,
    serveTimeMs: 600,
    patronPrefScale: 0.25,
    alcoholUnits: 0,
  },
] as const;

export type DrinkId = (typeof DRINKS_CATALOG)[number]['id'];

const byId = new Map<string, DrinkProduct>(DRINKS_CATALOG.map((d) => [d.id, d]));

export function getDrinkProduct(id: string): DrinkProduct | undefined {
  return byId.get(id);
}

/** Alcohol units per serving (0 for non-alcoholic / unknown products). */
export function drinkAlcoholUnits(id: string): number {
  const u = byId.get(id)?.alcoholUnits;
  return typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : 0;
}

export function listDrinkProducts(): DrinkProduct[] {
  return DRINKS_CATALOG.map((d) => ({ ...d }));
}

/** Per-patron drink preference rolls (Prompt A Phase 4). */
export const DRINK_PREF = {
  /** Forced preference for profile.preferredDrink. */
  preferredForce: 0.9,
  /** Extra jitter on top of preferredForce (0..jitter → up to ~1.0). */
  preferredJitter: 0.1,
  /** Range for all other catalogue drinks. */
  otherMin: 0.12,
  otherMax: 0.72,
  /** When picking among in-stock alternatives, keep options within this of the max pref. */
  topBand: 0.12,
} as const;
