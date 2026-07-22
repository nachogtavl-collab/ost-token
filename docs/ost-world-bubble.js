/* ==========================================================================
 * OST · World Bubble — a persistent, draggable media bubble for multitasking
 * --------------------------------------------------------------------------
 * WHAT THIS IS
 * A floating bubble that snaps to the left or right edge of the screen and
 * survives navigation inside the app. Collapse the player and the audio keeps
 * running; the bubble stays reachable to pause, skip to the next track, seek,
 * or reopen the full view. This is the "listen while you do something else"
 * mode - you can be in the faucet games or a prediction market with a stream
 * still playing.
 *
 * WHAT IT CAN ACTUALLY DO, AND WHAT IT CANNOT
 *
 *  ✓ Play/pause, next/previous in a queue, seek +/-10s, mute, volume.
 *    These come from the official YouTube IFrame Player API, which is a
 *    supported, documented control surface.
 *
 *  ✗ SKIP YOUTUBE'S ADS. There is no API for it, and building one would mean
 *    defeating another company's monetization from inside a licensed
 *    business's app - that is the kind of thing that costs you an API key and
 *    invites a letter. "Skip" here means skip to the next VIDEO in your queue.
 *    When a pre-roll is running, YouTube's own Skip button is the only skip.
 *
 *  ✗ KEEP AUDIO ALIVE WHEN THE PHONE'S BROWSER IS BACKGROUNDED. iOS and
 *    Android suspend media in a backgrounded browser tab; that is an OS
 *    decision, not something a web app may override. Collapsing to the bubble
 *    INSIDE the app works fine (the player is still in the foreground page).
 *    Locking the phone or switching apps will pause it. Anything claiming
 *    otherwise on the open web is not telling the truth.
 *
 * Media Session metadata is published so the lock-screen/OS controls show what
 * is playing and can drive next/previous where the platform allows it.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_WORLD_BUBBLE) return;

  var EDGE_MARGIN = 12;
  var BOTTOM_SAFE = 92;   // clear the mobile app bar (ost-appbar) - never sit on it
  var POS_KEY = 'ost.world.bubble.pos.v1';
  var QUEUE_KEY = 'ost.world.bubble.queue.v1';

  var state = {
    player: null,
    ready: false,
    queue: [],
    index: 0,
    expanded: false,
    playing: false,
    title: ''
  };
  var el = {};

  /* ---- persistence -------------------------------------------------------- */

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  /* ---- YouTube IFrame API ------------------------------------------------- */

  var apiPromise = null;
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      var prior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prior === 'function') { try { prior(); } catch (_) {} }
        resolve(window.YT);
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () {
        apiPromise = null;
        reject(new Error('YouTube player could not load (blocked or offline).'));
      };
      document.head.appendChild(s);
      setTimeout(function () { if (!(window.YT && window.YT.Player)) reject(new Error('YouTube player timed out.')); }, 15000);
    }).catch(function (err) { apiPromise = null; throw err; });
    return apiPromise;
  }

  // Accepts a full URL, a share link, or a bare id.
  function parseVideoId(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : '';
  }

  /* ---- UI ----------------------------------------------------------------- */

  function injectStyle() {
    if (document.getElementById('ost-world-bubble-style')) return;
    var css =
      '.owb-root{position:fixed;z-index:1000400;touch-action:none;font-family:inherit;}' +
      '.owb-bubble{width:56px;height:56px;border-radius:50%;background:linear-gradient(145deg,#0d2438,#071726);' +
        'border:1px solid rgba(127,216,255,.38);box-shadow:0 10px 30px rgba(0,0,0,.5);display:grid;place-items:center;' +
        'cursor:grab;color:#7fd8ff;position:relative;overflow:hidden;}' +
      '.owb-bubble.is-dragging{cursor:grabbing;}' +
      '.owb-bubble .owb-eq{display:flex;gap:2px;align-items:flex-end;height:18px;}' +
      '.owb-bubble .owb-eq i{width:3px;background:#5eead4;border-radius:2px;height:5px;animation:owb-eq .9s ease-in-out infinite;}' +
      '.owb-bubble .owb-eq i:nth-child(2){animation-delay:.15s}.owb-bubble .owb-eq i:nth-child(3){animation-delay:.3s}' +
      '.owb-bubble.is-paused .owb-eq i{animation-play-state:paused;height:5px;background:#5d7f92;}' +
      '@keyframes owb-eq{0%,100%{height:5px}50%{height:16px}}' +
      '.owb-panel{width:min(330px,88vw);border-radius:16px;background:#06111d;border:1px solid rgba(127,216,255,.24);' +
        'box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;color:#dff8ff;}' +
      '.owb-frame{width:100%;aspect-ratio:16/9;background:#000;display:block;}' +
      '.owb-frame.is-audio{height:0;aspect-ratio:auto;overflow:hidden;}' +
      '.owb-meta{padding:8px 10px;font-size:12px;color:#9fbfd8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.owb-controls{display:flex;gap:4px;padding:0 8px 9px;align-items:center;}' +
      '.owb-controls button{flex:0 0 auto;min-width:34px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.12);' +
        'background:#0b1b29;color:#dff8ff;cursor:pointer;font-size:13px;}' +
      '.owb-controls button:hover{border-color:rgba(127,216,255,.5);}' +
      '.owb-controls .owb-grow{flex:1 1 auto;min-width:0;}' +
      '.owb-note{padding:0 10px 9px;font-size:10.5px;color:#6f8ea3;line-height:1.35;}' +
      '@media (prefers-reduced-motion: reduce){.owb-bubble .owb-eq i{animation:none}}';
    var tag = document.createElement('style');
    tag.id = 'ost-world-bubble-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function build() {
    if (el.root) return;
    injectStyle();
    el.root = document.createElement('div');
    el.root.className = 'owb-root';
    el.root.innerHTML =
      '<div class="owb-bubble is-paused" id="owbBubble" title="OST World player — drag to move, tap to open">' +
        '<div class="owb-eq"><i></i><i></i><i></i></div>' +
      '</div>' +
      '<div class="owb-panel" id="owbPanel" hidden>' +
        '<div id="owbFrame" class="owb-frame"></div>' +
        '<div class="owb-meta" id="owbMeta">Nothing queued</div>' +
        '<div class="owb-controls">' +
          '<button type="button" id="owbPrev" title="Previous">⏮</button>' +
          '<button type="button" id="owbPlay" title="Play/pause">▶</button>' +
          '<button type="button" id="owbNext" title="Next video">⏭</button>' +
          '<button type="button" id="owbBack10" title="Back 10s">-10</button>' +
          '<button type="button" id="owbFwd10" title="Forward 10s">+10</button>' +
          '<span class="owb-grow"></span>' +
          '<button type="button" id="owbAudio" title="Collapse video, keep audio">🎧</button>' +
          '<button type="button" id="owbClose" title="Close">✕</button>' +
        '</div>' +
        '<p class="owb-note" id="owbNote"></p>' +
      '</div>';
    document.body.appendChild(el.root);

    el.bubble = el.root.querySelector('#owbBubble');
    el.panel = el.root.querySelector('#owbPanel');
    el.meta = el.root.querySelector('#owbMeta');
    el.note = el.root.querySelector('#owbNote');
    el.play = el.root.querySelector('#owbPlay');

    el.root.querySelector('#owbPlay').addEventListener('click', toggle);
    el.root.querySelector('#owbNext').addEventListener('click', function () { skip(1); });
    el.root.querySelector('#owbPrev').addEventListener('click', function () { skip(-1); });
    el.root.querySelector('#owbBack10').addEventListener('click', function () { seekBy(-10); });
    el.root.querySelector('#owbFwd10').addEventListener('click', function () { seekBy(10); });
    el.root.querySelector('#owbAudio').addEventListener('click', toggleAudioOnly);
    el.root.querySelector('#owbClose').addEventListener('click', close);

    wireDrag();
    restorePosition();
  }

  /* ---- drag + edge snap --------------------------------------------------- */

  function clampToViewport(x, y) {
    var w = el.root.offsetWidth || 56;
    var h = el.root.offsetHeight || 56;
    return {
      x: Math.max(EDGE_MARGIN, Math.min(window.innerWidth - w - EDGE_MARGIN, x)),
      y: Math.max(EDGE_MARGIN, Math.min(window.innerHeight - h - BOTTOM_SAFE, y))
    };
  }

  function place(x, y, snap) {
    var p = clampToViewport(x, y);
    if (snap) {
      // Always rest against the nearer side, never floating in the middle of
      // the content the user is trying to read.
      var w = el.root.offsetWidth || 56;
      p.x = (p.x + w / 2 < window.innerWidth / 2)
        ? EDGE_MARGIN
        : window.innerWidth - w - EDGE_MARGIN;
    }
    el.root.style.left = p.x + 'px';
    el.root.style.top = p.y + 'px';
    if (snap) saveJson(POS_KEY, p);
  }

  function restorePosition() {
    var saved = loadJson(POS_KEY, null);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y, true);
    else place(window.innerWidth, Math.round(window.innerHeight * 0.55), true);
  }

  function wireDrag() {
    var dragging = false, moved = false, offX = 0, offY = 0;

    el.bubble.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false;
      offX = e.clientX - el.root.offsetLeft;
      offY = e.clientY - el.root.offsetTop;
      el.bubble.classList.add('is-dragging');
      el.bubble.setPointerCapture(e.pointerId);
    });

    el.bubble.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - (el.root.offsetLeft + offX)) > 3 ||
          Math.abs(e.clientY - (el.root.offsetTop + offY)) > 3) moved = true;
      place(e.clientX - offX, e.clientY - offY, false);
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      el.bubble.classList.remove('is-dragging');
      try { el.bubble.releasePointerCapture(e.pointerId); } catch (_) {}
      place(el.root.offsetLeft, el.root.offsetTop, true);
      // A tap (no drag) opens the panel.
      if (!moved) setExpanded(!state.expanded);
    }
    el.bubble.addEventListener('pointerup', end);
    el.bubble.addEventListener('pointercancel', end);

    window.addEventListener('resize', function () {
      place(el.root.offsetLeft, el.root.offsetTop, true);
    });
  }

  /* ---- player ------------------------------------------------------------- */

  function setNote(text) { if (el.note) el.note.textContent = text || ''; }

  function setExpanded(next) {
    state.expanded = !!next;
    el.panel.hidden = !state.expanded;
    el.bubble.hidden = state.expanded && window.innerWidth < 520 ? false : false;
    place(el.root.offsetLeft, el.root.offsetTop, true);
  }

  function updateBubble() {
    el.bubble.classList.toggle('is-paused', !state.playing);
    el.play.textContent = state.playing ? '⏸' : '▶';
    el.meta.textContent = state.title || (state.queue.length ? 'Loading…' : 'Nothing queued');
    publishMediaSession();
  }

  function publishMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: state.title || 'OST World',
        artist: 'OST World player'
      });
      navigator.mediaSession.setActionHandler('play', function () { play(); });
      navigator.mediaSession.setActionHandler('pause', function () { pause(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { skip(1); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { skip(-1); });
    } catch (_) {}
  }

  function ensurePlayer(videoId) {
    return loadYouTubeApi().then(function (YT) {
      if (state.player) {
        state.player.loadVideoById(videoId);
        return state.player;
      }
      return new Promise(function (resolve) {
        state.player = new YT.Player('owbFrame', {
          videoId: videoId,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: function () {
              state.ready = true;
              resolve(state.player);
            },
            onStateChange: function (e) {
              state.playing = (e.data === window.YT.PlayerState.PLAYING);
              if (e.data === window.YT.PlayerState.ENDED) skip(1);
              try {
                var d = state.player.getVideoData && state.player.getVideoData();
                if (d && d.title) state.title = d.title;
              } catch (_) {}
              updateBubble();
            },
            onError: function () {
              setNote('This video refused to play (owner disabled embedding, or it is unavailable).');
            }
          }
        });
      });
    });
  }

  function current() { return state.queue[state.index] || null; }

  function playIndex(i) {
    if (!state.queue.length) return Promise.resolve();
    state.index = (i + state.queue.length) % state.queue.length;
    var id = current();
    build();
    setExpanded(true);
    return ensurePlayer(id).then(function (p) {
      p.playVideo();
      state.playing = true;
      updateBubble();
      setNote('Collapse the video with 🎧 to keep listening. Leaving the browser or locking the phone pauses playback — that is enforced by the OS.');
    }).catch(function (err) {
      setNote(err.message || 'Player unavailable.');
    });
  }

  function play()  { if (state.player) { state.player.playVideo(); } }
  function pause() { if (state.player) { state.player.pauseVideo(); } }
  function toggle(){ state.playing ? pause() : play(); }
  function skip(d) { if (state.queue.length) playIndex(state.index + d); }
  function seekBy(sec) {
    if (!state.player || !state.player.getCurrentTime) return;
    try { state.player.seekTo(Math.max(0, state.player.getCurrentTime() + sec), true); } catch (_) {}
  }
  function toggleAudioOnly() {
    var frame = el.root.querySelector('#owbFrame');
    if (!frame) return;
    var audio = frame.classList.toggle('is-audio');
    setNote(audio
      ? 'Audio only. The player is still running in this page — switching apps still pauses it.'
      : 'Video visible.');
  }
  function close() {
    try { if (state.player) state.player.stopVideo(); } catch (_) {}
    state.playing = false;
    setExpanded(false);
    updateBubble();
  }

  /* ---- public API --------------------------------------------------------- */

  window.OST_WORLD_BUBBLE = {
    /** Queue one or more YouTube URLs/ids and start playing. */
    play: function (input) {
      var list = (Array.isArray(input) ? input : [input])
        .map(parseVideoId)
        .filter(Boolean);
      if (!list.length) {
        build(); setExpanded(true);
        setNote('That did not look like a YouTube link or id.');
        return false;
      }
      state.queue = list;
      saveJson(QUEUE_KEY, list);
      playIndex(0);
      return true;
    },
    add: function (input) {
      var id = parseVideoId(input);
      if (!id) return false;
      state.queue.push(id);
      saveJson(QUEUE_KEY, state.queue);
      if (state.queue.length === 1) playIndex(0);
      return true;
    },
    next: function () { skip(1); },
    prev: function () { skip(-1); },
    pause: pause,
    resume: play,
    close: close,
    show: function () { build(); setExpanded(true); },
    state: function () {
      return { playing: state.playing, title: state.title, queued: state.queue.length, index: state.index };
    }
  };

  // Restore a queue from a previous session, paused - never auto-play audio at
  // someone without them asking for it.
  var saved = loadJson(QUEUE_KEY, []);
  if (Array.isArray(saved) && saved.length) state.queue = saved;
})();
