/* games/pool8.js — Mesh casual 8-Ball Pool (2D top-down, host-authoritative)
   Host runs physics; sends ball state to peer ~30Hz while balls move.
   Guest sends shot input; host applies on next idle frame.
*/
(function () {
  'use strict';
  if (!window.OST_MESH_GAMES) return;

  // Table: 800x400 internal coords; 6 pockets at corners + mid-rails.
  var W = 800, H = 400, R = 11, FRICTION = 0.985, MIN_V = 0.05;
  var POCKETS = [
    {x:18,y:18,r:22},{x:W/2,y:14,r:20},{x:W-18,y:18,r:22},
    {x:18,y:H-18,r:22},{x:W/2,y:H-14,r:20},{x:W-18,y:H-18,r:22}
  ];

  function ballColors() {
    return [
      '#ffffff', // 0 cue
      '#f6cf16','#1f5fff','#d11414','#5b1f9e','#ff8a1f','#1d8c2c','#7a1818','#111111',
      '#f6cf16','#1f5fff','#d11414','#5b1f9e','#ff8a1f','#1d8c2c','#7a1818'
    ];
  }
  function isStripe(n) { return n >= 9 && n <= 15; }

  function rackBalls() {
    // Cue at left third center; 15 object balls in triangle at right third
    var balls = [];
    balls.push({ n: 0, x: W * 0.25, y: H / 2, vx: 0, vy: 0, alive: true });
    var cx = W * 0.7, cy = H / 2;
    var order = [1,11,2,3,8,12,9,7,14,4,6,15,13,5,10];
    var k = 0;
    for (var col = 0; col < 5; col++) {
      for (var row = 0; row <= col; row++) {
        var x = cx + col * (R * 2 + 0.5);
        var y = cy + (row - col / 2) * (R * 2 + 0.5);
        balls.push({ n: order[k++], x: x, y: y, vx: 0, vy: 0, alive: true });
      }
    }
    return balls;
  }

  function step(balls) {
    // Move
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i]; if (!b.alive) continue;
      b.x += b.vx; b.y += b.vy;
      b.vx *= FRICTION; b.vy *= FRICTION;
      if (Math.abs(b.vx) < MIN_V) b.vx = 0;
      if (Math.abs(b.vy) < MIN_V) b.vy = 0;
      // Walls
      if (b.x < R) { b.x = R; b.vx = -b.vx * 0.9; }
      if (b.x > W - R) { b.x = W - R; b.vx = -b.vx * 0.9; }
      if (b.y < R) { b.y = R; b.vy = -b.vy * 0.9; }
      if (b.y > H - R) { b.y = H - R; b.vy = -b.vy * 0.9; }
    }
    // Collisions
    for (var i = 0; i < balls.length; i++) {
      var a = balls[i]; if (!a.alive) continue;
      for (var j = i + 1; j < balls.length; j++) {
        var b2 = balls[j]; if (!b2.alive) continue;
        var dx = b2.x - a.x, dy = b2.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < (R * 2) * (R * 2) && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var nx = dx / d, ny = dy / d;
          var overlap = (R * 2 - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b2.x += nx * overlap; b2.y += ny * overlap;
          var dvx = b2.vx - a.vx, dvy = b2.vy - a.vy;
          var p = dvx * nx + dvy * ny;
          if (p < 0) {
            a.vx += p * nx; a.vy += p * ny;
            b2.vx -= p * nx; b2.vy -= p * ny;
          }
        }
      }
    }
    // Pocket
    var pocketed = [];
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i]; if (!b.alive) continue;
      for (var p = 0; p < POCKETS.length; p++) {
        var pk = POCKETS[p];
        var dx = b.x - pk.x, dy = b.y - pk.y;
        if (dx * dx + dy * dy < pk.r * pk.r) {
          b.alive = false; b.vx = 0; b.vy = 0;
          pocketed.push(b.n);
          break;
        }
      }
    }
    return pocketed;
  }

  function isResting(balls) {
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].alive && (balls[i].vx !== 0 || balls[i].vy !== 0)) return false;
    }
    return true;
  }

  function factory(ctx) {
    var balls = rackBalls();
    var youHost = !!ctx.host;
    var turnHost = true; // host breaks
    var assigned = null; // {host:'solid'|'stripe', guest:...}
    var status = 'playing';
    var winner = null;
    var moving = false;
    var ballInHand = false;
    var pocketedThisShot = [];
    var aimAngle = 0, aimPower = 6;

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:8px;justify-items:center';
    var info = document.createElement('div');
    info.style.cssText = 'color:#cdfaff;font-size:13px;font-weight:600;text-align:center';
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = 'max-width:100%;height:auto;background:#0d6b2a;border-radius:14px;border:6px solid #5a3a1a;cursor:crosshair;touch-action:none';
    var ctrls = document.createElement('div');
    ctrls.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center';
    var pwLabel = document.createElement('span'); pwLabel.style.cssText = 'color:#cdfaff;font-size:12px';
    var pw = document.createElement('input');
    pw.type = 'range'; pw.min = '1'; pw.max = '20'; pw.value = '8'; pw.style.width = '160px';
    pw.oninput = function () { aimPower = Number(pw.value); pwLabel.textContent = 'Power: ' + aimPower; render(); };
    pwLabel.textContent = 'Power: ' + aimPower;
    var shootBtn = document.createElement('button');
    shootBtn.type = 'button'; shootBtn.textContent = 'Shoot';
    shootBtn.style.cssText = 'padding:8px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#00d4ff,#00ff9f);color:#021;cursor:pointer;font-weight:800';
    shootBtn.onclick = function () { tryShoot(); };
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button'; quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#e8fbff;cursor:pointer;font-weight:700';
    quitBtn.onclick = function () { ctx.end('quit'); };
    ctrls.appendChild(pwLabel); ctrls.appendChild(pw); ctrls.appendChild(shootBtn); ctrls.appendChild(quitBtn);

    wrap.appendChild(info);
    wrap.appendChild(canvas);
    wrap.appendChild(ctrls);
    ctx.mount.appendChild(wrap);
    var c = canvas.getContext('2d');
    var colors = ballColors();

    function localPos(evt) {
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      var x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      var y = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
      return { x: x * sx, y: y * sy };
    }
    canvas.addEventListener('mousemove', updateAim);
    canvas.addEventListener('touchmove', function (e) { updateAim(e); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('click', function (e) { if (ballInHand) placeCue(e); });

    function updateAim(e) {
      if (moving || status !== 'playing' || ballInHand) return;
      if (!myTurn()) return;
      var p = localPos(e);
      var cue = balls[0];
      aimAngle = Math.atan2(p.y - cue.y, p.x - cue.x);
      render();
    }

    function placeCue(e) {
      if (!myTurn() || !ballInHand || status !== 'playing') return;
      var p = localPos(e);
      balls[0].x = Math.min(W - R, Math.max(R, p.x));
      balls[0].y = Math.min(H - R, Math.max(R, p.y));
      balls[0].alive = true; balls[0].vx = 0; balls[0].vy = 0;
      ballInHand = false;
      // Sync placement
      sendState({ turnHost: turnHost, assigned: assigned, ballInHand: false });
      render();
    }

    function myTurn() { return (turnHost && youHost) || (!turnHost && !youHost); }

    function tryShoot() {
      if (status !== 'playing' || moving || ballInHand) return;
      if (!myTurn()) { ctx.setStatus("Wait for peer's shot."); return; }
      // Guest sends input to host; host applies.
      if (youHost) {
        applyShot(aimAngle, aimPower);
      } else {
        ctx.send('shot', { angle: aimAngle, power: aimPower });
      }
    }

    function applyShot(angle, power) {
      if (!balls[0].alive) return;
      pocketedThisShot = [];
      balls[0].vx = Math.cos(angle) * power;
      balls[0].vy = Math.sin(angle) * power;
      moving = true;
      runSim();
    }

    var simHandle = null;
    function runSim() {
      if (!youHost) return; // only host simulates
      var lastBroadcast = 0;
      function tick() {
        var pocketed = step(balls);
        if (pocketed.length) pocketedThisShot.push.apply(pocketedThisShot, pocketed);
        render();
        var now = performance.now();
        if (now - lastBroadcast > 33) {
          sendState({ turnHost: turnHost, assigned: assigned, ballInHand: ballInHand });
          lastBroadcast = now;
        }
        if (isResting(balls)) {
          moving = false;
          resolveShot();
          sendState({ turnHost: turnHost, assigned: assigned, ballInHand: ballInHand, final: true });
          return;
        }
        simHandle = requestAnimationFrame(tick);
      }
      tick();
    }

    function resolveShot() {
      // Determine assignments + turn change
      var cuePotted = pocketedThisShot.indexOf(0) >= 0;
      var eightPotted = pocketedThisShot.indexOf(8) >= 0;
      var solids = pocketedThisShot.filter(function (n) { return n >= 1 && n <= 7; });
      var stripes = pocketedThisShot.filter(function (n) { return n >= 9 && n <= 15; });
      var shooter = turnHost ? 'host' : 'guest';

      if (eightPotted) {
        var shooterGroup = assigned ? assigned[shooter] : null;
        var shooterRemaining = (shooterGroup === 'solid')
          ? balls.filter(function (b) { return b.n >= 1 && b.n <= 7 && b.alive; }).length
          : (shooterGroup === 'stripe')
            ? balls.filter(function (b) { return b.n >= 9 && b.n <= 15 && b.alive; }).length
            : 99;
        if (shooterRemaining === 0 && !cuePotted) {
          status = 'over'; winner = shooter; ctx.setStatus(shooter === (youHost ? 'host' : 'guest') ? 'You won!' : 'You lost.');
        } else {
          status = 'over'; winner = (shooter === 'host') ? 'guest' : 'host';
          ctx.setStatus(winner === (youHost ? 'host' : 'guest') ? 'You won (peer pocketed 8 early)!' : 'You lost (8-ball foul).');
        }
        return;
      }

      if (!assigned && (solids.length || stripes.length) && !cuePotted) {
        if (solids.length && !stripes.length) {
          assigned = shooter === 'host' ? { host: 'solid', guest: 'stripe' } : { host: 'stripe', guest: 'solid' };
        } else if (stripes.length && !solids.length) {
          assigned = shooter === 'host' ? { host: 'stripe', guest: 'solid' } : { host: 'solid', guest: 'stripe' };
        }
      }

      var legalGroupHits = 0;
      if (assigned) {
        var grp = assigned[shooter];
        legalGroupHits = (grp === 'solid' ? solids.length : stripes.length);
      } else {
        legalGroupHits = solids.length + stripes.length;
      }

      var foul = cuePotted;
      if (cuePotted) {
        balls[0].alive = true; balls[0].vx = 0; balls[0].vy = 0;
        ballInHand = true; // for opponent
      }

      if (foul || legalGroupHits === 0) {
        turnHost = !turnHost;
      }
      // else: shooter continues
      ctx.setStatus(myTurn() ? 'Your shot.' : "Peer's shot.");
    }

    function sendState(extra) {
      if (!youHost) return;
      var snap = balls.map(function (b) { return [b.n, Math.round(b.x * 10), Math.round(b.y * 10), Math.round(b.vx * 100), Math.round(b.vy * 100), b.alive ? 1 : 0]; });
      ctx.send('state', { b: snap, t: turnHost, a: assigned, h: extra && extra.ballInHand, f: !!(extra && extra.final), s: status, w: winner });
    }

    function applyState(payload) {
      if (!payload || !payload.b) return;
      payload.b.forEach(function (row, i) {
        if (!balls[i]) return;
        balls[i].n = row[0];
        balls[i].x = row[1] / 10; balls[i].y = row[2] / 10;
        balls[i].vx = row[3] / 100; balls[i].vy = row[4] / 100;
        balls[i].alive = !!row[5];
      });
      turnHost = !!payload.t;
      assigned = payload.a || null;
      ballInHand = !!payload.h;
      if (payload.s) status = payload.s;
      if (payload.w) winner = payload.w;
      moving = !payload.f && !isResting(balls);
      if (status === 'over') {
        ctx.setStatus(winner === (youHost ? 'host' : 'guest') ? 'You won!' : 'You lost.');
      } else if (payload.f) {
        ctx.setStatus(myTurn() ? 'Your shot.' : "Peer's shot.");
      }
      render();
    }

    function render() {
      c.clearRect(0, 0, W, H);
      // Pockets
      c.fillStyle = '#000';
      POCKETS.forEach(function (p) { c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); });
      // Balls
      for (var i = 0; i < balls.length; i++) {
        var b = balls[i]; if (!b.alive) continue;
        c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2);
        c.fillStyle = colors[b.n] || '#fff'; c.fill();
        c.strokeStyle = '#222'; c.lineWidth = 1; c.stroke();
        if (isStripe(b.n)) {
          c.save(); c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.clip();
          c.fillStyle = '#fff'; c.fillRect(b.x - R, b.y - R / 2, R * 2, R); c.restore();
          c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.strokeStyle = '#222'; c.stroke();
        }
        if (b.n > 0) {
          c.fillStyle = '#fff'; c.beginPath(); c.arc(b.x, b.y, R * 0.45, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#000'; c.font = '10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(String(b.n), b.x, b.y);
        }
      }
      // Aim line
      if (!moving && status === 'playing' && balls[0].alive && myTurn() && !ballInHand) {
        var cue = balls[0];
        c.strokeStyle = 'rgba(255,255,255,.6)'; c.setLineDash([6, 4]); c.lineWidth = 2;
        c.beginPath(); c.moveTo(cue.x, cue.y); c.lineTo(cue.x + Math.cos(aimAngle) * 200, cue.y + Math.sin(aimAngle) * 200); c.stroke();
        c.setLineDash([]);
      }
      // Info
      var grp = assigned ? assigned[youHost ? 'host' : 'guest'] : '?';
      info.textContent = (status === 'over' ? (winner === (youHost ? 'host' : 'guest') ? 'You won!' : 'You lost.') :
        ((myTurn() ? 'Your shot' : "Peer's shot") + ' · You: ' + grp + (ballInHand && myTurn() ? ' · Click table to place cue' : '')));
    }

    function onPayload(type, payload) {
      if (type === 'shot' && youHost && payload) {
        if (turnHost) return; // ignore if not guest's turn
        applyShot(payload.angle, payload.power);
      } else if (type === 'state' && !youHost && payload) {
        applyState(payload);
      }
    }

    render();
    return {
      onPayload: onPayload,
      dispose: function () {
        if (simHandle) cancelAnimationFrame(simHandle);
        try { wrap.remove(); } catch (_) {}
      }
    };
  }

  window.OST_MESH_GAMES.register('pool8', {
    label: '8-Ball Pool',
    blurb: '2D top-down pool. Real ball collisions and pockets.',
    icon: '🎱',
    factory: factory
  });
})();
