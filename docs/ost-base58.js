/* OST · base58 (Bitcoin alphabet) — encode/decode for Solana secret keys.
 * @solana/web3.js does not expose bs58 (`solanaWeb3.utils.bytes.bs58` is the
 * Anchor API, never part of web3.js), so "paste a Phantom key" could never work.
 * window.OST_BASE58.{ encode(Uint8Array) -> string, decode(string) -> Uint8Array }
 * decode throws on a character outside the alphabet. */
(function () {
  'use strict';
  if (window.OST_BASE58) return;
  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var MAP = {};
  for (var i = 0; i < ALPHABET.length; i++) MAP[ALPHABET.charAt(i)] = i;

  function encode(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
    if (!bytes.length) return '';
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = '';
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1';
    for (var q = digits.length - 1; q >= 0; q--) out += ALPHABET.charAt(digits[q]);
    return out;
  }

  function decode(str) {
    str = String(str == null ? '' : str).trim();
    if (!str) return new Uint8Array(0);
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var v = MAP[str.charAt(i)];
      if (v === undefined) throw new Error('Not a base58 key (bad character "' + str.charAt(i) + '").');
      var carry = v;
      for (var j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (var k = 0; k < str.length && str.charAt(k) === '1'; k++) bytes.push(0);
    return Uint8Array.from(bytes.reverse());
  }

  window.OST_BASE58 = { encode: encode, decode: decode, alphabet: ALPHABET };
})();
