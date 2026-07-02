/* games/minigolf.js — Mesh casual Mini Golf 2D (top-down, multi-course)
   Both players play same course alternately on their own ball. Lockstep:
   each shot is sent as input; both clients simulate identically.
   Lower total strokes after 3 holes wins.
*/
(function () {
  'use strict';
  if (!window.OST_MESH_GAMES) return;

  var W = 600, H = 360;
  var BALL_R = 6, HOLE_R = 11, FRICTION = 0.985, MIN_V = 0.05;

  // Course definition: tee, hole, walls (rect obstacles), bumpers (circle obstacles), par.
  // Walls in addition to outer borders.
  var COURSES = [
    {
      name: 'Hole 1 — Straight Shot',
      par: 2,
      tee: { x: 80, y: H / 2 },
      hole: { x: W - 80, y: H / 2 },
      walls: []
    },
    {
      name: 'Hole 2 — The L',
      par: 3,
      tee: { x: 80, y: 80 },
      hole: { x: W - 80, y: H - 80 },
      walls: [
        { x: 200, y: 0, w: 20, h: 200 },
        { x: 380, y: H - 200, w: 20, h: 200 }
      ]
    },
    {
      name: 'Hole 3 — Bumper Alley',
      par: 4,
      tee: { x: 60, y: H / 2 },
      hole: { x: W - 60, y: H / 2 },
      walls: [
        { x: 180, y: 100, w: 20, h: 160 },
        { x: 400, y: 100, w: 20, h: 160 }
      ],
      bumpers: [
        { x: 290, y: 90, r: 18 },
        { x: 290, y: 270, r: 18 }
      ]
    }
  ];

  function factory(ctx) {
    var holeIdx = 0;
    var youHost = !!ctx.host;
    var status = 'playing';
    var aimAngle = 0, aimPower = 8;
    // Per player: ball pos, vel, strokes for this hole, total strokes
    function makePlayer() {
      var c = COURSES[holeIdx];
      return { x: c.tee.x, y: c.tee.y, vx: 0, vy: 0, strokes: 0, total: 0, sunk: false };
    }
    var hostPl = null, guestPl = null;
    var turnHost = true;
    var hostTotals = [], guestTotals = [];
    var moving = false;

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:8px;justify-items:center;width:100%';
    var info = document.createElement('div');
    info.style.cssText = 'color:#cdfaff;font-size:13px;font-weight:600;text-align:center';
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = 'max-width:100%;height:auto;background:#163d1f;border-radius:14px;border:6px solid #4a2a10;cursor:crosshair;touch-action:none';
    var ctrls = document.createElement('div');
    ctrls.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center';
    var pwLabel = document.createElement('span'); pwLabel.style.cssText = 'color:#cdfaff;font-size:12px';
    var pw = document.createElement('input');
    pw.type = 'range'; pw.min = '2'; pw.max = '14'; pw.step = '0.1'; pw.value = '8'; pw.style.width = '160px';
    pw.oninput = function () { aimPower = Number(pw.value); pwLabel.textContent = 'Power: ' + aimPower.toFixed(1); render(); };
    pwLabel.textContent = 'Power: ' + aimPower.toFixed(1);
    var shootBtn = document.createElement('button');
    shootBtn.type = 'button'; shootBtn.textContent = 'Putt';
    shootBtn.style.cssText = 'padding:8px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#021;cursor:pointer;font-weight:800';
    shootBtn.onclick = function () { tryShoot(); };
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button'; quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#e8fbff;cursor:pointer;font-weight:700';
    quitBtn.onclick = function () { ctx.end('quit'); };
    ctrls.appendChild(pwLabel); ctrls.appendChild(pw); ctrls.appendChild(shootBtn); ctrls.appendChild(quitBtn);
    wrap.appendChild(info); wrap.appendChild(canvas); wrap.appendChild(ctrls);
    ctx.mount.appendChild(wrap);
    var c = canvas.getContext('2d');

    function startHole() {
      hostPl = makePlayer(); guestPl = makePlayer();
      turnHost = true;
      moving = false;
      announce();
      render();
    }

    function announce() {
      var course = COURSES[holeIdx];
      var who = turnHost ? 'host' : 'guest';
      var yourTurn = (who === (youHost ? 'host' : 'guest'));
      info.textContent = course.name + ' (Par ' + course.par + ') — ' +
        (status === 'over' ? 'Match over.' :
          ((yourTurn ? 'Your putt' : "Peer's putt") +
          ' · You strokes: ' + (youHost ? hostPl.strokes : guestPl.strokes) +
          ' · Total: H ' + (hostTotals.reduce(function (a, b) { return a + b; }, 0) + hostPl.total) +
          ' / G ' + (guestTotals.reduce(function (a, b) { return a + b; }, 0) + guestPl.total)));
      shootBtn.disabled = !yourTurn || moving || status === 'over';
    }

    function localPos(evt) {
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      var x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      var y = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
      return { x: x * sx, y: y * sy };
    }
    function updateAim(e) {
      if (status !== 'playing' || moving) return;
      var who = turnHost ? 'host' : 'guest';
      if (who !== (youHost ? 'host' : 'guest')) return;
      var ball = turnHost ? hostPl : guestPl;
      if (!ball || ball.sunk) return;
      var p = localPos(e);
      aimAngle = Math.atan2(p.y - ball.y, p.x - ball.x);
      render();
    }
    canvas.addEventListener('mousemove', updateAim);
    canvas.addEventListener('touchmove', function (e) { updateAim(e); e.preventDefault(); }, { passive: false });

    function tryShoot() {
      if (status !== 'playing' || moving) return;
      var who = turnHost ? 'host' : 'guest';
      if (who !== (youHost ? 'host' : 'guest')) return;
      ctx.send('putt', { angle: aimAngle, power: aimPower });
      applyPutt(aimAngle, aimPower);
    }

    function applyPutt(angle, power) {
      var ball = turnHost ? hostPl : guestPl;
      if (!ball || ball.sunk) return;
      ball.vx = Math.cos(angle) * power;
      ball.vy = Math.sin(angle) * power;
      ball.strokes += 1;
      moving = true;
      runSim();
    }

    var raf = null;
    function runSim() {
      function tick() {
        var ball = turnHost ? hostPl : guestPl;
        if (!ball) return;
        var course = COURSES[holeIdx];
        ball.x += ball.vx; ball.y += ball.vy;
        ball.vx *= FRICTION; ball.vy *= FRICTION;
        if (Math.abs(ball.vx) < MIN_V) ball.vx = 0;
        if (Math.abs(ball.vy) < MIN_V) ball.vy = 0;
        // Outer walls
        if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = -ball.vx * 0.9; }
        if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -ball.vx * 0.9; }
        if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = -ball.vy * 0.9; }
        if (ball.y > H - BALL_R) { ball.y = H - BALL_R; ball.vy = -ball.vy * 0.9; }
        // Wall obstacles
        (course.walls || []).forEach(function (w) {
          var nx = Math.max(w.x, Math.min(ball.x, w.x + w.w));
          var ny = Math.max(w.y, Math.min(ball.y, w.y + w.h));
          var dx = ball.x - nx, dy = ball.y - ny;
          var d2 = dx * dx + dy * dy;
          if (d2 < BALL_R * BALL_R && d2 > 0.0001) {
            var d = Math.sqrt(d2);
            var nrmX = dx / d, nrmY = dy / d;
            var overlap = BALL_R - d;
            ball.x += nrmX * overlap; ball.y += nrmY * overlap;
            var dot = ball.vx * nrmX + ball.vy * nrmY;
            ball.vx -= 2 * dot * nrmX; ball.vy -= 2 * dot * nrmY;
            ball.vx *= 0.85; ball.vy *= 0.85;
          }
        });
        // Bumpers (push ball with extra energy)
        (course.bumpers || []).forEach(function (b) {
          var dx = ball.x - b.x, dy = ball.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < BALL_R + b.r && d > 0.0001) {
            var nrmX = dx / d, nrmY = dy / d;
            var overlap = (BALL_R + b.r) - d;
            ball.x += nrmX * overlap; ball.y += nrmY * overlap;
            var dot = ball.vx * nrmX + ball.vy * nrmY;
            ball.vx -= 2 * dot * nrmX; ball.vy -= 2 * dot * nrmY;
            ball.vx *= 1.1; ball.vy *= 1.1;
          }
        });
        // Hole sink
        var dxh = ball.x - course.hole.x, dyh = ball.y - course.hole.y;
        if (dxh * dxh + dyh * dyh < HOLE_R * HOLE_R && Math.hypot(ball.vx, ball.vy) < 5) {
          ball.sunk = true; ball.vx = 0; ball.vy = 0; ball.x = course.hole.x; ball.y = course.hole.y;
        }
        render();
        if (ball.vx === 0 && ball.vy === 0) {
          moving = false;
          afterShot();
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      tick();
    }

    function afterShot() {
      // If both sunk, advance hole
      if (hostPl.sunk && guestPl.sunk) {
        hostTotals.push(hostPl.strokes);
        guestTotals.push(guestPl.strokes);
        holeIdx++;
        if (holeIdx >= COURSES.length) {
          var hT = hostTotals.reduce(function (a, b) { return a + b; }, 0);
          var gT = guestTotals.reduce(function (a, b) { return a + b; }, 0);
          status = 'over';
          var youTotal = youHost ? hT : gT;
          var peerTotal = youHost ? gT : hT;
          info.textContent = 'Final — You ' + youTotal + ' / Peer ' + peerTotal + '. ' +
            (youTotal < peerTotal ? 'You won!' : youTotal > peerTotal ? 'You lost.' : 'Tie.');
          ctx.setStatus(info.textContent);
          shootBtn.disabled = true;
          return;
        }
        startHole();
        return;
      }
      // Otherwise pass turn to non-sunk player (or other player)
      if (!turnHost && !guestPl.sunk) { /* guest continues until sunk */ }
      // Switch turn unless current player not sunk and other already sunk
      if (turnHost) {
        if (!hostPl.sunk && guestPl.sunk) { /* host continues */ }
        else turnHost = false;
      } else {
        if (!guestPl.sunk && hostPl.sunk) { /* guest continues */ }
        else turnHost = true;
      }
      announce();
    }

    function render() {
      var course = COURSES[holeIdx];
      c.clearRect(0, 0, W, H);
      // Walls
      c.fillStyle = '#4a2a10';
      (course.walls || []).forEach(function (w) { c.fillRect(w.x, w.y, w.w, w.h); });
      // Bumpers
      c.fillStyle = '#cc4422';
      (course.bumpers || []).forEach(function (b) { c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill(); });
      // Hole
      c.fillStyle = '#000'; c.beginPath(); c.arc(course.hole.x, course.hole.y, HOLE_R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
      // Tee marker
      c.strokeStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.arc(course.tee.x, course.tee.y, BALL_R + 4, 0, Math.PI * 2); c.stroke();
      // Balls
      function drawBall(p, color) {
        if (!p || p.sunk) return;
        c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, BALL_R, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#000'; c.stroke();
      }
      drawBall(hostPl, '#ff5050');
      drawBall(guestPl, '#50d4ff');
      // Aim
      if (!moving && status === 'playing') {
        var who = turnHost ? 'host' : 'guest';
        if (who === (youHost ? 'host' : 'guest')) {
          var ball = turnHost ? hostPl : guestPl;
          if (ball && !ball.sunk) {
            c.strokeStyle = 'rgba(255,255,255,.7)'; c.setLineDash([5, 4]); c.lineWidth = 2;
            c.beginPath(); c.moveTo(ball.x, ball.y); c.lineTo(ball.x + Math.cos(aimAngle) * (aimPower * 12), ball.y + Math.sin(aimAngle) * (aimPower * 12)); c.stroke();
            c.setLineDash([]);
          }
        }
      }
    }

    function onPayload(type, payload) {
      if (type === 'putt' && payload) {
        applyPutt(payload.angle, payload.power);
      }
    }

    startHole();
    return {
      onPayload: onPayload,
      dispose: function () {
        if (raf) cancelAnimationFrame(raf);
        try { wrap.remove(); } catch (_) {}
      }
    };
  }

  window.OST_MESH_GAMES.register('minigolf', {
    label: 'Mini Golf',
    blurb: '3-hole course series. Bumpers, walls, lowest strokes wins.',
    icon: '⛳',
    factory: factory
  });
})();
