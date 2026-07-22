/* ==========================================================================
 * OST · Shortcuts — launch the apps already on the device, from inside OST
 * --------------------------------------------------------------------------
 * THE IDEA
 * A user taps a game or app they already have installed and it opens straight
 * away, with OST still sitting underneath - so the trip out feels like part of
 * OST rather than leaving it. When they come back, we say welcome back and put
 * them where they were.
 *
 * WHAT A WEB PAGE CAN AND CANNOT DO HERE - this shapes the whole design:
 *
 *  ✗ IT CANNOT SEE WHICH APPS ARE INSTALLED. Every browser removed that on
 *    purpose: app inventory is a device fingerprint, and letting pages read it
 *    identified users across sites. So there is NO honest "your installed
 *    games" list. Anything showing one is guessing, and guessing wrong looks
 *    broken.
 *
 *  ✓ IT CAN ATTEMPT A LAUNCH AND NOTICE WHETHER IT WORKED. Firing the app's
 *    URL scheme either backgrounds the browser (it worked) or does nothing (it
 *    is not installed). Watching for the page being hidden within ~1.2s tells
 *    us which happened, and we fall back to the store listing.
 *
 * So this is a CURATED LAUNCHER, not an inventory. We offer known apps, try to
 * open them, and degrade to the store or the web version. That is the honest
 * shape of the feature, and it works on both platforms.
 *
 * Android uses intent:// with a package and a browser_fallback_url, which the
 * OS resolves natively. iOS has no intent:// - it uses the app's own scheme,
 * with a timer as the only failure signal available.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_SHORTCUTS) return;

  var RETURN_KEY = 'ost.shortcuts.away.v1';
  var FALLBACK_MS = 1200;

  // id, label, emoji, android package, ios scheme, web fallback, store links.
  var APPS = [
    { id: 'youtube',  lbl: 'YouTube',   ico: '▶️', pkg: 'com.google.android.youtube', ios: 'youtube://', web: 'https://www.youtube.com/', iosId: '544007664' },
    { id: 'roblox',   lbl: 'Roblox',    ico: '🟥', pkg: 'com.roblox.client',          ios: 'roblox://',  web: 'https://www.roblox.com/',  iosId: '431946152' },
    { id: 'minecraft',lbl: 'Minecraft', ico: '⛏️', pkg: 'com.mojang.minecraftpe',     ios: 'minecraft://', web: 'https://www.minecraft.net/', iosId: '479516143' },
    { id: 'tiktok',   lbl: 'TikTok',    ico: '🎵', pkg: 'com.zhiliaoapp.musically',   ios: 'snssdk1233://', web: 'https://www.tiktok.com/', iosId: '835599320' },
    { id: 'spotify',  lbl: 'Spotify',   ico: '🎧', pkg: 'com.spotify.music',          ios: 'spotify://', web: 'https://open.spotify.com/', iosId: '324684580' },
    { id: 'discord',  lbl: 'Discord',   ico: '💬', pkg: 'com.discord',                ios: 'discord://', web: 'https://discord.com/app', iosId: '985746746' },
    { id: 'twitch',   lbl: 'Twitch',    ico: '🟣', pkg: 'tv.twitch.android.app',      ios: 'twitch://',  web: 'https://www.twitch.tv/',  iosId: '460177396' },
    { id: 'whatsapp', lbl: 'WhatsApp',  ico: '🟢', pkg: 'com.whatsapp',               ios: 'whatsapp://', web: 'https://web.whatsapp.com/', iosId: '310633997' },
    { id: 'maps',     lbl: 'Maps',      ico: '🗺️', pkg: 'com.google.android.apps.maps', ios: 'comgooglemaps://', web: 'https://maps.google.com/', iosId: '585027354' }
  ];

  function isAndroid() { return /android/i.test(navigator.userAgent); }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isMobile() { return isAndroid() || isIOS(); }

  function storeUrl(app) {
    if (isIOS()) return 'https://apps.apple.com/app/id' + app.iosId;
    return 'https://play.google.com/store/apps/details?id=' + app.pkg;
  }

  /* ---- launching ---------------------------------------------------------- */

  function launch(app) {
    if (!app) return;
    rememberAway(app);

    if (isAndroid()) {
      // Android resolves this natively: if the package is missing it sends the
      // user to browser_fallback_url instead of erroring. No timer needed.
      var scheme = String(app.ios || '').replace('://', '');
      var intent = 'intent://open#Intent;scheme=' + scheme +
                   ';package=' + app.pkg +
                   ';S.browser_fallback_url=' + encodeURIComponent(storeUrl(app)) +
                   ';end';
      window.location.href = intent;
      return;
    }

    if (isIOS()) {
      // iOS gives no success/failure callback. The only signal is whether the
      // page got hidden - if it did, the app took over. If we are still
      // visible after FALLBACK_MS, it is not installed.
      var settled = false;
      function onHide() {
        if (document.hidden) { settled = true; cleanup(); }
      }
      function cleanup() {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onHide);
      }
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onHide);

      window.location.href = app.ios;
      setTimeout(function () {
        cleanup();
        if (!settled && !document.hidden) window.location.href = storeUrl(app);
      }, FALLBACK_MS);
      return;
    }

    // Desktop: there is no app to open. Say so and use the web version rather
    // than firing a scheme that silently does nothing.
    window.open(app.web, '_blank', 'noopener,noreferrer');
  }

  /* ---- "you never really left" -------------------------------------------- */

  function rememberAway(app) {
    try {
      localStorage.setItem(RETURN_KEY, JSON.stringify({
        id: app.id, lbl: app.lbl, ico: app.ico, at: Date.now(),
        scroll: window.scrollY || 0
      }));
    } catch (_) {}
  }

  function welcomeBack() {
    var away;
    try { away = JSON.parse(localStorage.getItem(RETURN_KEY) || 'null'); } catch (_) { away = null; }
    if (!away) return;
    // Only greet if they actually went somewhere and came back reasonably soon.
    var gone = Date.now() - Number(away.at || 0);
    try { localStorage.removeItem(RETURN_KEY); } catch (_) {}
    if (gone < 3000 || gone > 1000 * 60 * 60 * 6) return;

    var bar = document.createElement('div');
    bar.className = 'ost-sc-back';
    bar.innerHTML = '<span>' + away.ico + ' Welcome back from ' + esc(away.lbl) + '</span>' +
                    '<button type="button">Continue in OST</button>';
    document.body.appendChild(bar);
    if (Number.isFinite(away.scroll)) {
      setTimeout(function () { window.scrollTo({ top: away.scroll, behavior: 'smooth' }); }, 120);
    }
    function dismiss() { bar.remove(); }
    bar.querySelector('button').addEventListener('click', dismiss);
    setTimeout(dismiss, 6000);
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---- UI ----------------------------------------------------------------- */

  function injectStyle() {
    if (document.getElementById('ost-shortcuts-style')) return;
    var css =
      '.ost-sc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:10px;padding:4px 0;}' +
      '.ost-sc-app{display:grid;justify-items:center;gap:5px;padding:9px 4px;border-radius:13px;background:#0b1b29;' +
        'border:1px solid rgba(127,216,255,.16);color:#dff8ff;cursor:pointer;font-size:11px;text-align:center;}' +
      '.ost-sc-app:hover{border-color:rgba(127,216,255,.5);}' +
      '.ost-sc-app i{font-style:normal;font-size:23px;line-height:1;}' +
      '.ost-sc-note{font-size:11px;color:#6f8ea3;line-height:1.4;margin:6px 0 0;}' +
      '.ost-sc-back{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:1000450;display:flex;gap:10px;' +
        'align-items:center;padding:9px 13px;border-radius:13px;background:#06111d;border:1px solid rgba(127,216,255,.3);' +
        'color:#dff8ff;font-size:13px;box-shadow:0 14px 40px rgba(0,0,0,.55);}' +
      '.ost-sc-back button{border:0;border-radius:9px;padding:6px 11px;background:#12405c;color:#dff8ff;cursor:pointer;}';
    var tag = document.createElement('style');
    tag.id = 'ost-shortcuts-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // Renders the launcher into any container the games page gives us.
  function render(host) {
    if (!host) return;
    injectStyle();
    var grid = document.createElement('div');
    grid.className = 'ost-sc-grid';
    APPS.forEach(function (app) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ost-sc-app';
      b.innerHTML = '<i>' + app.ico + '</i><span>' + esc(app.lbl) + '</span>';
      b.addEventListener('click', function () { launch(app); });
      grid.appendChild(b);
    });
    host.appendChild(grid);

    var note = document.createElement('p');
    note.className = 'ost-sc-note';
    note.textContent = isMobile()
      ? 'Opens the app if it is installed, otherwise the store. OST cannot see which apps you have — browsers hide that — so every tile is offered to everyone.'
      : 'On desktop these open the web version. Phone apps can only be launched from a phone.';
    host.appendChild(note);
  }

  window.OST_SHORTCUTS = {
    apps: function () { return APPS.slice(); },
    launch: function (id) { launch(APPS.filter(function (a) { return a.id === id; })[0]); },
    render: render,
    isMobile: isMobile
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', welcomeBack, { once: true });
  else welcomeBack();
})();
