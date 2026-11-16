import {loadBase} from './app-base.mjs';
import {loadBundle} from './split-app.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const items=JSON.parse(fs.readFileSync('F:/orch/basalt-s30/ITEMS.json','utf8'));
const base=loadBase('ca5acac');
const dir='F:/orch/basalt-s30/dump';
fs.rmSync(dir,{recursive:true,force:true});
fs.mkdirSync(dir,{recursive:true});
const src=base.src;
const file=path.join(os.tmpdir(),'basalt-app-base-ca5acac.js');
const body=loadBundle(file).body;
const decls=new Map();
for(const n of body){
  if(n.type==='VariableDeclaration') for(const d of n.declarations){
    if(d.id.type==='Identifier') decls.set(d.id.name, src.slice(d.start,d.end));
  }
}
const index=[];
items.forEach((it,i)=>{
  let text = base.fn(it.name) || decls.get(it.name);
  const fn = dir+'/'+String(i).padStart(3,'0')+'-'+it.name+'.js';
  fs.writeFileSync(fn, text||'MISSING');
  index.push({i,name:it.name,kind:it.kind,bytes:it.bytes,file:fn});
});
fs.writeFileSync(dir+'/index.json',JSON.stringify(index,null,1));
console.log('done',items.length);
