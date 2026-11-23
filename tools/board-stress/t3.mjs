import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(async()=>{const v=S.view(); const out=[]; for(let i=0;i<8;i++){ await new Promise(r=>requestAnimationFrame(r)); v.cam.x+=200; const a=performance.now(); v.applyCam(); const b=performance.now(); const w=v.root.clientWidth; const cc=performance.now(); v.cull(); const d=performance.now(); out.push([+(b-a).toFixed(1), +(cc-b).toFixed(1), +(d-cc).toFixed(1)]);} return out})()`)));
c.close(); process.exit(0);
