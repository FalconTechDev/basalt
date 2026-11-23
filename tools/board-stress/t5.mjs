import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const out={}; await S.raf();
 const mk=(cls,n,sty)=>{const fr=document.createDocumentFragment(); const l=[]; for(let i=0;i<n;i++){const d=document.createElement('div'); d.className=cls; d.style.cssText='position:absolute;left:'+(i*10)+'px;top:0;width:200px;height:100px'+(sty||''); fr.appendChild(d); l.push(d);} return {fr,l};};
 const run=(name,cls,sty)=>{ const {fr,l}=mk(cls,3000,sty); const a=performance.now(); v.cards.appendChild(fr); void v.root.clientWidth; out[name]=Math.round(performance.now()-a); for(const e of l) e.remove(); void v.root.clientWidth; };
 // clear existing cards to isolate
 const saved=Array.from(v.cards.children); v.cards.replaceChildren(); void v.root.clientWidth;
 run('plain','zz'); run('osbcard','osb-card is-lite no-pop'); run('osbcardstrict','osb-card is-lite no-pop',';contain:strict'); run('noContain','osb-card is-lite no-pop',';contain:none;box-shadow:none');
 v.cards.replaceChildren(...saved); return out})()`)));
c.close(); process.exit(0);
