/* ============================================================
 * OST Offline Vault
 * ============================================================
 * Local bearer-token vault for PWA offline play.
 *
 * What is live in this file:
 * - IndexedDB vault storage, encrypted with Web Crypto AES-GCM.
 * - Import from digital file, paste, BarcodeDetector QR, or Web NFC.
 * - Bearer-token integrity verification for OST-BEARER-V1 payloads.
 * - Legacy import support for the existing Survival Bearer Token text file.
 * - Game hooks: getBalance/debit/credit/recordGameResult for ost-games.js.
 * - Offline sync queue: sends local proofs to /offline-vault/sync when online.
 *
 * Important honesty boundary:
 * V1 local tokens verify device integrity and replay protection offline. Final
 * issuer authenticity + on-chain settlement still happens during sync.
 * ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'ost-offline-vault-db';
  var DB_VERSION = 1;
  var STORE = 'secure';
  var VAULT_KEY = 'vault';
  var SECRET_KEY = 'ost.offlineVault.secret.v1';
  var SALT_KEY = 'ost.offlineVault.salt.v1';
  var DEVICE_KEY = 'ost.offlineVault.deviceId.v1';
  var OST_MINT = '383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ';

  var vault = {
    balance: 0,
    backed: 0,      // portion of balance actually debited from real OST — only
                    // this much may ever redeem back to spendable OST. Prevents
                    // unbacked "devnet" notes from being minted into real money.
    active: false,
    tokens: [],
    ledger: [],
    syncQueue: [],
    lastSyncAt: null,
    deviceId: null
  };
  var ready = false;
  var lastMintedPreview = null;
  var scanStream = null;

  function $(id) { return document.getElementById(id); }
  function enc() { return new TextEncoder(); }
  function dec() { return new TextDecoder(); }
  function nowIso() { return new Date().toISOString(); }
  function clampAmount(n) { n = Number(n); return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : 0; }
  function short(s) { s = String(s || ''); return s.length > 18 ? s.slice(0, 10) + '...' + s.slice(-8) : s; }
  function fmt(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 }); }

  function randomHex(bytes) {
    var b = new Uint8Array(bytes);
    crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  function bytesToBase64(bytes) {
    var bin = '';
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  async function sha256Hex(text) {
    var buf = await crypto.subtle.digest('SHA-256', enc().encode(String(text)));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function getDeviceId() {
    var id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = 'ost-device-' + randomHex(12);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function normalizeVault(v) {
    v = v && typeof v === 'object' ? v : {};
    var bal = Math.max(0, Number(v.balance || 0));
    return {
      balance: bal,
      // If an older vault has no `backed` field, assume the whole balance is
      // backed (grandfathered) so legit balances still redeem; new unbacked
      // mints are blocked below, so this can't be exploited going forward.
      backed: Math.max(0, Math.min(bal, Number(v.backed != null ? v.backed : bal))),
      active: !!v.active,
      tokens: Array.isArray(v.tokens) ? v.tokens.slice(0, 500) : [],
      ledger: Array.isArray(v.ledger) ? v.ledger.slice(0, 500) : [],
      syncQueue: Array.isArray(v.syncQueue) ? v.syncQueue.slice(0, 1000) : [],
      lastSyncAt: v.lastSyncAt || null,
      deviceId: v.deviceId || getDeviceId()
    };
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function getCryptoKey() {
    var secret = localStorage.getItem(SECRET_KEY);
    var salt = localStorage.getItem(SALT_KEY);
    if (!secret) { secret = randomHex(32); localStorage.setItem(SECRET_KEY, secret); }
    if (!salt) { salt = randomHex(16); localStorage.setItem(SALT_KEY, salt); }
    var material = await crypto.subtle.importKey('raw', enc().encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: hexToBytes(salt), iterations: 120000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function saveVault() {
    vault.deviceId = vault.deviceId || getDeviceId();
    var db = await openDb();
    var key = await getCryptoKey();
    var iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    var clear = enc().encode(JSON.stringify(vault));
    var cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, clear);
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ iv: bytesToBase64(iv), cipher: bytesToBase64(cipher), updatedAt: Date.now() }, VAULT_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    updateUI();
    dispatchChanged();
  }

  async function loadVault() {
    try {
      var db = await openDb();
      var record = await new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(VAULT_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
      if (!record) {
        vault = normalizeVault({ deviceId: getDeviceId() });
        return;
      }
      var key = await getCryptoKey();
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(record.iv) }, key, base64ToBytes(record.cipher));
      vault = normalizeVault(JSON.parse(dec().decode(plain)));
    } catch (e) {
      console.warn('[offline-vault] load failed, starting empty', e);
      vault = normalizeVault({ deviceId: getDeviceId() });
    }
  }

  function addLedger(kind, amount, extra) {
    var entry = Object.assign({
      id: 'evt-' + Date.now().toString(36) + '-' + randomHex(4),
      kind: kind,
      amount: Number(amount || 0),
      ts: Date.now(),
      iso: nowIso(),
      offline: !navigator.onLine
    }, extra || {});
    vault.ledger.unshift(entry);
    vault.ledger = vault.ledger.slice(0, 500);
    vault.syncQueue.push(entry);
    vault.syncQueue = vault.syncQueue.slice(-1000);
    return entry;
  }

  function dispatchChanged() {
    try { window.dispatchEvent(new CustomEvent('ost:offline-vault-changed', { detail: publicState() })); } catch (_) {}
  }

  function publicState() {
    return {
      balance: vault.balance,
      active: vault.active,
      tokenCount: vault.tokens.length,
      queueCount: vault.syncQueue.length,
      lastSyncAt: vault.lastSyncAt,
      deviceId: vault.deviceId
    };
  }

  async function createBearerToken(opts) {
    opts = opts || {};
    var amount = clampAmount(opts.amount);
    if (!amount) throw new Error('Invalid bearer amount');
    var issuedAt = Date.now();
    var nonce = randomHex(16);
    var format = String(opts.format || 'digital');
    var issuer = String(opts.issuer || 'ost-local-survival-preview');
    var commitment = await sha256Hex(['ost-bearer-v1', OST_MINT, amount, nonce, issuedAt, format, issuer].join('|'));
    return {
      v: 'ost-bearer-v1',
      tokenId: 'ostb-' + commitment.slice(0, 20),
      mint: OST_MINT,
      amount: amount,
      format: format,
      issuer: issuer,
      issuedAt: issuedAt,
      nonce: nonce,
      commitment: commitment,
      settlement: 'sync-required'
    };
  }

  async function verifyBearerToken(token) {
    if (!token || typeof token !== 'object') throw new Error('Token payload missing');
    if (token.v !== 'ost-bearer-v1') throw new Error('Unsupported token version');
    if (token.mint !== OST_MINT) throw new Error('Wrong OST mint');
    var amount = clampAmount(token.amount);
    if (!amount) throw new Error('Invalid token amount');
    var expected = await sha256Hex(['ost-bearer-v1', token.mint, amount, token.nonce, token.issuedAt, token.format, token.issuer].join('|'));
    if (expected !== token.commitment) throw new Error('Token commitment mismatch');
    return {
      tokenId: token.tokenId || ('ostb-' + expected.slice(0, 20)),
      amount: amount,
      mint: token.mint,
      format: token.format || 'digital',
      issuer: token.issuer || 'unknown',
      issuedAt: token.issuedAt || Date.now(),
      commitment: expected,
      proof: 'sha256-local-commitment',
      raw: token
    };
  }

  async function parseBearerInput(input) {
    var text = String(input || '').trim();
    if (!text) throw new Error('No bearer token data found');

    var marker = 'OST-BEARER-V1:';
    var idx = text.indexOf(marker);
    if (idx >= 0) text = text.slice(idx + marker.length).trim();

    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return verifyBearerToken(JSON.parse(jsonMatch[0])); } catch (e) {
        if (text.indexOf('OST SURVIVAL BEARER TOKEN') < 0) throw e;
      }
    }

    // Back-compat with the current Survival Bearer Token text download.
    var amountMatch = text.match(/Amount:\s*([0-9,.]+)\s*OST/i) || text.match(/([0-9,.]+)\s*OST/i);
    var hashMatch = text.match(/HASH:\s*([^\r\n]+)/i) || text.match(/TOKEN:\s*([^\r\n]+)/i);
    if (amountMatch && hashMatch) {
      var amount = clampAmount(String(amountMatch[1]).replace(/,/g, ''));
      if (!amount) throw new Error('Invalid legacy bearer amount');
      var hash = String(hashMatch[1]).trim();
      var tokenId = 'legacy-' + (await sha256Hex(hash + '|' + amount)).slice(0, 20);
      return {
        tokenId: tokenId,
        amount: amount,
        mint: OST_MINT,
        format: 'legacy-text',
        issuer: 'survival-preview',
        issuedAt: Date.now(),
        commitment: hash,
        proof: 'legacy-survival-preview',
        raw: { text: text.slice(0, 2000) }
      };
    }

    throw new Error('Unsupported bearer token format');
  }

  async function importBearerText(text, source) {
    await ensureReady();
    var token = await parseBearerInput(text);
    if (vault.tokens.some(function (t) { return t.tokenId === token.tokenId; })) {
      throw new Error('Bearer token already imported on this device');
    }
    vault.tokens.unshift(token);
    vault.tokens = vault.tokens.slice(0, 500);
    vault.balance = Math.max(0, Number(vault.balance || 0) + token.amount);
    vault.active = true;
    addLedger('bearer-import', token.amount, {
      source: source || 'manual-import',
      tokenId: token.tokenId,
      proof: token.proof,
      commitment: token.commitment,
      format: token.format
    });
    await saveVault();
    setStatus('Imported ' + fmt(token.amount) + ' OST into the offline vault.', 'ok');
    return token;
  }

  async function debit(amount, meta) {
    await ensureReady();
    amount = clampAmount(amount);
    if (!amount || amount > vault.balance + 1e-9) return false;
    vault.balance = Math.max(0, vault.balance - amount);
    addLedger('offline-debit', amount, meta || {});
    await saveVault();
    return true;
  }

  async function credit(amount, meta) {
    await ensureReady();
    amount = clampAmount(amount);
    if (!amount) return false;
    vault.balance = Math.max(0, vault.balance + amount);
    addLedger('offline-credit', amount, meta || {});
    await saveVault();
    return true;
  }

  function debitSync(amount, meta) {
    amount = clampAmount(amount);
    if (!amount || amount > vault.balance + 1e-9) return false;
    vault.balance = Math.max(0, vault.balance - amount);
    addLedger('offline-debit', amount, meta || {});
    saveVault().catch(function () {});
    return true;
  }

  function creditSync(amount, meta) {
    amount = clampAmount(amount);
    if (!amount) return false;
    vault.balance = Math.max(0, vault.balance + amount);
    addLedger('offline-credit', amount, meta || {});
    saveVault().catch(function () {});
    return true;
  }

  // ── Unified coin: mint a survival note = convert spendable OST into offline
  //    balance, IMMEDIATELY usable in offline games. This is the "survival and
  //    offline should be one coin" the testers asked for: one action makes an
  //    offline-spendable, transferable, redeemable note in a single step.
  async function mintFromOst(amount, format) {
    await ensureReady();
    amount = clampAmount(amount);
    if (!amount) throw new Error('Enter an amount to mint.');
    // A mint MUST be fully backed by real spendable OST — the pool is debited
    // 1:1 before the offline note exists. No unbacked "devnet notes": those
    // could be redeemed back into real OST, minting money from nothing (the
    // leak testers were exploiting). If you have no OST, claim the faucet first.
    var have = 0;
    try { if (window.OST_MONEY && typeof window.OST_MONEY.get === 'function') have = Number(window.OST_MONEY.get()) || 0; } catch (_) {}
    if (have + 1e-9 < amount) {
      throw new Error('Not enough spendable OST to mint ' + fmt(amount) + ' (you have ' + fmt(have) + '). Claim or earn OST first.');
    }
    var backed = false;
    try { backed = window.OST_MONEY.spend(amount, 'offline-mint'); } catch (_) {}
    if (!backed) throw new Error('Could not debit OST for the mint. Try again.');
    var token = await createBearerToken({ amount: amount, format: format || 'digital' });
    vault.balance = Math.max(0, Number(vault.balance || 0) + amount);
    vault.backed = Math.max(0, Number(vault.backed || 0) + amount); // fully backed
    vault.active = true; // minted coin is spendable in offline games right away
    addLedger('offline-mint', amount, { tokenId: token.tokenId, format: token.format, backed: true });
    await saveVault();
    setStatus('Minted ' + fmt(amount) + ' OST into the offline vault — ready for offline games.', 'ok');
    try { window.dispatchEvent(new CustomEvent('ost:offline-minted', { detail: { amount: amount, tokenId: token.tokenId, backed: true, token: token } })); } catch (_) {}
    return { token: token, bearerText: 'OST-BEARER-V1:' + JSON.stringify(token), balance: vault.balance, backed: true };
  }

  // Redeem offline balance back to spendable OST (the reverse trip). Only the
  // BACKED portion can become real OST again — any unbacked balance (imported
  // notes, offline winnings beyond backing) stays offline-only and never mints
  // spendable money.
  async function redeemToOst(amount) {
    await ensureReady();
    amount = clampAmount(amount) || Number(vault.balance || 0);
    amount = clampAmount(amount);
    if (!amount) throw new Error('Nothing to redeem.');
    if (amount > vault.balance + 1e-9) throw new Error('Redeem amount exceeds your offline balance of ' + fmt(vault.balance) + ' OST.');
    var creditable = Math.max(0, Math.min(amount, Number(vault.backed || 0)));
    vault.balance = Math.max(0, vault.balance - amount);
    vault.backed = Math.max(0, Number(vault.backed || 0) - creditable);
    if (vault.balance <= 0) vault.active = false;
    addLedger('offline-redeem', amount, { creditedToOst: creditable, unbacked: amount - creditable });
    await saveVault();
    var credited = false;
    try {
      if (creditable > 0 && window.OST_MONEY && typeof window.OST_MONEY.add === 'function') { window.OST_MONEY.add(creditable, 'offline-redeem'); credited = true; }
    } catch (_) {}
    var note = creditable < amount - 1e-9
      ? 'Redeemed ' + fmt(creditable) + ' backed OST to spendable; ' + fmt(amount - creditable) + ' was unbacked offline value.'
      : 'Redeemed ' + fmt(creditable) + ' OST from the offline vault back into your spendable OST.';
    setStatus(note, 'ok');
    try { window.dispatchEvent(new CustomEvent('ost:offline-redeemed', { detail: { amount: amount, credited: creditable, unbacked: amount - creditable } })); } catch (_) {}
    return { amount: amount, credited: creditable, balance: vault.balance };
  }

  function recordGameResult(detail) {
    if (!vault.active) return;
    addLedger('offline-game-proof', Number(detail && detail.amount || 0), {
      game: detail && detail.game,
      resultKind: detail && detail.kind,
      proof: detail && detail.extra || {},
      source: 'ost-games'
    });
    saveVault().catch(function () {});
  }

  function apiBase() {
    var base = (window.OST_API_BASE || window.OST_TOPUP_API || 'https://ost-api.nachogtavl.workers.dev').replace(/\/+$/, '');
    return base.indexOf('ost-api-pages.pages.dev') >= 0 ? 'https://ost-api.nachogtavl.workers.dev' : base;
  }

  async function syncNow() {
    await ensureReady();
    if (!navigator.onLine) {
      setStatus('Still offline. ' + vault.syncQueue.length + ' proof(s) waiting.', 'warn');
      return { ok: false, offline: true };
    }
    if (!vault.syncQueue.length) {
      setStatus('Offline vault already synced.', 'ok');
      return { ok: true, accepted: 0 };
    }
    var batch = vault.syncQueue.slice(0, 100);
    setStatus('Syncing ' + batch.length + ' offline proof(s)...', '');
    var r = await fetch(apiBase() + '/offline-vault/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: vault.deviceId,
        balance: vault.balance,
        tokenCount: vault.tokens.length,
        events: batch
      })
    });
    if (!r.ok) throw new Error('Sync failed: HTTP ' + r.status);
    var j = await r.json();
    var acceptedIds = new Set((j.acceptedIds || []).map(String));
    if (acceptedIds.size) vault.syncQueue = vault.syncQueue.filter(function (e) { return !acceptedIds.has(String(e.id)); });
    else vault.syncQueue = vault.syncQueue.slice(batch.length);
    vault.lastSyncAt = Date.now();
    await saveVault();
    setStatus('Synced ' + (j.accepted || batch.length) + ' proof(s). On-chain reconciliation queued.', 'ok');
    return j;
  }

  function setStatus(message, kind) {
    var el = $('offlineVaultStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'offline-vault-status ' + (kind || '');
  }

  function updateUI() {
    var balance = $('offlineVaultBalance');
    if (balance) balance.textContent = fmt(vault.balance);
    var tokens = $('offlineVaultTokenCount');
    if (tokens) tokens.textContent = String(vault.tokens.length);
    var queue = $('offlineVaultQueueCount');
    if (queue) queue.textContent = String(vault.syncQueue.length);
    var mode = $('offlineVaultMode');
    if (mode) mode.textContent = vault.active ? 'Active in games' : 'Manual only';
    var useBtn = $('offlineVaultUseGamesBtn');
    if (useBtn) useBtn.textContent = vault.active ? 'Use faucet balance in games' : 'Use offline vault in games';
    var syncBtn = $('offlineVaultSyncBtn');
    if (syncBtn) syncBtn.disabled = !vault.syncQueue.length;
    var log = $('offlineVaultLog');
    if (log) {
      var rows = vault.ledger.slice(0, 5).map(function (e) {
        return '<div><strong>' + e.kind.replace(/-/g, ' ') + '</strong> · ' + fmt(e.amount) + ' OST · ' + new Date(e.ts).toLocaleTimeString() + '</div>';
      });
      log.innerHTML = rows.length ? rows.join('') : '<div>No offline vault activity yet.</div>';
    }
  }

  async function ensureReady() {
    if (ready) return;
    await loadVault();
    ready = true;
    updateUI();
  }

  async function handleFile(file) {
    if (!file) return;
    var text = await file.text();
    await importBearerText(text, 'digital-file');
  }

  async function startNfc() {
    if (!('NDEFReader' in window)) throw new Error('Web NFC is not available in this browser. Use file or paste import.');
    var reader = new NDEFReader();
    await reader.scan();
    setStatus('NFC scan active. Tap an OST bearer card.', '');
    reader.onreading = async function (event) {
      var chunks = [];
      event.message.records.forEach(function (record) {
        if (record.recordType === 'text') chunks.push(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      });
      if (chunks.length) await importBearerText(chunks.join('\n'), 'nfc');
    };
  }

  async function startQrScan() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera QR import is not available here. Use file or paste import.');
    }
    var overlay = $('offlineVaultScan');
    var video = $('offlineVaultVideo');
    if (!overlay || !video) throw new Error('Scanner UI missing');
    overlay.classList.add('open');
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream;
    await video.play();
    var detector = new BarcodeDetector({ formats: ['qr_code'] });
    var stopped = false;
    $('offlineVaultScanClose').onclick = stopScan;

    async function loop() {
      if (stopped) return;
      try {
        var codes = await detector.detect(video);
        if (codes && codes.length) {
          stopped = true;
          var raw = codes[0].rawValue || '';
          stopScan();
          await importBearerText(raw, 'qr-camera');
          return;
        }
      } catch (_) {}
      requestAnimationFrame(loop);
    }
    function stopScan() {
      stopped = true;
      overlay.classList.remove('open');
      if (scanStream) scanStream.getTracks().forEach(function (t) { t.stop(); });
      scanStream = null;
    }
    loop();
  }

  async function importLatestMinted() {
    if (!lastMintedPreview) throw new Error('Mint a Survival Bearer Token first.');
    if (lastMintedPreview.bearerText) {
      await importBearerText(lastMintedPreview.bearerText, 'survival-mint-event');
      return;
    }
    var payload = await createBearerToken({ amount: lastMintedPreview.amount, format: lastMintedPreview.format || 'paper' });
    await importBearerText('OST-BEARER-V1:' + JSON.stringify(payload), 'survival-mint-event');
  }

  function bindUi() {
    var scanBtn = $('offlineVaultImportBtn');
    if (scanBtn) scanBtn.addEventListener('click', async function () {
      try {
        await startQrScan();
      } catch (e) { setStatus(e.message || String(e), 'warn'); }
    });
    var nfcBtn = $('offlineVaultNfcBtn');
    if (nfcBtn) nfcBtn.addEventListener('click', async function () {
      try { await startNfc(); }
      catch (e) { setStatus(e.message || String(e), 'warn'); }
    });
    var file = $('offlineVaultFile');
    if (file) file.addEventListener('change', async function () {
      try { await handleFile(file.files && file.files[0]); file.value = ''; }
      catch (e) { setStatus(e.message || String(e), 'error'); }
    });
    var pasteBtn = $('offlineVaultPasteBtn');
    var pasteBox = $('offlineVaultPasteBox');
    if (pasteBtn && pasteBox) pasteBtn.addEventListener('click', function () { pasteBox.classList.toggle('open'); });
    var pasteImport = $('offlineVaultPasteImportBtn');
    if (pasteImport) pasteImport.addEventListener('click', async function () {
      try { await importBearerText(($('offlineVaultPasteInput') || {}).value || '', 'paste'); if ($('offlineVaultPasteInput')) $('offlineVaultPasteInput').value = ''; }
      catch (e) { setStatus(e.message || String(e), 'error'); }
    });
    var useGames = $('offlineVaultUseGamesBtn');
    if (useGames) useGames.addEventListener('click', async function () {
      await ensureReady();
      vault.active = !vault.active;
      await saveVault();
      setStatus(vault.active ? 'Offline vault is now the active game balance.' : 'Games are back on faucet play balance.', vault.active ? 'ok' : 'warn');
    });
    var syncBtn = $('offlineVaultSyncBtn');
    if (syncBtn) syncBtn.addEventListener('click', function () { syncNow().catch(function (e) { setStatus(e.message || String(e), 'error'); }); });
    var redeemBtn = $('offlineVaultRedeemBtn');
    if (redeemBtn) redeemBtn.addEventListener('click', function () {
      redeemToOst().catch(function (e) { setStatus(e.message || String(e), 'error'); });
    });
    var latestBtn = $('offlineVaultLatestBtn');
    if (latestBtn) latestBtn.addEventListener('click', function () { importLatestMinted().catch(function (e) { setStatus(e.message || String(e), 'error'); }); });

    window.addEventListener('online', function () { if (vault.syncQueue.length) syncNow().catch(function () {}); });
    window.addEventListener('ost:survival-token-minted', function (event) {
      lastMintedPreview = event.detail || null;
      var btn = $('offlineVaultLatestBtn');
      if (btn) btn.disabled = !lastMintedPreview;
      // UNIFIED COIN: auto-import the freshly minted note into the offline
      // vault and activate it, so the minted token is IMMEDIATELY playable in
      // offline games — no separate "import latest" + "use games" steps that
      // testers kept missing. Guarded against double-credit by tokenId.
      if (lastMintedPreview && lastMintedPreview.bearerText) {
        importBearerText(lastMintedPreview.bearerText, 'survival-mint-auto')
          .then(function () {
            vault.active = true;
            return saveVault();
          })
          .then(function () { setStatus('Minted note is now spendable in offline vault games.', 'ok'); })
          .catch(function () { /* already imported / dupe — fine */ });
      }
    });
  }

  function mount() {
    bindUi();
    ensureReady().then(function () {
      setStatus(navigator.onLine ? 'Offline vault ready. Import a bearer token to play with local OST.' : 'Offline vault ready without internet.', 'ok');
    }).catch(function (e) { setStatus(e.message || String(e), 'error'); });
  }

  window.OSTOfflineVault = {
    ready: ensureReady,
    getState: function () { return publicState(); },
    getBalance: function () { return Number(vault.balance || 0); },
    isActive: function () { return !!vault.active; },
    setActive: async function (active) { await ensureReady(); vault.active = !!active; await saveVault(); },
    debit: function (amount, meta) { return debitSync(amount, meta); },
    credit: function (amount, meta) { return creditSync(amount, meta); },
    recordGameResult: recordGameResult,
    importBearerText: importBearerText,
    createBearerToken: createBearerToken,
    mintFromOst: mintFromOst,
    redeemToOst: redeemToOst,
    sync: syncNow,
    updateUI: updateUI
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
