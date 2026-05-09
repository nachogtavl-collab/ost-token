/* OST Card — universal wallet pass linked to wallet + OST Mesh handle.
 * Phase 1 (today, no mainnet rail): users on iPhone / Android / PC can
 *   - generate a personal OST Card (handle + wallet + live OST/USD)
 *   - save it to Apple Wallet via signed .pkpass when the relay exposes it,
 *     fall back to the iOS Shortcut + NFC tag flow that works without PassKit
 *   - save it to Google Wallet via signed JWT when the relay exposes it,
 *     fall back to a saveable JSON + share sheet
 *   - write the card payload to a Web NFC tag (Android) so an iPhone tap
 *     opens the OST Card landing page (`?card=<wallet>#card`) automatically
 *   - install an iOS Shortcut that opens the same landing page from a
 *     double-tap of the side / Action button
 * Phase 2 (mainnet): swap the landing-page card view for a real Apple Pay /
 * Google Pay payment card by plugging the issuer endpoints in
 * window.OST_CARD_ENDPOINTS without changing the UI surface. */
(function () {
  'use strict';

  var STORAGE_PROFILE = 'ost.card.profile.v1';
  var STORAGE_AMOUNT = 'ost.card.amount.v1';
  var DEFAULT_OST_USD = 1.00;
  var PUBLIC_SITE_URL = 'https://nachogtavl-collab.github.io/ost-token/';
  var SHORTCUT_GUIDE = 'https://support.apple.com/guide/shortcuts/run-shortcut-from-back-tap-or-action-button-apdc7307b8b5/ios';

  var state = {
    usdPerOst: DEFAULT_OST_USD,
    ostBalance: 0,
    refreshing: false,
    bound: false
  };

  function $(id) { return document.getElementById(id); }

  function apiBase() {
    return String(window.OST_API_BASE || (window.OST_TOPUP && window.OST_TOPUP.apiBase) || '').replace(/\/$/, '');
  }

  function endpoints() {
    var ep = window.OST_CARD_ENDPOINTS || {};
    var base = apiBase();
    return {
      apple: ep.apple || (base ? base + '/passes/apple' : ''),
      google: ep.google || (base ? base + '/passes/google' : ''),
      shortcut: ep.shortcut || (base ? base + '/passes/shortcut' : '')
    };
  }

  function walletAddress() {
    try {
      if (window.OST_WALLET) {
        if (window.OST_WALLET.address) return String(window.OST_WALLET.address).trim();
        var session = window.OST_WALLET.session;
        if (session && session.publicKey && typeof session.publicKey.toBase58 === 'function') {
          return session.publicKey.toBase58();
        }
      }
    } catch (_) {}
    return String(window.OST_CONNECTED_WALLET || '').trim();
  }

  function readProfile() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null') || null; }
    catch (_) { return null; }
  }

  function writeProfile(profile) {
    try { localStorage.setItem(STORAGE_PROFILE, JSON.stringify(profile)); } catch (_) {}
  }

  function deriveHandle(address) {
    if (!address) return '';
    var clean = String(address).replace(/[^A-Za-z0-9]/g, '');
    return 'ost-' + clean.slice(0, 6).toLowerCase();
  }

  function ensureProfile() {
    var address = walletAddress();
    if (!address) return null;
    var existing = readProfile();
    if (existing && existing.wallet === address) return existing;
    var meshHandle = '';
    try { meshHandle = String(localStorage.getItem('ost.mesh.handle') || '').trim(); } catch (_) {}
    var profile = {
      wallet: address,
      handle: (existing && existing.handle) || meshHandle || deriveHandle(address),
      meshHandle: meshHandle || (existing && existing.meshHandle) || '',
      createdAt: (existing && existing.createdAt) || Date.now(),
      cardId: (existing && existing.cardId) || ('ost-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36))
    };
    writeProfile(profile);
    try { window.dispatchEvent(new CustomEvent('ost:card-profile', { detail: profile })); } catch (_) {}
    return profile;
  }

  function readAmount() {
    var input = $('ostCardAmountInput');
    var raw = input ? Number(input.value) : Number(localStorage.getItem(STORAGE_AMOUNT) || 25);
    if (!Number.isFinite(raw) || raw <= 0) return 25;
    return Math.min(Math.max(Math.round(raw * 100) / 100, 1), 5000);
  }

  function writeAmount(value) {
    try { localStorage.setItem(STORAGE_AMOUNT, String(value)); } catch (_) {}
  }

  function detectPlatform() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var isIos = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isMacSafari = /Mac/i.test(platform) && /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(ua);
    var isAndroid = /Android/i.test(ua);
    var isChromeAndroid = isAndroid && /Chrome/i.test(ua) && !/EdgiOS|FxiOS/i.test(ua);
    return { isIos: isIos, isMacSafari: isMacSafari, isAndroid: isAndroid, isChromeAndroid: isChromeAndroid };
  }

  function cardLandingUrl(profile, amountUsd) {
    var u = new URL(PUBLIC_SITE_URL);
    u.searchParams.set('card', profile.wallet);
    if (profile.handle) u.searchParams.set('handle', profile.handle);
    if (amountUsd) u.searchParams.set('amount', String(amountUsd));
    u.hash = '#card';
    return u.toString();
  }

  function qrUrl(text, size) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=' + (size || 220) + 'x' + (size || 220) + '&data=' + encodeURIComponent(text);
  }

  async function loadQuote() {
    var base = apiBase();
    if (!base) return;
    try {
      var response = await fetch(base + '/topup/config', { cache: 'no-store' });
      var payload = response.ok ? await response.json() : null;
      if (payload && payload.pricing) {
        var nextOst = Number(payload.pricing.usdPerOst);
        if (Number.isFinite(nextOst) && nextOst > 0) state.usdPerOst = nextOst;
      }
    } catch (_) {}
    if (!Number.isFinite(state.usdPerOst) || state.usdPerOst <= 0) state.usdPerOst = DEFAULT_OST_USD;
  }

  async function loadBalance() {
    var address = walletAddress();
    if (!address) { state.ostBalance = 0; return; }
    try {
      if (window.OST_WALLET && typeof window.OST_WALLET.getOstBalance === 'function') {
        var bal = await window.OST_WALLET.getOstBalance(address);
        state.ostBalance = Math.max(0, Number(bal) || 0);
      }
    } catch (_) {}
  }

  function setStatus(msg, tone) {
    var el = $('ostCardStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = tone === 'success' ? '#86efac'
      : tone === 'warning' ? '#fde68a'
      : tone === 'error' ? '#fca5a5' : 'var(--text-muted)';
  }

  function ensureCardUi() {
    var host = $('ostAppleTapPanel');
    if (!host || $('ostCardSection')) return;
    var section = document.createElement('div');
    section.id = 'ostCardSection';
    section.style.cssText = 'margin-top:18px;padding-top:18px;border-top:1px solid rgba(148,163,184,0.16);display:grid;gap:14px;';
    section.innerHTML = ''
      + '<div>'
      +   '<span class="wallet-side-kicker">OST Card \u2014 universal pass</span>'
      +   '<h3 style="margin:6px 0 6px;font-size:1.08rem;color:var(--text-light);">Add OST Card to Apple / Google / NFC</h3>'
      +   '<p style="margin:0;color:var(--text-muted);font-size:.88rem;line-height:1.55;">Links your wallet + OST Mesh handle to a saveable card. Phase 1 today: tag + landing-page card. Phase 2 (mainnet): real Apple Pay / Google Pay payment card.</p>'
      + '</div>'
      + '<div id="ostCardPreview" style="position:relative;overflow:hidden;padding:18px;border-radius:20px;background:linear-gradient(135deg,#020617,#0f172a 55%,#0b3d2e);border:1px solid rgba(110,231,183,0.22);box-shadow:0 22px 48px rgba(2,6,23,0.45);color:#f8fafc;display:grid;gap:14px;">'
      +   '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">'
      +     '<div>'
      +       '<div style="font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(226,232,240,0.7);">OST Card</div>'
      +       '<div id="ostCardHandle" style="margin-top:6px;font-size:1.18rem;font-weight:800;letter-spacing:.02em;">--</div>'
      +     '</div>'
      +     '<div id="ostCardChip" style="padding:6px 10px;border-radius:999px;background:rgba(110,231,183,0.16);color:#bbf7d0;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;">Devnet</div>'
      +   '</div>'
      +   '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'
      +     '<img id="ostCardQr" alt="OST Card QR" style="width:96px;height:96px;border-radius:14px;background:#fff;padding:6px;" />'
      +     '<div style="flex:1;min-width:180px;display:grid;gap:6px;">'
      +       '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(226,232,240,0.6);">Balance</div>'
      +       '<div id="ostCardBalance" style="font-size:1.32rem;font-weight:800;">0.00 OST</div>'
      +       '<div id="ostCardBalanceUsd" style="font-size:.86rem;color:#bbf7d0;">~ $0.00 USD</div>'
      +     '</div>'
      +   '</div>'
      +   '<div id="ostCardWalletRow" style="font-size:.78rem;color:rgba(226,232,240,0.78);word-break:break-all;font-family:\'SFMono-Regular\',Consolas,Menlo,monospace;">Connect a wallet to mint card</div>'
      + '</div>'
      + '<label style="display:grid;gap:6px;">'
      +   '<span style="font-size:.74rem;font-weight:700;color:var(--text-light);letter-spacing:.06em;text-transform:uppercase;">Default tap amount (USD)</span>'
      +   '<input id="ostCardAmountInput" type="number" min="1" step="0.01" value="25" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.5);color:var(--text-light);font-size:.92rem;">'
      + '</label>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
      +   '<button class="btn btn-primary btn-sm" id="ostCardAppleBtn" type="button">Add to Apple Wallet</button>'
      +   '<button class="btn btn-primary btn-sm" id="ostCardGoogleBtn" type="button">Add to Google Wallet</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostCardShortcutBtn" type="button">Install iOS Shortcut</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostCardNfcBtn" type="button">Write to NFC tag</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostCardShareBtn" type="button">Share card link</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostCardOpenBtn" type="button">Open full card</button>'
      + '</div>'
      + '<div id="ostCardStatus" style="font-size:.84rem;color:var(--text-muted);line-height:1.55;">Connect a wallet to mint your OST Card.</div>';
    host.appendChild(section);

    $('ostCardAppleBtn').addEventListener('click', addToAppleWallet);
    $('ostCardGoogleBtn').addEventListener('click', addToGoogleWallet);
    $('ostCardShortcutBtn').addEventListener('click', installShortcut);
    $('ostCardNfcBtn').addEventListener('click', writeNfcTag);
    $('ostCardShareBtn').addEventListener('click', shareCardLink);
    $('ostCardOpenBtn').addEventListener('click', function () { openFullCard(); });
    var amt = $('ostCardAmountInput');
    amt.value = String(readAmount());
    amt.addEventListener('input', function () { writeAmount(readAmount()); refresh(); });
  }

  function refresh() {
    ensureCardUi();
    var profile = ensureProfile();
    var address = walletAddress();
    var network = String(window.OST_NETWORK || 'devnet').toLowerCase();
    var chip = $('ostCardChip');
    if (chip) {
      chip.textContent = network === 'mainnet' ? 'Mainnet' : 'Devnet';
      chip.style.background = network === 'mainnet' ? 'rgba(56,189,248,0.18)' : 'rgba(110,231,183,0.16)';
      chip.style.color = network === 'mainnet' ? '#bae6fd' : '#bbf7d0';
    }
    if (!profile || !address) {
      if ($('ostCardHandle')) $('ostCardHandle').textContent = 'Connect wallet';
      if ($('ostCardWalletRow')) $('ostCardWalletRow').textContent = 'Connect a wallet to mint card';
      if ($('ostCardBalance')) $('ostCardBalance').textContent = '0.00 OST';
      if ($('ostCardBalanceUsd')) $('ostCardBalanceUsd').textContent = '~ $0.00 USD';
      var qrEl0 = $('ostCardQr'); if (qrEl0) qrEl0.src = qrUrl(PUBLIC_SITE_URL, 220);
      setStatus('Connect a wallet to mint your OST Card.', 'warning');
      return;
    }
    var amount = readAmount();
    var landing = cardLandingUrl(profile, amount);
    if ($('ostCardHandle')) $('ostCardHandle').textContent = '@' + (profile.handle || deriveHandle(address));
    if ($('ostCardWalletRow')) $('ostCardWalletRow').textContent = address;
    var ost = Number(state.ostBalance) || 0;
    var usd = ost * (Number(state.usdPerOst) || DEFAULT_OST_USD);
    if ($('ostCardBalance')) $('ostCardBalance').textContent = ost.toFixed(2) + ' OST';
    if ($('ostCardBalanceUsd')) $('ostCardBalanceUsd').textContent = '~ $' + usd.toFixed(2) + ' USD';
    var qrEl = $('ostCardQr'); if (qrEl) qrEl.src = qrUrl(landing, 220);
  }

  async function reload() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      await Promise.all([loadQuote(), loadBalance()]);
    } finally {
      state.refreshing = false;
      refresh();
    }
  }

  function passPayload(profile, amountUsd) {
    var address = walletAddress();
    return {
      schema: 'ost-card.v1',
      cardId: profile.cardId,
      handle: profile.handle,
      meshHandle: profile.meshHandle || profile.handle,
      wallet: address,
      asset: 'OST',
      network: String(window.OST_NETWORK || 'devnet'),
      defaultAmountUsd: Number(amountUsd) || readAmount(),
      usdPerOst: Number(state.usdPerOst) || DEFAULT_OST_USD,
      landingUrl: cardLandingUrl(profile, amountUsd),
      issuedAt: new Date().toISOString()
    };
  }

  async function tryServerPass(kind, payload) {
    var url = endpoints()[kind];
    if (!url) return null;
    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': kind === 'apple' ? 'application/vnd.apple.pkpass' : 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) return { ok: false, status: response.status };
      var contentType = response.headers.get('content-type') || '';
      if (contentType.indexOf('application/vnd.apple.pkpass') !== -1) {
        var blob = await response.blob();
        return { ok: true, kind: 'pkpass', blob: blob };
      }
      var json = await response.json();
      return { ok: true, kind: 'json', json: json };
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'request-failed' };
    }
  }

  function downloadFile(name, blobOrText, type) {
    var blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type || 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  async function addToAppleWallet() {
    var profile = ensureProfile();
    if (!profile) { setStatus('Connect a wallet first \u2014 the card needs a real OST address.', 'error'); return; }
    var amount = readAmount();
    var payload = passPayload(profile, amount);
    setStatus('Requesting signed Apple Wallet pass from relay...', 'warning');
    var result = await tryServerPass('apple', payload);
    if (result && result.ok && result.kind === 'pkpass') {
      downloadFile('ost-card-' + profile.cardId + '.pkpass', result.blob, 'application/vnd.apple.pkpass');
      setStatus('OST Card pass downloaded. Open it on your iPhone to add it to Apple Wallet.', 'success');
      return;
    }
    if (result && result.ok && result.kind === 'json' && result.json && result.json.url) {
      window.location.href = result.json.url; return;
    }
    // Fallback: ship the unsigned payload + iOS Shortcut path (works today,
    // no PassKit signing required). User uses Shortcuts to open the landing
    // page from a double-press of the side / Action button.
    downloadFile('ost-card-' + profile.cardId + '.json', JSON.stringify(payload, null, 2), 'application/json');
    var platform = detectPlatform();
    setStatus(platform.isIos
      ? 'Apple Wallet relay not enabled yet. Card payload downloaded \u2014 use "Install iOS Shortcut" to make a double-tap of the Action / Back-Tap open your OST Card instantly.'
      : 'Apple Wallet relay not enabled yet. Card payload downloaded for the issuer integration step. The iOS Shortcut path works today on any iPhone.',
      'warning');
  }

  async function addToGoogleWallet() {
    var profile = ensureProfile();
    if (!profile) { setStatus('Connect a wallet first.', 'error'); return; }
    var payload = passPayload(profile, readAmount());
    setStatus('Requesting Google Wallet save link from relay...', 'warning');
    var result = await tryServerPass('google', payload);
    if (result && result.ok && result.kind === 'json' && result.json && result.json.saveUrl) {
      if (window.openOstPopup) window.openOstPopup(result.json.saveUrl, 'OST Card \u2014 Google Wallet');
      else window.open(result.json.saveUrl, '_blank', 'noopener');
      setStatus('Google Wallet save link opened.', 'success');
      return;
    }
    downloadFile('ost-card-' + profile.cardId + '-google.json', JSON.stringify(payload, null, 2), 'application/json');
    setStatus('Google Wallet relay not enabled yet. Card payload downloaded \u2014 it can also be opened with the share sheet to add a home-screen shortcut on Android.', 'warning');
  }

  function showShortcutModal(profile, landing) {
    var existing = document.getElementById('ostCardShortcutModal');
    if (existing) existing.remove();
    var platform = detectPlatform();
    var modal = document.createElement('div');
    modal.id = 'ostCardShortcutModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,0.92);display:flex;align-items:center;justify-content:center;padding:18px;';
    var iosSteps = ''
      + '<ol style="margin:0;padding-left:20px;display:grid;gap:6px;font-size:.86rem;line-height:1.5;color:#e2e8f0;">'
      +   '<li>Open the <b>Shortcuts</b> app on this iPhone.</li>'
      +   '<li>Tap <b>+</b> &rarr; <b>Add Action</b> &rarr; search <b>Open URL</b>.</li>'
      +   '<li>Paste the link below into the URL field.</li>'
      +   '<li>Tap the title at the top, rename to <b>OST Card</b>, save.</li>'
      +   '<li>Settings &rarr; <b>Action Button</b> (15 Pro+) or <b>Accessibility &rarr; Touch &rarr; Back Tap</b> &rarr; bind to <b>Run Shortcut &rarr; OST Card</b>.</li>'
      + '</ol>';
    var androidSteps = ''
      + '<ol style="margin:0;padding-left:20px;display:grid;gap:6px;font-size:.86rem;line-height:1.5;color:#e2e8f0;">'
      +   '<li>Tap <b>Open landing page now</b> below.</li>'
      +   '<li>In Chrome, tap menu &rarr; <b>Add to Home screen</b>.</li>'
      +   '<li>Long-press the icon &rarr; bind to a <b>quick gesture</b> in Settings &rarr; Gestures (where supported).</li>'
      + '</ol>';
    var pcSteps = ''
      + '<ol style="margin:0;padding-left:20px;display:grid;gap:6px;font-size:.86rem;line-height:1.5;color:#e2e8f0;">'
      +   '<li>Bookmark the link below for instant access.</li>'
      +   '<li>Or scan the QR with your phone to install the shortcut there.</li>'
      + '</ol>';
    var steps = platform.isIos ? iosSteps : platform.isAndroid ? androidSteps : pcSteps;
    var heading = platform.isIos ? 'Add OST Card to Action Button / Back Tap'
                : platform.isAndroid ? 'Add OST Card shortcut on Android'
                : 'Install OST Card shortcut';
    var safeUrl = landing.replace(/"/g, '&quot;');
    modal.innerHTML = ''
      + '<div style="max-width:460px;width:100%;background:#0f172a;border:1px solid rgba(110,231,183,0.28);border-radius:20px;padding:22px;display:grid;gap:14px;color:#f8fafc;">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">'
      +     '<h3 style="margin:0;font-size:1.05rem;">' + heading + '</h3>'
      +     '<button id="ostShortcutCloseBtn" type="button" style="background:transparent;color:#94a3b8;border:0;font-size:1.4rem;cursor:pointer;line-height:1;">&times;</button>'
      +   '</div>'
      +   steps
      +   '<div style="display:flex;align-items:center;gap:10px;background:rgba(2,6,23,0.55);border:1px solid rgba(148,163,184,0.18);border-radius:12px;padding:10px 12px;">'
      +     '<input id="ostShortcutUrl" readonly value="' + safeUrl + '" style="flex:1;background:transparent;color:#e2e8f0;border:0;font-family:Consolas,Menlo,monospace;font-size:.78rem;outline:none;" />'
      +     '<button id="ostShortcutCopyBtn" type="button" class="btn btn-outline btn-sm">Copy</button>'
      +   '</div>'
      +   '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
      +     '<button id="ostShortcutOpenBtn" type="button" class="btn btn-primary btn-sm">Open landing page now</button>'
      +     (platform.isIos ? '<button id="ostShortcutTryAppBtn" type="button" class="btn btn-outline btn-sm">Open Shortcuts app</button>' : '')
      +     '<button id="ostShortcutQrBtn" type="button" class="btn btn-outline btn-sm">Show QR</button>'
      +   '</div>'
      +   '<div id="ostShortcutQrWrap" style="display:none;justify-content:center;"><img alt="OST Card QR" src="' + qrUrl(landing, 220) + '" style="width:200px;height:200px;border-radius:14px;background:#fff;padding:8px;" /></div>'
      +   '<p style="margin:0;font-size:.74rem;color:#94a3b8;line-height:1.45;">A signed .shortcut file requires Apple\u2019s relay; until then this manual recipe takes 30 seconds and works on every iPhone.</p>'
      + '</div>';
    document.body.appendChild(modal);
    function close() { modal.remove(); }
    modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
    var closeBtn = document.getElementById('ostShortcutCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var copyBtn = document.getElementById('ostShortcutCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var input = document.getElementById('ostShortcutUrl');
      if (!input) return;
      input.select();
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); });
        else { document.execCommand('copy'); copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); }
      } catch (_) {}
    });
    var openBtn = document.getElementById('ostShortcutOpenBtn');
    if (openBtn) openBtn.addEventListener('click', function () { window.open(landing, '_blank', 'noopener'); });
    var tryApp = document.getElementById('ostShortcutTryAppBtn');
    if (tryApp) tryApp.addEventListener('click', function () {
      try { window.location.href = 'shortcuts://create-shortcut'; } catch (_) {}
    });
    var qrBtn = document.getElementById('ostShortcutQrBtn');
    if (qrBtn) qrBtn.addEventListener('click', function () {
      var wrap = document.getElementById('ostShortcutQrWrap');
      if (!wrap) return;
      wrap.style.display = wrap.style.display === 'none' ? 'flex' : 'none';
    });
  }

  async function installShortcut() {
    var profile = ensureProfile();
    if (!profile) { setStatus('Connect a wallet first.', 'error'); return; }
    var landing = cardLandingUrl(profile, readAmount());
    var ep = endpoints();
    if (ep.shortcut) {
      var u = ep.shortcut + '?landing=' + encodeURIComponent(landing) + '&handle=' + encodeURIComponent(profile.handle || '');
      try { window.location.href = 'shortcuts://import-shortcut?url=' + encodeURIComponent(u) + '&name=OST%20Card'; } catch (_) {}
      setTimeout(function () {
        if (window.openOstPopup) window.openOstPopup(u, 'OST Card \u2014 iOS Shortcut');
        else window.open(u, '_blank', 'noopener');
      }, 800);
      setStatus('Opening signed iOS Shortcut. After install, assign it to Action Button / Back Tap.', 'success');
      return;
    }
    showShortcutModal(profile, landing);
    setStatus('Follow the steps in the popup to bind OST Card to a one-tap gesture.', 'success');
  }

  async function writeNfcTag() {
    var profile = ensureProfile();
    if (!profile) { setStatus('Connect a wallet first.', 'error'); return; }
    var landing = cardLandingUrl(profile, readAmount());
    var platform = detectPlatform();
    if (typeof window.NDEFReader === 'undefined') {
      if (platform.isIos) {
        setStatus('iPhone cannot WRITE NFC tags from a web page, but iOS reads them natively. Program the tag from any Android device or NFC Tools, then tap with iPhone to open the OST Card.', 'warning');
      } else if (platform.isMacSafari) {
        setStatus('Mac Safari cannot write NFC tags. Use Share \u2192 AirDrop or print the QR.', 'warning');
      } else {
        setStatus('Web NFC needs Android Chrome 89+. Use the QR / share fallback.', 'warning');
      }
      return;
    }
    try {
      var writer = new window.NDEFReader();
      setStatus('Hold an unlocked NFC tag near the back of the device...', 'warning');
      await writer.write({ records: [
        { recordType: 'url', data: landing },
        { recordType: 'text', data: 'OST Card \u2014 @' + (profile.handle || '') }
      ] });
      setStatus('OST Card written to tag. Tapping it on any iPhone or Android opens the live card with current OST balance + USD.', 'success');
    } catch (error) {
      setStatus('NFC write failed: ' + ((error && error.message) || 'unknown') + '.', 'error');
    }
  }

  async function shareCardLink() {
    var profile = ensureProfile();
    if (!profile) { setStatus('Connect a wallet first.', 'error'); return; }
    var landing = cardLandingUrl(profile, readAmount());
    if (navigator.share) {
      try {
        await navigator.share({ title: 'OST Card', text: 'My OST Card \u2014 @' + (profile.handle || ''), url: landing });
        setStatus('Card link shared.', 'success');
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(landing);
      setStatus('Card link copied to clipboard: ' + landing, 'success');
    } catch (_) {
      setStatus('Card link: ' + landing, 'warning');
    }
  }

  function openFullCard(walletOverride, amountOverride) {
    try {
      var profile = ensureProfile();
      var address = walletOverride || (profile && profile.wallet);
      if (!address) {
        setStatus('Connect a wallet first.', 'error');
        // Surface a visible toast even when the inline status row is not on screen.
        try { if (window.toast) window.toast('\u26A0', 'Connect a wallet to open the OST Card.'); } catch (_) {}
        if (window.setWalletPanel) try { window.setWalletPanel('access', { scroll: true }); } catch (_) {}
        return;
      }
      var amount = amountOverride || readAmount();
      var prev = document.getElementById('ostCardFullView');
      if (prev) prev.remove();
      var modal = document.createElement('div');
      modal.id = 'ostCardFullView';
      modal.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,23,0.92);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px);';
      var ost = Number(state.ostBalance) || 0;
      var usd = ost * (Number(state.usdPerOst) || DEFAULT_OST_USD);
      var landing = cardLandingUrl(profile || { wallet: address, handle: deriveHandle(address) }, amount);
      var handle = (profile && profile.handle) || deriveHandle(address);
      modal.innerHTML = ''
        + '<div style="max-width:420px;width:100%;display:grid;gap:14px;">'
        +   '<div style="position:relative;overflow:hidden;padding:24px;border-radius:24px;background:linear-gradient(135deg,#020617,#0f172a 55%,#0b3d2e);border:1px solid rgba(110,231,183,0.28);box-shadow:0 36px 80px rgba(2,6,23,0.6);color:#f8fafc;">'
        +     '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
        +       '<div>'
        +         '<div style="font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(226,232,240,0.7);">OST Card</div>'
        +         '<div style="margin-top:6px;font-size:1.34rem;font-weight:800;">@' + handle + '</div>'
        +       '</div>'
        +       '<div style="padding:6px 10px;border-radius:999px;background:rgba(110,231,183,0.18);color:#bbf7d0;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;">' + (String(window.OST_NETWORK || 'devnet')) + '</div>'
        +     '</div>'
        +     '<div style="margin-top:18px;display:flex;align-items:center;gap:14px;">'
        +       '<img alt="OST Card QR" src="' + qrUrl(landing, 260) + '" style="width:128px;height:128px;border-radius:16px;background:#fff;padding:8px;" />'
        +       '<div style="flex:1;">'
        +         '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(226,232,240,0.6);">Balance</div>'
        +         '<div style="font-size:1.6rem;font-weight:800;">' + ost.toFixed(2) + ' OST</div>'
        +         '<div style="font-size:.95rem;color:#bbf7d0;">~ $' + usd.toFixed(2) + ' USD</div>'
        +         '<div style="margin-top:8px;font-size:.78rem;color:rgba(226,232,240,0.7);">Pay request: $' + Number(amount).toFixed(2) + '</div>'
        +       '</div>'
        +     '</div>'
        +     '<div style="margin-top:18px;font-size:.74rem;color:rgba(226,232,240,0.7);word-break:break-all;font-family:\'SFMono-Regular\',Consolas,Menlo,monospace;">' + address + '</div>'
        +   '</div>'
        +   '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">'
        +     '<button class="btn btn-primary btn-sm" id="ostCardFullPay" type="button">Pay with OST</button>'
        +     '<button class="btn btn-outline btn-sm" id="ostCardFullCopy" type="button">Copy link</button>'
        +     '<button class="btn btn-outline btn-sm" id="ostCardFullClose" type="button">Close</button>'
        +   '</div>'
        + '</div>';
      document.body.appendChild(modal);
      function close() { modal.remove(); }
      modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
      var closeBtn = document.getElementById('ostCardFullClose');
      if (closeBtn) closeBtn.addEventListener('click', close);
      var copyBtn = document.getElementById('ostCardFullCopy');
      if (copyBtn) copyBtn.addEventListener('click', function () {
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(landing).then(function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1500); });
          else window.open(landing, '_blank', 'noopener');
        } catch (_) { window.open(landing, '_blank', 'noopener'); }
      });
      var payBtn = document.getElementById('ostCardFullPay');
      if (payBtn) payBtn.addEventListener('click', function () {
        try { window.OST_TAP_PAY = { to: address, amountUsd: amount, asset: 'OST' }; } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('ost:tap-pay-link', { detail: { to: address, amountUsd: amount } })); } catch (_) {}
        if (window.setWalletPanel) try { window.setWalletPanel('access', { scroll: true }); } catch (_) {}
        close();
      });
      console.log('[ost-card] openFullCard rendered for', address);
    } catch (err) {
      console.error('[ost-card] openFullCard failed:', err);
      try { if (window.toast) window.toast('\u26A0', 'OST Card open failed: ' + ((err && err.message) || err)); } catch (_) {}
    }
  }

  function ensureFloatingLauncher() {
    if (document.getElementById('ostCardFloatingBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'ostCardFloatingBtn';
    btn.type = 'button';
    btn.title = 'Open OST Card';
    btn.innerHTML = '\u25C9 OST Card';
    btn.style.cssText = [
      'position:fixed','right:14px','bottom:74px','z-index:2147483645',
      'padding:10px 14px','border-radius:999px','border:1px solid rgba(110,231,183,0.4)',
      'background:linear-gradient(135deg,#0b3d2e,#0f172a)','color:#bbf7d0',
      'font:700 12px/1 system-ui,sans-serif','cursor:pointer',
      'box-shadow:0 10px 30px rgba(2,6,23,0.55)','letter-spacing:.04em'
    ].join(';');
    btn.addEventListener('click', function () { openFullCard(); });
    if (document.body) document.body.appendChild(btn);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(btn); });
  }

  function applyCardLanding() {
    try {
      var params = new URLSearchParams(location.search);
      var address = (params.get('card') || '').trim();
      if (!address) return;
      var amount = Number(params.get('amount')) || 25;
      // Wait until balance/quote loaded before showing the modal so numbers are real.
      setTimeout(function () { openFullCard(address, amount); }, 600);
    } catch (_) {}
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    window.addEventListener('ost:wallet-changed', function () { ensureProfile(); reload(); });
    window.addEventListener('ost:topup-ready', reload);
    window.addEventListener('ost:network-changed', reload);
    setInterval(reload, 30000);
  }

  function init() {
    ensureCardUi();
    ensureFloatingLauncher();
    ensureProfile();
    bind();
    reload();
    applyCardLanding();
    window.OST_CARD = {
      ensureProfile: ensureProfile,
      currentProfile: readProfile,
      openFullCard: openFullCard,
      refresh: reload,
      passPayload: function (amount) {
        var p = ensureProfile();
        return p ? passPayload(p, amount || readAmount()) : null;
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
