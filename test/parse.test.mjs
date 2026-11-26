import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRates, isSane } from '../parse.mjs';

const html = readFileSync(new URL('./fixtures/khorasan-market.html', import.meta.url), 'utf8');

test('parses a real market page', () => {
  const rates = parseRates(html);
  assert.ok(rates.length >= 3);
  const usd = rates.find((r) => r.pair === 'USD/AFN');
  assert.equal(usd.unit, 1);
  assert.ok(usd.buy > 20 && usd.sell >= usd.buy);
  assert.equal(typeof usd.changePct, 'number');
  assert.match(usd.time, /^\d{2}:\d{2}$/);
  assert.ok(isSane(rates));
});

test('reads 1K units and change direction', () => {
  const row = (label, buy, sell, cls, pill) =>
    `<tr><td><span class="pair-code">${label}</span><span class="pair-name">X</span></td>
     <td class="is-buy">${buy}</td><td class="is-sell">${sell}</td><td class="rate-time">14:57</td>
     <td><span class="change-pill ${cls}">${pill}</span></td></tr>`;
  const rates = parseRates(`<table class="table-rates"><tbody>
    ${row('PKR/AFN 1K', '233', '234', 'is-down', '▼ 0.21%')}
    ${row('USD/IRR', '273,000.00', '273,500.00', 'is-even', '• 0.00%')}
  </tbody></table>`);
  assert.deepEqual(rates.map((r) => [r.pair, r.unit, r.buy, r.changePct]), [
    ['PKR/AFN', 1000, 233, -0.21],
    ['USD/IRR', 1, 273000, 0]
  ]);
});

test('rejects a page whose layout changed', () => {
  assert.deepEqual(parseRates('<div>nothing here</div>'), []);
  assert.equal(isSane([]), false);
  assert.equal(isSane([{ pair: 'USD/AFN', buy: 0.7, sell: 0.6 }]), false);
});
