import fs from 'node:fs';
import * as acorn from 'acorn';
const src=fs.readFileSync('C:/Users/sasha/AppData/Local/Temp/s05/CA.js','utf8');
const ast=acorn.parse('('+src.replace(/;\s*$/,'')+')',{ecmaVersion:2022});
const out=[];
(function walk(n){if(!n||typeof n.type!=='string')return;
 if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length>=4) out.push(n.value);
 for(const k in n){if(k==='type'||k==='start'||k==='end')continue;const v=n[k];if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v.type==='string')walk(v);}})(ast);
console.log([...new Set(out)].slice(0,200).join('\n'));
