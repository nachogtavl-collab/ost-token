/* OST PWA notifications: Mesh alerts, app badges, and service-worker bridge. */
(function () {
  'use strict';

  var PREF_KEY = 'ost.notifications.enabled.v1';
  var COUNT_KEY = 'ost.notifications.count.v1';
  var DEFAULT_ICON = 'icon-192.png';
  var DEFAULT_BADGE = 'icon-192.png';
  var PUSH_SUB_KEY = 'ost.notifications.pushSubscription.v1';
  var NOTIFICATION_COOLDOWN_MS = 30000;
  var URGENT_NOTIFICATION_COOLDOWN_MS = 12000;
  var lastNotificationAtByTag = Object.create(null);
  var audioContext = null;
  var unlocked = false;

  function readEnabled() {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch (_) { return false; }
  }

  function writeEnabled(value) {
    try { localStorage.setItem(PREF_KEY, value ? '1' : '0'); } catch (_) {}
  }

  function notificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  function appUrl(target) {
    var url = new URL(location.href);
    if (target === 'mesh') url.searchParams.set('openMesh', '1');
    return url.toString();
  }

  function pushPublicKey() {
    var meta = document.querySelector('meta[name="ost-push-public-key"]');
    return String(window.OST_PUSH_PUBLIC_KEY || (meta && meta.content) || '').trim();
  }

  function urlBase64ToUint8Array(value) {
    var padding = '='.repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function rememberPushSubscription(subscription) {
    if (!subscription) return null;
    try { localStorage.setItem(PUSH_SUB_KEY, JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('ost:push-subscription', { detail: { subscription: subscription } })); } catch (_) {}
    return subscription;
  }

  function ensurePushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return Promise.resolve(null);
    var key = pushPublicKey();
    if (!key) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (registration) {
      return registration.pushManager.getSubscription().then(function (existing) {
        if (existing) return rememberPushSubscription(existing);
        return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }).then(rememberPushSubscription);
      });
    });
  }

  function pushReady() {
    return !!(('serviceWorker' in navigator) && ('PushManager' in window) && pushPublicKey());
  }

  function setBadge(delta) {
    var count = 0;
    try { count = Number(localStorage.getItem(COUNT_KEY) || 0) || 0; } catch (_) {}
    count = Math.max(0, count + Number(delta || 1));
    try { localStorage.setItem(COUNT_KEY, String(count)); } catch (_) {}
    if (navigator.setAppBadge) navigator.setAppBadge(count || undefined).catch(function () {});
    return count;
  }

  function clearBadge() {
    try { localStorage.setItem(COUNT_KEY, '0'); } catch (_) {}
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
  }

  function openMeshFromNotification() {
    clearBadge();
    if (window.OST_MESH && window.OST_MESH.open) {
      window.OST_MESH.open();
      return;
    }
    window.addEventListener('mesh:ready', function () {
      if (window.OST_MESH && window.OST_MESH.open) window.OST_MESH.open();
    }, { once: true });
  }

  function unlockAudio() {
    if (unlocked) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = audioContext || new Ctx();
      if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
      unlocked = true;
    } catch (_) {}
  }

  function tone(type) {
    if (!readEnabled()) return;
    try {
      unlockAudio();
      if (!audioContext) return;
      var now = audioContext.currentTime;
      var gain = audioContext.createGain();
      var osc = audioContext.createOscillator();
      var freq = type === 'call' || type === 'video-call' ? 740 : type === 'challenge' ? 620 : 520;
      osc.type = type === 'message' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'call' || type === 'video-call' ? 0.55 : 0.26));
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + (type === 'call' || type === 'video-call' ? 0.6 : 0.3));
      if (type === 'call' || type === 'video-call') {
        window.setTimeout(function () { tone('message'); }, 180);
      }
    } catch (_) {}
  }

  function shouldNotify(type, options) {
    if (!readEnabled() || notificationPermission() !== 'granted') return false;
    if (options && options.force) return true;
    if (type === 'call' || type === 'video-call' || type === 'challenge' || type === 'peer') return true;
    return document.hidden || window.matchMedia('(display-mode: standalone)').matches;
  }

  function rateLimited(type, options) {
    options = options || {};
    if (options.force && type === 'system') return false;
    var tag = options.tag || ('ost-mesh-' + (type || 'mesh'));
    var now = Date.now();
    var cooldown = type === 'call' || type === 'video-call' || type === 'challenge'
      ? URGENT_NOTIFICATION_COOLDOWN_MS
      : NOTIFICATION_COOLDOWN_MS;
    if (now - (lastNotificationAtByTag[tag] || 0) < cooldown) return true;
    lastNotificationAtByTag[tag] = now;
    return false;
  }

  function showViaServiceWorker(title, body, options) {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('service worker unavailable'));
    return navigator.serviceWorker.ready.then(function (registration) {
      if (!registration || !registration.showNotification) throw new Error('notifications unavailable');
      return registration.showNotification(title, {
        body: body || '',
        icon: options.icon || DEFAULT_ICON,
        badge: options.badge || DEFAULT_BADGE,
        tag: options.tag || 'ost-mesh',
        renotify: false,
        requireInteraction: !!options.requireInteraction,
        silent: !!options.silent,
        vibrate: options.vibrate || [90, 45, 90],
        data: { url: options.url || appUrl('mesh'), type: options.type || 'mesh' },
        actions: [{ action: 'open', title: 'Open OST Mesh' }]
      });
    });
  }

  function mesh(type, title, body, options) {
    options = options || {};
    type = type || 'mesh';
    if (!shouldNotify(type, options)) return Promise.resolve(false);
    if (rateLimited(type, options)) return Promise.resolve(false);
    if (readEnabled()) tone(type);
    if (navigator.vibrate && (type === 'call' || type === 'video-call' || type === 'challenge')) {
      try { navigator.vibrate([120, 60, 120]); } catch (_) {}
    }
    setBadge(1);
    var payload = Object.assign({ type: type, tag: 'ost-mesh-' + type, url: appUrl('mesh') }, options, { type: type });
    return showViaServiceWorker(title || 'OST Mesh', body || '', payload).catch(function () {
      try {
        new Notification(title || 'OST Mesh', {
          body: body || '',
          icon: payload.icon || DEFAULT_ICON,
          badge: payload.badge || DEFAULT_BADGE,
          tag: payload.tag,
          renotify: false,
          data: { url: payload.url, type: type }
        });
        return true;
      } catch (_) { return false; }
    });
  }

  function request() {
    unlockAudio();
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    return Notification.requestPermission().then(function (permission) {
      writeEnabled(permission === 'granted');
      if (permission === 'granted') {
        ensurePushSubscription().catch(function () {});
        mesh('system', 'OST Mesh alerts enabled', 'Calls, messages, peer connects, and challenges can now alert this device.', { force: true, tag: 'ost-alerts-enabled' });
      }
      return permission;
    });
  }

  window.addEventListener('click', unlockAudio, { once: true, capture: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, capture: true, passive: true });
  window.addEventListener('focus', clearBadge);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.type !== 'ost-open-mesh') return;
      openMeshFromNotification();
    });
  }
  if (new URL(location.href).searchParams.get('openMesh') === '1') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openMeshFromNotification, { once: true });
    else openMeshFromNotification();
  }
  window.addEventListener('ost:mesh-notify', function (event) {
    var detail = event.detail || {};
    mesh(detail.type, detail.title, detail.body, detail.options || {});
  });

  window.OST_NOTIFY = {
    request: request,
    mesh: mesh,
    enabled: readEnabled,
    permission: notificationPermission,
    clearBadge: clearBadge,
    unlockAudio: unlockAudio,
    subscribePush: ensurePushSubscription,
    pushReady: pushReady
  };
})();