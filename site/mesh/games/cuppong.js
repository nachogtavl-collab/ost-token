/* games/cuppong.js — Mesh casual 3D Cup Pong (Three.js + tiny ball physics)
   Throw ball into peer's cups. First to sink all opponent cups wins.
   Lazy-loads three.js from CDN if not already loaded.
*/
(function () {
  'use strict';
  if (!window.OST_MESH_GAMES) return;

  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  function ensureThree(cb) {
    if (window.THREE) { cb(window.THREE); return; }
    var s = document.createElement('script');
    s.src = THREE_URL;
    s.onload = function () { cb(window.THREE); };
    s.onerror = function () { cb(null); };
    document.head.appendChild(s);
  }

  function buildCupLayout() {
    // 10 cups in triangle on each side (Z = -3 host, Z = +3 guest).
    // For simplicity 6 cups in 3-2-1 triangle.
    var positions = [];
    var rows = [3, 2, 1];
    var spacing = 0.7;
    var k = 0;
    var startZ = 2.6;
    rows.forEach(function (count, ri) {
      for (var i = 0; i < count; i++) {
        var x = (i - (count - 1) / 2) * spacing;
        var z = startZ - ri * (spacing * 0.85);
        positions.push({ x: x, z: z, idx: k++ });
      }
    });
    return positions;
  }

  function factory(ctx) {
    var youHost = !!ctx.host;
    var status = 'loading';
    var turnHost = true;
    var hostCups = buildCupLayout();   // host's cups (peer aims at these)
    var guestCups = buildCupLayout();  // guest's cups (host aims at these)
    var hostAlive = hostCups.map(function () { return true; });
    var guestAlive = guestCups.map(function () { return true; });
    var winner = null;

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:8px;justify-items:center;width:100%';
    var info = document.createElement('div');
    info.style.cssText = 'color:#cdfaff;font-size:13px;font-weight:600;text-align:center';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;max-width:640px;height:380px;border-radius:14px;background:#0a1726;touch-action:none;cursor:crosshair';
    var ctrls = document.createElement('div');
    ctrls.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center';
    var pwLabel = document.createElement('span'); pwLabel.style.cssText = 'color:#cdfaff;font-size:12px';
    var pw = document.createElement('input');
    pw.type = 'range'; pw.min = '4'; pw.max = '14'; pw.step = '0.1'; pw.value = '8.5'; pw.style.width = '160px';
    var arcLabel = document.createElement('span'); arcLabel.style.cssText = 'color:#cdfaff;font-size:12px';
    var arc = document.createElement('input');
    arc.type = 'range'; arc.min = '20'; arc.max = '70'; arc.step = '1'; arc.value = '40'; arc.style.width = '120px';
    var aimLabel = document.createElement('span'); aimLabel.style.cssText = 'color:#cdfaff;font-size:12px';
    var aim = document.createElement('input');
    aim.type = 'range'; aim.min = '-30'; aim.max = '30'; aim.step = '0.5'; aim.value = '0'; aim.style.width = '160px';
    var shootBtn = document.createElement('button');
    shootBtn.type = 'button'; shootBtn.textContent = 'Throw';
    shootBtn.style.cssText = 'padding:8px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#021;cursor:pointer;font-weight:800';
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button'; quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#e8fbff;cursor:pointer;font-weight:700';
    quitBtn.onclick = function () { ctx.end('quit'); };
    function updateLabels() {
      pwLabel.textContent = 'Power: ' + pw.value;
      arcLabel.textContent = 'Arc: ' + arc.value + '°';
      aimLabel.textContent = 'Aim: ' + aim.value + '°';
    }
    pw.oninput = arc.oninput = aim.oninput = updateLabels;
    updateLabels();
    ctrls.appendChild(aimLabel); ctrls.appendChild(aim);
    ctrls.appendChild(arcLabel); ctrls.appendChild(arc);
    ctrls.appendChild(pwLabel); ctrls.appendChild(pw);
    ctrls.appendChild(shootBtn); ctrls.appendChild(quitBtn);

    wrap.appendChild(info);
    wrap.appendChild(canvas);
    wrap.appendChild(ctrls);
    ctx.mount.appendChild(wrap);

    info.textContent = 'Loading 3D engine...';

    var disposed = false;
    var renderer, scene, camera, raf, ball, ballState = null;

    ensureThree(function (THREE) {
      if (disposed) return;
      if (!THREE) { info.textContent = 'Could not load 3D engine.'; return; }
      init3D(THREE);
      status = 'playing';
      announceTurn();
    });

    function init3D(THREE) {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      function resize() {
        var w = canvas.clientWidth, h = canvas.clientHeight;
        renderer.setSize(w, h, false);
        if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
      }
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a1726);

      camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 100);
      camera.position.set(0, 2.4, -5.2); camera.lookAt(0, 0.5, 1.5);

      var ambient = new THREE.AmbientLight(0xffffff, 0.55);
      scene.add(ambient);
      var dir = new THREE.DirectionalLight(0xffffff, 0.7);
      dir.position.set(2, 6, 2); scene.add(dir);

      // Table
      var tableGeo = new THREE.BoxGeometry(4.5, 0.2, 7);
      var tableMat = new THREE.MeshStandardMaterial({ color: 0x6b3a1d });
      var table = new THREE.Mesh(tableGeo, tableMat); table.position.y = -0.1; scene.add(table);

      // Mid line
      var lineGeo = new THREE.BoxGeometry(4.4, 0.01, 0.05);
      var lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      var midLine = new THREE.Mesh(lineGeo, lineMat); midLine.position.y = 0.01; scene.add(midLine);

      // Cups
      var cupGroups = { host: [], guest: [] };
      function makeCup(x, z, color) {
        var geo = new THREE.CylinderGeometry(0.22, 0.18, 0.45, 24, 1, true);
        var mat = new THREE.MeshStandardMaterial({ color: color, side: THREE.DoubleSide });
        var m = new THREE.Mesh(geo, mat); m.position.set(x, 0.225, z); return m;
      }
      hostCups.forEach(function (c) {
        var m = makeCup(c.x, -c.z, 0xff4d4d); cupGroups.host.push(m); scene.add(m);
      });
      guestCups.forEach(function (c) {
        var m = makeCup(c.x, c.z, 0x4dd0ff); cupGroups.guest.push(m); scene.add(m);
      });

      // Ball
      var ballGeo = new THREE.SphereGeometry(0.08, 20, 16);
      var ballMat = new THREE.MeshStandardMaterial({ color: 0xfff7c2, emissive: 0x222200 });
      ball = new THREE.Mesh(ballGeo, ballMat); ball.position.set(0, -10, 0); scene.add(ball);

      window.addEventListener('resize', resize);
      resize();

      function animate() {
        if (disposed) return;
        if (ballState) stepBall();
        // Hide pocketed cups
        hostAlive.forEach(function (a, i) { cupGroups.host[i].visible = a; });
        guestAlive.forEach(function (a, i) { cupGroups.guest[i].visible = a; });
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      }
      animate();
    }

    function announceTurn() {
      if (status !== 'playing') return;
      info.textContent = ((turnHost === youHost) ? 'Your throw.' : "Peer's throw.")
        + ' · You: ' + (youHost ? hostAlive.filter(Boolean).length : guestAlive.filter(Boolean).length) + ' cups left.';
      shootBtn.disabled = (turnHost !== youHost) || (status !== 'playing');
    }

    shootBtn.onclick = function () {
      if (status !== 'playing') return;
      if (turnHost !== youHost) return;
      var shot = { angle: Number(aim.value), power: Number(pw.value), arc: Number(arc.value) };
      // Both sides simulate same trajectory deterministically; broadcast shot.
      ctx.send('shot', shot);
      executeShot(shot, youHost);
    };

    function executeShot(shot, byHost) {
      // Determine target side & launch
      var targetSign = byHost ? 1 : -1; // positive Z = guest cups; ball thrown by host travels +Z
      var radAng = shot.angle * Math.PI / 180;
      var radArc = shot.arc * Math.PI / 180;
      var v = shot.power;
      // Launch from shooter's side
      var startZ = byHost ? -3.2 : 3.2;
      ball.position.set(0, 0.3, startZ);
      var horizontal = v * Math.cos(radArc);
      ballState = {
        x: 0, y: 0.3, z: startZ,
        vx: horizontal * Math.sin(radAng) * targetSign,
        vy: v * Math.sin(radArc),
        vz: horizontal * Math.cos(radArc) * targetSign,
        byHost: byHost,
        landed: false
      };
      shootBtn.disabled = true;
    }

    function stepBall() {
      var dt = 1 / 60;
      var GRAV = -9.8 * 0.6;
      ballState.vy += GRAV * dt;
      ballState.x += ballState.vx * dt;
      ballState.y += ballState.vy * dt;
      ballState.z += ballState.vz * dt;
      ball.position.set(ballState.x, ballState.y, ballState.z);

      // Collision with table top (y=0)
      if (!ballState.landed && ballState.y <= 0.05) {
        ballState.landed = true;
        // Check cup hits
        var targetCups = ballState.byHost ? guestCups : hostCups;
        var aliveArr = ballState.byHost ? guestAlive : hostAlive;
        var hitIdx = -1;
        for (var i = 0; i < targetCups.length; i++) {
          if (!aliveArr[i]) continue;
          var c = targetCups[i];
          var dx = ballState.x - c.x;
          var dz = ballState.z - (ballState.byHost ? c.z : -c.z);
          if (dx * dx + dz * dz < 0.22 * 0.22) { hitIdx = i; break; }
        }
        if (hitIdx >= 0) {
          aliveArr[hitIdx] = false;
          ctx.setStatus(ballState.byHost === youHost ? 'You sunk a cup!' : 'Peer sunk a cup!');
        } else {
          ctx.setStatus(ballState.byHost === youHost ? 'Missed!' : 'Peer missed.');
        }
        // After landing, end shot
        window.setTimeout(function () { endShot(hitIdx >= 0); }, 600);
      }
      if (ballState.y < -0.6) endShot(false);
    }

    function endShot(hit) {
      if (!ballState) return;
      ballState = null;
      ball.position.set(0, -10, 0);
      // Win check
      var hostLeft = hostAlive.filter(Boolean).length;
      var guestLeft = guestAlive.filter(Boolean).length;
      if (hostLeft === 0) { status = 'over'; winner = 'guest'; }
      if (guestLeft === 0) { status = 'over'; winner = 'host'; }
      if (status === 'over') {
        info.textContent = (winner === (youHost ? 'host' : 'guest')) ? 'You won!' : 'You lost.';
        shootBtn.disabled = true;
        return;
      }
      // Hit again on hit, otherwise pass turn
      if (!hit) turnHost = !turnHost;
      announceTurn();
    }

    function onPayload(type, payload) {
      if (type === 'shot' && payload) {
        // If this is peer's shot
        var byHost = (turnHost && !youHost) ? false : (turnHost && youHost) ? true : !youHost;
        executeShot(payload, !youHost);
      }
    }

    return {
      onPayload: onPayload,
      dispose: function () {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        try { renderer && renderer.dispose && renderer.dispose(); } catch (_) {}
        try { wrap.remove(); } catch (_) {}
      }
    };
  }

  window.OST_MESH_GAMES.register('cuppong', {
    label: 'Cup Pong 3D',
    blurb: 'Real 3D arc throws. Sink all your peer\'s cups.',
    icon: '🥤',
    requires3D: true,
    factory: factory
  });
})();
