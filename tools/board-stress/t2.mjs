import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const cnt={mk:0}; const om=v.mkLite; v.mkLite=function(){cnt.mk++; return om.apply(this,arguments)}; const t0=performance.now(); v.cull(); const t1=performance.now(); v.cull(); const t2=performance.now(); v.cam.x+=3000; v.cull(); const t3=performance.now(); v.mkLite=om; return {cnt, first:t1-t0, second:t2-t1, shifted:t3-t2, els:v.els.size, geo:v.geo.size, cam:v.cam}})()`)));
c.close(); process.exit(0);
