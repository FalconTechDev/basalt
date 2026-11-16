import fs from 'node:fs';
import * as acorn from 'acorn';
const src=fs.readFileSync('C:/Users/sasha/AppData/Local/Temp/s05x/184-CA.js','utf8');
const ast=acorn.parse('x='+src,{ecmaVersion:2022});
const init=ast.body[0].expression.right.right.callee;
const ret=init.body.body.find(s=>s.type==='ReturnStatement');
const seq=ret.argument;
for(const ex of seq.expressions){
  const l=ex.left;
  if(l&&l.type==='MemberExpression'&&l.property&&l.property.name){
    fs.writeFileSync('C:/Users/sasha/AppData/Local/Temp/s05x/CA-'+l.property.name+'.js', src.slice(ex.right.start,ex.right.end));
    console.log(l.property.name, ex.right.end-ex.right.start);
  }
}
