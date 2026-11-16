import fs from 'node:fs';
import * as acorn from 'acorn';
const src=fs.readFileSync('C:/Users/sasha/AppData/Local/Temp/s05x/184-CA.js','utf8');
const ast=acorn.parse('x='+src,{ecmaVersion:2022});
let e=ast.body[0].expression.right; // CA=...
const init=e.right; // function(){...}()
const fn=init.callee;
console.log('fn',fn.type,'stmts',fn.body.body.length);
for(const st of fn.body.body){
  console.log(st.type, st.start+'-'+st.end, JSON.stringify(src.slice(st.start,st.start+70)));
}
// also the return sequence
const ret=fn.body.body.find(s=>s.type==='ReturnStatement');
if(ret&&ret.argument&&ret.argument.type==='SequenceExpression'){
  for(const ex of ret.argument.expressions){
    const l=ex.left;
    console.log('RET',ex.type, l?l.type+' '+(l.property?l.property.name:''):'', ex.start+'-'+ex.end);
  }
}
