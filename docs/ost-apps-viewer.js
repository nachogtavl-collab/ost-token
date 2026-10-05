/* ==========================================================================
 * OST · Apps viewer — open apps deployed from OST Studio inside OST
 * --------------------------------------------------------------------------
 * `#app=<slug>` on index.html / markets.html opens the app in a full-screen
 * in-page window: a title bar (name + author from the Studio apps API, best
 * effort), Open in new tab, Share on OST Mesh, Close — and the app itself in
 * an iframe pointed at https://ost-apps.nachogtavl.workers.dev/<slug>/.
 *
 * The app lives on a DIFFERENT origin (ost-apps…workers.dev), so
 * `allow-same-origin` only gives it its own origin: it can never read this
 * page's storage (wallet keys) or script it. No allow-top-navigation, so an
 * app cannot navigate OST away either.
 *
 * window.OST_APPS = { open(slug), close(), current() }
 * Back button / hash change closes it; opening from code pushes `#app=<slug>`
 * (so Back closes it on phones); Close drops the hash so a reload stays closed.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_APPS) return;

  var API = String(window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
  var APPS = 'https://ost-apps.nachogtavl.workers.dev';
  var SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
  var SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock';
  // Never delegate camera/mic/location: grants are keyed to the top-level OST origin, so an untrusted
  // app would inherit them silently. Apps that need devices use "Open in new tab" (their own origin).
  var ALLOW = 'clipboard-write; fullscreen';
  var META_TIMEOUT = 8000, SLOW_AFTER = 15000;

  var st = { slug: '', open: false, gen: 0, name: '', author: '', authorPlain: '', desc: '', prevFocus: null, ctl: null, slowT: 0 };
  var root = null, els = {};

  function slugFromHash() {
    var m = /^#app=([^&?#\/]+)\/?$/.exec(String(location.hash || ''));
    if (!m) return '';
    var s = '';
    try { s = decodeURIComponent(m[1]); } catch (_) { s = m[1]; }
    return String(s).trim().toLowerCase();
  }
  function appUrl(slug) { return APPS + '/' + encodeURIComponent(slug) + '/'; }
  function shortAddr(a) { a = String(a || '').replace(/^ost-mesh:/, ''); return a ? a.slice(0, 9) + (a.length > 9 ? '…' : '') : ''; }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function btn(cls, ico, txt, title) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'oav-btn' + (cls ? ' ' + cls : '');
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    var i = document.createElement('span'); i.setAttribute('aria-hidden', 'true'); i.textContent = ico; b.appendChild(i);
    if (txt) { var t = document.createElement('span'); t.className = 'oav-txt'; t.textContent = txt; b.appendChild(t); }
    return b;
  }

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'ostAppsViewer';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'oavName');
    root.tabIndex = -1;   // focus target on open (Escape works without a focus ring on Close)

    var bar = document.createElement('div'); bar.className = 'oav-bar';
    var ico = document.createElement('span'); ico.className = 'oav-ico'; ico.setAttribute('aria-hidden', 'true'); ico.textContent = '🧩';
    var meta = document.createElement('div'); meta.className = 'oav-meta';
    els.name = document.createElement('h2'); els.name.className = 'oav-name'; els.name.id = 'oavName';
    els.by = document.createElement('div'); els.by.className = 'oav-by';
    meta.appendChild(els.name); meta.appendChild(els.by);

    var acts = document.createElement('div'); acts.className = 'oav-acts';
    els.newTab = document.createElement('a');
    els.newTab.className = 'oav-btn';
    els.newTab.target = '_blank';
    els.newTab.rel = 'noopener noreferrer';
    els.newTab.title = 'Open in new tab';
    els.newTab.setAttribute('aria-label', 'Open in new tab');
    els.newTab.innerHTML = '<span aria-hidden="true">↗</span><span class="oav-txt">Open in new tab</span>';
    els.share = btn('', '📣', 'Share', 'Share on OST Mesh');
    els.close = btn('oav-close', '✕', 'Close', 'Close app');
    acts.appendChild(els.newTab); acts.appendChild(els.share); acts.appendChild(els.close);

    bar.appendChild(ico); bar.appendChild(meta); bar.appendChild(acts);

    els.stage = document.createElement('div'); els.stage.className = 'oav-stage';
    els.status = document.createElement('div'); els.status.className = 'oav-status'; els.status.setAttribute('role', 'status');
    els.stage.appendChild(els.status);

    root.appendChild(bar); root.appendChild(els.stage);
    document.body.appendChild(root);

    els.close.addEventListener('click', function () { close(); });
    els.share.addEventListener('click', share);
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  }

  /* ---------- status overlay ---------- */
  function setStatus(kind, title, text, actions) {
    var s = els.status;
    clearTimeout(st.slowT);
    s.setAttribute('data-kind', kind || '');
    if (!kind) { s.hidden = true; s.className = 'oav-status'; s.innerHTML = ''; return; }
    s.hidden = false;
    s.className = 'oav-status' + (kind === 'slow' ? ' oav-slow' : '');
    s.innerHTML = '';
    if (kind === 'loading' || kind === 'slow') { var sp = document.createElement('div'); sp.className = 'oav-spin'; sp.setAttribute('aria-hidden', 'true'); s.appendChild(sp); }
    if (title) { var h = document.createElement('h3'); h.textContent = title; s.appendChild(h); }
    if (text) { var p = document.createElement('p'); p.textContent = text; s.appendChild(p); }
    if (actions && actions.length) {
      var row = document.createElement('div'); row.className = 'oav-row';
      actions.forEach(function (a) {
        var el;
        if (a.href) { el = document.createElement('a'); el.href = a.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; el.className = 'oav-btn' + (a.primary ? ' oav-primary' : ''); el.textContent = a.label; }
        else { el = document.createElement('button'); el.type = 'button'; el.className = 'oav-btn' + (a.primary ? ' oav-primary' : ''); el.textContent = a.label; el.addEventListener('click', a.run); }
        row.appendChild(el);
      });
      s.appendChild(row);
    }
  }

  function paintMeta() {
    els.name.textContent = st.name || st.slug;
    els.by.textContent = st.author ? 'OST app by ' + st.author : 'OST app · ' + st.slug;
    els.name.title = st.desc || st.name || st.slug;
  }

  /* ---------- the app frame ---------- */
  function mountFrame(gen) {
    removeFrame();
    var f = document.createElement('iframe');
    f.className = 'oav-frame';
    f.setAttribute('sandbox', SANDBOX);
    f.setAttribute('allow', ALLOW);
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'OST app: ' + st.slug);
    f.addEventListener('load', function () {
      if (gen !== st.gen || !st.open) return;
      clearTimeout(st.slowT);
      var k = els.status.getAttribute('data-kind');
      if (k === 'loading' || k === 'slow') setStatus(null);
    });
    f.src = appUrl(st.slug);
    els.stage.appendChild(f);
    els.frame = f;
    setStatus('loading', 'Opening ' + (st.name || st.slug) + '…', '');
    st.slowT = setTimeout(function () {
      if (gen !== st.gen || !st.open || els.status.getAttribute('data-kind') !== 'loading') return;
      setStatus('slow', '', 'Still loading — the app may be large or offline.', [{ label: 'Open in new tab', href: appUrl(st.slug) }]);
    }, SLOW_AFTER);
  }
  function removeFrame() {
    if (!els.frame) return;
    try { els.frame.src = 'about:blank'; } catch (_) {}
    els.frame.remove();
    els.frame = null;
  }

  /* ---------- metadata (best effort) ---------- */
  function loadMeta(gen) {
    if (st.ctl) { try { st.ctl.abort(); } catch (_) {} }
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    st.ctl = ctl;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, META_TIMEOUT);
    fetch(API + '/studio/v1/apps/' + encodeURIComponent(st.slug), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        clearTimeout(to);
        if (gen !== st.gen || !st.open) return;
        var app = x.j && x.j.app;
        if (x.r.ok && app && typeof app === 'object') {
          var prof = app.profile && typeof app.profile === 'object' ? app.profile : null;
          st.name = clip(app.name || st.slug, 80);
          st.desc = clip(app.description || '', 280);
          var who = prof && prof.name ? clip(prof.name, 32) : shortAddr(app.owner);
          st.author = who ? ((prof && prof.emoji ? clip(prof.emoji, 8) + ' ' : '') + who) : '';
          st.authorPlain = who;
          paintMeta();
          return;
        }
        if (x.r.status === 404 && x.j && x.j.error === 'app_not_found') {
          removeFrame();
          setStatus('gone', 'App not found', '“' + st.slug + '” isn’t published on OST — it may have been unpublished, or the link has a typo.', [
            { label: 'Browse OST apps', href: APPS + '/', primary: true },
            { label: 'Close', run: function () { close(); } }
          ]);
        }
      })
      .catch(function () { clearTimeout(to); /* best effort: the app itself still loads */ });
  }

  /* ---------- open / close ---------- */
  function open(slug, opts) {
    opts = opts || {};
    slug = String(slug == null ? '' : slug).trim().toLowerCase();
    build();
    if (!SLUG_RE.test(slug)) {
      st.gen++;
      st.slug = ''; st.name = 'Broken app link'; st.author = ''; st.authorPlain = ''; st.desc = '';
      showRoot({ fromHash: true });
      removeFrame();
      els.name.textContent = 'Broken app link';
      els.by.textContent = 'OST apps';
      els.newTab.hidden = true; els.share.hidden = true;
      setStatus('gone', 'This app link is not valid', 'App names use lowercase letters, numbers and dashes (3–40 characters).', [
        { label: 'Browse OST apps', href: APPS + '/', primary: true },
        { label: 'Close', run: function () { close(); } }
      ]);
      return false;
    }
    if (st.open && st.slug === slug) { showRoot(opts); return true; }
    st.gen++;
    var gen = st.gen;
    st.slug = slug; st.name = slug; st.author = ''; st.authorPlain = ''; st.desc = '';
    showRoot(opts);
    els.newTab.hidden = false; els.share.hidden = false;
    els.newTab.href = appUrl(slug);
    paintMeta();
    mountFrame(gen);
    loadMeta(gen);
    try { window.dispatchEvent(new CustomEvent('ost:apps:open', { detail: { slug: slug } })); } catch (_) {}
    return true;
  }

  function showRoot(opts) {
    var wasOpen = st.open;
    st.open = true;
    root.hidden = false;
    document.documentElement.classList.add('oav-lock');
    if (!wasOpen) {
      st.prevFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      setTimeout(function () { try { root.focus({ preventScroll: true }); } catch (_) {} }, 30);
    }
    // Opening from code gets its own history entry, so the phone's Back button closes the
    // app; switching apps while one is open (or a deep link) never stacks extra entries.
    var want = '#app=' + st.slug;
    if (!opts.fromHash && st.slug && location.hash !== want) {
      try {
        if (wasOpen || slugFromHash()) history.replaceState(history.state, '', location.pathname + location.search + want);
        else history.pushState({ ostApp: st.slug }, '', location.pathname + location.search + want);
      } catch (_) {}
    }
  }

  function close(opts) {
    opts = opts || {};
    if (!st.open) return false;
    st.open = false;
    st.gen++;
    clearTimeout(st.slowT);
    if (st.ctl) { try { st.ctl.abort(); } catch (_) {} st.ctl = null; }
    removeFrame();
    setStatus(null);
    if (root) root.hidden = true;
    document.documentElement.classList.remove('oav-lock');
    var slug = st.slug;
    // Drop the hash so a reload doesn't reopen the app. (Not history.back(): the app's own
    // in-frame navigations share the joint session history, so "back" could land inside it.)
    if (!opts.fromHash && slugFromHash()) { try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {} }
    var pf = st.prevFocus; st.prevFocus = null;
    if (pf && document.contains(pf)) { try { pf.focus({ preventScroll: true }); } catch (_) {} }
    try { window.dispatchEvent(new CustomEvent('ost:apps:close', { detail: { slug: slug } })); } catch (_) {}
    return true;
  }

  /* ---------- share ---------- */
  function shareUrl() { return location.origin + location.pathname + '#app=' + st.slug; }
  function share() {
    if (!st.slug) return;
    var embed = { kind: 'app', title: st.name || st.slug, sub: st.authorPlain ? 'OST app by ' + st.authorPlain : 'OST app', href: '#app=' + st.slug };
    var S = window.OST_SOCIAL;
    if (S && typeof S.compose === 'function') {
      close();
      setTimeout(function () { try { S.compose({ embed: embed }); } catch (e) { console.warn('[ost-apps] compose failed', e); } }, 60);
      return;
    }
    // OST Mesh (social) not loaded on this page — fall back to the system share sheet / clipboard.
    var url = shareUrl();
    if (navigator.share) { navigator.share({ title: embed.title, text: embed.sub + ' — on OST', url: url }).catch(function () {}); return; }
    var done = function (ok) {
      var t = els.share.querySelector('.oav-txt'); if (!t) return;
      t.textContent = ok ? 'Link copied' : 'Copy failed';
      setTimeout(function () { t.textContent = 'Share'; }, 1800);
    };
    try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); }
    catch (_) { done(false); }
  }

  /* ---------- hash routing ---------- */
  function sync() {
    var s = slugFromHash();
    if (s) open(s, { fromHash: true });
    else if (st.open) close({ fromHash: true });
  }
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);

  // '#academy' (linked from OST Studio) opens Code Academy, which is lazy-loaded.
  function academyHash() {
    if (location.hash !== '#academy') return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    if (typeof window.OST_OPEN_CODE_ACADEMY === 'function') { window.OST_OPEN_CODE_ACADEMY(); return; }
    try { if (window.OST_LAZY && window.OST_LAZY.flush) window.OST_LAZY.flush(); } catch (_) {}
    var n = 0; var iv = setInterval(function () { if (typeof window.OST_OPEN_CODE_ACADEMY === 'function') { clearInterval(iv); window.OST_OPEN_CODE_ACADEMY(); } else if (++n > 60) clearInterval(iv); }, 250);
  }
  window.addEventListener('hashchange', academyHash);
  if (document.readyState === 'complete') academyHash(); else window.addEventListener('load', academyHash, { once: true });

  window.OST_APPS = {
    open: function (slug) { return open(slug); },
    close: function () { return close(); },
    current: function () { return st.open ? { slug: st.slug, name: st.name, author: st.authorPlain || '' } : null; },
    url: appUrl
  };

  function boot() { if (slugFromHash()) sync(); }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
