(function () {
  'use strict';

  const STORAGE_KEY = 'ost.apple.tap.amount.v1';
  const PUBLIC_SITE_URL = 'https://nachogtavl-collab.github.io/ost-token/';
  const ONRAMPER_APPLE_PAY = 'https://buy.onramper.com/?defaultCrypto=sol_solana&onlyCryptoNetworks=solana&defaultPaymentMethod=applepay&mode=buy';

  function $(id) { return document.getElementById(id); }

  function shortAddress(value) {
    const s = String(value || '').trim();
    return s ? s.slice(0, 6) + '...' + s.slice(-6) : 'Connect a wallet';
  }

  function readAmount() {
    const input = $('ostAppleUsdInput');
    const raw = input ? Number(input.value) : Number(localStorage.getItem(STORAGE_KEY) || 25);
    if (!Number.isFinite(raw) || raw <= 0) return 25;
    return Math.min(Math.max(Math.round(raw * 100) / 100, 1), 5000);
  }

  function writeAmount(value) {
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch (_) {}
  }

  function walletAddress() {
    try {
      if (window.OST_WALLET) {
        if (window.OST_WALLET.address) return String(window.OST_WALLET.address).trim();
        const session = window.OST_WALLET.session;
        if (session && session.publicKey && typeof session.publicKey.toBase58 === 'function') {
          return session.publicKey.toBase58();
        }
      }
    } catch (_) {}
    return String(window.OST_CONNECTED_WALLET || '').trim();
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isIos = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMacSafari = /Mac/i.test(platform) && /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(ua);
    const isApple = isIos || isMacSafari;
    const isAndroid = /Android/i.test(ua);
    const isChromeAndroid = isAndroid && /Chrome/i.test(ua) && !/EdgiOS|FxiOS/i.test(ua);
    return { isIos, isMacSafari, isApple, isAndroid, isChromeAndroid };
  }

  function webNfcSupported() { return typeof window.NDEFReader !== 'undefined'; }

  function applePayState() {
    if (typeof window.ApplePaySession === 'undefined') return { label: 'Unavailable', tone: 'neutral', ready: false };
    try {
      if (typeof window.ApplePaySession.canMakePayments === 'function' && window.ApplePaySession.canMakePayments()) {
        return { label: 'Ready', tone: 'success', ready: true };
      }
      return { label: 'Supported', tone: 'warning', ready: false };
    } catch (_) {
      return { label: 'Available', tone: 'warning', ready: false };
    }
  }

  function setTone(el, tone) {
    if (!el) return;
    el.style.color = tone === 'success' ? '#86efac'
      : tone === 'error' ? '#fca5a5'
      : tone === 'warning' ? '#fde68a'
      : 'var(--text-light)';
  }

  function setStatus(text, tone) {
    const el = $('ostAppleStatus');
    if (!el) return;
    el.textContent = text;
    setTone(el, tone);
  }

  async function loadTopupConfig() {
    if (!window.OST_TOPUP || typeof window.OST_TOPUP.loadConfig !== 'function') return { stripeEnabled: false };
    try { return await window.OST_TOPUP.loadConfig(); } catch (_) { return { stripeEnabled: false }; }
  }

  // Universal pay URL. iPhones (iOS 14+) read this directly from any NFC tag
  // programmed with it; Android Chrome scans it via Web NFC; cameras pick it
  // up as a QR. The OST landing handler uses ?pay= and ?amount=.
  function payUrl(address, amountUsd) {
    if (!address) return PUBLIC_SITE_URL + '#wallet';
    const params = new URLSearchParams();
    params.set('pay', address);
    if (amountUsd && Number.isFinite(Number(amountUsd))) params.set('amount', String(amountUsd));
    params.set('asset', 'OST');
    return PUBLIC_SITE_URL + '?' + params.toString() + '#wallet';
  }

  function tapPayload(address, amountUsd) {
    if (!address) return 'No wallet connected yet.';
    return [
      'OST:TAP:v1',
      'chain=solana',
      'asset=OST',
      'network=' + (window.OST_NETWORK || 'devnet'),
      'wallet=' + address,
      amountUsd ? 'amountUsd=' + amountUsd : 'amountUsd=open',
      'url=' + payUrl(address, amountUsd)
    ].join(';');
  }

  function qrImageUrl(text, size) {
    const px = size || 220;
    return 'https://api.qrserver.com/v1/create-qr-code/?size=' + px + 'x' + px + '&data=' + encodeURIComponent(text);
  }

  function walletSlug(address) {
    const short = shortAddress(address || 'ost-card').replace(/[^a-z0-9]/gi, '').toLowerCase();
    return short || 'ostcard';
  }

  function issuerPacket(address, amount, config) {
    const apple = applePayState();
    const slug = walletSlug(address);
    const generatedAt = new Date().toISOString();
    const serial = 'ost-' + slug + '-' + Date.now();
    const passTypeIdentifier = 'pass.com.ost.tapcard';
    const merchantIdentifier = 'merchant.com.ost.token';
    const url = payUrl(address, amount);
    const nfcMessage = address ? tapPayload(address, amount) : null;
    return {
      version: 2,
      bundleType: 'ost-apple-wallet-program',
      product: 'OST Tap Card',
      generatedAt,
      walletAddress: address || null,
      checkoutUsd: amount,
      payUrl: url,
      qrCode: qrImageUrl(url, 480),
      network: window.OST_NETWORK === 'mainnet-beta' ? 'Solana Mainnet' : 'Solana devnet',
      asset: 'OST',
      rails: {
        stripeCheckout: !!(config && config.stripeEnabled),
        applePayWeb: apple.label,
        webNfc: webNfcSupported(),
        appleWalletPass: 'requires PassKit signing certificate'
      },
      nfcPayload: nfcMessage,
      nfcTagUrl: url,
      issuerProgram: {
        programName: 'OST Tap Card',
        sponsorBank: '<required>',
        network: '<visa-or-mastercard-required>',
        issuerProcessor: '<required>',
        tokenServiceProvider: '<network-tokenization-provider-required>',
        regions: ['US'],
        binSponsor: '<required>',
        kycProvider: '<required>',
        settlementAsset: 'OST',
        settlementRail: 'Solana Token-2022 / OST mint',
        treasuryReceiver: (config && config.receivers && config.receivers.solMainnet) || null
      },
      merchantWebCheckout: {
        publicSiteUrl: PUBLIC_SITE_URL,
        merchantIdentifier,
        merchantDomain: 'nachogtavl-collab.github.io',
        stripeEnabled: !!(config && config.stripeEnabled),
        applePayWebStatus: apple.label,
        requiredSecrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
        domainVerification: 'Register and verify the domain in Stripe Apple Pay settings before expecting Apple Pay to surface in hosted checkout.'
      },
      walletPass: {
        passTypeIdentifier,
        teamIdentifier: '<apple-developer-team-id-required>',
        organizationName: 'OST',
        serialNumber: serial,
        description: 'OST Tap Card',
        logoText: 'OST',
        foregroundColor: 'rgb(248,250,252)',
        backgroundColor: 'rgb(7,17,31)',
        labelColor: 'rgb(148,163,184)',
        formatVersion: 1,
        webServiceURL: '<issuer-wallet-web-service-url-required>',
        authenticationToken: '<wallet-pass-auth-token-required>',
        nfc: nfcMessage ? { message: nfcMessage, encryptionPublicKey: '<apple-wallet-nfc-encryption-key-required>', requiresAuthentication: false } : null
      },
      paymentPassProvisioning: {
        feasibleFromWebsiteOnly: false,
        requirement: 'Native issuer app or approved issuer provisioning flow required for in-Wallet card.'
      }
    };
  }

  function ensureNfcUi() {
    var host = $('ostAppleTapPayload');
    if (!host) return null;
    var card = $('ostAppleNfcCard');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'ostAppleNfcCard';
    card.style.cssText = 'margin-top:12px;padding:14px;border-radius:14px;background:rgba(2,6,23,0.55);border:1px solid rgba(148,163,184,0.18);display:grid;gap:10px;';
    card.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">'
      +   '<strong style="font-size:.92rem;color:#f8fafc;">Universal tap-to-pay</strong>'
      +   '<span id="ostAppleNfcModeBadge" style="font-size:.7rem;padding:3px 10px;border-radius:999px;background:rgba(110,231,183,.12);color:#86efac;border:1px solid rgba(110,231,183,.25);">Apple-ready</span>'
      + '</div>'
      + '<p id="ostAppleNfcExplain" style="margin:0;font-size:.82rem;line-height:1.5;color:rgba(226,232,240,0.78);"></p>'
      + '<div style="display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;">'
      +   '<img id="ostAppleNfcQr" alt="OST tap-to-pay QR" width="160" height="160" style="border-radius:12px;background:#fff;padding:8px;min-width:160px;">'
      +   '<div style="display:grid;gap:6px;font-size:.78rem;color:rgba(226,232,240,0.78);word-break:break-all;">'
      +     '<span style="color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;font-size:.68rem;">Tap / scan opens</span>'
      +     '<a id="ostAppleNfcUrl" href="#connectWalletBtn" style="color:#7dd3fc;text-decoration:none;"></a>'
      +   '</div>'
      + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
      +   '<button class="btn btn-outline btn-sm" id="ostAppleNfcShareBtn" type="button">Share / AirDrop</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostAppleNfcCopyUrlBtn" type="button">Copy pay link</button>'
      +   '<button class="btn btn-outline btn-sm" id="ostAppleNfcWriteBtn" type="button">Write to NFC tag</button>'
      + '</div>';
    host.parentNode.insertBefore(card, host.nextSibling);
    var shareBtn = $('ostAppleNfcShareBtn');
    var copyBtn = $('ostAppleNfcCopyUrlBtn');
    var writeBtn = $('ostAppleNfcWriteBtn');
    if (shareBtn) shareBtn.addEventListener('click', shareTap);
    if (copyBtn) copyBtn.addEventListener('click', copyPayUrl);
    if (writeBtn) writeBtn.addEventListener('click', writeNfcTag);
    return card;
  }

  async function shareTap() {
    const address = walletAddress();
    if (!address) { setStatus('Connect a wallet first.', 'error'); return; }
    const url = payUrl(address, readAmount());
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pay with OST', text: 'Tap to pay ' + shortAddress(address) + ' with OST.', url });
        setStatus('Share sheet opened. iPhone users can AirDrop, Messages, or save the link as an NFC shortcut.', 'success');
        return;
      } catch (_) { /* user cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); setStatus('Pay link copied (Web Share unavailable).', 'success'); }
    catch (_) { setStatus('Copy or share failed.', 'error'); }
  }

  async function copyPayUrl() {
    const address = walletAddress();
    if (!address) { setStatus('Connect a wallet first.', 'error'); return; }
    try { await navigator.clipboard.writeText(payUrl(address, readAmount())); setStatus('Pay link copied. Paste into Shortcuts or NFC writer.', 'success'); }
    catch (_) { setStatus('Clipboard write failed.', 'error'); }
  }

  async function writeNfcTag() {
    const platform = detectPlatform();
    const address = walletAddress();
    if (!address) { setStatus('Connect a wallet first.', 'error'); return; }
    const url = payUrl(address, readAmount());
    if (!webNfcSupported()) {
      // Replace the old "not compatible with browser" with platform-specific
      // guidance that explains what *will* work.
      if (platform.isIos) {
        setStatus('iPhone cannot write NFC tags from a web page, but it can READ any tag programmed with the link below. Use an Android phone, an NFC writer app, or a Flipper Zero to write the link, then any iPhone (iOS 14+) can tap it.', 'warning');
      } else if (platform.isMacSafari) {
        setStatus('Mac Safari has no NFC radio. Use Share to AirDrop the pay link to an iPhone, then Save to Files / Shortcuts and program a tag from there.', 'warning');
      } else {
        setStatus('Web NFC writing requires Chrome or Edge on Android. The pay link below still works as a QR, AirDrop, or any NFC tag pre-programmed with the URL.', 'warning');
      }
      return;
    }
    try {
      const reader = new window.NDEFReader();
      await reader.write({ records: [{ recordType: 'url', data: url }, { recordType: 'text', data: tapPayload(address, readAmount()) }] });
      setStatus('Tag programmed. Tap it with any iPhone (iOS 14+) or Android to start an OST payment.', 'success');
    } catch (error) {
      setStatus('NFC write failed: ' + (error && error.message ? error.message : 'unknown'), 'error');
    }
  }

  function refreshNfcCard(address, amount, platform) {
    var card = ensureNfcUi();
    if (!card) return;
    var explain = $('ostAppleNfcExplain');
    var badge = $('ostAppleNfcModeBadge');
    var qrImg = $('ostAppleNfcQr');
    var urlEl = $('ostAppleNfcUrl');
    var writeBtn = $('ostAppleNfcWriteBtn');
    var url = payUrl(address, amount);
    if (qrImg) qrImg.src = qrImageUrl(url, 320);
    if (urlEl) {
      urlEl.href = address ? url : '#connectWalletBtn';
      urlEl.textContent = address ? url : 'Connect a wallet to generate a pay link';
    }
    if (badge) {
      if (platform.isIos) { badge.textContent = 'iPhone-ready (read NFC)'; badge.style.color = '#86efac'; }
      else if (platform.isMacSafari) { badge.textContent = 'Mac Safari (use Share)'; badge.style.color = '#fde68a'; }
      else if (webNfcSupported()) { badge.textContent = 'Android NFC live'; badge.style.color = '#86efac'; }
      else { badge.textContent = 'QR + Share'; badge.style.color = '#fde68a'; }
    }
    if (writeBtn) writeBtn.disabled = !address;
    if (!explain) return;
    if (!address) {
      explain.textContent = 'Connect a wallet first. The QR / NFC payload will then point at your real OST receive address.';
      return;
    }
    if (platform.isIos) {
      explain.textContent = 'iPhone (iOS 14+) reads NFC tags natively from the lock screen \u2014 tap any tag programmed with the link below and Safari opens the OST wallet with the send form pre-filled. Buyers can also scan the QR with the Camera app.';
    } else if (platform.isMacSafari) {
      explain.textContent = 'macOS has no NFC radio, but the QR is universal: any iPhone or Android camera scans it and lands on the OST send screen. Use Share to AirDrop the link to an iPhone for tag programming.';
    } else if (platform.isChromeAndroid) {
      explain.textContent = 'Android Chrome can both write tags (Write to NFC tag) and read tags into the OST wallet. iPhones can read the same tags natively.';
    } else {
      explain.textContent = 'This browser cannot drive NFC directly, but the QR + Share / Copy link buttons work on every device. iPhones read NFC tags programmed with this link natively.';
    }
  }

  async function refresh() {
    const address = walletAddress();
    const config = await loadTopupConfig();
    const amount = readAmount();
    const apple = applePayState();
    const platform = detectPlatform();
    const nfc = webNfcSupported();

    const walletEl = $('ostAppleCardWallet');
    const sublineEl = $('ostAppleCardSubline');
    const deviceEl = $('ostAppleDeviceState');
    const payEl = $('ostApplePayState');
    const stripeEl = $('ostAppleStripeState');
    const nfcEl = $('ostAppleNfcState');
    const payloadEl = $('ostAppleTapPayload');
    const payBtn = $('ostApplePayBtn');

    if (walletEl) walletEl.textContent = address ? shortAddress(address) : 'Connect a wallet';
    if (sublineEl) {
      sublineEl.textContent = address ? 'Linked wallet: ' + address
        : 'Connect or create a wallet first, then this card packages its tap payload and opens hosted checkout.';
    }
    if (deviceEl) {
      var deviceLabel = platform.isIos ? 'iPhone / iPad'
        : platform.isMacSafari ? 'Mac (Safari)'
        : platform.isChromeAndroid ? 'Android Chrome'
        : platform.isAndroid ? 'Android' : 'Desktop / Other';
      deviceEl.textContent = deviceLabel;
      setTone(deviceEl, platform.isApple ? 'success' : platform.isChromeAndroid ? 'success' : 'warning');
    }
    if (payEl) {
      // On Apple devices, Apple Pay reaches through Stripe-hosted checkout or
      // Onramper even when ApplePaySession is not directly available; treat as
      // Ready instead of "Unavailable" so the user sees a working button.
      var label = apple.label;
      var tone = apple.tone;
      if (platform.isApple && label === 'Unavailable') { label = 'Ready (via Stripe / Onramper)'; tone = 'success'; }
      payEl.textContent = label;
      setTone(payEl, tone);
    }
    if (stripeEl) {
      stripeEl.textContent = config && config.stripeEnabled ? 'Live' : 'Onramper fallback';
      setTone(stripeEl, config && config.stripeEnabled ? 'success' : 'warning');
    }
    if (nfcEl) {
      // Replace the legacy "Restricted" with platform-aware status.
      if (nfc) { nfcEl.textContent = 'Read + write live'; setTone(nfcEl, 'success'); }
      else if (platform.isIos) { nfcEl.textContent = 'Read tags natively'; setTone(nfcEl, 'success'); }
      else if (platform.isMacSafari) { nfcEl.textContent = 'AirDrop / QR'; setTone(nfcEl, 'warning'); }
      else { nfcEl.textContent = 'QR + Share fallback'; setTone(nfcEl, 'warning'); }
    }
    if (payloadEl) payloadEl.textContent = tapPayload(address, amount);
    if (payBtn) {
      payBtn.disabled = !address;
      payBtn.textContent = (config && config.stripeEnabled)
        ? (platform.isApple ? 'Open Apple Pay Checkout' : 'Open Card / Apple Pay Checkout')
        : (platform.isApple ? 'Open Apple Pay (Onramper)' : 'Open Card Checkout (Onramper)');
    }

    refreshNfcCard(address, amount, platform);

    if (!address) {
      setStatus('Connect a wallet first. Apple Pay top-ups, the tap payload, and the QR / NFC link all bind to your real OST receive address.', 'warning');
      return;
    }
    if (config && config.stripeEnabled) {
      setStatus(platform.isApple
        ? 'Apple Pay is live through Stripe-hosted checkout. Tap the button to buy OST straight into your wallet.'
        : 'Card / Apple Pay checkout live via Stripe. Apple devices will see Apple Pay automatically.', 'success');
    } else {
      setStatus(platform.isApple
        ? 'Stripe rail not enabled \u2014 falling back to Onramper, which surfaces Apple Pay on iPhone, iPad, and Mac Safari.'
        : 'Stripe rail not enabled \u2014 Onramper card / Apple Pay checkout is wired up as a fallback.', 'warning');
    }
  }

  async function openCheckout() {
    const address = walletAddress();
    if (!address) {
      if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
      setStatus('Connect a wallet first. Apple checkout needs a real OST destination address.', 'error');
      return;
    }
    const amount = readAmount();
    writeAmount(amount);
    const config = await loadTopupConfig();
    if (config && config.stripeEnabled && window.OST_TOPUP && typeof window.OST_TOPUP.createIntent === 'function') {
      setStatus('Opening Apple Pay / card checkout...', 'warning');
      try {
        const intent = await window.OST_TOPUP.createIntent({ usd: amount, wallet: address, method: 'stripe' });
        const checkout = await window.OST_TOPUP.createCheckout(intent.id);
        if (!checkout || !checkout.url) throw new Error('No checkout URL returned.');
        window.location.href = checkout.url;
        return;
      } catch (error) {
        setStatus('Stripe checkout failed (' + ((error && error.message) || 'unknown') + '). Falling back to Onramper.', 'warning');
      }
    }
    var url = ONRAMPER_APPLE_PAY + '&defaultAmount=' + encodeURIComponent(amount) + '&wallet=' + encodeURIComponent(address);
    setStatus('Opening Onramper Apple Pay rail...', 'success');
    if (window.openOstPopup) window.openOstPopup(url, 'OST \u2014 Apple Pay');
    else window.open(url, '_blank', 'noopener');
  }

  function openReceiveRail() {
    if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
    const receiveBtn = $('wdReceiveBtn');
    if (receiveBtn) receiveBtn.click();
    setStatus('Receive rail opened. Use the QR / address as the fallback tap target for Apple devices.', 'success');
  }

  async function copyPayload() {
    const address = walletAddress();
    if (!address) { setStatus('Connect a wallet first so the tap payload points at a real OST address.', 'error'); return; }
    try {
      await navigator.clipboard.writeText(tapPayload(address, readAmount()));
      setStatus('Tap payload copied. Write it to an NFC tag (Android NFC Tools / Flipper) or hand it to a Wallet pass issuer.', 'success');
    } catch (_) { setStatus('Clipboard write failed. Copy the payload manually from the box below.', 'error'); }
  }

  async function downloadPacket() {
    const address = walletAddress();
    const config = await loadTopupConfig();
    const amount = readAmount();
    const packet = issuerPacket(address, amount, config);
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ost-apple-tap-card.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus('Issuer packet downloaded. Hand this to the Wallet / issuer integration layer for native Apple Pay card provisioning work.', 'success');
  }

  // Tap-to-pay landing: when opened from an NFC tag or QR scan
  // (?pay=<address>&amount=<usd>), surface a one-tap pay banner.
  function applyPayLink() {
    try {
      const params = new URLSearchParams(location.search);
      const to = (params.get('pay') || '').trim();
      if (!to) return;
      const amount = params.get('amount') || '';
      if (document.getElementById('ostTapPayBanner')) return;
      const banner = document.createElement('div');
      banner.id = 'ostTapPayBanner';
      banner.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;max-width:560px;width:calc(100% - 24px);padding:14px 18px;border-radius:18px;background:linear-gradient(135deg,#0f2742,#124c3a);border:1px solid rgba(110,231,183,0.32);box-shadow:0 18px 48px rgba(2,6,23,0.55);color:#f8fafc;display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
      banner.innerHTML = ''
        + '<div style="flex:1;min-width:200px;">'
        +   '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#86efac;">Tap-to-Pay link</div>'
        +   '<div style="margin-top:4px;font-weight:700;font-size:.95rem;word-break:break-all;">' + (amount ? '$' + amount + ' \u2192 ' : '') + (to.slice(0, 6) + '...' + to.slice(-6)) + '</div>'
        + '</div>'
        + '<button id="ostTapPayOpenBtn" class="btn btn-primary btn-sm" type="button">Open OST send</button>'
        + '<button id="ostTapPayDismissBtn" class="btn btn-outline btn-sm" type="button" aria-label="Dismiss">\u00d7</button>';
      document.body.appendChild(banner);
      $('ostTapPayDismissBtn').onclick = function () { banner.remove(); };
      $('ostTapPayOpenBtn').onclick = function () {
        try { location.hash = '#wallet'; } catch (_) {}
        if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
        window.OST_TAP_PAY = { to, amountUsd: amount, asset: 'OST' };
        try { window.dispatchEvent(new CustomEvent('ost:tap-pay-link', { detail: { to, amountUsd: amount } })); } catch (_) {}
        banner.remove();
      };
    } catch (_) {}
  }

  function init() {
    const amountInput = $('ostAppleUsdInput');
    const payBtn = $('ostApplePayBtn');
    const receiveBtn = $('ostAppleReceiveBtn');
    const copyBtn = $('ostAppleCopyPayloadBtn');
    const packetBtn = $('ostApplePacketBtn');
    if (!amountInput || !payBtn) { applyPayLink(); return; }

    amountInput.value = String(readAmount());
    amountInput.addEventListener('change', function () {
      const amount = readAmount();
      amountInput.value = String(amount);
      writeAmount(amount);
      refresh();
    });
    amountInput.addEventListener('input', function () { writeAmount(readAmount()); });

    payBtn.addEventListener('click', openCheckout);
    if (receiveBtn) receiveBtn.addEventListener('click', openReceiveRail);
    if (copyBtn) copyBtn.addEventListener('click', copyPayload);
    if (packetBtn) packetBtn.addEventListener('click', downloadPacket);

    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:topup-ready', refresh);
    refresh();
    applyPayLink();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
