// One-time backfill of daily rate history from sarafi.af's own chart data,
// used with sarafi.af's permission. Run locally, once:
//
//   node backfill.mjs        → writes seed/history-<market>.json, then commit seed/
//                              (re-running only fills pairs that are still missing)
//
// scrape.mjs merges these seed files into the published history on every run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { kabulDate } from './history.mjs';

const SITE = 'https://sarafi.af';
const MARKETS = ['sarai-shahzada', 'khorasan-market', 'da-afg-bank'];
const UA = 'TabdilRatesBot/1.0 (+https://github.com/QA-AiAmiri/tabdil-rates)';
const KEEP_DAYS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { $: cheerio.load(await res.text()), cookie };
}

// The pair page's chart loads its data with the page's own chart id and CSRF token.
async function chartPoints(url) {
  const { $, cookie } = await page(url);
  const id = $.html().match(/marketCurrency:\s*(\d+)/)?.[1];
  const token = $('meta[name="csrf-token"]').attr('content');
  if (!id || !token) throw new Error('chart id or token not found (page layout may have changed)');
  const res = await fetch(`${SITE}/en/getGraphData`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-CSRF-TOKEN': token, Cookie: cookie, Referer: url },
    body: new URLSearchParams({ market: 'market', marketCurrency: id, period: 'tenYears' }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`getGraphData → HTTP ${res.status}`);
  return res.json();
}

/**
 * sarafi.af points are [timestamp, close, low, high], one per day (the close is the sell rate).
 * Becomes our [YYYY-MM-DD, open, high, low, close]; open = previous close.
 */
export function toDaily(points) {
  const days = new Map();
  let prev = null;
  for (const [t, c, l, h] of points) {
    if (![t, c, l, h].every(Number.isFinite) || l > c || c > h) continue;
    const o = prev ?? c;
    // shortcut: source has rare typo spikes (e.g. high 74 on a 64.75 day); wicks beyond ±5% are dropped. Revisit if sarafi.af cleans its data.
    const hi = h > c * 1.05 ? Math.max(o, c) : Math.max(h, o);
    const lo = l < c * 0.95 ? Math.min(o, c) : Math.min(l, o);
    const day = kabulDate(t);
    days.set(day, [day, o, hi, lo, c]);
    prev = c;
  }
  return [...days.values()].slice(-KEEP_DAYS);
}

async function main() {
  mkdirSync('seed', { recursive: true });
  // Optional: node backfill.mjs <market-id> to redo one market.
  for (const marketId of process.argv[2] ? [process.argv[2]] : MARKETS) {
    const { $ } = await page(`${SITE}/en/exchange-rates/${marketId}`);
    const rows = $('table.table-rates tbody tr')
      .map((_, tr) => ({ href: $(tr).find('a.rate-pair').attr('href'), sell: Number($(tr).find('.is-sell').text().replace(/,/g, '')) }))
      .get()
      .filter((r) => r.href);
    // Keep what an earlier run already saved; only fetch pairs that are missing (a failed fetch never drops data).
    const file = `seed/history-${marketId}.json`;
    const pairs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).pairs : {};
    for (const { href, sell } of rows) {
      const pair = href.split('/').pop().replace('-', '/');
      if (pairs[pair]) continue;
      await sleep(1500); // be gentle with the source
      try {
        const raw = toDaily(await chartPoints(href));
        const last = raw.at(-1)?.[4];
        // Some charts are per 1 unit while the table quotes per 1,000; anything else means a wrong chart.
        const factor = last ? [1, 1000].find((f) => Math.abs(last * f - sell) / sell <= 0.1) : undefined;
        if (!factor) throw new Error(`latest close ${last} far from current sell ${sell}`);
        const daily = raw.map(([d, ...v]) => [d, ...v.map((x) => Math.round(x * factor * 1e4) / 1e4)]);
        pairs[pair] = { intraday: [], daily };
        console.log(`${marketId} ${pair}: ${daily.length} days (${daily[0][0]} → ${daily.at(-1)[0]})`);
      } catch (e) {
        console.error(`${marketId} ${pair}: skipped — ${e.message}`);
      }
    }
    writeFileSync(file, JSON.stringify({ marketId, updatedAt: new Date().toISOString(), pairs }));
  }
}

if (process.argv[1]?.endsWith('backfill.mjs')) await main();
