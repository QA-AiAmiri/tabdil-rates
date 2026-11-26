import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateHistory, kabulDate, withSeed } from '../history.mjs';

const market = (buy, sell) => ({ id: 'm', rates: [{ pair: 'USD/AFN', buy, sell, unit: 1 }] });
const T = Date.parse('2026-11-26T05:00:00Z'); // 09:30 Kabul

test('builds intraday points and one daily candle per Kabul day', () => {
  let h = updateHistory(null, market(66, 67), T);
  h = updateHistory(h, market(67, 68), T + 15 * 60e3);
  h = updateHistory(h, market(65, 66), T + 30 * 60e3);
  const p = h.pairs['USD/AFN'];
  assert.deepEqual(p.intraday.map(([, v]) => v), [66.5, 67.5, 65.5]);
  assert.deepEqual(p.daily, [['2026-11-26', 66.5, 67.5, 65.5, 65.5]]);
});

test('drops intraday points older than 24h and starts a new day', () => {
  let h = updateHistory(null, market(66, 67), T);
  h = updateHistory(h, market(68, 69), T + 864e5 + 1);
  const p = h.pairs['USD/AFN'];
  assert.equal(p.intraday.length, 1);
  assert.equal(p.daily.length, 2);
  assert.equal(p.daily[1][0], kabulDate(T + 864e5 + 1));
});

test('seed fills missing days; recorded days win', () => {
  const seed = { marketId: 'm', pairs: { 'USD/AFN': { intraday: [], daily: [['2026-11-24', 66, 67, 66, 67], ['2026-11-25', 67, 67, 66.5, 66.8]] } } };
  const own = updateHistory(null, market(66, 67), T); // 2026-11-26
  own.pairs['USD/AFN'].daily.unshift(['2026-11-25', 1, 1, 1, 1]);
  const h = withSeed(own, seed);
  assert.deepEqual(h.pairs['USD/AFN'].daily.map((d) => [d[0], d[4]]), [['2026-11-24', 67], ['2026-11-25', 1], ['2026-11-26', 66.5]]);
  assert.equal(h.pairs['USD/AFN'].intraday.length, 1);
  assert.equal(withSeed(null, seed).pairs['USD/AFN'].daily.length, 2);
  assert.equal(withSeed(own, null), own);
});
