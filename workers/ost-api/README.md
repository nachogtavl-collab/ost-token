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
| GET | `/ghost/config` | Public Ghost relay configuration and available routes |
| POST | `/ghost/relay/test` | Probe Anthropic, Gemini, Grok, GitHub, or MCP through the worker |
| GET | `/ghost/missions` | Recent Ghost mission history |
| POST | `/ghost/missions` | Dispatch a Ghost mission with autonomous routing and retries |
| GET | `/ghost/missions/:id` | Retrieve a stored Ghost mission |
| POST | `/ghost/missions/:id/retry` | Retry failed connectors for a stored mission |
| GET | `/ghost/mesh` | Shared Ghost mesh memory, mission feed, and connector knowledge |
| POST | `/ghost/mesh/share` | Publish a custom mesh memory entry |

All routes return JSON with `Access-Control-Allow-Origin: *`.

## Ghost Relays

Ghost now uses the worker as a real server-side relay for Anthropic, Gemini, Grok, GitHub, and MCP. The worker can:

- probe each connector from the edge
- run autonomous connector selection based on mission intent
- crawl safe public URLs for context before dispatch
- store mission history and shared mesh memory in `OST_KV`
- retry failed relays on later requests

### Ghost secrets and config

Set the secrets you actually plan to use before deploying:

```bash
npx wrangler secret put GHOST_ANTHROPIC_API_KEY
npx wrangler secret put GHOST_GEMINI_API_KEY
npx wrangler secret put GHOST_GROK_API_KEY
npx wrangler secret put GHOST_GITHUB_TOKEN
npx wrangler secret put GHOST_MCP_AUTH_TOKEN
```

Optional plain-text vars can live in `wrangler.toml` or your Cloudflare dashboard settings:

```toml
[vars]
GHOST_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest"
GHOST_GEMINI_MODEL = "gemini-2.0-flash"
GHOST_GROK_MODEL = "grok-beta"
GHOST_GITHUB_REPO = "owner/repo"
GHOST_MCP_BASE_URL = "https://mcp.example.com/mcp"
GHOST_MCP_TRANSPORT = "streamable-http"
GHOST_MCP_METHOD = "ghost.interop"
GHOST_ALLOW_PRIVATE_HOSTS = "false"
```

`OST_KV` is strongly recommended for Ghost. Without KV, relay tests still work, but autonomous history, retry state, and mesh memory do not persist across requests.

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
