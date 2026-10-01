/* workers/ost-api/src/mesh/social.js
 * OST Social — public layer of the mesh, installed on the MeshHub Durable Object.
 *
 * Every write is signed by the author's mesh key (verifyMeshAuth, OST-MESH|v1).
 * Media are PUBLIC (posts, stories, avatars): stored as 512 KB chunks in DO
 * storage, served with HTTP Range so iOS/Android video players can stream.
 * Tips are REAL devnet transfers: the browser sends OST/OSTG/SOL to the author's
 * wallet with memo "ost-tip:<postId>"; this module re-reads the transaction from
 * the chain and only then credits the post (idempotent by signature).
 * A wallet is linked to a mesh profile only with an ed25519 signature from that
 * wallet, so tips can never be redirected by editing a profile.
 *
 * Storage keys
 *   smeta:<id> / smedia:<id>:<nnn>     media meta / chunks
 *   squota:<addr>:<day>                bytes uploaded per day
 *   post:<rev16>:<id>                  post record (newest first)
 *   pidx:<id> -> post key ; apost:<addr>:<rev16>:<id> -> 1
 *   preact:<postId>:<addr> -> 'like'|'dislike'
 *   pcom:<postId>:<ts14>:<cid>         comment
 *   ptip:<sig>                         verified tip (idempotency)
 *   story:<ts14>:<id>                  story (24 h)
 *   sview:<storyId>:<addr>             story view
 *   fol:<a>:<b> / folr:<b>:<a>         a follows b
 *   ucount:<addr>                      { posts, followers, following }
 *   uname:<lowername>:<addr>           name search index
 *   notif:<addr>:<rev16>:<nid>         notification (newest first)
 *   nseen:<addr>                       last-seen notification ts
 */
import { PublicKey } from '@solana/web3.js';

const CHUNK = 512 * 1024;
const IMG_MAX = 10 * 1024 * 1024;
const VID_MAX = 40 * 1024 * 1024;
const DAY_QUOTA = 250 * 1024 * 1024;
const RANGE_CAP = 8 * 1024 * 1024;
const STORY_TTL = 24 * 3600 * 1000;
const STORY_MEDIA_TTL = 30 * 3600 * 1000;
const NOTIF_TTL = 21 * 24 * 3600 * 1000;
const POSTS_PER_HOUR = 30;
const TIP_MAX_AGE_S = 3 * 3600;
const MIMES = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/;
const MINTS = { OST: '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ', OSTG: 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos' };

const rev16 = (ts) => String(1e15 - ts).padStart(16, '0');
const pad14 = (ts) => String(ts).padStart(14, '0');
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
const enc = new TextEncoder();
function b64ToBytes(b64) { const bin = atob(String(b64 || '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function verifyEd25519(walletStr, message, sigB64) {
  let pub, sig;
  try { pub = new PublicKey(walletStr).toBytes(); sig = b64ToBytes(sigB64); } catch (_) { return false; }
  if (sig.length !== 64) return false;
  try { const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']); return await crypto.subtle.verify('Ed25519', key, sig, enc.encode(message)); } catch (_) { return false; }
}
function validWallet(w) { try { return typeof w === 'string' && w.length >= 32 && w.length <= 44 && !!new PublicKey(w); } catch (_) { return false; } }
function cleanEmbed(e) {
  if (!e || typeof e !== 'object') return null;
  const kind = ['market', 'bet', 'perp', 'game', 'link', 'wallet', 'stock'].includes(e.kind) ? e.kind : 'link';
  const href = /^#[\w\-=:.%&+,~]{1,200}$/.test(String(e.href || '')) ? String(e.href) : '';
  const img = /^https:\/\/[^\s"'<>]{4,400}$/.test(String(e.img || '')) ? String(e.img) : '';
  const title = clip(e.title, 140).trim(); if (!title) return null;
  return { kind, title, sub: clip(e.sub, 160), href, img, price: clip(e.price, 24), side: clip(e.side, 12) };
}

async function devnetRpc(env, method, params) {
  const urls = [env.SOLANA_DEVNET_RPC, env.SOLANA_DEVNET_RPC_2, env.SOLANA_DEVNET_RPC_3, 'https://devnet.helius-rpc.com/?api-key=public', 'https://solana-devnet.g.alchemy.com/v2/demo'].filter(Boolean);
  let last = 'rpc_unavailable';
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.error) return j.result;
      last = (j.error && j.error.message) || ('rpc_' + r.status);
    } catch (e) { last = String(e && e.message || e); }
  }
  throw new Error(last);
}

export function installSocial(Hub, H) {
  const { json, fail, cors, validAddr, ID_PREFIX } = H;
  const P = Hub.prototype;

  /* ---------- helpers ---------- */
  P._sAuth = async function (request, url, bodyText, actor, opts) { return this.verifyMeshAuth(request, url, bodyText, actor, opts); };
  P._sBody = async function (request, url, actorField) {
    const bodyText = await request.text();
    let body = {}; try { body = JSON.parse(bodyText) || {}; } catch (_) {}
    const auth = await this.verifyMeshAuth(request, url, bodyText, body && body[actorField || 'from']);
    return { body, auth };
  };
  P._profileOf = async function (addr) {
    const rec = (this.ids && this.ids.get(addr)) || await this.state.storage.get(ID_PREFIX + addr).catch(() => null);
    return rec ? (rec.profile || {}) : null;
  };
  P._slim = function (addr, p) {
    p = p || {};
    return { addr, name: p.name || '', emoji: p.emoji || '', bio: p.bio || '', avatar: p.avatar || '', wallet: p.wallet || '', walletVerified: !!(p.wallet && p.walletAt) };
  };
  P._profiles = async function (addrs) {
    const uniq = [...new Set(addrs.filter(validAddr))].slice(0, 120);
    const out = {};
    if (!uniq.length) return out;
    const got = await this.state.storage.get(uniq.map((a) => ID_PREFIX + a)).catch(() => new Map());
    for (const a of uniq) { const rec = got.get(ID_PREFIX + a); out[a] = this._slim(a, rec && rec.profile); }
    return out;
  };
  P._count = async function (addr, field, delta) {
    const k = 'ucount:' + addr;
    const c = (await this.state.storage.get(k).catch(() => null)) || { posts: 0, followers: 0, following: 0 };
    c[field] = Math.max(0, (Number(c[field]) || 0) + delta);
    await this.state.storage.put(k, c);
    return c;
  };
  P._notify = async function (to, n) {
    if (!validAddr(to) || to === n.from) return;
    const now = Date.now(), nid = rid().slice(0, 12);
    const rec = { id: nid, ts: now, ...n };
    await this.state.storage.put('notif:' + to + ':' + rev16(now) + ':' + nid, { ...rec, expiresAt: now + NOTIF_TTL });
    this._pushTo(to, { t: 'social', n: rec });
    if (Math.random() < 0.05) {
      const listed = await this.state.storage.list({ prefix: 'notif:' + to + ':', limit: 400 });
      const keys = [...listed.keys()]; if (keys.length > 200) await this.state.storage.delete(keys.slice(200, 328)).catch(() => {});
    }
  };
  P._postByKey = async function (postId) {
    if (!/^p[0-9a-f]{16,40}$/.test(String(postId || ''))) return null;
    const key = await this.state.storage.get('pidx:' + postId).catch(() => null);
    if (!key) return null;
    const rec = await this.state.storage.get(key).catch(() => null);
    return rec ? { key, rec } : null;
  };
  P._rate = function (bucket, addr, max, windowMs) {
    this._sRate = this._sRate || new Map();
    const k = bucket + ':' + addr, now = Date.now();
    const w = this._sRate.get(k) || { at: now, n: 0 };
    if (now - w.at > windowMs) { w.at = now; w.n = 0; }
    w.n++; this._sRate.set(k, w);
    return w.n > max;
  };

  /* ---------- router ---------- */
  P.routeSocial = async function (request, url, path, method) {
    const S = '/mesh/v1/social/';
    const r = path.slice(S.length);

    // ---- media ----
    if (method === 'POST' && r === 'media') {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const actor = request.headers.get('x-mesh-addr') || '';
      const auth = await this.verifyMeshAuth(request, url, '', actor, { bodyHash: await H.sha256HexBytes(bytes) });
      if (!auth.ok) return fail(auth.error, auth.status);
      return this.sMediaPut(auth.addr, url, bytes);
    }
    if (method === 'GET' && r.startsWith('media/')) return this.sMediaGet(r.slice(6), request);

    // ---- reads ----
    if (method === 'GET' && r === 'feed') return this.sFeed(url.searchParams);
    if (method === 'GET' && r === 'post') { const f = await this._postByKey(url.searchParams.get('id')); if (!f) return fail('post_not_found', 404); return this.sFeedResponse([f.rec], url.searchParams.get('me'), null); }
    if (method === 'GET' && r === 'comments') return this.sComments(url.searchParams.get('postId'));
    if (method === 'GET' && r === 'stories') return this.sStories(url.searchParams.get('me'));
    if (method === 'GET' && r === 'user') return this.sUser(url.searchParams.get('addr'), url.searchParams.get('me'));
    if (method === 'GET' && r === 'search') return this.sSearch(url.searchParams.get('q'));
    if (method === 'GET' && r === 'people') return this.sPeople(url.searchParams.get('me'));
    if (method === 'GET' && r === 'follows') return this.sFollows(url.searchParams.get('addr'), url.searchParams.get('dir'));
    if (method === 'GET' && r === 'notifs') {
      const addr = url.searchParams.get('addr');
      const auth = await this.verifyMeshAuth(request, url, '', addr);
      if (!auth.ok) return fail(auth.error, auth.status);
      return this.sNotifs(auth.addr);
    }

    // ---- operator moderation (secret SOCIAL_ADMIN_KEY or MESH_ADMIN_KEY) ----
    if (method === 'POST' && r === 'admin') {
      const body = await request.json().catch(() => ({}));
      const keys = [this.env && this.env.SOCIAL_ADMIN_KEY, this.env && this.env.MESH_ADMIN_KEY].filter(Boolean);
      if (!keys.length || !keys.includes(body.key)) return fail('unauthorized', 403);
      return this.sAdmin(body);
    }

    // ---- signed writes ----
    if (method !== 'POST') return null;
    const actorField = r === 'notifs/seen' ? 'addr' : 'from';
    const { body, auth } = await this._sBody(request, url, actorField);
    if (!auth.ok) return fail(auth.error, auth.status);
    const me = auth.addr;
    switch (r) {
      case 'profile': return this.sProfile(me, body);
      case 'post': return this.sPost(me, body);
      case 'delete': return this.sDelete(me, body.postId);
      case 'react': return this.sReact(me, body.postId, body.kind);
      case 'comment': return this.sComment(me, body.postId, body.text);
      case 'comment/delete': return this.sCommentDelete(me, body.postId, body.cid);
      case 'story': return this.sStory(me, body);
      case 'story/view': return this.sStoryView(me, body.storyId);
      case 'story/delete': return this.sStoryDelete(me, body.storyId);
      case 'follow': return this.sFollow(me, body.to, body.on !== false);
      case 'tip': return this.sTip(me, body);
      case 'notifs/seen': await this.state.storage.put('nseen:' + me, Date.now()); return json({ ok: true });
    }
    return fail('social route not found: ' + r, 404);
  };

  /* ---------- media ---------- */
  P.sMediaPut = async function (owner, url, bytes) {
    const mime = String(url.searchParams.get('mime') || '').toLowerCase();
    if (!MIMES.test(mime)) return fail('unsupported_media_type', 415);
    const isVid = mime.startsWith('video/');
    if (bytes.length > (isVid ? VID_MAX : IMG_MAX)) return fail(isVid ? 'video_too_large' : 'image_too_large', 413);
    const purpose = ['post', 'story', 'avatar'].includes(url.searchParams.get('purpose')) ? url.searchParams.get('purpose') : 'post';
    const day = new Date().toISOString().slice(0, 10);
    const qk = 'squota:' + owner + ':' + day;
    const used = Number(await this.state.storage.get(qk).catch(() => 0)) || 0;
    if (used + bytes.length > DAY_QUOTA) return fail('daily_upload_quota', 429);
    const id = 'm' + rid();
    const n = Math.ceil(bytes.length / CHUNK);
    for (let i = 0; i < n; i++) {
      const part = bytes.slice(i * CHUNK, (i + 1) * CHUNK);
      await this.state.storage.put('smedia:' + id + ':' + String(i).padStart(3, '0'), part.buffer);
    }
    const now = Date.now();
    const meta = { id, owner, mime, size: bytes.length, n, purpose, w: Math.min(10000, Number(url.searchParams.get('w')) || 0), h: Math.min(10000, Number(url.searchParams.get('h')) || 0), ts: now, expiresAt: purpose === 'story' ? now + STORY_MEDIA_TTL : 0 };
    await this.state.storage.put('smeta:' + id, meta);
    await this.state.storage.put(qk, used + bytes.length);
    if (Math.random() < 0.04) this.sSweepMedia().catch(() => {});
    return json({ ok: true, id, mime, size: bytes.length, url: '/mesh/v1/social/media/' + id });
  };
  P.sMediaGet = async function (id, request) {
    if (!/^m[0-9a-f]{24}$/.test(id)) return fail('bad media id');
    const meta = await this.state.storage.get('smeta:' + id).catch(() => null);
    if (!meta || (meta.expiresAt && meta.expiresAt <= Date.now())) return fail('media_not_found', 404);
    let start = 0, end = meta.size - 1, partial = false;
    const range = request.headers.get('Range') || '';
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), meta.size - 1) : meta.size - 1; }
      else { const suffix = Number(m[2]); start = Math.max(0, meta.size - suffix); end = meta.size - 1; }
      if (start > end || start >= meta.size) return new Response(null, { status: 416, headers: cors({ 'Content-Range': 'bytes */' + meta.size }) });
      if (end - start + 1 > RANGE_CAP) end = start + RANGE_CAP - 1;
      partial = true;
    }
    const c0 = Math.floor(start / CHUNK), c1 = Math.floor(end / CHUNK);
    const keys = []; for (let i = c0; i <= c1; i++) keys.push('smedia:' + id + ':' + String(i).padStart(3, '0'));
    const got = await this.state.storage.get(keys);
    const out = new Uint8Array(end - start + 1); let o = 0;
    for (let i = c0; i <= c1; i++) {
      const buf = got.get('smedia:' + id + ':' + String(i).padStart(3, '0'));
      if (!buf) return fail('media_incomplete', 410);
      const u = new Uint8Array(buf);
      const from = i === c0 ? start - i * CHUNK : 0;
      const to = i === c1 ? end - i * CHUNK + 1 : u.length;
      out.set(u.subarray(from, to), o); o += to - from;
    }
    const headers = cors({ 'Content-Type': meta.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(out.length), 'Cache-Control': meta.expiresAt ? 'public, max-age=3600' : 'public, max-age=31536000, immutable', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length' });
    if (partial) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + meta.size;
    return new Response(out, { status: partial ? 206 : 200, headers });
  };
  P.sSweepMedia = async function () {
    const now = Date.now();
    const listed = await this.state.storage.list({ prefix: 'smeta:', limit: 300 });
    for (const [k, meta] of listed) {
      if (!meta || !meta.expiresAt || meta.expiresAt > now) continue;
      const del = [k]; for (let i = 0; i < (meta.n || 0); i++) del.push('smedia:' + meta.id + ':' + String(i).padStart(3, '0'));
      await this.state.storage.delete(del).catch(() => {});
    }
  };
  P._ownMedia = async function (owner, list, max) {
    const out = [];
    for (const it of (Array.isArray(list) ? list : []).slice(0, max)) {
      const id = String(it && it.id || '');
      if (!/^m[0-9a-f]{24}$/.test(id)) continue;
      const meta = await this.state.storage.get('smeta:' + id).catch(() => null);
      if (!meta || meta.owner !== owner) continue;
      let poster = '';
      if (it.poster && /^m[0-9a-f]{24}$/.test(String(it.poster))) { const pm = await this.state.storage.get('smeta:' + it.poster).catch(() => null); if (pm && pm.owner === owner && pm.mime.startsWith('image/')) poster = it.poster; }
      out.push({ id, kind: meta.mime.startsWith('video/') ? 'video' : 'image', mime: meta.mime, size: meta.size, w: meta.w || 0, h: meta.h || 0, poster });
    }
    return out;
  };

  /* ---------- profile ---------- */
  P.sProfile = async function (me, body) {
    const rec = (this.ids && this.ids.get(me)) || await this.state.storage.get(ID_PREFIX + me).catch(() => null);
    if (!rec) return fail('mesh_identity_unknown', 401);
    const old = rec.profile || {};
    const p = { ...old };
    if (body.name !== undefined) p.name = clip(body.name, 32).replace(/[<>]/g, '').trim();
    if (body.emoji !== undefined) p.emoji = clip(body.emoji, 8).trim();
    if (body.bio !== undefined) p.bio = clip(body.bio, 200).trim();
    if (body.avatar !== undefined) {
      const a = String(body.avatar || '');
      if (!a) p.avatar = '';
      else { const meta = await this.state.storage.get('smeta:' + a).catch(() => null); if (meta && meta.owner === me && meta.mime.startsWith('image/')) p.avatar = a; }
    }
    if (body.unlinkWallet) { p.wallet = ''; p.walletAt = 0; }
    if (body.wallet) {
      const w = String(body.wallet), ts = Number(body.walletTs) || 0;
      if (!validWallet(w)) return fail('bad_wallet');
      if (Math.abs(Date.now() - ts) > 10 * 60 * 1000) return fail('wallet_link_stale');
      if (!(await verifyEd25519(w, `OST-MESH-LINK|v1|${me}|${w}|${ts}`, body.walletSig))) return fail('wallet_link_bad_signature', 401);
      p.wallet = w; p.walletAt = Date.now();
    }
    // name search index
    const oldName = String(old.name || '').toLowerCase(), newName = String(p.name || '').toLowerCase();
    if (oldName !== newName) {
      if (oldName) await this.state.storage.delete('uname:' + oldName + ':' + me).catch(() => {});
      if (newName) await this.state.storage.put('uname:' + newName + ':' + me, Date.now());
    }
    rec.profile = p;
    this.ids && this.ids.set(me, rec);
    await this.state.storage.put(ID_PREFIX + me, rec);
    return json({ ok: true, profile: this._slim(me, p) });
  };
  P.sUser = async function (addr, me) {
    if (!validAddr(addr)) return fail('bad addr');
    const p = await this._profileOf(addr);
    if (p === null) return fail('not_found', 404);
    const counts = (await this.state.storage.get('ucount:' + addr).catch(() => null)) || { posts: 0, followers: 0, following: 0 };
    let iFollow = false, followsMe = false;
    if (validAddr(me) && me !== addr) {
      const got = await this.state.storage.get(['fol:' + me + ':' + addr, 'fol:' + addr + ':' + me]);
      iFollow = !!got.get('fol:' + me + ':' + addr); followsMe = !!got.get('fol:' + addr + ':' + me);
    }
    let online = false; try { online = this._online(addr); } catch (_) {}
    return json({ ok: true, user: this._slim(addr, p), counts, iFollow, followsMe, online });
  };
  P.sSearch = async function (q) {
    q = String(q || '').trim().toLowerCase().slice(0, 32);
    if (!q) return json({ ok: true, users: [] });
    const direct = q.match(/ost-mesh:[0-9a-f]{4}(?:-[0-9a-f]{4}){3}/);
    let addrs = [];
    if (direct) addrs = [direct[0]];
    else { const listed = await this.state.storage.list({ prefix: 'uname:' + q, limit: 25 }); for (const k of listed.keys()) addrs.push(k.slice(k.lastIndexOf(':ost-mesh') + 1)); }
    addrs = addrs.filter(validAddr);
    const profs = await this._profiles(addrs);
    return json({ ok: true, users: addrs.map((a) => profs[a]).filter((u) => u && (u.name || direct)) });
  };
  P.sPeople = async function (me) {
    // Discovery = people who set a profile through the signed route (name index),
    // not the raw directory (every visitor announces; that list is mostly anonymous).
    const listed = await this.state.storage.list({ prefix: 'uname:', limit: 300 });
    const addrs = []; for (const k of listed.keys()) { const a = k.slice(k.lastIndexOf(':ost-mesh') + 1); if (validAddr(a) && a !== me && !addrs.includes(a)) addrs.push(a); }
    const got = addrs.length ? await this._profiles(addrs.slice(0, 120)) : {};
    const counts = addrs.length ? await this.state.storage.get(addrs.slice(0, 120).map((a) => 'ucount:' + a)) : new Map();
    const rows = addrs.slice(0, 120).map((a) => ({ ...got[a], score: ((counts.get('ucount:' + a) || {}).followers || 0) * 3 + ((counts.get('ucount:' + a) || {}).posts || 0) + (got[a] && got[a].walletVerified ? 5 : 0) })).filter((u) => u && u.name);
    rows.sort((x, y) => y.score - x.score);
    return json({ ok: true, users: rows.slice(0, 40) });
  };

  /* ---------- follow ---------- */
  P.sFollow = async function (me, to, on) {
    if (!validAddr(to) || to === me) return fail('bad_to');
    const k = 'fol:' + me + ':' + to, rk = 'folr:' + to + ':' + me;
    const has = !!(await this.state.storage.get(k).catch(() => null));
    if (on && !has) {
      await this.state.storage.put(k, Date.now()); await this.state.storage.put(rk, Date.now());
      await this._count(me, 'following', 1); await this._count(to, 'followers', 1);
      await this._notify(to, { kind: 'follow', from: me });
    } else if (!on && has) {
      await this.state.storage.delete([k, rk]);
      await this._count(me, 'following', -1); await this._count(to, 'followers', -1);
    }
    return json({ ok: true, following: on });
  };
  P.sFollows = async function (addr, dir) {
    if (!validAddr(addr)) return fail('bad addr');
    const prefix = (dir === 'followers' ? 'folr:' : 'fol:') + addr + ':';
    const listed = await this.state.storage.list({ prefix, limit: 500 });
    const addrs = [...listed.keys()].map((k) => k.slice(prefix.length));
    const profs = await this._profiles(addrs.slice(0, 120));
    return json({ ok: true, addrs, users: addrs.slice(0, 120).map((a) => profs[a]) });
  };

  /* ---------- posts ---------- */
  P.sPost = async function (me, body) {
    if (this._rate('post', me, POSTS_PER_HOUR, 3600_000)) return fail('posting_too_fast', 429);
    const text = clip(body.text, 2000).trim();
    const media = await this._ownMedia(me, body.media, 4);
    const embed = cleanEmbed(body.embed);
    if (!text && !media.length && !embed) return fail('empty_post');
    const now = Date.now(), id = 'p' + rid().slice(0, 20);
    const key = 'post:' + rev16(now) + ':' + id;
    const rec = { id, author: me, text, media, embed, ts: now, likes: 0, dislikes: 0, comments: 0, tips: {}, tipCount: 0 };
    await this.state.storage.put(key, rec);
    await this.state.storage.put('pidx:' + id, key);
    await this.state.storage.put('apost:' + me + ':' + rev16(now) + ':' + id, 1);
    await this._count(me, 'posts', 1);
    // Tell followers who are online right now (no stored notification — the feed is the record).
    try {
      const fl = await this.state.storage.list({ prefix: 'folr:' + me + ':', limit: 500 });
      for (const k of fl.keys()) this._pushTo(k.slice(('folr:' + me + ':').length), { t: 'social', n: { kind: 'new-post', from: me, postId: id, ts: now, live: true } });
    } catch (_) {}
    return this.sFeedResponse([rec], me, null);
  };
  P.sDelete = async function (me, postId) {
    const f = await this._postByKey(postId);
    if (!f) return fail('post_not_found', 404);
    if (f.rec.author !== me) return fail('not_your_post', 403);
    await this.sDropPost(f);
    return json({ ok: true, deleted: postId });
  };
  P.sDropPost = async function (f) {
    const rec = f.rec;
    const del = [f.key, 'pidx:' + rec.id, 'apost:' + rec.author + ':' + f.key.split(':')[1] + ':' + rec.id];
    const coms = await this.state.storage.list({ prefix: 'pcom:' + rec.id + ':', limit: 500 });
    const reacts = await this.state.storage.list({ prefix: 'preact:' + rec.id + ':', limit: 1000 });
    del.push(...coms.keys(), ...reacts.keys());
    for (let i = 0; i < del.length; i += 128) await this.state.storage.delete(del.slice(i, i + 128)).catch(() => {});
    await this._count(rec.author, 'posts', -1);
  };
  P.sFeed = async function (q) {
    const limit = Math.max(1, Math.min(30, Number(q.get('limit')) || 15));
    const cursor = String(q.get('cursor') || '');
    const author = q.get('author'), me = q.get('me'), mode = q.get('mode');
    let posts = [], next = null;
    if (validAddr(author)) {
      const prefix = 'apost:' + author + ':';
      const opts = { prefix, limit };
      if (cursor && cursor.startsWith(prefix)) opts.startAfter = cursor;
      const listed = await this.state.storage.list(opts);
      const idxKeys = [...listed.keys()];
      const pkeys = idxKeys.map((k) => { const parts = k.slice(prefix.length).split(':'); return 'post:' + parts[0] + ':' + parts[1]; });
      const got = pkeys.length ? await this.state.storage.get(pkeys) : new Map();
      posts = pkeys.map((k) => got.get(k)).filter(Boolean);
      next = idxKeys.length === limit ? idxKeys[idxKeys.length - 1] : null;
    } else {
      let follow = null;
      if (mode === 'following' && validAddr(me)) {
        const fl = await this.state.storage.list({ prefix: 'fol:' + me + ':', limit: 1000 });
        follow = new Set([...fl.keys()].map((k) => k.slice(('fol:' + me + ':').length))); follow.add(me);
      }
      let after = cursor && cursor.startsWith('post:') ? cursor : null;
      for (let page = 0; page < 6 && posts.length < limit; page++) {
        const opts = { prefix: 'post:', limit: follow ? 100 : limit - posts.length };
        if (after) opts.startAfter = after;
        const listed = await this.state.storage.list(opts);
        if (!listed.size) { after = null; break; }
        for (const [k, v] of listed) { after = k; if (!follow || follow.has(v.author)) { posts.push(v); if (posts.length >= limit) break; } }
        if (listed.size < opts.limit) { if (posts.length < limit) after = null; break; }
      }
      next = posts.length >= limit ? after : null;
    }
    return this.sFeedResponse(posts, me, next);
  };
  P.sFeedResponse = async function (posts, me, next) {
    const mine = {};
    if (validAddr(me) && posts.length) {
      const got = await this.state.storage.get(posts.map((p) => 'preact:' + p.id + ':' + me));
      for (const p of posts) { const v = got.get('preact:' + p.id + ':' + me); if (v) mine[p.id] = v; }
    }
    const authors = await this._profiles(posts.map((p) => p.author));
    return json({ ok: true, posts: posts.map((p) => ({ ...p, my: mine[p.id] || '' })), authors, cursor: next });
  };
  P.sReact = async function (me, postId, kind) {
    kind = kind === 'dislike' ? 'dislike' : 'like';
    const f = await this._postByKey(postId);
    if (!f) return fail('post_not_found', 404);
    const rk = 'preact:' + postId + ':' + me;
    const prev = await this.state.storage.get(rk).catch(() => null);
    const rec = f.rec;
    if (prev === 'like') rec.likes = Math.max(0, rec.likes - 1);
    if (prev === 'dislike') rec.dislikes = Math.max(0, rec.dislikes - 1);
    let now = '';
    if (prev !== kind) { now = kind; if (kind === 'like') rec.likes++; else rec.dislikes++; await this.state.storage.put(rk, kind); }
    else await this.state.storage.delete(rk);
    await this.state.storage.put(f.key, rec);
    if (now === 'like' && !prev) await this._notify(rec.author, { kind: 'like', from: me, postId });
    return json({ ok: true, my: now, likes: rec.likes, dislikes: rec.dislikes });
  };
  P.sComment = async function (me, postId, text) {
    text = clip(text, 500).trim();
    if (!text) return fail('empty_comment');
    if (this._rate('comment', me, 60, 600_000)) return fail('commenting_too_fast', 429);
    const f = await this._postByKey(postId);
    if (!f) return fail('post_not_found', 404);
    const now = Date.now(), cid = 'c' + rid().slice(0, 12);
    const c = { id: cid, postId, author: me, text, ts: now };
    await this.state.storage.put('pcom:' + postId + ':' + pad14(now) + ':' + cid, c);
    f.rec.comments = (f.rec.comments || 0) + 1;
    await this.state.storage.put(f.key, f.rec);
    await this._notify(f.rec.author, { kind: 'comment', from: me, postId, text: text.slice(0, 120) });
    const authors = await this._profiles([me]);
    return json({ ok: true, comment: c, authors, comments: f.rec.comments });
  };
  P.sCommentDelete = async function (me, postId, cid) {
    const f = await this._postByKey(postId);
    if (!f) return fail('post_not_found', 404);
    const listed = await this.state.storage.list({ prefix: 'pcom:' + postId + ':', limit: 500 });
    for (const [k, c] of listed) {
      if (c && c.id === cid) {
        if (c.author !== me && f.rec.author !== me) return fail('not_allowed', 403);
        await this.state.storage.delete(k);
        f.rec.comments = Math.max(0, (f.rec.comments || 1) - 1);
        await this.state.storage.put(f.key, f.rec);
        return json({ ok: true, comments: f.rec.comments });
      }
    }
    return fail('comment_not_found', 404);
  };
  P.sComments = async function (postId) {
    if (!/^p[0-9a-f]{16,40}$/.test(String(postId || ''))) return fail('bad post id');
    const listed = await this.state.storage.list({ prefix: 'pcom:' + postId + ':', limit: 200 });
    const comments = [...listed.values()];
    const authors = await this._profiles(comments.map((c) => c.author));
    return json({ ok: true, comments, authors });
  };

  /* ---------- stories ---------- */
  P.sStory = async function (me, body) {
    if (this._rate('story', me, 30, 3600_000)) return fail('posting_too_fast', 429);
    const media = await this._ownMedia(me, [body.media], 1);
    if (!media.length) return fail('story_needs_media');
    const now = Date.now(), id = 's' + rid().slice(0, 16);
    const rec = { id, author: me, media: media[0], caption: clip(body.caption, 200).trim(), ts: now, expiresAt: now + STORY_TTL, views: 0 };
    await this.state.storage.put('story:' + pad14(now) + ':' + id, rec);
    try {
      const fl = await this.state.storage.list({ prefix: 'folr:' + me + ':', limit: 500 });
      for (const k of fl.keys()) this._pushTo(k.slice(('folr:' + me + ':').length), { t: 'social', n: { kind: 'new-story', from: me, ts: now, live: true } });
    } catch (_) {}
    return json({ ok: true, story: rec });
  };
  P.sStories = async function (me) {
    const now = Date.now();
    const start = 'story:' + pad14(now - STORY_TTL);
    const listed = await this.state.storage.list({ prefix: 'story:', start, limit: 400 });
    const by = new Map();
    for (const [, s] of listed) {
      if (!s || s.expiresAt <= now) continue;
      if (!by.has(s.author)) by.set(s.author, []);
      by.get(s.author).push(s);
    }
    let seen = {};
    if (validAddr(me)) {
      const keys = []; for (const arr of by.values()) for (const s of arr) keys.push('sview:' + s.id + ':' + me);
      if (keys.length) { const got = await this.state.storage.get(keys.slice(0, 128)); for (const k of got.keys()) seen[k.split(':')[1]] = 1; }
    }
    const authors = await this._profiles([...by.keys()]);
    const groups = [...by.entries()].map(([a, items]) => ({ author: a, profile: authors[a], items: items.map((s) => ({ ...s, seen: !!seen[s.id], views: s.author === me ? s.views : undefined })), latest: items[items.length - 1].ts }));
    groups.sort((x, y) => ((x.author === me) ? -1 : (y.author === me) ? 1 : 0) || (x.items.every((s) => s.seen) - y.items.every((s) => s.seen)) || (y.latest - x.latest));
    if (Math.random() < 0.05) {
      const old = await this.state.storage.list({ prefix: 'story:', end: start, limit: 128 });
      if (old.size) await this.state.storage.delete([...old.keys()]).catch(() => {});
    }
    return json({ ok: true, groups });
  };
  P._storyKey = async function (storyId) {
    if (!/^s[0-9a-f]{16}$/.test(String(storyId || ''))) return null;
    const listed = await this.state.storage.list({ prefix: 'story:', start: 'story:' + pad14(Date.now() - STORY_TTL), limit: 400 });
    for (const [k, s] of listed) if (s && s.id === storyId) return { key: k, rec: s };
    return null;
  };
  P.sStoryView = async function (me, storyId) {
    const f = await this._storyKey(storyId);
    if (!f) return json({ ok: true });
    const vk = 'sview:' + storyId + ':' + me;
    if (!(await this.state.storage.get(vk).catch(() => null))) {
      await this.state.storage.put(vk, Date.now());
      if (f.rec.author !== me) { f.rec.views = (f.rec.views || 0) + 1; await this.state.storage.put(f.key, f.rec); }
    }
    return json({ ok: true });
  };
  P.sStoryDelete = async function (me, storyId) {
    const f = await this._storyKey(storyId);
    if (!f) return fail('story_not_found', 404);
    if (f.rec.author !== me) return fail('not_your_story', 403);
    await this.state.storage.delete(f.key);
    return json({ ok: true });
  };

  /* ---------- notifications ---------- */
  P.sNotifs = async function (me) {
    const listed = await this.state.storage.list({ prefix: 'notif:' + me + ':', limit: 60 });
    const now = Date.now();
    const items = [...listed.values()].filter((n) => !n.expiresAt || n.expiresAt > now);
    const seenAt = Number(await this.state.storage.get('nseen:' + me).catch(() => 0)) || 0;
    const authors = await this._profiles(items.map((n) => n.from));
    return json({ ok: true, items, authors, seenAt, unread: items.filter((n) => n.ts > seenAt).length });
  };

  /* ---------- operator moderation ---------- */
  P.sAdmin = async function (body) {
    const out = { posts: 0, stories: 0, profiles: 0 };
    if (body.action === 'delete-post') {
      const f = await this._postByKey(body.postId); if (!f) return fail('post_not_found', 404);
      await this.sDropPost(f); out.posts = 1; return json({ ok: true, ...out });
    }
    if (body.action === 'delete-author') {
      const addr = String(body.addr || ''); if (!validAddr(addr)) return fail('bad addr');
      const ap = await this.state.storage.list({ prefix: 'apost:' + addr + ':', limit: 500 });
      for (const k of ap.keys()) { const id = k.split(':').pop(); const f = await this._postByKey(id); if (f) { await this.sDropPost(f); out.posts++; } }
      const st = await this.state.storage.list({ prefix: 'story:', limit: 1000 });
      const sdel = []; for (const [k, v] of st) if (v && v.author === addr) sdel.push(k);
      if (sdel.length) { await this.state.storage.delete(sdel.slice(0, 128)); out.stories = sdel.length; }
      const rec = await this.state.storage.get(ID_PREFIX + addr).catch(() => null);
      if (rec && rec.profile) {
        if (rec.profile.name) await this.state.storage.delete('uname:' + String(rec.profile.name).toLowerCase() + ':' + addr).catch(() => {});
        rec.profile = null; this.ids && this.ids.set(addr, rec); await this.state.storage.put(ID_PREFIX + addr, rec); out.profiles = 1;
      }
      const fl = await this.state.storage.list({ prefix: 'fol:' + addr + ':', limit: 500 }); const fr = await this.state.storage.list({ prefix: 'folr:' + addr + ':', limit: 500 });
      const fdel = [...fl.keys(), ...fr.keys()]; for (let i = 0; i < fdel.length; i += 128) await this.state.storage.delete(fdel.slice(i, i + 128)).catch(() => {});
      await this.state.storage.delete('ucount:' + addr).catch(() => {});
      return json({ ok: true, ...out });
    }
    return fail('bad action');
  };

  /* ---------- tips: verified on-chain ---------- */
  P.sTip = async function (me, body) {
    const sig = String(body.sig || '');
    const ccy = ['OST', 'OSTG', 'SOL'].includes(body.ccy) ? body.ccy : '';
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(sig)) return fail('bad_signature');
    if (!ccy) return fail('bad_currency');
    const f = await this._postByKey(body.postId);
    if (!f) return fail('post_not_found', 404);
    const done = await this.state.storage.get('ptip:' + sig).catch(() => null);
    if (done) return json({ ok: true, idempotent: true, tip: done, tips: f.rec.tips });
    const author = await this._profileOf(f.rec.author);
    const authorWallet = author && author.wallet;
    if (!authorWallet) return fail('author_has_no_wallet');
    let tx;
    try { tx = await devnetRpc(this.env, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); }
    catch (e) { return fail('rpc_error: ' + String(e && e.message || e).slice(0, 80), 503); }
    if (!tx) return fail('tx_not_found', 404);
    if (tx.meta && tx.meta.err) return fail('tx_failed');
    if (tx.blockTime && Math.abs(Date.now() / 1000 - tx.blockTime) > TIP_MAX_AGE_S) return fail('tx_too_old');
    const memo = 'ost-tip:' + f.rec.id;
    const logs = (tx.meta && tx.meta.logMessages) || [];
    const ixs = (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
    const memoOk = logs.some((l) => String(l).includes(memo)) || ixs.some((ix) => ix && (ix.program === 'spl-memo') && String(ix.parsed || '').includes(memo));
    if (!memoOk) return fail('tip_memo_missing');
    const keys = (tx.transaction.message.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
    const payer = keys[0] || '';
    let amount = 0;
    if (ccy === 'SOL') {
      const i = keys.indexOf(authorWallet);
      if (i < 0) return fail('tip_not_to_author');
      amount = ((tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0)) / 1e9;
    } else {
      const mint = MINTS[ccy];
      const sum = (arr) => (arr || []).filter((b) => b.owner === authorWallet && b.mint === mint).reduce((s, b) => s + (Number(b.uiTokenAmount && b.uiTokenAmount.uiAmountString) || 0), 0);
      amount = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    }
    amount = Math.round(amount * 1e6) / 1e6;
    if (!(amount > 0)) return fail('tip_not_to_author');
    const tip = { sig, postId: f.rec.id, from: me, payer, ccy, amount, ts: Date.now() };
    await this.state.storage.put('ptip:' + sig, tip);
    f.rec.tips = f.rec.tips || {};
    f.rec.tips[ccy] = Math.round(((Number(f.rec.tips[ccy]) || 0) + amount) * 1e6) / 1e6;
    f.rec.tipCount = (f.rec.tipCount || 0) + 1;
    await this.state.storage.put(f.key, f.rec);
    await this._notify(f.rec.author, { kind: 'tip', from: me, postId: f.rec.id, amount, ccy, sig });
    return json({ ok: true, tip, tips: f.rec.tips, tipCount: f.rec.tipCount });
  };
}
