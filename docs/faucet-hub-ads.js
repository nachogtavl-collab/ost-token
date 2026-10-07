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
  // OST AD TREASURY VAULT (devnet) — set a real public key after running
  // scripts/init-ad-treasury.ts. Keep this separate from the swap pool keypair.
  var AD_TREASURY = {
    cluster: 'devnet',
    publicKey: window.OST_AD_TREASURY_PUBKEY || '',
    btcPayoutAddress: '',     // set in Adsterra/A-Ads dashboard
    usdtPayoutAddress: '',    // TRC20/ERC20 — set in PropellerAds/Coinzilla
    // Honest status (CLAUDE.md): no sweep runs today, so nothing is converted.
    note: 'R&D: no sweep runs today. Ad revenue is not converted to SOL or OST and does not refill any pool.'
  };
  function walletUid() {
    try {
      var W = window.OST_WALLET;
      if (W && typeof W.pubkey === 'function') { var pk = W.pubkey(); if (pk) return String(pk); }
      if (W && W.session && W.session.publicKey && W.session.publicKey.toBase58) return W.session.publicKey.toBase58();
    } catch (_) {}
    return 'anon';
  }
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
        '<div style="font-size:0.7rem;opacity:0.5;margin-top:4px;">Sponsored banner · ads are R&amp;D and fund nothing in OST · <a href="#fhRevDashboard" style="color:inherit;">details</a></div>';
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
    name: ADSTERRA_ZONE ? 'adsterra' : (A_ADS_UNIT ? 'a-ads-banner-only' : 'unconfigured'),
    treasury: AD_TREASURY,
    // True only when a rewarded zone actually exists. The hub uses this to
    // avoid offering a reward that cannot be paid.
    rewardedAvailable: function () { return !!ADSTERRA_ZONE; },

    show: function (cb) {
      // The cap used to live in localStorage, which any user can reset from
      // devtools - so the "anti self-click farming" comment described something
      // that did not exist. It is now enforced by the ad treasury Durable
      // Object, which the client cannot edit.
      var uid = walletUid();

      if (!ADSTERRA_ZONE) {
        // No rewarded inventory configured: say so instead of silently
        // failing after the user waited through a countdown.
        console.warn('[ads] Rewarded video zone is not configured; no rewarded ad credit issued.');
        cb(false, { reason: 'no_rewarded_zone' });
        return;
      }

      var api = (window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev');
      fetch(api + '/ads/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uid })
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data || !data.ok) {
          cb(false, { reason: (data && data.error) || 'view_not_recorded' });
          return;
        }
        showAdsterra(cb);
      }).catch(function (err) {
        // Server unreachable: do NOT fall back to crediting locally. An
        // uncapped reward is a free money printer.
        console.warn('[ads] view cap check failed; no credit issued', err);
        cb(false, { reason: 'cap_check_unreachable' });
      });
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
    // Honest status (CLAUDE.md honesty rule, FCT-2 / C12 D1): a banner that
    // shows is "banner shown", never "LIVE" revenue; nothing here is converted
    // to OST, and retired legacy credits are shown as not cashable, never as OST.
    var rows = providers.map(function (p) {
      var status = p.live ? '<span style="color:#93c5fd;">● banner shown</span>' : '<span style="opacity:0.55;">○ not set up</span>';
      return '<tr><td>' + status + '</td><td><a href="' + p.url + '" target="_blank" rel="noopener">' + p.name + '</a></td><td>' + p.payout + '</td></tr>';
    }).join('');
    var hub = {};
    try { hub = window.OST_FAUCET_HUB ? (window.OST_FAUCET_HUB.state() || {}) : {}; } catch (_) { hub = {}; }
    var legacy = Math.max(0, Number(hub.credits || 0) || 0);
    var legacyCard = legacy > 0
      ? '<div class="fh-card"><div class="fh-card-title">Retired legacy credits (not cashable)</div><div class="fh-streak-num">' + legacy.toFixed(2) + '</div><div class="fh-card-meta">Old vault credits are retired: they are not OST, have no cash value and can’t be cashed out. Claim free devnet OST in the hub above instead.</div></div>'
      : '';
    return '' +
      '<div class="container">' +
      '<div class="fh-section" id="fhRevDashboard">' +
        '<h3>📊 Ads — R&amp;D, not live</h3>' +
        '<p class="fh-sub">Ads are an experiment on devnet. No rewarded ads are paid, ad revenue is not converted to SOL or OST, and it does not refill any pool. Devnet tokens have no cash value.</p>' +
        '<div class="fh-grid">' +
          legacyCard +
          '<div class="fh-card" style="grid-column:span 2;"><div class="fh-card-title">OST ad treasury (vault)</div>' +
            '<div style="font-family:monospace;font-size:0.85rem;word-break:break-all;background:rgba(0,0,0,0.25);padding:8px 10px;border-radius:8px;">' + (AD_TREASURY.publicKey || 'Not configured') + '</div>' +
            '<div class="fh-card-meta">' + AD_TREASURY.note + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:18px;overflow-x:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:0.92rem;">' +
            '<thead><tr style="opacity:0.8;text-align:left;"><th style="padding:6px 10px;">Status</th><th style="padding:6px 10px;">Network</th><th style="padding:6px 10px;">Network’s own payout terms</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
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
