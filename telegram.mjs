// Posts rates to a Telegram channel: once when the market opens, once when it closes,
// and in between only when they changed since the last run.

const MARKET_FA = { 'sarai-shahzada': 'سرای شهزاده', 'khorasan-market': 'بازار خراسان', 'da-afg-bank': 'د افغانستان بانک' };
const TOMAN = 1_000_000; // sarafi's "IRR" is really toman; shown per 1M like the app

// Market hours, Kabul time: Saturday–Thursday 08:00–16:00, Friday closed. Same as the app.
const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 16 * 60;
const FRIDAY = 5;

/** Kabul calendar date, weekday (0 = Sunday) and minutes since midnight. */
export function kabulClock(now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kabul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, day, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** 'open' or 'close' when this run should post the day's opening/closing rates, else null. */
export function session(now, state = {}) {
  const k = kabulClock(now);
  if (k.day === FRIDAY) return null;
  if (k.minutes >= CLOSE_MIN) return state.closeDate === k.date ? null : 'close';
  if (k.minutes >= OPEN_MIN) return state.openDate === k.date ? null : 'open';
  return null;
}

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

const TITLE = { change: '📊 نرخ اسعار', open: '🟢 بازار باز شد — نرخ‌های شروع روز', close: '🔴 نرخ‌های پایانی امروز' };

/** Plain-text message for one market, with ▲/▼ on the pairs that moved. kind: 'change' | 'open' | 'close'. */
export function buildMessage(market, prevMarket, now = Date.now(), kind = 'change') {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kabul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const lines = [`${TITLE[kind]} — ${MARKET_FA[market.id] ?? market.name}`, `🕐 ${time} (کابل)`, '', 'ارز | خرید | فروش'];
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

/**
 * Opening/closing post for every fresh market when the session starts or ends, otherwise one post
 * per changed market. Returns the posting state ({ openDate, closeDate }) to keep in rates.json.
 * Never throws: a Telegram problem must not stop the rates deploy.
 */
export async function postTelegram(prev, markets, { now = Date.now(), token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID } = {}) {
  const state = { ...prev?.telegram };
  if (!token || !chat) {
    console.log('telegram: secrets not set, skipping');
    return state;
  }
  const send = async (m, kind) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: buildMessage(m, prev?.markets?.find((x) => x.id === m.id), now, kind), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000)
      });
      const body = await res.json();
      console.log(body.ok ? `telegram: sent ${kind} ${m.id}` : `telegram: ${m.id} failed: ${body.description}`);
      return body.ok;
    } catch (e) {
      console.error(`telegram: ${m.id} failed: ${e.message}`);
      return false;
    }
  };

  const kind = session(now, state);
  if (kind) {
    const fresh = markets.filter((m) => !m.stale);
    let ok = false;
    for (const m of fresh) ok = (await send(m, kind)) || ok;
    // Marked done only if something went out, so a Telegram outage retries on the next run.
    if (ok) state[`${kind}Date`] = kabulClock(now).date;
    return state;
  }
  const changed = changedMarkets(prev, markets);
  if (!changed.length) console.log('telegram: no rate changes, nothing sent');
  for (const m of changed) await send(m, 'change');
  return state;
}
