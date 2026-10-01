/* ==========================================================================
 * OST Apps — hosting worker for apps deployed from OST Studio
 * --------------------------------------------------------------------------
 *   GET /                 gallery landing page (server-rendered from ost-api)
 *   GET /<slug>           301 -> /<slug>/
 *   GET /<slug>/<path>    file from ost-api /studio/v1/serve/<slug>/<path>
 *   GET /robots.txt       allow all
 *   GET /favicon.ico      204
 *   anything but GET/HEAD 405
 *
 * Files are stored by the StudioHub Durable Object in ost-api and reached over
 * the `API` service binding. This worker never executes app code: apps are
 * static files that run in the visitor's browser. It drops the sandbox CSP the
 * API puts on raw files, adds hosting headers, and for HTML injects
 *   1) a localStorage/sessionStorage key-namespacing shim at the top of <head>
 *   2) a small dismissible "Made with OST Studio · Report" badge before </body>
 * The shim is a CONVENIENCE so apps don't trample each other's keys. It is NOT
 * a security boundary — every app shares this origin. See README.md.
 * Contract: project-docs/ost-studio.md §5
 * ========================================================================== */

const SITE = 'https://ost-token.pages.dev';
const STUDIO_URL = SITE + '/studio.html';
const PUBLIC_API = 'https://ost-api.nachogtavl.workers.dev';
const API_BASE = '/studio/v1';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'www', 'admin', 'ost', 'studio', 'app', 'apps', 'assets']);
const UPSTREAM_TIMEOUT_MS = 20000;
// Bump when the injected shim/badge changes, so browsers holding an HTML copy
// with the old injection revalidate to a full 200 instead of a 304.
const INJECT_VER = 'osa1';

const FRAME_ANCESTORS = "frame-ancestors 'self' https://ost-token.pages.dev https://*.ost-token.pages.dev http://localhost:* http://127.0.0.1:*";
const PERMISSIONS = 'camera=(self), microphone=(self), geolocation=(self)';

// Upstream headers that never reach the visitor.
const DROP_HEADERS = [
  'content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
  'set-cookie', 'service-worker-allowed', 'permissions-policy', 'feature-policy',
  'cross-origin-opener-policy', 'referrer-policy', 'x-content-type-options',
  'transfer-encoding', 'connection', 'keep-alive',
];

/* ======================================================================
 * small helpers
 * ==================================================================== */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

function secure(headers, { csp } = {}) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', PERMISSIONS);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  headers.set('Content-Security-Policy', csp || FRAME_ANCESTORS);
  headers.delete('X-Frame-Options'); // OST embeds apps in an iframe — never set it
  return headers;
}

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'self'; " + FRAME_ANCESTORS;

function htmlResponse(html, status, method, extra) {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  secure(h, { csp: PAGE_CSP });
  return new Response(method === 'HEAD' ? null : html, { status, headers: h });
}

function textResponse(text, status, method, extra) {
  const h = new Headers({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  secure(h);
  return new Response(method === 'HEAD' ? null : text, { status, headers: h });
}

function redirect(location, status) {
  const h = new Headers({ location, 'cache-control': 'public, max-age=300' });
  secure(h);
  return new Response(null, { status: status || 301, headers: h });
}

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('upstream_timeout'), { code: 'upstream_timeout' })), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/** Reach ost-api: service binding in production, public URL as a dev fallback. */
function callApi(env, pathq, init) {
  const api = env && env.API;
  if (api && typeof api.fetch === 'function') return api.fetch('https://ost-api' + pathq, init);
  return fetch(String((env && env.API_ORIGIN) || PUBLIC_API).replace(/\/+$/, '') + pathq, init);
}

/* ======================================================================
 * path parsing
 * ==================================================================== */
/**
 * Splits a request pathname into { kind, ... }:
 *   {kind:'root'} | {kind:'robots'} | {kind:'favicon'}
 *   {kind:'redirect', location} | {kind:'notfound', reason, slug?}
 *   {kind:'app', slug, rest}   rest = re-encoded path after "/<slug>/" ('' = app root)
 */
function parsePath(pathname, search) {
  const q = search || '';
  if (pathname === '/' || pathname === '') return { kind: 'root' };
  if (pathname === '/index.html') return { kind: 'redirect', location: '/' + q };
  if (pathname === '/robots.txt') return { kind: 'robots' };
  if (pathname === '/favicon.ico') return { kind: 'favicon' };
  const body = pathname.slice(1);
  const cut = body.indexOf('/');
  const rawSlug = cut < 0 ? body : body.slice(0, cut);
  let slug;
  try { slug = decodeURIComponent(rawSlug); } catch (_) { return { kind: 'notfound', reason: 'bad_path' }; }
  if (!SLUG_RE.test(slug)) {
    const lower = slug.toLowerCase();
    if (lower !== slug && SLUG_RE.test(lower) && !RESERVED.has(lower)) {
      return { kind: 'redirect', location: '/' + lower + (cut < 0 ? '/' : body.slice(cut)) + q };
    }
    return { kind: 'notfound', reason: 'bad_slug', slug: clip(slug, 60) };
  }
  if (RESERVED.has(slug)) return { kind: 'notfound', reason: 'reserved', slug };
  if (cut < 0) return { kind: 'redirect', location: '/' + slug + '/' + q };
  const segs = body.slice(cut + 1).split('/');
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const raw = segs[i];
    if (raw === '') {
      // keep a trailing slash (directory → index.html upstream); drop empty middle segments
      if (i === segs.length - 1 && out.length) out.push('');
      continue;
    }
    let seg;
    try { seg = decodeURIComponent(raw); } catch (_) { return { kind: 'notfound', reason: 'bad_path', slug }; }
    if (seg === '.' || seg === '..' || /[\\/\u0000-\u001f\u007f]/.test(seg) || seg.length > 200) return { kind: 'notfound', reason: 'bad_path', slug };
    out.push(encodeURIComponent(seg));
  }
  const rest = out.join('/');
  if (rest.length > 1024) return { kind: 'notfound', reason: 'bad_path', slug };
  return { kind: 'app', slug, rest };
}

/** Paths that will (or may) be served as HTML: '', 'dir/', '*.html', extension-less SPA routes. */
function looksLikeHtml(rest) {
  if (!rest || rest.endsWith('/')) return true;
  const base = rest.slice(rest.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return true;
  const ext = base.slice(dot + 1).toLowerCase();
  return ext === 'html' || ext === 'htm';
}

function wantsDocument(request, rest) {
  const dest = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (dest) return ['document', 'iframe', 'frame', 'embed', 'object'].includes(dest);
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (accept.includes('text/html')) return true;
  return looksLikeHtml(rest);
}

/* ======================================================================
 * ETag mapping for injected HTML
 * The visitor gets W/"<upstream-opaque>-osaN"; conditional requests are mapped
 * back so the API's own ETag matching keeps working.
 * ==================================================================== */
const ETAG_RE = /^(W\/)?"([^"]*)"$/;
function tagEtag(etag) {
  const m = ETAG_RE.exec(String(etag || '').trim());
  return m ? `W/"${m[2]}-${INJECT_VER}"` : null;
}
function mapIfNoneMatch(value) {
  const stripped = new Set();
  const tokens = [];
  for (const tok of String(value || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (tok === '*') { tokens.push(tok); continue; }
    const m = ETAG_RE.exec(tok);
    if (!m) continue;
    const suffix = '-' + INJECT_VER;
    if (m[2].endsWith(suffix)) {
      const opaque = m[2].slice(0, -suffix.length);
      stripped.add(opaque);
      tokens.push(`"${opaque}"`, `W/"${opaque}"`); // upstream may compare strong or weak
    } else if (/-osa\d+$/.test(m[2])) {
      continue; // an HTML copy with an older injection: force a full response
    } else {
      tokens.push(tok);
    }
  }
  return { header: [...new Set(tokens)].join(', '), stripped };
}

/* ======================================================================
 * injected snippets
 * ==================================================================== */
function jsString(s) { return JSON.stringify(String(s)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

/**
 * Storage namespacing shim. Replaces window.localStorage / window.sessionStorage
 * with Proxy facades over the real Storage whose keys are prefixed "<slug>:".
 * getItem/setItem/removeItem/key/length/clear, property access (ls.foo),
 * Object.keys/JSON.stringify, `in`, delete and the cross-tab "storage" event
 * all see only this app's keys, unprefixed. clear() removes only this app's keys.
 * Not a security boundary (the real Storage is reachable via a fresh iframe or
 * the Window property descriptor) — it only keeps well-behaved apps apart.
 */
function shimScript(slug) {
  return `<script data-ost-apps="storage">(function(){'use strict';
var NS=${jsString(slug + ':')},HIDE=${jsString('__ost_apps__/badge-hidden/' + slug)},W=window,raw={};
try{
var S=Storage.prototype,gI=S.getItem,sI=S.setItem,rI=S.removeItem,kI=S.key,lenD=Object.getOwnPropertyDescriptor(S,'length'),lenG=lenD&&lenD.get;
var hook=function(name){
  var own=Object.getOwnPropertyDescriptor(W,name),d=own||(W.Window&&Object.getOwnPropertyDescriptor(Window.prototype,name));
  if(!d||typeof d.get!=='function'||(own&&!own.configurable))return;
  var real;try{real=d.get.call(W);}catch(e){return;}
  if(!real||!lenG)return;
  raw[name]=real;
  var keys=function(){var out=[],n=lenG.call(real);for(var i=0;i<n;i++){var k=kI.call(real,i);if(k!==null&&k.slice(0,NS.length)===NS)out.push(k.slice(NS.length));}return out;};
  var api={
    getItem:function(k){return gI.call(real,NS+k);},
    setItem:function(k,v){sI.call(real,NS+k,String(v));},
    removeItem:function(k){rI.call(real,NS+k);},
    key:function(i){var ks=keys();i=Math.floor(Number(i))||0;return i>=0&&i<ks.length?ks[i]:null;},
    clear:function(){var ks=keys();for(var i=0;i<ks.length;i++)rI.call(real,NS+ks[i]);}
  };
  var has=Object.prototype.hasOwnProperty;
  var proxy=new Proxy(Object.create(S),{
    get:function(t,p){
      if(typeof p==='symbol')return S[p];
      if(p==='length')return keys().length;
      if(p==='__proto__')return S;
      if(has.call(api,p))return api[p];
      if(p in S)return S[p];
      var v=gI.call(real,NS+p);return v===null?undefined:v;
    },
    set:function(t,p,v){if(typeof p==='symbol')return false;sI.call(real,NS+p,String(v));return true;},
    has:function(t,p){if(typeof p==='symbol')return p in S;return (p in S)||gI.call(real,NS+p)!==null;},
    deleteProperty:function(t,p){if(typeof p!=='symbol')rI.call(real,NS+p);return true;},
    ownKeys:function(){return keys();},
    getOwnPropertyDescriptor:function(t,p){if(typeof p==='symbol')return undefined;var v=gI.call(real,NS+p);return v===null?undefined:{value:v,writable:true,enumerable:true,configurable:true};},
    defineProperty:function(t,p,d){if(typeof p==='symbol'||!d||d.configurable===false||!('value' in d))return false;sI.call(real,NS+p,String(d.value));return true;}
  });
  Object.defineProperty(W,name,{configurable:true,enumerable:true,get:function(){return proxy;}});
};
hook('localStorage');hook('sessionStorage');
W.addEventListener('storage',function(e){
  if(!e.isTrusted)return;
  var a=e.storageArea;if(!a||(a!==raw.localStorage&&a!==raw.sessionStorage))return;
  e.stopImmediatePropagation();
  var k=e.key;if(k!==null){if(k.slice(0,NS.length)!==NS)return;k=k.slice(NS.length);}
  try{W.dispatchEvent(new StorageEvent('storage',{key:k,oldValue:e.oldValue,newValue:e.newValue,url:e.url,storageArea:null}));}catch(_){}
},true);
}catch(e){}
try{Object.defineProperty(W,Symbol.for('ost.apps'),{value:Object.freeze({
  badgeHidden:function(){try{return !!raw.sessionStorage&&gI.call(raw.sessionStorage,HIDE)==='1';}catch(e){return false;}},
  hideBadge:function(){try{raw.sessionStorage&&sI.call(raw.sessionStorage,HIDE,'1');}catch(e){}}
})});}catch(e){}
})();</script>`;
}

/** "Made with OST Studio · Report" badge; hidden when framed (OST shows its own chrome). */
function badgeScript(slug) {
  const appHref = SITE + '/#app=' + encodeURIComponent(slug);
  const reportHref = STUDIO_URL + '#report=' + encodeURIComponent(slug);
  const css = ':host{all:initial}'
    + '.b{position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:center;gap:6px;'
    + 'padding:4px 4px 4px 10px;border-radius:999px;background:rgba(17,20,28,.86);color:#e9ecf2;font:500 11.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:.82;transition:opacity .15s}'
    + '.b:hover,.b:focus-within{opacity:1}'
    + 'a{color:inherit;text-decoration:none;white-space:nowrap}a:hover{text-decoration:underline}a:focus-visible,button:focus-visible{outline:2px solid #8b8cff;outline-offset:2px;border-radius:4px}'
    + 'b{font-weight:700}.d{opacity:.5}'
    + 'button{all:unset;cursor:pointer;width:20px;height:20px;display:grid;place-items:center;border-radius:50%;font-size:14px;line-height:1;color:#c9cfdb}'
    + 'button:hover{background:rgba(255,255,255,.14);color:#fff}'
    + '@media print{.b{display:none}}';
  const inner = '<style>' + css + '</style><div class="b" role="note" aria-label="About this app">'
    + '<a href="' + esc(appHref) + '" target="_blank" rel="noopener">Made with <b>OST Studio</b></a>'
    + '<span class="d" aria-hidden="true">·</span>'
    + '<a href="' + esc(reportHref) + '" target="_blank" rel="noopener" title="Report this app to OST">Report</a>'
    + '<button type="button" aria-label="Hide the OST Studio badge" title="Hide">\u00d7</button></div>';
  return `<script data-ost-apps="badge">(function(){
try{if(window.top!==window)return;}catch(e){return;}
var api;try{api=window[Symbol.for('ost.apps')];}catch(e){}
try{if(api&&api.badgeHidden())return;}catch(e){}
var mount=function(){try{
  if(document.querySelector('ost-apps-badge'))return;
  var host=document.createElement('ost-apps-badge');
  host.setAttribute('style','all:initial;position:fixed;z-index:2147483000');
  if(!host.attachShadow)return;
  var root=host.attachShadow({mode:'closed'});
  root.innerHTML=${jsString(inner)};
  root.querySelector('button').addEventListener('click',function(){host.remove();try{api&&api.hideBadge();}catch(e){}});
  (document.documentElement||document.body).appendChild(host);
}catch(e){}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();</script>`;
}

/* ======================================================================
 * HTML injection
 * ==================================================================== */
function injectHtml(response, slug, headers) {
  const shim = shimScript(slug);
  const badge = badgeScript(slug);
  if (typeof HTMLRewriter !== 'undefined') {
    let shimDone = false, badgeDone = false;
    const rewritten = new HTMLRewriter()
      .on('*', {
        element(el) {
          if (shimDone) return;
          const tag = String(el.tagName || '').toLowerCase();
          if (tag === 'html') return;
          shimDone = true;
          if (tag === 'head') el.prepend(shim, { html: true });
          else el.before(shim, { html: true }); // head-less document: before its first element
        },
      })
      .on('body', {
        element(el) {
          if (badgeDone) return;
          try {
            el.onEndTag((end) => { if (badgeDone) return; badgeDone = true; end.before(badge, { html: true }); });
          } catch (_) { /* no end tag possible — document end fallback below */ }
        },
      })
      .onDocument({
        end(end) {
          let tail = '';
          if (!shimDone) { shimDone = true; tail += shim; }
          if (!badgeDone) { badgeDone = true; tail += badge; }
          if (tail) end.append(tail, { html: true });
        },
      })
      .transform(new Response(response.body, { status: response.status, headers }));
    return rewritten;
  }
  // Fallback (unit tests in Node — no HTMLRewriter): same placement via string edits.
  return (async () => {
    let html = await response.text();
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    if (head) html = html.slice(0, head.index + head[0].length) + shim + html.slice(head.index + head[0].length);
    else {
      const first = /<(?!!|\/|html[\s>])[a-z][^>]*>/i.exec(html);
      html = first ? html.slice(0, first.index) + shim + html.slice(first.index) : html + shim;
    }
    const end = html.toLowerCase().lastIndexOf('</body>');
    html = end >= 0 ? html.slice(0, end) + badge + html.slice(end) : html + badge;
    return new Response(html, { status: response.status, headers });
  })();
}

/* ======================================================================
 * pages (gallery, not found, errors)
 * ==================================================================== */
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true" width="28" height="28"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d6af8"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M12.5 10.5 7 16l5.5 5.5M19.5 10.5 25 16l-5.5 5.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6d6af8"/><path d="M12.5 10.5 7 16l5.5 5.5M19.5 10.5 25 16l-5.5 5.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');

const CSS = `
:root{--bg:#f6f7fb;--fg:#10131a;--muted:#5b6474;--card:#fff;--line:#e3e6ee;--accent:#5b5bf7;--accent-fg:#fff;--chip:#eef0f6;
--note-bg:#fff8e8;--note-line:#f0dcae;--note-fg:#5f4300;--shadow:0 1px 2px rgba(16,19,26,.06),0 6px 20px rgba(16,19,26,.06);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e9ecf2;--muted:#98a1b3;--card:#141821;--line:#242b38;--accent:#8b8cff;--accent-fg:#0b0d12;--chip:#1c2230;
--note-bg:#221c0e;--note-line:#4a3b17;--note-fg:#f2d58f;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column}
a{color:var(--accent)}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:60px}
.brand{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;min-width:0}
.brand strong{font-size:17px;letter-spacing:-.01em}.brand span{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;background:var(--accent);color:var(--accent-fg);font-weight:600;font-size:14px;text-decoration:none;white-space:nowrap;border:0}
.btn:hover{filter:brightness(1.08)}.btn.ghost{background:var(--chip);color:var(--fg)}
.hero{padding:36px 0 8px}
.hero h1{margin:0 0 8px;font-size:clamp(26px,5vw,40px);line-height:1.15;letter-spacing:-.02em}
.hero p{margin:0;color:var(--muted);max-width:640px}
.note{margin:20px 0 4px;padding:12px 14px;border:1px solid var(--note-line);background:var(--note-bg);color:var(--note-fg);border-radius:12px;font-size:14px}
.note b{font-weight:650}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 14px;flex-wrap:wrap}
.count{color:var(--muted);font-size:14px}
.search{flex:1 1 260px;max-width:360px;position:relative}
.search input{width:100%;font:inherit;font-size:15px;padding:10px 12px 10px 36px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);outline:none}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;padding:0;margin:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);display:flex;flex-direction:column;transition:transform .12s,border-color .12s}
.card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.card a.main{display:flex;flex-direction:column;color:inherit;text-decoration:none;flex:1}
.card a.main:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:14px}
.cover{height:112px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:38px;letter-spacing:-.02em;text-shadow:0 2px 10px rgba(0,0,0,.18);position:relative}
.cover small{position:absolute;right:10px;top:10px;font-size:11px;font-weight:600;letter-spacing:0;background:rgba(0,0,0,.28);padding:2px 8px;border-radius:999px;text-shadow:none}
.body{padding:12px 14px 10px;display:flex;flex-direction:column;gap:6px;flex:1}
.body h2{margin:0;font-size:16px;line-height:1.3;overflow-wrap:anywhere}
.body p{margin:0;color:var(--muted);font-size:14px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.meta{margin-top:auto;padding-top:6px;color:var(--muted);font-size:12.5px;display:flex;flex-direction:column;gap:1px;min-width:0}
.meta .who{color:var(--fg);font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta .stats{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot{display:flex;justify-content:space-between;gap:8px;padding:9px 14px;border-top:1px solid var(--line);font-size:13px}
.foot a{text-decoration:none;font-weight:550}.foot a.rep{color:var(--muted);font-weight:500}
.foot a:hover{text-decoration:underline}
.empty{text-align:center;padding:48px 16px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);background:var(--card)}
.empty h2{color:var(--fg);margin:0 0 6px;font-size:20px}.empty p{margin:0 0 16px}
.pager{display:flex;justify-content:center;gap:10px;margin:24px 0 8px}
footer.bottom{margin-top:auto;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
footer.bottom .wrap{padding-top:18px;padding-bottom:22px;display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between}
.msg{max-width:560px;margin:56px auto;text-align:center;padding:0 4px}
.msg .code{font-size:13px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-weight:650}
.msg h1{font-size:clamp(24px,5vw,32px);margin:8px 0 10px;letter-spacing:-.02em;overflow-wrap:anywhere}
.msg p{color:var(--muted);margin:0 0 20px}
.msg .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--chip);padding:1px 6px;border-radius:6px;overflow-wrap:anywhere}
@media (max-width:560px){.brand span{display:none}.hero{padding-top:24px}.grid{grid-template-columns:1fr 1fr;gap:10px}.cover{height:84px;font-size:30px}.body{padding:10px 11px 8px}.body p{-webkit-line-clamp:2;font-size:13px}.foot{padding:8px 11px;font-size:12px}}
@media (max-width:360px){.grid{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
`;

function shell({ title, description, body, canonical }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<title>' + esc(title) + '</title>'
    + (description ? '<meta name="description" content="' + esc(description) + '">' : '')
    + '<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#0b0d12" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#f6f7fb" media="(prefers-color-scheme: light)">'
    + (canonical ? '<meta property="og:title" content="' + esc(title) + '"><meta property="og:type" content="website">' : '')
    + '<link rel="icon" href="' + esc(FAVICON) + '"><style>' + CSS + '</style></head><body>'
    + '<header class="top"><div class="wrap"><a class="brand" href="/">' + LOGO + '<strong>OST Apps</strong><span>made with OST Studio</span></a>'
    + '<a class="btn" href="' + esc(STUDIO_URL) + '">Build your own</a></div></header>'
    + '<main class="wrap" id="main">' + body + '</main>'
    + '<footer class="bottom"><div class="wrap"><span>OST Apps hosts static web apps built in <a href="' + esc(STUDIO_URL) + '">OST Studio</a>. No server-side code runs here. '
    + 'Builders: every app shares this web origin, so never keep secrets in an app’s browser storage.</span>'
    + '<span><a href="' + esc(SITE) + '/">OST</a> · Solana devnet</span></div></footer>'
    + '</body></html>';
}

function hashHue(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h) % 360; }
function monogram(name, slug) {
  const words = String(name || slug).replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(Boolean);
  const m = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] || slug).slice(0, 2);
  return m.toUpperCase();
}
function ago(ts) {
  let t = Number(ts) || 0; if (!t) return '';
  if (t < 1e12) t *= 1000;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const units = [[60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let v = s / 60;
  for (const [n, name] of units) { if (v < n) { const r = Math.floor(v); return r + ' ' + name + (r === 1 ? '' : 's') + ' ago'; } v /= n; }
  return '';
}
function fmtCount(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}
function shortAddr(a) { a = String(a || ''); const m = /^ost-mesh:([a-z0-9]{4})/i.exec(a); return m ? 'builder ' + m[1].toLowerCase() : 'an OST builder'; }

function appCard(app) {
  const slug = String(app.slug || '');
  const name = clip(app.name || slug, 70) || slug;
  const desc = clip(app.description || '', 220);
  const prof = app.profile && typeof app.profile === 'object' ? app.profile : {};
  const who = clip(((prof.emoji ? prof.emoji + ' ' : '') + (prof.name || '')).trim(), 40) || shortAddr(app.owner);
  const hue = hashHue(slug);
  const cover = `background:linear-gradient(135deg,hsl(${hue} 72% 56%),hsl(${(hue + 48) % 360} 70% 42%))`;
  const views = Number(app.views) || 0;
  const when = ago(app.ts);
  const ver = Number(app.version) > 0 ? 'v' + Math.floor(Number(app.version)) : '';
  const q = (name + ' ' + desc + ' ' + who + ' ' + slug).toLowerCase();
  return '<li class="card" data-q="' + esc(q) + '">'
    + '<a class="main" href="/' + esc(slug) + '/">'
    + '<div class="cover" style="' + cover + '" aria-hidden="true">' + esc(monogram(name, slug)) + (ver ? '<small>' + esc(ver) + '</small>' : '') + '</div>'
    + '<div class="body"><h2>' + esc(name) + '</h2>' + (desc ? '<p>' + esc(desc) + '</p>' : '')
    + '<div class="meta"><span class="who">' + esc(who) + '</span><span class="stats">' + esc(fmtCount(views)) + ' view' + (views === 1 ? '' : 's')
    + (when ? ' · ' + esc(when) : '') + '</span></div></div></a>'
    + '<div class="foot"><a href="' + esc(SITE + '/#app=' + encodeURIComponent(slug)) + '">Open in OST ↗</a>'
    + '<a class="rep" href="' + esc(STUDIO_URL + '#report=' + encodeURIComponent(slug)) + '">Report</a></div></li>';
}

const NOTE = '<div class="note" role="note"><b>Heads-up:</b> these are static web apps made by OST community members and published straight from OST Studio — '
  + 'OST does not review them first. They run in your browser; anything involving OST uses Solana <b>devnet</b> test tokens, never real money. '
  + 'Never type a seed phrase, private key or password into an app here, and don’t approve wallet requests you don’t understand. See something harmful? Use <b>Report</b>.</div>';

const SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const FILTER_JS = "(function(){var i=document.getElementById('q'),n=document.getElementById('none'),c=document.getElementById('count');if(!i)return;"
  + "var cards=[].slice.call(document.querySelectorAll('li[data-q]')),total=c?c.textContent:'';"
  + "i.addEventListener('input',function(){var v=i.value.trim().toLowerCase(),k=0;cards.forEach(function(el){var ok=!v||el.getAttribute('data-q').indexOf(v)>=0;el.hidden=!ok;if(ok)k++;});"
  + "if(n)n.hidden=k>0;if(c)c.textContent=v?(k+' of '+total):total;});})();";

async function galleryPage(request, env, url) {
  const method = request.method;
  const cursorIn = url.searchParams.get('cursor') || '';
  const cursor = /^[\w\-.:=+/]{1,200}$/.test(cursorIn) ? cursorIn : '';
  let apps = null, next = '', failure = '';
  try {
    const res = await withTimeout(callApi(env, API_BASE + '/apps?limit=60' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { method: 'GET', headers: { accept: 'application/json' } }), UPSTREAM_TIMEOUT_MS);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !Array.isArray(data.apps)) failure = (data && data.error) || ('http_' + res.status);
    else {
      apps = data.apps.filter((a) => a && typeof a === 'object' && SLUG_RE.test(String(a.slug || '')) && !RESERVED.has(String(a.slug)));
      next = typeof data.cursor === 'string' && /^[\w\-.:=+/]{1,200}$/.test(data.cursor) ? data.cursor : '';
    }
  } catch (e) {
    failure = (e && e.code) || 'unreachable';
  }

  const hero = '<section class="hero"><h1>Apps made with OST Studio</h1>'
    + '<p>Little web apps built right in the browser by the OST community. Open one, get inspired, then build and publish your own in minutes — no install, no server.</p>'
    + NOTE + '</section>';

  let body;
  if (failure) {
    body = hero + '<div class="empty" role="alert"><h2>The gallery is unavailable right now</h2><p>We couldn’t load the list of apps. Apps themselves may still open at their own address. Please try again in a moment.</p>'
      + '<a class="btn" href="' + (cursor ? '/?cursor=' + esc(encodeURIComponent(cursor)) : '/') + '">Try again</a></div>';
    return htmlResponse(shell({ title: 'OST Apps — made with OST Studio', body }), 503, method, { 'retry-after': '30', 'cache-control': 'no-store' });
  }
  if (!apps.length) {
    body = hero + '<div class="empty"><h2>' + (cursor ? 'No more apps' : 'No apps published yet') + '</h2>'
      + '<p>' + (cursor ? 'You’ve reached the end of the gallery.' : 'Be the first: open OST Studio, pick a template, and press Deploy.') + '</p>'
      + (cursor ? '<a class="btn ghost" href="/">Back to the first page</a>' : '<a class="btn" href="' + esc(STUDIO_URL) + '">Build your own</a>') + '</div>';
  } else {
    const n = apps.length;
    body = hero
      + '<div class="bar"><span class="count" id="count">' + esc(n + (next ? '+' : '') + ' app' + (n === 1 ? '' : 's')) + '</span>'
      + '<label class="search">' + SEARCH_ICON + '<input id="q" type="search" placeholder="Filter apps" aria-label="Filter apps" autocomplete="off" spellcheck="false"></label></div>'
      + '<ul class="grid">' + apps.map(appCard).join('') + '</ul>'
      + '<div class="empty" id="none" hidden><h2>No matching apps</h2><p>Try a different word' + (next ? ', or look on the next page' : '') + '.</p></div>'
      + ((cursor || next) ? '<nav class="pager" aria-label="Pages">' + (cursor ? '<a class="btn ghost" href="/">← First page</a>' : '') + (next ? '<a class="btn ghost" href="/?cursor=' + esc(encodeURIComponent(next)) + '">More apps →</a>' : '') + '</nav>' : '')
      + '<script>' + FILTER_JS + '</script>';
  }
  return htmlResponse(shell({
    title: 'OST Apps — made with OST Studio',
    description: 'Static web apps built and published by the OST community with OST Studio.',
    body, canonical: true,
  }), 200, method, { 'cache-control': 'public, max-age=60' });
}

function notFoundPage(method, { slug, path, reason, status }) {
  const appPath = slug ? '/' + slug + '/' + (path || '') : '';
  let title, text;
  if (reason === 'reserved') { title = 'That name is reserved'; text = 'No app can live at this address.'; }
  else if (reason === 'bad_slug' || reason === 'bad_path') { title = 'That isn’t an app address'; text = 'App addresses look like <code>/my-app/</code> — lowercase letters, numbers and dashes.'; }
  else if (reason === 'file') { title = 'Page not found in this app'; text = 'The app at <code>/' + esc(slug) + '/</code> has no file at <code>' + esc(clip(decodeSafe(appPath), 160)) + '</code>.'; }
  else if (reason === 'blocked') { title = 'This app isn’t available'; text = 'The app at <code>/' + esc(slug) + '/</code> has been taken down or is temporarily blocked.'; }
  else if (reason === 'gone') { title = 'This app was unpublished'; text = 'Its creator took <code>/' + esc(slug) + '/</code> down.'; }
  else if (reason === 'app') { title = 'No app here yet'; text = 'Nothing is published at <code>/' + esc(slug) + '/</code>. It may have been unpublished, or the address is mistyped. The name might even be free — you could claim it.'; }
  else { title = 'Not found'; text = 'There is nothing at <code>' + esc(clip(decodeSafe(appPath) || '/', 160)) + '</code> — the app may not exist, or this page isn’t part of it.'; }
  const body = '<section class="msg"><div class="code">' + (status || 404) + '</div><h1>' + esc(title) + '</h1><p>' + text + '</p>'
    + '<div class="row"><a class="btn" href="/">Browse apps</a><a class="btn ghost" href="' + esc(STUDIO_URL) + '">Build your own</a></div></section>';
  return htmlResponse(shell({ title: title + ' · OST Apps', body }), status || 404, method, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
}

function errorPage(method, status, slug) {
  const busy = status === 429;
  const body = '<section class="msg"><div class="code">' + status + '</div><h1>' + (busy ? 'This app is busy' : 'This app couldn’t load') + '</h1>'
    + (busy
      ? '<p>Too many requests reached' + (slug ? ' <code>/' + esc(slug) + '/</code>' : ' OST Apps') + ' at once. Wait a few seconds and try again.</p>'
      : '<p>OST Apps couldn’t reach the app storage' + (slug ? ' for <code>/' + esc(slug) + '/</code>' : '') + '. This is on our side, not yours — please try again in a moment.</p>')
    + '<div class="row"><a class="btn" href="' + (slug ? '/' + esc(slug) + '/' : '/') + '">Try again</a><a class="btn ghost" href="/">Browse apps</a></div></section>';
  return htmlResponse(shell({ title: (busy ? 'Busy' : 'Temporarily unavailable') + ' · OST Apps', body }), status, method, { 'cache-control': 'no-store', 'retry-after': busy ? '30' : '15', 'x-robots-tag': 'noindex' });
}

function decodeSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

/* ======================================================================
 * app files
 * ==================================================================== */
async function serveApp(request, env, url, slug, rest) {
  const method = request.method;
  const htmlish = looksLikeHtml(rest);
  const fwd = new Headers({ accept: request.headers.get('accept') || '*/*', 'x-ost-apps': '1' });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) fwd.set('x-forwarded-for', ip);
  let stripped = new Set();
  const inm = request.headers.get('if-none-match');
  if (inm) {
    const mapped = mapIfNoneMatch(inm);
    stripped = mapped.stripped;
    if (mapped.header) fwd.set('if-none-match', mapped.header);
  }
  if (!htmlish) {
    // HTML gets rewritten, so date validators / byte ranges only make sense for other files.
    const ims = request.headers.get('if-modified-since');
    if (ims) fwd.set('if-modified-since', ims);
    const range = request.headers.get('range');
    if (range) fwd.set('range', range);
  }

  const upstreamPath = API_BASE + '/serve/' + encodeURIComponent(slug) + '/' + rest + url.search;
  let res;
  try {
    // HEAD is answered from a GET so it never depends on the API implementing HEAD.
    res = await withTimeout(callApi(env, upstreamPath, { method: 'GET', headers: fwd, redirect: 'manual' }), UPSTREAM_TIMEOUT_MS);
  } catch (e) {
    return wantsDocument(request, rest) ? errorPage(method, 504, slug) : textResponse('Upstream unavailable', 504, method, { 'retry-after': '15' });
  }

  const status = res.status;
  const ctype = (res.headers.get('content-type') || '').toLowerCase();

  // Redirects the API might issue (e.g. directory without slash): map back onto this origin.
  if (status >= 300 && status < 400 && status !== 304) {
    const loc = res.headers.get('location') || '';
    try { res.body && res.body.cancel(); } catch (_) {}
    // Relative Locations (e.g. './guide/' for /docs/guide) resolve against the URL that was actually requested.
    const mapped = mapLocation(loc, slug, 'https://ost-api' + API_BASE + '/serve/' + encodeURIComponent(slug) + '/' + rest);
    if (!mapped) return wantsDocument(request, rest) ? errorPage(method, 502, slug) : textResponse('Bad upstream redirect', 502, method);
    const h = new Headers({ location: mapped, 'cache-control': res.headers.get('cache-control') || 'no-cache' });
    secure(h);
    return new Response(null, { status, headers: h });
  }

  if (status >= 400 && status < 500 && status !== 416) {
    if (ctype.startsWith('text/html')) return finishFile(res, request, slug, stripped); // an app-provided error page
    const info = await res.json().catch(() => null);
    if (!wantsDocument(request, rest)) return textResponse(status === 404 || status === 410 ? 'Not found' : 'Unavailable', status, method, status === 429 ? { 'retry-after': '30' } : null);
    if (status === 429) return errorPage(method, 429, slug);
    const code = String((info && info.error) || '').toLowerCase();
    let reason = 'unknown';
    if (status === 410 || /unpublish|gone/.test(code)) reason = 'gone';
    else if (status === 403 || status === 451 || /block|removed|suspend|banned/.test(code)) reason = 'blocked';
    else if (/file|path|asset/.test(code)) reason = 'file';
    else if (/app|slug/.test(code) || (status === 404 && rest === '')) reason = 'app';
    return notFoundPage(method, { slug, path: rest, reason, status });
  }

  if (status >= 500) {
    try { res.body && res.body.cancel(); } catch (_) {}
    return wantsDocument(request, rest) ? errorPage(method, 502, slug) : textResponse('Upstream error', 502, method, { 'retry-after': '15' });
  }

  return finishFile(res, request, slug, stripped);
}

function mapLocation(loc, slug, base) {
  if (!loc) return '';
  let u;
  try { u = new URL(loc, base || ('https://ost-api' + API_BASE + '/serve/' + slug + '/')); } catch (_) { return ''; }
  const prefix = API_BASE + '/serve/' + slug + '/';
  if (u.pathname === API_BASE + '/serve/' + slug) return '/' + slug + '/' + u.search;
  if (u.pathname.startsWith(prefix)) return '/' + slug + '/' + u.pathname.slice(prefix.length) + u.search;
  return '';
}

function finishFile(res, request, slug, stripped) {
  const method = request.method;
  const h = new Headers(res.headers);
  for (const k of DROP_HEADERS) h.delete(k);
  secure(h);
  const ctype = (h.get('content-type') || '').toLowerCase();
  const isHtml = ctype.startsWith('text/html');

  if (res.status === 304) {
    const et = res.headers.get('etag');
    const m = et && ETAG_RE.exec(et.trim());
    if (m && stripped.has(m[2])) h.set('etag', tagEtag(et));
    return new Response(null, { status: 304, headers: h });
  }

  if (!isHtml || res.status === 206) {
    if (method === 'HEAD') { try { res.body && res.body.cancel(); } catch (_) {} return new Response(null, { status: res.status, headers: h }); }
    return new Response(res.body, { status: res.status, headers: h });
  }

  // HTML: injected, so length/encoding/date validators no longer describe the bytes.
  if (!/charset=/i.test(ctype)) h.set('content-type', 'text/html; charset=utf-8');
  h.delete('content-length');
  h.delete('content-encoding');
  h.delete('last-modified');
  h.delete('content-range');
  h.delete('accept-ranges');
  const et = res.headers.get('etag');
  if (et) { const t = tagEtag(et); if (t) h.set('etag', t); else h.delete('etag'); }
  if (!h.has('cache-control')) h.set('cache-control', 'no-cache');
  if (method === 'HEAD') { try { res.body && res.body.cancel(); } catch (_) {} return new Response(null, { status: res.status, headers: h }); }
  return injectHtml(res, slug, h);
}

/* ======================================================================
 * entry
 * ==================================================================== */
export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return textResponse('Method not allowed. OST Apps serves static files: GET and HEAD only.', 405, method, { allow: 'GET, HEAD' });
    let url;
    try { url = new URL(request.url); } catch (_) { return textResponse('Bad request', 400, method); }
    const route = parsePath(url.pathname, url.search);
    try {
      switch (route.kind) {
        case 'root': return await galleryPage(request, env, url);
        case 'robots': return textResponse('User-agent: *\nAllow: /\n', 200, method, { 'cache-control': 'public, max-age=86400' });
        case 'favicon': { const h = new Headers({ 'cache-control': 'public, max-age=86400' }); secure(h); return new Response(null, { status: 204, headers: h }); }
        case 'redirect': return redirect(route.location, 301);
        case 'notfound': return notFoundPage(method, { slug: route.slug, reason: route.reason, status: 404 });
        case 'app': return await serveApp(request, env, url, route.slug, route.rest);
        default: return notFoundPage(method, { status: 404 });
      }
    } catch (e) {
      return route.kind === 'app' && !wantsDocument(request, route.rest) ? textResponse('Internal error', 500, method) : errorPage(method, 500, route.slug || '');
    }
  },
};
