import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDaily } from '../backfill.mjs';

// 00:00 Kabul on consecutive days, as sarafi.af sends them.
const day = (n) => Date.parse('2026-11-20T19:30:00Z') + n * 864e5;

test('turns [t, close, low, high] into Kabul-day candles with open = previous close', () => {
  const d = toDaily([
    [day(0), 66.45, 66.33, 66.5],
    [day(1), 66.6, 66.4, 66.6],
    [day(2), 64.75, 64.6, 74], // typo spike in the source
    [day(3), 'x', 1, 2], // malformed
    [day(4), 70, 71, 69] // low > close: malformed
  ]);
  assert.deepEqual(d, [
    ['2026-11-21', 66.45, 66.5, 66.33, 66.45],
    ['2026-11-22', 66.45, 66.6, 66.4, 66.6],
    ['2026-11-23', 66.6, 66.6, 64.6, 64.75]
  ]);
});
