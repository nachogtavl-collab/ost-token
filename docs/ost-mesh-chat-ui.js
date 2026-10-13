/* ==========================================================================
 * OST Mesh · chat UI (phase 2) — pure HTML builders for every chat surface
 * --------------------------------------------------------------------------
 * BUILD-SPEC §5.2. No DOM access, no globals, no timers, no side effects:
 * each export takes data + a `ctx` and returns an HTML string, so the module
 * is unit-tested in Node and called by ost-mesh-app.js
 * (`import * as CUI from './ost-mesh-chat-ui.js?v=1'`). Styles: ost-mesh-chat.css.
 *
 * ctx (every field optional; the core passes what it has):
 *   icon(id, cls) → svg html          av(opts, size) → `.omx-av` html (core.av; opts {addr, emoji, name, img, online, pending})
 *   tTime(ts) tDay(ts) tShort(ts)      agoText(ts) → "5m ago"        now (ms)
 *   nameOf(addr) contact(addr)         online(addr) typing(addr)     seen(addr) → "Last seen 5m ago"
 *   lastMsg(contact) → the stored message behind contact.last (list: "You:" + ✓ / ✓✓ / clock + kind icon);
 *     findMsg(addr, id) or msgsOf(addr) work too
 *   peer (THE THREAD'S ADDRESS: names the E2E pill and "them" bubbles) · selected (desk list row)
 *   filter 'all'|'unread'|'requests' · query · layout 'phone'|'drawer'|'desk' · network · blobs (S.blobs)
 *   payStatus(m) → { state, text | html, who? }  — the money team's verdict (verifyPay / payStatusHtml), re-presented only
 *   headBtns [html | fn(peer)] · info [{ico,lbl,act} | fn(peer)] · attach [{ico,lbl,sub,tile,act,i}]
 *   unreadFrom (message id) · infoOpen (aria-pressed of (i)) · canProfile (X.views.profile) · canCallBack
 *     (or actions: X.actions) · netbar (the core's .omx-netbar html, placed under the list header; pass '' when
 *     the core renders it elsewhere) · conn (the .omx-conn dot html for the desk list header) · draft · blocked · notifText
 *
 * Hooks the markup carries for the core's onClick / onChange (C7 names kept, new ones marked *):
 *   list:     [data-act=chat][data-a] rows · *[data-act=chat-filter][data-f=all|unread|requests] chips and the
 *             "Message requests" row · *input#omxChatQ[data-act=chat-search] (type=search; repaint only
 *             #omxChatList with chatRowsHtml() so the field keeps focus) · *[data-act=new-chat] (desk header)
 *             · [data-act=accept|decline][data-a] request cards · empty state / pick state buttons are
 *             [data-tab=add] with *data-addtab=invite|add (which Add tab to open)
 *   header:   [data-act=back] (phone/drawer) · [data-act=peer-profile] · *[data-act=peer-info] (desk, aria-pressed)
 *             · [data-act=peer-menu] · plugin headBtns
 *   thread:   .omx-b[data-id] · failed: .omx-b.failed[data-act=retry][role=button] + *button.omx-failbtn[data-act=fail-menu][data-id]
 *             (failedSheet(m, name) gives the sheet) · media: *[data-act=media-open][data-id] (cached photo → X.viewer)
 *             or [data-act=dl][data-id] · documents a.omx-file[data-act=dl] · [data-act=call-back][data-video]
 *   composer: [data-act=attach] (aria-expanded) · textarea#omxText · #omxSend[data-act=send] (.photo + "Send a photo
 *             or video" while empty: sendState(text) gives the class / label to swap on input) · #omxFile · #omxFileAny
 *             · tray #omxAttach[hidden] with [data-act=att-media|att-file|att-loc|att-live|att-x][data-i] + #omxLivePick
 *             [data-act=live-go][data-m] · desk popover rows: attachSheetItems(items) + ATTACH_NOTE · [data-act=unblock]
 *   info pane: *[data-act=info-close] · [data-act=peer-profile] · plugin acts (call-voice / call-video)
 *             · *[data-act=peer-block|peer-remove|peer-clear] (same confirms as the ⋯ menu) · [data-act=unblock]
 *
 * Honesty: ✓ = the hub stored it, ✓✓ = the hub pushed it to their OPEN app
 * (hub `delivered`), never "read" (phase 4 reserves `--omx-tick-read`).
 * ========================================================================== */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
// Text that may already be HTML-escaped (the money team's payStatusHtml output): keep entities, escape the rest.
const escKeep = (s) => String(s == null ? '' : s).replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (v) => (v == null ? '' : String(v));
const has = (ctx, k) => !!(ctx && typeof ctx[k] === 'function');
function call(ctx, k, ...a) { if (!has(ctx, k)) return undefined; try { return ctx[k](...a); } catch (_) { return undefined; } }

/* ---------- small pure helpers ---------- */
export const shortA = (a) => { a = String(a || ''); const m = a.match(/([0-9a-f]{4})$/i); return 'mesh·' + (m ? m[1] : a.slice(-4)); };
export const fmtSize = (n) => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
// Identity colour: the same hash as the core's hue() (h % 360), folded onto the 12 identity tokens.
export function idColor(a) { a = String(a || ''); let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return (h % 360) % 12; }
const firstChar = (s) => { const a = Array.from(String(s || '').trim()); return a.length ? a[0].toUpperCase() : ''; };
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || String(s || '');
const isReq = (st) => st === 'request' || st === 'pending-in';
const lastTs = (c) => (c && c.last && c.last.ts) || (c && c.ts) || 0;

// One icon. Without ctx.icon the sprite reference is written directly (the ids are fixed by ost-mesh-icons.js).
function ic(ctx, id, cls) {
  if (has(ctx, 'icon')) { const h = call(ctx, 'icon', id, cls); return typeof h === 'string' ? h : ''; }
  if (!/^[a-z][a-z0-9-]*$/.test(String(id || ''))) return '';
  return '<svg class="omx-i' + (cls ? ' ' + String(cls).replace(/[^\w -]/g, '') : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + id + '"/></svg>';
}
// A plugin's `ico` may still be an emoji (old plugins): it renders as text, never as a broken sprite.
function icOrText(ctx, ico) {
  const id = String(ico || '');
  const h = /^[a-z][a-z0-9-]*$/.test(id) ? ic(ctx, id) : '';
  return h || (id ? '<b aria-hidden="true">' + esc(id) + '</b>' : '');
}
// The one avatar component (core.av); a faithful local copy keeps the module usable on its own.
function avHtml(ctx, o, size) {
  if (has(ctx, 'av')) { const h = call(ctx, 'av', o, size); if (typeof h === 'string') return h; }
  const emoji = o.emoji ? String(o.emoji) : '';
  const txt = emoji || firstChar(o.name) || 'M';
  return '<span class="omx-av' + (size ? ' ' + size : '') + (emoji ? ' emoji' : '') + (o.pending ? ' pending' : '') + '" style="--av:var(--omx-id-' + idColor(o.addr) + ')" aria-hidden="true">' + esc(txt) + (o.online ? '<i class="on"></i>' : '') + '</span>';
}
function contactOf(ctx, addr, c) { return c || call(ctx, 'contact', addr) || { addr }; }
const peerOf = (ctx) => (ctx && (ctx.peer || ctx.selected)) || '';
const canProfile = (ctx) => !(ctx && (ctx.canProfile === false || ctx.hasProfile === false));
const canCallBack = (ctx) => !!(ctx && (ctx.canCallBack || (ctx.canCallBack !== false && ctx.actions && typeof ctx.actions['call-back'] === 'function')));
// The stored message behind contact.last (its direction / status / kind), from whichever lookup the core passes.
function lastMsgOf(ctx, c) {
  if (!c || !c.last) return null;
  let m = call(ctx, 'lastMsg', c);
  if (!m && c.last.id) m = call(ctx, 'findMsg', c.addr, c.last.id);
  if (!m && c.last.id && has(ctx, 'msgsOf')) { const l = call(ctx, 'msgsOf', c.addr); if (Array.isArray(l)) m = l.find((x) => x && x.id === c.last.id); }
  return m && typeof m === 'object' ? m : null;
}
function nameFor(ctx, addr, c) { c = c || call(ctx, 'contact', addr) || null; return (c && c.name) || str(call(ctx, 'nameOf', addr)) || shortA(addr); }
// Presence dot on friends only (never on yourself); a warning ring while our request is pending.
function peerAv(ctx, addr, c, size, noDot) {
  c = contactOf(ctx, addr, c);
  const online = !noDot && c.state === 'friend' && !!call(ctx, 'online', addr);
  return avHtml(ctx, { addr, emoji: c.emoji || '', name: c.name || '', img: c.img || '', online, pending: c.state === 'pending-out' }, size);
}

/* ---------- emoji-only messages (1–3 emoji, nothing else) ---------- */
// One emoji: a flag (2 regional indicators) · a keycap (digit/#/* + VS16? + U+20E3) · a pictograph with
// optional VS16 / skin tone / tag sequence, joined by ZWJ into one family / profession sequence.
const PIC = '\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*';
const ONE_EMOJI = new RegExp('^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|[0-9#*]\\uFE0F?\\u20E3|' + PIC + '[\\u{E0020}-\\u{E007F}]*(?:\\u200D' + PIC + ')*)', 'u');
export const isEmojiOnly = (text) => {
  let s = String(text == null ? '' : text);
  if (!s.trim() || s.length > 64) return false;
  s = s.replace(/\s+/g, '');
  let n = 0;
  while (s) { const m = ONE_EMOJI.exec(s); if (!m || !m[0]) return false; s = s.slice(m[0].length); if (++n > 3) return false; }
  return n >= 1;
};

/* ---------- message classification ---------- */
const isSys = (m) => !!m && m.dir === 'sys';
const isFailed = (m) => !!m && m.dir === 'me' && m.status === 'failed';
const isText = (m) => !!m && (!m.kind || m.kind === 'text');
export const isMedia = (m) => !!m && m.kind === 'file' && /^(image|video)\//.test(String(m.mime || ''));
// Emoji-only, payment, call, location, media, failed and system rows always stand alone (BUILD-SPEC §5.2).
export const standsAlone = (m) => isSys(m) || isFailed(m) || m.kind === 'pay' || m.kind === 'call' || m.kind === 'loc' || isMedia(m) || (isText(m) && isEmojiOnly(m.text));
// Status ladder, honest to the pipeline: sending/queued → clock · sent (hub stored) → ✓ · delivered (hub pushed to their open app) → ✓✓.
const STATUS = { sending: ['clock', 'sending'], queued: ['clock', 'sending'], sent: ['check', 'sent'], delivered: ['check-double', 'delivered'] };
const statusOf = (m) => (m && m.dir === 'me' && !isFailed(m) && STATUS[m.status]) || null;
const statusKey = (m) => (m && m.dir === 'me' ? str(m.status) : '');
const GROUP_GAP = 10 * 60 * 1000;

/* ---------- grouping ----------
 * → [{ m, g: 'g1'|'gm'|'gl'|'g-solo', day: label|null (set on the first message of a day), divider, meta }]
 * A run = same direction, ≤ 10 min apart, same calendar day (tDay label), no unread divider or system row
 * between, neither stands alone. Meta (time + status) shows on the last of a run and on any bubble whose
 * status differs from the run's last. */
export function groupMessages(list, ctx) {
  list = Array.isArray(list) ? list.filter((m) => m && typeof m === 'object') : [];
  const out = []; let day = null, run = [];
  const close = () => {
    if (!run.length) return;
    if (run.length === 1) run[0].g = 'g-solo';
    else run.forEach((e, i) => { e.g = i === 0 ? 'g1' : i === run.length - 1 ? 'gl' : 'gm'; });
    const last = run[run.length - 1], lk = statusKey(last.m);
    run.forEach((e) => { e.meta = !isSys(e.m) && !isFailed(e.m) && e.m.kind !== 'call' && (e === last || statusKey(e.m) !== lk); });
    run = [];
  };
  list.forEach((m, i) => {
    const d = str(call(ctx, 'tDay', m.ts));
    const newDay = i === 0 || d !== day;
    if (newDay) day = d;
    const divider = !!(ctx && ctx.unreadFrom && m.id === ctx.unreadFrom);
    const e = { m, g: 'g-solo', day: newDay ? d : null, divider, meta: true };
    const prev = run.length ? run[run.length - 1].m : null;
    const joins = !!prev && !newDay && !divider && !standsAlone(m) && !standsAlone(prev) && prev.dir === m.dir &&
      Math.abs((Number(m.ts) || 0) - (Number(prev.ts) || 0)) <= GROUP_GAP;
    if (!joins) close();
    run.push(e); out.push(e);
    if (standsAlone(m)) close();
  });
  close();
  return out;
}

/* ---------- one bubble, every kind ---------- */
// Links in a text bubble open in a new tab and are never fetched (no previews in phase 2).
const linkify = (escaped) => escaped.replace(/(https?:\/\/[^\s<]+)/g, (u) => '<a class="omx-link" href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
const callSt = (m) => m.cst || (['missed', 'declined', 'ended', 'busy'].includes(m.status) ? m.status : 'ended');
function callTitle(m) {
  const cs = callSt(m), K = m.video ? 'Video' : 'Voice';
  if (cs === 'missed') return m.dir === 'me' ? K + ' call · No answer' : 'Missed ' + K.toLowerCase() + ' call';
  if (cs === 'declined') return K + ' call · Declined';
  if (cs === 'busy') return K + ' call · Busy';
  return K + ' call';
}
const durText = (s) => { s = Math.round(Number(s) || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// Pay status: the money team decides (verifyPay / payStatusHtml); this only maps their state to an icon + colour.
const PAY_ST = { confirmed: ['check-circle', '', 'is-on'], unverified: ['alert', 'wait', ''], failed: ['x-circle', 'fail', ''], pending: ['clock', 'wait', ''] };
const FALLBACK_PAY_TEXT = { confirmed: 'Confirmed on-chain', unverified: 'Not verified', failed: 'Transaction failed', pending: 'Not confirmed yet' };
function payStatusOf(m, ctx) {
  const r = has(ctx, 'payStatus') ? call(ctx, 'payStatus', m) : null;
  const state = String((r && r.state) != null ? r.state : (r ? '' : m.verified || ''));
  if (!PAY_ST[state]) return { state: '', html: 'Checking the chain…', who: r && r.who };
  // Drop the leading ✅ / ⚠ / ❌ / ⏳ glyph (an icon replaces it); never shorten or reword the reason.
  let html = r && r.html != null ? String(r.html) : r && r.text != null ? escKeep(r.text) : FALLBACK_PAY_TEXT[state];
  html = html.replace(/^[\s✅⚠❌⏳…️]+/u, '');
  if (!html) html = FALLBACK_PAY_TEXT[state];
  html = html.charAt(0).toUpperCase() + html.slice(1);
  return { state, html, who: r && r.who };
}
// Tile map (the same 3×3 OpenStreetMap tiles as phase 1), centred on the point in a responsive 16:10 box.
export function mapHtml(lat, lng, ctx) {
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '<div class="omx-map"></div>';
  const z = 15, n = Math.pow(2, z), x = (lng + 180) / 360 * n, r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const tx = Math.floor(x), ty = Math.floor(y), px = Math.round((x - tx) * 256), py = Math.round((y - ty) * 256);
  let tiles = '';
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles += '<img alt="" loading="lazy" src="https://tile.openstreetmap.org/' + z + '/' + (tx + dx) + '/' + (ty + dy) + '.png" style="left:' + ((dx + 1) * 256) + 'px;top:' + ((dy + 1) * 256) + 'px">';
  return '<div class="omx-map"><div class="omx-tiles" style="margin-left:-' + (256 + px) + 'px;margin-top:-' + (256 + py) + 'px">' + tiles + '</div><span class="omx-pin">' + ic(ctx, 'pin', 'is-on') + '</span><small>© OpenStreetMap</small></div>';
}

export function bubbleHtml(entry, ctx) {
  ctx = ctx || {};
  const e = entry && entry.m ? entry : { m: entry || {}, g: 'g-solo', meta: true };
  const m = e.m || {};
  const id = esc(m.id);
  if (isSys(m)) return '<div class="omx-b sys"' + (m.id ? ' data-id="' + id + '"' : '') + '>' + esc(m.text) + '</div>';
  const me = m.dir === 'me', failed = isFailed(m), st = statusOf(m);
  const time = str(call(ctx, 'tTime', m.ts));
  const who = me ? 'You' : peerOf(ctx) ? nameFor(ctx, peerOf(ctx)) : 'Them';
  const named = esc(who) + (time ? ', ' + esc(time) : '') + (st ? ', ' + st[1] : '');
  const sr = '<span class="omx-sr">' + named + ': </span>';
  const meta = e.meta !== false && !failed ? '<span class="omx-t" aria-hidden="true">' + esc(time) + (st ? ic(ctx, st[0]) : '') + '</span>' : '';
  const hover = e.meta === false && !failed && time ? '<span class="omx-th" aria-hidden="true">' + esc(time) + '</span>' : '';
  let cls = 'omx-b ' + (me ? 'me' : 'them') + ' ' + (e.g || 'g-solo'), attrs = '', inner = '', plain = '';
  const blobs = ctx.blobs || {};
  const mime = String(m.mime || '');
  const isImg = /^image\//.test(mime), isVid = /^video\//.test(mime), isAud = /^audio\//.test(mime);
  const cached = m.kind === 'file' ? (blobs[m.blob] || blobs['local:' + m.id] || null) : null;
  const unsent = me && (failed || m.status === 'sending');
  const prog = m.kind === 'file' && m.status === 'sending' ? '<div class="omx-prog ind" role="progressbar" aria-label="Uploading"><i></i></div>' : '';   // honest: no fake percentage
  switch (m.kind) {
    case 'pay': {
      cls += ' pay';
      const ps = payStatusOf(m, ctx), look = PAY_ST[ps.state] || ['loader', 'muted', ''];
      const net = str(ctx.network || 'devnet');
      const said = ps.who || (me ? 'You sent' : ps.state === 'confirmed' ? 'You received' : 'Payment claim');
      plain = said + ' ' + m.amount + ' ' + (m.ccy || 'OST');
      inner = '<div class="omx-payc"><span class="top">' + ic(ctx, 'coin') + 'Payment<span class="omx-devnet">' + esc(net.toUpperCase()) + '</span></span>' +
        '<span class="amt">' + esc(m.amount) + ' ' + esc(m.ccy || 'OST') + '</span>' +
        '<span class="note">' + esc(said) + (m.note ? ' · ' + esc(m.note) : '') + '</span>' +
        '<span class="st' + (look[1] ? ' ' + look[1] : '') + '">' + ic(ctx, look[0], look[2]) + '<span>' + ps.html + '</span></span>' +
        // while the chat notice is undelivered a tap on the card retries it, so the explorer link waits for delivery
        (m.sig && !failed ? '<a class="tx" href="https://explorer.solana.com/tx/' + esc(m.sig) + (net === 'mainnet-beta' ? '' : '?cluster=' + esc(net)) + '" target="_blank" rel="noopener"><span>View transaction</span>' + ic(ctx, 'external') + '</a>' : '') +
        '</div>' + (failed ? '' : sr) + meta;
      break;
    }
    case 'call': {
      cls += ' call' + (callSt(m) === 'missed' ? ' missed' : '');
      const title = callTitle(m);
      plain = title;
      inner = '<span class="tile">' + ic(ctx, m.video ? 'video' : 'phone') + '</span><span><b>' + esc(title) + '</b><small>' + esc(time) + (m.dur ? ' · ' + durText(m.dur) : '') + '</small></span>' +
        (canCallBack(ctx) && !failed ? '<button type="button" class="omx-ghost" data-act="call-back" data-video="' + (m.video ? 1 : 0) + '">' + ic(ctx, m.video ? 'video' : 'phone') + (me ? 'Call again' : 'Call back') + '</button>' : '');
      break;
    }
    case 'loc': {
      cls += ' loc';
      const now = Number(ctx.now) || Date.now();
      const live = !!(m.live && !m.ended && (!m.until || m.until > now));
      const title = m.live ? (live ? 'Live location' : 'Live location ended') : 'Location';
      const lat = Number(m.lat), lng = Number(m.lng);
      const ago = m.live && m.upd ? str(call(ctx, 'agoText', m.upd)) : '';
      const until = live && m.until ? str(call(ctx, 'tTime', m.until)) : '';
      plain = title;
      // a failed bubble is itself the Retry button: its map and Maps pill are not links until it is delivered
      inner = (failed ? '<div class="omx-locc">' + mapHtml(lat, lng, ctx) + '</div>' : '<a class="omx-locc" href="https://www.openstreetmap.org/?mlat=' + lat + '&amp;mlon=' + lng + '#map=16/' + lat + '/' + lng + '" target="_blank" rel="noopener" aria-label="' + esc(title) + ' on OpenStreetMap">' + mapHtml(lat, lng, ctx) + '</a>') +
        '<div class="omx-loct"><span><b>' + ic(ctx, m.live ? 'live' : 'pin') + esc(title) + '</b><small>±' + (m.acc ? Math.round(m.acc) : '?') + ' m' + (ago ? ' · updated ' + esc(ago) : '') + (until ? ' · until ' + esc(until) : '') + '</small></span>' +
        (failed ? '' : '<a href="https://www.google.com/maps/search/?api=1&amp;query=' + lat + ',' + lng + '" target="_blank" rel="noopener">Open in Maps' + ic(ctx, 'external') + '</a>') + '</div>' + (failed ? '' : sr) + meta;
      break;
    }
    case 'file': {
      if (isImg || isVid) {
        // The picture IS the bubble (no file card); meta on a dark chip.
        cls += ' media' + (isVid ? ' vid' : '');
        let pic;
        if (cached && isImg) pic = '<img src="' + esc(cached.url) + '" alt="">';
        else if (cached && isVid) pic = '<video src="' + esc(cached.url) + '" controls playsinline preload="metadata"></video>';
        else if (m.thumb && isImg) pic = '<img class="blur" src="' + esc(m.thumb) + '" alt="">';
        else pic = '<span class="omx-mph">' + ic(ctx, isVid ? 'film' : 'image') + '</span>';
        const kind = isVid ? 'Video' : 'Photo';
        plain = kind;
        const hint = !cached && !unsent ? '<span class="omx-mdl">' + ic(ctx, 'download') + esc(fmtSize(m.size)) + '</span>' : '';
        if (!failed) {
          if (cached && isImg) attrs = ' role="button" tabindex="0" data-act="media-open" aria-label="' + kind + ', ' + named + '"';
          else if (!cached && !unsent) attrs = ' role="button" tabindex="0" data-act="dl" aria-label="' + kind + ', ' + named + ', ' + esc(fmtSize(m.size)) + ', tap to download"';
        }
        // A button bubble carries its own name; otherwise (sending, a playing video) the hidden prefix names it.
        inner = (!attrs && !failed ? sr : '') + pic + hint + prog + meta;
        break;
      }
      const ficon = isAud ? 'music' : /pdf|text|word|document|sheet|presentation/.test(mime) ? 'file-text' : 'file';
      const hint = failed ? '' : unsent && !m.blob ? ' · encrypting & uploading…' : cached ? ' · tap to save' : unsent ? '' : ' · tap to download';
      const row = '<span class="tile">' + ic(ctx, ficon) + '</span><span><b>' + esc(m.name || 'file') + '</b><small>' + esc(fmtSize(m.size)) + esc(hint) + '</small></span>';
      plain = 'File ' + (m.name || '');
      if (cached && isAud) inner += '<audio src="' + esc(cached.url) + '" controls></audio>';
      inner += failed ? '<div class="omx-file">' + row + '</div>' : cached ? '<a class="omx-file" href="' + esc(cached.url) + '" download="' + esc(m.name || 'file') + '">' + row + '</a>' : unsent ? '<div class="omx-file">' + row + '</div>' : '<a class="omx-file" href="#" data-act="dl" data-id="' + id + '">' + row + '</a>';
      inner = (failed ? '' : sr) + inner + prog + meta;
      cls += ' doc';
      break;
    }
    case 'text': case undefined: case null: case '': {
      const t = str(m.text);
      plain = t;
      if (isEmojiOnly(t) && !failed) { cls += ' emoji'; inner = (failed ? '' : sr) + esc(t.trim()) + meta; }
      else inner = (failed ? esc(t) : sr + linkify(esc(t))) + hover + meta;
      break;
    }
    default:   // a newer OST sent something this build cannot show
      plain = 'Unsupported message';
      inner = (failed ? '' : sr) + '<i class="omx-unsup">Unsupported message — update OST</i>' + hover + meta;
  }
  if (failed) {
    // iMessage pattern: (!) opens the failed sheet; the bubble itself still retries on tap / Enter / Space (phase 1).
    const label = 'Not delivered: ' + plain.slice(0, 140) + '. Tap to retry';
    return '<div class="omx-brow"><button type="button" class="omx-failbtn" data-act="fail-menu" data-id="' + id + '" aria-label="Not delivered: options" aria-haspopup="menu">' + ic(ctx, 'alert', 'is-on') + '</button>' +
      '<div class="' + cls + ' failed" data-id="' + id + '" data-act="retry" role="button" tabindex="0" title="' + esc(m.err || 'Not delivered') + '" aria-label="' + esc(label) + '">' + inner + '</div></div>' +
      '<span class="omx-fcap" aria-hidden="true">Not delivered · Tap to retry</span>';
  }
  return '<div class="' + cls + '" data-id="' + id + '"' + attrs + '>' + inner + '</div>';
}

/* ---------- the thread: E2E pill, day blocks, grouped bubbles, unread divider ---------- */
export function threadHtml(list, ctx) {
  ctx = ctx || {};
  list = Array.isArray(list) ? list : [];
  const peer = peerOf(ctx);
  const c = contactOf(ctx, peer);
  const name = peer ? nameFor(ctx, peer, c) : '';
  let h = '<div class="omx-b sys e2e">' + ic(ctx, 'lock') + '<span>' + (name ? 'Messages with ' + esc(firstName(name)) + ' are' : 'Messages in this chat are') + ' end-to-end encrypted. Only the two of you can read them.</span></div>';
  if (!list.length) h += '<div class="omx-b sys">' + (c.state === 'pending-out' ? 'You can write now; ' + esc(name) + ' sees it as soon as they open OST.' : 'No messages yet. Say hi!') + '</div>';
  const entries = groupMessages(list, ctx);
  let open = false;
  entries.forEach((e, i) => {
    if (e.day !== null) {
      if (open) h += '</section>';
      h += '<section class="omx-dayblock"' + (e.day ? ' aria-label="' + esc(e.day) + '"' : '') + '>' + (e.day ? '<h3 class="omx-day">' + esc(e.day) + '</h3>' : '');
      open = true;
    }
    if (e.divider) {
      const n = entries.slice(i).filter((x) => x.m.dir === 'them').length;
      h += '<div class="omx-unreaddiv" role="separator">' + (n > 0 ? n + (n === 1 ? ' new message' : ' new messages') : 'New messages') + '</div>';
    }
    h += bubbleHtml(e, ctx);
  });
  if (open) h += '</section>';
  return h;
}

// A them-bubble with three dots, rendered only while someone types (no reserved strip).
export function typingHtml(name) {
  return '<div class="omx-typing" role="status"><i></i><i></i><i></i><span class="omx-sr">' + esc(name || 'Someone') + ' is typing</span></div>';
}

/* ---------- chats list ---------- */
function kindIcon(k) {
  if (!k) return '';
  if (k.kind === 'file') return /^image\//.test(String(k.mime || '')) ? 'image' : /^video\//.test(String(k.mime || '')) ? 'film' : 'paperclip';
  if (k.kind === 'loc') return k.live ? 'live' : 'pin';
  if (k.kind === 'pay') return 'coin';
  if (k.kind === 'call') return k.video ? 'video' : 'phone';
  return '';
}
const LEAD_GLYPH = /^\s*(?:\p{Extended_Pictographic}️?\s*)+/u;
function previewText(last, lm) {
  const k = lm && lm.kind && lm.kind !== 'text' ? lm : last && last.kind && last.kind !== 'text' ? last : null;
  if (lm && k === lm) {
    if (lm.kind === 'file') return isMedia(lm) ? (/^video\//.test(String(lm.mime)) ? 'Video' : 'Photo') : str(lm.name || 'File');
    if (lm.kind === 'loc') return lm.live ? 'Live location' : 'Location';
    if (lm.kind === 'pay') return (lm.dir === 'me' ? 'Sent ' : 'Payment · ') + lm.amount + ' ' + (lm.ccy || 'OST') + (lm.note ? ' · ' + lm.note : '');
    if (lm.kind === 'call') return callTitle(lm);
    return 'Unsupported message';
  }
  const t = str(last && last.text);
  return k ? (t.replace(LEAD_GLYPH, '') || t) : t;
}
export function chatRowHtml(c, ctx) {
  ctx = ctx || {};
  c = c || {};
  const a = c.addr, name = nameFor(ctx, a, c), last = c.last || null;
  const lm = lastMsgOf(ctx, c);
  const unread = c.state !== 'blocked' && c.unread > 0 ? Number(c.unread) : 0;
  let pv;
  if (call(ctx, 'typing', a)) pv = '<span class="pv typing"><span>typing…</span></span>';
  else if (last && (last.fail || (lm && isFailed(lm)))) pv = '<span class="pv fail">' + ic(ctx, 'alert') + '<span>Not delivered · ' + esc(previewText(last, lm)) + '</span></span>';
  else if (!last) pv = '<span class="pv">' + (c.state === 'pending-out' ? ic(ctx, 'clock') + '<span>Request sent · you can already write</span>' : '<span>No messages yet</span>') + '</span>';
  else {
    const src = lm || last, mine = src.dir === 'me', st = mine ? STATUS[src.status] : null, k = kindIcon(lm || last);
    pv = '<span class="pv">' + (mine ? '<span class="you">You:</span>' : '') + (st ? ic(ctx, st[0]) + '<span class="omx-sr">' + st[1] + '</span>' : '') + (k ? ic(ctx, k) : '') + '<span>' + esc(previewText(last, lm)) + '</span></span>';
  }
  const tm = str(call(ctx, 'tShort', lastTs(c)));
  return '<button type="button" class="omx-item' + (unread ? ' unread' : '') + '" data-act="chat" data-a="' + esc(a) + '"' + (ctx.selected && ctx.selected === a ? ' aria-current="true"' : '') + '>' +
    peerAv(ctx, a, c, 'lg') + '<span class="omx-main"><span class="nm">' + esc(name) + '</span><span class="tm">' + esc(tm) + '</span>' + pv +
    '<span class="rt">' + (unread ? '<span class="omx-unread" aria-label="' + unread + ' unread">' + (unread > 99 ? '99+' : unread) + '</span>' : '') + '</span></span></button>';
}
// A pending request (Add view and the Requests chip): Decline ✕ · Accept. data-act / data-a are phase-1 hooks.
export function requestCardHtml(c, ctx) {
  const name = nameFor(ctx, c.addr, c);
  return '<div class="omx-req">' + peerAv(ctx, c.addr, c, '', true) + '<span class="t"><b>' + esc(name) + '</b><small>' + (c.state === 'request' ? 'Messaged you' : 'Wants to connect') + ' · ' + esc(shortA(c.addr)) + '</small></span>' +
    '<span class="acts"><button type="button" class="omx-ib outline" data-act="decline" data-a="' + esc(c.addr) + '" aria-label="Decline ' + esc(name) + '">' + ic(ctx, 'close') + '</button><button type="button" class="omx-primary omx-sm omx-hit" data-act="accept" data-a="' + esc(c.addr) + '">Accept</button></span></div>';
}
const asList = (contacts) => (Array.isArray(contacts) ? contacts : Object.values(contacts || {})).filter((c) => c && c.addr);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
function splitContacts(contacts) {
  const all = asList(contacts);
  return {
    all,
    reqs: all.filter((c) => isReq(c.state)).sort((a, b) => (b.ts || 0) - (a.ts || 0)),
    chats: all.filter((c) => c.state !== 'blocked' && !isReq(c.state)).sort((a, b) => lastTs(b) - lastTs(a))
  };
}
// Rows only (for an in-place repaint of #omxChatList while the search field keeps focus).
export function chatRowsHtml(contacts, ctx) {
  ctx = ctx || {};
  const { chats } = splitContacts(contacts);
  const q = norm(ctx.query);
  const rows = chats.filter((c) => (ctx.filter !== 'unread' || c.unread > 0) && (!q || norm(nameFor(ctx, c.addr, c)).includes(q) || norm(c.addr).includes(q)));
  if (!rows.length) return '<p class="omx-lempty">' + (q ? 'No chats match “' + esc(ctx.query) + '”' : ctx.filter === 'unread' ? 'No unread chats' : 'No chats yet') + '</p>';
  return rows.map((c) => chatRowHtml(c, ctx)).join('');
}
export function chatsListHtml(contacts, ctx) {
  ctx = ctx || {};
  const { all, reqs, chats } = splitContacts(contacts);
  const filter = ['unread', 'requests'].includes(ctx.filter) ? ctx.filter : 'all';
  const desk = ctx.layout === 'desk';
  let h = desk ? '<div class="omx-lhead"><h2>Chats' + (ctx.conn || '') + '</h2><button type="button" class="omx-ib md" data-act="new-chat" aria-label="New chat" aria-haspopup="menu">' + ic(ctx, 'edit') + '</button></div>' : '';
  h += ctx.netbar || '';
  if (!all.filter((c) => c.state !== 'blocked').length) return h + emptyChatsHtml(ctx);
  const nUnread = chats.filter((c) => c.unread > 0).length;
  const chip = (f, lbl, n) => '<button type="button" class="omx-chip omx-hit" role="tab" data-act="chat-filter" data-f="' + f + '" aria-selected="' + (filter === f) + '" tabindex="' + (filter === f ? 0 : -1) + '">' + lbl + (n ? ' <b>' + n + '</b>' : '') + '</button>';
  h += '<div class="omx-lsearch"><label class="omx-search">' + ic(ctx, 'search') + '<input type="search" id="omxChatQ" data-act="chat-search" placeholder="Search chats" aria-label="Search chats" value="' + esc(ctx.query || '') + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label></div>';
  h += '<div class="omx-chips" role="tablist" aria-label="Filter chats">' + chip('all', 'All', 0) + chip('unread', 'Unread', nUnread) + chip('requests', 'Requests', reqs.length) + '</div>';
  if (filter === 'requests') {
    h += reqs.length ? '<div class="omx-reqlist">' + reqs.map((c) => requestCardHtml(c, ctx)).join('') + '</div>' : '<p class="omx-lempty">No message requests</p>';
    return h;
  }
  if (reqs.length) {
    const nm = reqs.map((c) => nameFor(ctx, c.addr, c));
    const who = nm.length === 1 ? nm[0] + ' wants to connect' : nm.length === 2 ? nm[0] + ' and ' + nm[1] + ' want to connect' : nm[0] + ' and ' + (nm.length - 1) + ' others want to connect';
    h += '<button type="button" class="omx-reqrow" data-act="chat-filter" data-f="requests"><span class="ic">' + ic(ctx, 'user-plus') + '</span><span><b>Message requests</b><small>' + esc(who) + '</small></span><span class="rt"><span class="omx-unread" aria-label="' + reqs.length + (reqs.length === 1 ? ' request' : ' requests') + '">' + reqs.length + '</span>' + ic(ctx, 'chevron-right') + '</span></button>';
  }
  h += '<div class="omx-list" id="omxChatList">' + chatRowsHtml(contacts, Object.assign({}, ctx, { filter })) + '</div>';
  return h;
}
// One action, one secondary text button (BUILD-SPEC §10.1). data-addtab tells the Add view which tab to open.
export function emptyChatsHtml(ctx) {
  return '<div class="omx-empty"><span class="ic">' + ic(ctx, 'chat') + '</span><h3>No chats yet</h3><p>Chats are end-to-end encrypted. Share your invite so a friend can add you in one tap.</p>' +
    '<button type="button" class="omx-primary" data-tab="add" data-addtab="invite">' + ic(ctx, 'share') + 'Share your invite</button><button type="button" class="omx-textbtn" data-tab="add" data-addtab="add">I have a link or code</button></div>';
}
// Desk Chats with nothing selected: the thread pane explains itself.
export function pickHtml(ctx) {
  return '<div class="omx-pick"><div class="omx-empty"><span class="ic">' + ic(ctx, 'chat') + '</span><h3>Your messages</h3><p>Pick a chat on the left, or add someone with their invite link or QR code.</p>' +
    '<button type="button" class="omx-primary" data-tab="add" data-addtab="add">' + ic(ctx, 'user-plus') + 'Add a person</button></div></div>';
}

/* ---------- thread header ---------- */
export function threadHeadHtml(peer, ctx) {
  ctx = ctx || {};
  const c = contactOf(ctx, peer);
  const desk = ctx.layout === 'desk';
  const name = nameFor(ctx, peer, c);
  const typing = !!call(ctx, 'typing', peer);
  const on = !!call(ctx, 'online', peer);
  const pres = typing ? '<span class="typing">typing…</span>' : on ? '<span class="on">Online</span>' : esc(str(call(ctx, 'seen', peer)) || 'Offline');
  const state = c.state === 'friend' ? ic(ctx, 'lock') + 'encrypted' : c.state === 'pending-out' ? ic(ctx, 'clock') + 'request sent' : c.state === 'blocked' ? ic(ctx, 'ban') + 'blocked' : 'not accepted yet';
  const inner = peerAv(ctx, peer, c, desk ? '' : 'sm') + '<span class="t"><b>' + esc(name) + '</b><small>' + pres + ' · ' + state + '</small></span>';
  const who = !canProfile(ctx) ? '<span class="omx-peerbtn">' + inner + '</span>' : '<button type="button" class="omx-peerbtn" data-act="peer-profile" title="View profile">' + inner + '</button>';
  const md = desk ? ' md' : '';
  const extra = (Array.isArray(ctx.headBtns) ? ctx.headBtns : []).map((b) => { try { return typeof b === 'function' ? str(b(peer)) : str(b); } catch (_) { return ''; } }).join('');
  return (desk ? '' : '<button type="button" class="omx-ib" data-act="back" aria-label="Back to chats">' + ic(ctx, 'back') + '</button>') +
    '<h2 id="omxTitle" class="omx-ttl">' + who + '</h2>' + extra +
    (desk ? '<button type="button" class="omx-ib md" data-act="peer-info" aria-label="Contact info" aria-pressed="' + !!ctx.infoOpen + '">' + ic(ctx, 'info', ctx.infoOpen ? 'is-on' : '') + '</button>' : '') +
    '<button type="button" class="omx-ib' + md + '" data-act="peer-menu" aria-label="Chat options" aria-haspopup="menu">' + ic(ctx, 'more') + '</button>';
}

/* ---------- composer + attach ---------- */
// While the field is empty the right button sends a photo; once there is text it is Send (the core swaps the class).
export const sendState = (text) => { const photo = !String(text == null ? '' : text).trim(); return { photo, cls: photo ? 'omx-send photo' : 'omx-send', label: photo ? 'Send a photo or video' : 'Send' }; };
export function blockedHtml(ctx) {
  return '<div class="omx-blocked"><span>' + ic(ctx, 'ban') + 'You blocked this contact.</span><button type="button" class="omx-ghost" data-act="unblock">Unblock</button></div>';
}
export function composerHtml(ctx) {
  ctx = ctx || {};
  if (ctx.blocked) return blockedHtml(ctx);
  const draft = str(ctx.draft), s = sendState(draft);
  return '<div class="omx-compose"><div class="omx-compose-in">' +
    '<button type="button" class="omx-ib filled attach" data-act="attach" aria-label="Attach" aria-expanded="false">' + ic(ctx, 'plus') + '</button>' +
    '<input type="file" id="omxFile" hidden multiple accept="image/*,video/*"><input type="file" id="omxFileAny" hidden multiple>' +
    '<div class="omx-fieldpill"><textarea id="omxText" rows="1" placeholder="Message" enterkeyhint="send" aria-label="Message">' + esc(draft) + '</textarea></div>' +
    '<button type="button" class="' + s.cls + '" id="omxSend" data-act="send" aria-label="' + s.label + '">' + ic(ctx, 'image', 'pho') + ic(ctx, 'send', 'snd') + '</button>' +
    '</div></div>';
}
export const ATTACH = [
  { act: 'att-media', ico: 'image', lbl: 'Photo or video', sub: 'Up to 6 MB, encrypted', tile: 7 },
  { act: 'att-file', ico: 'file', lbl: 'File', sub: 'Any document, up to 6 MB', tile: 9 },
  { act: 'att-loc', ico: 'pin', lbl: 'Location', sub: 'Your position once', tile: 4 },
  { act: 'att-live', ico: 'live', lbl: 'Live location', sub: '15 min, 1 hour or 8 hours', tile: 5 }
];
export const ATTACH_NOTE = 'Encrypted on this device before it leaves';
// The four core items + plugin items (X.attach: {ico, lbl, sub, tile, run}) as {act, i, ico, lbl, sub, tile}.
export function attachItems(extra) {
  return ATTACH.concat((Array.isArray(extra) ? extra : []).map((x, i) => (x && x.act ? x : { act: 'att-x', i, ico: x && x.ico, lbl: x && x.lbl, sub: (x && x.sub) || '', tile: x && x.tile != null ? x.tile : 8 })));
}
const tileN = (t) => { const n = Math.round(Number(t)); return Number.isFinite(n) && n >= 0 && n <= 11 ? n : 8; };
// Desk popover rows for core.actionSheet({anchor, items}): value 'att-media' … or 'att-x:<i>'.
export function attachSheetItems(items) {
  return (items && items.length ? items : ATTACH).map((x) => ({ label: str(x.lbl), sub: str(x.sub), ico: x.ico, tile: tileN(x.tile), value: x.act === 'att-x' ? 'att-x:' + x.i : x.act }));
}
// Phone tray: coloured 56 px tiles above the composer + the encryption note; the live-location duration picker
// (#omxLivePick, phase-1 live-go buttons) follows it as a second step and hides with it (CSS: #omxAttach[hidden] + …).
export function attachTrayHtml(items, ctx) {
  items = items && items.length ? items : ctx && Array.isArray(ctx.attach) && ctx.attach.length && ctx.attach[0].act ? ctx.attach : attachItems(ctx && ctx.attach);
  return '<div class="omx-attach" id="omxAttach" role="group" aria-label="Attach" hidden>' +
    items.map((x) => '<button type="button" data-act="' + esc(x.act) + '"' + (x.i != null ? ' data-i="' + esc(x.i) + '"' : '') + '><span class="tile" style="--tile:var(--omx-id-' + tileN(x.tile) + ')">' + icOrText(ctx, x.ico) + '</span>' + esc(x.lbl) + '</button>').join('') +
    '<p class="omx-traynote">' + ic(ctx, 'lock') + ATTACH_NOTE + '</p></div>' +
    '<div class="omx-livepick" id="omxLivePick" role="group" aria-label="Share live location for" hidden><span>Share live location for</span><button type="button" data-act="live-go" data-m="15">15 min</button><button type="button" data-act="live-go" data-m="60">1 hour</button><button type="button" data-act="live-go" data-m="480">8 hours</button></div>';
}

/* ---------- contact-info pane (desk; phones use the ⋯ sheet) ---------- */
export function infoPaneHtml(peer, ctx) {
  ctx = ctx || {};
  const c = contactOf(ctx, peer);
  const name = nameFor(ctx, peer, c), first = firstName(name);
  const on = c.state === 'friend' && !!call(ctx, 'online', peer);
  const pres = on ? 'Online' : c.state === 'pending-out' ? 'Request sent' : c.state === 'blocked' ? 'Blocked' : str(call(ctx, 'seen', peer)) || 'Offline';
  const extra = [];
  (Array.isArray(ctx.info) ? ctx.info : []).forEach((x) => { try { const r = typeof x === 'function' ? x(peer) : x; (Array.isArray(r) ? r : [r]).forEach((y) => { if (y && y.act && y.lbl && !extra.some((z) => z.act === y.act)) extra.push(y); }); } catch (_) {} });
  // Profile leads (unless the core already listed it, or there is no profile view)
  const acts = (canProfile(ctx) && !extra.some((y) => y.act === 'peer-profile') ? [{ ico: 'user', lbl: 'Profile', act: 'peer-profile' }] : []).concat(extra);
  const blocked = c.state === 'blocked';
  return '<div class="ih"><h2>Contact info</h2><button type="button" class="omx-ib md" data-act="info-close" aria-label="Close contact info">' + ic(ctx, 'close') + '</button></div>' +
    '<div class="who">' + peerAv(ctx, peer, c, 'xl') + '<b>' + esc(name) + '</b><small>' + esc(shortA(peer)) + ' · ' + esc(pres) + '</small></div>' +
    (acts.length ? '<div class="acts">' + acts.map((x) => '<button type="button" data-act="' + esc(x.act) + '">' + icOrText(ctx, x.ico) + esc(x.lbl) + '</button>').join('') + '</div>' : '') +
    '<div class="sec"><h3>Safety code</h3><div class="code">' + (c.fp ? esc(c.fp) : 'Not available yet') + '</div><p>Compare it with ' + esc(first) + ' in person or on a call. If it matches, nobody is in the middle.</p></div>' +
    '<div class="sec"><h3>Notifications</h3><p>' + esc(ctx.notifText || 'Message alerts follow your notification setting in Settings.') + '</p></div>' +
    '<div class="sec danger">' +
    (blocked ? '<button type="button" class="plain" data-act="unblock">' + ic(ctx, 'user-check') + 'Unblock ' + esc(first) + '</button>' : '<button type="button" data-act="peer-block">' + ic(ctx, 'ban') + 'Block ' + esc(first) + '</button>') +
    '<button type="button" data-act="peer-remove">' + ic(ctx, 'user-x') + 'Remove contact</button>' +
    '<button type="button" data-act="peer-clear">' + ic(ctx, 'trash') + 'Clear chat on this device</button></div>';
}

/* ---------- the failed-message sheet (core.actionSheet({title, body, items})) ---------- */
// values: 'retry' → retryMsg · 'copy' → copyText(m.text) · 'delete' → drop the message + outboxDel(id)
export function failedSheetItems(m, peerName) {
  return [
    { label: 'Try again now', ico: 'refresh', value: 'retry' },
    m && isText(m) && m.text ? { label: 'Copy text', ico: 'copy', value: 'copy' } : null,
    { label: 'Delete from this device', sub: 'It was never delivered, so ' + (firstName(peerName) || 'they') + ' never sees it', ico: 'trash', danger: true, value: 'delete' }
  ].filter(Boolean);
}
export function failedSheet(m, peerName) {
  const t = m && isText(m) && m.text ? '“' + (m.text.length > 60 ? m.text.slice(0, 57) + '…' : m.text) + '”' : 'This message';
  return { title: 'Not delivered', body: t + ' is saved on this device and retries automatically when the hub can be reached.', items: failedSheetItems(m, peerName) };
}
