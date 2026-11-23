import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000), sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await E(`(()=>{const v=S.view(); v.cam={x:-40+v.root.clientWidth/2-170,y:-80+v.root.clientHeight/2-140,k:1}; v.applyCam();})()`); await sleep(1500); console.log(await E(`(()=>{const v=S.view(); const e=v.els.get('G'); return JSON.stringify({lite:e&&e.lite, q:v.fillQ.length, fr:v.fillRaf, cam:v.cam, els:v.els.size})})()`)); await sleep(2000);
const g = await E(`(()=>{const v=S.view(), e=v.els.get('G'); const b=e.el.querySelector('.osb-grip').getBoundingClientRect(); return {x:b.left+60,y:b.top+b.height/2}})()`);
const mv = (type,x,y)=>c.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval',{interval:500});
await c.send('Profiler.start');
await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:g.x,y:g.y}); await mv('mousePressed',g.x,g.y);
for(let i=1;i<=40;i++) await mv('mouseMoved',g.x+i*5,g.y+i*2);
await mv('mouseReleased',g.x+50,g.y+20); await sleep(3500);
const {result}=await c.send('Profiler.stop'); const p=result.profile; const self=new Map(); const byId=new Map(p.nodes.map(n=>[n.id,n])); for(let i=0;i<p.samples.length;i++){const n=byId.get(p.samples[i]); const k=n.callFrame.functionName+' '+(n.callFrame.url||'').split('/').pop()+':'+n.callFrame.lineNumber; self.set(k,(self.get(k)||0)+p.timeDeltas[i]/1000);}
console.log([...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>v.toFixed(0).padStart(6)+'ms '+k).join('\n'));
c.close(); process.exit(0);
