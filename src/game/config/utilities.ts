/**
 * Phase 9: monthly club utilities (gas / water / electricity).
 * Tuning values — keep all costs here; do not hardcode elsewhere.
 * Club earns roughly $20–40/night in current tests.
 */

/** Monthly cost per service (tuning knobs, not final balance). */
export const MONTHLY_UTILITIES = {
  gas: 60,
  water: 40,
  electricity: 100,
} as const;

export type UtilityKey = keyof typeof MONTHLY_UTILITIES;

/** Spanish labels for summary UI. */
export const UTILITY_LABELS: Record<UtilityKey, string> = {
  gas: 'Gas',
  water: 'Agua',
  electricity: 'Electricidad',
};

/** Ordered lines for payroll-style summaries. */
export function monthlyUtilityLines(): { key: UtilityKey; label: string; amount: number }[] {
  return (Object.keys(MONTHLY_UTILITIES) as UtilityKey[]).map((key) => ({
    key,
    label: UTILITY_LABELS[key],
    amount: Math.max(0, Math.floor(MONTHLY_UTILITIES[key])),
  }));
}

/** Total monthly utilities bill. */
export function monthlyUtilitiesTotal(): number {
  return monthlyUtilityLines().reduce((sum, l) => sum + l.amount, 0);
}
