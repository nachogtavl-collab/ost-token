/* ==========================================================================
 * OST · Predict Activity — REAL recent-trades feed (increment 3a)
 * --------------------------------------------------------------------------
 * Polymarket's core social proof: a live activity feed of real trades by real
 * OST users. This one is genuinely real — it reads the worker's
 * /positions/recent (the same global bet feed the app already maintains), so
 * every row is an actual OST wallet's actual position. No fabricated data.
 *
 * Mounts a panel in the prediction section; polls only while the tab is
 * visible, on a backoff, so it never becomes idle churn.
 *
 * HOLDERS and COMMENTS (the other two mockup tabs) are intentionally NOT faked
 * here: holders needs a per-market position-aggregation endpoint, and comments
 * need a Mesh thread per market. Both are real backend work, tracked — I will
 * not ship placeholder "users" that aren't real.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.OST_PREDICT_ACTIVITY) return;
  var API = window.OST_API_BASE || 'https://ost-api.nachogtavl.workers.dev';

  function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ago(ts){var s=Math.max(0,Math.round((Date.now()-Number(ts||0))/1000));if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';}
  function num(n){n=Number(n)||0;return n>=1e4?(n/1e3).toFixed(1)+'k':n.toFixed(n<100?1:0);}

  function injectStyle(){
    if(document.getElementById('ost-predict-activity-style'))return;
    var css=
      '#ost-predict-activity{border-radius:16px;background:#0e1c2b;border:1px solid rgba(127,216,255,.12);overflow:hidden;margin:14px 0}'+
      '.opa-h{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid rgba(127,216,255,.12)}'+
      '.opa-h h4{margin:0;font-size:13px;font-weight:750;color:#eef6fc;display:flex;align-items:center;gap:8px}'+
      '.opa-h .live{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;color:#34d399}'+
      '.opa-h .live .d{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399;animation:opa-p 1.5s infinite}'+
      '@keyframes opa-p{50%{opacity:.3}}'+
      '.opa-list{max-height:340px;overflow-y:auto}'+
      '.opa-row{display:flex;align-items:center;gap:10px;padding:10px 15px;border-bottom:1px solid rgba(127,216,255,.07);font-size:12.5px}'+
      '.opa-row.in{animation:opa-si .4s}@keyframes opa-si{from{opacity:0;transform:translateY(-6px)}}'+
      '.opa-row .s{font-size:9.5px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:5px;flex:0 0 auto}'+
      '.opa-row .s.y{color:#34d399;background:rgba(52,211,153,.14)}.opa-row .s.n{color:#fb7185;background:rgba(251,113,133,.14)}'+
      '.opa-row .who{font-family:ui-monospace,Menlo,monospace;color:#7fd8ff;flex:0 0 auto}'+
      '.opa-row .mk{flex:1;min-width:0;color:#a2b8cb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '.opa-row .amt{font-family:ui-monospace,Menlo,monospace;font-weight:700;color:#eef6fc;flex:0 0 auto}'+
      '.opa-row .t{font-family:ui-monospace,Menlo,monospace;color:#647d92;font-size:11px;min-width:34px;text-align:right;flex:0 0 auto}'+
      '.opa-empty{padding:26px;text-align:center;color:#647d92;font-size:13px}';
    var t=document.createElement('style');t.id='ost-predict-activity-style';t.textContent=css;document.head.appendChild(t);
  }

  var seen={}, first=true;
  function row(r,isNew){
    var y=String(r.side||'').toUpperCase()==='YES';
    var amt=Number(r.stake)>0?num(r.stake)+' OSTG':(Number(r.shares)>0?num(r.shares)+' sh':'');
    return '<div class="opa-row'+(isNew&&!first?' in':'')+'">'+
      '<span class="s '+(y?'y':'n')+'">'+(y?'Yes':'No')+'</span>'+
      '<span class="who">'+esc(r.walletShort||(r.wallet||'').slice(0,4)+'…')+'</span>'+
      '<span class="mk">'+esc(r.marketTitle||r.title||r.marketId||'market')+'</span>'+
      '<span class="amt">'+esc(amt)+'</span>'+
      '<span class="t">'+ago(r.ts||r.createdAt||Date.now())+'</span>'+
    '</div>';
  }

  function render(list){
    var host=document.getElementById('ost-predict-activity');
    if(!host)return;
    var body=host.querySelector('.opa-list');
    if(!list.length){body.innerHTML='<div class="opa-empty">No recent trades yet — be the first.</div>';return;}
    body.innerHTML=list.slice(0,40).map(function(r){var k=r.id||(r.wallet+r.ts);var isNew=!seen[k];seen[k]=1;return row(r,isNew);}).join('');
    first=false;
  }

  function mount(){
    var anchor=document.getElementById('ost-predict-grid')||document.getElementById('predictionMarketBoard');
    if(!anchor||document.getElementById('ost-predict-activity'))return true;
    injectStyle();
    var el=document.createElement('div');el.id='ost-predict-activity';
    el.innerHTML='<div class="opa-h"><h4><svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:#7fd8ff;stroke-width:1.9;fill:none;stroke-linecap:round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg> Live activity</h4><span class="live"><span class="d"></span> real OST trades</span></div><div class="opa-list"><div class="opa-empty">Loading…</div></div>';
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
    return true;
  }

  var delay=9000, timer=null;
  function tick(){
    if(document.hidden){schedule();return;}
    fetch(API+'/positions/recent',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
      var arr=(d&&d.recent)||[];
      if(arr.length){render(arr);delay=9000;}else{delay=Math.min(60000,delay*1.5);}
      schedule();
    }).catch(function(){delay=Math.min(60000,delay*1.5);schedule();});
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(tick,delay);}

  window.OST_PREDICT_ACTIVITY={refresh:tick};

  function boot(){
    if(!mount()){var n=0;var iv=setInterval(function(){if(mount()||++n>20)clearInterval(iv);},600);}
    tick();
    document.addEventListener('visibilitychange',function(){if(!document.hidden){delay=4000;clearTimeout(timer);timer=setTimeout(tick,300);}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
