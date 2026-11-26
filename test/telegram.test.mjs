import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, changedMarkets, postChanges } from '../telegram.mjs';

const usd = (buy, sell) => ({ pair: 'USD/AFN', base: 'USD', quote: 'AFN', unit: 1, buy, sell });
const irr = { pair: 'IRR/AFN', base: 'IRR', quote: 'AFN', unit: 1000, buy: 0.234, sell: 0.235 };
const market = (id, rates, stale = false) => ({ id, name: id, stale, rates });

test('only markets whose buy or sell moved count as changed', () => {
  const prev = { markets: [market('a', [usd(66.8, 66.85)]), market('b', [usd(66.8, 66.85)])] };
  const now = [market('a', [usd(66.8, 66.85)]), market('b', [usd(66.8, 66.9)]), market('c', [usd(1, 1)], true)];
  assert.deepEqual(changedMarkets(prev, now).map((m) => m.id), ['b']);
  assert.deepEqual(changedMarkets(null, now), []); // first run sends nothing
  assert.deepEqual(changedMarkets({ markets: [] }, [market('a', [usd(1, 1)])]).map((m) => m.id), ['a']);
});

test('message shows toman per 1M and marks the direction of change', () => {
  const msg = buildMessage(market('sarai-shahzada', [usd(66.8, 66.9), irr]), market('sarai-shahzada', [usd(66.8, 66.85), irr]), Date.UTC(2026, 10, 27, 10, 0));
  assert.match(msg, /سرای شهزاده/);
  assert.match(msg, /27\/11\/2026, 14:30/); // Kabul is UTC+4:30
  assert.match(msg, /USD \| 66\.80 \| 66\.90 ▲/);
  assert.match(msg, /IRT \(1M\) \| 234\.00 \| 235\.00$/m);
});

test('without secrets nothing is sent', async () => {
  await postChanges({ markets: [] }, [market('a', [usd(1, 1)])], { token: '', chat: '' });
});
