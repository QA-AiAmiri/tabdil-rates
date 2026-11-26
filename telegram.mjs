// Posts a market's rates to a Telegram channel, only when they changed since the last run.

const MARKET_FA = { 'sarai-shahzada': 'سرای شهزاده', 'khorasan-market': 'بازار خراسان', 'da-afg-bank': 'د افغانستان بانک' };
const TOMAN = 1_000_000; // sarafi's "IRR" is really toman; shown per 1M like the app

/** Fresh markets whose buy or sell moved for any pair compared with the previous file. */
export function changedMarkets(prev, markets) {
  if (!prev) return []; // first run: nothing to compare against
  return markets.filter((m) => {
    if (m.stale) return false;
    const old = prev.markets?.find((x) => x.id === m.id);
    if (!old) return true;
    return m.rates.some((r) => {
      const o = old.rates.find((x) => x.pair === r.pair);
      return !o || o.buy !== r.buy || o.sell !== r.sell;
    });
  });
}

const flag = (code) => [...code.slice(0, 2)].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
const fmt = (v) => v.toFixed(v < 1 ? 4 : 2);
const unitLabel = (u) => (u >= 1e6 ? ` (${u / 1e6}M)` : u >= 1000 ? ` (${u / 1000}K)` : '');

/** Plain-text message for one market, with ▲/▼ on the pairs that moved. */
export function buildMessage(market, prevMarket, now = Date.now()) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kabul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const lines = [`📊 نرخ اسعار — ${MARKET_FA[market.id] ?? market.name}`, `🕐 ${time} (کابل)`, '', 'ارز | خرید | فروش'];
  for (const r of market.rates.filter((x) => x.quote === 'AFN')) {
    const o = prevMarket?.rates.find((x) => x.pair === r.pair);
    const mark = !o || r.sell === o.sell ? '' : r.sell > o.sell ? ' ▲' : ' ▼';
    const toman = r.base === 'IRR';
    const k = toman ? TOMAN / r.unit : 1;
    lines.push(`${flag(r.base)} ${toman ? 'IRT' : r.base}${unitLabel(toman ? TOMAN : r.unit)} | ${fmt(r.buy * k)} | ${fmt(r.sell * k)}${mark}`);
  }
  lines.push('', 'منبع: sarafi.af');
  return lines.join('\n');
}

/** Sends one message per changed market. Never throws: a Telegram problem must not stop the rates deploy. */
export async function postChanges(prev, markets, { token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID } = {}) {
  if (!token || !chat) return console.log('telegram: secrets not set, skipping');
  const changed = changedMarkets(prev, markets);
  if (!changed.length) return console.log('telegram: no rate changes, nothing sent');
  for (const m of changed) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: buildMessage(m, prev.markets?.find((x) => x.id === m.id)), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000)
      });
      const body = await res.json();
      console.log(body.ok ? `telegram: sent ${m.id}` : `telegram: ${m.id} failed: ${body.description}`);
    } catch (e) {
      console.error(`telegram: ${m.id} failed: ${e.message}`);
    }
  }
}
