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
  },
] as const;

export type DrinkId = (typeof DRINKS_CATALOG)[number]['id'];

const byId = new Map<string, DrinkProduct>(DRINKS_CATALOG.map((d) => [d.id, d]));

export function getDrinkProduct(id: string): DrinkProduct | undefined {
  return byId.get(id);
}

export function listDrinkProducts(): DrinkProduct[] {
  return DRINKS_CATALOG.map((d) => ({ ...d }));
}
