const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..','site');
const files=['index.html','style.css','app.js','wallet-extras.js','ux-extras.js','polish.js','topup.js','topup.css','faucet-hub.js','faucet-hub.css','offline-vault.js','stock-market.js','mesh/mesh.js','mesh/mesh-upgrade.js','mesh/mesh-play.js','mesh/mesh.css','prediction-extras.js','prediction-pro.js','prediction-modal.js','ost-games.js','interchange-live.js','shop-quickview.js','nuevo-laredo-gas.js','launchpad-trenches.js','swap-pool.js','i18n-runtime.js','ghost/ghost.js'];
const isPic=ch=>{const cp=ch.codePointAt(0);return (cp>=0x1F300&&cp<0x1FB00)||(cp>=0x2600&&cp<=0x27BF&&cp!==0x2122)||cp===0x2328||cp===0x23F1||cp===0x2139||cp===0x2194||cp===0x2197;};
for(const rel of files){
  const fp=path.join(root,rel);
  let s;try{s=fs.readFileSync(fp,'utf8');}catch(e){continue;}
  const lines=s.split(/\r?\n/);
  let hits=[];
  lines.forEach((l,i)=>{
    let found=null;
    for(const ch of l){ if(isPic(ch)){ found=ch; break; } }
    if(found) hits.push({n:i+1,ch:found,line:l.trim().slice(0,200)});
  });
  if(hits.length){
    console.log(`\n=== ${rel} (${hits.length}) ===`);
    hits.slice(0,40).forEach(h=>console.log(`  ${h.n}  [${h.ch}]  ${h.line}`));
    if(hits.length>40) console.log(`  ... +${hits.length-40} more`);
  }
}
