import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const out={}; await S.sleep(500);
 const clear=()=>{for(const e of v.els.values()) e.el.remove(); v.els.clear(); void v.root.clientWidth;};
 // A: current path
 clear(); let a=performance.now(); v.cull(); const aCull=performance.now()-a; a=performance.now(); void v.root.clientWidth; out.current={cull:Math.round(aCull), layout:Math.round(performance.now()-a), n:v.els.size};
 // B: cssText + className only
 clear(); const geo=[...v.geo]; a=performance.now(); const fr=document.createDocumentFragment(); for(const [id,g] of geo){ const d=document.createElement('div'); d.className='osb-card is-lite no-pop'; d.style.cssText='left:'+g.x+'px;top:'+g.y+'px;width:'+g.w+'px;height:'+g.h+'px'; d.dataset.id=id; fr.appendChild(d);} v.cards.appendChild(fr); const bCreate=performance.now()-a; a=performance.now(); void v.root.clientWidth; out.cssText={create:Math.round(bCreate), layout:Math.round(performance.now()-a)}; for(const e of [...v.cards.children]) e.remove(); void v.root.clientWidth;
 // C: no contain
 clear(); a=performance.now(); const fr2=document.createDocumentFragment(); for(const [id,g] of geo){ const d=document.createElement('div'); d.className='zzlite'; d.style.cssText='position:absolute;left:'+g.x+'px;top:'+g.y+'px;width:'+g.w+'px;height:'+g.h+'px'; fr2.appendChild(d);} v.cards.appendChild(fr2); const cc=performance.now()-a; a=performance.now(); void v.root.clientWidth; out.plain={create:Math.round(cc), layout:Math.round(performance.now()-a)}; for(const e of [...v.cards.children]) e.remove(); void v.root.clientWidth;
 v.cull(); return out})()`)));
c.close(); process.exit(0);
