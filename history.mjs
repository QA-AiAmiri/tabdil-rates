const DAY = 864e5;
const KEEP_DAYS = 400;

export const kabulDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kabul' });

// Adds this run's mid rate per pair: a 15-minute line for the last 24h and a
// daily [date, open, high, low, close] candle (Kabul calendar day) for longer ranges.
export function updateHistory(prev, market, now) {
  const pairs = { ...(prev?.pairs ?? {}) };
  for (const r of market.rates) {
    const mid = Math.round(((r.buy + r.sell) / 2) * 1e4) / 1e4;
    const old = pairs[r.pair] ?? { intraday: [], daily: [] };
    const intraday = [...old.intraday.filter(([t]) => t > now - DAY), [now, mid]];
    const day = kabulDate(now);
    const daily = old.daily.slice(-KEEP_DAYS);
    const last = daily.at(-1);
    if (last && last[0] === day) daily[daily.length - 1] = [day, last[1], Math.max(last[2], mid), Math.min(last[3], mid), mid];
    else daily.push([day, mid, mid, mid, mid]);
    pairs[r.pair] = { intraday, daily };
  }
  return { marketId: market.id, updatedAt: new Date(now).toISOString(), pairs };
}
