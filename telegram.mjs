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
const unitLabel = (u) => (u >= 1e6 ? ' (یک میلیون)' : u >= 1000 ? ' (یک هزار)' : '');

// Same Dari names as the app (tabdil-mobile/src/locales/fa/translation.json → currency).
const CURRENCY_FA = {
  USD: 'دالر امریکایی', EUR: 'یورو', GBP: 'پوند انگلیس', INR: 'روپیه هند', IRT: 'تومان ایران', PKR: 'کلدار پاکستان',
  SAR: 'ریال سعودی', AED: 'درهم امارات', CHF: 'فرانک سویس', CNY: 'یوان چین', AUD: 'دالر استرالیا', CAD: 'دالر کانادا',
  RUB: 'روبل روسیه', DKK: 'کرون دنمارک', SEK: 'کرون سویدن', NOK: 'کرون ناروی', TRY: 'لیره ترکیه', KWD: 'دینار کویت',
  QAR: 'ریال قطر', BHD: 'دینار بحرین', JPY: 'ین جاپان'
};
const DAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const MONTHS_FA = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];

/** Gregorian → Solar Hijri [year, month, day] (same method as the app's src/utils/jalali.ts). */
export function toJalali(gy, gm, gd) {
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + before[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  return days < 186 ? [jy, 1 + Math.floor(days / 31), 1 + (days % 31)] : [jy, 7 + Math.floor((days - 186) / 30), 1 + ((days - 186) % 30)];
}

/** "شنبه 7 قوس 1405 · ساعت 14:30" in Kabul time. */
export function kabulStamp(now) {
  const k = kabulClock(now);
  const [y, m, d] = k.date.split('-').map(Number);
  const [jy, jm, jd] = toJalali(y, m, d);
  const hh = String(Math.floor(k.minutes / 60)).padStart(2, '0');
  const mm = String(k.minutes % 60).padStart(2, '0');
  return `${DAYS_FA[k.day]} ${jd} ${MONTHS_FA[jm - 1]} ${jy} · ساعت ${hh}:${mm}`;
}

const TITLE = { change: '📊 نرخ اسعار', open: '🟢 بازار باز شد — نرخ‌های شروع روز', close: '🔴 نرخ‌های پایانی امروز' };

/** Plain-text message for one market, with ▲/▼ on the pairs that moved. kind: 'change' | 'open' | 'close'. */
export function buildMessage(market, prevMarket, now = Date.now(), kind = 'change') {
  // Every line starts with Dari text, so Telegram lays the whole message out right to left.
  const lines = [TITLE[kind], `🏦 ${MARKET_FA[market.id] ?? market.name}`, `📅 ${kabulStamp(now)}`, ''];
  for (const r of market.rates.filter((x) => x.quote === 'AFN')) {
    const o = prevMarket?.rates.find((x) => x.pair === r.pair);
    const mark = !o || r.sell === o.sell ? '' : r.sell > o.sell ? ' 🔺' : ' 🔻';
    const toman = r.base === 'IRR';
    const k = toman ? TOMAN / r.unit : 1;
    const code = toman ? 'IRT' : r.base;
    lines.push(`${flag(r.base)} ${CURRENCY_FA[code] ?? r.name ?? code}${unitLabel(toman ? TOMAN : r.unit)}`, `خرید ${fmt(r.buy * k)} · فروش ${fmt(r.sell * k)}${mark}`, '');
  }
  lines.push('منبع: sarafi.af · اپ تبدیل');
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
