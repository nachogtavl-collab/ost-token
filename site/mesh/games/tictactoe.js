/* games/tictactoe.js — Mesh casual TTT (lockstep) */
(function () {
  'use strict';
  if (!window.OST_MESH_GAMES) return;

  function factory(ctx) {
    var board = [0,0,0,0,0,0,0,0,0]; // 0 empty, 1 X, 2 O
    // Host plays X (turn 1), guest plays O (turn 2)
    var youAre = ctx.host ? 1 : 2;
    var turn = 1;
    var status = 'playing';

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:10px;justify-items:center';
    var info = document.createElement('div');
    info.style.cssText = 'color:#cdfaff;font-size:13px;font-weight:600';
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,84px);grid-template-rows:repeat(3,84px);gap:6px;background:rgba(255,255,255,.06);padding:6px;border-radius:14px';
    var cells = [];
    for (var i = 0; i < 9; i++) {
      (function (idx) {
        var c = document.createElement('button');
        c.type = 'button';
        c.style.cssText = 'width:84px;height:84px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#fff;font-size:36px;font-weight:900;cursor:pointer';
        c.onclick = function () { tryMove(idx, true); };
        cells.push(c);
        grid.appendChild(c);
      })(i);
    }
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px';
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button';
    quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:8px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#e8fbff;cursor:pointer;font-weight:700';
    quitBtn.onclick = function () { ctx.end('quit'); };
    actions.appendChild(quitBtn);

    wrap.appendChild(info);
    wrap.appendChild(grid);
    wrap.appendChild(actions);
    ctx.mount.appendChild(wrap);
    render();

    function render() {
      for (var i = 0; i < 9; i++) {
        var v = board[i];
        cells[i].textContent = v === 1 ? '✕' : v === 2 ? '◯' : '';
        cells[i].style.color = v === 1 ? '#00d4ff' : v === 2 ? '#00ff9f' : '#fff';
        cells[i].disabled = !!v || status !== 'playing';
      }
      if (status !== 'playing') {
        info.textContent = status === 'draw' ? 'Draw!' : (status === 'win' ? 'You won!' : 'You lost.');
        return;
      }
      info.textContent = (turn === youAre) ? 'Your turn (' + (youAre === 1 ? '✕' : '◯') + ')' : "Peer's turn...";
    }

    function checkWinner() {
      var L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      for (var i = 0; i < L.length; i++) {
        var a = L[i][0], b = L[i][1], c = L[i][2];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
      }
      if (board.every(function (v) { return v !== 0; })) return -1;
      return 0;
    }

    function applyMove(idx, by) {
      if (board[idx] !== 0) return false;
      if (by !== turn) return false;
      board[idx] = by;
      var w = checkWinner();
      if (w === -1) { status = 'draw'; ctx.setStatus('Draw.'); }
      else if (w !== 0) { status = (w === youAre) ? 'win' : 'lose'; ctx.setStatus(status === 'win' ? 'You won!' : 'You lost.'); }
      else { turn = (turn === 1) ? 2 : 1; }
      render();
      return true;
    }

    function tryMove(idx, local) {
      if (status !== 'playing') return;
      if (local && turn !== youAre) return;
      if (board[idx] !== 0) return;
      if (local) {
        if (!applyMove(idx, youAre)) return;
        ctx.send('move', { idx: idx, by: youAre });
      }
    }

    function onPayload(type, payload) {
      if (type === 'move' && payload && typeof payload.idx === 'number') {
        applyMove(payload.idx, payload.by === 1 ? 1 : 2);
      }
    }

    return {
      onPayload: onPayload,
      dispose: function () { try { wrap.remove(); } catch (_) {} }
    };
  }

  window.OST_MESH_GAMES.register('tictactoe', {
    label: 'Tic-Tac-Toe',
    blurb: 'Quick warm-up. First to three in a row.',
    icon: '#️⃣',
    factory: factory
  });
})();
