# tabdil-rates

Every 15 minutes a GitHub Action reads the exchange-rate tables on sarafi.af
(Sarai Shahzada, Khorasan Market, Da AFG Bank) and publishes them as
`rates.json` on GitHub Pages. The TABDIL app only reads that file.

    https://<your-github-username>.github.io/tabdil-rates/rates.json

## Setup (once)

1. Create a **public** repository named `tabdil-rates` on GitHub and upload
   everything in this folder except `node_modules/` and `public/`
   (keep the `.github` folder).
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Scrape rates → Run workflow** for the first run. After that it
   runs by itself every 15 minutes.

GitHub pauses scheduled workflows in repositories with no activity for 60 days.
If rates stop updating, open **Actions** and re-enable the workflow.

## rates.json

```json
{
  "source": "sarafi.af",
  "generatedAt": "2026-11-26T04:12:50.928Z",
  "markets": [
    {
      "id": "sarai-shahzada", "name": "Sarai Shahzada",
      "fetchedAt": "…", "stale": false,
      "rates": [
        { "pair": "USD/AFN", "base": "USD", "quote": "AFN", "unit": 1,
          "buy": 66.95, "sell": 67, "changePct": 0.3, "time": "14:57" }
      ]
    }
  ]
}
```

- `unit` is 1000 for pairs sarafi.af quotes per 1K (INR, PKR, IRR, JPY).
- `time` is the source's own update time (Kabul time, no date).
- `stale: true` means that market's page failed this run, so the previous
  rates are kept. If every market fails, nothing is published.

## history-&lt;market&gt;.json

Built by this Action from its own runs (no extra requests to sarafi.af), for the app's charts:

- `intraday`: `[timestamp ms, mid rate]` every run, last 24 hours.
- `daily`: `[YYYY-MM-DD, open, high, low, close]` per Kabul day, last 400 days.

Each deploy replaces the whole Pages site, so the script first downloads the
published history. If that download fails for any reason other than 404
(first run), the run stops instead of publishing an empty history.

## Local

    npm install
    npm test
    npm run scrape   # writes public/rates.json
