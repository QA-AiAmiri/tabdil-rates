import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateHistory, kabulDate } from '../history.mjs';

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
