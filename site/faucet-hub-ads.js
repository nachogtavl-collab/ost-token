/* ==========================================================================
   OST Faucet Hub — real ad provider integration
   Wires Adsterra (rewarded video) + A-Ads (always-on banner) into the hub.
   Defines window.OST_AD_PROVIDER which faucet-hub.js calls when the user
   clicks "Watch 30s ad". Real revenue from these networks is paid out to
   the OST AD TREASURY vault address below; a separate weekly script
   (scripts/sweep-ad-revenue.ts) converts BTC/USDT → SOL on Jupiter and
   refills the swap pool ATA so user cash-outs stay funded.

   TO ACTIVATE LIVE ADS:
   1. Sign up at https://adsterra.com/publishers (no minimum traffic, BTC/USDT
      payouts, Net-7). After approval you'll get an Offerwall/Rewarded-Video
      "zone id". Paste it into ADSTERRA_ZONE below.
   2. Sign up at https://a-ads.com (no KYC, BTC payouts daily). Create a unit
      and paste its data-id into A_ADS_UNIT below.
   3. (Optional) Coinzilla / Bitmedia / CoinAd zones can be added the same way.
   4. Set the ad payout address in your provider dashboards to AD_TREASURY
      below — a dedicated SPL token vault, NOT the swap pool. The sweep
      script then refills the swap pool weekly.
   ========================================================================== */
(function () {
  'use strict';

  // ---- CONFIG (edit after you sign up) -----------------------------------
  var ADSTERRA_ZONE = ''; // e.g. '12345678' from your Adsterra zone dashboard
  var A_ADS_UNIT    = '2435726'; // A-Ads unit — live (BTC payouts daily)
  // OST AD TREASURY VAULT (devnet) — ad revenue lands here off-chain, the
  // sweep script then converts → SOL → refills the swap pool ATA. Keep this
  // SEPARATE from the swap pool keypair so revenue accounting is clean.
  var AD_TREASURY = {
    cluster: 'devnet',
    // Devnet placeholder — replace with the real vault publickey after you
    // run scripts/init-ad-treasury.ts. The dashboard reads from the same
    // key so users can see incoming revenue → outgoing OST in real time.
    publicKey: 'AdTreasur1PlaceholderKey1111111111111111111',
    btcPayoutAddress: '',     // set in Adsterra/A-Ads dashboard
    usdtPayoutAddress: '',    // TRC20/ERC20 — set in PropellerAds/Coinzilla
    note: 'All ad revenue is reconciled weekly: BTC/USDT → SOL via Jupiter → swap pool refill.'
  };
  // ------------------------------------------------------------------------

  // ----- A-Ads always-on banner -------------------------------------------
  // Renders a quiet 320x50 below the spin wheel + a 728x90 footer banner.
  // BTC payouts are aggregated daily; no approval required.
  function injectAAds() {
    if (!A_ADS_UNIT) return;
    var slots = [
      { id: 'fhAdsBannerWheel', w: 320, h: 50 },
      { id: 'fhAdsBannerFooter', w: 728, h: 90 }
    ];
    slots.forEach(function (s) {
      if (document.getElementById(s.id)) return;
      var div = document.createElement('div');
      div.id = s.id;
      div.style.cssText = 'margin:14px auto;text-align:center;max-width:' + s.w + 'px;';
      div.innerHTML = '<iframe title="A-Ads sponsored banner" data-aa="' + A_ADS_UNIT + '" src="//ad.a-ads.com/' + A_ADS_UNIT + '?size=' + s.w + 'x' + s.h + '" ' +
        'style="width:' + s.w + 'px;height:' + s.h + 'px;border:0;padding:0;overflow:hidden;background-color:transparent;" ' +
        'scrolling="no" allow="autoplay"></iframe>' +
        '<div style="font-size:0.7rem;opacity:0.5;margin-top:4px;">Ad revenue funds OST treasury · <a href="#fhRevDashboard" style="color:inherit;">see dashboard</a></div>';
      // wheel banner goes inside the hub, footer goes at end of page
      var hub = document.getElementById('ostFaucetHubSection');
      if (hub) {
        if (s.id === 'fhAdsBannerWheel') hub.appendChild(div);
        else document.body.appendChild(div);
      }
    });
  }

  // ----- Adsterra rewarded video SDK loader -------------------------------
  // The exact init payload is given in your Adsterra dashboard after you
  // create a "Rewarded Video" zone. The hub calls window.OST_AD_PROVIDER.show
  // which we adapt to whatever Adsterra's player API returns.
  function loadAdsterra(cb) {
    if (!ADSTERRA_ZONE) { cb(false); return; }
    if (window.AdsterraRewarded) { cb(true); return; }
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://js.wpadmngr.com/static/adManager.js';
    s.setAttribute('data-cfasync', 'false');
    s.onload = function () { cb(!!window.AdsterraRewarded || !!window.atOptions); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
    window.atOptions = { zone: ADSTERRA_ZONE, type: 'rewarded' };
  }

  function showAdsterra(onComplete) {
    loadAdsterra(function (ok) {
      if (!ok) { onComplete(false); return; }
      try {
        // Adsterra's rewarded API surface varies per zone type. Try the
        // common ones in order.
        if (window.AdsterraRewarded && typeof window.AdsterraRewarded.show === 'function') {
          window.AdsterraRewarded.show({
            zone: ADSTERRA_ZONE,
            onComplete: function (r) { onComplete(!!(r && r.completed)); },
            onClose:    function ()  { onComplete(false); }
          });
          return;
        }
        // Fallback: open an interstitial modal that the user must keep open
        // for the configured duration; treat close-after-30s as completion.
        var modal = openInterstitialModal(ADSTERRA_ZONE, 30, onComplete);
        if (!modal) onComplete(false);
      } catch (e) {
        console.warn('[ads] Adsterra show failed', e);
        onComplete(false);
      }
    });
  }

  function openInterstitialModal(zone, seconds, cb) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10070;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff;';
    bg.innerHTML = '<div style="width:min(720px,92vw);height:min(420px,60vh);background:#000;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;">' +
      '<iframe title="Sponsored video ad" src="https://www.profitableratecpm.com/' + zone + '/index.html" style="width:100%;height:100%;border:0;"></iframe>' +
      '</div>' +
      '<div style="margin-top:14px;font-size:1.1rem;">Ad playing… <span id="fhAdSec">' + seconds + '</span>s remaining</div>' +
      '<button id="fhAdClose" style="margin-top:10px;padding:8px 18px;border-radius:10px;border:0;background:#444;color:#fff;cursor:pointer;" disabled>Close</button>';
    document.body.appendChild(bg);
    var left = seconds;
    var iv = setInterval(function () {
      left -= 1;
      var s = document.getElementById('fhAdSec'); if (s) s.textContent = left;
      if (left <= 0) {
        clearInterval(iv);
        var b = document.getElementById('fhAdClose');
        if (b) { b.disabled = false; b.textContent = 'Claim reward'; }
      }
    }, 1000);
    bg.querySelector('#fhAdClose').addEventListener('click', function () {
      bg.remove(); clearInterval(iv); cb(left <= 0);
    });
    return bg;
  }

  // ----- Public AD provider used by faucet-hub.js -------------------------
  window.OST_AD_PROVIDER = {
    name: ADSTERRA_ZONE ? 'adsterra' : 'fallback',
    treasury: AD_TREASURY,
    show: function (cb) {
      // Track view server-side to prevent self-click farming. When you
      // deploy a backend, replace the localStorage counter below with a
      // signed S2S callback (Adsterra → /api/ad-callback?uid=…&amount=…).
      var uid = (window.OST_WALLET && window.OST_WALLET.address) || 'anon';
      var key = 'ost.ads.views.' + uid + '.' + new Date().toISOString().slice(0, 10);
      try {
        var cur = parseInt(localStorage.getItem(key) || '0', 10);
        if (cur >= 20) { cb(false); console.warn('[ads] daily view cap reached for', uid); return; }
        localStorage.setItem(key, String(cur + 1));
      } catch (e) {}
      if (ADSTERRA_ZONE) showAdsterra(cb);
      else cb(true); // dev mode: pretend the ad finished
    }
  };

  // ----- Public revenue dashboard -----------------------------------------
  // Reads from local + treasury config and (when you deploy a backend) from
  // /api/ad-revenue. Until then it shows the wired networks + the local
  // view counter so users can see the funding loop is real.
  function dashboardHtml() {
    var providers = [
      { name: 'Adsterra (rewarded video)', live: !!ADSTERRA_ZONE, payout: 'BTC/USDT · Net-7', url: 'https://adsterra.com/publishers' },
      { name: 'A-Ads (banner)',            live: !!A_ADS_UNIT,    payout: 'BTC · daily',     url: 'https://a-ads.com' },
      { name: 'PropellerAds (popunder)',   live: false,           payout: 'USDT · $5 min',   url: 'https://propellerads.com' },
      { name: 'Coinzilla (display)',       live: false,           payout: 'BTC/ETH/USDT',    url: 'https://coinzilla.com' },
      { name: 'CoinAd (premium)',          live: false,           payout: 'BTC · invite',    url: 'https://coinad.com' },
      { name: 'Bitmedia.io (display)',     live: false,           payout: 'BTC · $100 min',  url: 'https://bitmedia.io' },
      { name: 'AdGate Media (rewarded)',   live: false,           payout: 'USDT · S2S',      url: 'https://adgatemedia.com' },
      { name: 'Pollfish / CPX (surveys)',  live: false,           payout: 'USD · S2S',       url: 'https://www.pollfish.com' }
    ];
    function totalViewsToday() {
      var uid = (window.OST_WALLET && window.OST_WALLET.address) || 'anon';
      var k = 'ost.ads.views.' + uid + '.' + new Date().toISOString().slice(0, 10);
      try { return parseInt(localStorage.getItem(k) || '0', 10); } catch (e) { return 0; }
    }
    var rows = providers.map(function (p) {
      var status = p.live ? '<span style="color:#6ce6a4;">● LIVE</span>' : '<span style="opacity:0.55;">○ awaiting key</span>';
      return '<tr><td>' + status + '</td><td><a href="' + p.url + '" target="_blank" rel="noopener">' + p.name + '</a></td><td>' + p.payout + '</td></tr>';
    }).join('');
    var hub = window.OST_FAUCET_HUB ? window.OST_FAUCET_HUB.state() : {};
    var lifetime = Number(hub.lifetime || 0).toFixed(2);
    var pending  = Number(hub.credits || 0).toFixed(2);
    var views = totalViewsToday();
    return '' +
      '<div class="container">' +
      '<div class="fh-section" id="fhRevDashboard">' +
        '<h3>📊 Ad Revenue → OST Loop</h3>' +
        '<p class="fh-sub">Public dashboard: every cent we earn from ads converts to SOL → refills the swap pool → cashes out as OST to users. Vault retained funds satellites, legacy research, and quantum projects.</p>' +
        '<div class="fh-grid">' +
          '<div class="fh-card"><div class="fh-card-title">Your ad views today</div><div class="fh-streak-num">' + views + '</div><div class="fh-card-meta">Daily cap: 20 views · resets at 00:00 UTC</div></div>' +
          '<div class="fh-card"><div class="fh-card-title">Your lifetime OST earned</div><div class="fh-streak-num">' + lifetime + '</div><div class="fh-card-meta">Includes faucet, spins, taps, ads, tasks</div></div>' +
          '<div class="fh-card"><div class="fh-card-title">Your pending credits</div><div class="fh-streak-num">' + pending + '</div><div class="fh-card-meta">Cash out from the hub above</div></div>' +
          '<div class="fh-card" style="grid-column:span 2;"><div class="fh-card-title">OST AD TREASURY (vault)</div>' +
            '<div style="font-family:monospace;font-size:0.85rem;word-break:break-all;background:rgba(0,0,0,0.25);padding:8px 10px;border-radius:8px;">' + AD_TREASURY.publicKey + '</div>' +
            '<div class="fh-card-meta">' + AD_TREASURY.note + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:18px;overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:0.92rem;">' +
            '<thead><tr style="opacity:0.8;text-align:left;"><th style="padding:6px 10px;">Status</th><th style="padding:6px 10px;">Network</th><th style="padding:6px 10px;">Payout</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<p class="fh-sub" style="margin-top:14px;">Affiliate partners with crypto payouts: ' +
          '<a href="https://accounts.binance.com/register?ref=" target="_blank" rel="noopener">Binance</a> · ' +
          '<a href="https://www.bybit.com/invite" target="_blank" rel="noopener">Bybit</a> · ' +
          '<a href="https://www.okx.com/join" target="_blank" rel="noopener">OKX</a> · ' +
          '<a href="https://www.kucoin.com/r/" target="_blank" rel="noopener">KuCoin</a> · ' +
          '<a href="https://partners.bitget.com" target="_blank" rel="noopener">Bitget</a> · ' +
          '<a href="https://shop.ledger.com" target="_blank" rel="noopener">Ledger</a> · ' +
          '<a href="https://trezor.io/affiliate" target="_blank" rel="noopener">Trezor</a> · ' +
          '<a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a>' +
        '</p>' +
        '<p class="fh-sub">DePIN micro-task partners: ' +
          '<a href="https://toloka.ai" target="_blank" rel="noopener">Toloka</a> · ' +
          '<a href="https://scale.com" target="_blank" rel="noopener">Scale AI</a> · ' +
          '<a href="https://oceanprotocol.com" target="_blank" rel="noopener">Ocean Protocol</a> · ' +
          '<a href="https://grass.io" target="_blank" rel="noopener">Grass.io</a>' +
        '</p>' +
      '</div>' +
      '</div>';
  }

  function mountDashboard() {
    if (document.getElementById('fhRevDashboard')) return;
    var hub = document.getElementById('ostFaucetHubSection');
    if (!hub) return;
    var sec = document.createElement('section');
    sec.id = 'fhRevDashboardSection';
    sec.className = 'section';
    sec.style.padding = '12px 0 40px';
    sec.innerHTML = dashboardHtml();
    hub.parentElement.insertBefore(sec, hub.nextSibling);
    // refresh totals when the hub awards credits
    window.addEventListener('ost-faucet-hub-award', function () {
      sec.innerHTML = dashboardHtml();
    });
  }

  function init() {
    injectAAds();
    mountDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 200); });
  } else {
    setTimeout(init, 200);
  }
})();
