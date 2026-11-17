import { loadBase } from './app-base.mjs';
const b = loadBase('ca5acac');
const names = process.argv.slice(2);
for (const n of names) {
  const esc = n.replace(/[$]/g, '\\$');
  const re = new RegExp('(?:function\\s+' + esc + '\\b|\\b' + esc + '\\s*=)');
  console.log(n, re.test(b.src) ? 'found' : 'MISSING');
}
