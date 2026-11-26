import * as cheerio from 'cheerio';

const num = (s) => {
  const v = Number(String(s).replace(/,/g, '').trim());
  return s !== '' && Number.isFinite(v) ? v : null;
};

// Reads the rates table of a sarafi.af market page.
// "INR/AFN 1K" means the price is for 1,000 units of the base currency.
export function parseRates(html) {
  const $ = cheerio.load(html);
  const rates = [];
  $('table.table-rates tbody tr').each((_, tr) => {
    const row = $(tr);
    const label = row.find('.pair-code').text().replace(/\s+/g, ' ').trim();
    const m = label.match(/^([A-Z]{3})\/([A-Z]{3})(?: (\d+)K)?$/);
    if (!m) return;
    const buy = num(row.find('.is-buy').text());
    const sell = num(row.find('.is-sell').text());
    if (buy === null || sell === null) return;
    const pill = row.find('.change-pill');
    const pct = num(pill.text().replace(/[^\d.,]/g, ''));
    rates.push({
      pair: `${m[1]}/${m[2]}`,
      base: m[1],
      quote: m[2],
      unit: m[3] ? Number(m[3]) * 1000 : 1,
      name: row.find('.pair-name').text().trim(),
      buy,
      sell,
      changePct: pct === null ? null : pill.hasClass('is-down') ? -pct : pct,
      time: row.find('.rate-time').text().trim() || null
    });
  });
  return rates;
}

// Guards against publishing garbage if the site layout changes.
export function isSane(rates) {
  const usd = rates.find((r) => r.pair === 'USD/AFN');
  return !!usd && [usd.buy, usd.sell].every((v) => v > 20 && v < 500) && usd.sell >= usd.buy;
}
