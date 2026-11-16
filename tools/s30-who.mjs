import {loadBase} from './app-base.mjs';
import {loadBundle} from './split-app.mjs';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const base=loadBase('ca5acac');
const file=path.join(os.tmpdir(),'basalt-app-base-ca5acac.js');
const {src,body}=loadBundle(file);
const want=process.argv.slice(2);
for(const w of want){
  let found=null;
  for(const n of body){
    if(n.type==='VariableDeclaration') for(const d of n.declarations){
      const names=[]; (function p(x){if(!x)return;if(x.type==='Identifier')names.push(x.name);for(const k in x){if(k==='type')continue;const v=x[k];if(Array.isArray(v))v.forEach(p);else if(v&&typeof v.type==='string')p(v)}})(d.id);
      if(names.includes(w)){found={kind:'var',text:src.slice(d.start,Math.min(d.end,d.start+400))};break}
    }
    if(found)break;
    if((n.type==='FunctionDeclaration'||n.type==='ClassDeclaration')&&n.id&&n.id.name===w){found={kind:n.type,text:src.slice(n.start,Math.min(n.end,n.start+400))};break}
  }
  if(!found){
    // member expr assignment X.prototype.y or X=
    const re=new RegExp('(^|[;,{])'+w.replace(/\$/g,'\$')+'=');
    const idx=src.search(re);
    found=idx>=0?{kind:'expr@'+idx,text:src.slice(idx,idx+300)}:{kind:'NOTFOUND'};
  }
  console.log('### '+w+' ['+found.kind+']'); console.log(found.text); console.log();
}
