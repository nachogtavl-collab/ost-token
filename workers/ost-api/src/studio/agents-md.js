/* workers/ost-api/src/studio/agents-md.js
  The markdown served at GET /studio/v1/agents.md — everything an external coding
  agent (Claude Code, Codex, a script, CI) needs to edit and deploy OST Studio
  projects over HTTP. Keep it in sync with hub.js and project-docs/ost-studio.md §4.
*/

export const AGENTS_MD = `# OST Studio — HTTP API for coding agents

OST Studio is a VS Code–style IDE inside the OST web app
(https://ost-token.pages.dev/studio.html). People and coding agents edit the
**same projects**: every change you make through this API appears live in any
open Studio tab of the project's owner (the tab pulls changes every few seconds
and shows "synced from the cloud (agent)").

**Base URL:** \`https://ost-api.nachogtavl.workers.dev/studio/v1\`

Honest scope — read this first:

- **No server-side code execution.** This API stores files and serves static
  web apps. It never runs your code. JavaScript/TypeScript/Python run in
  *browser sandboxes* inside a user's open Studio tab (Run / Preview).
- **Apps are static web apps** (HTML/CSS/JS/assets, including bundled
  React/TS). There is no build server: deploy the raw project files, or build
  locally and send the built files.
- Everything in OST runs on **Solana devnet** (test tokens, no real money).
  Never put private keys, seed phrases or API secrets in project files — deployed
  apps are public and share one origin.

---

## 1. Get a token

1. Open https://ost-token.pages.dev/studio.html
2. Open the **Agent API** panel (activity bar) → **Create token**.
3. Pick scopes and copy the token — it is shown **once**. It looks like
   \`ostk_\` + 48 hex characters.

Scopes:

| Scope | Allows |
|---|---|
| \`read\` | list projects, read files, poll changes, AI chat proxy |
| \`write\` | create projects, write / delete / rename files, rename / delete projects |
| \`deploy\` | publish and unpublish apps |

Scopes are enforced exactly — a typical agent token has all three. Tokens act
as the Studio user who created them (same projects, same apps). Tokens cannot
create or list tokens; revoke a token any time from the same panel.

Every authenticated request carries:

\`\`\`
Authorization: Bearer ostk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

\`\`\`bash
export OST=https://ost-api.nachogtavl.workers.dev/studio/v1
export TOKEN=ostk_...   # from the Agent API panel
\`\`\`

Errors are JSON \`{"ok":false,"error":"code"}\` with an HTTP status
(400 bad input, 401 bad/missing auth, 403 scope or limit, 404 not found,
409 conflict, 413 too large, 429 rate limited, 502/503 upstream).

---

## 2. Projects

A project is a flat map of files: relative \`/\`-separated paths (no leading
slash, no \`..\`, max 240 chars, none of \`< > : " | ? *\` or control chars) to
UTF-8 text. **Binary files are sent as data URLs** (\`data:image/png;base64,…\`).
Every change bumps the project's \`version\` by one.

### List projects (read)

\`\`\`bash
curl -s "$OST/projects" -H "Authorization: Bearer $TOKEN"
# {"projects":[{"id":"p0123456789abcdef","name":"todo","template":"web","version":12,"files":3,"bytes":2048,"createdAt":…,"updatedAt":…}]}
\`\`\`

### Create a project (write)

\`\`\`bash
curl -s -X POST "$OST/projects" -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"todo","template":"web","files":{"index.html":"<!doctype html><h1>Hi</h1><script type=\\"module\\" src=\\"main.js\\"></script>","main.js":"console.log(1)"}}'
# {"project":{"id":"p…",…},"version":2}
\`\`\`

\`id\` is optional (\`^p[0-9a-f]{16}$\`). Re-sending the same \`id\` merges the
files (safe to retry). If the id belongs to someone else you get a fresh id —
always use the id in the response. Templates: \`web\`, \`react\`, \`python\`,
\`node\`, \`static\`, or anything (\`custom\`).

### Read a project

\`\`\`bash
curl -s "$OST/projects/$PID" -H "Authorization: Bearer $TOKEN"          # metadata + file list (path,size,hash,mtime,binary)
curl -s "$OST/projects/$PID/export" -H "Authorization: Bearer $TOKEN"   # every file WITH content
curl -s "$OST/projects/$PID/file?path=src/app.js" -H "Authorization: Bearer $TOKEN"
# {"path":"src/app.js","content":"…","hash":"<sha256 hex of the UTF-8 content>","binary":false,"mtime":…}
\`\`\`

### Write one file (write)

The body is the raw file content (UTF-8). Binary → send the data URL text.

\`\`\`bash
curl -s -X PUT "$OST/projects/$PID/file?path=src/app.js" -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @src/app.js
# {"version":13,"hash":"…"}
\`\`\`

Writing identical content is a no-op (same version, no change entry).

### Delete a file or folder (write)

\`\`\`bash
curl -s -X DELETE "$OST/projects/$PID/file?path=old.js" -H "Authorization: Bearer $TOKEN"
# a folder path deletes everything under it → {"version":14,"deleted":3}
\`\`\`

### Batch changes (write) — preferred for multi-file edits

\`\`\`bash
curl -s -X POST "$OST/projects/$PID/sync" -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"rename":[["main.js","src/main.js"]],"del":["notes.txt"],"put":{"index.html":"…","src/util.js":"…"}}'
# {"version":18,"applied":4}
\`\`\`

Applied in this order: \`rename\` (file or folder; target must not exist),
then \`del\`, then \`put\`. The whole batch is validated first — if anything is
invalid nothing is written.

### Rename / delete a project (write)

\`\`\`bash
curl -s -X PATCH  "$OST/projects/$PID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"todo-v2"}'
curl -s -X DELETE "$OST/projects/$PID" -H "Authorization: Bearer $TOKEN"
\`\`\`

---

## 3. The sync model (how your edits reach the human)

- The server keeps a change log per project (the last 600 changes).
- An open Studio tab polls \`GET /projects/:id/changes?since=<version it has>\`
  and applies what changed; your edits show up in the editor within seconds,
  marked as coming from an agent.
- If the human has an unsaved local edit to the same file, **their edit wins**
  and is pushed back up — re-read a file before rewriting it if you are
  co-editing.
- You can follow the human's edits the same way:

\`\`\`bash
curl -s "$OST/projects/$PID/changes?since=12" -H "Authorization: Bearer $TOKEN"
# {"version":15,"changes":[{"v":14,"path":"main.js","content":"…","hash":"…","by":"ost-mesh:…"},
#                          {"v":15,"path":"old.js","deleted":true,"hash":null,"by":"tok_…"}]}
\`\`\`

\`since=0\` returns no changes plus the current version (use \`/export\` for a
full copy first). Entries are de-duplicated to the latest change per path.
Content over 200 KB comes back as \`"large":true\` — fetch it with \`/file\`.
\`"full":true\` means your \`since\` was older than the kept log: the list is
then every current file; re-export to drop files deleted in between.
\`by\` is the owner's mesh address for human edits and a token id
(\`tok_…\`) for agent edits.

**Running code:** there is no run endpoint. Ask the human to press **Run** /
**Preview** in Studio (code runs in a browser sandbox), or run it on your own
machine.

---

## 4. Deploy (deploy)

Apps are served at \`https://ost-apps.nachogtavl.workers.dev/<slug>/\` and
listed in the OST app gallery (\`#app=<slug>\` opens one inside OST).

\`\`\`bash
# deploy the project's files as they are (must contain index.html at the root)
curl -s -X POST "$OST/projects/$PID/deploy" -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"slug":"my-todo","name":"My Todo","description":"A tiny todo app"}'
# {"app":{"slug":"my-todo","url":"https://ost-apps.nachogtavl.workers.dev/my-todo/","version":1,"files":3,"bytes":2048}}
\`\`\`

No build server exists. Plain HTML/CSS/JS (ES modules, \`https://esm.sh/…\`
imports) deploys as-is. For React/TypeScript either use Studio's **Deploy**
button (it bundles in the browser) or build locally and send the output:

\`\`\`bash
# send built files instead of the project files (binary as data URLs)
curl -s -X POST "$OST/projects/$PID/deploy" -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"slug":"my-todo","files":{"index.html":"…","assets/app-3f2a.js":"…","logo.png":"data:image/png;base64,…"}}'
\`\`\`

- Slug: \`^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$\` (3–40 chars). The first
  deployer owns a slug; reserved: \`api www admin ost studio app apps assets\`.
- Redeploying bumps the app version; the previous 2 versions are kept.
- Serving: a folder → its \`index.html\`; an unknown path without an extension
  → \`index.html\` (single-page apps work); short public caching (60 s).
- Apps run sandboxed and all apps share one origin — never keep secrets in
  \`localStorage\` (keys are namespaced per app, but it is not a security boundary).

\`\`\`bash
curl -s "$OST/apps?limit=24"                    # public gallery, newest first → {"apps":[…],"cursor":…}
curl -s "$OST/apps/my-todo"                     # one app + its files
curl -s -X POST "$OST/apps/my-todo/unpublish" -H "Authorization: Bearer $TOKEN"   # owner only; you keep the slug
\`\`\`

---

## 5. AI chat proxy (read)

OpenAI-compatible chat with tool calling, for agents running inside Studio
(and any client with a token). Groq \`llama-3.3-70b-versatile\` → fallback
\`llama-3.1-8b-instant\` → Workers AI \`@cf/meta/llama-3.3-70b-instruct-fp8-fast\`.

\`\`\`bash
curl -s -X POST "$OST/ai/chat" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \\
  -d '{"messages":[{"role":"user","content":"Write a CSS reset"}],"tools":[]}'
# {"message":{"role":"assistant","content":"…","tool_calls":[…]},"model":"llama-3.3-70b-versatile"}
\`\`\`

Max 60 messages, 24k chars each, 120k total, 16 tools. 40 requests per 10
minutes per user, plus a global daily cap.

---

## 6. Limits

| What | Limit |
|---|---|
| Projects per user | 50 |
| Files per project | 400 |
| Project size | 25 MB |
| One project file | 1.5 MB |
| Apps per user | 20 |
| Files per deploy | 300 |
| Deploy size | 25 MB |
| One deployed file | 5 MB |
| Tokens per user | 20 |
| AI chat | 40 requests / 10 min / user |

---

## 7. Endpoint summary

| Method & path | Scope | Notes |
|---|---|---|
| GET \`/health\` | – | \`{ok, studio:"v1"}\` |
| GET \`/agents.md\` | – | this document |
| GET \`/projects\` | read | |
| POST \`/projects\` | write | \`{id?, name, template?, files?}\` |
| GET \`/projects/:id\` | read | file list |
| PATCH \`/projects/:id\` | write | \`{name}\` |
| DELETE \`/projects/:id\` | write | |
| GET \`/projects/:id/export\` | read | all files with content |
| GET \`/projects/:id/file?path=\` | read | |
| PUT \`/projects/:id/file?path=\` | write | raw body |
| DELETE \`/projects/:id/file?path=\` | write | file or folder |
| POST \`/projects/:id/sync\` | write | \`{rename?, del?, put?}\` |
| GET \`/projects/:id/changes?since=N\` | read | |
| POST \`/projects/:id/deploy\` | deploy | \`{slug, name?, description?, files?}\` |
| GET \`/apps?limit=&cursor=\` | – | gallery |
| GET \`/apps/:slug\` | – | |
| POST \`/apps/:slug/unpublish\` | deploy | owner only |
| GET \`/serve/:slug/<path>\` | – | raw files (use the ost-apps URL instead) |
| POST \`/ai/chat\` | read | |
| POST/GET/DELETE \`/tokens\` | Studio only | not available to tokens |
`;
