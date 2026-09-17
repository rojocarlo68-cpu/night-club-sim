/**
 * Smoke test for refundForWear (mirrors src/game/systems/FurnitureStats.ts).
 * Run: node scripts/test-refund.mjs
 */
function clampStat(n, max = 100) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

function refundForWear(purchasePrice, durability, maxDurability) {
  const price = Math.max(0, Math.floor(purchasePrice));
  if (price <= 0) return 0;
  const maxD = Math.max(1, maxDurability);
  const r = clampStat(durability / maxD, 1);
  if (r < 0.5) return 0;
  return Math.floor((price * (r - 0.5)) / 0.5);
}

function assertEq(got, want, label) {
  if (got !== want) {
    console.error(`FAIL ${label}: got ${got}, want ${want}`);
    process.exitCode = 1;
  } else {
    console.log(`ok  ${label}: ${got}`);
  }
}

assertEq(refundForWear(100, 0, 100), 0, '0% durability → $0');
assertEq(refundForWear(100, 49, 100), 0, '49% < 0.5 → $0');
assertEq(refundForWear(100, 50, 100), 0, '50% threshold → $0');
assertEq(refundForWear(100, 75, 100), 50, '75% → 50% of price');
assertEq(refundForWear(100, 100, 100), 100, '100% → full price');
assertEq(refundForWear(40, 100, 100), 40, 'starter full refund');
assertEq(refundForWear(0, 100, 100), 0, 'unknown price → $0');

if (process.exitCode) {
  console.error('refund tests FAILED');
  process.exit(1);
}
console.log('refund tests passed');
