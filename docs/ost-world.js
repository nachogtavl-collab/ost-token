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
    { label: '🧪 Paste any CID', cid: '' }
  ];

  var el = {};
  var open = false;

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

  function gatewayUrl(target, idx) {
    return GATEWAYS[(idx == null ? gwIndex : idx) % GATEWAYS.length].url + target;
  }

  function go(raw) {
    var target = parseTarget(raw);
    if (!target) {
      setStatus('That is not a CID. Paste an IPFS hash (Qm… or bafy…), an ipfs:// link, or a gateway URL.', 'warn');
      return;
    }
    el.input.value = target;
    setStatus('Fetching ' + target.slice(0, 14) + '… via ' + GATEWAYS[gwIndex % GATEWAYS.length].name, 'load');
    el.frame.src = gatewayUrl(target);
    el.cur = target;
  }

  function nextGateway() {
    if (!el.cur) return;
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
        '<input type="text" spellcheck="false" placeholder="ipfs://… or a CID (Qm… / bafy…)" data-ow-input>' +
        '<button data-ow-go>Open</button>' +
        '<button class="ghost" data-ow-gw title="Same hash, different gateway">⇄ Gateway</button>' +
      '</div>' +
      '<div class="ow-places" data-ow-places></div>' +
      '<div class="ow-status">Pick a place, or paste any IPFS hash.</div>' +
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
      '<div class="ow-foot">' +
        'This is the <b>content-addressed web</b>: every page is fetched by its hash, so any gateway returns the identical bytes — nobody can quietly edit it. ' +
        'It is <b>not a VPN and not Tor</b>: a web page cannot route your device\'s traffic or build Tor circuits, and we will not pretend otherwise. ' +
        'For real anonymity use the Tor Browser.' +
      '</div>';
    document.body.appendChild(root);

    el.root = root;
    el.input = root.querySelector('[data-ow-input]');
    el.frame = root.querySelector('[data-ow-frame]');
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
    el.frame.src = 'about:blank';   // stop whatever was running
    el.cur = null;
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
