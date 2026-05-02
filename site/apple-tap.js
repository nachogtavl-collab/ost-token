(function () {
  'use strict';

  const STORAGE_KEY = 'ost.apple.tap.amount.v1';
  const PUBLIC_SITE_URL = 'https://nachogtavl-collab.github.io/ost-token/';

  function $(id) {
    return document.getElementById(id);
  }

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
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch (_) {}
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

  function isAppleDevice() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && /Safari/i.test(ua));
  }

  function webNfcSupported() {
    return typeof window.NDEFReader !== 'undefined';
  }

  function applePayState() {
    if (typeof window.ApplePaySession === 'undefined') {
      return { label: 'Unavailable', tone: 'neutral' };
    }
    try {
      if (typeof window.ApplePaySession.canMakePayments === 'function' && window.ApplePaySession.canMakePayments()) {
        return { label: 'Ready', tone: 'success' };
      }
      return { label: 'Supported', tone: 'warning' };
    } catch (_) {
      return { label: 'Available', tone: 'warning' };
    }
  }

  function setTone(el, tone) {
    if (!el) return;
    el.style.color = tone === 'success'
      ? '#86efac'
      : tone === 'error'
        ? '#fca5a5'
        : tone === 'warning'
          ? '#fde68a'
          : 'var(--text-light)';
  }

  function setStatus(text, tone) {
    const el = $('ostAppleStatus');
    if (!el) return;
    el.textContent = text;
    setTone(el, tone);
  }

  async function loadTopupConfig() {
    if (!window.OST_TOPUP || typeof window.OST_TOPUP.loadConfig !== 'function') {
      return { stripeEnabled: false };
    }
    try {
      return await window.OST_TOPUP.loadConfig();
    } catch (_) {
      return { stripeEnabled: false };
    }
  }

  function tapPayload(address) {
    if (!address) return 'No wallet connected yet.';
    return [
      'OST:TAP:v1',
      'chain=solana',
      'asset=OST',
      'network=devnet',
      'wallet=' + address,
      'fallback=' + PUBLIC_SITE_URL + '#wallet'
    ].join(';');
  }

  function walletSlug(address) {
    const short = shortAddress(address || 'ost-card').replace(/[^a-z0-9]/gi, '').toLowerCase();
    return short || 'ostcard';
  }

  function issuerPacket(address, amount, config) {
    const applePay = applePayState();
    const slug = walletSlug(address);
    const generatedAt = new Date().toISOString();
    const serial = 'ost-' + slug + '-' + Date.now();
    const passTypeIdentifier = 'pass.com.ost.tapcard';
    const merchantIdentifier = 'merchant.com.ost.token';
    const organization = 'OST';
    const nfcMessage = address ? tapPayload(address) : null;
    return {
      version: 1,
      bundleType: 'ost-apple-wallet-program',
      product: 'OST Tap Card',
      generatedAt,
      walletAddress: address || null,
      checkoutUsd: amount,
      network: 'Solana devnet',
      asset: 'OST',
      rails: {
        stripeCheckout: !!(config && config.stripeEnabled),
        applePayWeb: applePay.label,
        webNfc: webNfcSupported()
      },
      nfcPayload: nfcMessage,
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
        applePayWebStatus: applePay.label,
        requiredSecrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
        domainVerification: 'Register and verify the domain in Stripe Apple Pay settings before expecting Apple Pay to surface in hosted checkout.'
      },
      walletPass: {
        passTypeIdentifier,
        teamIdentifier: '<apple-developer-team-id-required>',
        organizationName: organization,
        serialNumber: serial,
        description: 'OST Tap Card',
        logoText: 'OST',
        foregroundColor: 'rgb(248,250,252)',
        backgroundColor: 'rgb(7,17,31)',
        labelColor: 'rgb(148,163,184)',
        formatVersion: 1,
        webServiceURL: '<issuer-wallet-web-service-url-required>',
        authenticationToken: '<wallet-pass-auth-token-required>',
        associatedStoreIdentifiers: [],
        generic: {
          primaryFields: [
            { key: 'ost', label: 'Wallet', value: address || 'Connect wallet' }
          ],
          secondaryFields: [
            { key: 'network', label: 'Network', value: 'Solana devnet' },
            { key: 'asset', label: 'Asset', value: 'OST' }
          ],
          auxiliaryFields: [
            { key: 'checkout', label: 'Checkout', value: '$' + Number(amount || 0).toFixed(2) },
            { key: 'site', label: 'Site', value: 'nachogtavl-collab.github.io' }
          ],
          backFields: [
            { key: 'mint', label: 'OST Mint', value: '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ' },
            { key: 'program', label: 'Program', value: 'J2jiS296YWVie1Sopb4SxcM3aJnP9aAwe6aLDhCqvGXY' },
            { key: 'fallback', label: 'Fallback URL', value: PUBLIC_SITE_URL + '#wallet' }
          ]
        },
        nfc: nfcMessage ? {
          message: nfcMessage,
          encryptionPublicKey: '<apple-wallet-nfc-encryption-key-required>',
          requiresAuthentication: false
        } : null,
        assets: {
          icon: 'icon-192.png',
          logo: 'ost-logo.svg',
          strip: '<optional-brand-strip-image>'
        }
      },
      paymentPassProvisioning: {
        feasibleFromWebsiteOnly: false,
        requirement: 'Native issuer app or approved issuer provisioning flow required.',
        appleEntitlements: [
          'com.apple.developer.payment-pass-provisioning',
          'com.apple.developer.pass-type-identifiers'
        ],
        requiredInputs: [
          'issuer certificate chain',
          'card art approved by Apple and network',
          'encrypted card payload / activation data',
          'primary account identifier from issuer processor',
          'network tokenization approval'
        ]
      },
      deliverables: {
        tapPayload: nfcMessage,
        passJsonTemplate: {
          formatVersion: 1,
          passTypeIdentifier,
          serialNumber: serial,
          teamIdentifier: '<apple-developer-team-id-required>',
          organizationName: organization,
          description: 'OST Tap Card',
          logoText: 'OST',
          foregroundColor: 'rgb(248,250,252)',
          backgroundColor: 'rgb(7,17,31)',
          labelColor: 'rgb(148,163,184)'
        },
        applePayReadinessChecklist: [
          'Set STRIPE_SECRET_KEY on Cloudflare Pages',
          'Set STRIPE_WEBHOOK_SECRET on Cloudflare Pages',
          'Configure Stripe webhook for /topup/stripe/webhook',
          'Verify nachogtavl-collab.github.io for Apple Pay in Stripe',
          'Open hosted checkout on Safari with an Apple Wallet card present',
          'For native card provisioning, secure issuer + network + Apple approval'
        ]
      },
      apple: {
        currentWebFlow: 'Stripe-hosted checkout can present Apple Pay on supported Safari when enabled by Stripe and the merchant domain is verified.',
        walletPass: 'Requires PassKit signing certificate and wallet-pass packaging.',
        paymentCardProvisioning: 'Requires issuer sponsorship, payment-network tokenization, and Apple approval.',
        nfcCardEmulation: 'Not available to ordinary web apps on iPhone.'
      }
    };
  }

  async function refresh() {
    const address = walletAddress();
    const config = await loadTopupConfig();
    const amount = readAmount();
    const apple = applePayState();
    const appleDevice = isAppleDevice();
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
      sublineEl.textContent = address
        ? 'Linked wallet: ' + address
        : 'Connect or create a wallet first, then this card packages its tap payload and opens hosted checkout.';
    }

    if (deviceEl) {
      deviceEl.textContent = appleDevice ? 'Apple detected' : 'Non-Apple / unknown';
      setTone(deviceEl, appleDevice ? 'success' : 'warning');
    }
    if (payEl) {
      payEl.textContent = apple.label;
      setTone(payEl, apple.tone);
    }
    if (stripeEl) {
      stripeEl.textContent = config && config.stripeEnabled ? 'Live' : 'Offline';
      setTone(stripeEl, config && config.stripeEnabled ? 'success' : 'warning');
    }
    if (nfcEl) {
      nfcEl.textContent = nfc ? 'Available' : 'Restricted';
      setTone(nfcEl, nfc ? 'success' : 'warning');
    }
    if (payloadEl) {
      payloadEl.textContent = tapPayload(address);
    }
    if (payBtn) {
      payBtn.disabled = !address || !(config && config.stripeEnabled);
      payBtn.textContent = apple.label === 'Ready'
        ? 'Open Apple Pay Checkout'
        : 'Open Apple Pay / Card Checkout';
    }

    if (!address) {
      setStatus('Connect a wallet first. This card binds Apple checkout and tap payload packaging to a real OST receive address.', 'warning');
      return;
    }
    if (!(config && config.stripeEnabled)) {
      setStatus('Stripe card checkout is not enabled in the worker config yet. The tap payload is ready, but Apple Pay cannot be offered until the card rail is live.', 'warning');
      return;
    }
    if (apple.label === 'Ready') {
      setStatus('This device can attempt Apple Pay through hosted Stripe checkout. Tap checkout to buy OST into the connected wallet.', 'success');
      return;
    }
    setStatus('Card checkout is live. On compatible Safari with Apple Wallet cards provisioned, Stripe Checkout can surface Apple Pay automatically.', 'neutral');
  }

  async function openCheckout() {
    const address = walletAddress();
    if (!address) {
      if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
      setStatus('Connect a wallet first. Apple checkout needs a real OST destination address.', 'error');
      return;
    }
    if (!window.OST_TOPUP || typeof window.OST_TOPUP.createIntent !== 'function' || typeof window.OST_TOPUP.createCheckout !== 'function') {
      setStatus('The live payment rail is still loading. Refresh and try again.', 'error');
      return;
    }

    const amount = readAmount();
    writeAmount(amount);
    setStatus('Creating secure checkout...', 'warning');
    try {
      const intent = await window.OST_TOPUP.createIntent({ usd: amount, wallet: address, method: 'stripe' });
      const checkout = await window.OST_TOPUP.createCheckout(intent.id);
      if (!checkout || !checkout.url) throw new Error('No checkout URL returned.');
      window.location.href = checkout.url;
    } catch (error) {
      setStatus((error && error.message) || 'Could not open checkout.', 'error');
    }
  }

  function openReceiveRail() {
    if (window.setWalletPanel) window.setWalletPanel('access', { scroll: true });
    const receiveBtn = $('wdReceiveBtn');
    if (receiveBtn) receiveBtn.click();
    setStatus('Receive rail opened. Use the QR/address as the fallback tap target for Apple devices.', 'success');
  }

  async function copyPayload() {
    const address = walletAddress();
    if (!address) {
      setStatus('Connect a wallet first so the tap payload points at a real OST address.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(tapPayload(address));
      setStatus('Tap payload copied. This can be written into an NFC tag or used by a future Wallet pass issuer flow.', 'success');
    } catch (_) {
      setStatus('Clipboard write failed. Copy the payload manually from the box below.', 'error');
    }
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
    setStatus('Issuer packet downloaded. Hand this to the Wallet / issuer integration layer for real Apple Pay card provisioning work.', 'success');
  }

  function init() {
    const amountInput = $('ostAppleUsdInput');
    const payBtn = $('ostApplePayBtn');
    const receiveBtn = $('ostAppleReceiveBtn');
    const copyBtn = $('ostAppleCopyPayloadBtn');
    const packetBtn = $('ostApplePacketBtn');
    if (!amountInput || !payBtn) return;

    amountInput.value = String(readAmount());
    amountInput.addEventListener('change', function () {
      const amount = readAmount();
      amountInput.value = String(amount);
      writeAmount(amount);
      refresh();
    });
    amountInput.addEventListener('input', function () {
      writeAmount(readAmount());
    });

    payBtn.addEventListener('click', openCheckout);
    if (receiveBtn) receiveBtn.addEventListener('click', openReceiveRail);
    if (copyBtn) copyBtn.addEventListener('click', copyPayload);
    if (packetBtn) packetBtn.addEventListener('click', downloadPacket);

    window.addEventListener('ost:wallet-changed', refresh);
    window.addEventListener('ost:topup-ready', refresh);
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();