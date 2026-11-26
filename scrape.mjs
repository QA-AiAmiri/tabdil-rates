import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseRates, isSane } from './parse.mjs';
import { updateHistory, withSeed } from './history.mjs';

const BASE = 'https://sarafi.af/en/exchange-rates/';
const MARKETS = [
  { id: 'sarai-shahzada', name: 'Sarai Shahzada' },
  { id: 'khorasan-market', name: 'Khorasan Market' },
  { id: 'da-afg-bank', name: 'Da AFG Bank' }
];
const OUT_DIR = 'public';
const UA = 'TabdilRatesBot/1.0 (+https://github.com)';
// Where the last run was published, e.g. https://user.github.io/tabdil-rates
const PAGES = process.env.PAGES_BASE_URL?.replace(/\/$/, '');

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`${url} → HTTP ${res.status}`), { status: res.status });
  return res;
}

// Previous published file. A 404 means first run; any other failure stops the run,
// because each deploy replaces the whole site and would otherwise wipe the history.
async function previous(file) {
  if (!PAGES) return null;
  try {
    return await (await get(`${PAGES}/${file}`)).json();
  } catch (e) {
    if (e.status === 404) return null;
    throw new Error(`Could not read previous ${file}: ${e.message}`);
  }
}

const now = Date.now();
const prevRates = await previous('rates.json');
const markets = [];
const histories = [];
let failed = 0;

for (const m of MARKETS) {
  const url = BASE + m.id;
  const seedFile = `seed/history-${m.id}.json`;
  const seed = existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, 'utf8')) : null;
  const prevHistory = withSeed(await previous(`history-${m.id}.json`), seed);
  try {
    const rates = parseRates(await (await get(url)).text());
    if (!isSane(rates)) throw new Error('rates failed sanity check (site layout may have changed)');
    const market = { ...m, url, fetchedAt: new Date(now).toISOString(), stale: false, rates };
    markets.push(market);
    histories.push(updateHistory(prevHistory, market, now));
    console.log(`${m.id}: ${rates.length} rates`);
  } catch (e) {
    failed++;
    console.error(`${m.id}: ${e.message}`);
    const old = prevRates?.markets?.find((x) => x.id === m.id);
    if (old) markets.push({ ...old, stale: true });
    if (prevHistory) histories.push(prevHistory);
  }
}

if (failed === MARKETS.length) {
  console.error('All markets failed; not publishing.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, data) => writeFileSync(`${OUT_DIR}/${file}`, JSON.stringify(data));
write('rates.json', { source: 'sarafi.af', sourceUrl: 'https://sarafi.af', generatedAt: new Date(now).toISOString(), markets });
for (const h of histories) write(`history-${h.marketId}.json`, h);
// GitHub Pages: serve files as-is.
writeFileSync(`${OUT_DIR}/.nojekyll`, '');
