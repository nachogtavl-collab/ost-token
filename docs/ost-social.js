/* ==========================================================================
 * OST · Social — the public side of the mesh (feed, stories, profiles, tips)
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
 *             #u= deep links; Social link in the desktop nav and appbar
 * window.OST_SOCIAL.{ open, compose, share, profile, post, pay }
 * ========================================================================== */
(function boot() {
  if (window.OST_SOCIAL) return;
  const core = window.OST_MESH_APP && window.OST_MESH_APP.core;
  if (!core) { window.addEventListener('ost:mesh-app:core', boot, { once: true }); return; }
  const { S, X, API, esc, toast, ago, avStyle, signed, shortA } = core;
  const $ = (id) => document.getElementById(id);
  const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐳', '🦉', '🐝', '🌵', '🍀', '⚡', '🔥', '🌙', '🎧', '🛰️', '🎲', '🚀', '💎'];
  const MINT = { OSTG: 'DfgxMbdN49AX2Za9LuvsyixF1jgVh45RbgWYSGonxQos' };
  const IMG_EDGE = 2048, VID_MAX = 40 * 1024 * 1024;
  const SS = {
    mode: core.lsGet('ost.social.mode', 'all'), posts: [], cursor: null, loading: false, loaded: false, err: '',
    users: {}, stories: [], notifs: { items: [], unread: 0 }, newPosts: 0, stack: [],
    draft: { text: '', media: [], embed: null, busy: '' }, postId: null, comments: {}, profileOf: null, search: '', people: null
  };
  const mediaUrl = (id) => API + '/mesh/v1/social/media/' + encodeURIComponent(id);
  const me = () => S.address;
  const fmtN = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
  const fmtAmt = (n) => { n = Number(n) || 0; return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toFixed(4).replace(/\.?0+$/, ''); };

  /* ---------- data ---------- */
  async function getJ(path) {
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
    try {
      const r = await fetch(API + path, { cache: 'no-store', signal: ctl && ctl.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) ? String(j.error).replace(/_/g, ' ') : 'HTTP ' + r.status);
      return j;
    } finally { if (t) clearTimeout(t); }
  }
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
    if (u.avatar) return `<span class="osl-av ${cls || ''}" style="${avStyle(a)}"><img src="${mediaUrl(u.avatar)}" alt="" loading="lazy"></span>`;
    return `<span class="osl-av ${cls || ''}" style="${avStyle(a)}">${esc(u.emoji || (u.name || 'm')[0].toUpperCase())}</span>`;
  }
  const badge = (a) => (user(a).walletVerified || (a === me() && S.profile.wallet)) ? '<i class="osl-ver" title="Wallet verified by signature">✓</i>' : '';
  function rich(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`).replace(/(^|\s)#([\p{L}0-9_]{2,30})/gu, '$1<b class="osl-tag">#$2</b>').replace(/\n/g, '<br>');
  }
  const blocked = (a) => { const c = core.contact(a); return !!(c && c.state === 'blocked'); };

  async function loadFeed(reset) {
    if (SS.loading) return;
    SS.loading = true; SS.err = '';
    if (reset) { SS.cursor = null; SS.newPosts = 0; }
    paintFeedList();
    try {
      const q = '/mesh/v1/social/feed?limit=12' + (SS.mode === 'following' ? '&mode=following' : '') + '&me=' + encodeURIComponent(me() || '') + (!reset && SS.cursor ? '&cursor=' + encodeURIComponent(SS.cursor) : '');
      const j = await getJ(q);
      absorb(j.authors);
      SS.posts = reset ? j.posts : SS.posts.concat(j.posts.filter((p) => !SS.posts.some((x) => x.id === p.id)));
      SS.cursor = j.cursor; SS.loaded = true;
    } catch (e) { SS.err = e.message || 'Feed unavailable'; }
    SS.loading = false;
    paintFeedList();
  }
  async function loadStories() {
    try { const j = await getJ('/mesh/v1/social/stories?me=' + encodeURIComponent(me() || '')); SS.stories = j.groups || []; (SS.stories || []).forEach((g) => { if (g.profile) absorb({ [g.author]: g.profile }); }); } catch (_) {}
    paintStories();
  }
  async function loadNotifs() {
    if (!me()) return;
    try { const j = await signed('GET', '/mesh/v1/social/notifs?addr=' + encodeURIComponent(me())); absorb(j.authors); SS.notifs = { items: j.items || [], unread: j.unread || 0, seenAt: j.seenAt || 0 }; } catch (_) {}
    paintBell(); refreshTabs();
  }
  function refreshTabs() { try { const t = document.getElementById('omxTabs'); if (!t || t.hidden) return; t.querySelectorAll('[data-tab="feed"] .omx-badge').forEach((x) => x.remove()); if (SS.notifs.unread) { const b = t.querySelector('[data-tab="feed"]'); if (b) b.insertAdjacentHTML('beforeend', `<span class="omx-badge">${SS.notifs.unread}</span>`); } } catch (_) {} }

  /* ---------- navigation inside the sheet ---------- */
  function go(view, extra) { if (S.view !== view) SS.stack.push(S.view); if (SS.stack.length > 20) SS.stack.shift(); Object.assign(SS, extra || {}); core.go(view); }
  function back() { const v = SS.stack.pop() || 'feed'; core.go(v); }
  function head(ctx, title, sub, right) {
    ctx.head.innerHTML = `<button class="omx-ib" data-act="sx-back" aria-label="Back">‹</button><h2>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>${right || ''}<button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
  }

  /* ---------- FEED ---------- */
  function renderFeed(ctx) {
    ctx.head.innerHTML = `<h2>OST Social<small>devnet · signed &amp; public</small></h2><button class="omx-ib" data-act="sx-search" aria-label="Search people">🔍</button><button class="omx-ib osl-bell" data-act="sx-notifs" aria-label="Notifications" id="oslBell">🔔</button><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    ctx.body.innerHTML = `<div class="osl-stories" id="oslStories"></div>
      <button class="osl-cta" data-act="sx-compose">${avatar(me())}<span>What's happening, ${esc(S.profile.name || 'friend')}?</span><b>📷</b></button>
      <div class="osl-modes"><button data-act="sx-mode" data-m="all" class="${SS.mode === 'all' ? 'on' : ''}">For you</button><button data-act="sx-mode" data-m="following" class="${SS.mode === 'following' ? 'on' : ''}">Following</button></div>
      <button class="osl-newpill" id="oslNew" data-act="sx-refresh" hidden>New posts ↑</button>
      <div id="oslPosts"></div>`;
    paintBell(); paintStories();
    if (!SS.loaded || Date.now() - (SS.loadedAt || 0) > 60000) { SS.loadedAt = Date.now(); loadFeed(true); loadStories(); loadNotifs(); } else paintFeedList();
  }
  function paintBell() { const b = $('oslBell'); if (b) b.innerHTML = '🔔' + (SS.notifs.unread ? `<span class="omx-badge">${SS.notifs.unread > 99 ? '99+' : SS.notifs.unread}</span>` : ''); }
  function paintFeedList() {
    const el = $('oslPosts'); if (!el) return;
    const n = $('oslNew'); if (n) n.hidden = !SS.newPosts;
    const posts = SS.posts.filter((p) => !blocked(p.author));
    let h = posts.map(postHtml).join('');
    if (SS.loading && !posts.length) h = skeleton();
    else if (SS.err && !posts.length) h = `<div class="omx-empty"><b>📡</b>Could not load the feed (${esc(SS.err)}).<br><button class="omx-ghost" data-act="sx-refresh">Retry</button></div>`;
    else if (!posts.length) h = SS.mode === 'following' ? `<div class="omx-empty"><b>🧭</b>Nothing from people you follow yet.<br><button class="omx-ghost" data-act="sx-search">Find people to follow</button></div>` : `<div class="omx-empty"><b>✨</b>No posts yet — be the first.<br><button class="omx-primary" data-act="sx-compose">Create a post</button></div>`;
    else if (SS.cursor) h += `<button class="omx-ghost osl-more" data-act="sx-more">${SS.loading ? 'Loading…' : 'Load more'}</button>`;
    else h += '<div class="osl-end">You are all caught up ✓</div>';
    el.innerHTML = h;
    wireVideos(el);
  }
  const skeleton = () => '<div class="osl-skel"></div><div class="osl-skel"></div><div class="osl-skel"></div>';
  function mediaHtml(p) {
    const m = p.media || [];
    if (!m.length) return '';
    if (m[0].kind === 'video') return `<div class="osl-media one"><video src="${mediaUrl(m[0].id)}" ${m[0].poster ? `poster="${mediaUrl(m[0].poster)}"` : ''} preload="metadata" controls playsinline muted loop data-autoplay></video></div>`;
    return `<div class="osl-media n${Math.min(m.length, 4)}">${m.slice(0, 4).map((x, i) => `<img src="${mediaUrl(x.id)}" alt="" loading="lazy" data-act="sx-lightbox" data-p="${esc(p.id)}" data-i="${i}" ${x.w && x.h && m.length === 1 ? `style="aspect-ratio:${x.w}/${x.h}"` : ''}>`).join('')}</div>`;
  }
  function embedHtml(e) {
    if (!e) return '';
    const ico = { market: '📈', bet: '🎯', perp: '⚡', game: '🎮', wallet: '👛', stock: '💹', link: '🔗' }[e.kind] || '🔗';
    return `<button class="osl-embed" data-act="sx-embed" data-href="${esc(e.href || '')}">${e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<b>${ico}</b>`}<span><em>${esc(e.kind === 'bet' ? 'Prediction bet' : e.kind === 'perp' ? 'Perp position' : e.kind === 'wallet' ? 'Wallet' : e.kind === 'market' ? 'Market' : 'OST')}</em><strong>${esc(e.title)}</strong>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>${e.price ? `<i>${esc(e.price)}</i>` : ''}</button>`;
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
        <button data-act="sx-like" data-p="${esc(p.id)}" class="${p.my === 'like' ? 'on' : ''}" aria-label="Like">👍 <span>${fmtN(p.likes)}</span></button>
        <button data-act="sx-dislike" data-p="${esc(p.id)}" class="${p.my === 'dislike' ? 'on dis' : ''}" aria-label="Dislike">👎 <span>${fmtN(p.dislikes)}</span></button>
        <button data-act="sx-open" data-p="${esc(p.id)}" aria-label="Comments">💬 <span>${fmtN(p.comments)}</span></button>
        <button data-act="sx-tip" data-p="${esc(p.id)}" aria-label="Tip OST">💸 <span>Tip</span></button>
        <button data-act="sx-share" data-p="${esc(p.id)}" aria-label="Share">↗</button>
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
    vidIO = vidIO || new IntersectionObserver((es) => es.forEach((e) => { const v = e.target; if (e.isIntersecting && e.intersectionRatio > 0.6) { if (v.paused && v.muted) v.play().catch(() => {}); } else if (!v.paused) v.pause(); }), { threshold: [0, 0.6] });
    root.querySelectorAll('video[data-autoplay]').forEach((v) => { if (!v.__io) { v.__io = 1; vidIO.observe(v); } });
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
    catch (e) { updatePost(p); toast(e.message, 'err'); }
  }
  async function openPost(id) {
    SS.postId = id; SS.single = findPost(id) || null;
    go('post');
    if (!SS.single) { try { const j = await getJ('/mesh/v1/social/post?id=' + encodeURIComponent(id) + '&me=' + encodeURIComponent(me() || '')); absorb(j.authors); SS.single = j.posts[0]; } catch (e) { SS.single = { missing: e.message }; } }
    paintPost(); loadComments(id);
  }
  function renderPostView(ctx) {
    head(ctx, 'Post', '');
    ctx.body.innerHTML = `<div id="oslSingle"></div><div class="osl-comments" id="oslComments"></div>
      <div class="osl-cbox"><textarea id="oslCText" rows="1" maxlength="500" placeholder="Write a comment…"></textarea><button class="omx-ib omx-send" data-act="sx-comment">➤</button></div>`;
    paintPost(); paintComments();
  }
  function paintPost() { const el = $('oslSingle'); if (!el) return; const p = SS.single; el.innerHTML = !p ? skeleton() : p.missing ? `<div class="omx-empty"><b>🗑️</b>This post is gone (${esc(p.missing)}).</div>` : postHtml(p); wireVideos(el); }
  async function loadComments(id) { try { const j = await getJ('/mesh/v1/social/comments?postId=' + encodeURIComponent(id)); absorb(j.authors); SS.comments[id] = j.comments || []; } catch (_) { SS.comments[id] = SS.comments[id] || []; } paintComments(); }
  function paintComments() {
    const el = $('oslComments'); if (!el) return;
    const list = SS.comments[SS.postId];
    if (!list) { el.innerHTML = '<div class="osl-end">Loading comments…</div>'; return; }
    const post = SS.single;
    el.innerHTML = list.length ? list.map((c) => `<div class="osl-cm"><button data-act="sx-profile" data-a="${esc(c.author)}">${avatar(c.author, 'sm')}</button><div><b>${esc(dname(c.author))}${badge(c.author)}</b> <small>${ago(c.ts)}</small><p>${rich(c.text)}</p></div>${c.author === me() || (post && post.author === me()) ? `<button class="osl-x" data-act="sx-cdel" data-c="${esc(c.id)}" aria-label="Delete comment">✕</button>` : ''}</div>`).join('') : '<div class="osl-end">No comments yet — start the conversation.</div>';
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
    } catch (e) { ta.value = text; toast(e.message, 'err'); }
    ta.disabled = false; try { ta.focus(); } catch (_) {}
  }

  /* ---------- media helpers ---------- */
  async function imageToUpload(file, edge) {
    if (/gif$/.test(file.type)) { const bmp0 = await createImageBitmap(file).catch(() => null); return { blob: file, mime: file.type, w: bmp0 ? bmp0.width : 0, h: bmp0 ? bmp0.height : 0 }; }
    const bmp = await createImageBitmap(file);
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
    if (!/^image\//.test(file.type)) throw new Error('Pick a photo or a video.');
    const img = await imageToUpload(file);
    return { kind: 'image', blob: img.blob, mime: img.mime, w: img.w, h: img.h, url: URL.createObjectURL(img.blob), size: img.blob.size };
  }

  /* ---------- COMPOSER ---------- */
  function renderCompose(ctx) {
    const d = SS.draft;
    head(ctx, 'New post', d.busy || '', `<button class="osl-postbtn" data-act="sx-publish" ${d.busy ? 'disabled' : ''}>${d.busy ? '…' : 'Post'}</button>`);
    ctx.body.innerHTML = `<div class="osl-comp">${avatar(me())}<textarea id="oslText" maxlength="2000" placeholder="Share something with OST…">${esc(d.text)}</textarea></div>
      <div class="osl-picks">${d.media.map((m, i) => `<div class="osl-pick">${m.kind === 'video' ? `<video src="${m.url}" muted playsinline></video><i>🎬</i>` : `<img src="${m.url}" alt="">`}<button data-act="sx-unpick" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
      ${d.embed ? `<div class="osl-attached">${embedHtml(d.embed)}<button data-act="sx-unembed" aria-label="Remove attachment">✕</button></div>` : ''}
      <div class="osl-tools">
        <label class="omx-ghost">📷 Photos<input type="file" id="oslPickImg" accept="image/*" multiple hidden></label>
        <label class="omx-ghost">🎬 Video<input type="file" id="oslPickVid" accept="video/mp4,video/webm,video/quicktime,video/*" hidden></label>
        <button class="omx-ghost" data-act="sx-attach">📎 Attach from OST</button>
      </div>
      <div id="oslAttachList"></div>
      <div class="omx-note">Posts are public and signed with your mesh key. Up to 4 photos or 1 video (≤ 40 MB). Everyone on OST Social can see them.</div>`;
    const ta = $('oslText'); if (ta) { ta.addEventListener('input', () => { d.text = ta.value; }); setTimeout(() => { try { ta.focus(); } catch (_) {} }, 50); }
    ['oslPickImg', 'oslPickVid'].forEach((id) => { const inp = $(id); if (inp) inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []); inp.value = '';
      for (const f of files) {
        if (d.media.some((m) => m.kind === 'video') || (/^video\//.test(f.type) && d.media.length)) { toast('A post has either up to 4 photos or one video.', 'err'); break; }
        if (d.media.length >= 4) { toast('Up to 4 photos per post.', 'err'); break; }
        try { d.media.push(await pickToItem(f)); } catch (e) { toast(e.message, 'err'); }
      }
      core.render();
    }); });
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
    if (window.OST_WALLET_PUBKEY) out.push({ kind: 'wallet', title: 'Send me OST on devnet', sub: 'Tap to open my profile and tip', href: '#u=' + encodeURIComponent(me()) });
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
    if (!d.text.trim() && !d.media.length && !d.embed) { toast('Write something or add a photo.', 'err'); return; }
    try {
      if (!S.announced) await core.announce();
      const media = [];
      for (let i = 0; i < d.media.length; i++) { d.busy = `Uploading ${i + 1}/${d.media.length} (${core.fmtSize(d.media[i].size || 0)})…`; core.render(); media.push(await uploadPicked(d.media[i], 'post')); }
      d.busy = 'Publishing…'; core.render();
      const r = await signed('POST', '/mesh/v1/social/post', { from: me(), text: d.text.trim(), media, embed: d.embed });
      absorb(r.authors);
      SS.posts = (r.posts || []).concat(SS.posts);
      d.media.forEach((m) => { try { URL.revokeObjectURL(m.url); } catch (_) {} });
      SS.draft = { text: '', media: [], embed: null, busy: '' };
      toast('Posted ✓'); SS.stack = []; core.go('feed');
    } catch (e) { d.busy = ''; core.render(); toast(e.message || 'Post failed', 'err'); }
  }

  /* ---------- STORIES ---------- */
  function paintStories() {
    const el = $('oslStories'); if (!el) return;
    const mine = SS.stories.find((g) => g.author === me());
    let h = `<button class="osl-st me" data-act="${mine ? 'sx-story' : 'sx-story-add'}" data-a="${esc(me())}"><span class="osl-ring ${mine ? '' : 'none'}">${avatar(me())}</span>${mine ? '' : '<i>＋</i>'}<small>Your story</small></button>`;
    if (mine) h += `<button class="osl-st" data-act="sx-story-add"><span class="osl-ring none"><span class="osl-av">＋</span></span><small>Add</small></button>`;
    h += SS.stories.filter((g) => g.author !== me() && !blocked(g.author)).map((g) => `<button class="osl-st" data-act="sx-story" data-a="${esc(g.author)}"><span class="osl-ring ${g.items.every((s) => s.seen) ? 'seen' : ''}">${avatar(g.author)}</span><small>${esc(dname(g.author))}</small></button>`).join('');
    el.innerHTML = h + '<input type="file" id="oslStoryPick" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>';
    const inp = $('oslStoryPick'); if (inp) inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) storyCompose(f); });
  }
  async function storyCompose(file) {
    let item; try { item = await pickToItem(file); } catch (e) { toast(e.message, 'err'); return; }
    sheet(`<h3>New story</h3><div class="osl-stprev">${item.kind === 'video' ? `<video src="${item.url}" autoplay muted loop playsinline></video>` : `<img src="${item.url}" alt="">`}</div>
      <input class="omx-input" id="oslStCap" maxlength="200" placeholder="Add a caption (optional)">
      <div class="omx-row2" style="margin-top:10px"><button class="omx-primary" id="oslStGo">Share for 24 hours</button><button class="omx-ghost" data-sheet="close">Cancel</button></div>
      <div class="omx-note">Stories are public and disappear after 24 hours.</div>`);
    $('oslStGo').onclick = async () => {
      const b = $('oslStGo'); b.disabled = true; b.textContent = 'Uploading…';
      try {
        if (!S.announced) await core.announce();
        const up = await uploadPicked(item, 'story');
        await signed('POST', '/mesh/v1/social/story', { from: me(), media: { id: up.id, poster: up.poster || '' }, caption: ($('oslStCap') || {}).value || '' });
        closeSheet(); toast('Story shared ✓'); loadStories();
      } catch (e) { b.disabled = false; b.textContent = 'Share for 24 hours'; toast(e.message, 'err'); }
    };
  }
  // Full-screen viewer
  const SV = { groups: [], gi: 0, ii: 0, timer: null, startAt: 0, dur: 0, paused: false };
  function openStories(author) {
    const groups = SS.stories.filter((g) => !blocked(g.author));
    const gi = groups.findIndex((g) => g.author === author); if (gi < 0) return;
    SV.groups = groups; SV.gi = gi; SV.ii = Math.max(0, groups[gi].items.findIndex((s) => !s.seen)); if (SV.ii < 0) SV.ii = 0;
    let el = $('oslStory');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslStory'; document.body.appendChild(el);
      el.addEventListener('click', onStoryClick);
      el.addEventListener('pointerdown', () => { SV.paused = true; const v = el.querySelector('video'); if (v) v.pause(); });
      el.addEventListener('pointerup', () => { SV.paused = false; const v = el.querySelector('video'); if (v) v.play().catch(() => {}); });
      document.addEventListener('keydown', (e) => { if (!el.classList.contains('on')) return; if (e.key === 'Escape') closeStories(); if (e.key === 'ArrowRight') stNext(); if (e.key === 'ArrowLeft') stPrev(); });
    }
    el.classList.add('on'); showStory();
  }
  function closeStories() { const el = $('oslStory'); if (el) { el.classList.remove('on'); el.innerHTML = ''; } clearInterval(SV.timer); paintStories(); }
  function showStory() {
    const el = $('oslStory'); const g = SV.groups[SV.gi]; if (!g) return closeStories();
    const s = g.items[SV.ii]; if (!s) return closeStories();
    const mine = g.author === me();
    el.innerHTML = `<div class="osl-sbars">${g.items.map((x, i) => `<i><b style="width:${i < SV.ii ? 100 : 0}%" ${i === SV.ii ? 'id="oslSBar"' : ''}></b></i>`).join('')}</div>
      <div class="osl-shead">${avatar(g.author, 'sm')}<b>${esc(dname(g.author))}</b><small>${ago(s.ts)}</small><button data-st="close" aria-label="Close">✕</button></div>
      <div class="osl-smedia">${s.media.kind === 'video' ? `<video id="oslSVid" src="${mediaUrl(s.media.id)}" ${s.media.poster ? `poster="${mediaUrl(s.media.poster)}"` : ''} autoplay playsinline></video>` : `<img src="${mediaUrl(s.media.id)}" alt="">`}</div>
      <div class="osl-snav"><button data-st="prev" aria-label="Previous"></button><button data-st="next" aria-label="Next"></button></div>
      ${s.caption ? `<div class="osl-scap">${esc(s.caption)}</div>` : ''}
      <div class="osl-sfoot">${mine ? `<span>👁 ${fmtN(s.views || 0)} views</span><button data-st="del">Delete</button>` : `<input id="oslSReply" placeholder="Reply to ${esc(dname(g.author))}…" maxlength="300"><button data-st="reply">➤</button>`}</div>`;
    s.seen = true;
    if (!mine && me()) signed('POST', '/mesh/v1/social/story/view', { from: me(), storyId: s.id }).catch(() => {});
    clearInterval(SV.timer); SV.startAt = Date.now(); SV.dur = 5000; let elapsed = 0, last = Date.now();
    const v = $('oslSVid');
    if (v) { v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); v.onloadedmetadata = () => { SV.dur = Math.min(30000, (v.duration || 5) * 1000); }; v.onended = stNext; }
    SV.timer = setInterval(() => {
      const now = Date.now(); if (!SV.paused && !(document.activeElement && document.activeElement.id === 'oslSReply')) elapsed += now - last; last = now;
      const bar = $('oslSBar'); if (bar) bar.style.width = Math.min(100, elapsed / SV.dur * 100) + '%';
      if (elapsed >= SV.dur && !v) stNext();
      if (v && elapsed >= 30000) stNext();
    }, 100);
  }
  function stNext() { const g = SV.groups[SV.gi]; if (!g) return closeStories(); if (SV.ii < g.items.length - 1) SV.ii++; else if (SV.gi < SV.groups.length - 1) { SV.gi++; SV.ii = 0; } else return closeStories(); showStory(); }
  function stPrev() { if (SV.ii > 0) SV.ii--; else if (SV.gi > 0) { SV.gi--; SV.ii = SV.groups[SV.gi].items.length - 1; } showStory(); }
  async function onStoryClick(e) {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.getAttribute('data-st'); const g = SV.groups[SV.gi]; const s = g && g.items[SV.ii];
    if (k === 'close') closeStories();
    else if (k === 'next') stNext();
    else if (k === 'prev') stPrev();
    else if (k === 'del' && s) { if (!confirm('Delete this story?')) return; try { await signed('POST', '/mesh/v1/social/story/delete', { from: me(), storyId: s.id }); g.items.splice(SV.ii, 1); if (!g.items.length) { SS.stories = SS.stories.filter((x) => x !== g); closeStories(); } else { SV.ii = Math.min(SV.ii, g.items.length - 1); showStory(); } } catch (err) { toast(err.message, 'err'); } }
    else if (k === 'reply' && s) {
      const inp = $('oslSReply'); const text = (inp && inp.value || '').trim(); if (!text) return;
      const c = core.contact(g.author);
      if (!c || c.state === 'blocked') { toast('Add ' + dname(g.author) + ' first to message them — sent a request.'); await core.addPerson({ addr: g.author, name: user(g.author).name }); }
      try { await core.sendInner(g.author, { k: 'text', text: '↩︎ Replied to your story: ' + text }, { kind: 'text', text: '↩︎ Replied to your story: ' + text }); inp.value = ''; toast('Reply sent privately'); } catch (err) { toast(err.message, 'err'); }
    }
  }

  /* ---------- PROFILE ---------- */
  async function openProfile(addr) { SS.profileOf = addr; SS.profileUser = null; SS.profilePosts = null; go(addr === me() ? 'me' : 'profile'); }
  async function loadProfile(addr) {
    try { const j = await getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(addr) + '&me=' + encodeURIComponent(me() || '')); absorb({ [addr]: j.user }); SS.profileUser = j; } catch (e) { SS.profileUser = { err: e.message }; }
    try { const j = await getJ('/mesh/v1/social/feed?author=' + encodeURIComponent(addr) + '&limit=20&me=' + encodeURIComponent(me() || '')); absorb(j.authors); SS.profilePosts = j.posts || []; } catch (_) { SS.profilePosts = SS.profilePosts || []; }
    if ((S.view === 'profile' || S.view === 'me') && SS.profileOf === addr) paintProfile();
  }
  function renderProfile(ctx, self) {
    const addr = self ? me() : (SS.profileOf || S.profileOf);
    if (!addr) { ctx.body.innerHTML = '<div class="omx-empty">Loading your identity…</div>'; return; }
    SS.profileOf = addr;
    if (self) ctx.head.innerHTML = `<h2>${esc(dname(addr))}<small>Your profile</small></h2><button class="omx-ib" data-act="sx-settings" aria-label="Settings">⚙️</button><button class="omx-ib" data-act="close" aria-label="Close">✕</button>`;
    else head(ctx, dname(addr), shortA(addr));
    ctx.body.innerHTML = '<div id="oslProfile"></div><div id="oslPPosts"></div>';
    paintProfile();
    if (!SS.profileUser || SS.profileUser.user && SS.profileUser.user.addr !== addr || Date.now() - (SS.profileAt || 0) > 20000) { SS.profileAt = Date.now(); loadProfile(addr); }
  }
  function paintProfile() {
    const el = $('oslProfile'); if (!el) return;
    const addr = SS.profileOf, self = addr === me();
    const j = SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === addr ? SS.profileUser : null;
    const u = user(addr), c = core.contact(addr);
    const counts = (j && j.counts) || { posts: '–', followers: '–', following: '–' };
    const wallet = self ? (S.profile.wallet || u.wallet) : u.wallet;
    let btns = '';
    if (self) {
      btns = `<button class="omx-primary" data-act="sx-edit">Edit profile</button>
        ${wallet ? `<button class="omx-ghost" data-act="sx-unlink">👛 ${esc(wallet.slice(0, 4) + '…' + wallet.slice(-4))} · unlink</button>` : `<button class="omx-ghost" data-act="sx-link">👛 Link wallet for tips</button>`}`;
    } else {
      const friend = c && (c.state === 'friend' || c.state === 'pending-out');
      btns = `<button class="${j && j.iFollow ? 'omx-ghost' : 'omx-primary'}" data-act="sx-follow" data-a="${esc(addr)}" data-on="${j && j.iFollow ? 0 : 1}">${j && j.iFollow ? 'Following ✓' : 'Follow'}</button>
        <button class="omx-ghost" data-act="sx-message" data-a="${esc(addr)}">💬 ${friend ? 'Message' : 'Add & message'}</button>
        ${friend && window.OST_MESH_CALL ? `<button class="omx-ghost" data-act="sx-call" data-a="${esc(addr)}" data-v="0">📞</button><button class="omx-ghost" data-act="sx-call" data-a="${esc(addr)}" data-v="1">🎥</button>` : ''}
        <button class="omx-ghost" data-act="sx-send" data-a="${esc(addr)}" ${wallet ? '' : 'disabled title="No wallet linked yet"'}>💸 Send</button>`;
    }
    el.innerHTML = `<div class="osl-phero">${avatar(addr, 'xl')}<div><b>${esc(dname(addr))}${badge(addr)}</b>${j && j.online ? '<span class="osl-online">● online</span>' : ''}<small>${esc(addr)}</small>${wallet ? `<small>👛 ${esc(wallet)}</small>` : ''}</div></div>
      ${u.bio ? `<p class="osl-bio">${rich(u.bio)}</p>` : (self ? '<p class="osl-bio dim">Add a bio so people know who you are.</p>' : '')}
      <div class="osl-counts"><button data-act="sx-list" data-dir="posts"><b>${fmtN(counts.posts)}</b>posts</button><button data-act="sx-list" data-dir="followers"><b>${fmtN(counts.followers)}</b>followers</button><button data-act="sx-list" data-dir="following"><b>${fmtN(counts.following)}</b>following</button>${j && j.followsMe ? '<span class="osl-fyou">Follows you</span>' : ''}</div>
      <div class="osl-pbtns">${btns}</div>
      ${self ? `<div class="osl-pbtns"><button class="omx-ghost" data-act="sx-compose">✍️ New post</button><button class="omx-ghost" data-act="sx-story-add">➕ Story</button><button class="omx-ghost" data-act="sx-share-me">↗ Share profile</button></div>` : ''}
      ${SS.profileUser && SS.profileUser.err ? `<div class="omx-note">Profile unavailable: ${esc(SS.profileUser.err)}</div>` : ''}`;
    const pe = $('oslPPosts'); if (!pe) return;
    const posts = SS.profilePosts;
    pe.innerHTML = !posts ? skeleton() : posts.length ? posts.map(postHtml).join('') : `<div class="omx-empty"><b>📝</b>${self ? 'You have not posted yet.' : 'No posts yet.'}</div>`;
    wireVideos(pe);
    if (self && !$('oslStoryPick')) pe.insertAdjacentHTML('beforeend', '<input type="file" id="oslStoryPick" accept="image/*,video/mp4,video/webm,video/quicktime" hidden>');
    const inp = $('oslStoryPick'); if (inp && !inp.__w) { inp.__w = 1; inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) storyCompose(f); }); }
  }
  function renderEdit(ctx) {
    head(ctx, 'Edit profile', '');
    const p = S.profile;
    ctx.body.innerHTML = `<div class="omx-card"><div class="osl-phero">${avatar(me(), 'xl')}<div><label class="omx-ghost">📷 Change photo<input type="file" id="oslAvPick" accept="image/*" hidden></label>${p.avatar ? '<button class="omx-ghost" data-act="sx-avatar-clear" style="margin-top:6px">Remove photo</button>' : ''}</div></div>
      <label class="omx-note" for="oslName">Name</label><input class="omx-input" id="oslName" maxlength="32" value="${esc(p.name || '')}" placeholder="Your name">
      <label class="omx-note" for="oslBio">Bio</label><textarea class="omx-input" id="oslBio" maxlength="200" rows="3" placeholder="A line about you">${esc(p.bio || '')}</textarea>
      <div class="omx-note">Emoji (used when you have no photo)</div><div class="omx-emojis">${EMOJIS.map((e) => `<button data-act="sx-emoji" data-e="${e}" class="${p.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div>
      <button class="omx-primary" data-act="sx-save">Save profile</button></div>`;
    const av = $('oslAvPick'); if (av) av.addEventListener('change', async () => {
      const f = av.files && av.files[0]; av.value = ''; if (!f) return;
      try { toast('Uploading photo…'); const img = await imageToUpload(f, 512); if (!S.announced) await core.announce(); const id = await upload(img.blob, img.mime, 'avatar', img.w, img.h); await core.saveProfile({ avatar: id }); absorb({ [me()]: { avatar: id } }); core.render(); toast('Photo updated ✓'); } catch (e) { toast(e.message, 'err'); }
    });
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
    const items = SS.notifs.items || [];
    ctx.body.innerHTML = items.length ? '<div class="omx-list">' + items.map((n) => {
      const txt = n.kind === 'like' ? 'liked your post' : n.kind === 'comment' ? 'commented: “' + esc(n.text || '') + '”' : n.kind === 'follow' ? 'started following you' : n.kind === 'tip' ? `tipped you <b>${esc(fmtAmt(n.amount))} ${esc(n.ccy)}</b> 💸` : esc(n.kind);
      return `<button class="omx-item ${n.ts > (SS.notifs.seenAt || 0) ? 'osl-unseen' : ''}" data-act="${n.postId ? 'sx-open' : 'sx-profile'}" data-p="${esc(n.postId || '')}" data-a="${esc(n.from)}">${avatar(n.from)}<div class="omx-main"><b>${esc(dname(n.from))}</b><span>${txt}</span></div><div class="omx-meta"><span>${ago(n.ts)}</span></div></button>`;
    }).join('') + '</div>' : '<div class="omx-empty"><b>🔔</b>No notifications yet.<br>Likes, comments, follows and tips show up here.</div>';
    if (SS.notifs.unread) { SS.notifs.unread = 0; SS.notifs.seenAt = Date.now(); paintBell(); signed('POST', '/mesh/v1/social/notifs/seen', { addr: me() }).catch(() => {}); }
  }
  let searchT = null;
  function renderSearch(ctx) {
    head(ctx, 'People', '');
    ctx.body.innerHTML = `<input class="omx-input" id="oslQ" placeholder="Search by name or paste an ost-mesh address" value="${esc(SS.search)}" autocomplete="off"><div id="oslRes" style="margin-top:10px"></div>`;
    const q = $('oslQ'); q.addEventListener('input', () => { SS.search = q.value; clearTimeout(searchT); searchT = setTimeout(runSearch, 300); }); setTimeout(() => { try { q.focus(); } catch (_) {} }, 50);
    runSearch();
  }
  async function runSearch() {
    const el = $('oslRes'); if (!el) return;
    const q = SS.search.trim();
    el.innerHTML = '<div class="osl-end">Searching…</div>';
    try {
      const j = q ? await getJ('/mesh/v1/social/search?q=' + encodeURIComponent(q)) : (SS.people || (SS.people = await getJ('/mesh/v1/social/people?me=' + encodeURIComponent(me() || ''))));
      const users = (j.users || []).filter((u) => u && u.addr !== me());
      users.forEach((u) => absorb({ [u.addr]: u }));
      el.innerHTML = (q ? '' : '<div class="omx-note" style="margin:0 0 8px">People on OST</div>') + (users.length ? '<div class="omx-list">' + users.map((u) => `<button class="omx-item" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<div class="omx-main"><b>${esc(u.name || shortA(u.addr))}${u.walletVerified ? '<i class="osl-ver">✓</i>' : ''}</b><span>${esc(u.bio || shortA(u.addr))}</span></div></button>`).join('') + '</div>' : '<div class="omx-empty">Nobody found. Invite friends from Add → Your invite.</div>');
    } catch (e) { el.innerHTML = `<div class="omx-empty">Search failed: ${esc(e.message)}</div>`; }
  }
  function followList(dir) {
    const addr = SS.profileOf;
    if (dir === 'posts') { const pe = $('oslPPosts'); if (pe) pe.scrollIntoView({ behavior: 'smooth' }); return; }
    sheet(`<h3>${dir === 'followers' ? 'Followers' : 'Following'}</h3><div id="oslFl" class="osl-end">Loading…</div>`);
    getJ('/mesh/v1/social/follows?addr=' + encodeURIComponent(addr) + '&dir=' + dir).then((j) => {
      (j.users || []).forEach((u) => u && absorb({ [u.addr]: u }));
      const el = $('oslFl'); if (!el) return;
      el.className = ''; el.innerHTML = (j.users || []).length ? '<div class="omx-list">' + j.users.filter(Boolean).map((u) => `<button class="omx-item" data-sheet="close" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<div class="omx-main"><b>${esc(u.name || shortA(u.addr))}</b><span>${esc(shortA(u.addr))}</span></div></button>`).join('') + '</div>' : '<div class="omx-empty">Nobody yet.</div>';
    }).catch((e) => { const el = $('oslFl'); if (el) el.textContent = e.message; });
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
            for (let i = 0; i < 6 && !r; i++) { try { r = await signed('POST', '/mesh/v1/social/tip', { from: me(), postId, sig, ccy }); } catch (e) { err = e; if (!/tx not found|rpc/i.test(e.message)) break; await new Promise((res) => setTimeout(res, 2500)); } }
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

  /* ---------- small sheet + lightbox ---------- */
  function sheet(html) {
    let el = $('oslSheet');
    if (!el) { el = document.createElement('div'); el.id = 'oslSheet'; el.innerHTML = '<div class="osl-sheetbox" id="oslSheetBox"></div>'; document.body.appendChild(el); el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-sheet="close"]')) { if (e.target.closest('[data-act]') && el.contains(e.target)) { const a = e.target.closest('[data-act]'); const fn = X.actions[a.getAttribute('data-act')]; closeSheet(); if (fn) fn(a, e); return; } closeSheet(); } }); }
    $('oslSheetBox').innerHTML = html; el.classList.add('on');
  }
  function closeSheet() { const el = $('oslSheet'); if (el) el.classList.remove('on'); }
  function lightbox(p, i) {
    const imgs = (p.media || []).filter((m) => m.kind === 'image'); if (!imgs.length) return;
    let el = $('oslLight'); if (!el) { el = document.createElement('div'); el.id = 'oslLight'; document.body.appendChild(el); }
    let k = i;
    const draw = () => { el.innerHTML = `<img src="${mediaUrl(imgs[k].id)}" alt=""><button data-l="x" aria-label="Close">✕</button>${imgs.length > 1 ? `<button data-l="p" aria-label="Previous">‹</button><button data-l="n" aria-label="Next">›</button><span>${k + 1}/${imgs.length}</span>` : ''}`; };
    el.onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) { if (e.target === el) el.classList.remove('on'); return; } const l = b.getAttribute('data-l'); if (l === 'x') el.classList.remove('on'); else { k = (k + (l === 'n' ? 1 : imgs.length - 1)) % imgs.length; draw(); } };
    draw(); el.classList.add('on');
  }

  /* ---------- sharing + site navigation ---------- */
  const base = () => location.origin + location.pathname;
  async function sharePost(id) {
    const p = findPost(id); const url = base() + '#post=' + id;
    const contacts = Object.values(S.contacts).filter((c) => c.state === 'friend').slice(0, 8);
    sheet(`<h3>Share post</h3><div class="omx-row2"><button class="omx-primary" id="oslCopyP">Copy link</button>${navigator.share ? '<button class="omx-ghost" id="oslNatP">Share…</button>' : ''}</div>
      ${contacts.length ? `<div class="omx-note">Send to a friend</div><div class="omx-list">${contacts.map((c) => `<button class="omx-item" data-to="${esc(c.addr)}">${avatar(c.addr)}<div class="omx-main"><b>${esc(c.name || shortA(c.addr))}</b></div></button>`).join('')}</div>` : ''}`);
    $('oslCopyP').onclick = () => { core.copyText(url, 'Link copied'); closeSheet(); };
    const n = $('oslNatP'); if (n) n.onclick = () => { navigator.share({ title: 'OST Social', text: (p && p.text ? p.text.slice(0, 80) + ' — ' : '') + 'on OST Social', url }).catch(() => {}); closeSheet(); };
    $('oslSheetBox').querySelectorAll('[data-to]').forEach((b) => { b.onclick = () => { const to = b.getAttribute('data-to'); core.sendInner(to, { k: 'text', text: '📣 ' + (p && p.text ? '“' + p.text.slice(0, 120) + '” ' : '') + url }, { kind: 'text', text: '📣 ' + url }).then(() => toast('Sent to ' + dname(to))).catch((e) => toast(e.message, 'err')); closeSheet(); }; });
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
    core.close(); location.hash = h || '#';
  }
  function open(view) { if (!S.ready) { setTimeout(() => open(view), 200); return; } SS.stack = []; core.open(view || 'feed'); }
  function compose(opts) { opts = opts || {}; SS.draft = { text: opts.text || '', media: [], embed: opts.embed || null, busy: '' }; open('feed'); go('compose'); }
  // Deep links: #social, #post=<id>, #u=<addr>
  function handleHash() {
    const h = location.hash || '';
    const clear = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} };
    if (h === '#social' || h === '#feed') { clear(); open('feed'); return; }
    let m;
    if ((m = h.match(/^#post=(p[0-9a-f]{16,40})$/))) { clear(); const id = m[1]; const w = () => { if (!S.ready) return setTimeout(w, 200); core.open('feed'); openPost(id); }; w(); return; }
    if ((m = h.match(/^#u=(ost-mesh:[0-9a-f-]{8,40})$/i))) { clear(); const a = decodeURIComponent(m[1]); const w = () => { if (!S.ready) return setTimeout(w, 200); core.open('feed'); openProfile(a); }; w(); }
  }
  window.addEventListener('hashchange', handleHash);

  // Market page: a Share button in the detail header.
  function marketShareButton() {
    const tb = document.querySelector('#opmDetail .opm-tb'); if (!tb || tb.querySelector('.osl-mshare')) return;
    const b = document.createElement('button'); b.className = 'osl-mshare'; b.type = 'button'; b.title = 'Share to OST Social'; b.setAttribute('aria-label', 'Share to OST Social'); b.textContent = '↗ Share';
    b.onclick = () => { try { const m = OST_PREDICT_MOBILE.current(); if (m) compose({ embed: marketEmbed(m) }); } catch (_) { open('feed'); } };
    const sp = tb.querySelector('.opm-sp'); if (sp && sp.nextSibling) tb.insertBefore(b, sp.nextSibling); else tb.appendChild(b);
  }
  (function watchMarket(n) {
    const d = document.getElementById('opmDetail');
    if (!d) { if (n < 120) setTimeout(() => watchMarket(n + 1), 1000); return; }
    new MutationObserver(() => marketShareButton()).observe(d, { childList: true, subtree: false }); marketShareButton();
  })(0);
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
    setTimeout(() => actionToast('Bet placed — share it on OST Social?', 'Share', () => { const opts = attachOptions().filter((x) => x.kind === 'bet'); compose({ embed: opts[0] || null }); }), 1200);
  });
  // Desktop nav link
  (function navLink(n) {
    const nav = document.getElementById('navLinks');
    if (!nav) { if (n < 30) setTimeout(() => navLink(n + 1), 500); return; }
    if (nav.querySelector('.ost-nav-social')) return;
    const a = document.createElement('a'); a.href = '#social'; a.className = 'ost-nav-social'; a.textContent = 'Social';
    a.addEventListener('click', (e) => { e.preventDefault(); open('feed'); });
    const after = Array.from(nav.querySelectorAll('a')).find((x) => /markets/i.test(x.textContent || '')); if (after && after.nextSibling) nav.insertBefore(a, after.nextSibling); else nav.appendChild(a);
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  })(0);

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
  A['sx-mode'] = (el) => { SS.mode = el.getAttribute('data-m'); core.lsSet('ost.social.mode', SS.mode); core.render(); loadFeed(true); };
  A['sx-refresh'] = () => { loadFeed(true); loadStories(); };
  A['sx-more'] = () => loadFeed(false);
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
  A['sx-cdel'] = async (el) => { try { const r = await signed('POST', '/mesh/v1/social/comment/delete', { from: me(), postId: SS.postId, cid: el.getAttribute('data-c') }); SS.comments[SS.postId] = (SS.comments[SS.postId] || []).filter((c) => c.id !== el.getAttribute('data-c')); const p = findPost(SS.postId); if (p) updatePost(Object.assign({}, p, { comments: r.comments })); paintComments(); } catch (e) { toast(e.message, 'err'); } };
  A['sx-tip'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (!p) return; if (p.author === me()) { toast('You cannot tip your own post.'); return; } paySheet({ addr: p.author, postId: p.id }); };
  A['sx-share'] = (el) => sharePost(el.getAttribute('data-p'));
  A['sx-menu'] = (el) => {
    const p = findPost(el.getAttribute('data-p')); if (!p) return;
    const mine = p.author === me();
    sheet(`<h3>Post</h3><div class="omx-list">
      <button class="omx-item" id="oslMLink">🔗 Copy link</button>
      ${mine ? '<button class="omx-item omx-danger" id="oslMDel">🗑️ Delete post</button>' : `<button class="omx-item" id="oslMProf">👤 View ${esc(dname(p.author))}</button><button class="omx-item" id="oslMHide">🙈 Hide posts from this person</button>`}</div>`);
    $('oslMLink').onclick = () => { core.copyText(base() + '#post=' + p.id, 'Link copied'); closeSheet(); };
    const d = $('oslMDel'); if (d) d.onclick = async () => { if (!confirm('Delete this post for everyone?')) return; try { await signed('POST', '/mesh/v1/social/delete', { from: me(), postId: p.id }); SS.posts = SS.posts.filter((x) => x.id !== p.id); if (SS.profilePosts) SS.profilePosts = SS.profilePosts.filter((x) => x.id !== p.id); closeSheet(); toast('Deleted'); if (S.view === 'post') back(); else core.render(); } catch (e) { toast(e.message, 'err'); } };
    const pr = $('oslMProf'); if (pr) pr.onclick = () => { closeSheet(); openProfile(p.author); };
    const hd = $('oslMHide'); if (hd) hd.onclick = () => { core.upsertContact(p.author, { state: 'blocked' }); signed('POST', '/mesh/v1/friend/respond', { wallet: me(), other: p.author, action: 'block' }).catch(() => {}); closeSheet(); toast('Hidden'); core.render(); };
  };
  A['sx-lightbox'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (p) lightbox(p, Number(el.getAttribute('data-i')) || 0); };
  A['sx-embed'] = (el) => navTo(el.getAttribute('data-href'));
  A['sx-profile'] = (el) => openProfile(el.getAttribute('data-a'));
  A['sx-follow'] = async (el) => { const a = el.getAttribute('data-a'), on = el.getAttribute('data-on') === '1'; el.disabled = true; try { if (!S.announced) await core.announce(); await signed('POST', '/mesh/v1/social/follow', { from: me(), to: a, on }); if (SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === a) { SS.profileUser.iFollow = on; SS.profileUser.counts.followers = Math.max(0, (SS.profileUser.counts.followers || 0) + (on ? 1 : -1)); } paintProfile(); toast(on ? 'Following ' + dname(a) : 'Unfollowed'); } catch (e) { toast(e.message, 'err'); el.disabled = false; } };
  A['sx-message'] = async (el) => { const a = el.getAttribute('data-a'); const c = core.contact(a); S.backTo = S.view; if (c && (c.state === 'friend' || c.state === 'pending-out' || c.state === 'request')) core.openChat(a); else await core.addPerson({ addr: a, name: user(a).name, emoji: user(a).emoji }); };
  A['sx-call'] = (el) => { const a = el.getAttribute('data-a'); if (window.OST_MESH_CALL) OST_MESH_CALL.start(a, el.getAttribute('data-v') === '1'); };
  A['sx-send'] = (el) => paySheet({ addr: el.getAttribute('data-a'), chat: !!core.contact(el.getAttribute('data-a')) });
  A['sx-edit'] = () => go('edit');
  A['sx-emoji'] = (el) => { S.profile.emoji = el.getAttribute('data-e'); core.render(); };
  A['sx-save'] = async () => { try { const name = ($('oslName') || {}).value || '', bio = ($('oslBio') || {}).value || ''; const p = await core.saveProfile({ name: name.trim(), bio: bio.trim(), emoji: S.profile.emoji || '' }); absorb({ [me()]: p }); toast('Profile saved ✓'); back(); } catch (e) { toast(e.message, 'err'); } };
  A['sx-avatar-clear'] = async () => { try { await core.saveProfile({ avatar: '' }); S.profile.avatar = ''; absorb({ [me()]: { avatar: '' } }); core.render(); } catch (e) { toast(e.message, 'err'); } };
  A['sx-link'] = linkWallet;
  A['sx-unlink'] = async () => { if (!confirm('Unlink this wallet? People will not be able to tip you until you link one again.')) return; try { await signed('POST', '/mesh/v1/social/profile', { from: me(), unlinkWallet: true }); S.profile.wallet = ''; core.lsSet(core.K.profile, S.profile); absorb({ [me()]: { wallet: '', walletVerified: false } }); core.render(); } catch (e) { toast(e.message, 'err'); } };
  A['sx-settings'] = () => { SS.stack.push('me'); core.go('settings'); };
  A['sx-share-me'] = () => { const url = base() + '#u=' + encodeURIComponent(me()); if (navigator.share) navigator.share({ title: 'Follow me on OST Social', url }).catch(() => {}); else core.copyText(url, 'Profile link copied'); };
  A['sx-list'] = (el) => followList(el.getAttribute('data-dir'));
  A['sx-notifs'] = () => go('notifs');
  A['sx-search'] = () => go('search');
  A['sx-story'] = (el) => openStories(el.getAttribute('data-a'));
  A['sx-story-add'] = () => { const i = $('oslStoryPick'); if (i) i.click(); else { core.go('feed'); setTimeout(() => { const j = $('oslStoryPick'); if (j) j.click(); }, 200); } };

  window.OST_SOCIAL = { open, compose, share: (embed, text) => compose({ embed, text }), profile: (a) => { open('feed'); openProfile(a); }, post: (id) => { open('feed'); openPost(id); }, pay: payTo, refresh: () => { SS.loadedAt = Date.now(); loadFeed(true); loadStories(); loadNotifs(); }, state: () => ({ posts: SS.posts.length, stories: SS.stories.length, unread: SS.notifs.unread, view: S.view }) };
  if (S.ready) handleHash(); else { const w = () => { if (S.ready) handleHash(); else setTimeout(w, 200); }; w(); }
  // Warm the alert badge once identity is up.
  (function warm() { if (!S.ready) return setTimeout(warm, 500); setTimeout(() => loadNotifs(), 2500); })();
})();
