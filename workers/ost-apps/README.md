# ost-apps — hosting for apps deployed from OST Studio

`https://ost-apps.nachogtavl.workers.dev/<slug>/`

OST Studio (`docs/studio.html`) deploys **static web apps** (HTML/CSS/JS/assets, including
bundled React/TS). The files are stored by the `StudioHub` Durable Object in `ost-api`
(`POST /studio/v1/projects/:id/deploy`). This worker is the public face: it routes, adds
hosting headers, and injects two small snippets into HTML. **It never executes app code** —
apps run in the visitor's browser. There is no server-side code execution anywhere in OST Apps.

Contract: `project-docs/ost-studio.md` §5.

## Routes

| Request | Response |
|---|---|
| `GET /` | Gallery landing page, server-rendered from `ost-api` `GET /studio/v1/apps?limit=60` (`?cursor=` pages through). Every field is HTML-escaped; apps with an invalid or reserved slug are skipped. 503 + Retry-After if the API is down. |
| `GET /<slug>` | `301 /<slug>/` (query kept). Upper-case slugs redirect to lower case. |
| `GET /<slug>/<path>` | File from `ost-api` `GET /studio/v1/serve/<slug>/<path>?<query>` over the `API` service binding. |
| `GET /robots.txt` | `User-agent: * / Allow: /` |
| `GET /favicon.ico` | `204` (apps that want an icon ship their own `/<slug>/favicon.ico`) |
| `GET /index.html` | `301 /` |
| any other method | `405`, `Allow: GET, HEAD` |

Slugs follow the API rule `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`; reserved names
(`api www admin ost studio app apps assets`) and malformed paths (`..`, encoded `/` or `\`,
control characters, bad percent-encoding) get a friendly 404 **without** calling the API.
Path segments are decoded, validated and re-encoded before they are forwarded.

### Passing files through

- Forwarded upstream: `Accept`, `If-None-Match`, and the visitor IP as `X-Forwarded-For`
  (plus `X-Ost-Apps: 1`). For non-HTML files also `If-Modified-Since` and `Range` (so iOS
  can stream video/audio if the API answers ranges). `HEAD` is answered from an upstream
  `GET` with the body dropped, so the API never needs to implement `HEAD`.
- Status, body and headers pass through, **except**: `Content-Security-Policy` (the API's
  `sandbox …` CSP, which exists so raw files on the API origin can't run), `X-Frame-Options`,
  `Set-Cookie`, `Service-Worker-Allowed` (an app's service worker stays scoped to `/<slug>/`),
  and any upstream `Permissions-Policy` / `Referrer-Policy` / COOP / nosniff (replaced below).
- Added to every response:
  - `Content-Security-Policy: frame-ancestors 'self' https://ost-token.pages.dev https://*.ost-token.pages.dev http://localhost:* http://127.0.0.1:*`
    — OST shows apps in an in-page window (`index.html#app=<slug>`), so `X-Frame-Options` is
    never set; other sites cannot frame apps.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)`,
    `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
- Upstream redirects that point inside the app (`/studio/v1/serve/<slug>/…`) are mapped back to
  `/<slug>/…`; anything else becomes a 502.
- Upstream 4xx (other than 416) for a page navigation → friendly HTML page (unknown app, missing
  file, unpublished/410, blocked/403, busy/429), chosen from the API's `error` code. For
  sub-resources (scripts, images, `fetch`) → a short `text/plain` body with the same status.
  An app's own `text/html` error body passes through. 5xx / unreachable / >20 s → 502 / 504.

### HTML responses (`Content-Type: text/html`)

Rewritten with `HTMLRewriter` (streaming):

1. **Storage shim** — an inline `<script data-ost-apps="storage">` prepended to `<head>` (or
   placed before the first element of a head-less document) so it runs before any app code. It
   replaces `window.localStorage` and `window.sessionStorage` with Proxy facades over the real
   `Storage` whose keys are stored as `<slug>:<key>`. `getItem/setItem/removeItem/key/length`,
   property access (`localStorage.foo`), `Object.keys`, `JSON.stringify(localStorage)`, `in`,
   `delete` and `instanceof Storage` all behave as usual but see only this app's keys,
   unprefixed. `clear()` removes **only this app's keys**. Cross-tab `storage` events are
   filtered to this app and re-dispatched with the unprefixed key (`storageArea` is `null`).
2. **Badge** — an inline `<script data-ost-apps="badge">` before `</body>` (or at the end of the
   document) that mounts a small closed-shadow-DOM pill, bottom-right, honouring safe-area
   insets: "Made with **OST Studio** · Report". "Made with OST Studio" opens
   `https://ost-token.pages.dev/#app=<slug>`, "Report" opens
   `https://ost-token.pages.dev/studio.html#report=<slug>`. × hides it for this app for the rest
   of the tab session (a key outside the app's namespace, invisible to the app). It is **not shown
   when the page is framed** (`window.top !== window`), because OST draws its own window chrome,
   and it is mounted on `<html>` so an app replacing `document.body` doesn't remove it.

Because the bytes change, HTML responses drop `Content-Length`, `Content-Encoding` and
`Last-Modified`, gain `charset=utf-8` if the API omitted it, and get a weak ETag
`W/"<api-etag>-osa1"`. Conditional requests are mapped back to the API's ETag, so 304s keep
working. Bump `INJECT_VER` in `src/index.js` whenever the injected snippets change, so browsers
holding an older injected copy get a full response. A `206` HTML response is passed through
untouched (byte offsets must not move).

## The storage shim is NOT a security boundary

Every app is served from the **same origin** (`ost-apps.nachogtavl.workers.dev`). The prefixing
only stops well-behaved apps from trampling each other's keys. Any app can still read or write
every other app's data: through a fresh same-origin `<iframe>`, the original `Window` property
descriptor, `document.cookie`, IndexedDB, Cache Storage, or by scripting another app's page.
None of those are namespaced. Therefore:

- Studio and the gallery tell creators **never to keep secrets** (keys, tokens, seed phrases) in
  browser storage of a deployed app.
- This origin holds nothing of OST's own: wallet keys live on `ost-token.pages.dev`, a different
  origin that apps cannot read.
- The gallery tells visitors apps are user-made and unreviewed, run on Solana **devnet** test
  tokens, and must never be given a seed phrase, private key or password.

## Deploy

`ost-api` (with the `/studio/v1` routes) must be deployed first — the service binding points at it.

```bash
cd workers/ost-apps
npx wrangler deploy            # or ../ost-api/node_modules/.bin/wrangler deploy
```

No secrets, KV or Durable Objects of its own. `wrangler.toml` binds `API` → service `ost-api`.
Without the binding (e.g. a bare local run) the worker falls back to
`env.API_ORIGIN || https://ost-api.nachogtavl.workers.dev` over the public internet.

Check after deploying:

```bash
curl -sI https://ost-apps.nachogtavl.workers.dev/            # 200, frame-ancestors CSP
curl -sI https://ost-apps.nachogtavl.workers.dev/<slug>      # 301 -> /<slug>/
curl -s  https://ost-apps.nachogtavl.workers.dev/<slug>/ | head -c 300   # starts with the storage shim
```

## Local testing

The worker runs unchanged in Node (no `HTMLRewriter` there — `injectHtml` falls back to string
insertion with the same placement) and in workerd via Miniflare with a function service binding:

```js
import { Miniflare } from 'miniflare';
const mf = new Miniflare({
  modules: true, modulesRoot: 'workers/ost-apps', scriptPath: 'workers/ost-apps/src/index.js',
  compatibilityDate: '2025-01-01',
  serviceBindings: { API: async (req) => new Response('<!doctype html><head></head><body>hi</body>', { headers: { 'content-type': 'text/html' } }) },
});
const res = await mf.dispatchFetch('https://ost-apps.nachogtavl.workers.dev/demo/');
```
