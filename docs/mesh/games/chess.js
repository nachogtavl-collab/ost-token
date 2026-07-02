/* games/chess.js — Mesh casual Chess (full FIDE rules, lockstep)
   Pieces: P N B R Q K (white uppercase), p n b r q k (black lowercase).
   Coordinates 0..63, file = i%8, rank = 7 - Math.floor(i/8) (a1 = bottom-left for white).
*/
(function () {
  'use strict';
  if (!window.OST_MESH_GAMES) return;

  var INITIAL = [
    'r','n','b','q','k','b','n','r',
    'p','p','p','p','p','p','p','p',
    '.','.','.','.','.','.','.','.',
    '.','.','.','.','.','.','.','.',
    '.','.','.','.','.','.','.','.',
    '.','.','.','.','.','.','.','.',
    'P','P','P','P','P','P','P','P',
    'R','N','B','Q','K','B','N','R'
  ];
  var GLYPH = { K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙', k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟' };

  function isWhite(p) { return p && p !== '.' && p === p.toUpperCase(); }
  function isBlack(p) { return p && p !== '.' && p === p.toLowerCase() && p !== '.'; }
  function sameSide(a, b) { if (!a || a === '.' || !b || b === '.') return false; return isWhite(a) === isWhite(b); }
  function inb(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
  function fr(i) { return [i % 8, Math.floor(i / 8)]; } // file, rank-from-top (0 = top)
  function idx(f, r) { return r * 8 + f; }

  // Generate pseudo-legal moves for a piece at i, given board+state.
  function genMoves(board, state, i) {
    var p = board[i]; if (!p || p === '.') return [];
    var f = i % 8, r = Math.floor(i / 8);
    var moves = [];
    var dir = isWhite(p) ? -1 : 1; // white moves toward rank 0 (top in our flat array)
    var startR = isWhite(p) ? 6 : 1;
    var promoR = isWhite(p) ? 0 : 7;
    var lower = p.toLowerCase();
    function add(tf, tr, flag) {
      if (!inb(tf, tr)) return;
      var t = idx(tf, tr);
      if (flag === 'pawn-push') {
        if (board[t] === '.') {
          if (tr === promoR) ['q','r','b','n'].forEach(function (pp) { moves.push({ from: i, to: t, promo: isWhite(p) ? pp.toUpperCase() : pp }); });
          else moves.push({ from: i, to: t });
        }
      } else if (flag === 'pawn-cap') {
        if (board[t] !== '.' && !sameSide(p, board[t])) {
          if (tr === promoR) ['q','r','b','n'].forEach(function (pp) { moves.push({ from: i, to: t, promo: isWhite(p) ? pp.toUpperCase() : pp }); });
          else moves.push({ from: i, to: t });
        } else if (state.ep === t) {
          moves.push({ from: i, to: t, ep: true });
        }
      } else {
        if (board[t] === '.' || !sameSide(p, board[t])) moves.push({ from: i, to: t });
      }
    }
    function ray(df, dr) {
      var tf = f + df, tr = r + dr;
      while (inb(tf, tr)) {
        var t = idx(tf, tr);
        if (board[t] === '.') moves.push({ from: i, to: t });
        else { if (!sameSide(p, board[t])) moves.push({ from: i, to: t }); break; }
        tf += df; tr += dr;
      }
    }
    if (lower === 'p') {
      add(f, r + dir, 'pawn-push');
      if (r === startR && board[idx(f, r + dir)] === '.' && board[idx(f, r + 2 * dir)] === '.') {
        moves.push({ from: i, to: idx(f, r + 2 * dir), double: true });
      }
      add(f - 1, r + dir, 'pawn-cap');
      add(f + 1, r + dir, 'pawn-cap');
    } else if (lower === 'n') {
      [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(function (d) { add(f + d[0], r + d[1]); });
    } else if (lower === 'b') {
      ray(1,1); ray(-1,1); ray(1,-1); ray(-1,-1);
    } else if (lower === 'r') {
      ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
    } else if (lower === 'q') {
      ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
      ray(1,1); ray(-1,1); ray(1,-1); ray(-1,-1);
    } else if (lower === 'k') {
      for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) if (df || dr) add(f + df, r + dr);
      // Castling: king on starting square, not in check, path empty + safe, rook on corner with rights.
      var rights = state.castle;
      var rank = isWhite(p) ? 7 : 0;
      if (i === idx(4, rank) && !isInCheck(board, state, isWhite(p))) {
        if ((isWhite(p) && rights.indexOf('K') >= 0) || (!isWhite(p) && rights.indexOf('k') >= 0)) {
          if (board[idx(5, rank)] === '.' && board[idx(6, rank)] === '.' &&
              !squareAttacked(board, idx(5, rank), !isWhite(p)) &&
              !squareAttacked(board, idx(6, rank), !isWhite(p))) {
            moves.push({ from: i, to: idx(6, rank), castle: 'K' });
          }
        }
        if ((isWhite(p) && rights.indexOf('Q') >= 0) || (!isWhite(p) && rights.indexOf('q') >= 0)) {
          if (board[idx(1, rank)] === '.' && board[idx(2, rank)] === '.' && board[idx(3, rank)] === '.' &&
              !squareAttacked(board, idx(3, rank), !isWhite(p)) &&
              !squareAttacked(board, idx(2, rank), !isWhite(p))) {
            moves.push({ from: i, to: idx(2, rank), castle: 'Q' });
          }
        }
      }
    }
    return moves;
  }

  // Is square `sq` attacked by `byWhite` side?
  function squareAttacked(board, sq, byWhite) {
    var f = sq % 8, r = Math.floor(sq / 8);
    // Pawn attacks
    var pdir = byWhite ? -1 : 1;
    var pp = byWhite ? 'P' : 'p';
    if (inb(f - 1, r - pdir * (-1))) {
      // pawn that attacks `sq` sits at f±1 and rank r+pdir? Actually a white pawn at (f-1, r+1) attacks (f, r). Re-derive:
    }
    // Simpler: scan all enemy pieces, gen pseudo moves, see if any captures sq.
    for (var i = 0; i < 64; i++) {
      var p2 = board[i]; if (!p2 || p2 === '.') continue;
      if (byWhite !== isWhite(p2)) continue;
      // Skip castling for attack purposes: just look at non-castle moves, ignore king castling step.
      var moves = pseudoAttacks(board, i);
      for (var j = 0; j < moves.length; j++) if (moves[j].to === sq) return true;
    }
    return false;
  }

  function pseudoAttacks(board, i) {
    var p = board[i]; if (!p || p === '.') return [];
    var f = i % 8, r = Math.floor(i / 8);
    var lower = p.toLowerCase();
    var out = [];
    function add(tf, tr) { if (inb(tf, tr)) out.push({ from: i, to: idx(tf, tr) }); }
    function ray(df, dr) {
      var tf = f + df, tr = r + dr;
      while (inb(tf, tr)) {
        var t = idx(tf, tr);
        out.push({ from: i, to: t });
        if (board[t] !== '.') break;
        tf += df; tr += dr;
      }
    }
    if (lower === 'p') {
      var dir = isWhite(p) ? -1 : 1;
      add(f - 1, r + dir); add(f + 1, r + dir);
    } else if (lower === 'n') {
      [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(function (d) { add(f + d[0], r + d[1]); });
    } else if (lower === 'b') { ray(1,1); ray(-1,1); ray(1,-1); ray(-1,-1); }
    else if (lower === 'r') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); }
    else if (lower === 'q') { ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); ray(1,1); ray(-1,1); ray(1,-1); ray(-1,-1); }
    else if (lower === 'k') { for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) if (df || dr) add(f + df, r + dr); }
    return out;
  }

  function findKing(board, white) {
    var k = white ? 'K' : 'k';
    for (var i = 0; i < 64; i++) if (board[i] === k) return i;
    return -1;
  }

  function isInCheck(board, state, whiteToCheck) {
    var k = findKing(board, whiteToCheck); if (k < 0) return false;
    return squareAttacked(board, k, !whiteToCheck);
  }

  // Apply a move to a fresh state. Returns { board, state } or null if illegal (king left in check).
  function applyMove(board, state, mv) {
    var newBoard = board.slice();
    var p = newBoard[mv.from];
    var captured = newBoard[mv.to];
    newBoard[mv.to] = mv.promo || p;
    newBoard[mv.from] = '.';
    var newState = {
      whiteTurn: !state.whiteTurn,
      castle: state.castle,
      ep: -1,
      halfmove: (p.toLowerCase() === 'p' || captured !== '.') ? 0 : (state.halfmove + 1),
      fullmove: state.fullmove + (state.whiteTurn ? 0 : 1)
    };
    // En passant capture
    if (mv.ep) newBoard[idx(mv.to % 8, Math.floor(mv.from / 8))] = '.';
    // Double pawn push -> set ep target
    if (mv.double) {
      var dir = isWhite(p) ? -1 : 1;
      newState.ep = idx(mv.from % 8, Math.floor(mv.from / 8) + dir);
    }
    // Castling rook move
    if (mv.castle) {
      var rank = Math.floor(mv.from / 8);
      if (mv.castle === 'K') { newBoard[idx(5, rank)] = newBoard[idx(7, rank)]; newBoard[idx(7, rank)] = '.'; }
      else { newBoard[idx(3, rank)] = newBoard[idx(0, rank)]; newBoard[idx(0, rank)] = '.'; }
    }
    // Update castling rights
    var c = newState.castle;
    if (p === 'K') c = c.replace(/[KQ]/g, '');
    if (p === 'k') c = c.replace(/[kq]/g, '');
    if (mv.from === idx(0, 7) || mv.to === idx(0, 7)) c = c.replace('Q', '');
    if (mv.from === idx(7, 7) || mv.to === idx(7, 7)) c = c.replace('K', '');
    if (mv.from === idx(0, 0) || mv.to === idx(0, 0)) c = c.replace('q', '');
    if (mv.from === idx(7, 0) || mv.to === idx(7, 0)) c = c.replace('k', '');
    newState.castle = c || '-';

    // Reject if our own king is in check
    if (isInCheck(newBoard, newState, !newState.whiteTurn)) return null;
    return { board: newBoard, state: newState };
  }

  function legalMoves(board, state, i) {
    var p = board[i]; if (!p || p === '.') return [];
    if (isWhite(p) !== state.whiteTurn) return [];
    var pseudo = genMoves(board, state, i);
    return pseudo.filter(function (mv) { return !!applyMove(board, state, mv); });
  }

  function allLegal(board, state) {
    var out = [];
    for (var i = 0; i < 64; i++) if (board[i] !== '.' && isWhite(board[i]) === state.whiteTurn) {
      var ms = legalMoves(board, state, i);
      for (var j = 0; j < ms.length; j++) out.push(ms[j]);
    }
    return out;
  }

  function factory(ctx) {
    var board = INITIAL.slice();
    var state = { whiteTurn: true, castle: 'KQkq', ep: -1, halfmove: 0, fullmove: 1 };
    var youAreWhite = !!ctx.host; // host plays white
    var selected = -1;
    var status = 'playing';
    var lastMove = null;

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:10px;justify-items:center';
    var info = document.createElement('div');
    info.style.cssText = 'color:#cdfaff;font-size:13px;font-weight:600;text-align:center';
    var board8 = document.createElement('div');
    board8.style.cssText = 'display:grid;grid-template-columns:repeat(8,48px);grid-template-rows:repeat(8,48px);border:2px solid rgba(255,255,255,.2);border-radius:6px;background:#1a2733';
    var cells = [];
    for (var i = 0; i < 64; i++) {
      (function (sq) {
        var c = document.createElement('button');
        c.type = 'button';
        c.dataset.sq = sq;
        c.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:30px;cursor:pointer;border:none;background:transparent;color:#fff;line-height:1;padding:0';
        c.onclick = function () { onCellClick(sq); };
        cells.push(c);
        board8.appendChild(c);
      })(i);
    }
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px';
    var resignBtn = document.createElement('button');
    resignBtn.type = 'button'; resignBtn.textContent = 'Resign';
    resignBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(255,80,80,.4);background:rgba(255,80,80,.15);color:#ffb4b4;cursor:pointer;font-weight:700';
    resignBtn.onclick = function () {
      if (status !== 'playing') return;
      ctx.send('resign', null); status = 'lose'; ctx.setStatus('You resigned.'); render();
    };
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button'; quitBtn.textContent = 'Quit';
    quitBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#e8fbff;cursor:pointer;font-weight:700';
    quitBtn.onclick = function () { ctx.end('quit'); };
    actions.appendChild(resignBtn); actions.appendChild(quitBtn);

    wrap.appendChild(info);
    wrap.appendChild(board8);
    wrap.appendChild(actions);
    ctx.mount.appendChild(wrap);

    function squareForView(sq) {
      // If you are black, rotate the board so your pieces are at the bottom.
      if (youAreWhite) return sq;
      return 63 - sq;
    }

    function render() {
      // Reorder cells visually based on side.
      // We rebuild the DOM children order: easier to just recolor + re-fill content using viewSq.
      board8.innerHTML = '';
      var legal = (selected >= 0) ? legalMoves(board, state, selected).map(function (m) { return m.to; }) : [];
      var orderedIdx = [];
      for (var v = 0; v < 64; v++) {
        var sq = youAreWhite ? v : (63 - v);
        orderedIdx.push(sq);
      }
      orderedIdx.forEach(function (sq) {
        var f = sq % 8, r = Math.floor(sq / 8);
        var dark = (f + r) % 2 === 1;
        var btn = cells[sq];
        btn.style.background = dark ? '#445566' : '#a8b8c4';
        btn.style.color = isWhite(board[sq]) ? '#fff' : '#1a1a1a';
        btn.textContent = GLYPH[board[sq]] || '';
        if (sq === selected) btn.style.boxShadow = 'inset 0 0 0 3px #00ff9f';
        else if (legal.indexOf(sq) >= 0) btn.style.boxShadow = 'inset 0 0 0 3px rgba(0,212,255,.7)';
        else if (lastMove && (sq === lastMove.from || sq === lastMove.to)) btn.style.boxShadow = 'inset 0 0 0 3px rgba(255,255,0,.5)';
        else btn.style.boxShadow = 'none';
        board8.appendChild(btn);
      });
      if (status === 'win') info.textContent = 'You won!';
      else if (status === 'lose') info.textContent = 'You lost.';
      else if (status === 'draw') info.textContent = 'Draw.';
      else {
        var yourTurn = (state.whiteTurn === youAreWhite);
        info.textContent = (yourTurn ? 'Your move' : "Peer's move") + (isInCheck(board, state, state.whiteTurn) ? ' — CHECK!' : '');
      }
    }

    function onCellClick(sq) {
      if (status !== 'playing') return;
      if (state.whiteTurn !== youAreWhite) return;
      var p = board[sq];
      if (selected < 0) {
        if (p && p !== '.' && isWhite(p) === youAreWhite) { selected = sq; render(); }
        return;
      }
      if (sq === selected) { selected = -1; render(); return; }
      var moves = legalMoves(board, state, selected);
      var mv = null;
      for (var i = 0; i < moves.length; i++) if (moves[i].to === sq) { mv = moves[i]; break; }
      if (!mv) {
        if (p && p !== '.' && isWhite(p) === youAreWhite) { selected = sq; render(); return; }
        selected = -1; render(); return;
      }
      // Promo: prompt if multiple options at this square
      var promoOpts = moves.filter(function (m) { return m.to === sq && m.promo; });
      if (promoOpts.length > 1) {
        var pick = (window.prompt('Promote to (q,r,b,n):', 'q') || 'q').toLowerCase();
        if (['q','r','b','n'].indexOf(pick) < 0) pick = 'q';
        mv = promoOpts.find(function (m) { return m.promo.toLowerCase() === pick; }) || promoOpts[0];
      }
      doMove(mv, true);
    }

    function doMove(mv, local) {
      var next = applyMove(board, state, mv);
      if (!next) return;
      board = next.board; state = next.state; lastMove = mv; selected = -1;
      // Check terminal
      var legal = allLegal(board, state);
      if (legal.length === 0) {
        if (isInCheck(board, state, state.whiteTurn)) {
          // Side to move is checkmated — opposite side wins
          var winnerIsWhite = !state.whiteTurn;
          status = (winnerIsWhite === youAreWhite) ? 'win' : 'lose';
          ctx.setStatus(status === 'win' ? 'Checkmate. You won!' : 'Checkmate. You lost.');
        } else {
          status = 'draw'; ctx.setStatus('Stalemate. Draw.');
        }
      } else if (state.halfmove >= 100) {
        status = 'draw'; ctx.setStatus('50-move rule. Draw.');
      }
      render();
      if (local) ctx.send('move', mv);
    }

    function onPayload(type, payload) {
      if (type === 'move' && payload) doMove(payload, false);
      else if (type === 'resign') { status = 'win'; ctx.setStatus('Peer resigned. You won!'); render(); }
    }

    render();

    return {
      onPayload: onPayload,
      dispose: function () { try { wrap.remove(); } catch (_) {} }
    };
  }

  window.OST_MESH_GAMES.register('chess', {
    label: 'Chess',
    blurb: 'Full FIDE rules. Castling, en passant, promotion.',
    icon: '♛',
    factory: factory
  });
})();
