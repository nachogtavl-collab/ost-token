/* ==========================================================================
 * OST · Predict Detail — market-detail tabs (increment 3c)
 * --------------------------------------------------------------------------
 * When a market is selected (grid card or old list item), this shows a detail
 * panel above the trade desk with THREE all-real tabs:
 *
 *   · Trades   — this market's real fills from /positions/recent?marketId=
 *   · Holders  — real net positions per wallet, AGGREGATED from that same feed
 *                (buys add shares, sells subtract). Labelled "from recent
 *                activity" because the global feed is a rolling window — it is
 *                real data, not a fabricated leaderboard.
 *   · Comments — a real per-market thread (worker /predict/comments), posted
 *                under the connected wallet and linked to the OST Mesh social
 *                layer: a commenter's handle opens Mesh to message them.
 *
 * Nothing here is faked. If a source is empty it says so; it never invents
 * holders or trades to look busy.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_DETAIL) return;
  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

  function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ago(ts){var s=Math.max(0,Math.round((Date.now()-Number(ts||0))/1000));if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';}
  function num(n){n=Number(n)||0;return n>=1e4?(n/1e3).toFixed(1)+'k':n.toFixed(n<100?1:0);}
  function wallet(){try{var w=window.OST_PREDICTION_API&&window.OST_PREDICTION_API.walletAddress&&window.OST_PREDICTION_API.walletAddress();return w||'';}catch(_){return '';}}
  function meshHandle(){try{var j=JSON.parse(localStorage.getItem('ost_mesh_identity_v1')||'null');return (j&&j.address)?String(j.address):'';}catch(_){return '';}}
  function isSell(r){return String(r&&r.id||'').indexOf('sell:')===0 || r&&r.kind==='sell' || r&&r.action==='sell';}

  var state={mid:'',title:'',tab:'trades'};

  function injectStyle(){
    if(document.getElementById('ost-predict-detail-style'))return;
    var css=
      '#ost-predict-detail{border-radius:16px;background:#0e1c2b;border:1px solid rgba(127,216,255,.14);overflow:hidden;margin:14px 0;display:none}'+
      '#ost-predict-detail.on{display:block;animation:opd-in .25s}'+
      '@keyframes opd-in{from{opacity:0;transform:translateY(6px)}}'+
      '.opd-h{padding:13px 15px 0}'+
      '.opd-h .ti{font-size:14px;font-weight:750;color:#eef6fc;line-height:1.3;margin:0 0 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'+
      '.opd-h .sub{font-size:11px;color:#647d92;font-family:ui-monospace,Menlo,monospace}'+
      '.opd-tabs{display:flex;gap:2px;padding:10px 12px 0;border-bottom:1px solid rgba(127,216,255,.1)}'+
      '.opd-tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#647d92;font-weight:700;font-size:12px;padding:8px 4px;cursor:pointer;font-family:inherit}'+
      '.opd-tab.on{color:#7fd8ff;border-bottom-color:#7fd8ff}'+
      '.opd-body{max-height:320px;overflow-y:auto;padding:6px 0}'+
      '.opd-row{display:flex;align-items:center;gap:10px;padding:9px 15px;border-bottom:1px solid rgba(127,216,255,.06);font-size:12.5px}'+
      '.opd-row .s{font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:5px;flex:0 0 auto}'+
      '.opd-row .s.y{color:#34d399;background:rgba(52,211,153,.14)}.opd-row .s.n{color:#fb7185;background:rgba(251,113,133,.14)}'+
      '.opd-row .who{font-family:ui-monospace,Menlo,monospace;color:#7fd8ff;flex:0 0 auto;cursor:pointer;text-decoration:none}'+
      '.opd-row .who:hover{text-decoration:underline}'+
      '.opd-row .mid{flex:1;min-width:0;color:#a2b8cb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.opd-row .amt{font-family:ui-monospace,Menlo,monospace;font-weight:700;color:#eef6fc;flex:0 0 auto}'+
      '.opd-row .t{font-family:ui-monospace,Menlo,monospace;color:#647d92;font-size:11px;flex:0 0 auto}'+
      '.opd-rank{width:18px;color:#647d92;font-family:ui-monospace,Menlo,monospace;font-size:11px;flex:0 0 auto}'+
      '.opd-empty{padding:24px;text-align:center;color:#647d92;font-size:12.5px}'+
      '.opd-cwrap{padding:8px 15px}'+
      '.opd-c{padding:9px 0;border-bottom:1px solid rgba(127,216,255,.06)}'+
      '.opd-c .cm{display:flex;align-items:center;gap:8px;margin-bottom:3px}'+
      '.opd-c .h{font-weight:700;color:#7fd8ff;font-size:12px;cursor:pointer}.opd-c .h:hover{text-decoration:underline}'+
      '.opd-c .ct{font-size:10.5px;color:#647d92;font-family:ui-monospace,Menlo,monospace}'+
      '.opd-c .tx{font-size:13px;color:#dfeaf3;line-height:1.4;word-break:break-word}'+
      '.opd-post{display:flex;gap:8px;padding:11px 15px;border-top:1px solid rgba(127,216,255,.1);align-items:flex-end}'+
      '.opd-post textarea{flex:1;background:#0a1420;border:1px solid rgba(127,216,255,.16);border-radius:10px;color:#eef6fc;padding:8px 10px;font-family:inherit;font-size:13px;resize:none;height:38px;line-height:1.3}'+
      '.opd-post button{background:#7fd8ff;color:#03131f;border:none;border-radius:10px;padding:9px 15px;font-weight:750;cursor:pointer;font-size:13px;flex:0 0 auto}'+
      '.opd-post button:disabled{opacity:.5;cursor:default}'+
      '.opd-note{font-size:10.5px;color:#647d92;padding:0 15px 10px}';
    var t=document.createElement('style');t.id='ost-predict-detail-style';t.textContent=css;document.head.appendChild(t);
  }

  function ensure(){
    var host=document.getElementById('ost-predict-detail');
    if(host)return host;
    var desk=document.getElementById('predictionTradeDesk')||document.getElementById('ost-predict-grid')||document.getElementById('predictionMarketBoard');
    if(!desk)return null;
    injectStyle();
    host=document.createElement('div');host.id='ost-predict-detail';
    host.innerHTML=
      '<div class="opd-h"><p class="ti" id="opdTitle"></p><span class="sub" id="opdSub"></span></div>'+
      '<div class="opd-tabs">'+
        '<button class="opd-tab on" data-tab="trades">Trades</button>'+
        '<button class="opd-tab" data-tab="holders">Holders</button>'+
        '<button class="opd-tab" data-tab="comments">Comments</button>'+
      '</div>'+
      '<div class="opd-body" id="opdBody"><div class="opd-empty">Loading…</div></div>';
    desk.parentNode.insertBefore(host, desk);
    host.querySelector('.opd-tabs').addEventListener('click',function(e){
      var b=e.target.closest('.opd-tab');if(!b)return;
      state.tab=b.getAttribute('data-tab');
      host.querySelectorAll('.opd-tab').forEach(function(x){x.classList.toggle('on',x===b);});
      renderTab();
    });
    return host;
  }

  // ---- Trades tab ----------------------------------------------------------
  function loadTrades(){
    var body=document.getElementById('opdBody');body.innerHTML='<div class="opd-empty">Loading trades…</div>';
    fetch(API+'/positions/recent?marketId='+encodeURIComponent(state.mid)+'&limit=80',{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(d){
        if(state.tab!=='trades')return;
        var rows=(d&&d.recent)||[];
        if(!rows.length){body.innerHTML='<div class="opd-empty">No trades on this market yet — be the first.</div>';return;}
        body.innerHTML=rows.slice(0,60).map(function(r){
          var y=String(r.side||'').toUpperCase()==='YES';
          var amt=Number(r.stake)>0?num(r.stake)+' OSTG':(Number(r.shares)>0?num(r.shares)+' sh':'');
          return '<div class="opd-row"><span class="s '+(y?'y':'n')+'">'+(y?'Yes':'No')+'</span>'+
            '<span class="who" data-msg="'+esc(r.wallet||'')+'">'+esc(r.walletShort||'')+'</span>'+
            '<span class="mid">'+(isSell(r)?'sold':'bought')+'</span>'+
            '<span class="amt">'+esc(amt)+'</span><span class="t">'+ago(r.ts||r.createdAt)+'</span></div>';
        }).join('');
      }).catch(function(){if(state.tab==='trades')body.innerHTML='<div class="opd-empty">Couldn’t load trades.</div>';});
  }

  // ---- Holders tab (real aggregation) --------------------------------------
  function loadHolders(){
    var body=document.getElementById('opdBody');body.innerHTML='<div class="opd-empty">Aggregating holders…</div>';
    fetch(API+'/positions/recent?marketId='+encodeURIComponent(state.mid)+'&limit=200',{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(d){
        if(state.tab!=='holders')return;
        var rows=(d&&d.recent)||[];
        var agg={}; // wallet -> {yes,no}
        rows.forEach(function(r){
          var w=r.wallet;if(!w)return;
          var sh=Number(r.shares)||0;if(!(sh>0))return;
          var sign=isSell(r)?-1:1;
          agg[w]=agg[w]||{wallet:w,short:r.walletShort||(w.slice(0,4)+'…'+w.slice(-4)),yes:0,no:0};
          if(String(r.side||'').toUpperCase()==='YES')agg[w].yes+=sign*sh;else agg[w].no+=sign*sh;
        });
        var list=Object.keys(agg).map(function(k){var a=agg[k];a.net=Math.max(0,a.yes)+Math.max(0,a.no);return a;})
          .filter(function(a){return a.net>0.0001;}).sort(function(a,b){return b.net-a.net;});
        if(!list.length){body.innerHTML='<div class="opd-empty">No open holders on this market yet.</div>';return;}
        body.innerHTML='<div class="opd-note">Top holders from recent activity (rolling feed).</div>'+
          list.slice(0,40).map(function(a,i){
            var side=a.yes>=a.no;var val=side?a.yes:a.no;
            return '<div class="opd-row"><span class="opd-rank">'+(i+1)+'</span>'+
              '<span class="who" data-msg="'+esc(a.wallet)+'">'+esc(a.short)+'</span>'+
              '<span class="s '+(side?'y':'n')+'">'+(side?'Yes':'No')+'</span>'+
              '<span class="mid"></span><span class="amt">'+num(val)+' sh</span></div>';
          }).join('');
      }).catch(function(){if(state.tab==='holders')body.innerHTML='<div class="opd-empty">Couldn’t load holders.</div>';});
  }

  // ---- Comments tab (real thread + Mesh link) ------------------------------
  function loadComments(){
    var body=document.getElementById('opdBody');body.innerHTML='<div class="opd-empty">Loading comments…</div>';
    fetch(API+'/predict/comments?marketId='+encodeURIComponent(state.mid),{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(d){
        if(state.tab!=='comments')return;
        var rows=(d&&d.comments)||[];
        var thread=rows.length
          ? '<div class="opd-cwrap">'+rows.slice().reverse().map(function(c){
              return '<div class="opd-c"><div class="cm"><span class="h" data-msg="'+esc(c.wallet||'')+'">'+esc(c.handle||c.walletShort||'anon')+'</span><span class="ct">'+ago(c.ts)+' · tap name to message on Mesh</span></div><div class="tx">'+esc(c.text)+'</div></div>';
            }).join('')+'</div>'
          : '<div class="opd-empty">No comments yet. Start the conversation.</div>';
        var w=wallet();
        var post=w
          ? '<div class="opd-post"><textarea id="opdCin" maxlength="280" placeholder="Add a comment…"></textarea><button id="opdCsend">Post</button></div>'
          : '<div class="opd-note">Connect your wallet to comment.</div>';
        body.innerHTML=thread+post;
        var send=document.getElementById('opdCsend');
        if(send)send.addEventListener('click',postComment);
        var ta=document.getElementById('opdCin');
        if(ta)ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){postComment();}});
      }).catch(function(){if(state.tab==='comments')body.innerHTML='<div class="opd-empty">Couldn’t load comments.</div>';});
  }

  function postComment(){
    var ta=document.getElementById('opdCin'),send=document.getElementById('opdCsend');
    if(!ta)return;var text=String(ta.value||'').trim();if(!text)return;
    var w=wallet();if(!w)return;
    if(send){send.disabled=true;send.textContent='Posting…';}
    fetch(API+'/predict/comments',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({wallet:w,marketId:state.mid,text:text,handle:meshHandle()})})
      .then(function(r){return r.json();}).then(function(res){
        if(res&&res.ok){ta.value='';loadComments();}
        else{if(send){send.disabled=false;send.textContent=res&&res.error==='slow_down'?'Slow down':'Post';}}
      }).catch(function(){if(send){send.disabled=false;send.textContent='Retry';}});
  }

  function renderTab(){
    if(state.tab==='trades')loadTrades();
    else if(state.tab==='holders')loadHolders();
    else loadComments();
  }

  // Clicking a wallet/handle opens Mesh (the real social layer).
  document.addEventListener('click',function(e){
    var m=e.target.closest('[data-msg]');
    if(m){try{if(window.OST_MESH&&window.OST_MESH.open)window.OST_MESH.open();}catch(_){}return;}
  });

  function marketById(mid){
    try{var ms=window.__ostPredictionMarkets||[];for(var i=0;i<ms.length;i++)if(String(ms[i].id)===String(mid))return ms[i];}catch(_){}
    return null;
  }

  function show(mid,title){
    if(!mid)return;
    var host=ensure();if(!host)return;
    state.mid=mid;
    var m=marketById(mid);
    state.title=title||(m&&(m.title||m.contractLabel))||'Market';
    document.getElementById('opdTitle').textContent=state.title;
    var sub=m?((m.volumeLabel?('Vol '+m.volumeLabel):'')+(m.closeText?('  ·  '+m.closeText):'')):'';
    document.getElementById('opdSub').textContent=sub;
    host.classList.add('on');
    renderTab();
  }

  window.OST_PREDICT_DETAIL={show:show,refresh:renderTab};

  // Detect selection from BOTH the new grid and the old list, non-destructively.
  document.addEventListener('click',function(e){
    var g=e.target.closest('[data-mid]');
    if(g){show(g.getAttribute('data-mid'));return;}
    var o=e.target.closest('[data-prediction-market-id]');
    if(o){show(o.getAttribute('data-prediction-market-id'));return;}
  },true);
})();
