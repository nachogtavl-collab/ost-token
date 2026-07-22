/* ==========================================================================
 * OST · World — the 3D globe becomes a door into the decentralized web
 * --------------------------------------------------------------------------
 * WHAT THIS IS, HONESTLY
 *
 * Click the rotating Earth on the home page and you enter OST World: an in-app
 * browser for the CONTENT-ADDRESSED web (IPFS/dweb).
 *
 * WHAT IT IS NOT — and why:
 *  · It is NOT a VPN. A VPN lives at the OS network layer (a TUN device and
 *    routing tables). A web page is sandboxed: it cannot route your device's
 *    traffic or hide your IP from any other app. Anything in a page that calls
 *    itself a VPN is proxying its own requests and lying about the rest. OST has
 *    users in censored countries; telling them they are protected when they are
 *    not is how people get hurt. (See CLAUDE.md: never present VPN as live.)
 *  · It does NOT browse .onion. Tor needs raw sockets and circuit building,
 *    which browsers do not have. The only workaround is a server-side tor2web
 *    gateway, which destroys the very anonymity that is the point — the gateway
 *    sees everything, and the hidden service sees the gateway, not the user.
 *  · It does NOT proxy the general web. Nearly every real site refuses framing
 *    (X-Frame-Options / frame-ancestors) and CORS blocks fetching. Rewriting
 *    proxies exist, but they make us the man-in-the-middle for user traffic.
 *
 * So it does the thing that is REAL: IPFS content is genuinely fetchable and
 * frameable from a browser through public gateways. No proxy of ours, no MITM,
 * no false promises — content addressed by hash, served by whoever has it. That
 * is a web nobody can quietly edit or take down, which is the actual point.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_WORLD) return;

  // Public gateways, tried in order. If one is blocked or down we fall to the
  // next — the whole point of content addressing is that ANY of them serves the
  // identical bytes, verified by the hash.
  var GATEWAYS = [
    { name: 'dweb.link', url: 'https://dweb.link/ipfs/' },
    { name: 'ipfs.io', url: 'https://ipfs.io/ipfs/' },
    { name: 'cf-ipfs', url: 'https://cloudflare-ipfs.com/ipfs/' },
    { name: 'pinata', url: 'https://gateway.pinata.cloud/ipfs/' }
  ];
  var gwIndex = 0;

  // OST's own site, content-addressed. Same bytes, verifiable by hash.
  var OST_CID = 'bafybeihrm53bou45yy5czxq43sp5j65hl3himep75iri3ob32b32ga2pse';

  var PLACES = [
    { label: '🌐 OST (content-addressed)', cid: OST_CID },
    { label: '📖 IPFS docs', cid: 'bafybeicnrwrqfjmnwjqhitb4hxdyzcrbaz3xkcqjxrmwqjkzqhqvhtxvhi' },
    { label: '🧪 Paste any link', cid: '' }
  ];

  // Services that publish an official embed endpoint and are verified
  // frameable. `build(input)` turns a channel/query into that endpoint.
  var EMBEDS = [
    {
      id: 'twitch', label: '🟣 Twitch',
      prompt: 'Twitch channel name',
      build: function (v) {
        return 'https://player.twitch.tv/?channel=' + encodeURIComponent(v) +
               '&parent=' + location.hostname + '&muted=false';
      }
    },
    {
      id: 'youtube', label: '▶️ YouTube',
      prompt: 'YouTube link or video id',
      build: function (v) {
        var m = String(v).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
        var id = m ? m[1] : (/^[\w-]{11}$/.test(String(v).trim()) ? String(v).trim() : '');
        return id ? 'https://www.youtube-nocookie.com/embed/' + id + '?playsinline=1&rel=0' : '';
      }
    },
    {
      id: 'maps', label: '🗺️ Maps',
      prompt: 'Place or address',
      build: function (v) {
        return 'https://maps.google.com/maps?q=' + encodeURIComponent(v) + '&output=embed';
      }
    }
  ];

  // Verified frame-blocked. We link out rather than pretend.
  var LAUNCH = [
    { label: '📘 Facebook',  url: 'https://www.facebook.com/',  header: 'X-Frame-Options: DENY',
      why: 'Facebook sends X-Frame-Options: DENY — no site may frame it.' },
    { label: '📸 Instagram', url: 'https://www.instagram.com/', header: 'X-Frame-Options: DENY',
      why: 'Instagram sends X-Frame-Options: DENY — no site may frame it.' },
    { label: '🔍 Google',    url: 'https://www.google.com/',    header: 'X-Frame-Options: SAMEORIGIN',
      why: 'Google Search only allows itself to frame it.' },
    { label: '🟪 Yahoo',     url: 'https://www.yahoo.com/',     header: 'CSP frame-ancestors',
      why: 'Yahoo allows only an explicit list of hosts to frame it.' }
  ];

  var el = {};
  var open = false;

  // Open an official embed in the media frame. Media stays in its own frame,
  // separate from the IPFS one, exactly as the existing split intends.
  function openEmbed(svc) {
    var v = window.prompt(svc.prompt);
    if (v == null) return;
    v = String(v).trim();
    if (!v) return;
    var url = svc.build(v);
    if (!url) { setStatus('That did not look like a valid ' + svc.label + ' target.', 'warn'); return; }
    showEmbed(url, svc.label);
    // A YouTube pick can also go to the floating bubble, so it keeps playing
    // while the user does something else in the app.
    if (svc.id === 'youtube' && window.OST_WORLD_BUBBLE) {
      setStatus('Playing in OST World. Tip: the ● bubble keeps it running while you use the rest of the app.', 'ok');
    }
  }

  /* ---- resolve whatever the user typed into a CID/path -------------------- */
  function parseTarget(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^ipfs:\/\//i, '').replace(/^\/ipfs\//i, '');
    // A full gateway URL — pull the CID back out so we stay gateway-agnostic.
    var m = /^https?:\/\/[^/]+\/ipfs\/(.+)$/i.exec(s);
    if (m) s = m[1];
    // CIDv0 (Qm…) or CIDv1 (bafy…/bafk…), optionally with a path after it.
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{57,})(\/.*)?$/.test(s)) return s;
    return null;
  }

  /* ---- media bridge: paste any link, get the right player ------------------
   *
   * WHY THIS IS NOT A CONTRADICTION OF THE IPFS SANDBOX RULE
   * -------------------------------------------------------
   * The IPFS frame must never get `allow-same-origin` because anyone can pin
   * anything: its content is attacker-CHOSEN and its origin is a gateway that
   * serves every CID, so a hostile CID could reach our storage.
   *
   * The media frame is a different shape of risk. Its URL is not user-supplied
   * — we build it ourselves as (hardcoded trusted origin) + (a strictly
   * validated ID). A user can choose WHICH YouTube video, never WHAT ORIGIN
   * loads. So the frame can only ever be youtube-nocookie.com or
   * platform.twitter.com, both of which are cross-origin from us; the
   * same-origin they get back is THEIR own, not ours, and it grants no path to
   * `ost.localWallet.v1`. They need it to run at all (player state, captions).
   *
   * The invariant that actually matters, in both cases: NEVER let a frame whose
   * origin an attacker controls also hold `allow-same-origin`. Keep the ID
   * regexes below strict — they are what pins the origin.
   */
  var YT_ID = /^[A-Za-z0-9_-]{11}$/;
  var TW_ID = /^[0-9]{5,25}$/;
  var EXT_VIDEO = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;
  var EXT_AUDIO = /\.(mp3|wav|m4a|aac|flac|opus|ogg)(\?|#|$)/i;
  var EXT_HLS = /\.(m3u8)(\?|#|$)/i;

  function parseUrl(s) {
    try {
      var u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u : null;
    } catch (_) { return null; }
  }

  function youtubeId(u) {
    var h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      var m = /^\/(embed|shorts|v|live)\/([^/?#]+)/.exec(u.pathname);
      if (m) return m[2];
    }
    return '';
  }

  function tweetId(u) {
    var h = u.hostname.replace(/^www\./, '');
    if (h !== 'twitter.com' && h !== 'x.com' && h !== 'mobile.twitter.com') return '';
    var m = /\/status(?:es)?\/([0-9]+)/.exec(u.pathname);
    return m ? m[1] : '';
  }

  // Decide what a pasted string IS. Order matters: CIDs first (cheapest and
  // unambiguous), then the platforms we can legitimately embed, then raw media,
  // then "a website" — which we are honest about not being able to frame.
  function route(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;

    var cid = parseTarget(s);
    if (cid) return { kind: 'ipfs', target: cid };

    var u = parseUrl(s);
    if (!u) return { kind: 'search', q: s };   // plain words → treat as a search

    var yt = youtubeId(u);
    if (yt && YT_ID.test(yt)) {
      var t = u.searchParams.get('t') || u.searchParams.get('start') || '';
      var start = /^(\d+)s?$/.test(t) ? parseInt(t, 10) : 0;
      return { kind: 'youtube', id: yt, start: start, title: 'YouTube' };
    }

    var tw = tweetId(u);
    if (tw && TW_ID.test(tw)) return { kind: 'tweet', id: tw, title: 'Post on X' };

    if (EXT_HLS.test(u.pathname)) return { kind: 'hls', url: u.href, title: 'Live stream' };
    if (EXT_VIDEO.test(u.pathname)) return { kind: 'video', url: u.href, title: 'Video' };
    if (EXT_AUDIO.test(u.pathname)) return { kind: 'audio', url: u.href, title: 'Audio' };

    return { kind: 'external', url: u.href, host: u.hostname.replace(/^www\./, '') };
  }

  function gatewayUrl(target, idx) {
    return GATEWAYS[(idx == null ? gwIndex : idx) % GATEWAYS.length].url + target;
  }

  /* ---- stage: exactly one renderer visible at a time ---------------------- */
  function clearStage() {
    if (el.frame) { el.frame.src = 'about:blank'; el.frame.style.display = 'none'; }
    if (el.media) { el.media.src = 'about:blank'; el.media.style.display = 'none'; }
    if (el.native) {
      // Tear the element down, don't just hide it — a detached <video> keeps
      // decoding and holding the network socket open otherwise.
      try {
        if (el.hls) { el.hls.destroy(); el.hls = null; }
        var m = el.native.querySelector('video,audio');
        if (m) { m.pause(); m.removeAttribute('src'); m.load(); }
      } catch (_) {}
      el.native.innerHTML = '';
      el.native.style.display = 'none';
    }
  }

  function showIpfs(target) {
    clearStage();
    el.frame.style.display = '';
    setStatus('Fetching ' + target.slice(0, 14) + '… via ' + GATEWAYS[gwIndex % GATEWAYS.length].name, 'load');
    el.frame.src = gatewayUrl(target);
    el.cur = target;
  }

  // Both of these build their URL from a hardcoded origin + a validated ID.
  // See the note above parseUrl for why `allow-same-origin` is correct here and
  // catastrophic on the IPFS frame.
  function showEmbed(src, label) {
    clearStage();
    el.cur = null;
    el.media.style.display = '';
    el.media.src = src;
    setStatus(label, 'ok');
  }

  function nativeMedia(tag, url, label) {
    clearStage();
    el.cur = null;
    el.native.style.display = '';
    var m = document.createElement(tag);
    m.src = url;
    m.controls = true;
    m.autoplay = true;
    m.playsInline = true;          // iOS: play inline instead of hijacking fullscreen
    m.preload = 'auto';
    m.crossOrigin = 'anonymous';
    m.className = 'ow-media';
    m.addEventListener('error', function () {
      setStatus('That file would not play. The host may block hotlinking, or the codec is not one this device decodes. Try “Open externally”.', 'warn');
    });
    el.native.appendChild(m);
    setStatus(label + ' — decoding natively on this device.', 'ok');
    return m;
  }

  function showHls(url) {
    var v = nativeMedia('video', '', 'Live stream');
    // Safari/iOS decode HLS natively; everyone else needs hls.js, which the app
    // already ships for broadcasts.
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
    if (window.Hls && window.Hls.isSupported()) {
      el.hls = new window.Hls({ enableWorker: true });
      el.hls.loadSource(url);
      el.hls.attachMedia(v);
      return;
    }
    setStatus('This device cannot play HLS and hls.js is not loaded on this page.', 'warn');
  }

  function openExternally(url) {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
  }

  function go(raw) {
    var r = route(raw);
    if (!r) return;

    if (r.kind === 'ipfs') { el.input.value = r.target; showIpfs(r.target); return; }

    if (r.kind === 'youtube') {
      showEmbed('https://www.youtube-nocookie.com/embed/' + r.id +
        '?rel=0&playsinline=1&autoplay=1' + (r.start ? '&start=' + r.start : ''),
        'YouTube — official embed, no-cookie host.');
      return;
    }
    if (r.kind === 'tweet') {
      showEmbed('https://platform.twitter.com/embed/Tweet.html?id=' + r.id + '&theme=dark',
        'Post on X — official embed.');
      return;
    }
    if (r.kind === 'hls') { showHls(r.url); return; }
    if (r.kind === 'video') { nativeMedia('video', r.url, 'Video'); return; }
    if (r.kind === 'audio') { nativeMedia('audio', r.url, 'Audio'); return; }

    // Honesty over theatre: we cannot frame these, and we will not proxy-rewrite
    // them (that would make OST a man-in-the-middle on the user's browsing).
    if (r.kind === 'search') {
      clearStage();
      setStatus('“' + r.q.slice(0, 40) + '” is not a CID or a link. Search engines refuse to be embedded, so this opens in your real browser.', 'warn');
      el.pending = 'https://duckduckgo.com/?q=' + encodeURIComponent(r.q);
      showExternalCta('Search DuckDuckGo');
      return;
    }
    clearStage();
    setStatus(r.host + ' sends X-Frame-Options, so it cannot legally or technically render inside OST. Opening it in your browser keeps its security intact.', 'warn');
    el.pending = r.url;
    showExternalCta('Open ' + r.host);
  }

  function showExternalCta(label) {
    el.native.style.display = '';
    el.native.innerHTML = '';
    var b = document.createElement('button');
    b.className = 'ow-ext';
    b.textContent = '↗ ' + label;
    b.addEventListener('click', function () { if (el.pending) openExternally(el.pending); });
    el.native.appendChild(b);
  }

  function nextGateway() {
    if (!el.cur) { setStatus('Gateways only apply to IPFS content — this is not an IPFS page.', 'warn'); return; }
    gwIndex = (gwIndex + 1) % GATEWAYS.length;
    setStatus('Trying ' + GATEWAYS[gwIndex].name + '… (same hash, different host — the bytes are identical either way)', 'load');
    el.frame.src = gatewayUrl(el.cur);
  }

  function setStatus(msg, kind) {
    if (!el.status) return;
    el.status.textContent = msg;
    el.status.className = 'ow-status' + (kind ? ' is-' + kind : '');
  }

  /* ---- UI ----------------------------------------------------------------- */
  function styles() {
    if (document.getElementById('ostWorldStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostWorldStyle';
    st.textContent = [
      '#ostWorld{position:fixed;inset:0;z-index:10060;display:none;flex-direction:column;',
      'background:linear-gradient(180deg,#070b16,#0b1120);}',
      '#ostWorld.is-open{display:flex;}',
      '.ow-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(148,163,184,.16);}',
      '.ow-title{font-weight:900;color:#e2e8f0;font-size:14px;display:flex;align-items:center;gap:8px;}',
      '.ow-badge{font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px;background:rgba(52,211,153,.16);color:#6ee7b7;}',
      '.ow-x{margin-left:auto;background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;}',
      '.ow-bar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(148,163,184,.12);}',
      '.ow-bar input{flex:1;min-width:0;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.28);border-radius:11px;',
      'color:#f1f5f9;padding:9px 12px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;}',
      '.ow-bar button{border:none;border-radius:11px;padding:0 14px;font-weight:800;cursor:pointer;font-size:12px;',
      'background:linear-gradient(135deg,#34d399,#059669);color:#04121a;}',
      '.ow-bar button.ghost{background:transparent;border:1px solid rgba(148,163,184,.3);color:#cbd5e1;}',
      '.ow-places{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 10px;}',
      '.ow-places button{border:1px solid rgba(52,211,153,.3);background:transparent;color:#6ee7b7;border-radius:999px;',
      'padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;}',
      '.ow-status{padding:7px 14px;font-size:11.5px;color:#94a3b8;border-bottom:1px solid rgba(148,163,184,.1);}',
      '.ow-status.is-warn{color:#fca5a5;}.ow-status.is-load{color:#7dd3fc;}.ow-status.is-ok{color:#6ee7b7;}',
      '.ow-frame{flex:1;border:none;width:100%;background:#fff;}',
      '.ow-media-frame{flex:1;border:none;width:100%;background:#000;}',
      '.ow-native{flex:1;display:flex;align-items:center;justify-content:center;background:#000;padding:12px;}',
      '.ow-media{max-width:100%;max-height:100%;width:100%;border-radius:12px;background:#000;}',
      'audio.ow-media{max-height:56px;}',
      '.ow-ext{border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.1);color:#6ee7b7;',
      'border-radius:12px;padding:12px 18px;font-size:13px;font-weight:800;cursor:pointer;}',
      '.ow-foot{padding:9px 14px;font-size:10.5px;color:#64748b;border-top:1px solid rgba(148,163,184,.12);line-height:1.5;}',
      '.ow-foot b{color:#94a3b8;}'
    ].join('');
    document.head.appendChild(st);
  }

  function build() {
    styles();
    var root = document.createElement('div');
    root.id = 'ostWorld';
    root.innerHTML =
      '<div class="ow-head">' +
        '<span class="ow-title">🌍 OST World <span class="ow-badge">content-addressed</span></span>' +
        '<button class="ow-x" data-ow-close aria-label="Close">×</button>' +
      '</div>' +
      '<div class="ow-bar">' +
        '<input type="text" spellcheck="false" placeholder="Paste a YouTube / X link, a video or audio URL, or an IPFS hash" data-ow-input>' +
        '<button data-ow-go>Open</button>' +
        '<button class="ghost" data-ow-gw title="Same hash, different gateway">⇄ Gateway</button>' +
      '</div>' +
      '<div class="ow-places" data-ow-places></div>' +
      '<div class="ow-status">Paste a link — YouTube, X, a video/audio file, or an IPFS hash.</div>' +
      // SANDBOX — read this before touching it.
      // NEVER add `allow-same-origin` here. ANYONE can pin ANYTHING to IPFS, so
      // everything this frame loads is untrusted, attacker-controllable content.
      // `allow-scripts` + `allow-same-origin` together cancel the sandbox: the
      // page would run on OUR origin with full access to localStorage — which is
      // where `ost.localWallet.v1`, the user's wallet keypair, lives. That is a
      // wallet-drainer, one CID away. Without `allow-same-origin` the frame gets
      // an opaque origin and is walled off from our storage and DOM.
      // Some dweb apps need their own storage and will degrade here. Good — a
      // broken page is an acceptable price; a stolen wallet is not.
      '<iframe class="ow-frame" data-ow-frame referrerpolicy="no-referrer"' +
        ' sandbox="allow-scripts allow-popups allow-forms"></iframe>' +
      // MEDIA FRAME — separate from the IPFS frame ON PURPOSE. Its src is only
      // ever built by us from a hardcoded origin + a validated ID, so an attacker
      // cannot aim it. That is the whole reason it may hold `allow-same-origin`
      // (which YouTube/X need to run) while the IPFS frame above never can.
      // If you ever make this frame's origin user-supplied, strip that flag first.
      // referrerpolicy: the IPFS frame above sends `no-referrer` because it owes
      // those gateways nothing. This one must NOT — YouTube validates the
      // embedding domain from the referrer and answers "Error 153: video player
      // configuration error" when it is hidden. `strict-origin-when-cross-origin`
      // sends the bare origin (no path, no query), which is what it needs and
      // nothing more.
      '<iframe class="ow-media-frame" data-ow-media style="display:none" referrerpolicy="strict-origin-when-cross-origin"' +
        ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen' +
        ' sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe>' +
      '<div class="ow-native" data-ow-native style="display:none"></div>' +
      '<div class="ow-foot">' +
        'Paste a <b>YouTube</b> or <b>X</b> link, a direct video/audio file, or an <b>IPFS</b> hash. Media decodes natively on your device. ' +
        'Search engines and most websites send <b>X-Frame-Options</b> and cannot be embedded by anyone — those open in your real browser rather than us proxying (and reading) your traffic. ' +
        'This is <b>not a VPN and not Tor</b>: a web page cannot route your device\'s traffic or build Tor circuits, and we will not pretend otherwise. ' +
        'For real anonymity use the Tor Browser.' +
      '</div>';
    document.body.appendChild(root);

    el.root = root;
    el.input = root.querySelector('[data-ow-input]');
    el.frame = root.querySelector('[data-ow-frame]');
    el.media = root.querySelector('[data-ow-media]');
    el.native = root.querySelector('[data-ow-native]');
    el.status = root.querySelector('.ow-status');
    var places = root.querySelector('[data-ow-places]');

    PLACES.forEach(function (p) {
      var b = document.createElement('button');
      b.textContent = p.label;
      b.addEventListener('click', function () {
        if (!p.cid) { el.input.focus(); setStatus('Paste a CID above and hit Open.', ''); return; }
        go(p.cid);
      });
      places.appendChild(b);
    });

    // ---- The rest of the web, split by what a browser will ACTUALLY allow ---
    // Verified with the live response headers, not guessed:
    //   facebook.com   X-Frame-Options: DENY
    //   instagram.com  X-Frame-Options: DENY
    //   google.com     X-Frame-Options: SAMEORIGIN
    //   yahoo.com      CSP frame-ancestors <allow-list we are not on>
    // No client-side code can override those - it is the browser enforcing the
    // site's wishes. The only way to "load" them in-frame is a rewriting proxy
    // that terminates the user's session on OUR server, which would make OST a
    // man-in-the-middle for people's logins. We do not do that.
    //
    // These, by contrast, publish OFFICIAL embed endpoints and are verified
    // frameable, so they open properly INSIDE the world.
    EMBEDS.forEach(function (svc) {
      var b = document.createElement('button');
      b.textContent = svc.label;
      b.title = 'Opens inside OST World (official embed)';
      b.addEventListener('click', function () { openEmbed(svc); });
      places.appendChild(b);
    });

    LAUNCH.forEach(function (svc) {
      var b = document.createElement('button');
      b.textContent = svc.label + ' ↗';
      b.title = svc.why;
      b.addEventListener('click', function () {
        setStatus(svc.label + ' blocks embedding (' + svc.header + '), so it opens in a real tab. ' +
                  'Faking it in-frame would mean proxying your login through our server.', '');
        window.open(svc.url, '_blank', 'noopener,noreferrer');
      });
      places.appendChild(b);
    });

    root.querySelector('[data-ow-go]').addEventListener('click', function () { go(el.input.value); });
    root.querySelector('[data-ow-gw]').addEventListener('click', nextGateway);
    root.querySelector('[data-ow-close]').addEventListener('click', close);
    el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(el.input.value); });
    el.frame.addEventListener('load', function () {
      if (el.cur) setStatus('Loaded from ' + GATEWAYS[gwIndex % GATEWAYS.length].name + ' — verified by hash. If it looks wrong, try ⇄ Gateway.', 'ok');
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) close(); });
    return root;
  }

  function openWorld(target) {
    if (!el.root) build();
    el.root.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    open = true;
    if (target) go(target);
    try { window.dispatchEvent(new CustomEvent('ost:world-open')); } catch (_) {}
  }
  function close() {
    if (!el.root) return;
    el.root.classList.remove('is-open');
    document.body.style.overflow = '';
    open = false;
    clearStage();      // stops the iframe AND kills any decoding <video>/<audio>
    el.cur = null;
    el.pending = null;
  }

  /* ---- the globe is the door ---------------------------------------------- */
  function wireGlobe() {
    var canvas = document.getElementById('globeCanvas');
    if (!canvas || canvas.__ostWorldWired) return !!canvas;
    canvas.__ostWorldWired = true;
    canvas.style.cursor = 'pointer';
    canvas.title = 'Enter OST World — browse the content-addressed web';

    // TAP DETECTION, not `click`.
    //
    // The globe owns pointerdown/pointermove/pointerup to drag-spin itself
    // (app.js initGlobe). On a phone the canvas has default touch-action, so the
    // browser treats a finger-down as a possible scroll and fires POINTERCANCEL
    // — and a synthetic `click` never arrives. That is why the globe visibly
    // reacted to the spin but the World never opened: `click` was simply never
    // dispatched. A desktop mouse click DOES fire one, which is exactly why this
    // slipped through testing.
    //
    // So detect the tap ourselves: pointer down and up in nearly the same spot,
    // quickly. A real spin moves further and is left alone for the globe.
    // touch-action:manipulation also stops the browser holding the tap back to
    // wait for a double-tap-zoom.
    try { canvas.style.touchAction = 'manipulation'; } catch (_) {}

    var down = null;
    var TAP_SLOP = 12;    // px of movement still counted as a tap, not a spin
    var TAP_MS = 700;

    canvas.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, { passive: true });

    canvas.addEventListener('pointerup', function (e) {
      if (!down) return;
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      var quick = (Date.now() - down.t) < TAP_MS;
      down = null;
      if (moved <= TAP_SLOP && quick) openWorld();
    }, { passive: true });

    // The browser took the gesture (scroll/zoom) — not a tap.
    canvas.addEventListener('pointercancel', function () { down = null; }, { passive: true });
    canvas.addEventListener('pointerleave', function () { down = null; }, { passive: true });

    // Desktop safety net: if a real click does arrive and we somehow missed the
    // pointer pair, still open. Guarded so a tap never opens the World twice.
    canvas.addEventListener('click', function () { if (!open) openWorld(); });
    return true;
  }

  // The globe is created lazily (three.js loads on idle), so keep looking for a
  // short while instead of assuming it exists at boot.
  var tries = 0;
  (function waitForGlobe() {
    if (wireGlobe()) return;
    if (tries++ < 80) setTimeout(waitForGlobe, 500);
  })();

  window.OST_WORLD = {
    open: openWorld,
    close: close,
    go: go,
    cid: OST_CID,
    gateways: GATEWAYS.map(function (g) { return g.name; })
  };
})();
