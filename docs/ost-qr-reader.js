/* ==========================================================================
 * OST · QR Reader — one decoder that actually works on iOS
 * --------------------------------------------------------------------------
 * THE BUG THIS ENDS: every scan path (mesh invite, scan-to-pay) called
 * `BarcodeDetector` directly. Safari / iOS has NO BarcodeDetector at all — so on
 * an iPhone the camera <video> stayed black and a photo picked from the gallery
 * decoded to nothing ("QR decode not supported"). The user selected a QR and the
 * app just… sat there.
 *
 * ROOT FIX: decode with jsQR, which is pure JS and runs identically on every
 * browser including iOS. jsQR is already vendored locally (vendor/jsqr.min.js,
 * precached) — no CDN, works offline. BarcodeDetector is kept only as a FAST
 * PATH where it exists (Android Chrome); jsQR is the universal floor.
 *
 * API:
 *   OST_QR.fromFile(file)            -> Promise<string|null>   (photo/gallery/file)
 *   OST_QR.scanVideo(video, onHit, onErr) -> stop()            (live camera)
 * Both are used by mesh.js (invite scan) and mesh-mobile.js (scan-to-pay).
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_QR) return;

  // Resolve the vendored jsQR relative to THIS script so it loads correctly from
  // the /mesh/ pages too (currentScript is valid during synchronous execution).
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var JSQR_URL;
  try { JSQR_URL = new URL('vendor/jsqr.min.js', here).href; } catch (_) { JSQR_URL = 'vendor/jsqr.min.js'; }

  var jsqrPromise = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsqrPromise) return jsqrPromise;
    jsqrPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = JSQR_URL; s.async = true;
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error('jsQR missing after load')); };
      s.onerror = function () { jsqrPromise = null; rej(new Error('jsQR failed to load')); };
      document.head.appendChild(s);
    });
    return jsqrPromise;
  }

  // Draw an <img>/<video> onto a canvas at a bounded size and hand back ImageData.
  // Phone photos are huge; jsQR is faster and MORE reliable on a downscaled copy,
  // but a tiny QR needs resolution — so callers try several sizes.
  function toImageData(src, maxDim) {
    var w = src.naturalWidth || src.videoWidth || src.width;
    var h = src.naturalHeight || src.videoHeight || src.height;
    if (!w || !h) return null;
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, cw, ch);
    try { return ctx.getImageData(0, 0, cw, ch); } catch (_) { return null; }
  }

  function decode(jsQR, id, both) {
    if (!id) return null;
    var r = jsQR(id.data, id.width, id.height, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
    return (r && r.data) ? r.data : null;
  }

  function fileToImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { res({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('image load failed')); };
      img.decoding = 'async';
      img.src = url;
    });
  }

  // Decode a QR from a picked photo / file. Works on iOS.
  function fromFile(file) {
    if (!file) return Promise.resolve(null);
    return loadJsQR().then(function (jsQR) {
      return fileToImage(file).then(function (o) {
        try {
          // Full-ish, then progressively smaller — covers both tiny and giant QRs.
          var dims = [1600, 1000, 700, 400];
          for (var i = 0; i < dims.length; i++) {
            var text = decode(jsQR, toImageData(o.img, dims[i]), true);
            if (text) { URL.revokeObjectURL(o.url); return text; }
          }
          URL.revokeObjectURL(o.url);
          return null;
        } catch (e) { URL.revokeObjectURL(o.url); throw e; }
      });
    }).catch(function (err) {
      // Only if jsQR itself couldn't load: try the native detector where present.
      if ('BarcodeDetector' in window && typeof createImageBitmap === 'function') {
        return createImageBitmap(file).then(function (bmp) {
          var det = new window.BarcodeDetector({ formats: ['qr_code'] });
          return det.detect(bmp).then(function (c) { return (c && c[0] && c[0].rawValue) || null; });
        });
      }
      throw err;
    });
  }

  // Live-scan frames from a <video>. Returns a stop() fn. Prefers BarcodeDetector
  // for speed, falls back to jsQR-on-canvas (the only thing that works on iOS).
  function scanVideo(video, onHit, onErr) {
    var stopped = false;
    function stop() { stopped = true; }

    if ('BarcodeDetector' in window) {
      try {
        var det = new window.BarcodeDetector({ formats: ['qr_code'] });
        var bdTick = function () {
          if (stopped) return;
          det.detect(video).then(function (c) {
            if (stopped) return;
            if (c && c[0] && c[0].rawValue) onHit(c[0].rawValue);
            else requestAnimationFrame(bdTick);
          }).catch(function () { if (!stopped) requestAnimationFrame(bdTick); });
        };
        requestAnimationFrame(bdTick);
        return stop;
      } catch (_) { /* fall through to jsQR */ }
    }

    loadJsQR().then(function (jsQR) {
      var jqTick = function () {
        if (stopped) return;
        var text = decode(jsQR, toImageData(video, 640), false);
        if (text) { onHit(text); return; }
        setTimeout(function () { requestAnimationFrame(jqTick); }, 100);   // ~8-9 fps: enough, and easy on the battery
      };
      requestAnimationFrame(jqTick);
    }).catch(function (e) { if (onErr) onErr(e); });

    return stop;
  }

  window.OST_QR = { fromFile: fromFile, scanVideo: scanVideo, loadJsQR: loadJsQR };
})();
