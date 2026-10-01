# OST Studio — architecture contract (v1)

OST Studio is a VS Code–style IDE that runs entirely in the browser at `docs/studio.html`, plus a
backend (`StudioHub` Durable Object in `workers/ost-api`) and an app-hosting worker (`workers/ost-apps`).
People and coding agents edit the same projects; projects run in sandboxes in the browser; built apps
deploy to `https://ost-apps.nachogtavl.workers.dev/<slug>/` and appear inside OST.

**Honest scope (put this in UI copy too):** there is no server-side code execution. Cloudflare
Workers for Platforms and R2 are not enabled on this account, so OST hosts **static web apps**
(HTML/CSS/JS/assets, including bundled React/TS) only. JS/TS/Python run in **browser sandboxes**.
External agents edit and deploy through the HTTP API; running happens in a user's open Studio tab.

## 0. Hard rules for every module

- Vanilla JS, no bundler. Each module is a classic script `docs/studio/<name>.js` wrapped in an IIFE,
  that waits for `window.STUDIO` (core loads first) and attaches its API to `STUDIO.<name>`.
  Each module may ship `docs/studio/<name>.css`. CSS class prefix per module: `st-<name>-…`.
- **Never run user code in the Studio page itself** (`ost-token.pages.dev` origin holds wallet keys
  in localStorage). User code runs only in an `<iframe sandbox="allow-scripts …">` **without**
  `allow-same-origin` (opaque origin), or inside a Worker created *inside* that iframe.
- Escape every user-controlled string inserted into HTML (`STUDIO.util.esc`).
- CDN libraries (pinned): Monaco `https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs`,
  xterm `@xterm/xterm@5.5.0` + `@xterm/addon-fit@0.10.0`, esbuild `esbuild-wasm@0.24.2`
  (`esm/browser.min.js` + `esbuild.wasm`), Pyodide `v0.26.4`, JSZip `3.10.1`, npm packages for user
  projects via `https://esm.sh/<pkg>@<version>`.
- Module load order in `studio.html`: `core.js` → `editor.js` → `runtime.js` → `terminal.js` →
  `agent.js` → `deploy.js`. Modules must not assume the ones after them exist at load time; use
  `STUDIO.bus` events or check at call time.

## 1. Core contract (`docs/studio/core.js`, `window.STUDIO`)

```text
STUDIO.API            'https://ost-api.nachogtavl.workers.dev'
STUDIO.APPS           'https://ost-apps.nachogtavl.workers.dev'
STUDIO.bus.on(evt, fn) / off(evt, fn) / emit(evt, data)
STUDIO.ready          Promise resolved after identity + last project are loaded

STUDIO.id.address     'ost-mesh:xxxx-xxxx-xxxx-xxxx' (shared with OST Mesh / Social identity)
STUDIO.id.name        display name from the directory profile ('' if none)
STUDIO.id.sign(method, pathq, bodyBytes) -> Promise<{x-mesh-addr,x-mesh-ts,x-mesh-nonce,x-mesh-sig}>

STUDIO.api(method, path, body?, opts?) -> Promise<json>
   path like '/studio/v1/projects'. body: object → JSON, string → text/plain, Uint8Array → octet-stream.
   Signed with the mesh identity unless opts.auth === false. Throws Error with .code (server `error`)
   and .status. Auto-announces + retries once on `mesh_identity_unknown`.

STUDIO.projects.list() -> Promise<[{id,name,template,updatedAt,cloud,local}]>
STUDIO.projects.create({name, template, files?, fromLink?}) -> Promise<meta>     (opens it; fromLink = stays local until edited)
STUDIO.projects.open(id) -> Promise<meta>
STUDIO.projects.current() -> meta | null   {id,name,template,createdAt,updatedAt,version,cloud}
STUDIO.projects.rename(name) / remove(id) / importFiles({path:content}) / exportZip()
STUDIO.projects.syncState() -> 'local'|'synced'|'syncing'|'offline'|'error'
   meta.pending = [[path, 'put'|'del']] not yet pushed (survives reloads); a file the server refuses
   (too_large / bad_path) is quarantined until edited again — state 'error' names it.
   When the cloud re-assigns a project id, core mutates meta.id and emits 'project:open' with the same meta.
STUDIO.projects.syncNow() -> Promise

STUDIO.fs  (always the current project; paths are relative, '/'-separated, no leading slash)
   list() -> [{path, size, binary, mtime}] sorted
   read(path) -> string|null        (binary files are 'data:<mime>;base64,…' strings)
   write(path, content, {source='user', binary?}) -> Promise
   remove(path)  (a folder prefix removes everything under it) -> Promise
   rename(from, to) (file or folder) -> Promise
   exists(path) -> bool ; isBinary(path) -> bool ; folders() -> [paths]
   snapshot() -> {path: content}   (all files)

Events on STUDIO.bus
   'project:open'   {project}
   'project:close'  {}
   'fs:change'      {path, kind:'write'|'remove'|'rename', from?, source:'user'|'editor'|'agent'|'cloud'|'terminal'|'template'}
   'fs:bulk'        {source}             (many files replaced, e.g. import / clone / cloud open)
   'sync:state'     {state, detail}
   'active:file'    {path}               (emitted by editor when the active tab changes)
   'console'        {level:'log'|'info'|'warn'|'error'|'system', text, source:'preview'|'run'|'python'|'build'}
   'run:start' {kind, path} / 'run:end' {kind, path, ok, ms}
   'build:done' {ok, errors:[{path,line,col,text}], ms}
   'theme' {dark}

STUDIO.ui
   registerActivity({id, icon, title, order}) -> HTMLElement   (side-panel container for that activity)
   setActivity(id) ; activity() -> id
   registerPanel({id, title, order}) -> HTMLElement            (bottom panel tab: Terminal, Console, Problems)
   showPanel(id) ; togglePanel(force?)
   registerAction({id, icon, title, order, primary?, run})      (top bar buttons: Run, Preview, Deploy)
   registerCommand({id, title, key?, run})   key like 'Mod+S', 'Mod+Shift+P', 'Mod+Enter'
   runCommand(id) ; commands() ; palette()
   setStatus(key, text, {side:'left'|'right', title?, onClick?})
   toast(text, kind?)  kind: ''|'ok'|'err'|'warn'
   prompt(title, value?, {placeholder?}) -> Promise<string|null>
   confirm(text, {danger?, okText?}) -> Promise<boolean>
   select(title, options:[{value,label,desc?}]) -> Promise<value|null>
   togglePreview(force?) ; previewEl() -> the empty container where runtime mounts its iframe
   editorHost() -> the container where the editor mounts Monaco
   isMobile() -> bool

STUDIO.settings.get(key, dflt) / set(key, value)      (localStorage 'ost.studio.settings.v1')
STUDIO.templates.list() -> [{id,name,desc,icon}] ; STUDIO.templates.files(id) -> {path: content}
STUDIO.util: esc, uid, langOf(path), mimeOf(path), isTextPath(path), extOf(path), dirOf(path),
             baseOf(path), normPath(path), projectKind() -> 'web'|'react'|'python'|'node'|'static',
             entryFor(kind) -> path, fmtBytes(n), b64ToBytes(s), bytesToB64(u8), sha256Hex(strOrBytes)
```

Keys Monaco swallows: the editor module must forward registered command keybindings with
`editor.addCommand` → `STUDIO.ui.runCommand(id)` for every command that has a `key`.

## 2. Module ownership

| Module | Files | Exposes |
|---|---|---|
| editor | `docs/studio/editor.js/.css` | `STUDIO.editor.{open(path), active(), focus(), reveal(path,line,col), setMarkers(path, markers), clearMarkers(), monaco()}`; Explorer activity, Search activity, tabs, quick open (Mod+P), textarea fallback if Monaco fails |
| runtime | `docs/studio/runtime.js/.css` | `STUDIO.runtime.{run(path?), stop(), preview(force?), build({mode:'preview'|'deploy'}) -> {ok, errors, files:{path:content}, entry}, runCapture(path, {timeoutMs}) -> {ok, output, error, ms}}`; Console panel, Problems panel, preview iframe, Run/Preview actions |
| terminal | `docs/studio/terminal.js/.css` | `STUDIO.terminal.{exec(line), write(text), writeln(text)}`; Terminal panel |
| agent | `docs/studio/agent.js/.css` | `STUDIO.agent.{ask(prompt), stop()}`; AI Agent activity; Agent API (tokens) activity |
| deploy | `docs/studio/deploy.js/.css` | `STUDIO.deploy.{deploy({slug,name,description}), apps()}`; Deploy activity, Apps gallery activity, Account/projects activity, Deploy action |

## 3. Runtime sandbox model

- **Preview (web/react/static):** build with esbuild-wasm into ONE html string: CSS inlined,
  JS bundled (`format:'esm'`, `bundle:true`, jsx automatic via `react` import source from esm.sh),
  bare imports rewritten to `https://esm.sh/<name>@<version from package.json or latest>`, small assets
  (≤ 1 MB) inlined as data URLs. Shown with `iframe.srcdoc` and
  `sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads"`
  (NO allow-same-origin). A bridge script injected first forwards console.*/errors via `postMessage`.
- **Run JS/TS ("node-like"):** bundle the file, then execute inside a Worker created **inside** a hidden
  sandboxed runner iframe (blob URL minted inside the iframe). Captured console goes to the Console panel.
  Stop = terminate worker; default timeout 30 s (UI), 15 s for agent runs.
- **Run Python:** Pyodide in a Worker inside the same sandboxed runner iframe, `loadPackagesFromImports`
  + micropip for pure-python wheels; stdout/stderr streamed; `input()` returns ''.
- **Deploy build:** same esbuild pipeline but emits real files: `index.html` (with `<script type=module
  src="./assets/app-<hash>.js">`), the bundle, CSS file, and every non-code asset as-is.
  Static projects (no JS imports needing a bundle) deploy as-is.

## 4. Backend API — `StudioHub` DO, base `https://ost-api.nachogtavl.workers.dev/studio/v1`

Auth = mesh signature (same OST-MESH|v1 canonical as the mesh hub; the signer's ECDSA key is looked
up from MeshHub `/mesh/v1/identity/lookup`) **or** `Authorization: Bearer ostk_…` agent token (scopes
`read`, `write`, `deploy`). Tokens can't manage tokens. Errors: `{ok:false, error:'code'}` + HTTP status.

| Method & path | Auth | Body / query | Response |
|---|---|---|---|
| GET `/health` | – | – | `{ok, studio:'v1'}` |
| GET `/projects` | read | – | `{projects:[meta]}` |
| POST `/projects` | write | `{id?, name, template?, files?:{path:content}}` — `id` (`^p[0-9a-f]{16}$`) is the client-chosen id; if taken by another owner the server assigns a new one; if it already exists for the same owner, files are merged in (idempotent retry) | `{project: meta, version}` |
| GET `/projects/:id` | read | – | `{project, files:[{path,size,hash,mtime,binary}]}` |
| PATCH `/projects/:id` | write | `{name}` | `{project}` |
| DELETE `/projects/:id` | write | – | `{ok}` |
| GET `/projects/:id/export` | read | – | `{project, version, files:[{path,content,hash,binary,mtime}]}` |
| GET `/projects/:id/file?path=` | read | – | `{path, content, hash, binary, mtime}` |
| PUT `/projects/:id/file?path=` | write | raw text body (binary as data URL text) | `{version, hash}` |
| DELETE `/projects/:id/file?path=` | write | – | `{version}` |
| POST `/projects/:id/sync` | write | `{put?:{path:content}, del?:[path], rename?:[[from,to]]}` | `{version, applied:n}` |
| GET `/projects/:id/changes?since=N` | read | – | `{version, changes:[{v, path, deleted?, content?, large?, hash, by}]}` (since=0 → empty list + current version) |
| POST `/projects/:id/deploy` | deploy | `{slug, name?, description?, files?:{path:content}}` (no `files` → deploy project files as-is) | `{app:{slug,url,version,files,bytes}}` |
| GET `/apps?limit=&cursor=` | – | – | `{apps:[{slug,name,description,owner,profile,url,ts,version,views}], cursor}` |
| GET `/apps/:slug` | – | – | `{app}` (+ `files:[{path,size,mime}]`) |
| POST `/apps/:slug/unpublish` | deploy (owner) | – | `{ok}` |
| POST `/apps/:slug/report` | – (rate-limited per IP) | `{reason:'scam'\|'impersonation'\|'malware'\|'abuse'\|'other', note?}` | `{ok}` |
| POST `/admin` | worker secret `SOCIAL_ADMIN_KEY` / `MESH_ADMIN_KEY` in body | `{key, action:'reports'}` → `{reports:[…]}`; `{key, action:'unpublish', slug}` → `{ok}` | |
| GET `/serve/:slug/<path>` | – | – | raw file; directory → `index.html`; extension-less miss → `index.html` (SPA); adds `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals` (the ost-apps worker strips it) |
| POST `/tokens` | **mesh only** | `{label, scopes:['read','write','deploy']}` | `{token, id, label, scopes, ts}` (secret shown once) |
| GET `/tokens` | mesh only | – | `{tokens:[{id,label,scopes,ts,lastUsed}]}` |
| DELETE `/tokens/:id` | mesh only | – | `{ok}` |
| POST `/ai/chat` | read | `{messages:[{role,content,tool_calls?,tool_call_id?,name?}], tools?:[openai tool defs]}` | `{message:{role:'assistant',content,tool_calls?}, model}` |
| GET `/agents.md` | – | – | markdown: how an external coding agent uses this API |

Limits: 50 projects/owner, 400 files & 25 MB per project, 1.5 MB per project file; 20 apps/owner,
300 files & 25 MB per deploy, 5 MB per deployed file; slug `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`,
first deployer owns it; reserved slugs (`api`, `www`, `admin`, `ost`, `studio`, `app`, `apps`, `assets`).
AI: 40 requests / 10 min / owner, Groq `llama-3.3-70b-versatile` (OpenAI-compatible, tools) →
fallback `llama-3.1-8b-instant` → Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## 5. App hosting — `workers/ost-apps` → `https://ost-apps.nachogtavl.workers.dev`

Service binding `API` → `ost-api`. `/` = gallery landing; `/<slug>` → 301 `/<slug>/`;
`/<slug>/<path>` → `API.fetch('/studio/v1/serve/<slug>/<path>')`, drop the sandbox CSP, add
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; for HTML inject
(HTMLRewriter) a localStorage key-namespacing shim (keys prefixed `<slug>:`) at the start of `<head>` and
a small dismissible "Made with OST Studio · report" badge before `</body>`. Apps share one origin, so
the UI tells creators never to keep secrets in browser storage.

## 6. Inside OST

- `#app=<slug>` on `index.html` opens the deployed app in an in-page window (iframe to ost-apps).
- Social embeds accept `kind:'app'` (`href '#app=<slug>'`); Studio's deploy panel offers
  "Share on OST Social" → `index.html#share-app=<slug>`.
- `desktop.html` Visual Studio icon → `studio.html`; Code Academy gets "Open OST Studio" and per-lesson
  "Open in Studio" (`studio.html#new=<base64url JSON {name, files}>`); appbar More tile "Studio".
