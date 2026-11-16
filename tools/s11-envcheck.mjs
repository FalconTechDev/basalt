import { loadBase } from './app-base.mjs';
import * as acorn from 'acorn';
import fs from 'node:fs';
const base = loadBase('ca5acac');
const ast = acorn.parse(base.src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee;
const seq = outer.body.body[2].expression.expressions;
const appCall = seq[seq.length - 1];
const appBody = appCall.callee.body.body;
const bound = new Set();
for (const n of appBody) {
  if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
    if (d.id.type === 'Identifier') bound.add(d.id.name);
  }
  if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) bound.add(n.id.name);
}
for (const p of appCall.callee.params || []) if (p.type === 'Identifier') bound.add(p.name);
const manifest = JSON.parse(fs.readFileSync('../src-app/manifest.json', 'utf8'));
const missing = [];
for (const entry of manifest.envBind.split(',')) {
  const idx = entry.indexOf(':');
  const val = idx >= 0 ? entry.slice(idx + 1) : entry;
  const ids = [];
  try {
    const e = acorn.parseExpressionAt(val, 0, { ecmaVersion: 2022 });
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'Identifier') ids.push(n.name);
      for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && v.type) walk(v); }
    };
    walk(e);
  } catch { missing.push(entry + ' PARSE'); continue; }
  for (const id of ids) if (!bound.has(id)) missing.push(entry + ' -> ' + id);
}
console.log('bound names:', bound.size);
console.log(missing.length ? missing.join('\n') : 'ALL ENV BIND OK');
