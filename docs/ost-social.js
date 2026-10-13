/* ==========================================================================
 * OST Mesh · social side — the public half of the mesh (feed, stories, profiles, tips)
 * --------------------------------------------------------------------------
 * Plugs into ost-mesh-app.js as its home tab. Everything a user writes is
 * signed with their mesh key; media are uploaded to the hub (public, streamed
 * with Range); tips are REAL devnet transfers from the connected wallet to the
 * author's linked wallet, re-verified on-chain by the worker before they count.
 *
 *   Feed      For you / Following (sticky segmented tabs), text-first posts with
 *             up to 4 photos or a video, like, reply, tip, share, embeds from OST
 *   Stories   24-hour photo / video stories: a ring tray (phone), 9:16 cards in the
 *             right column (desk) and a viewer (full-bleed on phones, a 9:16 card
 *             over a blurred copy on wide screens)
 *   Profiles  banner in the identity colour, follow, message, call; ONE editor
 *             (Edit profile) + a first-run card and a "Get started" guide
 *   Alerts    likes (grouped), comments, follows, tips — pushed live over the hub socket
 *   Site      "Share" on the market page, "share your bet" after a trade,
 *             attach a bet / market / perp / wallet to a post; #social, #post=,
 *             #u= deep links; "Mesh" link in the desktop nav
 *   Overlays  #oslSheet (popover on desk, bottom sheet on phones, dialog for forms
 *             and the desk composer), #oslLight, #oslStory: each owns its keys
 *             (Escape, arrows, Tab), closes on the backdrop, restores focus.
 *             OST Studio apps: `app` embeds open in the apps viewer (#app=),
 *             #share-app=<slug> composes a post with the app attached
 * Layout (contract C8): reads core.layout() / core.scroller(), never the window width;
 * icons come from core.icon() (one sprite, contract C9).
 * window.OST_SOCIAL.{ open, compose, marketEmbed, share, profile, post, pay, refresh, state }
 * ========================================================================== */
(function boot() {
  if (window.OST_SOCIAL) return;
  const core = window.OST_MESH_APP && window.OST_MESH_APP.core;
  if (!core) { window.addEventListener('ost:mesh-app:core', boot, { once: true }); return; }
  const { S, X, API, esc, ago, signed, shortA } = core;
  const toast = (msg, kind, opts) => core.toast(msg, kind, opts);
  const $ = (id) => document.getElementById(id);
  // Plugin surface of phase 2 (BUILD-SPEC §5.6). Every call has a quiet fallback, so a core that does not offer a
  // hook yet still renders (unstyled icons at worst) instead of throwing.
  const icon = (id, cls) => (typeof core.icon === 'function' ? core.icon(id, cls) : `<svg class="omx-i${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`);
  const layout = () => {
    try { if (typeof core.layout === 'function') { const l = core.layout(); if (l) return l; } } catch (_) {}
    const r = $('ostMeshApp'); if (r && r.dataset.layout) return r.dataset.layout;
    return window.matchMedia && matchMedia('(max-width: 599.98px)').matches ? 'phone' : window.matchMedia && matchMedia('(min-width: 1100px)').matches ? 'desk' : 'drawer';
  };
  const isDesk = () => layout() === 'desk';
  const isPhone = () => layout() === 'phone';
  const scroller = () => { try { if (typeof core.scroller === 'function') { const s = core.scroller(); if (s) return s; } } catch (_) {} return $('omxBody'); };
  const paintNav = () => { try { if (typeof core.paintNav === 'function') core.paintNav(); } catch (_) {} };
  const paintAside = (id) => { try { if (typeof core.paintAside === 'function' && isDesk()) core.paintAside(id); } catch (_) {} };
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const EMOJIS = Array.isArray(core.EMOJIS) && core.EMOJIS.length >= 20 ? core.EMOJIS.slice(0, 20) : ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐳', '🦉', '🐝', '🌵', '🍀', '⚡', '🔥', '🌙', '🎧', '🛰️', '🎲', '🚀', '💎'];
  const IMG_EDGE = 2048, VID_MAX = 40 * 1024 * 1024, IMG_MAX = 10 * 1024 * 1024, TEXT_MAX = 2000, PHOTO_MAX = 4;
  const SS = {
    mode: core.lsGet('ost.social.mode', 'all'), posts: [], cursor: null, loading: false, loaded: false, err: '', errMore: false,
    users: {}, stories: [], notifs: { items: [], unread: 0 }, newPosts: 0, stack: [], scroll: {},
    draft: { text: '', media: [], embed: null, busy: '' }, postId: null, comments: {}, commentsErr: {}, profileOf: null, search: '', people: null, edit: null,
    follow: {}, meCounts: null, frEmoji: '', frDone: false
  };
  const mediaUrl = (id) => API + '/mesh/v1/social/media/' + encodeURIComponent(id);
  const me = () => S.address;
  const fmtN = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
  const fmtCount = (n) => (n == null || n === '' || !Number.isFinite(Number(n))) ? '–' : fmtN(n);   // "–" until the number is known
  const fmtAmt = (n) => { n = Number(n) || 0; return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toFixed(4).replace(/\.?0+$/, ''); };
  const NET = () => String((window.OST_CONFIG && window.OST_CONFIG.network) || 'devnet').toLowerCase();
  const devnetChip = () => (/devnet/.test(NET()) ? '<span class="omx-devnet">devnet</span>' : '');
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
        let msg, wait = 0;
        if (r.status === 429 || code === 'rate_limited' || code === 'hub_busy') {
          // Retry-After is not CORS-exposed; the hub repeats it in the body.
          let s = Number(j && j.retryAfter) || 0; try { s = s || Number(r.headers.get('Retry-After')) || 0; } catch (_) {}
          wait = s;
          msg = 'The hub is busy — try again in ' + (s > 0 ? Math.ceil(s) + ' s' : 'a moment') + '.';
        } else if (r.status >= 500) msg = 'The hub is unavailable right now — try again shortly.';
        else msg = code ? code.replace(/_/g, ' ') : 'HTTP ' + r.status;
        const er = new Error(msg); er.status = r.status; er.code = code; if (wait) er.retryAfter = wait; throw er;
      }
      return j;
    } finally { if (t) clearTimeout(t); }
  }
  // Error state in the content slot: icon circle, plain words, "Retry now" and — for trouble that passes by itself
  // (offline, hub busy, 5xx) — one automatic retry after a visible countdown. A failure is never "nothing here".
  const AUTO = {};   // act -> { at, fired }
  let autoT = 0;
  function autoTick() {
    const els = document.querySelectorAll('.osl-auto[data-auto]');
    if (!els.length) { clearInterval(autoT); autoT = 0; return; }
    const now = Date.now();
    els.forEach((el) => {
      const act = el.getAttribute('data-auto'), a = AUTO[act];
      if (!a || a.fired) { el.remove(); return; }
      const left = Math.max(0, Math.ceil((a.at - now) / 1000));
      if (left > 0) { const t = 'Retrying automatically in ' + left + ' s'; if (el.textContent !== t) el.textContent = t; return; }
      a.fired = true; el.textContent = 'Retrying…';
      const fn = X.actions[act]; if (fn) { try { fn(el); } catch (_) {} }
    });
  }
  const transientErr = (e) => !!(e && (e.net || e.status >= 500 || e.status === 429 || /offline|unreachable|timed out|busy|unavailable/i.test(String(e.message || e))));
  function errBox(what, e, act, attrs) {
    const msg = String((e && e.message) || e || 'Something went wrong.');
    const net = !!(e && e.net) || /offline|unreachable/i.test(msg);
    let auto = '';
    if (transientErr(e) && act) {
      let a = AUTO[act];
      if (!a || (!a.fired && a.at < Date.now() - 1500)) a = AUTO[act] = { at: Date.now() + Math.max(2, Math.min(60, Math.ceil(Number(e && e.retryAfter) || 8))) * 1000, fired: false };
      if (!a.fired) { auto = `<small class="osl-auto" data-auto="${esc(act)}">Retrying automatically in ${Math.max(1, Math.ceil((a.at - Date.now()) / 1000))} s</small>`; if (!autoT) autoT = setInterval(autoTick, 1000); }
    }
    return `<div class="omx-empty err" role="alert"><span class="ic">${icon(net ? 'wifi-off' : 'alert')}</span><h3>${esc(what)}</h3><p>${esc(msg)}</p><button type="button" class="omx-ghost osl-retry" data-act="sx-retry-now" data-r="${esc(act)}" ${attrs || ''}>${icon('refresh')}Retry now</button>${auto}</div>`;
  }
  // "Couldn't refresh … Showing what you had." — a failed refresh while content is on screen.
  const inErr = (text, act) => `<div class="omx-inerr osl-inerr" role="alert">${icon('alert')}<span>${esc(text)}</span><button type="button" class="omx-textbtn" data-act="${act}">Retry</button></div>`;
  function absorb(map) { Object.keys(map || {}).forEach((a) => { if (map[a]) SS.users[a] = Object.assign({}, SS.users[a] || {}, map[a]); }); }
  function user(a) {
    const u = SS.users[a] || { addr: a };
    if (a === me()) return Object.assign({}, u, { name: S.profile.name || u.name, emoji: S.profile.emoji || u.emoji, avatar: S.profile.avatar != null ? S.profile.avatar : u.avatar, wallet: S.profile.wallet != null ? S.profile.wallet : u.wallet });
    const c = core.contact(a);
    return Object.assign({ name: (c && c.name) || '', emoji: (c && c.emoji) || '' }, u);
  }
  const dname = (a) => user(a).name || shortA(a);
  const first = (a) => { const n = user(a).name; return n ? n.trim().split(/\s+/)[0] : shortA(a); };
  // Identity colour (contract §6.5): the same hash as the core's avStyle(), 12 hues.
  const hue12 = (a) => { let h = 0; a = String(a || ''); for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0; return (h % 360) % 12; };
  const avVar = (a) => `--av:var(--omx-id-${hue12(a)})`;
  // ONE avatar component (.omx-av): photo, emoji or initial on the identity colour. Decorative (aria-hidden):
  // the button around it carries the name.
  // The core's component (core.av) draws the emoji / initial from data-g, so an avatar never adds text to a button.
  const coreAv = typeof core.av === 'function';
  function avatar(a, size, attrs) {
    const u = user(a);
    let h;
    if (coreAv) h = core.av({ addr: a, name: u.name || '', emoji: u.emoji || '', img: u.avatar ? mediaUrl(u.avatar) : '', online: false, pending: false }, size || '');
    else {
      const init = (u.name || '').trim().charAt(0).toUpperCase(), fb = u.emoji || init;
      const cls = 'omx-av' + (size ? ' ' + size : '') + (!u.avatar && u.emoji ? ' emoji' : '');
      h = `<span class="${cls}" style="${avVar(a)}" aria-hidden="true" data-fb="${esc(fb)}">${u.avatar ? `<img src="${mediaUrl(u.avatar)}" alt="" loading="lazy">` : fb ? esc(fb) : icon('user')}</span>`;
    }
    return attrs ? h.replace('<span ', '<span ' + attrs + ' ') : h;
  }
  // A preview avatar whose glyph changes in place (Edit profile, the first-run card).
  const glyphAv = (size, glyph, id) => `<span class="omx-av ${size}${glyph && !/^[A-Z0-9]$/.test(glyph) ? ' emoji' : ''}" id="${id}" style="${avVar(me())}" aria-hidden="true"${coreAv ? ` data-g="${esc(glyph)}">${glyph ? '' : icon('user')}` : `>${glyph ? esc(glyph) : icon('user')}`}</span>`;
  function setGlyph(el, g) { if (!el) return; if (coreAv) { el.setAttribute('data-g', g); el.innerHTML = g ? '' : icon('user'); } else el.innerHTML = g ? esc(g) : icon('user'); el.classList.toggle('emoji', !!g && !/^[A-Z0-9]$/.test(g)); }
  const VERIFIED = () => `<svg class="omx-i omx-ver" role="img" aria-label="Wallet verified"><use href="#i-verified"/></svg>`;
  const badge = (a) => (user(a).walletVerified || (a === me() && S.profile.wallet)) ? VERIFIED() : '';
  // Hashtags stay plain text until tag search exists — nothing here should look tappable and do nothing.
  function rich(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`).replace(/\n/g, '<br>');
  }
  const blocked = (a) => { const c = core.contact(a); return !!(c && c.state === 'blocked'); };
  // Raw fetch failures ("Failed to fetch") from signed requests read as plain words.
  const emsg = (e, d) => { const m = (e && e.message) || ''; return (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m)) ? (navigator.onLine === false ? 'You are offline.' : 'The network is unreachable.') : (m || d || 'Something went wrong.'); };
  const excerpt = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > (n || 60) ? t.slice(0, (n || 60) - 1) + '…' : t; };

  let feedSeq = 0;
  async function loadFeed(reset) {
    if (SS.loading && !reset) return;
    const seq = ++feedSeq;   // a newer reset (mode switch, refresh) supersedes an in-flight load
    if (!SS.loading || !SS.skelAt) SS.skelAt = Date.now();
    SS.loading = true; SS.err = ''; SS.errMore = false; SS.errObj = null; SS.triedAt = Date.now();
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
      delete AUTO['sx-refresh'];
    } catch (e) { if (seq !== feedSeq) return; SS.err = e.message || 'Feed unavailable'; SS.errObj = e; SS.errMore = !reset; }
    SS.loading = false; SS.skelAt = 0;
    paintFeedList();
  }
  let storiesBusy = null;   // one request at a time (the feed, the desk aside and a live 'new-story' may all ask)
  function loadStories() {
    if (storiesBusy) return storiesBusy;
    storiesBusy = (async () => {
      try { const j = await getJ('/mesh/v1/social/stories?me=' + encodeURIComponent(me() || '')); SS.stories = j.groups || []; SS.storiesErr = ''; (SS.stories || []).forEach((g) => { if (g.profile) absorb({ [g.author]: g.profile }); }); } catch (e) { SS.storiesErr = e.message || 'unavailable'; }
      SS.storiesAt = Date.now();
      paintStories();
    })().finally(() => { storiesBusy = null; });
    return storiesBusy;
  }
  // Alerts: one request at a time, and not again within 30 s unless forced (boot warm-up + opening the feed used to fetch twice).
  let notifsBusy = null;
  function loadNotifs(force) {
    if (!me()) return Promise.resolve();
    if (notifsBusy) return notifsBusy;
    if (!force && SS.notifsTried && Date.now() - SS.notifsTried < 30000) return Promise.resolve();
    SS.notifsTried = Date.now();
    notifsBusy = (async () => {
      try { const j = await signed('GET', '/mesh/v1/social/notifs?addr=' + encodeURIComponent(me())); absorb(j.authors); SS.notifs = { items: j.items || [], unread: j.unread || 0, seenAt: j.seenAt || 0 }; SS.notifsErr = ''; SS.notifsAt = Date.now(); delete AUTO['sx-retry-notifs']; }
      catch (e) { SS.notifsErr = emsg(e, 'Alerts unavailable.'); SS.notifsErrObj = e; }
      notifsBusy = null;
      paintBell(); paintNav(); paintNotifs();
    })();
    return notifsBusy;
  }
  // People to discover (the hub's named profiles) and my own counts (the "Follow 3 people" step).
  let peopleBusy = null;
  function loadPeople() {
    if (peopleBusy || SS.people) return peopleBusy || Promise.resolve(SS.people);
    peopleBusy = getJ('/mesh/v1/social/people?me=' + encodeURIComponent(me() || '')).then((j) => { SS.people = j; (j.users || []).forEach((u) => { if (u && u.addr) absorb({ [u.addr]: u }); }); paintAside('who'); return j; }).catch(() => null).finally(() => { peopleBusy = null; });
    return peopleBusy;
  }
  let meCountsBusy = false;
  function loadMeCounts() {
    if (meCountsBusy || !me() || (SS.meCountsAt && Date.now() - SS.meCountsAt < 60000)) return;
    meCountsBusy = true; SS.meCountsAt = Date.now();
    getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(me()) + '&me=' + encodeURIComponent(me())).then((j) => { SS.meCounts = (j && j.counts) || null; paintGuide(); }).catch(() => {}).finally(() => { meCountsBusy = false; });
  }

  // Desk: the right column's data is asked for as the view renders, so the modules have it by the time they paint.
  function deskPrep() { if (!isDesk() || !me()) return; loadPeople(); if (!SS.storiesAt) loadStories(); }

  /* ---------- navigation inside the app ---------- */
  const bodyEl = () => scroller();   // the element that scrolls the current main view: the shell on desk, #omxBody otherwise
  // Bring an element of the current view into sight by scrolling that view's scroller (never the page, never an
  // ancestor the core does not own). 'start' = to the top under the sticky bars (scroll-padding-top); else 'nearest'.
  function scrollToEl(el, how) {
    const sc = bodyEl(); if (!sc || !el || !sc.contains(el)) return;
    const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0;
    let top = null;
    if (how === 'start' || r.top < sr.top + pad) top = sc.scrollTop + r.top - sr.top - pad;
    else if (r.bottom > sr.bottom) top = sc.scrollTop + r.bottom - sr.bottom;
    if (top != null) { try { sc.scrollTo({ top: Math.max(0, Math.round(top)), behavior: how === 'start' && !reduced() ? 'smooth' : 'auto' }); } catch (_) { sc.scrollTop = Math.max(0, Math.round(top)); } }
  }
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
    if (y > 0) { const b = bodyEl(); if (b) { b.scrollTop = y; requestAnimationFrame(() => { const b2 = bodyEl(); if (S.view === v && b2 && Math.abs(b2.scrollTop - y) > 2) b2.scrollTop = y; }); } }
  }
  // Inner-view header: Back + title (+ a second line) + icon buttons. No ✕ here: Esc / Back close.
  function head(ctx, title, sub, right, opts) {
    opts = opts || {};
    const desk = isDesk();
    ctx.head.className = 'omx-head has-back';
    const t = opts.html != null ? opts.html : esc(title);
    ctx.head.innerHTML = `<button type="button" class="omx-ib${desk ? ' md' : ''}" data-act="sx-back" aria-label="Back">${icon(desk ? 'arrow-left' : 'back')}</button><h2 id="omxTitle"${sub ? ' class="omx-h2col"' : ''}>${sub ? `<span>${t}</span><small>${esc(sub)}</small>` : t}</h2>${right || ''}`;
  }
  // Root-view header (phone / drawer): the view's title + its icon buttons + ✕.
  function rootHead(ctx, titleHtml, right) {
    ctx.head.className = 'omx-head';
    ctx.head.innerHTML = `<h2 id="omxTitle">${titleHtml}</h2>${right || ''}<button type="button" class="omx-ib" data-act="close" aria-label="Close Mesh">${icon('close')}</button>`;
  }

  /* ---------- FEED ---------- */
  const feedTabs = () => `<div class="omx-seg osl-feedtabs" role="tablist" aria-label="Feeds">${[['all', 'For you'], ['following', 'Following']].map(([m, l]) => `<button type="button" role="tab" id="oslTab-${m}" aria-selected="${SS.mode === m}" tabindex="${SS.mode === m ? 0 : -1}" aria-controls="oslPosts" data-act="sx-mode" data-m="${m}">${l}</button>`).join('')}</div>`;
  // Desk: the inline prompt (opens the composer dialog; the three shortcuts open it with a picker).
  const ctaHtml = () => `<button type="button" class="osl-cta" data-act="sx-compose" aria-label="New post">${avatar(me())}<span class="osl-cta-field">What’s happening?</span>
    <span class="osl-cta-bar" aria-hidden="true"><span class="omx-ib sm accent" data-cta="img">${icon('image')}</span><span class="omx-ib sm accent" data-cta="vid">${icon('film')}</span><span class="omx-ib sm accent" data-cta="ost">${icon('paperclip')}</span><span class="sp"></span><span class="osl-note">${icon('globe')}Public · ${esc(NET())}</span><span class="omx-primary omx-sm" aria-disabled="true">Post</span></span></button>`;
  function renderFeed(ctx) {
    SS.curView = 'feed';
    deskPrep();
    const desk = isDesk();
    if (desk) { ctx.head.className = 'omx-head is-root'; ctx.head.innerHTML = '<h2 id="omxTitle">Home</h2>'; }
    else {
      rootHead(ctx, `<span class="omx-brandmark">${icon('logo')}</span>Mesh${devnetChip()}`,
        `<button type="button" class="omx-ib compose" data-act="sx-compose" aria-label="New post">${icon('pen')}</button><button type="button" class="omx-ib osl-bell" data-act="sx-notifs" aria-label="Alerts" id="oslBell">${icon('bell')}</button>`);
    }
    const fr = desk && needsFirstRun();
    if (needsFirstRun()) guideStart();
    ctx.body.innerHTML = `${feedTabs()}${desk ? '' : '<div class="osl-stories" id="oslStories" aria-label="Stories"></div>'}${desk ? (fr ? firstRunHtml(false) : ctaHtml()) : ''}<button type="button" class="osl-newpill" id="oslNew" data-act="sx-refresh" hidden>${icon('arrow-up')}New posts</button><div class="osl-feed" id="oslPosts" role="feed" aria-busy="false" aria-label="${SS.mode === 'following' ? 'Following' : 'For you'}"></div><p class="omx-sr osl-sr" role="status" id="oslFeedSt"></p>`;
    paintBell(); paintStories();
    // Coming back from a post keeps the list (and the scroll position) as it was; otherwise refresh when stale.
    // A failed load is not retried on every re-render (8 s floor) — the error state has its own Retry button.
    if (!SS.restoring && !SS.loading && (!SS.loaded || Date.now() - (SS.loadedAt || 0) > 60000) && Date.now() - (SS.triedAt || 0) > 8000) { loadFeed(true); loadStories(); loadNotifs(); } else { paintFeedList(); if (!SS.storiesAt) loadStories(); }
  }
  function paintBell() {
    const b = $('oslBell'); if (!b) return;
    const n = SS.notifs.unread || 0;
    b.setAttribute('aria-label', n ? 'Alerts, ' + n + ' new' : 'Alerts');
    let bd = b.querySelector('.omx-badge');
    if (!n) { if (bd) bd.remove(); return; }
    if (!bd) { bd = document.createElement('span'); bd.className = 'omx-badge'; bd.setAttribute('aria-hidden', 'true'); b.appendChild(bd); }
    const t = n > 99 ? '99+' : String(n); if (bd.textContent !== t) bd.textContent = t;
  }
  function paintFeedList() {
    const el = $('oslPosts'); if (!el) return;
    const n = $('oslNew'); if (n) n.hidden = !SS.newPosts;
    const posts = SS.posts.filter((p) => !blocked(p.author));
    const busy = !posts.length && (SS.loading || (!SS.loaded && !SS.err));
    el.setAttribute('aria-busy', String(!!SS.loading));
    el.setAttribute('aria-label', SS.mode === 'following' ? 'Following' : 'For you');
    const st = $('oslFeedSt'); if (st) { const t = busy ? 'Loading posts…' : ''; if (st.textContent !== t) st.textContent = t; }
    let h;
    if (!posts.length) {
      if (busy) h = skeleton();
      else if (SS.err) h = errBox('Couldn’t load posts', SS.errObj || SS.err, 'sx-refresh');
      else h = SS.mode === 'following'
        ? `<div class="omx-empty"><span class="ic">${icon('users')}</span><h3>Follow people to fill this tab</h3><p>Posts from people you follow show up here, newest first.</p><button type="button" class="omx-primary" data-act="sx-search">${icon('search')}Find people</button></div>`
        : `<div class="omx-empty"><span class="ic">${icon('pen')}</span><h3>No posts yet</h3><p>Posts are public and signed with your key. Be the first to say something.</p><button type="button" class="omx-primary" data-act="sx-compose">${icon('pen')}Write the first post</button></div>`;
    } else {
      const errBar = SS.err ? inErr(SS.errMore ? 'Couldn’t load more posts.' : 'Couldn’t refresh the feed. Showing what you had.', SS.errMore ? 'sx-more' : 'sx-refresh') : '';
      h = (SS.err && !SS.errMore ? errBar : '') + posts.map(postHtml).join('');
      if (SS.loading) h += '<div class="osl-end" role="status">Loading…</div>';
      else if (SS.err && SS.errMore) h += errBar;
      else if (SS.cursor) h += '<div class="osl-morewrap"><button type="button" class="omx-ghost osl-more" data-act="sx-more">Load more</button></div>';
      else if (!SS.err) h += '<div class="osl-end">You’re all caught up</div>';
    }
    // The skeleton already on screen stays (its 300 ms fade-in must not restart on every repaint).
    if (busy && el.querySelector(':scope > .omx-skel')) return;
    el.innerHTML = h;
    wireVideos(el);
  }
  // Skeleton posts, visible only after 300 ms (fast loads never flash). The delay counts from the start of the load,
  // so a view re-render in between continues the same fade instead of restarting it.
  function skeleton() {
    const since = SS.skelAt ? Date.now() - SS.skelAt : 0;
    const sk = (media) => `<div class="omx-skel-post"><span class="omx-sk c" style="width:40px;height:40px"></span><span><span class="omx-sk l" style="width:42%"></span><span class="omx-sk l" style="width:92%"></span><span class="omx-sk l" style="width:74%"></span>${media ? '<span class="omx-sk m" style="aspect-ratio:16/9"></span>' : ''}<span class="omx-sk l" style="width:60%;margin-top:14px;height:10px"></span></span></div>`;
    return `<div class="omx-skel" aria-hidden="true" style="animation-delay:${Math.round(300 - since)}ms">${sk(0)}${sk(1)}${sk(0)}</div>`;
  }
  // One photo keeps its own shape between 4:5 and 1.91:1 (cover-cropped, max min(510px, 60vh)); 2-4 photos are a grid.
  const arOf = (w, h) => { w = Number(w); h = Number(h); if (!(w > 0 && h > 0)) return ''; const r = Math.min(1.91, Math.max(0.8, w / h)); return (Math.round(r * 1000) / 1000) + ''; };
  function mediaHtml(p) {
    const m = p.media || [];
    if (!m.length) return '';
    if (m[0].kind === 'video') {
      const w = Math.round(Number(m[0].w)) || 0, h = Math.round(Number(m[0].h)) || 0;
      const ar = arOf(w, h) || '1.778';
      // A small video (say 320×240) keeps its own width instead of being blown up to the column (blurry frames).
      const mw = w > 0 && h > 0 ? `max-width:${Math.max(w, 280)}px;` : '';
      const dur = Number(m[0].dur) > 0 ? Math.round(Number(m[0].dur)) : 0;
      const durTxt = dur ? Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0') : '';
      return `<div class="osl-media n1 is-vid" style="--ar:${ar}"><div class="osl-vid" style="${mw}"><video src="${mediaUrl(m[0].id)}" ${m[0].poster ? `poster="${mediaUrl(m[0].poster)}"` : ''} preload="metadata" playsinline muted loop data-autoplay aria-label="Video"></video><button type="button" class="osl-play" data-act="sx-vplay" aria-label="Play video${durTxt ? ', ' + durTxt : ''}">${icon('play')}</button>${durTxt ? `<span class="osl-vbtn osl-vdur" aria-hidden="true">${durTxt}</span>` : ''}<button type="button" class="osl-vbtn osl-vmute" data-act="sx-vmute" aria-label="Unmute" aria-pressed="false">${icon('volume-off')}</button></div></div>`;
    }
    const n = Math.min(m.length, 4);
    // Photos are buttons for the keyboard too: Tab reaches them, Enter / Space open the viewer.
    return `<div class="osl-media n${n}"${n === 1 ? ` style="--ar:${arOf(m[0].w, m[0].h) || '1.333'}"` : ''}>${m.slice(0, 4).map((x, i) => `<img src="${mediaUrl(x.id)}" alt="" loading="lazy" tabindex="0" role="button" aria-label="${n > 1 ? `Open photo ${i + 1} of ${n}` : 'Open photo'}" data-act="sx-lightbox" data-p="${esc(p.id)}" data-i="${i}">`).join('')}</div>`;
  }
  // Media that fails to load becomes a labelled tile with a real Retry (never the browser's broken-image glyph).
  function mediaFail(node, label, retry) {
    if (!node || !node.parentNode) return;
    const d = document.createElement('div'); d.className = 'osl-mfail'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', label);
    d.innerHTML = `${icon(/video/i.test(label) ? 'film' : 'image-off')}<span>${esc(label)}</span>${retry ? `<button type="button" class="omx-textbtn" data-act="sx-mretry">${icon('refresh')}Retry</button>` : ''}`;
    d.__orig = node;
    node.replaceWith(d);
  }
  document.addEventListener('error', (e) => {
    const t = e.target; if (!t || t.tagName !== 'IMG' || !t.closest) return;
    const av = t.closest('.omx-av');
    if (av) { if (!coreAv && av.closest('#ostMeshApp, #oslSheet, #oslLight, #oslStory, .omx-toasts')) { const fb = av.getAttribute('data-fb'); av.innerHTML = fb ? esc(fb) : icon('user'); } return; }   // the core handles its own avatars
    if (t.closest('#ostMeshApp .osl-media, #oslSheet .osl-pick, #ostMeshApp .osl-pick')) mediaFail(t, 'Media unavailable', !t.closest('.osl-pick'));
    else if (t.closest('#oslLight .osl-lstage, #oslSheet .osl-stprev')) mediaFail(t, 'Media unavailable', false);
    else if (t.closest('#oslStory .osl-smedia')) mediaFail(t, 'Story unavailable', false);
    else if (t.closest('#oslStory .osl-sbg, #oslStory .osl-sprev')) t.remove();
  }, true);
  // Enter / Space on a focused feed photo opens the viewer, like a tap.
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented || e.repeat) return;
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || t.getAttribute('data-act') !== 'sx-lightbox' || !t.closest('#ostMeshApp')) return;
    e.preventDefault(); A['sx-lightbox'](t);
  });
  // Feed tabs (and the emoji radio groups): arrow keys move between options (roving tabindex).
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(e.key)) return;
    const t = e.target; if (!t || !t.closest) return;
    const grp = t.closest('#ostMeshApp .osl-feedtabs, #ostMeshApp .osl-emojis');
    if (!grp || !grp.contains(t)) return;
    const radios = grp.classList.contains('osl-emojis');
    const items = Array.from(grp.querySelectorAll(radios ? '[role=radio]' : '[role=tab]'));
    const i = items.indexOf(t); if (i < 0) return;
    if (!radios && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1) + items.length) % items.length;
    const to = items[n]; if (!to) return;
    to.focus(); to.click();
  });
  const EMBED_ICO = { market: 'trend', bet: 'target', perp: 'zap', game: 'game', wallet: 'wallet', stock: 'candles', app: 'grid', link: 'link' };
  const EMBED_LBL = { market: 'Market', bet: 'Prediction bet', perp: 'Perp position', wallet: 'Wallet', app: 'OST app', game: 'Game', stock: 'Stock', link: 'Link' };
  function embedHtml(e, inert) {
    if (!e) return '';
    const lbl = EMBED_LBL[e.kind] || 'OST';
    const inner = `<b>${icon(EMBED_ICO[e.kind] || 'link')}</b><span><em>${esc(lbl)}</em><strong>${esc(e.title)}</strong>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>${e.price ? `<i>${esc(e.price)}</i>` : ''}`;
    // inert = preview in the composer: a plain card, not a button that would navigate away from the draft.
    return inert ? `<div class="osl-embed">${inner}</div>` : `<button type="button" class="osl-embed" data-act="sx-embed" data-href="${esc(e.href || '')}" aria-label="${esc(lbl + ': ' + (e.title || '') + (e.price ? ', ' + e.price : ''))}">${inner}</button>`;
  }
  // The tipped total lives in the Tip action ("15 OST"); the full breakdown is in its accessible name.
  function tipTotal(p) {
    const t = p.tips || {}; const parts = Object.keys(t).filter((k) => t[k] > 0).map((k) => fmtAmt(t[k]) + ' ' + k);
    return parts.length ? { short: parts[0] + (parts.length > 1 ? ' +' : ''), all: parts.join(', ') + (p.tipCount > 1 ? ' from ' + p.tipCount + ' people' : '') } : null;
  }
  function postHtml(p) {
    const a = p.author, nm = dname(a), liked = p.my === 'like', tip = tipTotal(p);
    const likes = Math.max(0, Number(p.likes) || 0), reps = Math.max(0, Number(p.comments) || 0);
    return `<article class="osl-post" data-pid="${esc(p.id)}" aria-label="Post by ${esc(nm)}">
      <button type="button" class="osl-pav" data-act="sx-profile" data-a="${esc(a)}" aria-label="${esc(nm)}, profile">${avatar(a)}</button>
      <div class="osl-pmain">
        <header><button type="button" class="osl-who" data-act="sx-profile" data-a="${esc(a)}"><b>${esc(nm)}</b>${badge(a)}<span class="osl-meta">· ${esc(ago(p.ts))}</span></button><button type="button" class="omx-ib sm osl-dots" data-act="sx-menu" data-p="${esc(p.id)}" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></header>
        ${p.text ? `<div class="osl-text">${rich(p.text)}</div>` : ''}${embedHtml(p.embed)}${mediaHtml(p)}
        <footer class="osl-acts">
          <button type="button" class="osl-act reply" data-act="sx-open" data-p="${esc(p.id)}" aria-label="Reply, ${reps} ${reps === 1 ? 'reply' : 'replies'}"><span>${icon('reply')}</span><span>${reps ? fmtN(reps) : ''}</span></button>
          <button type="button" class="osl-act like" data-act="sx-like" data-p="${esc(p.id)}" aria-pressed="${liked}" aria-label="Like, ${likes} ${likes === 1 ? 'like' : 'likes'}"><span>${icon('heart', liked ? 'is-on' : '')}</span><span>${likes ? fmtN(likes) : ''}</span></button>
          <button type="button" class="osl-act tip${tip ? ' tipped' : ''}" data-act="sx-tip" data-p="${esc(p.id)}" aria-label="${tip ? 'Tip OST, ' + esc(tip.all) + ' tipped' : 'Tip OST'}"><span>${icon('coin')}</span><span>${tip ? esc(tip.short) : 'Tip'}</span></button>
          <button type="button" class="osl-act share" data-act="sx-share" data-p="${esc(p.id)}" aria-label="Share"><span>${icon('share')}</span></button>
        </footer>
      </div></article>`;
  }
  function findPost(id) { return SS.posts.find((p) => p.id === id) || (SS.single && SS.single.id === id ? SS.single : null) || (SS.profilePosts || []).find((p) => p.id === id); }
  function updatePost(p) {
    [SS.posts, SS.profilePosts || []].forEach((list) => { const i = list.findIndex((x) => x.id === p.id); if (i >= 0) list[i] = p; });
    if (SS.single && SS.single.id === p.id) SS.single = p;
    const html = postHtml(p);
    document.querySelectorAll('#ostMeshApp .osl-post[data-pid="' + p.id + '"]').forEach((el) => {
      const tmp = document.createElement('div'); tmp.innerHTML = html; const nu = tmp.firstElementChild;
      // the like pop that is still playing survives the server's confirmation of the same state
      const pop = el.querySelector('.osl-act.like.popping'); if (pop && p.my === 'like') { const l = nu.querySelector('.osl-act.like'); if (l) { l.classList.add('popping'); l.addEventListener('animationend', () => l.classList.remove('popping'), { once: true }); } }
      // media elements are reused, so a playing video or a decoded photo is not rebuilt
      const om = el.querySelector('.osl-media'), nm = nu.querySelector('.osl-media'); if (om && nm && om.outerHTML.length && JSON.stringify((findPost(p.id) || {}).media || []) === JSON.stringify(p.media || [])) nm.replaceWith(om);
      const focusAct = el.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
      el.replaceWith(nu);
      if (focusAct) { const f = nu.querySelector('[data-act="' + focusAct + '"]'); if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} } }
    });
    wireVideos(document.getElementById('ostMeshApp'));
  }
  // Autoplay videos muted while on screen (never under reduced motion); pause off screen.
  let vidIO = null;
  function wireVideos(root) {
    if (!root || !('IntersectionObserver' in window)) return;
    vidIO = vidIO || new IntersectionObserver((es) => es.forEach((e) => { const v = e.target; if (!v.isConnected) { vidIO.unobserve(v); return; } if (e.isIntersecting && e.intersectionRatio > 0.6) { if (v.paused && v.muted && !reduced() && !v.__userPaused) v.play().catch(() => {}); } else if (!v.paused) v.pause(); }), { threshold: [0, 0.6] });
    root.querySelectorAll('video[data-autoplay]').forEach((v) => {
      if (v.__io) return; v.__io = 1; vidIO.observe(v);
      const box = v.closest('.osl-vid');
      // media events do not bubble: wire the play glyph and the "Video unavailable" state per element
      v.addEventListener('playing', () => { if (box) box.classList.add('playing'); });
      v.addEventListener('pause', () => { if (box) box.classList.remove('playing'); });
      const fail = () => { try { vidIO.unobserve(v); } catch (_) {} mediaFail(box || v, 'Video unavailable', false); };
      v.addEventListener('error', fail);
      if (v.error) fail();
    });
  }

  /* ---------- reactions / comments ---------- */
  async function react(id, kind) {
    const p = findPost(id); if (!p) return;
    const prev = p.my; const np = Object.assign({}, p);
    if (prev === 'like') np.likes--; if (prev === 'dislike') np.dislikes--;
    if (prev !== kind) { np.my = kind; if (kind === 'like') np.likes++; else np.dislikes++; } else np.my = '';
    updatePost(np);
    // the pop plays on the user's tap only (never on a repaint, §9)
    if (kind === 'like' && np.my === 'like' && !reduced()) {
      document.querySelectorAll('#ostMeshApp .osl-post[data-pid="' + id + '"] .osl-act.like').forEach((l) => { l.classList.add('popping'); l.addEventListener('animationend', () => l.classList.remove('popping'), { once: true }); setTimeout(() => l.classList.remove('popping'), 700); });
    }
    try {
      if (!S.announced) await core.announce();
      const r = await signed('POST', '/mesh/v1/social/react', { from: me(), postId: id, kind });
      const conf = Object.assign({}, np, { likes: r && r.likes != null ? r.likes : np.likes, dislikes: r && r.dislikes != null ? r.dislikes : np.dislikes, my: r && r.my != null ? r.my : np.my });
      if (conf.likes !== np.likes || conf.dislikes !== np.dislikes || conf.my !== np.my) updatePost(conf);
      return conf;
    } catch (e) { updatePost(p); toast(emsg(e), 'err'); return null; }
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
    try { const j = await getJ('/mesh/v1/social/post?id=' + encodeURIComponent(id) + '&me=' + encodeURIComponent(me() || '')); if (SS.postId !== id) return; absorb(j.authors); SS.single = (j.posts || [])[0] || { missing: 'not found' }; delete AUTO['sx-retry-post']; }
    catch (e) { if (SS.postId !== id) return; SS.single = (e.net || e.status >= 500 || e.status === 429) ? { failed: e } : { missing: e.message }; }
    paintPost();
  }
  function renderPostView(ctx) {
    SS.curView = 'post';
    deskPrep();
    head(ctx, 'Post', '');
    ctx.body.innerHTML = `<div id="oslSingle"></div><div class="osl-comments" id="oslComments" aria-label="Replies"></div>
      <div class="osl-cbox">${avatar(me(), 'sm')}<div class="omx-fieldpill"><textarea id="oslCText" rows="1" maxlength="500" placeholder="Write a reply…" aria-label="Write a reply" enterkeyhint="send"></textarea></div><button type="button" class="omx-primary omx-sm omx-hit" data-act="sx-comment" disabled>Reply</button></div>`;
    paintPost(); paintComments();
    const ta = $('oslCText');
    if (ta) {
      const sync = () => { const b = document.querySelector('#ostMeshApp [data-act="sx-comment"]'); if (b) b.disabled = !ta.value.trim(); ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
      ta.addEventListener('input', sync);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); sendComment(); } });
    }
  }
  function paintPost() {
    const el = $('oslSingle'); if (!el) return; const p = SS.single;
    el.innerHTML = !p ? skeleton() : p.failed ? errBox('Couldn’t load this post', p.failed, 'sx-retry-post') : p.missing ? `<div class="omx-empty"><span class="ic">${icon('trash')}</span><h3>This post is gone</h3><p>${esc(p.missing)}</p></div>` : postHtml(p);
    wireVideos(el);
  }
  async function loadComments(id) {
    delete SS.commentsErr[id]; if (SS.postId === id) paintComments();
    try { const j = await getJ('/mesh/v1/social/comments?postId=' + encodeURIComponent(id)); absorb(j.authors); SS.comments[id] = j.comments || []; delete AUTO['sx-retry-comments']; }
    catch (e) { SS.commentsErr[id] = e; }
    if (SS.postId === id) paintComments();
  }
  function paintComments() {
    const el = $('oslComments'); if (!el) return;
    const all = SS.comments[SS.postId], err = SS.commentsErr[SS.postId];
    const list = all && all.filter((c) => !blocked(c.author));   // hidden people stay hidden here too
    if (!list) { el.innerHTML = err ? errBox('Couldn’t load replies', err, 'sx-retry-comments') : '<div class="osl-end" role="status">Loading replies…</div>'; return; }
    const post = SS.single;
    el.innerHTML = (err ? inErr('Couldn’t refresh replies.', 'sx-retry-comments') : '') +
      (list.length ? list.map((c) => `<div class="osl-cm"><button type="button" class="osl-cmav" data-act="sx-profile" data-a="${esc(c.author)}" aria-label="${esc(dname(c.author))}, profile">${avatar(c.author, 'sm')}</button><div><div class="h"><b>${esc(dname(c.author))}</b>${badge(c.author)}<small>${esc(ago(c.ts))}</small></div><p>${rich(c.text)}</p></div>${c.author === me() || (post && post.author === me()) ? `<button type="button" class="omx-ib sm osl-cmore" data-act="sx-cmenu" data-c="${esc(c.id)}" aria-label="Reply options" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>` : '<span></span>'}</div>`).join('') : '<div class="osl-end">No replies yet — start the conversation.</div>');
  }
  async function sendComment() {
    const ta = $('oslCText'); const text = (ta && ta.value || '').trim(); if (!text) return;
    const btn = document.querySelector('#ostMeshApp [data-act="sx-comment"]');
    ta.value = ''; ta.disabled = true; if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true'); }
    try {
      if (!S.announced) await core.announce();
      const r = await signed('POST', '/mesh/v1/social/comment', { from: me(), postId: SS.postId, text });
      absorb(r.authors); (SS.comments[SS.postId] = SS.comments[SS.postId] || []).push(r.comment);
      const p = findPost(SS.postId); if (p) updatePost(Object.assign({}, p, { comments: r.comments != null ? r.comments : (p.comments || 0) + 1 }));
      paintComments(); const el = $('oslComments'); if (el && el.lastElementChild) scrollToEl(el.lastElementChild);
    } catch (e) { ta.value = text; toast(emsg(e), 'err'); }
    ta.disabled = false; if (btn) { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); btn.disabled = !ta.value.trim(); }
    try { ta.focus(); } catch (_) {}
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

  /* ---------- COMPOSER: a focused view on phones, a 600 px dialog on desk / drawer ---------- */
  const composeDlgUp = () => !!(document.querySelector('#oslSheet.on .osl-composer'));
  const compRoot = () => document.querySelector('#oslSheet.on .osl-composer') || document.querySelector('#ostMeshApp .osl-composer');
  const cq = (sel) => { const r = compRoot(); return r ? r.querySelector(sel) : null; };
  // Post lives in the dialog's bottom bar on desk, but in the view header (#omxHead) of the phone composer.
  const postBtn = () => cq('.osl-postbtn') || (!composeDlgUp() && compRoot() ? document.querySelector('#omxHead .osl-postbtn') : null);
  const picksHtml = (d) => d.media.map((m, i) => `<div class="osl-pick">${m.kind === 'video' ? `<video src="${m.url}" muted playsinline aria-label="Video ${i + 1}"></video><span class="osl-vbtn osl-pickvid" aria-hidden="true">${icon('film')}</span>` : `<img src="${m.url}" alt="Photo ${i + 1}">`}<button type="button" class="omx-ib sm" data-act="sx-unpick" data-i="${i}" aria-label="Remove ${m.kind === 'video' ? 'video' : 'photo ' + (i + 1)}">${icon('close')}</button></div>`).join('') + (d.adding ? '<div class="osl-pick osl-pickwait" role="status" aria-label="Adding…"></div>' : '');
  const picksCls = (d) => 'osl-picks' + (isPhone() ? ' is-row' : (d.media.length + (d.adding ? 1 : 0)) >= 2 ? ' n2' : '');
  // Post is enabled only when there is something to post and the text fits the 2000 limit.
  const draftLen = (d) => (d.text || '').trim().length;
  const draftOk = (d) => !d.busy && draftLen(d) <= TEXT_MAX && (draftLen(d) > 0 || d.media.length > 0 || !!d.embed);
  // The character ring appears from 80 % (amber from 90 %, red over the limit). It is not a live region; a separate
  // screen-reader line speaks only when the post crosses into "near the limit" or "over the limit" (or back under it).
  function ringHtml(n) {
    const f = n / TEXT_MAX, C = 2 * Math.PI * 9;
    const col = f > 1 ? 'var(--omx-danger)' : f >= 0.9 ? 'var(--omx-warning)' : 'var(--omx-accent)';
    const left = TEXT_MAX - n;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--omx-line-2)" stroke-width="2.5"/><circle cx="12" cy="12" r="9" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(C * Math.min(f, 1)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 12 12)"/></svg>${f >= 0.9 ? `<b class="${left < 0 ? 'over' : 'near'}">${left}</b>` : ''}`;
  }
  function paintComposeState() {
    const d = SS.draft, n = draftLen(d), c = cq('#oslCount');
    const lvl = n > TEXT_MAX ? 'over' : n > TEXT_MAX - 100 ? 'near' : 'ok';
    if (c) {
      // the ring element exists only from 80 % of the limit (amber from 90 %, red over it)
      const show = n >= TEXT_MAX * 0.8;
      if (!show) { if (c.firstChild) c.innerHTML = ''; }
      else c.innerHTML = `<span class="osl-ring2" role="img" aria-label="${n > TEXT_MAX ? (n - TEXT_MAX) + ' characters over the ' + TEXT_MAX + ' character limit' : n + ' of ' + TEXT_MAX + ' characters'}">${ringHtml(n)}</span>`;
    }
    const live = cq('#oslCountLive');
    if (live && d.countLvl !== lvl) {
      live.textContent = lvl === 'over' ? 'Your post is ' + (n - TEXT_MAX) + ' characters over the ' + TEXT_MAX + ' character limit.' : lvl === 'near' ? (TEXT_MAX - n) + ' characters left.' : d.countLvl === 'over' ? 'Back under the character limit.' : '';
    }
    if (live) d.countLvl = lvl;
    const b = postBtn(); if (b) b.disabled = !draftOk(d);
  }
  // Upload progress shows on the Post button and in the note line, in place (no re-render of the text field).
  function paintComposeBusy() {
    const d = SS.draft, b = postBtn(), st = cq('#oslCompSt'), ta = cq('#oslText');
    if (b) { b.classList.toggle('is-loading', !!d.busy); if (d.busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); }
    if (st) st.textContent = d.busy || '';
    if (ta) ta.disabled = !!d.busy;
    paintComposeState();
  }
  function paintPicks() {
    const el = cq('#oslPicks'); if (el) { el.className = picksCls(SS.draft); el.innerHTML = picksHtml(SS.draft); el.hidden = !SS.draft.media.length && !SS.draft.adding; }
    const ph = cq('[data-act="sx-pick-img"]'); if (ph) ph.setAttribute('aria-label', 'Add photos, ' + SS.draft.media.filter((m) => m.kind === 'image').length + ' of ' + PHOTO_MAX);
    paintComposeState();
  }
  function paintEmbed() {
    const el = cq('#oslAttached'); if (!el) return;
    const d = SS.draft;
    el.hidden = !d.embed;
    el.innerHTML = d.embed ? `${embedHtml(d.embed, true)}<button type="button" class="omx-ib sm" data-act="sx-unembed" aria-label="Remove attachment">${icon('close')}</button>` : '';
    paintComposeState();
  }
  // The parts both surfaces share: text, picks, the attached card, the attach list, the public note and the tools.
  function composerParts(phone) {
    const d = SS.draft;
    const tools = `<button type="button" class="omx-ib${phone ? '' : ' sm'} accent" data-act="sx-pick-img" aria-label="Add photos, ${d.media.filter((m) => m.kind === 'image').length} of ${PHOTO_MAX}">${icon('image')}</button><button type="button" class="omx-ib${phone ? '' : ' sm'} accent" data-act="sx-pick-vid" aria-label="Add a video">${icon('film')}</button><button type="button" class="omx-ib${phone ? '' : ' sm'} accent" data-act="sx-attach" aria-label="Attach from OST" aria-expanded="false">${icon('paperclip')}</button><span class="sp"></span><span class="osl-count" id="oslCount"></span>`;
    return {
      main: `<div class="osl-dbody">${avatar(me())}<div class="osl-dmain">
          <textarea class="osl-dtext" id="oslText" placeholder="What’s happening?" aria-label="Post text" aria-describedby="oslCompNote" ${d.busy ? 'disabled' : ''}>${esc(d.text)}</textarea>
          <div class="${picksCls(d)}" id="oslPicks" ${d.media.length || d.adding ? '' : 'hidden'}>${picksHtml(d)}</div>
          <div class="osl-attached" id="oslAttached" ${d.embed ? '' : 'hidden'}>${d.embed ? `${embedHtml(d.embed, true)}<button type="button" class="omx-ib sm" data-act="sx-unembed" aria-label="Remove attachment">${icon('close')}</button>` : ''}</div>
          <div id="oslAttachList" class="osl-attlist" hidden></div>
        </div></div>
        <div class="osl-dnote" id="oslCompNote">${icon('globe')}<span>Public · signed with your key · ${esc(NET())}</span><span class="osl-compst" id="oslCompSt" role="status">${esc(d.busy || '')}</span></div>
        <div class="omx-sr osl-sr" id="oslCountLive" aria-live="polite" aria-atomic="true"></div>
        <input type="file" id="oslPickImg" accept="image/*" multiple hidden><input type="file" id="oslPickVid" accept="video/mp4,video/webm,video/quicktime,video/*" hidden>`,
      tools
    };
  }
  function wireComposer(root) {
    const d = SS.draft;
    const ta = root.querySelector('#oslText');
    if (ta) {
      const grow = () => { if (!isPhone()) { ta.style.height = 'auto'; ta.style.height = Math.min(Math.round(innerHeight * 0.45), Math.max(84, ta.scrollHeight)) + 'px'; } };
      ta.addEventListener('input', () => { d.text = ta.value; paintComposeState(); grow(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); publish(); } });
      grow();
    }
    ['oslPickImg', 'oslPickVid'].forEach((id) => { const inp = root.querySelector('#' + id); if (inp) inp.addEventListener('change', () => { const files = Array.from(inp.files || []); inp.value = ''; if (files.length) addPicks(files); }); });
    paintComposeState();
  }
  function focusText(delay) { setTimeout(() => { const ta = cq('#oslText'); if (ta && !ta.disabled) { try { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} } }, delay || 0); }
  function renderCompose(ctx) {
    SS.curView = 'compose';
    // On desk the composer is a dialog over the feed: a 'compose' view reached there (a restored session, a resize)
    // shows the feed and opens the dialog.
    if (!isPhone()) { renderFeed(ctx); setTimeout(() => { if (S.view === 'compose') core.go('feed'); openComposer(); }, 0); return; }
    const d = SS.draft;
    ctx.head.className = 'omx-head has-back osl-chead';
    ctx.head.innerHTML = `<button type="button" class="omx-textbtn osl-cancel" data-act="sx-back">Cancel</button><h2 id="omxTitle" class="omx-sr">New post</h2><span class="sp"></span><button type="button" class="omx-primary omx-sm omx-hit osl-postbtn" data-act="sx-publish" ${draftOk(d) ? '' : 'disabled'}>Post</button>`;
    const parts = composerParts(true);
    ctx.body.innerHTML = `<div class="osl-composer osl-cview">${parts.main}<div class="osl-dbar phone">${parts.tools}</div></div>`;
    wireComposer(ctx.body);
    paintComposeBusy();
    if (!d.busy) focusText(50);
  }
  // Desk / drawer: #oslSheet.dlg.wide — 600 px, 10 vh from the top. Esc / ✕ close it and keep the draft.
  function openComposer() {
    if (isPhone()) { go('compose'); return; }
    const d = SS.draft || (SS.draft = { text: '', media: [], embed: null, busy: '' });
    const parts = composerParts(false);
    sheet(`<div class="osl-composer">
        <div class="osl-dhead"><button type="button" class="omx-ib md" data-sheet="close" aria-label="Close composer (Esc)">${icon('close')}</button><h2 class="omx-sr osl-sr" id="oslCompT">New post</h2><span class="sp"></span></div>
        ${parts.main}
        <div class="osl-dbar">${parts.tools}<button type="button" class="omx-primary osl-postbtn" data-act="sx-publish" ${draftOk(d) ? '' : 'disabled'}>Post</button></div>
      </div>`, { mode: 'dlg', wide: true, role: 'dialog', labelledby: 'oslCompT' });
    const box = $('oslSheetBox');
    wireComposer(box);
    paintComposeBusy();
    focusText(0);
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
      if (SS.draft === d) paintPicks();
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
    const ta = cq('#oslText'); if (ta) d.text = ta.value;
    const n = draftLen(d);
    // Nothing is cut silently: an over-long post is refused with the exact overshoot.
    if (n > TEXT_MAX) { toast('Your post is ' + (n - TEXT_MAX) + ' characters over the ' + TEXT_MAX + ' limit.', 'err'); paintComposeState(); return; }
    if (!n && !d.media.length && !d.embed) { toast('Write something or add a photo.', 'err'); return; }
    if (d.adding) { toast('Still adding your photos — one moment.'); return; }
    if (!d.media.some((m) => m.kind === 'video') && d.media.length > PHOTO_MAX) { d.media.splice(PHOTO_MAX).forEach((m) => { try { URL.revokeObjectURL(m.url); } catch (_) {} }); toast('Up to 4 photos', 'err'); }
    try {
      d.busy = 'Publishing…'; paintComposeBusy();
      if (!S.announced) await core.announce();
      const items = d.media.slice(0, PHOTO_MAX), media = [];
      for (let i = 0; i < items.length; i++) { d.busy = `Uploading ${i + 1}/${items.length} (${core.fmtSize(items[i].size || 0)})…`; paintComposeBusy(); media.push(await uploadPicked(items[i], 'post')); }
      d.busy = 'Publishing…'; paintComposeBusy();
      const r = await signed('POST', '/mesh/v1/social/post', { from: me(), text: d.text.trim(), media, embed: d.embed });
      absorb(r.authors);
      SS.posts = (r.posts || []).concat(SS.posts);
      d.media.forEach((m) => { try { URL.revokeObjectURL(m.url); } catch (_) {} });
      SS.draft = { text: '', media: [], embed: null, busy: '' };
      if (composeDlgUp()) closeSheet();
      toast('Posted', 'ok'); SS.stack = []; dropLinks(); SS.scroll = {}; core.go('feed');
      const b = bodyEl(); if (b) b.scrollTop = 0;
    } catch (e) { d.busy = ''; paintComposeBusy(); toast(emsg(e, 'Post failed'), 'err'); }
  }

  /* ---------- STORIES ---------- */
  // Phone / drawer: a ring tray at the top of the feed. Desk: 9:16 cards in the right column (aside module).
  function paintStories() {
    const el = $('oslStories');
    if (el) {
      const mine = SS.stories.find((g) => g.author === me());
      let h = mine
        ? `<button type="button" class="osl-st" data-act="sx-story" data-a="${esc(me())}" aria-label="Your story"><span class="osl-ring${mine.items.every((s) => s.seen) ? ' seen' : ''}">${avatar(me())}</span><small>Your story</small></button><button type="button" class="osl-st" data-act="sx-story-add" aria-label="Add to your story"><span class="osl-ring none"><span class="omx-av osl-addav" aria-hidden="true">${icon('plus')}</span></span><small>Add</small></button>`
        : `<button type="button" class="osl-st" data-act="sx-story-add" aria-label="Add to your story"><span class="osl-ring none">${avatar(me())}<span class="osl-addst" aria-hidden="true">${icon('plus')}</span></span><small>Your story</small></button>`;
      h += SS.stories.filter((g) => g.author !== me() && !blocked(g.author)).map((g) => { const seen = g.items.every((s) => s.seen); return `<button type="button" class="osl-st" data-act="sx-story" data-a="${esc(g.author)}" aria-label="${esc(dname(g.author))}’s story${seen ? ', seen' : ''}"><span class="osl-ring${seen ? ' seen' : ''}">${avatar(g.author)}</span><small>${esc(first(g.author))}</small></button>`; }).join('');
      // Stories that failed to load say so (with a retry) instead of looking like "nobody posted a story".
      if (SS.storiesErr) h += `<button type="button" class="osl-st osl-st-err" data-act="sx-stories-retry" aria-label="Stories could not load — retry"><span class="osl-ring none"><span class="omx-av osl-addav" aria-hidden="true">${icon('refresh')}</span></span><small>Retry</small></button>`;
      el.innerHTML = h;
    }
    paintAside('stories');
  }
  const storyCover = (s) => (s && s.media ? (s.media.kind === 'video' ? (s.media.poster ? mediaUrl(s.media.poster) : '') : mediaUrl(s.media.id)) : '');
  function storiesModHtml() {
    const groups = SS.stories.filter((g) => !blocked(g.author));
    if (!groups.length && !SS.storiesErr) return '';
    const mine = groups.find((g) => g.author === me());
    const card = (g) => {
      const seen = g.items.every((s) => s.seen), last = g.items[g.items.length - 1], cov = storyCover(last), self = g.author === me();
      return `<button type="button" class="osl-card${seen ? ' seen' : ''}" data-act="sx-story" data-a="${esc(g.author)}" aria-label="${self ? 'Your story' : esc(dname(g.author)) + '’s story'}${seen ? ', seen' : ''}"><span class="cover"${cov ? ` style="background-image:url('${esc(cov)}')"` : ''}></span><span class="osl-ring${seen ? ' seen' : ''}">${avatar(g.author, 'sm')}</span><b>${self ? 'Your story' : esc(first(g.author))}</b></button>`;
    };
    const add = `<button type="button" class="osl-card add" data-act="sx-story-add" aria-label="Add to your story">${avatar(me())}<span class="osl-addst" aria-hidden="true">${icon('plus')}</span><b>${mine ? 'Add' : 'Your story'}</b></button>`;
    const err = SS.storiesErr ? `<button type="button" class="osl-card add" data-act="sx-stories-retry" aria-label="Stories could not load — retry"><span class="omx-av" aria-hidden="true">${icon('refresh')}</span><b>Retry</b></button>` : '';
    return `<div class="omx-mod" role="region" aria-labelledby="oslAsSt"><header><h3 id="oslAsSt">Stories</h3>${groups.length > 3 ? '<button type="button" data-act="sx-stories-all">See all</button>' : ''}</header><div class="osl-cards">${mine ? card(mine) : ''}${add}${groups.filter((g) => g.author !== me()).map(card).join('')}${err}</div></div>`;
  }
  async function storyCompose(file) {
    let item; try { item = await pickToItem(file); } catch (e) { toast(emsg(e), 'err'); return; }
    sheet(`<h3>New story</h3><div class="osl-stprev">${item.kind === 'video' ? `<video src="${item.url}" autoplay muted loop playsinline aria-label="Story preview"></video>` : `<img src="${item.url}" alt="Story preview">`}</div>
      <label class="omx-field"><span>Caption</span><input class="omx-input" id="oslStCap" maxlength="200" placeholder="Add a caption (optional)"></label>
      <p class="osl-sbody">Stories are public and disappear after 24 hours.</p>
      <div class="omx-askrow"><button type="button" class="omx-ghost" data-sheet="close">Cancel</button><button type="button" class="omx-primary" id="oslStGo">Share for 24 hours</button></div>`, { onClose: () => { try { URL.revokeObjectURL(item.url); } catch (_) {} } });
    $('oslStGo').onclick = async () => {
      const b = $('oslStGo'); b.disabled = true; b.classList.add('is-loading'); b.setAttribute('aria-busy', 'true');
      try {
        if (!S.announced) await core.announce();
        const up = await uploadPicked(item, 'story');
        await signed('POST', '/mesh/v1/social/story', { from: me(), media: { id: up.id, poster: up.poster || '' }, caption: ($('oslStCap') || {}).value || '' });
        closeSheet(); toast('Story shared', 'ok'); loadStories();
      } catch (e) { b.disabled = false; b.classList.remove('is-loading'); b.removeAttribute('aria-busy'); toast(emsg(e), 'err'); }
    };
  }
  // A hidden file input that survives every re-render (the tray, the aside card, the profile ⋯ all use it).
  function storyPicker() {
    let inp = $('oslStoryPick');
    if (!inp) {
      inp = document.createElement('input'); inp.type = 'file'; inp.id = 'oslStoryPick'; inp.accept = 'image/*,video/mp4,video/webm,video/quicktime'; inp.hidden = true;
      (document.getElementById('ostMeshApp') || document.body).appendChild(inp);
      inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) storyCompose(f); });
    }
    return inp;
  }
  // Story viewer: full screen on phones, a 9:16 card over a blurred copy of the story on wide screens, with the
  // neighbouring groups as preview cards from 1100 px.
  const SV = { groups: [], gi: 0, ii: 0, timer: null, dur: 0, paused: false, userPaused: false, muted: false, downAt: 0, heldUntil: 0, sending: false, author: '', drafts: {}, replyTo: '' };
  function openStories(author) {
    const groups = SS.stories.filter((g) => !blocked(g.author));
    const gi = groups.findIndex((g) => g.author === author); if (gi < 0) return;
    SV.groups = groups; SV.gi = gi; SV.ii = Math.max(0, groups[gi].items.findIndex((s) => !s.seen)); SV.author = author;
    let el = $('oslStory');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslStory';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Stories'); el.tabIndex = -1;
      document.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('osl-sbg')) { closeStories(); return; } onStoryClick(e); });
      // Hold to pause. Releasing a hold must not count as a tap on the previous/next zones.
      const holdable = (t) => !(t && t.closest && t.closest('.osl-sfoot, .osl-shead button, .osl-sarrow, .osl-sprev, .osl-sclose'));
      el.addEventListener('pointerdown', (e) => { if (!holdable(e.target)) return; SV.paused = true; SV.downAt = Date.now(); });
      const release = () => { if (!SV.paused) return; SV.paused = false; if (Date.now() - SV.downAt > 280) SV.heldUntil = Date.now() + 400; };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('pointerleave', release);
      el.addEventListener('contextmenu', (e) => { if (!(e.target.closest && e.target.closest('input'))) e.preventDefault(); });
    }
    SV.paused = false; SV.userPaused = false; SV.heldUntil = 0;
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
    if (el) { el.classList.remove('on'); el.innerHTML = ''; ovPop(el, () => document.querySelector('#oslStories [data-act="sx-story"][data-a="' + SV.author + '"], #omxAside [data-act="sx-story"][data-a="' + SV.author + '"]')); }
  }
  function storyPreview(g, side) {
    const first0 = g.items.find((s) => !s.seen) || g.items[0], cov = storyCover(first0);
    return `<button type="button" class="osl-sprev ${side}" data-st="${side === 'prev' ? 'pgroup' : 'ngroup'}" aria-label="${esc(dname(g.author))}’s story"><span class="cover">${cov ? `<img src="${esc(cov)}" alt="" draggable="false">` : ''}</span><span class="who"><span class="osl-ring${g.items.every((s) => s.seen) ? ' seen' : ''}">${avatar(g.author, 'lg')}</span><b>${esc(first(g.author))}</b><small>${esc(ago(first0.ts))}</small></span></button>`;
  }
  function showStory() {
    const el = $('oslStory'); const g = SV.groups[SV.gi]; if (!g) return closeStories();
    const s = g.items[SV.ii]; if (!s) return closeStories();
    const mine = g.author === me(), vid = s.media.kind === 'video';
    // A reply being typed survives the redraw: it is kept per author and comes back on that author's next story.
    const prevIn = $('oslSReply'), hadFocus = !!(prevIn && document.activeElement === prevIn);
    if (prevIn && SV.replyTo) SV.drafts[SV.replyTo] = prevIn.value;
    SV.replyTo = mine ? '' : g.author;
    // Neighbour previews only where they fit beside the card and its arrows (>= 1100 px wide).
    const W = window.innerWidth, H = window.innerHeight, cw = Math.min((H - 48) * 9 / 16, W - 150);
    const roomy = W >= 1100 && W / 2 - cw / 2 - 320 >= 8;
    const pg = SV.groups[SV.gi - 1], ng = SV.groups[SV.gi + 1];
    const bg = storyCover(s);
    el.setAttribute('aria-label', 'Story by ' + dname(g.author));
    el.innerHTML = `<div class="osl-sbg" aria-hidden="true">${bg ? `<img src="${esc(bg)}" alt="" draggable="false">` : ''}</div>
      ${roomy && pg ? storyPreview(pg, 'prev') : ''}${roomy && ng ? storyPreview(ng, 'next') : ''}
      ${SV.gi > 0 || SV.ii > 0 ? `<button type="button" class="osl-sarrow prev" data-st="prev" aria-label="Previous story">${icon('back')}</button>` : ''}
      <div class="osl-scard">
        <div class="osl-smedia osl-swap">${vid ? `<video id="oslSVid" src="${mediaUrl(s.media.id)}" ${s.media.poster ? `poster="${mediaUrl(s.media.poster)}"` : ''} autoplay playsinline${SV.muted ? ' muted' : ''}></video>` : `<img src="${mediaUrl(s.media.id)}" alt="${esc(s.caption || 'Story photo')}" draggable="false">`}</div>
        <div class="osl-sbars" aria-hidden="true">${g.items.map((x, i) => `<i><b style="width:${i < SV.ii ? 100 : 0}%" ${i === SV.ii ? 'id="oslSBar"' : ''}></b></i>`).join('')}</div>
        <div class="osl-shead">${avatar(g.author, 'sm')}<b>${esc(dname(g.author))}</b><small>${esc(ago(s.ts))}</small><span class="sp"></span>
          <button type="button" class="omx-ib sm" data-st="pause" aria-label="Pause story" aria-pressed="${SV.userPaused}">${icon(SV.userPaused ? 'play' : 'pause')}</button>
          ${vid ? `<button type="button" class="omx-ib sm" data-st="mute" aria-label="Mute story" aria-pressed="${SV.muted}">${icon(SV.muted ? 'volume-off' : 'volume')}</button>` : ''}
          ${mine ? `<button type="button" class="omx-ib sm" data-st="menu" aria-label="Story options" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>` : ''}
          <button type="button" class="omx-ib osl-shclose" data-st="close" aria-label="Close stories">${icon('close')}</button></div>
        <div class="osl-snav"><button type="button" data-st="prev" aria-label="Previous" tabindex="-1"></button><button type="button" data-st="next" aria-label="Next" tabindex="-1"></button></div>
        ${s.caption ? `<p class="osl-scap">${esc(s.caption)}</p>` : ''}
        <div class="osl-sfoot">${mine ? `<span class="osl-sviews">${icon('eye')}${fmtN(s.views || 0)} ${Number(s.views) === 1 ? 'view' : 'views'}</span>` : `<input class="osl-sreply" id="oslSReply" placeholder="Reply to ${esc(first(g.author))}…" maxlength="300" autocomplete="off" enterkeyhint="send" aria-label="Reply to ${esc(dname(g.author))}"><button type="button" class="omx-ib" data-st="reply" aria-label="Send reply">${icon('send')}</button>`}</div>
      </div>
      <button type="button" class="osl-sarrow next" data-st="next" aria-label="Next story">${icon('chevron-right')}</button>
      <button type="button" class="omx-ib osl-sclose" data-st="close" aria-label="Close stories (Esc)">${icon('close')}</button>`;
    const rIn = $('oslSReply');
    if (rIn && SV.drafts[g.author]) { rIn.value = SV.drafts[g.author]; if (hadFocus) { try { rIn.focus({ preventScroll: true }); } catch (_) {} } }
    if (!el.contains(document.activeElement) && !document.querySelector('#oslSheet.on') && !callUp()) { try { el.focus({ preventScroll: true }); } catch (_) {} }
    s.seen = true;
    if (!mine && me()) signed('POST', '/mesh/v1/social/story/view', { from: me(), storyId: s.id }).catch(() => {});
    clearInterval(SV.timer); SV.dur = 5000; let elapsed = 0, last = Date.now();
    let v = $('oslSVid');
    if (v) {
      const vv = v;
      vv.muted = SV.muted; vv.play().catch(() => { vv.muted = true; SV.muted = true; const mb = el.querySelector('[data-st="mute"]'); if (mb) { mb.setAttribute('aria-pressed', 'true'); mb.innerHTML = icon('volume-off'); } vv.play().catch(() => {}); });
      vv.onloadedmetadata = () => { SV.dur = Math.min(30000, (vv.duration || 5) * 1000); };
      vv.onended = () => { if (v === vv) stNext(); };
      vv.onerror = () => { if (v === vv) v = null; mediaFail(vv, 'Story unavailable', false); };
    }
    SV.timer = setInterval(() => {
      const now = Date.now();
      // paused while held, while Pause is on, while a reply is being typed or waits unsent in the box (a story moving
      // on would take it away), while a confirm sheet or a call screen is up, or while the tab is hidden
      const ri = $('oslSReply');
      const hold = SV.paused || SV.userPaused || document.hidden || !!document.querySelector('#oslSheet.on, #omxCall') || !!(ri && (document.activeElement === ri || ri.value.trim()));
      if (!hold) elapsed += now - last; last = now;
      if (v) { if (hold && !v.paused) { v.pause(); v.__held = 1; } else if (!hold && v.__held) { v.__held = 0; v.play().catch(() => {}); } }
      const bar = $('oslSBar'); if (bar) bar.style.width = Math.min(100, elapsed / SV.dur * 100) + '%';
      if (!v && elapsed >= SV.dur) stNext();
      else if (v && elapsed >= 30000) stNext();
    }, 100);
  }
  function stNext() { const g = SV.groups[SV.gi]; if (!g) return closeStories(); if (SV.ii < g.items.length - 1) SV.ii++; else if (SV.gi < SV.groups.length - 1) { SV.gi++; SV.ii = 0; } else return closeStories(); showStory(); }
  function stPrev() { if (SV.ii > 0) SV.ii--; else if (SV.gi > 0) { SV.gi--; SV.ii = SV.groups[SV.gi].items.length - 1; } showStory(); }
  function stJump(d) { const gi = SV.gi + d, g = SV.groups[gi]; if (!g) return; SV.gi = gi; SV.ii = Math.max(0, g.items.findIndex((s) => !s.seen)); showStory(); }
  async function onStoryClick(e) {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const k = b.getAttribute('data-st'); const g = SV.groups[SV.gi]; const s = g && g.items[SV.ii];
    if (k === 'close') closeStories();
    else if (k === 'next' || k === 'prev') { if (Date.now() < SV.heldUntil) { SV.heldUntil = 0; return; } if (k === 'next') stNext(); else stPrev(); }
    else if (k === 'pgroup' || k === 'ngroup') stJump(k === 'pgroup' ? -1 : 1);
    else if (k === 'pause') {
      // a sticky Pause, separate from hold-to-pause (WCAG 2.2.2): updated in place so focus stays on it
      SV.userPaused = !SV.userPaused; b.setAttribute('aria-pressed', String(SV.userPaused)); b.innerHTML = icon(SV.userPaused ? 'play' : 'pause');
    }
    else if (k === 'mute') { const v = $('oslSVid'); SV.muted = !SV.muted; if (v) v.muted = SV.muted; b.setAttribute('aria-pressed', String(SV.muted)); b.innerHTML = icon(SV.muted ? 'volume-off' : 'volume'); }
    else if (k === 'menu' && s) {
      menu('Your story', [{ ico: 'trash', label: 'Delete story', danger: true, run: () => deleteStory(g, s) }], { anchor: b });
    }
    else if (k === 'reply' && g) replyStory(g);
  }
  async function deleteStory(g, s) {
    if (!(await askSheet({ title: 'Delete this story?', body: 'It disappears for everyone right away.', ok: 'Delete story', danger: true }))) return;
    try {
      await signed('POST', '/mesh/v1/social/story/delete', { from: me(), storyId: s.id });
      const i = g.items.indexOf(s); if (i >= 0) g.items.splice(i, 1);
      toast('Story deleted', 'ok');
      if (!g.items.length) { SS.stories = SS.stories.filter((x) => x !== g); closeStories(); }
      else { if (SV.groups[SV.gi] === g) SV.ii = Math.min(SV.ii, g.items.length - 1); showStory(); }
    } catch (err) { toast(emsg(err), 'err'); }
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
      toast(how === 'known' ? 'Reply sent privately to ' + who : how === 'accepted' ? 'Reply sent — you and ' + who + ' are now connected' : 'Reply sent to ' + who + ' with a contact request', 'ok');
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

  /* ---------- FIRST RUN + "Get started" guide ---------- */
  const GUIDE_K = 'ost.mesh.guide.v1', FR_K = 'ost.mesh.firstrun.done';
  const needsFirstRun = () => !!me() && !(S.profile && S.profile.name) && !SS.frDone && !core.lsGet(FR_K, false);
  // The guide belongs to a first run: it starts when this device first shows the setup card, and ends when its three
  // steps are done or the user hides it. People who already had a name never see it.
  function guideStart() { if (core.lsGet(GUIDE_K, '') === '') core.lsSet(GUIDE_K, 'on'); }
  function guideSteps() { return [true, !!(S.profile && S.profile.name) || SS.frDone, !!(SS.meCounts && Number(SS.meCounts.following) >= 3)]; }
  function guideOn() {
    if (core.lsGet(GUIDE_K, '') !== 'on') return false;
    if (guideSteps().every(Boolean)) { core.lsSet(GUIDE_K, 'done'); return false; }
    return true;
  }
  function guideHtml(phone) {
    if (!guideOn()) return '';
    loadMeCounts();
    const st = guideSteps(), n = st.filter(Boolean).length, nextI = st.findIndex((x) => !x);
    const li = (i, ico, txt, extra) => `<li class="${st[i] ? 'done' : i === nextI ? 'next' : ''}">${icon(st[i] ? 'check-circle' : ico, st[i] ? 'is-on' : '')}<span>${txt}</span>${!st[i] && extra ? extra : ''}</li>`;
    return `<div class="omx-mod osl-guide${phone ? ' osl-guide-in' : ''}" role="region" aria-labelledby="oslAsG${phone ? 'p' : ''}"><header><h3 id="oslAsG${phone ? 'p' : ''}">Get started</h3><span class="osl-ghd"><span class="count">${n} of 3</span><button type="button" data-act="sx-guide-hide" aria-label="Hide the Get started guide">Hide</button></span></header>
      <div class="osl-prog" role="progressbar" aria-label="Get started" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${n}"><i style="width:${Math.round(n / 3 * 100)}%"></i></div>
      <ol>${li(0, 'key', 'Your private key is ready')}${li(1, 'user', 'Pick a name and picture', isDesk() ? '' : '')}${li(2, 'users', 'Follow 3 people', '<button type="button" class="omx-textbtn" data-act="sx-search">Find</button>')}</ol></div>`;
  }
  function paintGuide() {
    paintAside('guide');
    const g = document.querySelector('#omxBody .osl-guide-in');
    if (g) { const h = guideHtml(true); if (!h) g.remove(); else { const t = document.createElement('div'); t.innerHTML = h; g.replaceWith(t.firstElementChild); } }
  }
  function firstRunHtml(phone) {
    const pick = SS.frEmoji || (S.profile && S.profile.emoji) || EMOJIS[8];
    const list = EMOJIS.slice(0, 8).filter((e) => e !== pick); list.unshift(pick);
    const opts = list.slice(0, phone ? 5 : 8);
    return `<div class="osl-firstrun" role="region" aria-labelledby="oslFrT">
      <div class="osl-fr-top">${glyphAv('lg', pick, 'oslFrAv')}<div><h3 id="oslFrT">Set up your profile</h3><p>Pick a name and a picture so friends recognise you. Your identity lives in this browser${phone ? '' : '; there is nothing to sign up for'}.</p></div></div>
      <div class="osl-emojis" role="radiogroup" aria-label="Avatar emoji">${opts.map((e) => `<button type="button" role="radio" aria-checked="${e === pick}" tabindex="${e === pick ? 0 : -1}" data-act="sx-fr-emoji" data-e="${e}" aria-label="Emoji ${esc(e)}">${e}</button>`).join('')}<button type="button" class="osl-frup" data-act="sx-avatar-pick" aria-label="Upload a photo">${icon('upload')}</button></div>
      <div class="osl-fr-row"><label class="omx-field"><span>Display name</span><input class="omx-input" id="oslFrName" maxlength="32" placeholder="e.g. Sam Rivera" autocomplete="nickname" aria-describedby="oslFrH"></label><button type="button" class="omx-primary" data-act="sx-fr-save">Save</button></div>
      <small class="osl-frh" id="oslFrH">Shown on your posts and in friends’ chats. You can change it any time.</small></div>`;
  }
  // Cleaning as the hub does (it drops < and >), so a name made only of those is refused here, not saved blank.
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  function fieldError(inputId, errId, msg) {
    const el = $(errId), nm = $(inputId);
    if (el) { el.innerHTML = msg ? icon('alert') + esc(msg) : ''; el.hidden = !msg; }
    if (nm) { if (msg) nm.setAttribute('aria-invalid', 'true'); else nm.removeAttribute('aria-invalid'); }
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
    try { const j = await getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(addr) + '&me=' + encodeURIComponent(me() || '')); absorb({ [addr]: j.user }); if (cur()) SS.profileUser = j; if (j && typeof j.iFollow === 'boolean') SS.follow[addr] = j.iFollow; if (addr === me() && j && j.counts) { SS.meCounts = j.counts; SS.meCountsAt = Date.now(); } delete AUTO['sx-retry-profile']; }
    catch (e) { if (cur()) SS.profileUser = { err: e.message || 'unavailable', errObj: e }; }
    if (shown()) paintProfile();
    try { const j = await getJ('/mesh/v1/social/feed?author=' + encodeURIComponent(addr) + '&limit=20&me=' + encodeURIComponent(me() || '')); absorb(j.authors); if (cur()) { SS.profilePosts = j.posts || []; SS.profilePostsOf = addr; SS.profilePostsErr = ''; } }
    catch (e) { if (cur()) { SS.profilePostsOf = addr; SS.profilePostsErr = e.message || 'unavailable'; SS.profilePostsErrObj = e; } }
    if (shown()) paintProfile();
  }
  function profileHead(ctx, addr, self) {
    const j = SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === addr ? SS.profileUser : null;
    const posts = j && j.counts && j.counts.posts != null ? fmtN(j.counts.posts) + (Number(j.counts.posts) === 1 ? ' post' : ' posts') : '';
    if (self) {
      if (isDesk()) { ctx.head.className = 'omx-head'; ctx.head.innerHTML = `<h2 id="omxTitle">Profile</h2><button type="button" class="omx-ib md" data-act="sx-settings" aria-label="Settings">${icon('settings')}</button>`; }
      else rootHead(ctx, `Profile${devnetChip()}`, `<button type="button" class="omx-ib" data-act="sx-settings" aria-label="Settings">${icon('settings')}</button>`);
      return;
    }
    const name = user(addr).name;
    const more = isDesk() ? '' : `<button type="button" class="omx-ib" data-act="sx-pmenu" data-a="${esc(addr)}" aria-label="More options for ${esc(first(addr))}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>`;
    head(ctx, name || shortA(addr), posts, more);
  }
  function renderProfile(ctx, self) {
    SS.curView = self ? 'me' : 'profile';
    deskPrep();
    // The core asks for a person through S.profileOf (chat header → profile). That request wins over whoever was viewed before.
    const asked = !self && S.profileOf ? S.profileOf : null;
    if (asked) { SS.fromChat = S.peer === asked ? asked : null; S.profileOf = null; if (SS.fromChat) { SS.stack = []; dropLinks(); } }   // Back from here returns to that chat
    const addr = self ? me() : (asked || SS.profileOf);
    if (!addr) { rootHead(ctx, 'Profile'); ctx.body.innerHTML = `<div class="omx-empty"><span class="ic">${icon('key')}</span><h3>Loading your identity…</h3></div>`; return; }
    if (SS.profileOf !== addr) resetProfile();
    SS.profileOf = addr;
    profileHead(ctx, addr, self);
    if (self && needsFirstRun()) guideStart();
    ctx.body.innerHTML = `${self && !isDesk() && needsFirstRun() ? firstRunHtml(true) : ''}<div id="oslProfile"></div>${self && !isDesk() ? guideHtml(true) : ''}<h3 class="osl-psec">Posts</h3><div id="oslPPosts"></div>`;
    paintProfile();
    if (!SS.profileUser || SS.profileUser.err || (SS.profileUser.user && SS.profileUser.user.addr !== addr) || Date.now() - (SS.profileAt || 0) > 20000) {
      if (Date.now() - (SS.profileAt || 0) > 4000) { SS.profileAt = Date.now(); loadProfile(addr); }   // a failed load is not re-fired by every re-render
    }
  }
  function profileButtons(addr, self, j, phone) {
    if (self) {
      return `<button type="button" class="omx-primary" data-act="sx-edit">${icon('edit')}Edit profile</button><button type="button" class="omx-ghost" data-act="sx-share-me">${icon('share')}Share profile</button>${phone ? '' : `<button type="button" class="omx-ib outline md" data-act="sx-pmenu" data-a="${esc(addr)}" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>`}`;
    }
    const c = core.contact(addr);
    const contact = !!c && (c.state === 'friend' || c.state === 'pending-out' || c.state === 'request');
    const following = !!(j && j.iFollow);
    const follow = `<button type="button" class="${contact || following ? 'omx-ghost' : 'omx-primary'}" data-act="sx-follow" data-a="${esc(addr)}" data-on="${following ? 0 : 1}" aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>`;
    const msg = `<button type="button" class="${contact ? 'omx-primary' : 'omx-ghost'}" data-act="sx-message" data-a="${esc(addr)}">${icon('chat')}Message</button>`;
    const call = c && c.state === 'friend' && window.OST_MESH_CALL ? `<button type="button" class="omx-ib outline${phone ? '' : ' md'}" data-act="sx-call" data-a="${esc(addr)}" data-v="0" aria-label="Voice call ${esc(first(addr))}">${icon('phone')}</button>` : '';
    const more = phone ? '' : `<button type="button" class="omx-ib outline md" data-act="sx-pmenu" data-a="${esc(addr)}" aria-label="More options for ${esc(first(addr))}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>`;
    // desk: the primary sits at the right end (⋯ · call · secondary · primary); phone: primary first in a grid
    if (phone) return contact ? msg + follow + call : follow + msg + call;
    return more + call + (contact ? follow + msg : msg + follow);
  }
  function paintProfile() {
    const el = $('oslProfile'); if (!el) return;
    const addr = SS.profileOf, self = addr === me(), phone = !isDesk();
    const j = SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === addr ? SS.profileUser : null;
    const u = user(addr), c = core.contact(addr);
    const counts = (j && j.counts) || {};   // unknown until loaded: shown as "–", never as 0
    const wallet = self ? (S.profile.wallet || u.wallet) : u.wallet;
    // the header's second line ("48 posts") follows the counts once they arrive
    const hs = document.querySelector('#omxHead h2 small');
    if (!self && (S.view === 'profile')) { const posts = counts.posts != null ? fmtN(counts.posts) + (Number(counts.posts) === 1 ? ' post' : ' posts') : ''; const h2 = document.querySelector('#omxHead h2'); if (h2) { if (posts && hs) hs.textContent = posts; else if (posts && !hs) { h2.className = 'omx-h2col'; h2.innerHTML = `<span>${esc(dname(addr))}</span><small>${esc(posts)}</small>`; } } }
    const chips = (j && j.followsMe && !self ? '<span class="osl-fyou">Follows you</span>' : '') + (!self && c && c.state === 'friend' ? '<span class="osl-fyou">Friend</span>' : '');
    const meta = [];
    if (wallet) meta.push(u.walletVerified || (self && S.profile.wallet) ? `<span class="ok">${icon('wallet')}Wallet linked · verified</span>` : `<span>${icon('wallet')}Wallet linked</span>`);
    if (!self && c && c.state === 'friend' && j && j.online) meta.push('<span><i class="dot" aria-hidden="true"></i>Online</span>');
    const perr = SS.profileUser && SS.profileUser.err;
    const btns = profileButtons(addr, self, j, phone);
    el.innerHTML = `<div class="osl-phero" style="${avVar(addr)}"><div class="osl-pbanner" role="img" aria-label="Default banner, no photo set"></div>
      <div class="osl-ptop">${avatar(addr, phone ? 'xl' : 'xxl')}${phone ? '' : `<div class="osl-pbtns">${btns}</div>`}</div>
      <div class="osl-pinfo"><div class="osl-pname">${esc(dname(addr))}${badge(addr)}</div>
        <div class="osl-phandle"><span>${self ? 'Your address: ' : ''}${esc(shortA(addr))}</span><button type="button" class="omx-ib" data-act="sx-copy-addr" data-a="${esc(addr)}" aria-label="Copy ${self ? 'your' : esc(first(addr)) + '’s'} address">${icon('copy')}</button>${chips}</div>
        ${u.bio ? `<p class="osl-bio">${rich(u.bio)}</p>` : (self ? '<p class="osl-bio dim">Add a bio so people know who you are.</p>' : '')}
        ${meta.length ? `<div class="osl-pmeta">${meta.join('')}</div>` : ''}
        <div class="osl-counts"><button type="button" data-act="sx-list" data-dir="following"><b>${fmtCount(counts.following)}</b>following</button><button type="button" data-act="sx-list" data-dir="followers"><b>${fmtCount(counts.followers)}</b>followers</button><button type="button" data-act="sx-list" data-dir="posts"><b>${fmtCount(counts.posts)}</b>posts</button></div></div>
      ${phone ? `<div class="osl-pbtns is-row${(btns.match(/<button/g) || []).length < 3 ? ' two' : ''}">${btns}</div>` : ''}</div>
      ${perr ? inErr('Couldn’t load this profile. ' + perr, 'sx-retry-profile') : ''}`;
    const pe = $('oslPPosts'); if (!pe) return;
    const own = SS.profilePostsOf === addr, posts = own ? SS.profilePosts : null, lerr = own ? SS.profilePostsErr : '';
    if (lerr && !(posts && posts.length)) pe.innerHTML = perr ? '' : errBox('Couldn’t load posts', SS.profilePostsErrObj || lerr, 'sx-retry-profile');
    else pe.innerHTML = !posts ? (perr ? '' : skeleton()) : posts.length ? (lerr ? inErr('Couldn’t refresh posts.', 'sx-retry-profile') : '') + posts.map(postHtml).join('') : `<div class="omx-empty"><span class="ic">${icon('pen')}</span><h3>${self ? 'You have not posted yet' : 'No posts yet'}</h3>${self ? `<button type="button" class="omx-primary" data-act="sx-compose">${icon('pen')}Write a post</button>` : ''}</div>`;
    wireVideos(pe);
    paintAside('peerchat');
  }
  // Desk profile aside: "Your chat with <name>" — the last three messages of the local thread (never fetched).
  function peerChatHtml() {
    if (S.view !== 'profile') return '';
    const a = SS.profileOf, c = a && core.contact(a);
    if (!c || !(c.state === 'friend' || c.state === 'pending-out' || c.state === 'request')) return '';
    let list = []; try { list = (core.msgsOf(a) || []).filter((m) => m && m.kind !== 'sys').slice(-3); } catch (_) {}
    const line = (m) => {
      const k = m.kind;
      const t = k === 'text' ? m.text : k === 'pay' ? (m.dir === 'me' ? 'Sent ' : 'Received ') + fmtAmt(m.amount) + ' ' + (m.ccy || 'OST') : k === 'call' ? (m.video ? 'Video call' : 'Voice call') : k === 'image' || k === 'video' ? 'Photo' : k === 'file' ? 'File' : k === 'loc' || k === 'location' || k === 'live' ? 'Location' : 'Message';
      return `<div class="ln${m.dir === 'me' ? ' me' : ''}"><span>${esc(excerpt(t, 80))}</span></div>`;
    };
    return `<div class="omx-mod" role="region" aria-labelledby="oslAsPc"><header><h3 id="oslAsPc">Your chat with ${esc(first(a))}</h3><button type="button" data-act="sx-message" data-a="${esc(a)}">Open</button></header><div class="osl-peerchat">${list.length ? list.map(line).join('') : '<p class="osl-pcempty">No messages on this device yet.</p>'}</div></div>`;
  }
  // "Who to follow": named profiles from the hub, minus you, your hidden people and whoever you follow already.
  function whoHtml() {
    if (!SS.people) { loadPeople(); return ''; }
    const list = (SS.people.users || []).filter((u) => u && u.addr && u.addr !== me() && !blocked(u.addr) && !SS.follow[u.addr]).slice(0, 3);
    if (!list.length) return '';
    return `<div class="omx-mod" role="region" aria-labelledby="oslAsWho"><header><h3 id="oslAsWho">Who to follow</h3></header>${list.map((u) => `<div class="omx-row osl-wrow"><button type="button" class="osl-wlink" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<span class="t"><b>${esc(u.name || shortA(u.addr))}${u.walletVerified ? VERIFIED() : ''}</b><span>${esc(u.bio || shortA(u.addr))}</span></span></button><button type="button" class="omx-primary omx-sm omx-hit" data-act="sx-follow" data-a="${esc(u.addr)}" data-on="1" aria-label="Follow ${esc(u.name || shortA(u.addr))}">Follow</button></div>`).join('')}<button type="button" class="omx-more" data-act="sx-search">Show more</button></div>`;
  }
  function renderEdit(ctx) {
    SS.curView = 'edit';
    const p = S.profile;
    // The form is drawn from a draft, so whatever was typed survives every re-render (emoji pick, photo upload or removal).
    const d = SS.edit || (SS.edit = { name: p.name || '', bio: p.bio || '', emoji: p.emoji || '' });
    if (isPhone()) {
      ctx.head.className = 'omx-head has-back osl-chead';
      ctx.head.innerHTML = `<button type="button" class="omx-textbtn osl-cancel" data-act="sx-back">Cancel</button><h2 id="omxTitle" class="osl-ctitle">Edit profile</h2><button type="button" class="omx-primary omx-sm omx-hit" data-act="sx-save">Save</button>`;
    } else head(ctx, 'Edit profile', '', `<button type="button" class="omx-primary omx-sm" data-act="sx-save">Save</button>`);
    const av = p.avatar ? avatar(me(), 'xl', 'id="oslEditAv"') : glyphAv('xl', d.emoji || (d.name.trim() ? d.name.trim()[0].toUpperCase() : ''), 'oslEditAv');
    const wallet = S.profile.wallet;
    ctx.body.innerHTML = `<div class="osl-edit">
      <div class="osl-edit-av">${av}<div class="osl-edit-avb"><button type="button" class="omx-textbtn" id="oslAvLab" data-act="sx-avatar-pick" ${SS.avBusy ? 'aria-busy="true" disabled' : ''}>${icon('upload')}<span>${SS.avBusy ? 'Uploading photo…' : 'Change photo'}</span></button>${p.avatar && !SS.avBusy ? `<button type="button" class="omx-textbtn osl-avclear" data-act="sx-avatar-clear">${icon('trash')}Remove photo</button>` : ''}</div></div>
      <div class="omx-field"><span><label for="oslName">Name</label><em id="oslNameN">${d.name.length} / 32</em></span><input class="omx-input" id="oslName" maxlength="32" value="${esc(d.name)}" placeholder="Your name" autocomplete="nickname" aria-describedby="oslNameErr oslNameN"><small class="err" id="oslNameErr" role="alert" hidden></small></div>
      <div class="omx-field"><span><label for="oslBio">Bio</label><em id="oslBioN">${d.bio.length} / 200</em></span><textarea class="omx-input" id="oslBio" maxlength="200" rows="3" placeholder="A line about you" aria-describedby="oslBioN">${esc(d.bio)}</textarea></div>
      <div class="omx-field"><span id="oslEmoL">Picture when you have no photo</span><div class="osl-emojis" role="radiogroup" aria-labelledby="oslEmoL">${EMOJIS.map((e, i) => `<button type="button" role="radio" aria-checked="${d.emoji === e}" tabindex="${d.emoji === e || (!d.emoji && i === 0) ? 0 : -1}" data-act="sx-emoji" data-e="${e}" aria-label="Emoji ${i + 1}">${e}</button>`).join('')}</div></div>
      <div class="omx-setgrp"><h3>Wallet for tips</h3><div>${wallet
        ? `<div class="omx-setrow">${icon('wallet')}<span class="t"><b>${esc(wallet.slice(0, 4) + '…' + wallet.slice(-4))}</b><small>Linked with a signature · people can tip you on ${esc(NET())}</small></span><span class="rt"><button type="button" class="omx-textbtn osl-unlink" data-act="sx-unlink">Unlink</button></span></div>`
        : `<button type="button" class="omx-setrow" data-act="sx-link">${icon('wallet')}<span class="t"><b>Link a wallet</b><small>Proves the wallet is yours with one signature, so people can tip you on ${esc(NET())}</small></span><span class="rt">${icon('chevron-right')}</span></button>`}</div></div>
    </div>`;
    const nm = $('oslName'), bio = $('oslBio');
    if (nm) nm.addEventListener('input', () => { d.name = nm.value; const n = $('oslNameN'); if (n) n.textContent = nm.value.length + ' / 32'; fieldError('oslName', 'oslNameErr', ''); if (!p.avatar && !d.emoji) setGlyph($('oslEditAv'), nm.value.trim() ? nm.value.trim()[0].toUpperCase() : ''); });
    if (bio) bio.addEventListener('input', () => { d.bio = bio.value; const n = $('oslBioN'); if (n) n.textContent = bio.value.length + ' / 200'; });
  }
  // One photo upload path for Edit profile and the first-run card. Progress shows on the button itself; only the
  // outcome is a toast.
  function avatarPicker() {
    let inp = $('oslAvPick');
    if (!inp) {
      inp = document.createElement('input'); inp.type = 'file'; inp.id = 'oslAvPick'; inp.accept = 'image/*'; inp.hidden = true;
      (document.getElementById('ostMeshApp') || document.body).appendChild(inp);
      inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) uploadAvatar(f); });
    }
    return inp;
  }
  async function uploadAvatar(f) {
    if (!f || SS.avBusy) return;
    const busy = (on) => { SS.avBusy = on; const lab = $('oslAvLab'), sp = lab && lab.querySelector('span'); if (sp) sp.textContent = on ? 'Uploading photo…' : 'Change photo'; if (lab) { lab.disabled = on; if (on) lab.setAttribute('aria-busy', 'true'); else lab.removeAttribute('aria-busy'); } };
    busy(true);
    try { const img = await imageToUpload(f, 512); if (!S.announced) await core.announce(); const id = await upload(img.blob, img.mime, 'avatar', img.w, img.h); await core.saveProfile({ avatar: id }); absorb({ [me()]: { avatar: id } }); busy(false); if (S.view === 'edit' || S.view === 'me' || S.view === 'feed') core.render(); toast('Photo updated', 'ok'); }
    catch (e) { busy(false); toast(emsg(e), 'err'); }
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
      toast('Wallet linked — people can now tip you', 'ok'); core.render();
    } catch (e) { toast((e && e.message) || 'Could not link wallet', 'err'); }
  }

  /* ---------- ALERTS / SEARCH ---------- */
  function renderNotifs(ctx) {
    if (SS.curView !== 'notifs') SS.nSplit = null;   // "New" vs "Earlier" is decided once per visit
    SS.curView = 'notifs';
    deskPrep();
    if (isDesk()) { ctx.head.className = 'omx-head'; ctx.head.innerHTML = '<h2 id="omxTitle">Alerts</h2>'; }
    else head(ctx, 'Alerts', '');
    ctx.body.innerHTML = '<div id="oslNotifs"></div>';
    paintNotifs();
    // Opening the list fetches fresh alerts (one request at a time; skipped when the last one is under 30 s old).
    if (!SS.notifsAt || Date.now() - SS.notifsAt > 30000) loadNotifs(true);
  }
  // Consecutive likes of the same post within 24 h collapse into one row ("Ana and 3 others liked your post").
  function groupNotifs(items) {
    const out = [];
    items.forEach((n) => {
      if (!n || blocked(n.from)) return;
      const last = out[out.length - 1];
      if (n.kind === 'like' && last && last.kind === 'like' && last.postId === n.postId && Math.abs(last.ts - n.ts) < 864e5) { if (!last.froms.includes(n.from)) last.froms.push(n.from); return; }
      out.push(Object.assign({}, n, { froms: [n.from] }));
    });
    return out;
  }
  function notifRow(n, isNew) {
    const f = n.froms, a = f[0], post = n.postId ? findPost(n.postId) : null;
    const who = `<b>${esc(dname(a))}</b>`;
    const kind = { like: ['like', 'heart', 'is-on'], comment: ['comment', 'reply', ''], follow: ['follow', 'user-plus', ''], tip: ['tip', 'coin', ''] }[n.kind] || ['', 'bell', ''];
    let txt, sub = '';
    if (n.kind === 'like') { txt = (f.length === 1 ? who : f.length === 2 ? `${who} and <b>${esc(dname(f[1]))}</b>` : `${who} and <b>${f.length - 1} others</b>`) + ' liked your post'; if (post && post.text) sub = '“' + excerpt(post.text, 70) + '”'; }
    else if (n.kind === 'comment') txt = `${who} commented: “${esc(excerpt(n.text || '', 90))}”`;
    else if (n.kind === 'follow') txt = `${who} started following you`;
    else if (n.kind === 'tip') { txt = `${who} tipped you <span class="amt">${esc(fmtAmt(n.amount))} ${esc(n.ccy || 'OST')}</span>`; if (post && post.text) sub = 'On “' + excerpt(post.text, 60) + '”'; }
    else txt = `${who} · ${esc(n.kind || 'activity')}`;
    const av = f.length > 1 ? `<span class="omx-avstack">${avatar(f[0])}${avatar(f[1])}</span>` : avatar(a);
    const plain = txt.replace(/<[^>]+>/g, '');
    return `<button type="button" class="osl-nrow${isNew ? ' unseen' : ''}" data-act="${n.postId ? 'sx-open' : 'sx-profile'}" data-p="${esc(n.postId || '')}" data-a="${esc(a)}"${isNew ? ` aria-label="New: ${esc(plain)}${sub ? ' ' + esc(sub) : ''}, ${esc(ago(n.ts))}"` : ''}><span class="osl-nav">${av}<span class="osl-nkind ${kind[0]}" aria-hidden="true">${icon(kind[1], kind[2])}</span></span><span class="t"><span>${txt}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span><time datetime="${new Date(n.ts || Date.now()).toISOString()}">${esc(ago(n.ts))}</time></button>`;
  }
  function paintNotifs() {
    const el = $('oslNotifs'); if (!el || S.view !== 'notifs') return;
    const items = SS.notifs.items || [], err = SS.notifsErr;
    let h;
    if (!items.length) h = err ? errBox('Couldn’t load alerts', SS.notifsErrObj || err, 'sx-retry-notifs') : !SS.notifsAt ? skeleton() : `<div class="omx-empty"><span class="ic">${icon('bell')}</span><h3>No alerts yet</h3><p>Likes, replies, follows and tips show up here.</p></div>`;
    else {
      if (SS.nSplit == null) SS.nSplit = SS.notifs.seenAt || 0;
      const rows = groupNotifs(items), fresh = rows.filter((n) => n.ts > SS.nSplit), old = rows.filter((n) => !(n.ts > SS.nSplit));
      h = (err ? inErr('Couldn’t refresh alerts.', 'sx-retry-notifs') : '') +
        (fresh.length ? `<h3 class="osl-ngrp">New</h3><div role="list">${fresh.map((n) => notifRow(n, true)).join('')}</div>` : '') +
        (old.length ? `<h3 class="osl-ngrp">Earlier</h3><div role="list">${old.map((n) => notifRow(n, false)).join('')}</div>` : '') +
        '<div class="osl-end">You’re all caught up</div>';
    }
    el.innerHTML = h;
    if (SS.notifs.unread) { SS.notifs.unread = 0; SS.notifs.seenAt = Date.now(); paintBell(); paintNav(); signed('POST', '/mesh/v1/social/notifs/seen', { addr: me() }).catch(() => {}); }
  }
  let searchT = null, searchSeq = 0;
  function renderSearch(ctx) {
    SS.curView = 'search';
    deskPrep();
    head(ctx, 'Search people', '');
    ctx.body.innerHTML = `<div class="osl-qwrap"><label class="osl-qpill">${icon('search')}<input id="oslQ" type="search" placeholder="Search by name or paste an address" value="${esc(SS.search)}" autocomplete="off" enterkeyhint="search" aria-label="Search people"></label></div><div id="oslRes" aria-live="polite"></div>`;
    const q = $('oslQ'); q.addEventListener('input', () => { SS.search = q.value; clearTimeout(searchT); searchT = setTimeout(runSearch, 300); }); setTimeout(() => { try { q.focus({ preventScroll: true }); } catch (_) {} }, 50);
    runSearch();
  }
  async function runSearch() {
    const el = $('oslRes'); if (!el) return;
    const q = SS.search.trim(), seq = ++searchSeq;   // a slower, older answer never overwrites a newer one
    el.innerHTML = '<div class="osl-end" role="status">Searching…</div>';
    try {
      const j = q ? await getJ('/mesh/v1/social/search?q=' + encodeURIComponent(q)) : (SS.people || (SS.people = await getJ('/mesh/v1/social/people?me=' + encodeURIComponent(me() || ''))));
      if (seq !== searchSeq || !$('oslRes')) return;
      const users = (j.users || []).filter((u) => u && u.addr !== me());
      users.forEach((u) => absorb({ [u.addr]: u }));
      delete AUTO['sx-retry-search'];
      $('oslRes').innerHTML = (q ? '' : '<h3 class="osl-ngrp">People on OST Mesh</h3>') + (users.length ? '<div role="list">' + users.map((u) => `<button type="button" class="omx-row" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<span class="t"><b>${esc(u.name || shortA(u.addr))}${u.walletVerified ? VERIFIED() : ''}</b><span>${esc(u.bio || shortA(u.addr))}</span></span></button>`).join('') + '</div>' : `<div class="omx-empty"><span class="ic">${icon('search')}</span><h3>Nobody found</h3><p>Invite friends from Add people → Your invite.</p></div>`);
    } catch (e) { if (seq === searchSeq && $('oslRes')) $('oslRes').innerHTML = errBox(q ? 'Search failed' : 'Couldn’t load people', e, 'sx-retry-search'); }
  }
  function followList(dir) {
    const addr = SS.profileOf;
    if (dir === 'posts') { const pe = document.querySelector('#omxBody .osl-psec') || $('oslPPosts'); if (pe) scrollToEl(pe, 'start'); return; }
    SS.flDir = dir;
    sheet(`<h3>${dir === 'followers' ? 'Followers' : 'Following'}</h3><div id="oslFl"><div class="osl-end" role="status">Loading…</div></div>`);
    getJ('/mesh/v1/social/follows?addr=' + encodeURIComponent(addr) + '&dir=' + dir).then((j) => {
      (j.users || []).forEach((u) => u && absorb({ [u.addr]: u }));
      const el = $('oslFl'); if (!el) return;
      el.innerHTML = (j.users || []).length ? '<div role="list">' + j.users.filter(Boolean).map((u) => `<button type="button" class="omx-row" data-sheet="close" data-act="sx-profile" data-a="${esc(u.addr)}">${avatar(u.addr)}<span class="t"><b>${esc(u.name || shortA(u.addr))}</b><span>${esc(shortA(u.addr))}</span></span></button>`).join('') + '</div>' : '<div class="osl-end">Nobody yet.</div>';
    }).catch((e) => {
      const el = $('oslFl'); if (!el) return;
      el.innerHTML = errBox('Couldn’t load this list', e, 'sx-fl-retry');
    });
  }

  /* ---------- PAYMENTS (tips + chat sends) ---------- */
  // OST and OSTG go through the pool-paid peer-transfer rail (OST pays the fee
  // AND creates the recipient's account — no SOL needed, TRF-1/TRF-2); SOL is a
  // native transfer under Solana's rent rule (RNT-1). One shared rail:
  // wallet-extras OST_SEND. Resolves to the signature (a String that also
  // carries { ok, sig, pending }).
  async function payTo({ wallet, amount, ccy, memo }) {
    const w = window.OST_WALLET;
    if (!w || !w.session || !w.session.publicKey) throw Object.assign(new Error('Connect a wallet first (Wallet → Connect).'), { code: 'no_wallet' });
    if (!window.OST_SEND || typeof window.OST_SEND.send !== 'function') throw Object.assign(new Error('The send rail is still loading — try again in a moment.'), { code: 'bad_response' });
    const r = await window.OST_SEND.send({ asset: ccy, to: wallet, amount: String(amount), memo, source: 'mesh-pay' });
    const sig = new String(r.sig);
    sig.ok = true; sig.sig = r.sig; sig.pending = !!r.pending;
    return sig;
  }
  // The error's own stage (a failed quote = nothing sent) and asset win; the
  // chosen currency is only the fallback, so a short SOL tip says SOL.
  function payErrText(e, ccy) {
    try { if (window.OST_MONEY_ERRORS) return window.OST_MONEY_ERRORS.text(e, { stage: 'submit', asset: (e && e.asset) || ccy || 'OST' }); } catch (_) {}
    return 'Payment didn’t go through — try again in a moment.';
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
        <div class="omx-note" style="margin-top:0">Real devnet transfer from your wallet to <b>${esc(wallet.slice(0, 4) + '…' + wallet.slice(-4))}</b> (signature-verified). ${ccy === 'SOL' ? 'OST pays the network fee; a new address must receive at least 0.00089 SOL.' : 'OST pays the fee and creates their account — no SOL needed.'} Devnet tokens have no cash value.</div>
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
          const doneMsg = sig.pending
            ? 'Still confirming ' + amount + ' ' + ccy + ' to ' + dname(addr) + ' (tx ' + sig.slice(0, 8) + '…). Check your balance before retrying.'
            : 'Sent ' + amount + ' ' + ccy + ' to ' + dname(addr) + ' ✓ (tx ' + sig.slice(0, 8) + '…)';
          st.textContent = doneMsg;
          if (postId) {
            let r = null, err = null;
            // Worth another try: the transaction is not visible to the RPC yet (tx_not_found, rpc_*), the first check of this
            // same tip is still running (409 tip_in_flight — the next answer is the idempotent ok), or the hub was busy.
            const again = (e) => !!e && (/^(tx_not_found|tip_in_flight|hub_busy|rate_limited)$/.test(e.code || '') || /^rpc/.test(e.code || '') || !!e.transient || /tx not found|rpc/i.test(e.message || ''));
            for (let i = 0; i < 6 && !r; i++) { try { r = await signed('POST', '/mesh/v1/social/tip', { from: me(), postId, sig, ccy }); } catch (e) { err = e; if (!again(e) || i === 5) break; await new Promise((res) => setTimeout(res, 2500)); } }
            if (r) { const p = findPost(postId); if (p) updatePost(Object.assign({}, p, { tips: r.tips, tipCount: r.tipCount })); toast('Tip verified on-chain ✓'); }
            else toast('Sent, but the tip could not be verified yet — it will show once the network catches up.', 'err');
          }
          if (chat || core.contact(addr)) {
            const note = ($('oslPayNote') || {}).value || '';
            core.sendInner(addr, { k: 'pay', ccy, amount, sig, note }, { kind: 'pay', ccy, amount, sig, note }).catch(() => {});
          }
          closeSheet();
          // C2: a user-initiated result always shows — the sheet is gone, so
          // say it where the person is looking (tips also get "verified ✓").
          if (!postId) toast(doneMsg);
        } catch (e) { go.disabled = false; go.textContent = (postId ? 'Tip ' : 'Send ') + amount + ' ' + ccy; const m = payErrText(e, ccy); st.textContent = m; toast(m, 'err'); }
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
    const first0 = f[0], last = f[f.length - 1];
    if (!root.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first0).focus(); }
    else if (e.shiftKey && (a === first0 || !f.includes(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first0.focus(); }
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

  /* ---------- #oslSheet: ONE sheet component, three presentations (same rules as the core's #omxSheet) ----------
   *   pop    anchored popover (an anchor and a window >= 700 px wide): below-end of the anchor, 8 px gap, flips above
   *          when it does not fit, clamped 8 px inside the viewport; closes on scroll, resize and outside click
   *   dlg    dialog (no anchor, >= 700 px): confirms 480 px, forms and the composer 600 px (.wide), 10 vh from the top
   *   sheet  bottom sheet (< 700 px): scrim, grabber, a separate Cancel row
   * A sheet opened while the lightbox or the story viewer is up gets .over (z 12900). */
  let sheetOnClose = null, sheetMode = '', sheetAnchor = null, popWatch = null;
  const overUp = () => !!document.querySelector('#oslStory.on, #oslLight.on');
  const sheetModeFor = (opts) => (opts && opts.mode) || (window.innerWidth >= 700 ? (opts && opts.anchor ? 'pop' : 'dlg') : 'sheet');
  function sheetRoot() {
    let el = $('oslSheet');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslSheet';
      el.innerHTML = '<div class="omx-box" id="oslSheetBox" tabindex="-1"></div>';
      document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        if (e.target === el) { closeSheet(); return; }   // backdrop / outside the popover
        const box = $('oslSheetBox');
        const a = e.target.closest('[data-act]');
        const closer = e.target.closest('[data-sheet="close"]');
        if (a && box.contains(a)) { const fn = X.actions[a.getAttribute('data-act')]; if (closer) closeSheet(); if (fn) { Promise.resolve().then(() => fn(a, e)).catch((err) => toast((err && err.message) || 'Action failed', 'err')); } return; }
        if (closer) closeSheet();
      });
      // Menus: arrow keys / Home / End move between items (Escape and Tab belong to the overlay key handler).
      el.addEventListener('keydown', (e) => {
        if (!/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key)) return;
        const items = Array.from(el.querySelectorAll('[role=menuitem]')).filter((x) => x.getClientRects().length && !x.disabled);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        e.preventDefault(); items[n].focus();
      });
      el.addEventListener('wheel', (e) => { if (sheetMode === 'pop' && !$('oslSheetBox').contains(e.target)) closeSheet(); }, { passive: true });
    }
    return el;
  }
  function placePop(box, anchor, place) {
    if (typeof core.placePop === 'function') { try { core.placePop(box, anchor, place); return; } catch (_) {} }   // one shared placement (§13 risk 4)
    const a = anchor.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    // layout sizes (offsetWidth/Height), not the rect: the entrance animation scales the box
    const w = box.offsetWidth, h = box.offsetHeight;
    const start = /start$/.test(place || ''), above = /^above/.test(place || '');
    let top = above ? a.top - 8 - h : a.bottom + 8, below = !above;
    if (below && top + h > H - 8 && a.top - 8 - h >= 8) { top = a.top - 8 - h; below = false; }
    else if (!below && top < 8 && a.bottom + 8 + h <= H - 8) { top = a.bottom + 8; below = true; }
    let left = start ? a.left : a.right - w;
    left = Math.max(8, Math.min(left, W - 8 - w)); top = Math.max(8, Math.min(top, H - 8 - h));
    box.style.left = Math.round(left) + 'px'; box.style.top = Math.round(top) + 'px';
    box.style.setProperty('--omx-pop-origin', (below ? 'top ' : 'bottom ') + (start ? 'left' : 'right'));
  }
  function unwatchPop() { if (!popWatch) return; const p = popWatch; popWatch = null; try { if (p.sc) p.sc.removeEventListener('scroll', p.fn); window.removeEventListener('resize', p.fn); } catch (_) {} }
  function sheet(html, opts) {
    opts = opts || {};
    const el = sheetRoot();
    // New content replaces an open sheet: the previous one's onClose still runs (a pending confirm resolves "no").
    if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; try { f(); } catch (_) {} }
    if (sheetAnchor && sheetAnchor !== opts.anchor) { try { sheetAnchor.setAttribute('aria-expanded', 'false'); } catch (_) {} }
    unwatchPop();
    sheetOnClose = opts.onClose || null;
    const mode = sheetModeFor(opts);
    sheetMode = mode; sheetAnchor = mode === 'pop' && opts.anchor ? opts.anchor : null;
    el.className = 'on ' + mode + (opts.wide ? ' wide' : '') + (overUp() ? ' over' : '');
    const box = $('oslSheetBox');
    box.className = 'omx-box' + (opts.boxCls ? ' ' + opts.boxCls : '');
    box.removeAttribute('style');
    const role = opts.role || (opts.menu && mode === 'pop' ? 'menu' : 'dialog');
    box.setAttribute('role', role);
    if (role === 'dialog') box.setAttribute('aria-modal', 'true'); else box.removeAttribute('aria-modal');
    box.innerHTML = (mode === 'sheet' ? '<div class="grab" aria-hidden="true"></div>' : '') + html;
    const h = !opts.labelledby && box.querySelector(':scope > h3, :scope > h2');
    box.removeAttribute('aria-labelledby'); box.removeAttribute('aria-label');
    if (opts.labelledby) box.setAttribute('aria-labelledby', opts.labelledby);
    else if (h) { h.id = 'oslSheetTitle'; box.setAttribute('aria-labelledby', 'oslSheetTitle'); }
    else if (opts.label) box.setAttribute('aria-label', opts.label);
    if (sheetAnchor) {
      try { sheetAnchor.setAttribute('aria-expanded', 'true'); } catch (_) {}
      placePop(box, sheetAnchor, opts.place);
      const fn = () => { if (sheetMode === 'pop') closeSheet(); };
      popWatch = { sc: scroller(), fn };
      try { if (popWatch.sc) popWatch.sc.addEventListener('scroll', fn, { passive: true }); window.addEventListener('resize', fn); } catch (_) {}
    }
    el.classList.add('on'); ovPush(el, closeSheet);
    if (!box.contains(document.activeElement) && !callUp()) {
      const firstItem = opts.menu ? box.querySelector('[role=menuitem]') : null;
      try { (firstItem || box).focus({ preventScroll: true }); } catch (_) {}
    }
  }
  function closeSheet() {
    const el = $('oslSheet'); if (!el || !el.classList.contains('on')) return;
    el.classList.remove('on');
    if (sheetAnchor) { try { sheetAnchor.setAttribute('aria-expanded', 'false'); } catch (_) {} sheetAnchor = null; }
    unwatchPop();
    const f = sheetOnClose; sheetOnClose = null;
    ovPop(el);
    if (f) { try { f(); } catch (_) {} }
  }
  // A menu in the sheet: a popover on desk (no title, a rule before the danger rows), a bottom sheet with a title and
  // a Cancel row on phones. items: [{ ico, label, sub, danger, run }]
  function menu(title, items, opts) {
    opts = opts || {};
    const mode = sheetModeFor(opts);
    items = items.filter(Boolean);
    const rows = items.map((it, i) => (mode !== 'sheet' && it.danger && i > 0 && !items[i - 1].danger ? '<hr>' : '') + `<button type="button" class="omx-mi${it.danger ? ' danger' : ''}" role="menuitem" data-mi="${i}">${it.ico ? icon(it.ico) : ''}${it.sub ? `<span><span class="l">${esc(it.label)}</span><small>${esc(it.sub)}</small></span>` : `<span>${esc(it.label)}</span>`}</button>`).join('');
    const html = mode === 'pop' ? rows : `<h3>${esc(title)}</h3><div class="grp" role="menu" aria-label="${esc(title)}">${rows}</div>${mode === 'sheet' ? '<button type="button" class="omx-cancel" data-sheet="close">Cancel</button>' : ''}`;
    sheet(html, Object.assign({}, opts, { mode, menu: true, label: title, boxCls: opts.boxCls || 'osl-menu' }));
    $('oslSheetBox').querySelectorAll('[data-mi]').forEach((b) => { b.onclick = () => { const it = items[Number(b.getAttribute('data-mi'))]; closeSheet(); if (it && typeof it.run === 'function') { try { const r = it.run(); if (r && r.catch) r.catch((e) => toast(emsg(e), 'err')); } catch (e) { toast(emsg(e), 'err'); } } }; });
  }
  // Confirmation in the sheet (replaces window.confirm): resolves true only on the confirm button.
  // Dialog: Cancel left, the action right. Bottom sheet: stacked, the action on top.
  function askSheet({ title, body, ok, cancel, danger }) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      sheet(`<h3>${esc(title)}</h3>${body ? `<p class="osl-sbody">${esc(body)}</p>` : ''}<div class="omx-askrow"><button type="button" class="omx-ghost" data-ask="0">${esc(cancel || 'Cancel')}</button><button type="button" class="omx-primary${danger ? ' omx-danger' : ''}" data-ask="1">${esc(ok || 'OK')}</button></div>`, { onClose: () => fin(false), boxCls: 'osl-ask' });
      $('oslSheetBox').querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => { fin(b.getAttribute('data-ask') === '1'); closeSheet(); }; });
    });
  }

  /* ---------- lightbox (#oslLight): count + close, the photo within the viewport, 48 px arrows, an info strip ---------- */
  const LB = { items: [], k: 0, info: null };
  function lightbox(p, i) {
    const imgs = (p.media || []).filter((m) => m.kind === 'image'); if (!imgs.length) return;
    openLight(imgs.map((m, j) => ({ src: mediaUrl(m.id), alt: 'Photo ' + (j + 1) + ' of ' + imgs.length })), i, { from: p.author, ts: p.ts, text: p.text || '', postId: p.id });
  }
  function openLight(items, i, info) {
    let el = $('oslLight');
    if (!el) {
      el = document.createElement('div'); el.id = 'oslLight';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photo viewer'); el.tabIndex = -1;
      document.body.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-l]');
        if (!b) { if (e.target === el || e.target.classList.contains('osl-lstage')) closeLight(); return; }   // backdrop closes; the photo itself does not
        const l = b.getAttribute('data-l');
        if (l === 'x') closeLight();
        else if (l === 'open') { const id = LB.info && LB.info.postId; closeLight(); if (id && !(S.view === 'post' && SS.postId === id)) openPost(id); }
        else if (l === 'p' || l === 'n') lbStep(l === 'n' ? 1 : -1);
        else if (l === 'more') lbMenu(b);
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
    LB.items = items; LB.k = Math.min(Math.max(0, i || 0), items.length - 1); LB.info = info || null;
    lbDraw();
    el.classList.toggle('multi', items.length > 1);
    el.classList.add('on');
    ovPush(el, closeLight, (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { lbStep(e.key === 'ArrowRight' ? 1 : -1); return true; } return false; });
    if (!callUp()) { try { el.focus({ preventScroll: true }); } catch (_) {} }
  }
  function lbDraw() {
    const el = $('oslLight'); if (!el) return;
    const n = LB.items.length, k = LB.k, it = LB.items[k], inf = LB.info;
    el.innerHTML = `<div class="osl-ltop">${n > 1 ? `<span class="osl-lcount" aria-live="polite">${k + 1} / ${n}</span>` : ''}<span class="sp"></span>${inf && inf.download ? `<a class="omx-ib" href="${esc(inf.download)}" download aria-label="Download photo">${icon('download')}</a>` : ''}${inf && inf.postId ? `<button type="button" class="omx-ib osl-lmore" data-l="more" aria-label="Photo options" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>` : ''}<button type="button" class="omx-ib" data-l="x" aria-label="Close photo viewer (Esc)">${icon('close')}</button></div>
      <div class="osl-lstage"><img src="${esc(it.src)}" alt="${esc(it.alt || 'Photo')}" draggable="false"></div>
      ${n > 1 ? `<button type="button" class="omx-ib osl-larrow prev" data-l="p" aria-label="Previous photo">${icon('back')}</button><button type="button" class="omx-ib osl-larrow next" data-l="n" aria-label="Next photo">${icon('chevron-right')}</button>` : ''}
      ${inf && (inf.from || inf.who) ? `<div class="osl-linfo">${inf.from ? avatar(inf.from, 'sm') : '<span></span>'}<span class="t"><b>${esc(inf.who || dname(inf.from))}${inf.ts ? ' · ' + esc(ago(inf.ts)) : ''}</b>${inf.text ? `<small>${esc(excerpt(inf.text, 120))}</small>` : ''}</span>${inf.postId ? '<button type="button" class="omx-ghost omx-sm omx-hit" data-l="open">Open post</button>' : '<span></span>'}</div>` : ''}`;
  }
  // ⋯ in the viewer of a post's photos: a popover (desk) / sheet (phone) that sits above the viewer (.over, z 12900).
  function lbMenu(b) {
    const inf = LB.info || {}, id = inf.postId; if (!id) return;
    const items = [{ ico: 'link', label: 'Copy link', run: () => core.copyText(base() + '#post=' + id, 'Link copied') }];
    if (inf.from && inf.from !== me()) items.push({ ico: 'user', label: 'View ' + first(inf.from) + '’s profile', run: () => { closeLight(); openProfile(inf.from); } });
    items.push({ ico: 'reply', label: 'Open post', run: () => { closeLight(); if (!(S.view === 'post' && SS.postId === id)) openPost(id); } });
    menu('Photo options', items, { anchor: b });
  }
  function lbStep(d) {
    const n = LB.items.length; if (n < 2) return;
    const el = $('oslLight'), had = el && document.activeElement && el.contains(document.activeElement) ? document.activeElement.getAttribute('data-l') : null;
    LB.k = (LB.k + d + n) % n; lbDraw();
    // keep keyboard focus on the button that was used (the redraw replaced it)
    const again = had && el.querySelector('[data-l="' + had + '"]'); try { (again || el).focus({ preventScroll: true }); } catch (_) {}
  }
  function closeLight() { const el = $('oslLight'); if (!el || !el.classList.contains('on')) return; el.classList.remove('on'); el.innerHTML = ''; ovPop(el); }

  /* ---------- sharing + site navigation ---------- */
  const base = () => location.origin + location.pathname;
  function sharePost(id, anchor) {
    const p = findPost(id); const url = base() + '#post=' + id;
    const contacts = Object.values(S.contacts).filter((c) => c.state === 'friend').slice(0, 6);
    // Both sides show the same text. A first attempt that fails on the network stays in the core's outbox and is retried.
    const msg = '📣 ' + (p && p.text ? '“' + p.text.slice(0, 120) + '” ' : '') + url;
    const sendTo = (to) => core.sendInner(to, { k: 'text', text: msg }, { kind: 'text', text: msg }).then(() => toast('Sent to ' + dname(to), 'ok')).catch((e) => toast(e && e.transient ? 'Not delivered to ' + dname(to) + ' yet — it sends automatically.' : emsg(e, 'Could not send'), e && e.transient ? '' : 'err'));
    menu('Share post', [
      { ico: 'link', label: 'Copy link', run: () => core.copyText(url, 'Link copied') },
      navigator.share ? { ico: 'share', label: 'Share…', run: () => navigator.share({ title: 'OST Mesh', text: (p && p.text ? p.text.slice(0, 80) + ' — ' : '') + 'on OST Mesh', url }).catch(() => {}) } : null,
      ...contacts.map((c) => ({ ico: 'send', label: 'Send to ' + (c.name || shortA(c.addr)), sub: 'Private, end-to-end encrypted', run: () => sendTo(c.addr) }))
    ], { anchor });
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
  function compose(opts) { opts = opts || {}; SS.draft = { text: opts.text || '', media: [], embed: opts.embed || null, busy: '' }; whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); if (isPhone()) go('compose'); else openComposer(); }); }
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
  // added one); the in-app Back going back past that screen removes the step again, silently.
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
  // After a trade: offer (never auto-post) to share it — a toast with one real action.
  let lastOffer = 0;
  function actionToast(text, btn, fn) { toast(text, 'ok', { action: { label: btn, run: fn } }); }
  // Only for a bet that really exists: an optimistic wallet stake is still
  // confirming (and may yet fail), so it is offered on ...-confirmed instead.
  function offerShare() {
    if (Date.now() - lastOffer < 10 * 60 * 1000) return; lastOffer = Date.now();
    setTimeout(() => actionToast('Bet placed — share it on OST Mesh?', 'Share', () => { const opts = attachOptions().filter((x) => x.kind === 'bet'); compose({ embed: opts[0] || null }); }), 1200);
  }
  window.addEventListener('ost:prediction-order-recorded', (ev) => {
    const d = (ev && ev.detail) || {};
    if (d.pending || d.optimistic || /pending|confirming|funding/i.test(String(d.fundingState || ''))) return;
    offerShare();
  });
  window.addEventListener('ost:prediction-order-confirmed', () => offerShare());
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
    paintBell(); paintNav();
    const who = dname(n.from);
    const text = n.kind === 'like' ? who + ' liked your post' : n.kind === 'comment' ? who + ' commented on your post' : n.kind === 'follow' ? who + ' followed you' : n.kind === 'tip' ? who + ' tipped you ' + fmtAmt(n.amount) + ' ' + n.ccy : 'New activity';
    const run = () => { whenReady(() => { if (!core.isOpen()) core.open('feed'); if (n.postId) openPost(n.postId); else if (n.from) openProfile(n.from); }); };
    toast(text, '', { avatar: n.from, action: { label: 'View', run } });
    if (!SS.users[n.from]) getJ('/mesh/v1/social/user?addr=' + encodeURIComponent(n.from)).then((j) => absorb({ [n.from]: j.user })).catch(() => {});
  });
  // No socket (strict networks): refresh alerts every 45s while the app is open.
  setInterval(() => { if (!document.hidden && core.isOpen() && !S.wsOk) loadNotifs(); }, 45000);

  /* ---------- registration ---------- */
  core.register('feed', { tab: { ico: 'home', lbl: 'Home', order: 10, home: true }, hideHead: true, render: renderFeed });
  core.register('me', { tab: { ico: 'user', lbl: 'Me', railLbl: 'Profile', order: 40, avatar: true }, render: (ctx) => renderProfile(ctx, true) });
  core.register('profile', { parent: 'feed', render: (ctx) => renderProfile(ctx, false) });
  core.register('post', { parent: 'feed', render: renderPostView });
  core.register('compose', { parent: 'feed', noTabs: true, render: renderCompose });
  core.register('notifs', { parent: 'feed', rail: { ico: 'bell', lbl: 'Alerts', order: 25 }, render: renderNotifs });
  core.register('search', { parent: 'feed', render: renderSearch });
  core.register('edit', { parent: 'me', render: renderEdit });
  X.badges.notifs = () => SS.notifs.unread;
  X.attach.push({ ico: 'coin', lbl: 'Send OST', sub: 'Devnet transfer from your wallet', tile: 1, run: (peer) => paySheet({ addr: peer, chat: true }) });
  // Right-column modules (desk feed layout). The core adds the search pill, Friends' activity and the devnet footer.
  const SOCIAL_VIEWS = ['feed', 'post', 'notifs', 'search', 'profile', 'me', 'edit'];
  if (!Array.isArray(X.aside)) X.aside = [];
  X.aside.push(
    { id: 'guide', order: 5, views: SOCIAL_VIEWS, render: () => guideHtml(false) },
    { id: 'peerchat', order: 5, views: ['profile'], render: () => peerChatHtml() },
    { id: 'stories', order: 10, views: ['feed', 'post', 'notifs', 'search'], render: () => storiesModHtml() },
    { id: 'who', order: 30, views: SOCIAL_VIEWS, render: () => whoHtml() }
  );
  X.compose = () => { whenReady(() => { if (!SS.draft) SS.draft = { text: '', media: [], embed: null, busy: '' }; openComposer(); }); };
  // Chat photos open in the same viewer (single image, Download in the top bar).
  X.viewer = (item) => {
    if (!item || !item.src) return;
    // the core passes the sender's display name (or an address): find the person for the avatar when it can
    let from = String(item.from || ''), who = '';
    if (from && !/^ost-mesh:/i.test(from)) { who = from; from = from === core.myName() ? me() : (S.peer && core.nameOf(S.peer) === from ? S.peer : ''); }
    openLight([{ src: item.src, alt: item.alt || 'Photo' }], 0, { from, who, ts: item.ts || 0, text: '', download: item.download || '' });
  };

  const A = X.actions;
  A['sx-back'] = back;
  // Switching For you / Following starts from a skeleton: the other mode's posts never sit under the new tab.
  A['sx-mode'] = (el) => {
    const m = el.getAttribute('data-m'); if (m === SS.mode && SS.loaded) return;
    const hadFocus = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.osl-feedtabs'));
    SS.mode = m; core.lsSet('ost.social.mode', SS.mode); SS.posts = []; SS.cursor = null; SS.loaded = false; SS.newPosts = 0; loadFeed(true); core.render();
    if (hadFocus) { const t = document.querySelector('#ostMeshApp .osl-feedtabs [aria-selected="true"]'); if (t) { try { t.focus({ preventScroll: true }); } catch (_) {} } }
  };
  A['sx-refresh'] = () => { loadFeed(true); loadStories(); };
  A['sx-more'] = () => loadFeed(false);
  A['sx-stories-retry'] = () => loadStories();
  A['sx-stories-all'] = () => { const g = SS.stories.find((x) => x.author !== me() && x.items.some((s) => !s.seen)) || SS.stories[0]; if (g) openStories(g.author); };
  A['sx-retry-now'] = (el) => { const act = el.getAttribute('data-r'); delete AUTO[act]; const fn = act && A[act]; if (fn) fn(el); };
  A['sx-retry-post'] = () => { if (SS.postId) { loadSingle(SS.postId); loadComments(SS.postId); } };
  A['sx-retry-comments'] = () => { if (SS.postId) loadComments(SS.postId); };
  A['sx-retry-profile'] = () => { const a = SS.profileOf; if (!a) return; SS.profileUser = SS.profileUser && SS.profileUser.err ? null : SS.profileUser; SS.profilePostsErr = ''; SS.profileAt = Date.now(); paintProfile(); loadProfile(a); };
  A['sx-retry-notifs'] = () => { SS.notifsErr = ''; paintNotifs(); loadNotifs(true); };
  A['sx-retry-search'] = () => runSearch();
  A['sx-fl-retry'] = () => { if (SS.flDir) followList(SS.flDir); };
  A['sx-mretry'] = (el) => {
    const d = el.closest('.osl-mfail'), n = d && d.__orig; if (!n) return;
    const src = String(n.getAttribute('src') || '').replace(/[?&]r=\d+$/, '');
    d.replaceWith(n);
    if (n.tagName === 'IMG') n.setAttribute('src', src + (src.includes('?') ? '&' : '?') + 'r=' + Date.now());
  };
  A['sx-vplay'] = (el) => { const box = el.closest('.osl-vid'); const v = box && box.querySelector('video'); if (!v) return; v.__userPaused = false; v.controls = true; v.muted = false; const mb = box.querySelector('.osl-vmute'); if (mb) { mb.setAttribute('aria-pressed', 'true'); mb.setAttribute('aria-label', 'Mute'); mb.innerHTML = icon('volume'); } v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); };
  A['sx-vmute'] = (el) => { const box = el.closest('.osl-vid'); const v = box && box.querySelector('video'); if (!v) return; v.muted = !v.muted; el.setAttribute('aria-pressed', String(!v.muted)); el.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute'); el.innerHTML = icon(v.muted ? 'volume-off' : 'volume'); };
  A['sx-compose'] = (el, e) => {
    if (!SS.draft) SS.draft = { text: '', media: [], embed: null, busy: '' };
    const pick = e && e.target && e.target.closest ? e.target.closest('[data-cta]') : null;
    if (isPhone()) { go('compose'); return; }
    openComposer();
    // the prompt's shortcuts: open the composer and its picker in the same tap (the browser needs the user gesture)
    if (pick) { const k = pick.getAttribute('data-cta'); if (k === 'img' || k === 'vid') { const inp = cq(k === 'img' ? '#oslPickImg' : '#oslPickVid'); if (inp) inp.click(); } else if (k === 'ost') A['sx-attach'](); }
  };
  A['sx-publish'] = publish;
  A['sx-pick-img'] = () => { const i = cq('#oslPickImg'); if (i) i.click(); };
  A['sx-pick-vid'] = () => { const i = cq('#oslPickVid'); if (i) i.click(); };
  A['sx-unpick'] = (el) => { const i = Number(el.getAttribute('data-i')); const m = SS.draft.media.splice(i, 1)[0]; try { URL.revokeObjectURL(m.url); } catch (_) {} paintPicks(); };
  A['sx-unembed'] = () => { SS.draft.embed = null; paintEmbed(); };
  A['sx-attach'] = () => {
    const el = cq('#oslAttachList'); if (!el) return;
    const btn = cq('[data-act="sx-attach"]');
    if (!el.hidden) { el.hidden = true; el.innerHTML = ''; if (btn) btn.setAttribute('aria-expanded', 'false'); return; }
    const opts = attachOptions();
    el.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true');
    el.innerHTML = opts.length ? '<p class="osl-attnote">Attach from OST</p>' + opts.map((o, i) => `<div class="osl-attopt" data-i="${i}">${embedHtml(o)}</div>`).join('') : '<p class="osl-attnote">Open a market, place a bet, open a perp or connect a wallet to attach it here.</p>';
    el.querySelectorAll('.osl-attopt').forEach((d) => { d.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); SS.draft.embed = opts[Number(d.getAttribute('data-i'))]; const ta = cq('#oslText'); if (ta) SS.draft.text = ta.value; el.hidden = true; el.innerHTML = ''; if (btn) btn.setAttribute('aria-expanded', 'false'); paintEmbed(); }, true); });
  };
  A['sx-like'] = (el) => react(el.getAttribute('data-p'), 'like');
  A['sx-dislike'] = (el) => react(el.getAttribute('data-p'), 'dislike');
  A['sx-open'] = (el) => { const p = el.getAttribute('data-p'); if (p) openPost(p); else openProfile(el.getAttribute('data-a')); };
  A['sx-comment'] = sendComment;
  A['sx-cmenu'] = (el) => {
    const cid = el.getAttribute('data-c');
    menu('Reply', [{ ico: 'trash', label: 'Delete reply', danger: true, run: async () => {
      try { const r = await signed('POST', '/mesh/v1/social/comment/delete', { from: me(), postId: SS.postId, cid }); SS.comments[SS.postId] = (SS.comments[SS.postId] || []).filter((c) => c.id !== cid); const p = findPost(SS.postId); if (p) updatePost(Object.assign({}, p, { comments: r && r.comments != null ? r.comments : Math.max(0, (p.comments || 1) - 1) })); paintComments(); toast('Reply deleted', 'ok'); } catch (e) { toast(emsg(e), 'err'); }
    } }], { anchor: el });
  };
  A['sx-cdel'] = A['sx-cmenu'];
  A['sx-tip'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (!p) return; if (p.author === me()) { toast('You cannot tip your own post.'); return; } paySheet({ addr: p.author, postId: p.id }); };
  A['sx-share'] = (el) => sharePost(el.getAttribute('data-p'), el);
  // Post ⋯: Copy link · View <name>'s profile · Show less like this · (rule) Hide posts from <name>; own post: Copy link ·
  // Delete post. A popover under ⋯ on desk, a bottom sheet with Cancel on phones.
  A['sx-menu'] = (el) => {
    const p = findPost(el.getAttribute('data-p')); if (!p) return;
    const mine = p.author === me(), fn = first(p.author);
    const copy = { ico: 'link', label: 'Copy link', run: () => core.copyText(base() + '#post=' + p.id, 'Link copied') };
    const items = mine ? [copy, { ico: 'trash', label: 'Delete post', danger: true, run: async () => {
      if (!(await askSheet({ title: 'Delete this post?', body: 'It is removed for everyone, with its replies. This cannot be undone.', ok: 'Delete post', danger: true }))) return;
      try { await signed('POST', '/mesh/v1/social/delete', { from: me(), postId: p.id }); SS.posts = SS.posts.filter((x) => x.id !== p.id); if (SS.profilePosts) SS.profilePosts = SS.profilePosts.filter((x) => x.id !== p.id); toast('Post deleted', 'ok'); if (S.view === 'post') back(); else core.render(); } catch (e) { toast(emsg(e), 'err'); }
    } }] : [copy,
      { ico: 'user', label: 'View ' + fn + '’s profile', run: () => openProfile(p.author) },
      { ico: 'thumbs-down', label: p.my === 'dislike' ? 'Undo “Show less like this”' : 'Show less like this', run: async () => { const r = await react(p.id, 'dislike'); if (r) toast(r.my === 'dislike' ? 'Noted — you marked this post “show less”' : 'Undone', 'ok'); } },
      { ico: 'eye-off', label: 'Hide posts from ' + fn, danger: true, run: async () => {
        const who = dname(p.author);
        if (!(await askSheet({ title: 'Hide ' + who + '?', body: 'Their posts and stories disappear from your feed, and they are blocked from messaging you in OST Mesh.', ok: 'Hide ' + who, danger: true }))) return;
        core.upsertContact(p.author, { state: 'blocked' }); signed('POST', '/mesh/v1/friend/respond', { wallet: me(), other: p.author, action: 'block' }).catch(() => {}); toast(who + ' is hidden', 'ok'); core.render();
      } }];
    menu('Post by ' + dname(p.author), items, { anchor: el });
  };
  // Profile ⋯ (desk: next to the buttons; phone: in the header).
  A['sx-pmenu'] = (el) => {
    const a = el.getAttribute('data-a') || SS.profileOf; if (!a) return;
    if (a === me()) { menu('Your profile', [{ ico: 'pen', label: 'New post', run: () => A['sx-compose']() }, { ico: 'plus', label: 'New story', run: () => storyPicker().click() }, { ico: 'copy', label: 'Copy my address', run: () => core.copyText(a, 'Address copied') }], { anchor: el }); return; }
    const c = core.contact(a), fn = first(a);
    const wallet = user(a).wallet;
    menu(dname(a), [
      c && c.state === 'friend' && window.OST_MESH_CALL ? { ico: 'video', label: 'Video call', run: () => OST_MESH_CALL.start(a, true) } : null,
      wallet ? { ico: 'coin', label: 'Send OST', sub: 'Devnet transfer from your wallet', run: () => paySheet({ addr: a, chat: !!core.contact(a) }) } : null,
      { ico: 'link', label: 'Copy profile link', run: () => core.copyText(base() + '#u=' + a, 'Link copied') },
      { ico: 'copy', label: 'Copy ' + fn + '’s address', run: () => core.copyText(a, 'Address copied') }
    ], { anchor: el });
  };
  A['sx-copy-addr'] = (el) => { const a = el.getAttribute('data-a'); if (a) core.copyText(a, 'Address copied'); };
  A['sx-lightbox'] = (el) => { const p = findPost(el.getAttribute('data-p')); if (p) lightbox(p, Number(el.getAttribute('data-i')) || 0); };
  A['sx-embed'] = (el) => navTo(el.getAttribute('data-href'));
  A['sx-profile'] = (el) => openProfile(el.getAttribute('data-a'));
  A['sx-follow'] = async (el) => {
    const a = el.getAttribute('data-a'), on = el.getAttribute('data-on') === '1'; el.disabled = true;
    try {
      if (!S.announced) await core.announce();
      await signed('POST', '/mesh/v1/social/follow', { from: me(), to: a, on });
      SS.follow[a] = on;
      if (SS.profileUser && SS.profileUser.user && SS.profileUser.user.addr === a) { SS.profileUser.iFollow = on; SS.profileUser.counts = SS.profileUser.counts || {}; SS.profileUser.counts.followers = Math.max(0, (SS.profileUser.counts.followers || 0) + (on ? 1 : -1)); }
      if (SS.meCounts) SS.meCounts.following = Math.max(0, (Number(SS.meCounts.following) || 0) + (on ? 1 : -1));
      paintProfile(); paintAside('who'); paintGuide();
      toast(on ? 'Following ' + dname(a) : 'Unfollowed ' + dname(a), 'ok');
    } catch (e) { toast(emsg(e), 'err'); el.disabled = false; }
  };
  A['sx-message'] = async (el) => { const a = el.getAttribute('data-a'); const c = core.contact(a); S.backTo = S.view; if (c && (c.state === 'friend' || c.state === 'pending-out' || c.state === 'request')) core.openChat(a); else await core.addPerson({ addr: a, name: user(a).name, emoji: user(a).emoji }); };
  A['sx-call'] = (el) => { const a = el.getAttribute('data-a'); if (window.OST_MESH_CALL) OST_MESH_CALL.start(a, el.getAttribute('data-v') === '1'); };
  A['sx-send'] = (el) => paySheet({ addr: el.getAttribute('data-a'), chat: !!core.contact(el.getAttribute('data-a')) });
  A['sx-edit'] = () => { SS.edit = null; go('edit'); };   // a fresh draft from the saved profile
  // Picking an emoji only marks the choice in place — the form is never redrawn, so typed name/bio stay put (B1).
  A['sx-emoji'] = (el) => {
    const d = SS.edit; if (!d) return;
    d.emoji = el.getAttribute('data-e');
    const box = el.parentNode; if (box) box.querySelectorAll('[data-act="sx-emoji"]').forEach((b) => { const on = b === el; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    if (!S.profile.avatar) setGlyph($('oslEditAv'), d.emoji);
  };
  A['sx-fr-emoji'] = (el) => {
    SS.frEmoji = el.getAttribute('data-e');
    const box = el.parentNode; if (box) box.querySelectorAll('[data-act="sx-fr-emoji"]').forEach((b) => { const on = b === el; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    setGlyph($('oslFrAv'), SS.frEmoji);
  };
  A['sx-fr-save'] = async (el) => {
    const nm = $('oslFrName'); const raw = nm ? nm.value : '', name = cleanName(raw);
    let err = $('oslFrErr');
    if (!err && nm) { err = document.createElement('small'); err.className = 'err'; err.id = 'oslFrErr'; err.setAttribute('role', 'alert'); err.hidden = true; nm.parentNode.appendChild(err); nm.setAttribute('aria-describedby', 'oslFrH oslFrErr'); nm.addEventListener('input', () => fieldError('oslFrName', 'oslFrErr', ''), { once: true }); }
    if (!name) { fieldError('oslFrName', 'oslFrErr', raw.trim() ? 'Names cannot use < or > — add some letters.' : 'Add a name — it is how people find and recognise you.'); try { nm.focus(); } catch (_) {} return; }
    el.disabled = true; el.classList.add('is-loading'); el.setAttribute('aria-busy', 'true');
    try {
      const p = await core.saveProfile({ name, emoji: SS.frEmoji || S.profile.emoji || '' });
      if (p) absorb({ [me()]: p });
      SS.frDone = true; core.lsSet(FR_K, true);
      toast('Profile saved', 'ok'); core.render(); paintGuide();
    } catch (e) { el.disabled = false; el.classList.remove('is-loading'); el.removeAttribute('aria-busy'); toast(emsg(e, 'Could not save your profile.'), 'err'); }
  };
  A['sx-guide-hide'] = () => { core.lsSet(GUIDE_K, 'done'); paintGuide(); };
  A['sx-save'] = async (el) => {
    const d = SS.edit || {}; const nm = $('oslName'), bio = $('oslBio');
    if (nm) d.name = nm.value; if (bio) d.bio = bio.value;
    const name = cleanName(d.name);
    if (!name) { fieldError('oslName', 'oslNameErr', String(d.name || '').trim() ? 'Names cannot use < or > — add some letters.' : 'Add a name — it is how people find and recognise you.'); try { nm.focus(); } catch (_) {} return; }
    el.disabled = true; el.classList.add('is-loading'); el.setAttribute('aria-busy', 'true');
    try {
      const p = await core.saveProfile({ name, bio: String(d.bio || '').trim(), emoji: d.emoji || '' });
      if (p) absorb({ [me()]: p });
      SS.edit = null; SS.frDone = true; core.lsSet(FR_K, true); toast('Profile saved', 'ok'); if (S.view === 'edit') back();
    } catch (e) { el.disabled = false; el.classList.remove('is-loading'); el.removeAttribute('aria-busy'); toast(emsg(e, 'Could not save your profile.'), 'err'); }
  };
  A['sx-avatar-pick'] = () => avatarPicker().click();
  A['sx-avatar-clear'] = async () => { try { await core.saveProfile({ avatar: '' }); S.profile.avatar = ''; absorb({ [me()]: { avatar: '' } }); if (S.view === 'edit') core.render(); toast('Photo removed', 'ok'); } catch (e) { toast(emsg(e), 'err'); } };
  A['sx-link'] = linkWallet;
  A['sx-unlink'] = async () => {
    if (!(await askSheet({ title: 'Unlink this wallet?', body: 'People will not be able to tip you until you link a wallet again.', ok: 'Unlink wallet', danger: true }))) return;
    try { await signed('POST', '/mesh/v1/social/profile', { from: me(), unlinkWallet: true }); S.profile.wallet = ''; core.lsSet(core.K.profile, S.profile); absorb({ [me()]: { wallet: '', walletVerified: false } }); toast('Wallet unlinked', 'ok'); core.render(); } catch (e) { toast(emsg(e), 'err'); }
  };
  A['sx-settings'] = () => { const d = SS.stack.length; SS.stack.push(S.view === 'me' ? 'me' : S.view); core.go('settings'); linkStep(d, false); };
  // The colon stays literal: the link opens on any device (the hash is also decoded before matching, for older links).
  A['sx-share-me'] = () => { const url = base() + '#u=' + me(); if (navigator.share) navigator.share({ title: 'Follow me on OST Mesh', url }).catch(() => {}); else core.copyText(url, 'Profile link copied'); };
  A['sx-list'] = (el) => followList(el.getAttribute('data-dir'));
  A['sx-notifs'] = () => go('notifs');
  A['sx-search'] = () => go('search');
  A['sx-story'] = (el) => openStories(el.getAttribute('data-a'));
  A['sx-story-add'] = () => storyPicker().click();

  window.OST_SOCIAL = { open, compose, marketEmbed, share: (embed, text) => compose({ embed, text }), profile: (a) => whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); openProfile(a); }), post: (id) => whenReady(() => { SS.stack = []; dropLinks(); core.open('feed'); openPost(id); }), pay: payTo, refresh: () => { SS.loadedAt = Date.now(); loadFeed(true); loadStories(); loadNotifs(true); }, state: () => ({ posts: SS.posts.length, stories: SS.stories.length, unread: SS.notifs.unread, view: S.view }) };
  handleHash();   // every route waits for the identity itself
  // Warm the alert badge once identity is up (one request; opening the feed within 30 s reuses it).
  whenReady(() => setTimeout(() => loadNotifs(), 2500));
})();
