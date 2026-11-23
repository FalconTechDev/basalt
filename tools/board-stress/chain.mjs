// layout stress: one long chain, a dense random graph and a star; reports ms and any exception. node chain.mjs <port>
import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(+process.argv[2] || 9333, /index\.html/);
await c.eval(fs.readFileSync(new URL('./harness.js', import.meta.url), 'utf8'));
const E = (x) => c.eval(x, 120000);
for (const [name, n, build] of [['chain', 12000, 'for(let i=1;i<N;i++) pairs.push([i-1,i]);'], ['random', 3000, 'for(let i=0;i<N*3;i++) pairs.push([Math.floor(r()*N),Math.floor(r()*N)]);'], ['star', 5000, 'for(let i=1;i<N;i++) pairs.push([0,i]);']]) {
  await E(`S.fresh('s_chain')`);
  await E(`(()=>{const N=${n}, v=S.view(), y=window.__bsY.Y, r=S.rnd(9); S.addCards(N,{text:(i)=>'n'+i}); const pairs=[]; ${build} v.doc.transact(()=>{ pairs.forEach(([a,b],i)=>{ if(a===b) return; const m=new y.Map(); m.set('a','c'+a); m.set('b','c'+b); m.set('label',''); v.ye.set('e'+i,m); }); }); v.um.clear(); return 1})()`);
  for (const mode of ['lr', 'force', 'radial', 'auto']) {
    let res; try { res = await E(`(()=>{const v=S.view(); const t=performance.now(); try { v.layout('${mode}'); } catch(e) { return 'EXC '+e.message; } return Math.round(performance.now()-t)})()`); } catch (e) { res = 'ABORT ' + e.message.slice(0, 60); }
    console.log(name, n, mode, res);
  }
}
console.log(JSON.stringify({ exc: c.events.exceptions.slice(0, 3), crashed: c.events.crashed })); c.close(); process.exit(0);
