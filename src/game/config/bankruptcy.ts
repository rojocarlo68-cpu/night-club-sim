/**
 * Bankruptcy = GAME OVER (real loss condition, never arbitrary).
 *
 * Integrates with the EXISTING economy: purchases can never push money below zero (they are
 * blocked), but salaries (weekly) and services (monthly) are always charged and may leave the
 * club in the red (ALLOW_NEGATIVE_BALANCE). A negative balance after a due charge therefore IS
 * an unpaid obligation ("Pago pendiente"). The player gets a grace period to cover it; only if
 * it is still unpaid after the grace nights does the club go bankrupt.
 */
export const BANKRUPTCY = {
  /** Nights (after the one that left the club in the red) to get back to $0 or more. */
  graceNights: 3,
} as const;

export const BANKRUPTCY_TEXT = {
  pendingLine: (amount: number, daysLeft: number) =>
    `⚠ Pago pendiente: $${amount} · ${daysLeft <= 0 ? 'último día para cubrirlo' : daysLeft === 1 ? 'falta 1 día para cubrirlo' : `faltan ${daysLeft} días para cubrirlo`}`,
  title: 'BANCARROTA',
  subtitle: 'El club no pudo cubrir sus pagos a tiempo.',
} as const;
