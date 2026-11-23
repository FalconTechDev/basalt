import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.send('HeapProfiler.enable');
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,500000), gc=async()=>{await c.send('HeapProfiler.collectGarbage'); await new Promise(r=>setTimeout(r,300)); await c.send('HeapProfiler.collectGarbage');};
const res=[];
for(let i=0;i<4;i++){ await E(`S.fresh('s_leak')`); await E(`S.addCards(5000,{text:(i)=>S.lorem(200,i)}); S.view().fit(); 1`); await E('S.sleep(2000)'); await E(`(async()=>{for(const l of app.workspace.getLeavesOfType('basalt-board')) l.detach(); await S.sleep(800); return 1})()`); await gc(); res.push(await E('S.heap()')); }
console.log(JSON.stringify(res)); c.close(); process.exit(0);
