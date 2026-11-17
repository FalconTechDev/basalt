import { loadBase } from './app-base.mjs';
import crypto from 'node:crypto';
import * as acorn from 'acorn';

const base = loadBase('ca5acac');
const ast = acorn.parse(base.src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee;
const seq = outer.body.body[2].expression.expressions;
const appCall = seq[seq.length - 1];
const appBody = appCall.callee.body.body;
const src = base.src;

const decls = new Map();
for (const n of appBody) {
  if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
    if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, src.slice(d.init.start, d.init.end));
  }
}
for (const n of process.argv.slice(2)) {
  const t = decls.get(n);
  if (t === undefined) { console.log(n, 'MISSING'); continue; }
  console.log(JSON.stringify({ orig: n, bytes: t.length, sha1: crypto.createHash('sha1').update(t).digest('hex') }));
}
