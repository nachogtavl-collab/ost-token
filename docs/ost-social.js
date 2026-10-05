/* ==========================================================================
 * OST Mesh · social side — the public half of the mesh (feed, stories, profiles, tips)
 * --------------------------------------------------------------------------
 * Plugs into ost-mesh-app.js as its home tab. Everything a user writes is
 * signed with their mesh key; media are uploaded to the hub (public, streamed
 * with Range); tips are REAL devnet transfers from the connected wallet to the
 * author's linked wallet, re-verified on-chain by the worker before they count.
 *
 *   Feed      For you / Following, photos (up to 4) or a video per post,
 *             like / dislike, comments, tips, share, embeds from the rest of OST
 *   Stories   24-hour photo / video stories with a full-screen viewer
 *   Profiles  name, emoji, avatar, bio, verified wallet, follow, message, call,
 *             send OST/SOL
 *   Alerts    likes, comments, follows, tips — pushed live over the hub socket
 *   Site      "Share" on the market page, "share your bet" after a trade,
 *             attach a bet / market / perp / wallet to a post; #social, #post=,
 *             #u= deep links; "Mesh" link in the desktop nav;
 *   Overlays  #oslSheet (actions / confirms), #oslLight, #oslStory each own their
 *             keys (Escape, arrows, Tab), close on the backdrop, restore focus
 *             OST Studio apps: `app` embeds open in the apps viewer (#app=),
 *             #share-app=<slug> composes a post with the app attached
 * window.OST_SOCIAL.{ open, compose, marketEmbed, share, profile, post, pay }
 * ========================================================================== */
(function boot() {
  if (window.OST_SOCIAL) return;
  const core = window.OST_MESH_APP && window.OST_MESH_APP.core;
  if (!core) { window.addEventListener('ost:mesh-app:core', boot, { once: true }); return; }
  const { S, X, API, esc, toast, ago, avStyle, signed, shortA } = core;
  const $ = (id) => document.getElementById(id);
  const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐳', '🦉', '🐝', '🌵', '🍀', '⚡', '🔥', '🌙', '🎧', '🛰️', '🎲', '🚀', '💎'];
  const MINT = { OSTG: 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos' };
  const IMG_EDGE = 2048, VID_MAX = 40 * 1024 * 1024, IMG_MAX = 10 * 1024 * 1024, TEXT_MAX = 2000, PHOTO_MAX = 4;
  const SS = {
    mode: core.lsGet('ost.social.mode', 'all'), posts: [], cursor: null, loading: false, loaded: false, err: '', errMore: false,
    users: {}, stories: [], notifs: { items: [], unread: 0 }, newPosts: 0, stack: [], scroll: {},
    draft: { text: '', media: [], embed: null, busy: '' }, postId: null, comments: {}, commentsErr: {}, profileOf: null, search: '', people: null, edit: null
  };
  const mediaUrl = (id) => API + '/mesh/v1/social/media/' + encodeURIComponent(id);
  const me = () => S.address;
  const fmtN = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
  const fmtCount = (n) => (n == null || n === '' || !Number.isFinite(Number(n))) ? '–' : fmtN(n);   // "–" until the number is known
  const fmtAmt = (n) => { n = Number(n) || 0; return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toFixed(4).replace(/\.?0+$/, ''); };
  const ratio = (w, h) => { w = Number(w); h = Number(h); return w > 0 && h > 0 ? `style="aspect-ratio:${Math.round(w)}/${Math.round(h)}"` : ''; };
  // Run once the mesh identity is loaded: core.whenReady when the core offers it, otherwise the core's
  // post-boot 'ost:mesh-app:unread' event (contract C2, dispatched once after boot). Events only, no polling.
  const readyQ = [];
  const flushReady = () => { if (!S.ready || !readyQ.length) return; readyQ.splice(0).forEach((f) => { try { f(); } catch (_) {} }); };
  window.addEventListener('ost:mesh-app:unread', flushReady);
  function whenReady(fn) {
    if (S.ready) { fn(); return; }
    if (typeof core.whenReady === 'function') { core.whenReady(fn); return; }
    readyQ.push(fn);
  }

  /* ---------- data ---------- */
  // Errors carry .net (request never reached the hub) or .status so views can tell "offline" from "empty".
  async function getJ(path) {
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
    try {
      let r, j;
      try { r = await fetch(API + path, { cache: 'no-store', signal: ctl && ctl.signal }); j = await r.json().catch((e) => { if (e && e.name === 'AbortError') throw e; return null; }); }
      catch (e) { const er = new Error(e && e.name === 'AbortError' ? 'The request timed out.' : navigator.onLine === false ? 'You are offline.' : 'The network is unreachable.'); er.net = true; throw er; }
      // The core's breaker hears about 429 / 5xx too (its status line counts down; signed requests wait).
      try { if (typeof core.noteHub === 'function') core.noteHub(r.status, r.headers, j); } catch (_) {}
      if (!r.ok || !j || j.ok === false) {
        const code = j && j.error ? String(j.error) : '';
        let msg;
        if (r.status === 429 || code === 'rate_limited' || code === 'hub_busy') {
          // Retry-After is not CORS-exposed; the hub repeats it in the body.
          let s = Number(j && j.retryAfter) || 0; try { s = s || Number(r.headers.get('Retry-After')) || 0; } catch (_) {}
          msg = 'The hub is busy — try again in ' + (s > 0 ? Math.ceil(s) + ' s' : 'a moment') + '.';
        } else if (r.status >= 500) msg = 'The hub is unavailable right now — try again shortly.';
        else msg = code ? code.replace(/_/g, ' ') : 'HTTP ' + r.status;
        const er = new Error(msg); er.status = r.status; er.code = code; throw er;
      }
      return j;
    } finally { if (t) clearTimeout(t); }
  }
  // Error state with a Retry button — a failed request is never shown as "nothing here".
  const errBox = (what, e, act, attrs) => `<div class="omx-empty osl-err" role="alert"><b>📡</b>${esc(what)}<small>${esc(String((e && e.message) || e || 'unknown error'))}</small><button class="omx-ghost osl-retry" data-act="${act}" ${attrs || ''}>Retry</button></div>`;
  function absorb(map) { Object.keys(map || {}).forEach((a) => { SS.users[a] = Object.assign({}, SS.users[a] || {}, map[a]); }); }
  function user(a) {
    const u = SS.users[a] || { addr: a };
    if (a === me()) return Object.assign({}, u, { name: S.profile.name || u.name, emoji: S.profile.emoji || u.emoji, avatar: S.profile.avatar != null ? S.profile.avatar : u.avatar, wallet: S.profile.wallet != null ? S.profile.wallet : u.wallet });
    const c = core.contact(a);
    return Object.assign({ name: (c && c.name) || '', emoji: (c && c.emoji) || '' }, u);
  }
  const dname = (a) => user(a).name || shortA(a);
  function avatar(a, cls) {
    const u = user(a);
    const fb = esc(u.emoji || (u.name || 'm')[0].toUpperCase());
    if (u.avatar) return `<span class="osl-av ${cls || ''}" style="${avStyle(a)}" data-fb="${fb}"><img src="${mediaUrl(u.avatar)}" alt="" loading="lazy"></span>`;
    return `<span class="osl-av ${cls || ''}" style="${avStyle(a)}">${fb}</span>`;
  }
  const badge = (a) => (user(a).walletVerified || (a === me() && S.profile.wallet)) ? '<i class="osl-ver" title="Wallet verified by signature">✓</i>' : '';
  // Hashtags stay plain text until tag search exists — nothing here should look tappable and do nothing.
  function rich(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`).replace(/\n/g, '<br>');
  }
  const blocked = (a) => { const c = core.contact(a); return !!(c && c.state === 'blocked'); };
  // Raw fetch failures ("Failed to fetch") from signed requests read as plain words.
  const emsg = (e, d) => { const m = (e && e.message) || ''; return (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)) ? (navigator.onLine === false ? 'You are offline.' : 'The network is unreachable.') : (m || d || 'Something went wrong.'); };

  let feedSeq = 0;
  async function loadFeed(reset) {
    if (SS.loading && !reset) return;
    const seq = ++feedSeq;   // a newer reset (mode switch, refresh) supersedes an in-flight load
    SS.loading = true; SS.err = ''; SS.errMore = false; SS.triedAt = Date.now();
    paintFeedList();
    try {
      const q = '/mesh/v1/social/feed?limit=12' + (SS.mode === 'following' ? '&mode=following' : '') + '&me=' + encodeURIComponent(me() || '') + (!reset && SS.cursor ? '&cursor=' + encodeURIComponent(SS.cursor) : '');
      const j = await getJ(q);
      if (seq !== feedSeq) return;
      absorb(j.authors);
      const got = j.posts || [];
      SS.posts = reset ? got : SS.posts.concat(got.filter((p) => !SS.posts.some((x) => x.id === p.id)));
      SS.cursor = j.cursor || null; SS.loaded = true; SS.loadedAt = Date.now();
      if (reset) SS.newPosts = 0;
    } catch (e) { if (seq !== feedSeq) return; SS.err = e.message || 'Feed unavailable'; SS.errMore = !reset; }
    SS.loading = false;
    paintFeedList();
  }
  async function loadStories() {
    try { const j = await getJ('/mesh/v1/social/stories?me=' + encodeURIComponent(me() || '')); SS.stories = j.groups || []; SS.storiesErr = ''; (SS.stories || []).forEach((g) => { if (g.profile) absorb({ [g.author]: g.profile }); }); } catch (e) { SS.storiesErr = e.message || 'unavailable'; }
    paintStories();
  }
  // Alerts: one request at a time, and not again within 30 s unless forced (boot warm-up + opening the feed used to fetch twice).
  let notifsBusy = null;
  function loadNotifs(force) {
    if (!me()) return Promise.resolve();
    if (notifsBusy) return notifsBusy;
    if (!force && SS.notifsTried && Date.now() - SS.notifsTried < 30000) return Promise.resolve();
    SS.notifsTried = Date.now();
    notifsBusy = (async () => {
      try { const j = await signed('GET', '/mesh/v1/social/notifs?addr=' + encodeURIComponent(me())); absorb(j.authors); SS.notifs = { items: j.items || [], unread: j.unread || 0, seenAt: j.seenAt || 0 }; SS.notifsErr = ''; SS.notifsAt = Date.now(); }
      catch (e) { SS.notifsErr = emsg(e, 'Alerts unavailable.'); }
      notifsBusy = null;
      paintBell(); refreshTabs(); paintNotifs();
    })();
    return notifsBusy;
  }
  function refreshTabs() { try { const t = document.getElementById('omxTabs'); if (!t || t.hidden) return; t.querySelectorAll('[data-tab="feed"] .omx-badge').forEach((x) => x.remove()); if (SS.notifs.unread) { const b = t.querySelector('[data-tab="feed"]'); if (b) b.insertAdjacentHTML('beforeend', `<span class="omx-badge">${SS.notifs.unread > 99 ? '99+' : SS.notifs.unread}</span>`); } } catch (_) {} }

  /* ---------- navigation inside the sheet ---------- */
  const bodyEl = () => document.getElementById('omxBody');
  // The stack remembers the view (and, for a profile, whose it was) plus the scroll position, so Back lands where the user was.
  function remember(view, force) {
    if (S.view === view && !force) return;
    SS.stack.push(S.view === 'profile' ? { v: 'profile', a: SS.profileOf, fromChat: SS.fromChat } : S.view);
    const b = bodyEl(); if (b) SS.scroll[S.view] = b.scrollTop;
    if (SS.stack.length > 20) SS.stack.shift();
  }
  function go(view, extra) {
    const depth = SS.stack.length;
    remember(view);
    Object.assign(SS, extra || {}); core.go(view);
    const b = bodyEl(); if (b) b.scrollTop = 0;
    if (SS.stack.length > depth && !SS.hashNav) linkStep(depth, false);   // browser/Android Back returns to this screen's parent
  }
  function back() {
    if (S.view === 'edit') SS.edit = null;
    // A profile opened from a chat header goes back to that chat.
    if (S.view === 'profile' && SS.fromChat && !SS.stack.length) { const a = SS.fromChat; SS.fromChat = null; if (core.contact(a)) { core.openChat(a); return; } }
    if (S.view === 'profile') SS.fromChat = null;
    const e = SS.stack.pop() || 'feed';
    unlinkPast();
    const v = typeof e === 'string' ? e : e.v;
    if (e.a) { if (SS.profileOf !== e.a) { resetProfile(); SS.profileOf = e.a; } SS.fromChat = e.fromChat || null; }
    const y = SS.scroll[v]; delete SS.scroll[v];
    SS.restoring = y > 0;
    core.go(v);
    SS.restoring = false;
    if (y > 0) { const b = bodyEl(); if (b) { b.scrollTop = y; requestAnimationFrame(() => { if (S.view === v && Math.abs(b.scrollTop - y) > 2) b.scrollTop = y; }); } }
  }
  function head(ctx, title, sub, right) {
    ctx.head.innerHTML = `<button class="omx-ib" data-act="sx-back" aria-label="Back">‹</button><h2>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>${right || ''}<button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
  }

  /* ---------- FEED ---------- */
  function renderFeed(ctx) {
    ctx.head.innerHTML = `<h2>OST Mesh<small>Feed · devnet · signed &amp; public</small></h2><button class="omx-ib" data-act="sx-search" aria-label="Search people">🔍</button><button class="omx-ib osl-bell" data-act="sx-notifs" aria-label="Notifications" id="oslBell">🔔</button><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    ctx.body.innerHTML = `<div class="osl-stories" id="oslStories"></div>
      <button class="osl-cta" data-act="sx-compose">${avatar(me())}<span>What's happening, ${esc(S.profile.name || 'friend')}?</span><b>📷</b></button>
      <div class="osl-modes"><button data-act="sx-mode" data-m="all" class="${SS.mode === 'all' ? 'on' : ''}" aria-pressed="${SS.mode === 'all'}">For you</button><button data-act="sx-mode" data-m="following" class="${SS.mode === 'following' ? 'on' : ''}" aria-pressed="${SS.mode === 'following'}">Following</button></div>
      <button class="osl-newpill" id="oslNew" data-act="sx-refresh" hidden>New posts ↑</button>
      <div id="oslPosts"></div>`;
    paintBell(); paintStories();
    // Coming back from a post keeps the list (and the scroll position) as it was; otherwise refresh when stale.
    // A failed load is not retried on every re-render (8 s floor) — the error state has its own Retry button.
    if (!SS.restoring && !SS.loading && (!SS.loaded || Date.now() - (SS.loadedAt || 0) > 60000) && Date.now() - (SS.triedAt || 0) > 8000) { loadFeed(true); loadStories(); loadNotifs(); } else paintFeedList();
  }
  function paintBell() { const b = $('oslBell'); if (b) b.innerHTML = '🔔' + (SS.notifs.unread ? `<span class="omx-badge">${SS.notifs.unread > 99 ? '99+' : SS.notifs.unread}</span>` : ''); }
  function paintFeedList() {
    const el = $('oslPosts'); if (!el) return;
    const n = $('oslNew'); if (n) n.hidden = !SS.newPosts;
    const posts = SS.posts.filter((p) => !blocked(p.author));
    let h;
    if (!posts.length) {
      if (SS.loading || (!SS.loaded && !SS.err)) h = skeleton();
      else if (SS.err) h = errBox('Could not load the feed.', SS.err, 'sx-refresh');
      else h = SS.mode === 'following' ? `<div class="omx-empty"><b>🧭</b>Nothing from people you follow yet.<br><button class="omx-ghost" data-act="sx-search">Find people to follow</button></div>` : `<div class="omx-empty"><b>✨</b>No posts yet — be the first.<br><button class="omx-primary" data-act="sx-compose">Create a post</button></div>`;
    } else {
      const errBar = SS.err ? `<div class="osl-inerr" role="alert"><span>${SS.errMore ? 'Could not load more posts' : 'Could not refresh the feed'} — ${esc(SS.err)}</span><button data-act="${SS.errMore ? 'sx-more' : 'sx-refresh'}">Retry</button></div>` : '';
      h = (SS.err && !SS.errMore ? errBar : '') + posts.map(postHtml).join('');
      if (SS.loading) h += '<div class="osl-end">Loading…</div>';
      else if (SS.err && SS.errMore) h += errBar;
      else if (SS.cursor) h += '<button class="omx-ghost osl-more" data-act="sx-more">Load more</button>';
      else if (!SS.err) h += '<div class="osl-end">You are all caught up ✓</div>';
    }
    el.innerHTML = h;
    wireVideos(el);
  }
  const skeleton = () => '<div class="osl-skel"></div><div class="osl-skel"></div><div class="osl-skel"></div>';
  function mediaHtml(p) {
    const m = p.media || [];
    if (!m.length) return '';
    // Video: the box takes the stored aspect ratio before any byte loads; a play glyph sits on the poster until it plays.
    // A small video (say 320×240) keeps its own width instead of being blown up to the card (blurry poster and frames).
    if (m[0].kind === 'video') {
      const w = Math.round(Number(m[0].w)) || 0, h = Math.round(Number(m[0].h)) || 0;
      const st = w > 0 && h > 0 ? `style="aspect-ratio:${w}/${h};max-width:${Math.max(w, 280)}px"` : '';
      return `<div class="osl-media one"><div class="osl-vid" ${st}><video src="${mediaUrl(m[0].id)}" ${m[0].poster ? `poster="${mediaUrl(m[0].poster)}"` : ''} preload="metadata" controls playsinline muted loop data-autoplay></video><button class="osl-play" type="button" data-act="sx-vplay" aria-label="Play video">▶</button></div></div>`;
    }
    const n = Math.min(m.length, 4);
    // Photos are buttons for the keyboard too: Tab reaches them, Enter / Space open the viewer.
    return `<div class="osl-media n${n}">${m.slice(0, 4).map((x, i) => `<img src="${mediaUrl(x.id)}" alt="" loading="lazy" tabindex="0" role="button" aria-label="${n > 1 ? `Open photo ${i + 1} of ${n}` : 'Open photo'}" data-act="sx-lightbox" data-p="${esc(p.id)}" data-i="${i}" ${m.length === 1 ? ratio(x.w, x.h) : ''}>`).join('')}</div>`;
  }
  // Media that fails to load becomes a labelled placeholder (never the browser's broken-image glyph).
  function mediaFail(node, label) {
    if (!node || !node.parentNode) return;
    const d = document.createElement('div'); d.className = 'osl-mfail'; d.setAttribute('role', 'img'); d.setAttribute('aria-label', label);
    const st = node.getAttribute('style'); if (st && /aspect-ratio/.test(st)) d.setAttribute('style', st);
    d.innerHTML = `<b>${label === 'Video unavailable' ? '🎬' : '🖼️'}</b><span>${esc(label)}</span>`;
    node.replaceWith(d);
  }
  document.addEventListener('error', (e) => {
    const t = e.target; if (!t || t.tagName !== 'IMG' || !t.closest) return;
    const av = t.closest('.osl-av');
    if (av) { av.textContent = av.getAttribute('data-fb') || ''; return; }
    if (t.closest('.osl-media, #oslLight, .osl-stprev, .osl-pick')) mediaFail(t, 'Media unavailable');
    else if (t.closest('.osl-smedia')) mediaFail(t, 'Story unavailable');
    else if (t.closest('.osl-embed')) { const b = document.createElement('b'); b.textContent = '🔗'; t.replaceWith(b); }
  }, true);
  // Enter / Space on a focused feed photo opens the viewer, like a tap.
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented || e.repeat) return;
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || t.getAttribute('data-act') !== 'sx-lightbox' || !t.closest('#ostMeshApp')) return;
    e.preventDefault(); A['sx-lightbox'](t);
  });
  function embedHtml(e, inert) {
    if (!e) return '';
    const ico = { market: '📈', bet: '🎯', perp: '⚡', game: '🎮', wallet: '👛', stock: '💹', app: '🧩', link: '🔗' }[e.kind] || '🔗';
    const inner = `${e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<b>${ico}</b>`}<span><em>${esc(e.kind === 'bet' ? 'Prediction bet' : e.kind === 'perp' ? 'Perp position' : e.kind === 'wallet' ? 'Wallet' : e.kind === 'market' ? 'Market' : e.kind === 'app' ? 'OST app' : 'OST')}</em><strong>${esc(e.title)}</strong>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>${e.price ? `<i>${esc(e.price)}</i>` : ''}`;
    // inert = preview in the composer: a plain card, not a button that would navigate away from the draft.
    return inert ? `<div class="osl-embed">${inner}</div>` : `<button class="osl-embed" data-act="sx-embed" data-href="${esc(e.href || '')}">${inner}</button>`;
  }
  function tipsLine(p) {
    const t = p.tips || {}; const parts = Object.keys(t).filter((k) => t[k] > 0).map((k) => fmtAmt(t[k]) + ' ' + k);
    return parts.length ? `<div class="osl-tips">💸 ${esc(parts.join(' · '))} tipped${p.tipCount > 1 ? ' by ' + p.tipCount : ''}</div>` : '';
  }
  function postHtml(p) {
    const a = p.author;
    return `<article class="osl-post" data-pid="${esc(p.id)}">
      <header><button class="osl-who" data-act="sx-profile" data-a="${esc(a)}">${avatar(a)}<span><b>${esc(dname(a))}${badge(a)}</b><small>${ago(p.ts)} · ${esc(shortA(a))}</small></span></button><button class="osl-dots" data-act="sx-menu" data-p="${esc(p.id)}" aria-label="More">⋯</button></header>
      ${p.text ? `<div class="osl-text">${rich(p.text)}</div>` : ''}
      ${mediaHtml(p)}${embedHtml(p.embed)}${tipsLine(p)}
      <footer>
        <button data-act="sx-like" data-p="${esc(p.id)}" class="${p.my === 'like' ? 'on' : ''}" aria-pressed="${p.my === 'like'}" aria-label="Like, ${fmtN(p.likes)}"><i>👍</i><span>${fmtN(p.likes)}</span></button>
        <button data-act="sx-dislike" data-p="${esc(p.id)}" class="${p.my === 'dislike' ? 'on dis' : ''}" aria-pressed="${p.my === 'dislike'}" aria-label="Dislike, ${fmtN(p.dislikes)}"><i>👎</i><span>${fmtN(p.dislikes)}</span></button>
        <button data-act="sx-open" data-p="${esc(p.id)}" aria-label="Comments, ${fmtN(p.comments)}"><i>💬</i><span>${fmtN(p.comments)}</span></button>
        <button data-act="sx-tip" data-p="${esc(p.id)}" aria-label="Tip OST"><i>💸</i><span>Tip</span></button>
        <button data-act="sx-share" data-p="${esc(p.id)}" aria-label="Share"><i>↗</i></button>
      </footer></article>`;
  }
  function findPost(id) { return SS.posts.find((p) => p.id === id) || (SS.single && SS.single.id === id ? SS.single : null) || (SS.profilePosts || []).find((p) => p.id === id); }
  function updatePost(p) {
    [SS.posts, SS.profilePosts || []].forEach((list) => { const i = list.findIndex((x) => x.id === p.id); if (i >= 0) list[i] = p; });
    if (SS.single && SS.single.id === p.id) SS.single = p;
    document.querySelectorAll('#ostMeshApp .osl-post[data-pid="' + p.id + '"]').forEach((el) => { const tmp = document.createElement('div'); tmp.innerHTML = postHtml(p); el.replaceWith(tmp.firstElementChild); });
    wireVideos(document.getElementById('ostMeshApp'));
  }
  // Autoplay videos muted while on screen; pause off screen.
  let vidIO = null;
  function wireVideos(root) {
    if (!root || !('IntersectionObserver' in window)) return;
    vidIO = vidIO || new IntersectionObserver((es) => es.forEach((e) => { const v = e.target; if (!v.isConnected) { vidIO.unobserve(v); return; } if (e.isIntersecting && e.intersectionRatio > 0.6) { if (v.paused && v.muted) v.play().catch(() => {}); } else if (!v.paused) v.pause(); }), { threshold: [0, 0.6] });
    root.querySelectorAll('video[data-autoplay]').forEach((v) => {
      if (v.__io) return; v.__io = 1; vidIO.observe(v);
      const box = v.closest('.osl-vid');
      // media events do not bubble: wire the play-glyph and the "Video unavailable" state per element
      v.addEventListener('playing', () => { if (box) box.classList.add('playing'); });
      v.addEventListener('pause', () => { if (box) box.classList.remove('playing'); });
      const fail = () => { try { vidIO.unobserve(v); } catch (_) {} mediaFail(box || v, 'Video unavailable'); };
      v.addEventListener('error', fail);
      if (v.error) fail();
    });
  }

  /* ---------- reactions / comments ---------- */
  async function react(id, kind) {
    const p = findPost(id); if (!p) return;
    if (!S.announced) await core.announce();
    const prev = p.my; const np = Object.assign({}, p);
    if (prev === 'like') np.likes--; if (prev === 'dislike') np.dislikes--;
    if (prev !== kind) { np.my = kind; if (kind === 'like') np.likes++; else np.dislikes++; } else np.my = '';
    updatePost(np);
    try { const r = await signed('POST', '/mesh/v1/social/react', { from: me(), postId: id, kind }); updatePost(Object.assign({}, np, { likes: r.likes, dislikes: r.dislikes, my: r.my })); }
    catch (e) { updatePost(p); toast(emsg(e), 'err'); }
  }
  async function openPost(id) {
    SS.postId = id; SS.single = findPost(id) || null;
    go('post');
    if (!SS.single) await loadSingle(id);
    loadComments(id);
  }
  // A post that cannot be fetched is "gone" only when the hub says so; network trouble gets a Retry.
  async function loadSingle(id) {
    SS.single = null; paintPost();
    try { const j = await getJ('/mesh/v1/social/post?id=' + encodeURIComponent(id) + '&me=' + encodeURIComponent(me() || '')); if (SS.postId !== id) return; absorb(j.authors); SS.single = (j.posts || [])[0] || { missing: 'not found' }; }
    catch (e) { if (SS.postId !== id) return; SS.single = (e.net || e.status >= 500 || e.status === 429) ? { failed: e.message } : { missing: e.message }; }
    paintPost();
  }
  function renderPostView(ctx) {
    head(ctx, 'Post', '');
    ctx.body.innerHTML = `<div id="oslSingle"></div><div class="osl-comments" id="oslComments"></div>
      <div class="osl-cbox"><textarea id="oslCText" rows="1" maxlength="500" placeholder="Write a comment…" aria-label="Write a comment"></textarea><button class="omx-ib omx-send" data-act="sx-comment" aria-label="Send comment">➤</button></div>`;
    paintPost(); paintComments();
  }
  function paintPost() {
    const el = $('oslSingle'); if (!el) return; const p = SS.single;
    el.innerHTML = !p ? skeleton() : p.failed ? errBox('Could not load this post.', p.failed, 'sx-retry-post') : p.missing ? `<div class="omx-empty"><b>🗑️</b>This post is gone (${esc(p.missing)}).</div>` : postHtml(p);
    wireVideos(el);
  }
  async function loadComments(id) {
    delete SS.commentsErr[id]; if (SS.postId === id) paintComments();
    try { const j = await getJ('/mesh/v1/social/comments?postId=' + encodeURIComponent(id)); absorb(j.authors); SS.comments[id] = j.comments || []; }
    catch (e) { SS.commentsErr[id] = e.message || 'unavailable'; }
    if (SS.postId === id) paintComments();
  }
  function paintComments() {
    const el = $('oslComments'); if (!el) return;
    const all = SS.comments[SS.postId], err = SS.commentsErr[SS.postId];
    const list = all && all.filter((c) => !blocked(c.author));   // hidden people stay hidden here too
    if (!list) { el.innerHTML = err ? errBox('Could not load comments.', err, 'sx-retry-comments') : '<div class="osl-end">Loading comments…</div>'; return; }
    const post = SS.single;
    el.innerHTML = (err ? `<div class="osl-inerr" role="alert"><span>Could not refresh comments — ${esc(err)}</span><button data-act="sx-retry-comments">Retry</button></div>` : '') +
      (list.length ? list.map((c) => `<div class="osl-cm"><button data-act="sx-profile" data-a="${esc(c.author)}" aria-label="Open profile">${avatar(c.author, 'sm')}</button><div><b>${esc(dname(c.author))}${badge(c.author)}</b> <small>${ago(c.ts)}</small><p>${rich(c.text)}</p></div>${c.author === me() || (post && post.author === me()) ? `<button class="osl-x" data-act="sx-cdel" data-c="${esc(c.id)}" aria-label="Delete comment">✕</button>` : ''}</div>`).join('') : '<div class="osl-end">No comments yet — start the conversation.</div>');
  }
  async function sendComment() {
    const ta = $('oslCText'); const text = (ta && ta.value || '').trim(); if (!text) return;
    ta.value = ''; ta.disabled = true;
    try {
      if (!S.announced) await core.announce();
      const r = await signed('POST', '/mesh/v1/social/comment', { from: me(), postId: SS.postId, text });
      absorb(r.authors); (SS.comments[SS.postId] = SS.comments[SS.postId] || []).push(r.comment);
      const p = findPost(SS.postId); if (p) updatePost(Object.assign({}, p, { comments: r.comments }));
      paintComments(); const el = $('oslComments'); if (el) el.lastElementChild && el.lastElementChild.scrollIntoView({ block: 'nearest' });
    } catch (e) { ta.value = text; toast(emsg(e), 'err'); }
    ta.disabled = false; try { ta.focus(); } catch (_) {}
  }

  /* ---------- media helpers ---------- */
  const isHeic = (f) => /hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');
  async function imageToUpload(file, edge) {
    if (isHeic(file)) throw new Error('HEIC photos are not supported here yet — pick a JPEG or PNG (or share a screenshot of it).');
    if (/gif$/.test(file.type)) {
      // GIFs upload as-is (re-encoding would drop the animation), so the hub's 10 MB image limit applies to the file itself.
      if (file.size > IMG_MAX) throw new Error('GIFs up to 10 MB — this one is ' + core.fmtSize(file.size) + '.');
      const bmp0 = await createImageBitmap(file).catch(() => null);
      if (!bmp0) throw new Error('That GIF could not be read — try another file.');
      return { blob: file, mime: file.type, w: bmp0.width, h: bmp0.height };
    }
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (_) { throw new Error('That image format is not supported — pick a JPEG, PNG, WebP or GIF.'); }
    const sc = Math.min(1, (edge || IMG_EDGE) / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
    return { blob: blob || file, mime: blob ? 'image/jpeg' : file.type, w: cv.width, h: cv.height };
  }
  function videoInfo(file) {
    return new Promise((res) => {
      const v = document.createElement('video'); const url = URL.createObjectURL(file);
      let done = false; const fin = (o) => { if (done) return; done = true; URL.revokeObjectURL(url); res(o); };
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (_) { fin({ w: v.videoWidth, h: v.videoHeight, dur: v.duration, poster: null }); } };
      v.onseeked = () => { try { const sc = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight)); const cv = document.createElement('canvas'); cv.width = Math.round(v.videoWidth * sc); cv.height = Math.round(v.videoHeight * sc); cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); cv.toBlob((b) => fin({ w: v.videoWidth, h: v.videoHeight, dur: v.duration, poster: b }), 'image/jpeg', 0.8); } catch (_) { fin({ w: v.videoWidth, h: v.videoHeight, dur: v.duration, poster: null }); } };
      v.onerror = () => fin({ w: 0, h: 0, dur: 0, poster: null });
      setTimeout(() => fin({ w: v.videoWidth || 0, h: v.videoHeight || 0, dur: v.duration || 0, poster: null }), 8000);
    });
  }
  async function upload(blob, mime, purpose, w, h) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const r = await signed('POST', '/mesh/v1/social/media?mime=' + encodeURIComponent(mime) + '&purpose=' + purpose + '&w=' + (w || 0) + '&h=' + (h || 0), bytes);
    return r.id;
  }
  // Upload a picked file; returns { id, poster? }.
  async function uploadPicked(item, purpose) {
    if (item.kind === 'video') {
      const id = await upload(item.file, item.file.type || 'video/mp4', purpose, item.w, item.h);
      let poster = '';
      if (item.posterBlob) { try { poster = await upload(item.posterBlob, 'image/jpeg', purpose, item.w, item.h); } catch (_) {} }
      return { id, poster };
    }
    return { id: await upload(item.blob, item.mime, purpose, item.w, item.h) };
  }
  async function pickToItem(file) {
    if (/^video\//.test(file.type)) {
      if (file.size > VID_MAX) throw new Error('Videos up to 40 MB — trim it or record a shorter clip.');
      if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) throw new Error('Use an MP4, WebM or MOV video.');
      const info = await videoInfo(file);
      return { kind: 'video', file, w: info.w, h: info.h, dur: info.dur, posterBlob: info.poster, url: URL.createObjectURL(file), size: file.size };
    }
    if (!/^image\//.test(file.type) && !isHeic(file)) throw new Error('Pick a photo or a video.');
    const img = await imageToUpload(file);
    return { kind: 'image', blob: img.blob, mime: img.mime, w: img.w, h: img.h, url: URL.createObjectURL(img.blob), size: img.blob.size };
  }

  /* ---------- COMPOSER ---------- */
  const picksHtml = (d) => d.media.map((m, i) => `<div class="osl-pick">${m.kind === 'video' ? `<video src="${m.url}" muted playsinline></video><i>🎬</i>` : `<img src="${m.url}" alt="">`}<button data-act="sx-unpick" data-i="${i}" aria-label="Remove">✕</button></div>`).join('') + (d.adding ? '<div class="osl-pick osl-pickwait" aria-label="Adding…"></div>' : '');
  // Post is enabled only when there is something to post and the text fits the 2000 limit.
  const draftLen = (d) => (d.text || '').trim().length;
  const draftOk = (d) => !d.busy && draftLen(d) <= TEXT_MAX && (draftLen(d) > 0 || d.media.length > 0 || !!d.embed);
  // The visible counter updates on every keystroke but is not a live region; a separate screen-reader line speaks
  // only when the post crosses into "near the limit" or "over the limit" (or back under it).
  function paintComposeState() {
    const d = SS.draft, n = draftLen(d), c = $('oslCount');
    const lvl = n > TEXT_MAX ? 'over' : n > TEXT_MAX - 100 ? 'near' : 'ok';
    if (c) { c.textContent = n > TEXT_MAX ? (n - TEXT_MAX) + ' over the ' + TEXT_MAX + ' character limit' : n + ' / ' + TEXT_MAX; c.classList.toggle('over', lvl === 'over'); c.classList.toggle('near', lvl === 'near'); }
    const live = $('oslCountLive');
    if (live && d.countLvl !== lvl) {
      live.textContent = lvl === 'over' ? 'Your post is ' + (n - TEXT_MAX) + ' characters over the ' + TEXT_MAX + ' character limit.' : lvl === 'near' ? (TEXT_MAX - n) + ' characters left.' : d.countLvl === 'over' ? 'Back under the character limit.' : '';
    }
    if (live) d.countLvl = lvl;
    const b = document.querySelector('#ostMeshApp .osl-postbtn'); if (b) b.disabled = !draftOk(d);
  }
  function paintPicks() { const el = $('oslPicks'); if (el) el.innerHTML = picksHtml(SS.draft); paintComposeState(); }
  function renderCompose(ctx) {
    const d = SS.draft;
    head(ctx, 'New post', d.busy || '', `<button class="osl-postbtn" data-act="sx-publish" ${draftOk(d) ? '' : 'disabled'}>${d.busy ? '…' : 'Post'}</button>`);
    ctx.body.innerHTML = `<div class="osl-comp">${avatar(me())}<textarea id="oslText" placeholder="Share something with OST Mesh…" aria-label="Post text" aria-describedby="oslCount" ${d.busy ? 'disabled' : ''}>${esc(d.text)}</textarea></div>
      <div class="osl-count" id="oslCount"></div><div class="osl-sr" id="oslCountLive" aria-live="polite" aria-atomic="true"></div>
      <div class="osl-picks" id="oslPicks">${picksHtml(d)}</div>
      ${d.embed ? `<div class="osl-attached">${embedHtml(d.embed, true)}<button data-act="sx-unembed" aria-label="Remove attachment">✕</button></div>` : ''}
      <div class="osl-tools">
        <label class="omx-ghost">📷 Photos<input type="file" id="oslPickImg" accept="image/*" multiple hidden></label>
        <label class="omx-ghost">🎬 Video<input type="file" id="oslPickVid" accept="video/mp4,video/webm,video/quicktime,video/*" hidden></label>
        <button class="omx-ghost" data-act="sx-attach">📎 Attach from OST</button>
      </div>
      <div id="oslAttachList"></div>
      <div class="omx-note">Posts are public and signed with your mesh key. Up to 4 photos or 1 video (≤ 40 MB). Everyone on OST Mesh can see them.</div>`;
    paintComposeState();
    const ta = $('oslText'); if (ta) { ta.addEventListener('input', () => { d.text = ta.value; paintComposeState(); }); if (!d.busy) setTimeout(() => { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }, 50); }
    ['oslPickImg', 'oslPickVid'].forEach((id) => { const inp = $(id); if (inp) inp.addEventListener('change', () => { const files = Array.from(inp.files || []); inp.value = ''; if (files.length) addPicks(files); }); });
  }
  // Picks are decoded one batch at a time: overlapping selections can no longer both pass the "fewer than 4" check.
  let pickChain = Promise.resolve();
  function addPicks(files) {
    const d = SS.draft; d.adding = (d.adding || 0) + 1; paintPicks();
    pickChain = pickChain.then(async () => {
      let capped = false;
      const full = (isVid) => {
        if (d.media.some((m) => m.kind === 'video') || (isVid && d.media.length)) { toast('A post has either up to 4 photos or one video.', 'err'); return true; }
        if (d.media.length >= PHOTO_MAX) { capped = true; return true; }
        return false;
      };
      for (const f of files) {
        if (SS.draft !== d) break;   // the draft was posted or replaced while this batch waited
        if (full(/^video\//.test(f.type))) break;
        let item; try { item = await pickToItem(f); } catch (e) { toast(emsg(e), 'err'); continue; }
        // re-check after the await: the draft may have changed while the file was being read
        if (SS.draft !== d || full(item.kind === 'video')) { try { URL.revokeObjectURL(item.url); } catch (_) {} break; }
        d.media.push(item);
      }
      d.adding = Math.max(0, (d.adding || 1) - 1);
      if (capped) toast('Up to 4 photos', 'err');
      if (SS.draft === d && S.view === 'compose') paintPicks();
    }).catch(() => {});
  }
  function attachOptions() {
    const out = [];
    try { const m = window.OST_PREDICT_MOBILE && OST_PREDICT_MOBILE.current && OST_PREDICT_MOBILE.current(); if (m) out.push(marketEmbed(m)); } catch (_) {}
    try {
      const orders = JSON.parse(localStorage.getItem('ost.prediction.orders.v1') || '[]');
      const o = Array.isArray(orders) ? orders.slice().reverse().find((x) => x && (x.marketId || x.title)) : null;
      if (o) out.push({ kind: 'bet', title: String(o.title || o.marketTitle || o.question || 'Prediction ticket').slice(0, 140), sub: (String(o.side || o.outcome || '').toUpperCase() + ' · ' + fmtAmt(o.stake || o.amount || 0) + ' OST · ' + (o.status || 'open')).slice(0, 160), href: o.marketId ? '#market=' + encodeURIComponent(o.marketId) : '#markets', price: o.price ? Math.round(Number(o.price) * (Number(o.price) <= 1 ? 100 : 1)) + '¢' : '', side: String(o.side || '').slice(0, 12) });
    } catch (_) {}
    try { const ps = window.OST_PERPS && OST_PERPS.state && OST_PERPS.state().positions; const p = ps && ps[0]; if (p) out.push({ kind: 'perp', title: String(p.symbol) + ' ' + String(p.side || '').toUpperCase() + ' ' + (p.leverage || '') + 'x', sub: 'Margin ' + fmtAmt(p.margin) + ' OSTG · entry ' + fmtAmt(p.entryPrice), href: '#perp=' + encodeURIComponent(p.symbol) }); } catch (_) {}
    if (window.OST_WALLET_PUBKEY) out.push({ kind: 'wallet', title: 'Send me OST on devnet', sub: 'Tap to open my profile and tip', href: '#u=' + me() });
    return out;
  }
  function marketEmbed(m) {
    const title = String(m.title || m.question || m.contractLabel || 'Market').slice(0, 140);
    let yes = ''; try { const y = Number(m.yesPrice != null ? m.yesPrice : (m.outcomePrices && JSON.parse(m.outcomePrices)[0])); if (y > 0) yes = 'Yes ' + Math.round(y <= 1 ? y * 100 : y) + '¢'; } catch (_) {}
    let img = ''; try { img = (m.image && /^https:\/\//.test(m.image)) ? m.image : ''; } catch (_) {}
    return { kind: 'market', title, sub: (m.source ? m.source[0].toUpperCase() + m.source.slice(1) : 'OST') + ' prediction market', href: '#market=' + encodeURIComponent(m.id || ''), img, price: yes };
  }
  async function publish() {
    const d = SS.draft; if (d.busy) return;
    const ta = $('oslText'); if (ta) d.text = ta.value;
    const n = draftLen(d);
    // Nothing is cut silently: an over-long post is refused with the exact overshoot.
    if (n > TEXT_MAX) { toast('Your post is ' + (n - TEXT_MAX) + ' characters over the ' + TEXT_MAX + ' limit.', 'err'); paintComposeState(); return; }
    if (!n && !d.media.length && !d.embed) { toast('Write something or add a photo.', 'err'); return; }
    if (d.adding) { toast('Still adding your photos — one moment.'); return; }
    if (!d.media.some((m) => m.kind === 'video') && d.media.length > PHOTO_MAX) { d.media.splice(PHOTO_MAX).forEach((m) => { try { URL.revokeObjectURL(m.url); } catch (_) {} }); toast('Up to 4 photos', 'err'); }
    try {
      if (!S.announced) await core.announce();
      const items = d.media.slice(0, PHOTO_MAX), media = [];
      for (let i = 0; i < items.length; i++) { d.busy = `Uploading ${i + 1}/${items.length} (${core.fmtSize(items[i].size || 0)})…`; core.render(); media.push(await uploadPicked(items[i], 'post')); }
      d.busy = 'Publishing…'; core.render();
      const r = await signed('POST', '/mesh/v1/social/post', { from: me(), text: d.text.trim(), media, embed: d.embed });
      absorb(r.authors);
      SS.posts = (r.posts || []).concat(SS.posts);
      d.media.forEach((m) => { try { URL.revokeObjectURL(m.url); } catch (_) {} });
      SS.draft = { text: '', media: [], embed: null, busy: '' };
      toast('Posted ✓'); SS.stack = []; dropLinks(); SS.scroll = {}; core.go('feed');
      const b = bodyEl(); if (b) b.scrollTop = 0;
    } catch (e) { d.busy = ''; if (S.view === 'compose') core.render(); toast(emsg(e, 'Post failed'), 'err'); }
  }

  /* ---------- STORIES ---------- */
  function paintStories() {
    const el = $('oslStories'); if (!el) return;
    const mine = SS.stories.find((g) => g.author === me());
    let h = `<button class="osl-st me" data-act="${mine ? 'sx-story' : 'sx-story-add'}" data-a="${esc(me())}"><span class="osl-ring ${mine ? '' : 'none'}">${avatar(me())}</span>${mine ? '' : '<i>＋</i>'}<small>Your story</small></button>`;
    if (mine) h += `<button class="osl-st" data-act="sx-story-add"><span class="osl-ring none"><span class="osl-av">＋</span></span><small>Add</small></button>`;
    h += SS.stories.filter((g) => g.author !== me() && !blocked(g.author)).map((g) => `<button class="osl-st" data-act="sx-story" data-a="${esc(g.author)}" aria-label="${esc(dname(g.author))}'s story"><span class="osl-ring ${g.items.every((s) => s.seen) ? 'seen' : ''}">${avatar(g.author)}</span><small>${esc(dname(g.author))}</small></button>`).join('');
    // Stories that failed to load say so (with a retry) instead of looking like "nobody posted a story".
    if (SS.storiesErr) h += `<button class="osl-st osl-st-err" data-act="sx-stories-retry" title="Stories could not load (${esc(SS.storiesErr)}) — tap to retry" aria-label="Stories could not load — retry"><span class="osl-ring none"><span class="osl-av">↻</span></span><small>Retry</small></button>`;
    el.innerHTML = h + '<input type="file" id="oslStoryPick" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>';
    const inp = $('oslStoryPick'); if (inp) inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) storyCompose(f); });
  }
  async function storyCompose(file) {
    let item; try { item = await pickToItem(file); } catch (e) { toast(emsg(e), 'err'); return; }
    sheet(`<h3>New story</h3><div class="osl-stprev">${item.kind === 'video' ? `<video src="${item.url}" autoplay muted loop playsinline></video>` : `<img src="${item.url}" alt="">`}</div>
      <input class="omx-input" id="oslStCap" maxlength="200" placeholder="Add a caption (optional)" aria-label="Caption">
      <div class="omx-row2" style="margin-top:10px"><button class="omx-primary" id="oslStGo">Share for 24 hours</button><button class="omx-ghost" data-sheet="close">Cancel</button></div>
      <div class="omx-note">Stories are public and disappear after 24 hours.</div>`, { onClose: () => { try { URL.revokeObjectURL(item.url); } catch (_) {} } });
    $('oslStGo').onclick = async () => {
      const b = $('oslStGo'); b.disabled = true; b.textContent = 'Uploading…';
      try {
        if (!S.announced) await core.announce();
        const up = await uploadPicked(item, 'story');
        await signed('POST', '/mesh/v1/social/story', { from: me(), media: { id: up.id, poster: up.poster || '' }, caption: ($('oslStCap') || {}).value || '' });
        closeSheet(); toast('Story shared ✓'); loadStories();
      } catch (e) { b.disabled = false; b.textContent = 'Share for 24 hours'; toast(emsg(e), 'err'); }
    };
  }
  // Story viewer: full screen on phones, a centred 9:16 card on desktop (bars, header, caption and reply box live inside the card).
  const SV = { groups: [], gi: 0, ii: 0, timer: null, dur: 0, paused: false, downAt: 0, heldUntil: 0, sending: false, author: '', drafts: {}, replyTo: '' };
  function openStories(author) {
    const groups = SS.stories.filter((g) => !blocked(g.author));
    const gi = groups.findIndex((g) => g.author === author); if (gi < 0) return;
    SV.groups = groups; SV.gi = gi; SV.ii = Math.max(0, groups[gi].items.findIndex((s) => !s.seen)); SV.author = author;
    let el = $('oslStory');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslStory';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Stories'); el.tabIndex = -1;
      document.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target === el) { closeStories(); return; } onStoryClick(e); });
      // Hold to pause. Releasing a hold must not count as a tap on the previous/next zones.
      const holdable = (t) => !(t && t.closest && t.closest('.osl-sfoot, .osl-shead button, .osl-sarrow'));
      el.addEventListener('pointerdown', (e) => { if (!holdable(e.target)) return; SV.paused = true; SV.downAt = Date.now(); });
      const release = () => { if (!SV.paused) return; SV.paused = false; if (Date.now() - SV.downAt > 280) SV.heldUntil = Date.now() + 400; };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('pointerleave', release);
      el.addEventListener('contextmenu', (e) => { if (!(e.target.closest && e.target.closest('input'))) e.preventDefault(); });
    }
    SV.paused = false; SV.heldUntil = 0;
    el.classList.add('on'); ovPush(el, closeStories, storyKey);
    showStory();
  }
  // Arrow keys change stories — but never while the user is typing a reply.
  function storyKey(e) {
    const t = e.target, typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { if (typing) return false; if (e.key === 'ArrowRight') stNext(); else stPrev(); return true; }
    if (e.key === 'Enter' && !e.isComposing && t && t.id === 'oslSReply') { const g = SV.groups[SV.gi]; if (g) replyStory(g); return true; }
    return false;
  }
  function closeStories() {
    const el = $('oslStory'); clearInterval(SV.timer); SV.timer = null;
    const ri = $('oslSReply'); if (ri && SV.replyTo) SV.drafts[SV.replyTo] = ri.value;   // an unsent reply is still there next time
    SV.replyTo = '';
    paintStories();
    if (el) { el.classList.remove('on'); el.innerHTML = ''; ovPop(el, () => document.querySelector('#oslStories [data-act="sx-story"][data-a="' + SV.author + '"]')); }
  }
  function showStory() {
    const el = $('oslStory'); const g = SV.groups[SV.gi]; if (!g) return closeStories();
    const s = g.items[SV.ii]; if (!s) return closeStories();
    const mine = g.author === me();
    // A reply being typed survives the redraw: it is kept per author and comes back on that author's next story.
    const prevIn = $('oslSReply'), hadFocus = !!(prevIn && document.activeElement === prevIn);
    if (prevIn && SV.replyTo) SV.drafts[SV.replyTo] = prevIn.value;
    SV.replyTo = mine ? '' : g.author;
    el.innerHTML = `<button class="osl-sarrow prev" data-st="prev" aria-label="Previous story">‹</button>
      <div class="osl-scard">
        <div class="osl-sbars">${g.items.map((x, i) => `<i><b style="width:${i < SV.ii ? 100 : 0}%" ${i === SV.ii ? 'id="oslSBar"' : ''}></b></i>`).join('')}</div>
        <div class="osl-shead">${avatar(g.author, 'sm')}<b>${esc(dname(g.author))}</b><small>${ago(s.ts)}</small><button data-st="close" aria-label="Close stories">✕</button></div>
        <div class="osl-smedia">${s.media.kind === 'video' ? `<video id="oslSVid" src="${mediaUrl(s.media.id)}" ${s.media.poster ? `poster="${mediaUrl(s.media.poster)}"` : ''} autoplay playsinline></video>` : `<img src="${mediaUrl(s.media.id)}" alt="" draggable="false">`}</div>
        <div class="osl-snav"><button data-st="prev" aria-label="Previous" tabindex="-1"></button><button data-st="next" aria-label="Next" tabindex="-1"></button></div>
        ${s.caption ? `<div class="osl-scap">${esc(s.caption)}</div>` : ''}
        <div class="osl-sfoot">${mine ? `<span>👁 ${fmtN(s.views || 0)} views</span><button data-st="del">Delete</button>` : `<input id="oslSReply" placeholder="Reply to ${esc(dname(g.author))}…" maxlength="300" autocomplete="off" enterkeyhint="send" aria-label="Reply to ${esc(dname(g.author))}"><button data-st="reply" aria-label="Send reply">➤</button>`}</div>
      </div>
      <button class="osl-sarrow next" data-st="next" aria-label="Next story">›</button>`;
    const rIn = $('oslSReply');
    if (rIn && SV.drafts[g.author]) { rIn.value = SV.drafts[g.author]; if (hadFocus) { try { rIn.focus({ preventScroll: true }); } catch (_) {} } }
    if (!el.contains(document.activeElement) && !document.querySelector('#oslSheet.on') && !callUp()) { try { el.focus({ preventScroll: true }); } catch (_) {} }
    s.seen = true;
    if (!mine && me()) signed('POST', '/mesh/v1/social/story/view', { from: me(), storyId: s.id }).catch(() => {});
    clearInterval(SV.timer); SV.dur = 5000; let elapsed = 0, last = Date.now();
    let v = $('oslSVid');
    if (v) {
      const vid = v;
      vid.muted = false; vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      vid.onloadedmetadata = () => { SV.dur = Math.min(30000, (vid.duration || 5) * 1000); };
      vid.onended = () => { if (v === vid) stNext(); };
      vid.onerror = () => { if (v === vid) v = null; mediaFail(vid, 'Story unavailable'); };
    }
    SV.timer = setInterval(() => {
      const now = Date.now();
      // paused while held, while a reply is being typed or waits unsent in the box (a story moving on would take it
      // away), while a confirm sheet or a call screen is up, or while the tab is hidden
      const ri = $('oslSReply');
      const hold = SV.paused || document.hidden || !!document.querySelector('#oslSheet.on, #omxCall') || !!(ri && (document.activeElement === ri || ri.value.trim()));
      if (!hold) elapsed += now - last; last = now;
      if (v) { if (hold && !v.paused) { v.pause(); v.__held = 1; } else if (!hold && v.__held) { v.__held = 0; v.play().catch(() => {}); } }
      const bar = $('oslSBar'); if (bar) bar.style.width = Math.min(100, elapsed / SV.dur * 100) + '%';
      if (!v && elapsed >= SV.dur) stNext();
      else if (v && elapsed >= 30000) stNext();
    }, 100);
  }
  function stNext() { const g = SV.groups[SV.gi]; if (!g) return closeStories(); if (SV.ii < g.items.length - 1) SV.ii++; else if (SV.gi < SV.groups.length - 1) { SV.gi++; SV.ii = 0; } else return closeStories(); showStory(); }
  function stPrev() { if (SV.ii > 0) SV.ii--; else if (SV.gi > 0) { SV.gi--; SV.ii = SV.groups[SV.gi].items.length - 1; } showStory(); }
  async function onStoryClick(e) {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.getAttribute('data-st'); const g = SV.groups[SV.gi]; const s = g && g.items[SV.ii];
    if (k === 'close') closeStories();
    else if (k === 'next' || k === 'prev') { if (Date.now() < SV.heldUntil) { SV.heldUntil = 0; return; } if (k === 'next') stNext(); else stPrev(); }
    else if (k === 'del' && s) {
      if (!(await askSheet({ title: 'Delete this story?', body: 'It disappears for everyone right away.', ok: 'Delete story', danger: true }))) return;
      try {
        await signed('POST', '/mesh/v1/social/story/delete', { from: me(), storyId: s.id });
        const i = g.items.indexOf(s); if (i >= 0) g.items.splice(i, 1);
        toast('Story deleted');
        if (!g.items.length) { SS.stories = SS.stories.filter((x) => x !== g); closeStories(); }
        else { if (SV.groups[SV.gi] === g) SV.ii = Math.min(SV.ii, g.items.length - 1); showStory(); }
      } catch (err) { toast(emsg(err), 'err'); }
    }
    else if (k === 'reply' && g) replyStory(g);
  }
  // A story reply is a private, end-to-end encrypted message. Someone who is not a contact yet needs a contact
  // request first, so the user is asked — and the reply is sent without ever leaving the story.
  async function replyStory(g) {
    const inp = $('oslSReply'); const text = ((inp && inp.value) || '').trim(); if (!text || SV.sending) return;
    const a = g.author, who = dname(a), c = core.contact(a);
    if (c && c.state === 'blocked') { toast('You blocked ' + who + ' — unblock them in Chats to reply.', 'err'); return; }
    // same rule as the profile's Message button: friends, sent requests and people who wrote first can be messaged as is
    const known = !!c && (c.state === 'friend' || c.state === 'pending-out' || c.state === 'request');
    const incoming = !!c && c.state === 'pending-in';
    if (!known) {
      const ok = await askSheet({
        title: 'Reply privately to ' + who + '?',
        body: incoming ? who + ' already asked to connect — replying accepts their request. Your reply is a private, end-to-end encrypted message.' : 'This sends them a contact request. Your reply is a private, end-to-end encrypted message they see when they open OST Mesh.',
        ok: 'Send reply'
      });
      if (!ok) return;
    }
    SV.sending = true;
    let sending = false;
    try {
      if (!S.announced) await core.announce();
      const how = known ? 'known' : await connectQuietly(a, incoming);
      const body = '↩︎ Replied to your story: ' + text;
      sending = true;
      await core.sendInner(a, { k: 'text', text: body }, { kind: 'text', text: body });
      sentDraft(a, text);
      toast(how === 'known' ? 'Reply sent privately to ' + who : how === 'accepted' ? 'Reply sent — you and ' + who + ' are now connected' : 'Reply sent to ' + who + ' with a contact request');
    } catch (err) {
      // A network hiccup leaves the reply in the core's outbox (it sends by itself later); anything else failed for good
      // and the text stays in the box (the story waits while it does).
      if (sending && err && err.transient && typeof core.flushOutbox === 'function') { sentDraft(a, text); toast((navigator.onLine === false ? 'You are offline' : 'The hub could not be reached') + ' — your reply to ' + who + ' is saved and sends automatically.'); }
      else toast(emsg(err, 'Reply failed'), 'err');
    }
    SV.sending = false;
  }
  // The reply left: empty its box (if it is still on screen) and its saved draft.
  function sentDraft(a, text) {
    const cur = $('oslSReply'); if (cur && SV.replyTo === a && cur.value.trim() === text) cur.value = '';
    if (SV.drafts[a] && SV.drafts[a].trim() === text) SV.drafts[a] = '';
  }
  // Contact request (or accepting theirs) without opening the chat thread, unlike core.addPerson.
  // Resolves 'accepted' (their request was accepted) or 'requested' (a request of ours went out).
  async function connectQuietly(addr, incoming) {
    const existing = core.contact(addr);
    const rec = await core.lookup(addr);
    if (!rec || !rec.bundle) throw new Error(dname(addr) + ' has not opened OST Mesh yet — try again later.');
    const u = user(addr), prof = { name: S.profile.name || '', emoji: S.profile.emoji || '' };
    const patch = { bundle: rec.bundle, fp: rec.fingerprint || '', name: (existing && existing.name) || u.name || (rec.profile && rec.profile.name) || '', emoji: (existing && existing.emoji) || u.emoji || (rec.profile && rec.profile.emoji) || '', ts: Date.now() };
    if (incoming) {
      // Their request may be gone by now (withdrawn, or this device's copy is stale): the hub answers 409
      // no_pending_request, and a request of ours goes out instead.
      try {
        await signed('POST', '/mesh/v1/friend/respond', { wallet: me(), other: addr, action: 'accept', profile: prof });
        core.upsertContact(addr, Object.assign(patch, { state: 'friend' }));
        return 'accepted';
      } catch (e) { if (!(e && (e.code === 'no_pending_request' || (e.status === 409 && /no.?pending/i.test(e.message || ''))))) throw e; }
    }
    const r = await signed('POST', '/mesh/v1/friend/request', { from: me(), to: addr, profile: prof });
    const ok = r && r.state === 'accepted';
    core.upsertContact(addr, Object.assign(patch, { state: ok ? 'friend' : 'pending-out' }));
    return ok ? 'accepted' : 'requested';
  }

  /* ---------- PROFILE ---------- */
  function resetProfile() { SS.profileUser = null; SS.profilePosts = null; SS.profilePostsOf = null; SS.profilePostsErr = ''; SS.profileAt = 0; }
  function openProfile(addr) {
    if (!addr) return;
    const view = addr === me() ? 'me' : 'profile';
    if (S.view === view && SS.profileOf === addr) return;   // already on screen
    const depth = SS.stack.length;
    remember(view, view === 'profile');   // profile → another profile is a step Back can undo
    SS.fromChat = null; S.profileOf = null; resetProfile(); SS.profileOf = addr;
    core.go(view);
    const b = bodyEl(); if (b) b.scrollTop = 0;
    if (SS.stack.length > depth && !SS.hashNav) linkStep(depth, false);
  }
  async function loadProfile(addr) {
    const cur = () => SS.profileOf === addr, shown = () => cur() && (S.view === 'profile' || S.view === 'me');
    try { const j = await getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(addr) + '&me=' + encodeURIComponent(me() || '')); absorb({ [addr]: j.user }); if (cur()) SS.profileUser = j; }
    catch (e) { if (cur()) SS.profileUser = { err: e.message || 'unavailable' }; }
    if (shown()) paintProfile();
    try { const j = await getJ('/mesh/v1/social/feed?author=' + encodeURIComponent(addr) + '&limit=20&me=' + encodeURIComponent(me() || '')); absorb(j.authors); if (cur()) { SS.profilePosts = j.posts || []; SS.profilePostsOf = addr; SS.profilePostsErr = ''; } }
    catch (e) { if (cur()) { SS.profilePostsOf = addr; SS.profilePostsErr = e.message || 'unavailable'; } }
    if (shown()) paintProfile();
  }
  // Header: the person's name once it is known, with the short address once (never the address twice).
  function profileTitle(addr, self) {
    const name = user(addr).name;
    if (self) return 'OST Mesh<small>Me</small>';   // a tab: the one header brand, like Feed / Chats / Add
    return name ? `${esc(name)}<small>${esc(shortA(addr))}</small>` : esc(shortA(addr));
  }
  function renderProfile(ctx, self) {
    // The core asks for a person through S.profileOf (chat header → profile). That request wins over whoever was viewed before.
    const asked = !self && S.profileOf ? S.profileOf : null;
    if (asked) { SS.fromChat = S.peer === asked ? asked : null; S.profileOf = null; if (SS.fromChat) { SS.stack = []; dropLinks(); } }   // Back from here returns to that chat
    const addr = self ? me() : (asked || SS.profileOf);
    if (!addr) { ctx.body.innerHTML = '<div class="omx-empty">Loading your identity…</div>'; return; }
    if (SS.profileOf !== addr) resetProfile();
    SS.profileOf = addr;
    if (self) ctx.head.innerHTML = `<h2>${profileTitle(addr, true)}</h2><button class="omx-ib" data-act="sx-settings" aria-label="Settings">⚙️</button><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    else { head(ctx, '', ''); const h2 = ctx.head.querySelector('h2'); if (h2) h2.innerHTML = profileTitle(addr, false); }
    ctx.body.innerHTML = '<div id="oslProfile"></div><div id="oslPPosts"></div>';
    paintProfile();
    if (!SS.profileUser || SS.profileUser.err || (SS.profileUser.user && SS.profileUser.user.addr !== addr) || Date.now() - (SS.profileAt || 0) > 20000) {
      if (Date.now() - (SS.profileAt || 0) > 4000) { SS.profileAt = Date.now(); loadProfile(addr); }   // a failed load is not re-fired by every re-render
    }
  }
  function paintProfile() {
    const el = $('oslProfile'); if (!el) return;
    const addr = SS.profileOf, self = addr === me();
    const j = SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === addr ? SS.profileUser : null;
    const u = user(addr), c = core.contact(addr);
    const counts = (j && j.counts) || {};   // unknown until loaded: shown as "–", never as 0
    const wallet = self ? (S.profile.wallet || u.wallet) : u.wallet;
    const h2 = document.querySelector('#omxHead h2'); if (h2 && (S.view === 'profile' || S.view === 'me')) h2.innerHTML = profileTitle(addr, self);
    let btns = '';
    if (self) {
      btns = `<button class="omx-primary" data-act="sx-edit">Edit profile</button>
        ${wallet ? `<button class="omx-ghost" data-act="sx-unlink">👛 ${esc(wallet.slice(0, 4) + '…' + wallet.slice(-4))} · unlink</button>` : `<button class="omx-ghost" data-act="sx-link">👛 Link wallet for tips</button>`}`;
    } else {
      const friend = c && (c.state === 'friend' || c.state === 'pending-out');
      btns = `<button class="${j && j.iFollow ? 'omx-ghost' : 'omx-primary'}" data-act="sx-follow" data-a="${esc(addr)}" data-on="${j && j.iFollow ? 0 : 1}" aria-pressed="${!!(j && j.iFollow)}">${j && j.iFollow ? 'Following ✓' : 'Follow'}</button>
        <button class="omx-ghost" data-act="sx-message" data-a="${esc(addr)}">💬 ${friend ? 'Message' : 'Add & message'}</button>
        ${friend && window.OST_MESH_CALL ? `<button class="omx-ghost" data-act="sx-call" data-a="${esc(addr)}" data-v="0" aria-label="Voice call">📞</button><button class="omx-ghost" data-act="sx-call" data-a="${esc(addr)}" data-v="1" aria-label="Video call">🎥</button>` : ''}
        <button class="omx-ghost" data-act="sx-send" data-a="${esc(addr)}" ${wallet ? '' : 'disabled title="No wallet linked yet"'}>💸 Send</button>`;
    }
    const perr = SS.profileUser && SS.profileUser.err;
    el.innerHTML = `<div class="osl-phero">${avatar(addr, 'xl')}<div><b>${esc(dname(addr))}${badge(addr)}</b>${j && j.online && !self ? '<span class="osl-online">● online</span>' : ''}<small>${esc(addr)}</small>${wallet ? `<small>👛 ${esc(wallet)}</small>` : ''}</div></div>
      ${u.bio ? `<p class="osl-bio">${rich(u.bio)}</p>` : (self ? '<p class="osl-bio dim">Add a bio so people know who you are.</p>' : '')}
      <div class="osl-counts"><button data-act="sx-list" data-dir="posts"><b>${fmtCount(counts.posts)}</b>posts</button><button data-act="sx-list" data-dir="followers"><b>${fmtCount(counts.followers)}</b>followers</button><button data-act="sx-list" data-dir="following"><b>${fmtCount(counts.following)}</b>following</button>${j && j.followsMe ? '<span class="osl-fyou">Follows you</span>' : ''}</div>
      <div class="osl-pbtns">${btns}</div>
      ${self ? `<div class="osl-pbtns"><button class="omx-ghost" data-act="sx-compose">✍️ New post</button><button class="omx-ghost" data-act="sx-story-add">➕ Story</button><button class="omx-ghost" data-act="sx-share-me">↗ Share profile</button></div>` : ''}
      ${perr ? `<div class="osl-inerr" role="alert"><span>Could not load this profile — ${esc(perr)}</span><button data-act="sx-retry-profile">Retry</button></div>` : ''}`;
    const pe = $('oslPPosts'); if (!pe) return;
    const own = SS.profilePostsOf === addr, posts = own ? SS.profilePosts : null, lerr = own ? SS.profilePostsErr : '';
    if (lerr && !(posts && posts.length)) pe.innerHTML = perr ? '' : errBox('Could not load posts.', lerr, 'sx-retry-profile');
    else pe.innerHTML = !posts ? (perr ? '' : skeleton()) : posts.length ? (lerr ? `<div class="osl-inerr" role="alert"><span>Could not refresh posts — ${esc(lerr)}</span><button data-act="sx-retry-profile">Retry</button></div>` : '') + posts.map(postHtml).join('') : `<div class="omx-empty"><b>📝</b>${self ? 'You have not posted yet.' : 'No posts yet.'}</div>`;
    wireVideos(pe);
    if (self && !$('oslStoryPick')) pe.insertAdjacentHTML('beforeend', '<input type="file" id="oslStoryPick" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>');
    const inp = $('oslStoryPick'); if (inp && !inp.__w) { inp.__w = 1; inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) storyCompose(f); }); }
  }
  function renderEdit(ctx) {
    head(ctx, 'Edit profile', '');
    const p = S.profile;
    // The form is drawn from a draft, so whatever was typed survives every re-render (emoji pick, photo upload or removal).
    const d = SS.edit || (SS.edit = { name: p.name || '', bio: p.bio || '', emoji: p.emoji || '' });
    const av = p.avatar ? avatar(me(), 'xl') : `<span class="osl-av xl" id="oslEditAv" style="${avStyle(me())}">${esc(d.emoji || (d.name.trim() || 'm')[0].toUpperCase())}</span>`;
    ctx.body.innerHTML = `<div class="omx-card"><div class="osl-phero">${av}<div><label class="omx-ghost" id="oslAvLab" ${SS.avBusy ? 'aria-busy="true"' : ''}><span>${SS.avBusy ? 'Uploading photo…' : '📷 Change photo'}</span><input type="file" id="oslAvPick" accept="image/*" hidden ${SS.avBusy ? 'disabled' : ''}></label>${p.avatar && !SS.avBusy ? '<button class="omx-ghost" data-act="sx-avatar-clear" style="margin-top:6px">Remove photo</button>' : ''}</div></div>
      <label class="omx-note" for="oslName">Name</label><input class="omx-input" id="oslName" maxlength="32" value="${esc(d.name)}" placeholder="Your name" autocomplete="off" aria-describedby="oslNameErr">
      <div class="osl-ferr" id="oslNameErr" role="alert" hidden></div>
      <label class="omx-note" for="oslBio">Bio</label><textarea class="omx-input" id="oslBio" maxlength="200" rows="3" placeholder="A line about you">${esc(d.bio)}</textarea>
      <div class="omx-note">Emoji (used when you have no photo)</div><div class="omx-emojis">${EMOJIS.map((e) => `<button type="button" data-act="sx-emoji" data-e="${e}" class="${d.emoji === e ? 'on' : ''}" aria-pressed="${d.emoji === e}">${e}</button>`).join('')}</div>
      <button class="omx-primary" data-act="sx-save">Save profile</button></div>`;
    const nm = $('oslName'), bio = $('oslBio');
    if (nm) nm.addEventListener('input', () => { d.name = nm.value; nameError(''); });
    if (bio) bio.addEventListener('input', () => { d.bio = bio.value; });
    // Upload progress shows on the button itself (a toast could not be taken back when the upload ends, and a
    // stack of them covered Save on phones); only the outcome is a toast.
    const pick = $('oslAvPick'); if (pick) pick.addEventListener('change', async () => {
      const f = pick.files && pick.files[0]; pick.value = ''; if (!f || SS.avBusy) return;
      const busy = (on) => { SS.avBusy = on; const lab = $('oslAvLab'), sp = lab && lab.querySelector('span'), inp = $('oslAvPick'); if (sp) sp.textContent = on ? 'Uploading photo…' : '📷 Change photo'; if (lab) { if (on) lab.setAttribute('aria-busy', 'true'); else lab.removeAttribute('aria-busy'); } if (inp) inp.disabled = on; };
      busy(true);
      try { const img = await imageToUpload(f, 512); if (!S.announced) await core.announce(); const id = await upload(img.blob, img.mime, 'avatar', img.w, img.h); await core.saveProfile({ avatar: id }); absorb({ [me()]: { avatar: id } }); busy(false); if (S.view === 'edit') core.render(); toast('Photo updated ✓'); }
      catch (e) { busy(false); toast(emsg(e), 'err'); }
    });
  }
  function nameError(msg) {
    const el = $('oslNameErr'), nm = $('oslName');
    if (el) { el.textContent = msg; el.hidden = !msg; }
    if (nm) { nm.classList.toggle('bad', !!msg); if (msg) nm.setAttribute('aria-invalid', 'true'); else nm.removeAttribute('aria-invalid'); }
  }
  async function linkWallet() {
    const w = window.OST_AUTH && OST_AUTH.wallet && OST_AUTH.wallet();
    if (!w) { toast('Connect a wallet first — opening Wallet.'); core.close(); navTo('#wallet'); return; }
    if (!OST_AUTH.signText) { toast('Wallet signing unavailable — reload the page.', 'err'); return; }
    try {
      if (!S.announced) await core.announce();
      const ts = Date.now();
      const sig = await OST_AUTH.signText(`OST-MESH-LINK|v1|${me()}|${w}|${ts}`);
      const r = await signed('POST', '/mesh/v1/social/profile', { from: me(), wallet: w, walletTs: ts, walletSig: sig });
      S.profile.wallet = r.profile.wallet; core.lsSet(core.K.profile, S.profile); absorb({ [me()]: r.profile });
      toast('Wallet linked ✓ — people can now tip you'); core.render();
    } catch (e) { toast((e && e.message) || 'Could not link wallet', 'err'); }
  }

  /* ---------- NOTIFICATIONS / SEARCH ---------- */
  function renderNotifs(ctx) {
    head(ctx, 'Notifications', '');
    ctx.body.innerHTML = '<div id="oslNotifs"></div>';
    paintNotifs();
    // Opening the list fetches fresh alerts (one request at a time; skipped when the last one is under 30 s old).
    if (!SS.notifsAt || Date.now() - SS.notifsAt > 30000) loadNotifs(true);
  }
  function paintNotifs() {
    const el = $('oslNotifs'); if (!el || S.view !== 'notifs') return;
    const items = SS.notifs.items || [], err = SS.notifsErr;
    let h;
    if (!items.length) h = err ? errBox('Could not load notifications.', err, 'sx-retry-notifs') : !SS.notifsAt ? skeleton() : '<div class="omx-empty"><b>🔔</b>No notifications yet.<br>Likes, comments, follows and tips show up here.</div>';
    else h = (err ? `<div class="osl-inerr" role="alert"><span>Could not refresh notifications — ${esc(err)}</span><button data-act="sx-retry-notifs">Retry</button></div>` : '') + '<div class="omx-list">' + items.map((n) => {
      const txt = n.kind === 'like' ? 'liked your post' : n.kind === 'comment' ? 'commented: “' + esc(n.text || '') + '”' : n.kind === 'follow' ? 'started following you' : n.kind === 'tip' ? `tipped you <b>${esc(fmtAmt(n.amount))} ${esc(n.ccy)}</b> 💸` : esc(n.kind);
      return `<button class="omx-item ${n.ts > (SS.notifs.seenAt || 0) ? 'osl-unseen' : ''}" data-act="${n.postId ? 'sx-open' : 'sx-profile'}" data-p="${esc(n.postId || '')}" data-a="${esc(n.from)}">${avatar(n.from)}<div class="omx-main"><b>${esc(dname(n.from))}</b><span>${txt}</span></div><div class="omx-meta"><span>${ago(n.ts)}</span></div></button>`;
    }).join('') + '</div>';
    el.innerHTML = h;
    if (SS.notifs.unread) { SS.notifs.unread = 0; SS.notifs.seenAt = Date.now(); paintBell(); refreshTabs(); signed('POST', '/mesh/v1/social/notifs/seen', { addr: me() }).catch(() => {}); }
  }
  let searchT = null, searchSeq = 0;
  function renderSearch(ctx) {
    head(ctx, 'People', '');
    ctx.body.innerHTML = `<input class="omx-input osl-field" id="oslQ" type="search" placeholder="Search by name or paste an ost-mesh address" value="${esc(SS.search)}" autocomplete="off" aria-label="Search people"><div id="oslRes" style="margin-top:10px"></div>`;
    const q = $('oslQ'); q.addEventListener('input', () => { SS.search = q.value; clearTimeout(searchT); searchT = setTimeout(runSearch, 300); }); setTimeout(() => { try { q.focus(); } catch (_) {} }, 50);
    runSearch();
  }
  async function runSearch() {
    const el = $('oslRes'); if (!el) return;
    const q = SS.search.trim(), seq = ++searchSeq;   // a slower, older answer never overwrites a newer one
    el.innerHTML = '<div class="osl-end">Searching…</div>';
    try {
      const j = q ? await getJ('/mesh/v1/social/search?q=' + encodeURIComponent(q)) : (SS.people || (SS.people = await getJ('/mesh/v1/social/people?me=' + encodeURIComponent(me() || ''))));
      if (seq !== searchSeq || !$('oslRes')) return;
      const users = (j.users || []).filter((u) => u && u.addr !== me());
      users.forEach((u) => absorb({ [u.addr]: u }));
      $('oslRes').innerHTML = (q ? '' : '<div class="omx-note" style="margin:0 0 8px">People on OST Mesh</div>') + (users.length ? '<div class="omx-list">' + users.map((u) => `<button class="omx-item" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<div class="omx-main"><b>${esc(u.name || shortA(u.addr))}${u.walletVerified ? '<i class="osl-ver">✓</i>' : ''}</b><span>${esc(u.bio || shortA(u.addr))}</span></div></button>`).join('') + '</div>' : '<div class="omx-empty">Nobody found. Invite friends from Add → Your invite.</div>');
    } catch (e) { if (seq === searchSeq && $('oslRes')) $('oslRes').innerHTML = errBox(q ? 'Search failed.' : 'Could not load people.', e, 'sx-retry-search'); }
  }
  function followList(dir) {
    const addr = SS.profileOf;
    if (dir === 'posts') { const pe = $('oslPPosts'); if (pe) pe.scrollIntoView({ behavior: 'smooth' }); return; }
    sheet(`<h3>${dir === 'followers' ? 'Followers' : 'Following'}</h3><div id="oslFl" class="osl-end">Loading…</div>`);
    getJ('/mesh/v1/social/follows?addr=' + encodeURIComponent(addr) + '&dir=' + dir).then((j) => {
      (j.users || []).forEach((u) => u && absorb({ [u.addr]: u }));
      const el = $('oslFl'); if (!el) return;
      el.className = ''; el.innerHTML = (j.users || []).length ? '<div class="omx-list">' + j.users.filter(Boolean).map((u) => `<button class="omx-item" data-sheet="close" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<div class="omx-main"><b>${esc(u.name || shortA(u.addr))}</b><span>${esc(shortA(u.addr))}</span></div></button>`).join('') + '</div>' : '<div class="omx-empty">Nobody yet.</div>';
    }).catch((e) => {
      const el = $('oslFl'); if (!el) return;
      el.className = ''; el.innerHTML = errBox('Could not load this list.', e, 'sx-fl-retry');
      const b = el.querySelector('.osl-retry'); if (b) b.onclick = () => followList(dir);
    });
  }

  /* ---------- PAYMENTS (tips + chat sends) ---------- */
  async function payTo({ wallet, amount, ccy, memo }) {
    const w = window.OST_WALLET; const W3 = window.solanaWeb3;
    if (!w || !w.session || !w.session.publicKey) throw new Error('Connect a wallet first (Wallet → Connect).');
    if (!W3) throw new Error('Wallet core still loading — try again.');
    const to = w.toPublicKey(wallet), from = w.session.publicKey;
    if (to.toBase58() === from.toBase58()) throw new Error('That is your own wallet.');
    const tx = new W3.Transaction();
    if (memo) tx.add(w.memoIx(memo, from));
    if (ccy === 'SOL') {
      const lam = Math.round(amount * W3.LAMPORTS_PER_SOL);
      const bal = await w.getConnection().getBalance(from);
      if (bal < lam + 10000) throw new Error('Not enough devnet SOL (you have ' + (bal / 1e9).toFixed(4) + ').');
      tx.add(W3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lam }));
    } else {
      const c = w.constants; const mint = new W3.PublicKey(ccy === 'OSTG' ? MINT.OSTG : window.OST_CONFIG.mint);
      const src = w.associatedAddress(mint, from, false, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID);
      const dst = w.associatedAddress(mint, to, false, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID);
      try { await w.ensureFee(from); } catch (_) { throw new Error('You need a little devnet SOL for the network fee.'); }
      const info = await w.getConnection().getAccountInfo(dst);
      if (!info) tx.add(w.associatedAccountIx(from, dst, to, mint, c.TOKEN_2022_PROGRAM_ID, c.ASSOCIATED_TOKEN_PROGRAM_ID));
      tx.add(w.transferChecked(src, mint, dst, from, w.toBaseUnits(amount, 9), 9, c.TOKEN_2022_PROGRAM_ID));
    }
    const sig = await w.sign(tx);
    try { window.dispatchEvent(new CustomEvent('ost:wallet-changed')); } catch (_) {}
    return sig;
  }
  async function walletOf(addr) {
    let u = SS.users[addr];
    if (!u || !u.wallet) { try { const j = await getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(addr)); absorb({ [addr]: j.user }); u = j.user; } catch (_) {} }
    return u && u.wallet;
  }
  async function paySheet({ addr, postId, chat }) {
    const wallet = await walletOf(addr);
    if (!wallet) { toast(dname(addr) + ' has not linked a wallet yet — ask them to tap Me → Link wallet.', 'err'); return; }
    const chips = { OST: [1, 5, 10, 25, 100], OSTG: [1, 5, 10, 25, 100], SOL: [0.01, 0.05, 0.1, 0.5] };
    let ccy = 'OST', amount = 5;
    const draw = () => {
      sheet(`<h3>${postId ? 'Tip' : 'Send'} ${esc(dname(addr))}</h3>
        <div class="omx-note" style="margin-top:0">Real devnet transfer from your wallet to <b>${esc(wallet.slice(0, 4) + '…' + wallet.slice(-4))}</b> (signature-verified). Devnet tokens have no cash value.</div>
        <div class="osl-seg">${['OST', 'OSTG', 'SOL'].map((k) => `<button data-ccy="${k}" class="${k === ccy ? 'on' : ''}">${k}</button>`).join('')}</div>
        <div class="osl-chips">${chips[ccy].map((v) => `<button data-amt="${v}" class="${v === amount ? 'on' : ''}">${v}</button>`).join('')}</div>
        <input class="omx-input" id="oslPayAmt" type="number" min="0" step="any" value="${amount}">
        ${chat ? '<input class="omx-input" id="oslPayNote" maxlength="140" placeholder="Note (optional, private)" style="margin-top:8px">' : ''}
        <button class="omx-primary" id="oslPayGo" style="margin-top:10px">${postId ? 'Tip' : 'Send'} ${amount} ${ccy}</button>
        <div class="omx-note" id="oslPaySt"></div>`);
      const box = $('oslSheetBox');
      box.querySelectorAll('[data-ccy]').forEach((b) => { b.onclick = () => { ccy = b.getAttribute('data-ccy'); amount = chips[ccy][1]; draw(); }; });
      box.querySelectorAll('[data-amt]').forEach((b) => { b.onclick = () => { amount = Number(b.getAttribute('data-amt')); draw(); }; });
      const inp = $('oslPayAmt'); inp.oninput = () => { amount = Number(inp.value) || 0; $('oslPayGo').textContent = (postId ? 'Tip ' : 'Send ') + amount + ' ' + ccy; };
      $('oslPayGo').onclick = async () => {
        if (!(amount > 0)) { toast('Enter an amount.', 'err'); return; }
        const go = $('oslPayGo'), st = $('oslPaySt'); go.disabled = true; go.textContent = 'Approve in your wallet…';
        try {
          const sig = await payTo({ wallet, amount, ccy, memo: postId ? 'ost-tip:' + postId : 'ost-mesh-pay' });
          st.textContent = 'Sent ✓ ' + sig.slice(0, 10) + '… confirming';
          if (postId) {
            let r = null, err = null;
            // Worth another try: the transaction is not visible to the RPC yet (tx_not_found, rpc_*), the first check of this
            // same tip is still running (409 tip_in_flight — the next answer is the idempotent ok), or the hub was busy.
            const again = (e) => !!e && (/^(tx_not_found|tip_in_flight|hub_busy|rate_limited)$/.test(e.code || '') || /^rpc/.test(e.code || '') || !!e.transient || /tx not found|rpc/i.test(e.message || ''));
            for (let i = 0; i < 6 && !r; i++) { try { r = await signed('POST', '/mesh/v1/social/tip', { from: me(), postId, sig, ccy }); } catch (e) { err = e; if (!again(e) || i === 5) break; await new Promise((res) => setTimeout(res, 2500)); } }
            if (r) { const p = findPost(postId); if (p) updatePost(Object.assign({}, p, { tips: r.tips, tipCount: r.tipCount })); toast('Tip verified on-chain ✓'); }
            else toast('Sent, but the tip could not be verified yet (' + (err && err.message) + ').', 'err');
          }
          if (chat || core.contact(addr)) {
            const note = ($('oslPayNote') || {}).value || '';
            core.sendInner(addr, { k: 'pay', ccy, amount, sig, note }, { kind: 'pay', ccy, amount, sig, note }).catch(() => {});
          }
          closeSheet();
        } catch (e) { go.disabled = false; go.textContent = (postId ? 'Tip ' : 'Send ') + amount + ' ' + ccy; st.textContent = e.message || 'Payment failed'; toast(e.message || 'Payment failed', 'err'); }
      };
    };
    draw();
  }

  /* ---------- overlays: #oslSheet, #oslLight, #oslStory ---------- */
  // Each overlay owns its keys. The listener runs in the capture phase on window, so the topmost overlay handles
  // Escape (and its own shortcuts) before anything else sees the event — the mesh app behind it never closes
  // underneath it. Tab stays inside the topmost overlay, and closing one gives focus back to where it came from.
  const OV = [];
  // The call screen (#omxCall, z 13000) sits above every overlay of ours: while it is up it owns the keyboard and focus.
  const callUp = () => !!document.querySelector('#omxCall');
  function ovPush(el, close, key) {
    watchScreen();
    const i = OV.findIndex((o) => o.el === el);
    if (i >= 0) { const o = OV.splice(i, 1)[0]; o.close = close; o.key = key; OV.push(o); return; }   // re-shown: keep the original focus to return to
    const a = document.activeElement;
    const o = { el, close, key, prev: a && a !== document.body ? a : null, bk: bkSize(), scr: screenKey(), tok: 0 };
    OV.push(o);
    if (core.back && typeof core.back.push === 'function') { try { o.tok = core.back.push(() => { o.tok = 0; if (o.el.classList.contains('on')) { try { o.close(); } catch (_) {} } }, 'overlay'); } catch (_) {} }
  }
  function ovPop(el, fallback) {
    const i = OV.findIndex((o) => o.el === el); if (i < 0) return;
    const o = OV.splice(i, 1)[0];
    if (o.tok) { const t = o.tok; o.tok = 0; try { core.back.pop(t); } catch (_) {} }   // closed in-app: its Back step goes silently
    const top = OV[OV.length - 1];
    if (callUp()) return;
    // Focus already moved on (the core focused the screen it just opened): leave it there. A tapped toast does not
    // count — it is about to disappear.
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !el.contains(a) && !a.closest('.omx-toasts') && (!top || top.el.contains(a))) return;
    const ok = (t) => t && t.isConnected && t.getClientRects().length && (!top || top.el.contains(t));
    let t = ok(o.prev) ? o.prev : null;
    if (!t && typeof fallback === 'function') { try { t = fallback(); } catch (_) { t = null; } if (!ok(t)) t = null; }
    if (!t && top) t = top.el;
    if (!t) { const r = document.querySelector('#ostMeshApp.open'); if (r && r.hasAttribute('tabindex')) t = r; }
    if (t) { try { t.focus({ preventScroll: true }); } catch (_) {} }
  }
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function trapTab(root, e) {
    const f = Array.from(root.querySelectorAll(FOCUSABLE)).filter((x) => x.getClientRects().length && x.tabIndex >= 0);
    const a = document.activeElement;
    if (!f.length) { e.preventDefault(); try { root.focus({ preventScroll: true }); } catch (_) {} return; }
    const first = f[0], last = f[f.length - 1];
    if (!root.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (a === first || !f.includes(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
  window.addEventListener('keydown', (e) => {
    if (callUp()) return;   // nothing hidden under the call screen takes Escape, arrows or Tab (its own handler runs)
    let o = OV[OV.length - 1];
    while (o && !(o.el.isConnected && o.el.classList.contains('on'))) { OV.pop(); o = OV[OV.length - 1]; }   // closed by other means
    if (!o || e.defaultPrevented && e.key !== 'Escape') return;
    if (e.key === 'Escape') { if (e.isComposing) return; e.preventDefault(); e.stopImmediatePropagation(); o.close(); return; }
    if (e.key === 'Tab') { trapTab(o.el, e); return; }
    if (o.key && o.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // Browser/system Back is handled by the core (it may close the app or a chat); an overlay of ours must not stay behind
  // on its own. Only a Back that took away the core history entry the overlay was opened over closes it — the core's own
  // silent history unwinds (after closing a chat with ✕, say) leave a just-opened sheet alone.
  function bkSize() { try { return core.back && typeof core.back.size === 'function' ? core.back.size() : -1; } catch (_) { return -1; } }
  window.addEventListener('popstate', () => {
    const n = bkSize();
    OV.slice().reverse().forEach((o) => { if (o.el.classList.contains('on') && (n < 0 || o.bk < 0 || n < o.bk)) { try { o.close(); } catch (_) {} } });
  });
  // An overlay belongs to the screen it was opened over. When the core changes that screen underneath it (a message
  // toast or notification opens a chat, the app closes), the overlay closes instead of covering the new screen.
  function screenKey() { const r = $('ostMeshApp'); return r && r.classList.contains('open') ? S.view + '|' + (S.view === 'chat' ? S.peer || '' : '') : ''; }
  let screenMO = null;
  function watchScreen() {
    const r = $('ostMeshApp'); if (!r || !('MutationObserver' in window) || (screenMO && screenMO.root === r)) return;
    if (screenMO) screenMO.disconnect();
    screenMO = new MutationObserver(() => {
      const k = screenKey();
      OV.slice().reverse().forEach((o) => { if (o.scr && o.scr !== k && o.el.classList.contains('on')) { try { o.close(); } catch (_) {} } });
    });
    screenMO.root = r;
    screenMO.observe(r, { attributes: true, attributeFilter: ['data-view', 'class'] });
  }

  /* ---------- small sheet (actions, confirms, pickers) ---------- */
  let sheetOnClose = null;
  function sheet(html, opts) {
    let el = $('oslSheet');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslSheet';
      el.innerHTML = '<div class="osl-sheetbox" id="oslSheetBox" role="dialog" aria-modal="true" tabindex="-1"></div>';
      document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        if (e.target === el) { closeSheet(); return; }   // backdrop
        if (!e.target.closest('[data-sheet="close"]')) return;
        const a = e.target.closest('[data-act]');
        if (a && el.contains(a)) { const fn = X.actions[a.getAttribute('data-act')]; closeSheet(); if (fn) fn(a, e); return; }
        closeSheet();
      });
    }
    // New content replaces an open sheet: the previous one's onClose still runs (a pending confirm resolves "no").
    if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; try { f(); } catch (_) {} }
    sheetOnClose = (opts && opts.onClose) || null;
    const box = $('oslSheetBox'); box.innerHTML = html;
    const h = box.querySelector('h3'); if (h) { h.id = 'oslSheetTitle'; box.setAttribute('aria-labelledby', 'oslSheetTitle'); } else box.removeAttribute('aria-labelledby');
    // over the story viewer or the lightbox (a confirm asked from there), the sheet must sit on top of them
    el.classList.toggle('over', !!document.querySelector('#oslStory.on, #oslLight.on'));
    el.classList.add('on'); ovPush(el, closeSheet);
    if (!box.contains(document.activeElement) && !callUp()) { try { box.focus({ preventScroll: true }); } catch (_) {} }
  }
  function closeSheet() {
    const el = $('oslSheet'); if (!el || !el.classList.contains('on')) return;
    el.classList.remove('on');
    const f = sheetOnClose; sheetOnClose = null;
    ovPop(el);
    if (f) { try { f(); } catch (_) {} }
  }
  // Confirmation in the sheet (replaces window.confirm): resolves true only on the confirm button.
  function askSheet({ title, body, ok, cancel, danger }) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      sheet(`<h3>${esc(title)}</h3>${body ? `<p class="osl-sbody">${esc(body)}</p>` : ''}<div class="omx-row2 osl-askrow"><button type="button" class="omx-ghost" data-ask="0">${esc(cancel || 'Cancel')}</button><button type="button" class="omx-primary${danger ? ' osl-danger' : ''}" data-ask="1">${esc(ok || 'OK')}</button></div>`, { onClose: () => fin(false) });
      $('oslSheetBox').querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { fin(b.getAttribute('data-ask') === '1'); closeSheet(); }; });
    });
  }

  /* ---------- lightbox ---------- */
  const LB = { imgs: [], k: 0 };
  function lightbox(p, i) {
    const imgs = (p.media || []).filter((m) => m.kind === 'image'); if (!imgs.length) return;
    let el = $('oslLight');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslLight';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photo viewer'); el.tabIndex = -1;
      document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-l]');
        if (!b) { if (e.target === el || e.target.classList.contains('osl-lstage')) closeLight(); return; }   // backdrop closes; the photo itself does not
        const l = b.getAttribute('data-l'); if (l === 'x') closeLight(); else lbStep(l === 'n' ? 1 : -1);
      });
      // Swipe left/right between photos, swipe down to close.
      let sx = 0, sy = 0, multi = false;
      el.addEventListener('touchstart', (e) => { multi = e.touches.length > 1; const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (multi || !e.changedTouches.length) return;   // pinch-zoom is not a swipe
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) lbStep(dx < 0 ? 1 : -1);
        else if (dy > 90 && dy > Math.abs(dx) * 1.4) closeLight();
      }, { passive: true });
    }
    LB.imgs = imgs; LB.k = Math.min(Math.max(0, i || 0), imgs.length - 1);
    lbDraw();
    el.classList.toggle('multi', imgs.length > 1);
    el.classList.add('on');
    ovPush(el, closeLight, (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { lbStep(e.key === 'ArrowRight' ? 1 : -1); return true; } return false; });
    if (!callUp()) { try { el.focus({ preventScroll: true }); } catch (_) {} }
  }
  function lbDraw() {
    const el = $('oslLight'); if (!el) return;
    const n = LB.imgs.length, k = LB.k;
    el.innerHTML = `<div class="osl-lstage"><img src="${mediaUrl(LB.imgs[k].id)}" alt="Photo ${k + 1} of ${n}" draggable="false"></div><button type="button" data-l="x" aria-label="Close photo viewer">✕</button>${n > 1 ? `<button type="button" data-l="p" aria-label="Previous photo">‹</button><button type="button" data-l="n" aria-label="Next photo">›</button><span aria-live="polite">${k + 1} / ${n}</span>` : ''}`;
  }
  function lbStep(d) {
    const n = LB.imgs.length; if (n < 2) return;
    const el = $('oslLight'), had = el && document.activeElement && el.contains(document.activeElement) ? document.activeElement.getAttribute('data-l') : null;
    LB.k = (LB.k + d + n) % n; lbDraw();
    // keep keyboard focus on the button that was used (the redraw replaced it)
    const again = had && el.querySelector('[data-l="' + had + '"]'); try { (again || el).focus({ preventScroll: true }); } catch (_) {}
  }
  function closeLight() { const el = $('oslLight'); if (!el || !el.classList.contains('on')) return; el.classList.remove('on'); el.innerHTML = ''; ovPop(el); }

  /* ---------- sharing + site navigation ---------- */
  const base = () => location.origin + location.pathname;
  async function sharePost(id) {
    const p = findPost(id); const url = base() + '#post=' + id;
    const contacts = Object.values(S.contacts).filter((c) => c.state === 'friend').slice(0, 8);
    sheet(`<h3>Share post</h3><div class="omx-row2"><button class="omx-primary" id="oslCopyP">Copy link</button>${navigator.share ? '<button class="omx-ghost" id="oslNatP">Share…</button>' : ''}</div>
      ${contacts.length ? `<div class="omx-note">Send to a friend</div><div class="omx-list">${contacts.map((c) => `<button class="omx-item" data-to="${esc(c.addr)}">${avatar(c.addr)}<div class="omx-main"><b>${esc(c.name || shortA(c.addr))}</b></div></button>`).join('')}</div>` : ''}`);
    $('oslCopyP').onclick = () => { core.copyText(url, 'Link copied'); closeSheet(); };
    const n = $('oslNatP'); if (n) n.onclick = () => { navigator.share({ title: 'OST Mesh', text: (p && p.text ? p.text.slice(0, 80) + ' — ' : '') + 'on OST Mesh', url }).catch(() => {}); closeSheet(); };
    // Both sides show the same text. A first attempt that fails on the network stays in the core's outbox and is retried.
    const msg = '📣 ' + (p && p.text ? '“' + p.text.slice(0, 120) + '” ' : '') + url;
    $('oslSheetBox').querySelectorAll('[data-to]').forEach((b) => { b.onclick = () => { const to = b.getAttribute('data-to'); core.sendInner(to, { k: 'text', text: msg }, { kind: 'text', text: msg }).then(() => toast('Sent to ' + dname(to))).catch((e) => toast(e && e.transient ? 'Not delivered to ' + dname(to) + ' yet — it sends automatically.' : emsg(e, 'Could not send'), e && e.transient ? '' : 'err')); closeSheet(); }; });
  }
  function navTo(href) {
    const h = String(href || '');
    let m;
    if ((m = h.match(/^#market=(.+)$/))) {
      const id = decodeURIComponent(m[1]); core.close();
      try { const t = document.querySelector('[data-wallet-panel-target="predict"]'); if (window.OST_COMPARTMENTS) OST_COMPARTMENTS.activate('wallet', false); if (t) t.click(); } catch (_) {}
      let n = 0; const iv = setInterval(() => {
        const list = window.__ostPredictionMarkets || []; const mk = list.find((x) => String(x.id) === id);
        if (mk && window.OST_PREDICT_MOBILE) { clearInterval(iv); OST_PREDICT_MOBILE.openMarket(mk); try { document.getElementById('ostPredictMobile').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }
        else if (++n > 40) { clearInterval(iv); location.hash = '#markets'; toast('That market is no longer listed.', 'err'); }
      }, 250);
      return;
    }
    if ((m = h.match(/^#perp=(.+)$/))) { core.close(); try { if (window.OST_COMPARTMENTS) OST_COMPARTMENTS.activate('stock-market', false); } catch (_) {} if (window.OST_PERPS) OST_PERPS.open(decodeURIComponent(m[1])); else location.hash = '#stock-market'; return; }
    if ((m = h.match(/^#u=(.+)$/))) { openProfile(decodeURIComponent(m[1])); return; }
    if ((m = h.match(/^#post=(.+)$/))) { openPost(decodeURIComponent(m[1])); return; }
    if ((m = h.match(/^#app=([a-z0-9-]{3,40})$/))) { core.close(); if (window.OST_APPS && typeof window.OST_APPS.open === 'function') window.OST_APPS.open(m[1]); else location.hash = h; return; }
    core.close(); location.hash = h || '#';
  }
  function open(view) { whenReady(() => { SS.stack = []; dropLinks(); core.open(view || 'feed'); }); }
  function compose(opts) { opts = opts || {}; SS.draft = { text: opts.text || '', media: [], embed: opts.embed || null, busy: '' }; whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); go('compose'); }); }
  // #share-app=<slug> (OST Studio's deploy panel): compose a post with that app attached.
  // Name/author come from the Studio apps API, best effort — the slug alone still makes a valid embed.
  async function shareApp(slug) {
    let title = slug, sub = 'OST app';
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const to = setTimeout(() => { if (ctl) ctl.abort(); }, 6000);
      const r = await fetch(API + '/studio/v1/apps/' + encodeURIComponent(slug), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      clearTimeout(to);
      const j = await r.json().catch(() => null);
      const app = r.ok && j && j.app;
      if (app) {
        if (app.name) title = String(app.name).slice(0, 140);
        const who = app.profile && app.profile.name ? String(app.profile.name).slice(0, 32) : '';
        if (who) sub = 'OST app by ' + who;
      } else if (j && j.error === 'app_not_found') toast('That app isn’t published (yet) — the post will still link to it.', 'err');
    } catch (_) {}
    whenReady(() => compose({ embed: { kind: 'app', title, sub, href: '#app=' + slug } }));
  }
  // Deep links: #social, #post=<id>, #u=<addr>, #share-app=<slug>. The hash is decoded before matching, so
  // links that were shared with an encoded colon (#u=ost-mesh%3A…) open as well as the raw form.
  // History (contract C3): at page load the core pushes its own entry, so Back closes the app. A link followed inside
  // the page has already made an entry: with the app closed the app takes that entry over (one Back closes it and
  // lands where the link was); with the app open it becomes a Back step to the screen the user was on.
  function handleHash(ev) {
    let h = location.hash || '';
    try { h = decodeURIComponent(h); } catch (_) {}
    // the hash leaves the address bar; history.state (the core's Back bookkeeping) is kept
    const clear = () => { try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {} };
    let m, act = null;
    if (h === '#social' || h === '#feed') act = () => go('feed');
    else if ((m = h.match(/^#post=(p[0-9a-f]{16,40})$/))) { const id = m[1]; act = () => openPost(id); }
    else if ((m = h.match(/^#u=(ost-mesh:[0-9a-f-]{8,40})$/i))) { const a = m[1]; act = () => openProfile(a); }
    else if ((m = h.match(/^#share-app=([a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9]))$/))) { clear(); shareApp(m[1]); return; }
    if (!act) return;
    clear();
    const inPage = !!(ev && ev.type === 'hashchange');
    whenReady(() => {
      if (!core.isOpen()) { dropLinks(); SS.stack = []; core.open('feed', inPage ? { adopt: true } : {}); if (h !== '#social' && h !== '#feed') { SS.hashNav = true; try { act(); } finally { SS.hashNav = false; } } return; }
      const depth = SS.stack.length, from = S.view;
      SS.hashNav = true; try { act(); } finally { SS.hashNav = false; }
      if (from === 'chat' && SS.stack.length > depth) SS.stack.length = depth;   // a chat cannot be re-entered from this stack
      if (inPage) linkStep(depth);
    });
  }
  window.addEventListener('hashchange', handleHash);
  // Back steps for links followed while the app is open. A step returns to the screen before its link (when the link
  // added one); the in-app ‹ going back past that screen removes the step again, silently.
  const links = [];
  function linkStep(depth, adopt) {
    if (!core.back || typeof core.back.push !== 'function') return;
    const step = { depth };
    step.tok = core.back.push(() => {
      const i = links.indexOf(step); if (i < 0) return;
      links.splice(i);
      if (core.isOpen() && S.view !== 'chat' && SS.stack.length > step.depth) { SS.stack.length = step.depth + 1; back(); }
    }, 'link', { adopt: adopt !== false });
    links.push(step);
  }
  function dropLinks() { links.splice(0).reverse().forEach((s) => { try { core.back.pop(s.tok); } catch (_) {} }); }
  function unlinkPast() { while (links.length && SS.stack.length <= links[links.length - 1].depth) { const s = links.pop(); try { core.back.pop(s.tok); } catch (_) {} } }

  // Market page: a Share button in the detail header. The market module rewrites #opmDetail on every open,
  // so the button is re-added from a MutationObserver — no timers. #opmDetail itself is created inside the
  // static #wallet-panel-predict when the market module mounts; until then that panel is observed instead.
  function marketShareButton() {
    const tb = document.querySelector('#opmDetail .opm-tb'); if (!tb || tb.querySelector('.osl-mshare')) return;
    const b = document.createElement('button'); b.className = 'osl-mshare'; b.type = 'button'; b.title = 'Share to OST Mesh'; b.setAttribute('aria-label', 'Share to OST Mesh'); b.textContent = '↗ Share';
    b.onclick = () => { try { const m = OST_PREDICT_MOBILE.current(); if (m) compose({ embed: marketEmbed(m) }); } catch (_) { open('feed'); } };
    const sp = tb.querySelector('.opm-sp'); if (sp && sp.nextSibling) tb.insertBefore(b, sp.nextSibling); else tb.appendChild(b);
  }
  function watchMarket() {
    const d = $('opmDetail'); if (!d) return false;
    new MutationObserver(marketShareButton).observe(d, { childList: true }); marketShareButton();
    return true;
  }
  function onDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true }); else fn(); }
  onDom(() => {
    if (watchMarket()) return;
    const panel = $('wallet-panel-predict');   // the market module inserts its host (with #opmDetail) as a direct child
    if (panel) { const mo = new MutationObserver(() => { if (watchMarket()) mo.disconnect(); }); mo.observe(panel, { childList: true }); }
  });
  // After a trade: offer (never auto-post) to share it.
  let lastOffer = 0;
  function actionToast(text, btn, fn) {
    const host = document.querySelector('.omx-toasts') || (() => { const h = document.createElement('div'); h.className = 'omx-toasts'; document.body.appendChild(h); return h; })();
    const t = document.createElement('div'); t.className = 'omx-toast osl-act'; t.innerHTML = `<span>${esc(text)}</span><button>${esc(btn)}</button>`;
    t.querySelector('button').onclick = () => { t.remove(); fn(); }; host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 7000);
  }
  window.addEventListener('ost:prediction-order-recorded', () => {
    if (Date.now() - lastOffer < 10 * 60 * 1000) return; lastOffer = Date.now();
    setTimeout(() => actionToast('Bet placed — share it on OST Mesh?', 'Share', () => { const opts = attachOptions().filter((x) => x.kind === 'bet'); compose({ embed: opts[0] || null }); }), 1200);
  });
  // Desktop nav link (#navLinks is static markup: added once the document is parsed, no polling)
  onDom(() => {
    const nav = $('navLinks');
    if (!nav || nav.querySelector('.ost-nav-social')) return;
    const a = document.createElement('a'); a.href = '#social'; a.className = 'ost-nav-social'; a.textContent = 'Mesh';
    a.addEventListener('click', (e) => { e.preventDefault(); open('feed'); });
    const after = Array.from(nav.querySelectorAll('a')).find((x) => /markets/i.test(x.textContent || '')); if (after && after.nextSibling) nav.insertBefore(a, after.nextSibling); else nav.appendChild(a);
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  });

  /* ---------- realtime ---------- */
  X.ws.push((m) => {
    if (m.t !== 'social' || !m.n) return;
    const n = m.n;
    if (n.live) {
      if (n.kind === 'new-post') { SS.newPosts++; const p = $('oslNew'); if (p) p.hidden = false; }
      if (n.kind === 'new-story') loadStories();
      return;
    }
    SS.notifs.items.unshift(n); SS.notifs.unread++;
    paintBell(); refreshTabs();
    const who = dname(n.from);
    toast(n.kind === 'like' ? who + ' liked your post' : n.kind === 'comment' ? who + ' commented on your post' : n.kind === 'follow' ? who + ' followed you' : n.kind === 'tip' ? who + ' tipped you ' + fmtAmt(n.amount) + ' ' + n.ccy + ' 💸' : 'New activity');
    if (!SS.users[n.from]) getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(n.from)).then((j) => absorb({ [n.from]: j.user })).catch(() => {});
  });
  // No socket (strict networks): refresh alerts every 45s while the sheet is open.
  setInterval(() => { if (!document.hidden && core.isOpen() && !S.wsOk) loadNotifs(); }, 45000);

  /* ---------- registration ---------- */
  core.register('feed', { tab: { ico: '🏠', lbl: 'Feed', order: 10, home: true }, render: renderFeed });
  core.register('me', { tab: { ico: '🙂', lbl: 'Me', order: 40 }, render: (ctx) => renderProfile(ctx, true) });
  core.register('profile', { parent: 'feed', render: (ctx) => renderProfile(ctx, false) });
  core.register('post', { parent: 'feed', render: renderPostView });
  core.register('compose', { parent: 'feed', render: renderCompose });
  core.register('notifs', { parent: 'feed', render: renderNotifs });
  core.register('search', { parent: 'feed', render: renderSearch });
  core.register('edit', { parent: 'me', render: renderEdit });
  X.badges.feed = () => SS.notifs.unread;
  X.attach.push({ ico: '💸', lbl: 'Send OST / SOL', run: (peer) => paySheet({ addr: peer, chat: true }) });

  const A = X.actions;
  A['sx-back'] = back;
  // Switching For you / Following starts from a skeleton: the other mode's posts never sit under the new tab.
  A['sx-mode'] = (el) => { const m = el.getAttribute('data-m'); if (m === SS.mode && SS.loaded) return; SS.mode = m; core.lsSet('ost.social.mode', SS.mode); SS.posts = []; SS.cursor = null; SS.loaded = false; SS.newPosts = 0; loadFeed(true); core.render(); };
  A['sx-refresh'] = () => { loadFeed(true); loadStories(); };
  A['sx-more'] = () => loadFeed(false);
  A['sx-stories-retry'] = () => loadStories();
  A['sx-retry-post'] = () => { if (SS.postId) { loadSingle(SS.postId); loadComments(SS.postId); } };
  A['sx-retry-comments'] = () => { if (SS.postId) loadComments(SS.postId); };
  A['sx-retry-profile'] = () => { const a = SS.profileOf; if (!a) return; SS.profileUser = SS.profileUser && SS.profileUser.err ? null : SS.profileUser; SS.profilePostsErr = ''; SS.profileAt = Date.now(); paintProfile(); loadProfile(a); };
  A['sx-retry-notifs'] = () => { SS.notifsErr = ''; paintNotifs(); loadNotifs(true); };
  A['sx-retry-search'] = () => runSearch();
  A['sx-vplay'] = (el) => { const v = el.parentNode && el.parentNode.querySelector('video'); if (!v) return; v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); };
  A['sx-compose'] = () => { if (!SS.draft) SS.draft = { text: '', media: [], embed: null, busy: '' }; go('compose'); };
  A['sx-publish'] = publish;
  A['sx-unpick'] = (el) => { const i = Number(el.getAttribute('data-i')); const m = SS.draft.media.splice(i, 1)[0]; try { URL.revokeObjectURL(m.url); } catch (_) {} core.render(); };
  A['sx-unembed'] = () => { SS.draft.embed = null; core.render(); };
  A['sx-attach'] = () => {
    const el = $('oslAttachList'); if (!el) return;
    const opts = attachOptions();
    el.innerHTML = opts.length ? '<div class="omx-note">Attach</div>' + opts.map((o, i) => `<div class="osl-attopt" data-i="${i}">${embedHtml(o)}</div>`).join('') : '<div class="omx-note">Open a market, place a bet, open a perp or connect a wallet to attach it here.</div>';
    el.querySelectorAll('.osl-attopt').forEach((d) => { d.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); SS.draft.embed = opts[Number(d.getAttribute('data-i'))]; const ta = $('oslText'); if (ta) SS.draft.text = ta.value; core.render(); }, true); });
  };
  A['sx-like'] = (el) => react(el.getAttribute('data-p'), 'like');
  A['sx-dislike'] = (el) => react(el.getAttribute('data-p'), 'dislike');
  A['sx-open'] = (el) => { const p = el.getAttribute('data-p'); if (p) openPost(p); else openProfile(el.getAttribute('data-a')); };
  A['sx-comment'] = sendComment;
  A['sx-cdel'] = async (el) => { try { const r = await signed('POST', '/mesh/v1/social/comment/delete', { from: me(), postId: SS.postId, cid: el.getAttribute('data-c') }); SS.comments[SS.postId] = (SS.comments[SS.postId] || []).filter((c) => c.id !== el.getAttribute('data-c')); const p = findPost(SS.postId); if (p) updatePost(Object.assign({}, p, { comments: r.comments })); paintComments(); } catch (e) { toast(emsg(e), 'err'); } };
  A['sx-tip'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (!p) return; if (p.author === me()) { toast('You cannot tip your own post.'); return; } paySheet({ addr: p.author, postId: p.id }); };
  A['sx-share'] = (el) => sharePost(el.getAttribute('data-p'));
  A['sx-menu'] = (el) => {
    const p = findPost(el.getAttribute('data-p')); if (!p) return;
    const mine = p.author === me();
    sheet(`<h3>Post</h3><div class="omx-list">
      <button class="omx-item" id="oslMLink">🔗 Copy link</button>
      ${mine ? '<button class="omx-item omx-danger" id="oslMDel">🗑️ Delete post</button>' : `<button class="omx-item" id="oslMProf">👤 View ${esc(dname(p.author))}</button><button class="omx-item" id="oslMHide">🙈 Hide posts from this person</button>`}</div>`);
    $('oslMLink').onclick = () => { core.copyText(base() + '#post=' + p.id, 'Link copied'); closeSheet(); };
    const d = $('oslMDel'); if (d) d.onclick = async () => {
      if (!(await askSheet({ title: 'Delete this post?', body: 'It is removed for everyone, with its comments. This cannot be undone.', ok: 'Delete post', danger: true }))) return;
      try { await signed('POST', '/mesh/v1/social/delete', { from: me(), postId: p.id }); SS.posts = SS.posts.filter((x) => x.id !== p.id); if (SS.profilePosts) SS.profilePosts = SS.profilePosts.filter((x) => x.id !== p.id); toast('Post deleted'); if (S.view === 'post') back(); else core.render(); } catch (e) { toast(emsg(e), 'err'); }
    };
    const pr = $('oslMProf'); if (pr) pr.onclick = () => { closeSheet(); openProfile(p.author); };
    const hd = $('oslMHide'); if (hd) hd.onclick = async () => {
      const who = dname(p.author);
      if (!(await askSheet({ title: 'Hide ' + who + '?', body: 'Their posts and stories disappear from your feed, and they are blocked from messaging you in OST Mesh.', ok: 'Hide ' + who, danger: true }))) return;
      core.upsertContact(p.author, { state: 'blocked' }); signed('POST', '/mesh/v1/friend/respond', { wallet: me(), other: p.author, action: 'block' }).catch(() => {}); toast(who + ' is hidden'); core.render();
    };
  };
  A['sx-lightbox'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (p) lightbox(p, Number(el.getAttribute('data-i')) || 0); };
  A['sx-embed'] = (el) => navTo(el.getAttribute('data-href'));
  A['sx-profile'] = (el) => openProfile(el.getAttribute('data-a'));
  A['sx-follow'] = async (el) => { const a = el.getAttribute('data-a'), on = el.getAttribute('data-on') === '1'; el.disabled = true; try { if (!S.announced) await core.announce(); await signed('POST', '/mesh/v1/social/follow', { from: me(), to: a, on }); if (SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === a) { SS.profileUser.iFollow = on; SS.profileUser.counts.followers = Math.max(0, (SS.profileUser.counts.followers || 0) + (on ? 1 : -1)); } paintProfile(); toast(on ? 'Following ' + dname(a) : 'Unfollowed'); } catch (e) { toast(e.message, 'err'); el.disabled = false; } };
  A['sx-message'] = async (el) => { const a = el.getAttribute('data-a'); const c = core.contact(a); S.backTo = S.view; if (c && (c.state === 'friend' || c.state === 'pending-out' || c.state === 'request')) core.openChat(a); else await core.addPerson({ addr: a, name: user(a).name, emoji: user(a).emoji }); };
  A['sx-call'] = (el) => { const a = el.getAttribute('data-a'); if (window.OST_MESH_CALL) OST_MESH_CALL.start(a, el.getAttribute('data-v') === '1'); };
  A['sx-send'] = (el) => paySheet({ addr: el.getAttribute('data-a'), chat: !!core.contact(el.getAttribute('data-a')) });
  A['sx-edit'] = () => { SS.edit = null; go('edit'); };   // a fresh draft from the saved profile
  // Picking an emoji only marks the choice in place — the form is never redrawn, so typed name/bio stay put.
  A['sx-emoji'] = (el) => {
    const d = SS.edit; if (!d) return;
    d.emoji = el.getAttribute('data-e');
    const box = el.parentNode; if (box) box.querySelectorAll('[data-act="sx-emoji"]').forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const av = $('oslEditAv'); if (av) av.textContent = d.emoji;
  };
  A['sx-save'] = async (el) => {
    const d = SS.edit || {}; const nm = $('oslName'), bio = $('oslBio');
    if (nm) d.name = nm.value; if (bio) d.bio = bio.value;
    // Same cleaning as the hub (it drops < and >), so a name made only of those is refused here, not saved blank.
    const name = String(d.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
    if (!name) { nameError(String(d.name || '').trim() ? 'Names cannot use < or > — add some letters.' : 'Add a name — it is how people find and recognise you.'); try { nm.focus(); } catch (_) {} return; }
    const label = el.textContent; el.disabled = true; el.textContent = 'Saving…';
    try {
      const p = await core.saveProfile({ name, bio: String(d.bio || '').trim(), emoji: d.emoji || '' });
      absorb({ [me()]: p }); SS.edit = null; toast('Profile saved ✓'); if (S.view === 'edit') back();
    } catch (e) { el.disabled = false; el.textContent = label; toast(emsg(e, 'Could not save your profile.'), 'err'); }
  };
  A['sx-avatar-clear'] = async () => { try { await core.saveProfile({ avatar: '' }); S.profile.avatar = ''; absorb({ [me()]: { avatar: '' } }); if (S.view === 'edit') core.render(); } catch (e) { toast(emsg(e), 'err'); } };
  A['sx-link'] = linkWallet;
  A['sx-unlink'] = async () => {
    if (!(await askSheet({ title: 'Unlink this wallet?', body: 'People will not be able to tip you until you link a wallet again.', ok: 'Unlink wallet', danger: true }))) return;
    try { await signed('POST', '/mesh/v1/social/profile', { from: me(), unlinkWallet: true }); S.profile.wallet = ''; core.lsSet(core.K.profile, S.profile); absorb({ [me()]: { wallet: '', walletVerified: false } }); toast('Wallet unlinked'); core.render(); } catch (e) { toast(emsg(e), 'err'); }
  };
  A['sx-settings'] = () => { const d = SS.stack.length; SS.stack.push('me'); core.go('settings'); linkStep(d, false); };
  // The colon stays literal: the link opens on any device (the hash is also decoded before matching, for older links).
  A['sx-share-me'] = () => { const url = base() + '#u=' + me(); if (navigator.share) navigator.share({ title: 'Follow me on OST Mesh', url }).catch(() => {}); else core.copyText(url, 'Profile link copied'); };
  A['sx-list'] = (el) => followList(el.getAttribute('data-dir'));
  A['sx-notifs'] = () => go('notifs');
  A['sx-search'] = () => go('search');
  A['sx-story'] = (el) => openStories(el.getAttribute('data-a'));
  A['sx-story-add'] = () => { const i = $('oslStoryPick'); if (i) i.click(); else { core.go('feed'); setTimeout(() => { const j = $('oslStoryPick'); if (j) j.click(); }, 200); } };

  window.OST_SOCIAL = { open, compose, marketEmbed, share: (embed, text) => compose({ embed, text }), profile: (a) => whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); openProfile(a); }), post: (id) => whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); openPost(id); }), pay: payTo, refresh: () => { SS.loadedAt = Date.now(); loadFeed(true); loadStories(); loadNotifs(true); }, state: () => ({ posts: SS.posts.length, stories: SS.stories.length, unread: SS.notifs.unread, view: S.view }) };
  handleHash();   // every route waits for the identity itself
  // Warm the alert badge once identity is up (one request; opening the feed within 30 s reuses it).
  whenReady(() => setTimeout(() => loadNotifs(), 2500));
})();
