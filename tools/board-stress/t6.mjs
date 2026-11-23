import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const o={}; v.cam={x:12000,y:8000,k:0.04}; let t=performance.now(); v.applyCam(); await S.sleep(100); await S.raf(); o.zoomOutMs=Math.round(performance.now()-t); o.dom=S.dom(); o.ink=v.inkEls.size; await S.sleep(1000); o.pan=await S.camRun('pan',60,6); o.zoom=await S.camRun('zoom',60); return o})()`)));
c.close(); process.exit(0);
