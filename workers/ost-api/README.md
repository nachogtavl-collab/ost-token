# OST API Worker

A Cloudflare Worker that powers the OST prediction market platform with a real REST API.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status, BTC price, edge POP |
| GET | `/btc/price` | Live BTC-USD (Coinbase → Binance → CoinGecko waterfall) |
| GET | `/btc/history` | 60-point hourly price series for charts |
| GET | `/markets` | Active Polymarket markets (normalized) |
| GET | `/markets/:id` | Single market + orderbook + trades + history |
| GET | `/markets/:id/book` | Orderbook only (no-cache) |
| GET | `/markets/:id/trades` | Recent trades |
| GET | `/rounds/current` | Current 5-min BTC round metadata |
| POST | `/rounds/open-price` | Record open price for a round |
| GET | `/positions/:wallet` | Positions for a wallet (requires KV) |
| POST | `/positions` | Record a new position (requires KV) |

All routes return JSON with `Access-Control-Allow-Origin: *`.

## Deploy

### Prerequisites
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 18+

### Steps

```bash
cd workers/ost-api
npm install
npx wrangler login        # opens browser for Cloudflare auth
npx wrangler deploy       # deploys to Cloudflare edge
```

You'll see output like:
```
Deployed ost-api to a public edge origin such as https://ost-api-pages.pages.dev
```

### (Optional) Enable KV storage for positions

KV lets positions persist server-side across sessions.

1. Create a KV namespace:
   ```bash
   npx wrangler kv:namespace create OST_KV
   ```
2. Copy the `id` from the output, then add to `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "OST_KV"
   id = "<paste-id-here>"
   ```
3. Redeploy:
   ```bash
   npx wrangler deploy
   ```

### Wire the frontend

After deploying, copy your Worker URL and paste it into **index.html** before the other scripts:

```html
<!-- Set before ost-console.js / prediction-pro-dash.js -->
<script>window.OST_API_BASE = "https://ost-api-pages.pages.dev";</script>
```

Or paste it at runtime in the **OST API Console** (click "Open in console" in the Pro Dashboard).

## Local development

```bash
npm run dev          # starts local dev server at http://localhost:8787
```

## Custom domain (optional)

In the Cloudflare dashboard → Workers → your worker → Triggers → Custom Domains.
