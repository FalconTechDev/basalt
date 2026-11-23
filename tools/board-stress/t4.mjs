import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const out={}; await S.raf();
 const list=Array.from(v.cards.children).slice(0,3000);
 let a=performance.now(); for(const e of list) e.remove(); out.removeLoop=performance.now()-a;
 a=performance.now(); void v.root.clientWidth; out.layoutAfter=performance.now()-a;
 const l2=Array.from(v.cards.children).slice(0,3000);
 a=performance.now(); void v.root.clientWidth; for(const e of l2) e.remove(); out.removeNoDirty=performance.now()-a;
 a=performance.now(); void v.root.clientWidth; out.layoutAfter2=performance.now()-a;
 // create
 a=performance.now(); const fr=document.createDocumentFragment(); for(let i=0;i<3000;i++){const d=document.createElement('div'); d.className='osb-card is-lite'; d.style.left=i+'px'; fr.appendChild(d);} v.cards.appendChild(fr); out.create3000=performance.now()-a;
 a=performance.now(); void v.root.clientWidth; out.layoutCreate=performance.now()-a;
 return out})()`)));
c.close(); process.exit(0);
