import fs from 'fs'; import { connect } from './cdp.mjs';
const c = await connect(9333, /index\.html/);
await c.eval(fs.readFileSync('harness.js','utf8'));
const E=(x)=>c.eval(x,300000);
console.log(JSON.stringify(await E(`(()=>{const v=S.view(); return {path:v.path, ye:v.ye.size, eg:v.eg.size, edgeEls:v.edgeEls.size, yn:v.yn.size, els:v.els.size, sel:[...v.sel].length, G:!!v.yn.get('G'), gfm:(v.fm.get('G')||[]).size, drag:!!v.drag}})()`)));
c.close(); process.exit(0);
