/* ==========================================================================
 * OST · Quantum-Resistant Signatures — Winternitz OTS (WOTS, SHA-256, w=16)
 * --------------------------------------------------------------------------
 * REAL post-quantum cryptography, not marketing. Hash-based one-time
 * signatures depend only on SHA-256 preimage resistance; a quantum
 * computer running Grover's algorithm still leaves ~128-bit security.
 * This is the same family (hash-based signatures) NIST standardized in
 * SLH-DSA/SPHINCS+ and RFC 8391 (XMSS/WOTS+).
 *
 * What it protects: offline/survival bearer notes. Each note minted gets a
 * one-time keypair — the note carries the public-key fingerprint, the
 * minting device keeps the secret. Redemption can then demand a signature
 * only the original holder's device can produce, and that signature stays
 * unforgeable even in a post-quantum world.
 *
 * ONE-TIME means one-time: signing two different messages with the same
 * key leaks security. The API enforces single use per stored key.
 *
 * Parameters: w=16 → 64 message chains + 3 checksum chains = 67 chains of
 * 32-byte values, up to 15 hash steps each. Keygen ≈ 1000 SHA-256 calls
 * (WebCrypto, few ms on any phone).
 *
 * Integration is additive: wraps OSTOfflineVault.createBearerToken to
 * attach `pq: { alg, pk }` and stores secrets at ost.quantum.keys.v1.
 * Nothing existing breaks if this file is absent.
 * ========================================================================== */
(function () {
  'use strict';

  var W = 16;              // Winternitz parameter
  var N = 32;              // hash output bytes
  var LEN1 = 64;           // 256-bit digest in base-16 nibbles
  var LEN2 = 3;            // checksum chains: max checksum 64*15=960 < 16^3
  var LEN = LEN1 + LEN2;   // 67 chains
  var KEYS_KEY = 'ost.quantum.keys.v1';
  var ALG = 'WOTS-SHA256-w16';

  var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

  // ------------------------------------------------------------ primitives
  function randomBytes(n) {
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  function toHex(buf) {
    var u = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }

  function fromHex(hex) {
    var u = new Uint8Array(hex.length / 2);
    for (var i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
    return u;
  }

  function utf8(str) {
    return new TextEncoder().encode(String(str));
  }

  function sha256(bytes) {
    return subtle.digest('SHA-256', bytes).then(function (d) { return new Uint8Array(d); });
  }

  // Hash a value k times in sequence (chain function)
  function chain(value, times) {
    var p = Promise.resolve(value);
    for (var i = 0; i < times; i++) p = p.then(sha256);
    return p;
  }

  function concatBytes(arrays) {
    var total = 0;
    arrays.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total);
    var off = 0;
    arrays.forEach(function (a) { out.set(a, off); off += a.length; });
    return out;
  }

  // digest (32 bytes) -> 67 base-16 digits (64 message + 3 checksum)
  function toBaseWDigits(digest) {
    var digits = [];
    for (var i = 0; i < digest.length; i++) {
      digits.push(digest[i] >> 4);
      digits.push(digest[i] & 0x0f);
    }
    var checksum = 0;
    for (var j = 0; j < digits.length; j++) checksum += (W - 1) - digits[j];
    // 3 base-16 checksum digits, most significant first
    digits.push((checksum >> 8) & 0x0f);
    digits.push((checksum >> 4) & 0x0f);
    digits.push(checksum & 0x0f);
    return digits;
  }

  // ------------------------------------------------------------ WOTS core
  function generateKeypair() {
    if (!subtle) return Promise.reject(new Error('WebCrypto unavailable'));
    var sk = [];
    for (var i = 0; i < LEN; i++) sk.push(randomBytes(N));
    // pk parts = each secret hashed w-1 times; fingerprint = H(all parts)
    return Promise.all(sk.map(function (s) { return chain(s, W - 1); }))
      .then(function (pkParts) { return sha256(concatBytes(pkParts)); })
      .then(function (fp) {
        return {
          alg: ALG,
          pk: toHex(fp),
          sk: sk.map(toHex),
          used: false,
          createdAt: Date.now()
        };
      });
  }

  function sign(skHexArr, message) {
    if (!subtle) return Promise.reject(new Error('WebCrypto unavailable'));
    return sha256(utf8(message)).then(function (digest) {
      var digits = toBaseWDigits(digest);
      return Promise.all(digits.map(function (d, i) {
        return chain(fromHex(skHexArr[i]), d).then(toHex);
      }));
    });
  }

  function verify(pkHex, message, sigHexArr) {
    if (!subtle) return Promise.reject(new Error('WebCrypto unavailable'));
    if (!Array.isArray(sigHexArr) || sigHexArr.length !== LEN) return Promise.resolve(false);
    return sha256(utf8(message)).then(function (digest) {
      var digits = toBaseWDigits(digest);
      return Promise.all(sigHexArr.map(function (s, i) {
        return chain(fromHex(s), (W - 1) - digits[i]);
      }));
    }).then(function (parts) {
      return sha256(concatBytes(parts));
    }).then(function (fp) {
      return toHex(fp) === String(pkHex).toLowerCase();
    }).catch(function () { return false; });
  }

  // ------------------------------------------------------------ key store
  function loadKeys() {
    try { return JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveKeys(m) {
    try { localStorage.setItem(KEYS_KEY, JSON.stringify(m)); } catch (_) {}
  }

  // Sign a redemption message with the one-time key held for tokenId.
  // Enforces single use: the key is marked used before the signature leaves.
  function signRedemption(tokenId, message) {
    var keys = loadKeys();
    var rec = keys[tokenId];
    if (!rec) return Promise.reject(new Error('No quantum key on this device for ' + tokenId));
    if (rec.used) return Promise.reject(new Error('One-time key for ' + tokenId + ' was already used'));
    rec.used = true;
    rec.usedAt = Date.now();
    rec.signedMessage = String(message).slice(0, 500);
    saveKeys(keys);
    return sign(rec.sk, message).then(function (sig) {
      return { alg: ALG, tokenId: tokenId, pk: rec.pk, message: String(message), signature: sig };
    });
  }

  function verifyRedemption(proof) {
    if (!proof || proof.alg !== ALG) return Promise.resolve(false);
    return verify(proof.pk, proof.message, proof.signature);
  }

  // ------------------------------------------- bearer note integration
  function wrapOfflineVault() {
    var vault = window.OSTOfflineVault;
    if (!vault || typeof vault.createBearerToken !== 'function' || vault.__pqWrapped) return false;
    var original = vault.createBearerToken.bind(vault);
    vault.createBearerToken = function (opts) {
      return original(opts).then(function (token) {
        return generateKeypair().then(function (kp) {
          token.pq = { alg: kp.alg, pk: kp.pk };
          var keys = loadKeys();
          keys[token.tokenId] = { pk: kp.pk, sk: kp.sk, used: false, createdAt: kp.createdAt, amount: token.amount };
          saveKeys(keys);
          return token;
        }).catch(function () { return token; }); // never block minting on PQ layer
      });
    };
    vault.__pqWrapped = true;
    return true;
  }

  // The vault module may load after us — retry briefly.
  function attach() {
    if (wrapOfflineVault()) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (wrapOfflineVault() || tries > 40) clearInterval(t);
    }, 500);
  }

  // ------------------------------------------------------------ self test
  function selfTest() {
    var msg = 'ost-pq-selftest-' + Date.now();
    return generateKeypair().then(function (kp) {
      return sign(kp.sk, msg).then(function (sig) {
        return Promise.all([
          verify(kp.pk, msg, sig),           // must pass
          verify(kp.pk, msg + 'x', sig)      // must fail
        ]);
      });
    }).then(function (r) {
      var ok = r[0] === true && r[1] === false;
      if (ok) console.info('[OST_QUANTUM] WOTS self-test passed — bearer notes are post-quantum signed.');
      else console.warn('[OST_QUANTUM] self-test FAILED', r);
      return ok;
    });
  }

  window.OST_QUANTUM = {
    alg: ALG,
    generateKeypair: generateKeypair,
    sign: sign,
    verify: verify,
    signRedemption: signRedemption,
    verifyRedemption: verifyRedemption,
    keyFor: function (tokenId) { var k = loadKeys()[tokenId]; return k ? { pk: k.pk, used: !!k.used } : null; },
    selfTest: selfTest
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
