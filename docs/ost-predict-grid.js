/* ==========================================================================
 * OST · Predict Grid — the redesigned market card grid (increment 2)
 * --------------------------------------------------------------------------
 * Replaces the old prediction list's LOOK with the Polymarket/Kalshi-style
 * card grid from the v4 mockup, reading the SAME real markets app.js already
 * computes (window.__ostPredictionMarkets, published from getFilteredMarkets).
 *
 * NON-DESTRUCTIVE + FAIL-SAFE:
 *   · It only hides the old list (#predictionMarketList) AFTER its own grid has
 *     mounted, so if anything here fails the original list is still there.
 *   · A card click doesn't reimplement selection — it clicks the matching
 *     old list item ([data-prediction-market-id]) so the existing stage/desk/
 *     order flow runs unchanged.
 * No in-house arb shown. Colours + compact numbers via the shared system.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_GRID) return;

  function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function markets(){ try{ return Array.isArray(window.__ostPredictionMarkets)?window.__ostPredictionMarkets:[]; }catch(_){ return []; } }

  // Map a market to an icon by its topic/title — no emoji.
  var IC={
    btc:'M9 8h5a2.5 2.5 0 010 5H9m0 0h5.5a2.5 2.5 0 010 5H9m0-10V5m3 0v3m-3 13v-3m3 3v-3',
    eth:'M12 3l6 9-6 3-6-3zM6 13l6 3 6-3-6 8z',
    sol:'M6 8h10l-2 2H4zm2 4h12l-2 2H6zm-2 4h10l-2 2H4z',
    politics:'M4 21h16M5 21V10m14 11V10M4 10l8-6 8 6M9 21v-5h6v5',
    sports:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18m-9-9h18',
    econ:'M3 17l5-5 4 3 6-7M21 8v4h-4',
    world:'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    culture:'M4 4h16v16H4zM4 9h16M9 4v16M15 4v16',
    generic:'M3 17l6-6 4 4 8-8M15 7h6v6'
  };
  function iconFor(m){
    var s=((m.title||'')+' '+(m.topic||'')+' '+(m.contractLabel||'')).toLowerCase();
    if(/btc|bitcoin/.test(s))return 'btc'; if(/eth|ether/.test(s))return 'eth'; if(/\bsol\b|solana/.test(s))return 'sol';
    if(/elect|fed|senate|president|trump|rate|政/.test(s))return 'politics';
    if(/nba|nfl|game|match|cup|league|lakers|win\b/.test(s))return 'sports';
    if(/s&p|stock|gdp|cpi|inflation|market/.test(s))return 'econ';
    if(/weather|temp|climate|world|country/.test(s))return 'world';
    if(/movie|box office|album|show|film/.test(s))return 'culture';
    return 'generic';
  }
  function svg(n){return '<svg viewBox="0 0 24 24" style="width:17px;height:17px;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round">'+IC[n].split('M').filter(Boolean).map(function(d){return '<path d="M'+d+'"/>';}).join('')+'</svg>';}

  function yesCents(m){
    var v=Number(m.yesPriceNumber);
    if(!isFinite(v)){ v=parseFloat(String(m.yesValue||'').replace(/[^\d.]/g,'')); }
    if(!isFinite(v))return 50;
    if(v>0&&v<=1)v*=100;                 // handle 0-1 scale
    return Math.max(1,Math.min(99,Math.round(v)));
  }
  function volLabel(m){ return m.volumeLabel || (m.volumeNumber? m.volumeNumber.toLocaleString():''); }

  function injectStyle(){
    if(document.getElementById('ost-predict-grid-style'))return;
    var css=
      '#ost-predict-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px;margin:4px 0 8px}'+
      '@media(max-width:560px){#ost-predict-grid{grid-template-columns:1fr 1fr;gap:10px}}'+
      '.opg{border-radius:15px;background:#0e1c2b;border:1px solid rgba(127,216,255,.12);padding:14px;cursor:pointer;transition:.16s;display:flex;flex-direction:column;gap:11px;min-height:152px}'+
      '.opg:hover{border-color:rgba(127,216,255,.24);transform:translateY(-3px);box-shadow:0 14px 32px rgba(0,0,0,.4)}'+
      '.opg-top{display:flex;gap:10px;align-items:flex-start}'+
      '.opg-ico{width:31px;height:31px;border-radius:9px;flex:0 0 auto;display:grid;place-items:center;background:#132639;border:1px solid rgba(127,216,255,.12);color:#7fd8ff}'+
      '.opg-q{font-size:13px;font-weight:650;line-height:1.3;letter-spacing:-.01em;color:#eef6fc;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'+
      '.opg-bar{height:6px;border-radius:4px;background:rgba(251,113,133,.14);overflow:hidden}'+
      '.opg-bar i{display:block;height:100%;background:linear-gradient(90deg,#10b981,#34d399);transition:width .8s cubic-bezier(.2,.8,.2,1)}'+
      '.opg-yn{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:auto}'+
      '.opg-yn button{border-radius:10px;padding:8px 4px;border:1px solid rgba(127,216,255,.12);cursor:pointer;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:12.5px;display:flex;flex-direction:column;gap:1px;align-items:center;background:#0a1420;transition:.13s}'+
      '.opg-yn small{font-size:9px;color:#647d92;font-family:system-ui;letter-spacing:.05em;text-transform:uppercase}'+
      '.opg-yn .y{color:#34d399}.opg-yn .y:hover{background:rgba(52,211,153,.14);border-color:#34d399}'+
      '.opg-yn .n{color:#fb7185}.opg-yn .n:hover{background:rgba(251,113,133,.14);border-color:#fb7185}'+
      '.opg-foot{display:flex;justify-content:space-between;font-size:11px;color:#647d92;font-family:ui-monospace,Menlo,monospace;border-top:1px solid rgba(127,216,255,.12);padding-top:9px}'+
      '.opg-head{display:flex;align-items:center;justify-content:space-between;margin:14px 2px 10px}'+
      '.opg-head h4{margin:0;font-size:15px;font-weight:750;color:#eef6fc}'+
      '.opg-head .c{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#647d92}';
    var t=document.createElement('style');t.id='ost-predict-grid-style';t.textContent=css;document.head.appendChild(t);
  }

  function card(m){
    var yc=yesCents(m), ic=iconFor(m);
    return '<div class="opg" data-mid="'+esc(m.id)+'">'+
      '<div class="opg-top"><div class="opg-ico">'+svg(ic)+'</div><div class="opg-q">'+esc(m.title||m.contractLabel||'Market')+'</div></div>'+
      '<div class="opg-bar"><i style="width:'+yc+'%"></i></div>'+
      '<div class="opg-yn">'+
        '<button class="y" data-mid="'+esc(m.id)+'" data-side="yes"><small>Yes</small>'+yc+'¢</button>'+
        '<button class="n" data-mid="'+esc(m.id)+'" data-side="no"><small>No</small>'+(100-yc)+'¢</button>'+
      '</div>'+
      '<div class="opg-foot"><span>Vol '+esc(volLabel(m))+'</span><span>'+esc(m.closeText||m.closeLabel||'')+'</span></div>'+
    '</div>';
  }

  function selectOld(mid){
    // Reuse the existing selection handler: click the matching old list item.
    try{
      var art=document.querySelector('[data-prediction-market-id="'+CSS.escape(mid)+'"]');
      if(art){art.click();return true;}
    }catch(_){}
    return false;
  }

  function render(){
    var list=document.getElementById('predictionMarketList');
    if(!list){return;}
    injectStyle();
    var host=document.getElementById('ost-predict-grid');
    if(!host){
      host=document.createElement('div');host.id='ost-predict-grid';
      var head=document.createElement('div');head.className='opg-head';head.id='ost-predict-grid-head';
      head.innerHTML='<h4>Markets</h4><span class="c" id="opgCount"></span>';
      list.parentNode.insertBefore(head,list);
      list.parentNode.insertBefore(host,list);
    }
    var ms=markets();
    if(!ms.length){ // nothing yet — leave the old list visible, don't hide
      host.innerHTML='<div style="grid-column:1/-1;padding:22px;text-align:center;color:#647d92;font-size:13px">Loading live markets…</div>';
      return;
    }
    host.innerHTML=ms.slice(0,60).map(card).join('');
    var cnt=document.getElementById('opgCount'); if(cnt)cnt.textContent=ms.length+' live';
    // grid mounted with real data -> now safe to hide the old list
    list.style.display='none';
    // wire clicks (delegate)
    host.onclick=function(e){
      var b=e.target.closest('button[data-side]');
      var cardEl=e.target.closest('.opg');
      var mid=(b&&b.getAttribute('data-mid'))||(cardEl&&cardEl.getAttribute('data-mid'));
      if(!mid)return;
      selectOld(mid);
      if(b){ // pre-select side on the desk toggle
        try{var sel=b.getAttribute('data-side');var tgl=document.querySelector('#predictionOutcomeToggle [data-outcome="'+sel+'"], #predictionOutcomeToggle .'+sel);if(tgl)tgl.click();}catch(_){}
      }
      var desk=document.getElementById('predictionTradeDesk');if(desk)desk.scrollIntoView({behavior:'smooth',block:'center'});
    };
  }

  window.OST_PREDICT_GRID={render:render};

  function boot(){
    render();
    window.addEventListener('ost:prediction-markets',render);
    // markets can load after boot; retry a few times then rely on the event
    var tries=0;var iv=setInterval(function(){ if(markets().length){render();clearInterval(iv);} else if(++tries>30)clearInterval(iv); },700);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
