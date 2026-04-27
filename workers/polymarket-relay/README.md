# Polymarket Read-Only Relay

A Cloudflare Worker that proxies Polymarket's public **Gamma** (events / markets metadata) and **CLOB** (order books, trades, prices) read-only endpoints from Cloudflare's global edge network — putting an edge cache and a stable hostname in front of Polymarket's APIs so the OST site (and any external bot/arbitrageur) can fetch market data with single-digit-ms latency from the nearest Cloudflare PoP, instead of going to the origin every time.

**No private keys. No order-signing. No write endpoints.** This is read-only by design — placing orders on Polymarket requires an EOA signature and that **must** happen on a server you control with a secret loaded from environment variables, never from this repo.

## Endpoints

Base URL after deploy (example): `https://ost-poly-relay.<your-account>.workers.dev`

| Path | Proxies | Cache TTL |
| --- | --- | --- |
| `/gamma/markets` | `https://gamma-api.polymarket.com/markets` | 5 s |
| `/gamma/events` | `https://gamma-api.polymarket.com/events` | 5 s |
| `/gamma/markets/:id` | `https://gamma-api.polymarket.com/markets/:id` | 5 s |
| `/gamma/events/slug/:slug` | `https://gamma-api.polymarket.com/events?slug=:slug` | 10 s |
| `/clob/markets` | `https://clob.polymarket.com/markets` | 5 s |
| `/clob/book/:tokenId` | `https://clob.polymarket.com/book?token_id=:tokenId` | 1 s |
| `/clob/price/:tokenId/:side` | `https://clob.polymarket.com/price?token_id=:tokenId&side=:side` | 1 s |
| `/clob/trades?market=:id` | `https://clob.polymarket.com/trades?market=:id` | 2 s |
| `/health` | — (returns relay health) | n/a |

All responses include `Access-Control-Allow-Origin: *` so any browser/bot can call them.

## Deploy

```bash
npm install -g wrangler
cd workers/polymarket-relay
wrangler login
wrangler deploy
```

Then update `site/prediction-pro.js` (or the env var below) with your relay URL — the frontend will already fall back to direct Polymarket calls if the relay is unreachable.

## Custom domain (optional, recommended)

Point `relay.ost-token.example` at the worker for a stable URL. Edit `wrangler.toml` and set `routes` accordingly.

## Rate limiting + abuse protection

The Worker uses Cloudflare's built-in cache so you typically pay for one upstream fetch per cache key per `Cache-Control` window. If you expect heavy bot traffic, enable the [Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) rule in the Cloudflare dashboard (e.g., 100 req/min per IP).
