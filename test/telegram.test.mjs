import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, changedMarkets, kabulClock, postTelegram, session, toJalali } from '../telegram.mjs';

test('Solar Hijri conversion matches known dates', () => {
  assert.deepEqual(toJalali(2025, 3, 21), [1404, 1, 1]);
  assert.deepEqual(toJalali(2026, 11, 28), [1405, 9, 7]);
});

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
  assert.match(msg, /📅 جمعه 6 قوس 1405 · ساعت 14:30/); // Kabul is UTC+4:30; 27 Nov 2026 = 6 Qaws 1405
  assert.match(msg, /^🇺🇸 دالر امریکایی$/m);
  assert.match(msg, /^خرید 66\.80 · فروش 66\.90 🔺$/m);
  assert.match(msg, /^🇮🇷 تومان ایران \(یک میلیون\)\nخرید 234\.00 · فروش 235\.00$/m);
  // Every non-empty line starts with Dari text (after an emoji), so Telegram renders it right to left.
  for (const line of msg.split('\n').filter(Boolean)) assert.match(line, /^[^\p{L}]*[؀-ۿ]/u, line);
});

test('without secrets nothing is sent', async () => {
  const state = await postTelegram({ markets: [], telegram: { openDate: 'x' } }, [market('a', [usd(1, 1)])], { token: '', chat: '' });
  assert.deepEqual(state, { openDate: 'x' });
});

// Kabul is UTC+4:30. 2026-11-28 is a Saturday, 2026-11-27 a Friday.
const kabul = (d, hh, mm) => Date.UTC(2026, 10, d, hh, mm) - 4.5 * 3600_000;

test('kabulClock reads the Kabul date, weekday and time', () => {
  assert.deepEqual(kabulClock(kabul(28, 8, 0)), { date: '2026-11-28', day: 6, minutes: 480 });
});

test('opening at 08:00 and closing at 16:00, once a day, never on Friday', () => {
  assert.equal(session(kabul(28, 7, 30)), null);
  assert.equal(session(kabul(28, 8, 0)), 'open');
  assert.equal(session(kabul(28, 8, 30), { openDate: '2026-11-28' }), null);
  assert.equal(session(kabul(28, 16, 0), { openDate: '2026-11-28' }), 'close');
  assert.equal(session(kabul(28, 16, 30), { openDate: '2026-11-28', closeDate: '2026-11-28' }), null);
  assert.equal(session(kabul(27, 10, 0)), null);
  assert.equal(session(kabul(29, 8, 0), { openDate: '2026-11-28' }), 'open'); // new day
});

test('opening post goes to every fresh market and is remembered', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body).text);
    return { json: async () => ({ ok: true }) };
  });
  const prev = { markets: [market('sarai-shahzada', [usd(66.8, 66.85)])] };
  const now = [market('sarai-shahzada', [usd(66.8, 66.85)]), market('da-afg-bank', [usd(66.9, 67)]), market('khorasan-market', [usd(1, 1)], true)];
  const state = await postTelegram(prev, now, { now: kabul(28, 8, 0), token: 't', chat: 'c' });
  assert.equal(sent.length, 2); // stale market skipped
  assert.match(sent[0], /بازار باز شد/);
  assert.deepEqual(state, { openDate: '2026-11-28' });
});

test('a failed opening post is retried on the next run', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ json: async () => ({ ok: false, description: 'down' }) }));
  const state = await postTelegram({ markets: [] }, [market('a', [usd(1, 1)])], { now: kabul(28, 8, 0), token: 't', chat: 'c' });
  assert.deepEqual(state, {});
});
