// Naive JS pretty-printer for dumped minified items (no npm deps).
// node tools/s35-pretty.mjs <file.js>  -> prints indented source
import fs from "node:fs";
import * as acorn from "acorn";

const file = process.argv[2];
const src = fs.readFileSync(file, "utf8");
// the dumps are declarators "X=<init>" or expressions; parse as expression after stripping "name="
const eq = src.indexOf("=");
const exprSrc = eq > 0 && /^[A-Za-z_$][\w$]*$/.test(src.slice(0, eq).trim()) ? src.slice(eq + 1) : src;
const ast = acorn.parseExpressionAt(exprSrc, 0, { ecmaVersion: 2022 });

const PREC = {
  "||": 1, "&&": 2, "??": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "instanceof": 3, "in": 3,
  "|": 4, "^": 5, "&": 6, "<<": 7, ">>": 7, ">>>": 7,
  "+": 8, "-": 8, "*": 9, "/": 9, "%": 9, "**": 10,
};
const ARITH = new Set(["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"]);
const CMP = new Set(["==", "!=", "===", "!==", "<", ">", "<=", ">=", "instanceof", "in"]);

let out = "";
let indent = 0;
const pad = () => "  ".repeat(indent);
const nl = () => { out += "\n" + pad(); };
const semi = () => { out += ";"; nl(); };

function lit(n) { return exprSrc.slice(n.start, n.end); }

function expr(n, parentPrec = 0) {
  switch (n.type) {
    case "Identifier": case "Literal": case "ThisExpression": case "Super":
      out += lit(n); return;
    case "TemplateLiteral": {
      out += "`";
      for (let i = 0; i < n.quasis.length; i++) {
        out += n.quasis[i].value.cooked ?? n.quasis[i].value.raw;
        if (i < n.expressions.length) { out += "${"; expr(n.expressions[i]); out += "}"; }
      }
      out += "`"; return;
    }
    case "MemberExpression": {
      expr(n.object, 18);
      if (n.computed) { out += "["; expr(n.property); out += "]"; }
      else { out += "." + lit(n.property); }
      return;
    }
    case "CallExpression": {
      expr(n.callee, 18);
      out += "(";
      n.arguments.forEach((a, i) => { if (i) out += ", "; expr(a); });
      out += ")"; return;
    }
    case "NewExpression": {
      out += "new "; expr(n.callee, 18); out += "(";
      n.arguments.forEach((a, i) => { if (i) out += ", "; expr(a); });
      out += ")"; return;
    }
    case "UnaryExpression": case "UpdateExpression": {
      out += lit(n).slice(0, lit(n).indexOf(lit(n).match(/[A-Za-z_$]/) ? "" : "")); // fallback
      // simpler: operator prefix
      out = out.slice(0, out.length); // noop
      return unary(n);
    }
    case "BinaryExpression": case "LogicalExpression": {
      const p = PREC[n.operator] ?? 2;
      const paren = p < parentPrec;
      if (paren) out += "(";
      expr(n.left, p);
      out += " " + n.operator + " ";
      expr(n.right, p + (n.operator === "**" ? 1 : 0));
      if (paren) out += ")";
      return;
    }
    case "AssignmentExpression": {
      expr(n.left, 2); out += " " + n.operator + " "; expr(n.right, 1); return;
    }
    case "ConditionalExpression": {
      const paren = 1 < parentPrec;
      if (paren) out += "(";
      expr(n.test, 2); out += " ? "; expr(n.consequent, 1); out += " : "; expr(n.alternate, 1);
      if (paren) out += ")";
      return;
    }
    case "SequenceExpression": {
      const paren = 0 < parentPrec;
      if (paren) out += "(";
      n.expressions.forEach((e, i) => { if (i) out += ", "; expr(e, 0); });
      if (paren) out += ")";
      return;
    }
    case "ArrayExpression": {
      out += "[";
      n.elements.forEach((e, i) => { if (i) out += ", "; if (e) expr(e); else out += ""; });
      out += "]"; return;
    }
    case "ObjectExpression": {
      if (!n.properties.length) { out += "{}"; return; }
      out += "{"; nl(); indent++;
      n.properties.forEach((p, i) => {
        if (p.type === "SpreadElement") { out += "..."; expr(p.argument); }
        else {
          if (p.computed) { out += "["; expr(p.key); out += "]"; }
          else if (p.key.type === "Identifier" && !p.shorthand) out += p.key.name;
          else if (p.key.type === "Literal") out += JSON.stringify(p.key.value);
          else expr(p.key);
          out += p.shorthand ? "" : ": ";
          if (!p.shorthand) expr(p.value);
        }
        if (i < n.properties.length - 1) out += ",";
        nl();
      });
      indent--; nl(); out += "}";
      return;
    }
    case "ArrowFunctionExpression": return fnExpr(n, true);
    case "FunctionExpression": return fnExpr(n, false);
    case "FunctionDeclaration": return fnExpr(n, false);
    case "ClassExpression": case "ClassDeclaration": {
      out += "class"; if (n.id) out += " " + n.id.name;
      if (n.superClass) { out += " extends "; expr(n.superClass); }
      out += " {"; nl(); indent++;
      for (const m of n.body.body) {
        if (m.type === "MethodDefinition" || m.type === "PropertyDefinition") {
          if (m.static) out += "static ";
          if (m.kind === "get") out += "get "; else if (m.kind === "set") out += "set ";
          if (m.computed) { out += "["; expr(m.key); out += "]"; } else out += lit(m.key);
          out += "(";
          m.value.params.forEach((p, i) => { if (i) out += ", "; pattern(p); });
          out += ") {"; nl(); indent++;
          block(m.value.body);
          indent--; nl(); out += "}";
        } else stmt(m);
        nl();
      }
      indent--; nl(); out += "}";
      return;
    }
    case "ObjectPattern": case "ArrayPattern": return pattern(n);
    case "AssignmentPattern": out += ""; pattern(n.left); out += " = "; expr(n.right); return;
    case "RestElement": out += "..."; pattern(n.argument); return;
    case "SpreadElement": out += "..."; expr(n.argument); return;
    case "ChainExpression": expr(n.expression); return;
    case "AwaitExpression": out += "await "; expr(n.argument, 16); return;
    case "YieldExpression": out += "yield"; if (n.argument) { out += " "; expr(n.argument); } return;
    case "TaggedTemplateExpression": expr(n.tag, 18); expr(n.quasi); return;
    default: out += "/*" + n.type + "*/" + lit(n);
  }
}
function unary(n) {
  if (n.prefix !== false && (n.type === "UpdateExpression")) { out += n.operator; expr(n.argument, 17); return; }
  if (n.type === "UnaryExpression") { out += n.operator + (n.operator.length === 1 ? "" : " "); expr(n.argument, 15); return; }
  out += n.operator; expr(n.argument); return;
}
function pattern(p) {
  switch (p.type) {
    case "Identifier": out += p.name; return;
    case "ObjectPattern": out += "{"; p.properties.forEach((q, i) => { if (i) out += ", "; if (q.type === "RestElement") { out += "..."; pattern(q.argument); } else { pattern(q.key); out += ": "; pattern(q.value); } }); out += "}"; return;
    case "ArrayPattern": out += "["; p.elements.forEach((q, i) => { if (i) out += ", "; if (q) pattern(q); }); out += "]"; return;
    case "RestElement": out += "..."; pattern(p.argument); return;
    case "AssignmentPattern": pattern(p.left); out += " = "; expr(p.right); return;
    default: out += "/*pat*/";
  }
}
function fnExpr(n, arrow) {
  if (arrow) {
    const simple = n.params.length === 1 && n.params[0].type === "Identifier" && n.body.type !== "BlockStatement";
    if (simple) { out += n.params[0].name + " => "; expr(n.body); return; }
    out += "("; n.params.forEach((p, i) => { if (i) out += ", "; pattern(p); }); out += ") => ";
    if (n.body.type === "BlockStatement") { out += "{"; nl(); indent++; block(n.body); indent--; nl(); out += "}"; }
    else expr(n.body);
    return;
  }
  out += "function"; if (n.id) out += " " + n.id.name;
  out += "("; n.params.forEach((p, i) => { if (i) out += ", "; pattern(p); }); out += ") {"; nl(); indent++;
  block(n.body);
  indent--; nl(); out += "}";
}
function block(b) {
  if (!b || !b.body) { expr(b); return; }
  for (const s of b.body) stmt(s);
}
function stmt(s) {
  if (!s) return;
  switch (s.type) {
    case "ExpressionStatement": expr(s.expression); out += ";"; nl(); return;
    case "VariableDeclaration": {
      out += s.kind + " ";
      s.declarations.forEach((d, i) => {
        if (i) { out += ","; nl(); out += pad() + "  "; }
        pattern(d.id); if (d.init) { out += " = "; expr(d.init); }
      });
      out += ";"; nl(); return;
    }
    case "FunctionDeclaration": expr(s); out += ";"; nl(); return;
    case "ReturnStatement": out += "return"; if (s.argument) { out += " "; expr(s.argument); } out += ";"; nl(); return;
    case "IfStatement": {
      out += "if ("; expr(s.test); out += ") ";
      if (s.consequent.type === "BlockStatement") { out += "{"; nl(); indent++; block(s.consequent); indent--; nl(); out += "}"; }
      else { out += "{"; nl(); indent++; stmt(s.consequent); indent--; nl(); out += "}"; }
      if (s.alternate) {
        out += " else ";
        if (s.alternate.type === "IfStatement") stmt(s.alternate);
        else { out += "{"; nl(); indent++; stmt(s.alternate); indent--; nl(); out += "}"; }
      }
      nl(); return;
    }
    case "ForStatement": {
      out += "for (";
      if (s.init) s.init.type === "VariableDeclaration" ? (out += s.init.kind + " ", s.init.declarations.forEach((d, i) => { if (i) out += ", "; pattern(d.id); if (d.init) { out += "="; expr(d.init); } }), out += ";") : (expr(s.init), out += ";");
      else out += ";";
      if (s.test) { expr(s.test); out += ";"; } else out += ";";
      if (s.update) expr(s.update);
      out += ") {"; nl(); indent++; block(s.body); indent--; nl(); out += "}"; nl(); return;
    }
    case "ForOfStatement": case "ForInStatement": {
      out += s.type === "ForOfStatement" ? "for (" : "for (";
      out += s.type === "ForOfStatement" ? "const " : "";
      // approximate: print left then of/in
      patternish(s.left); out += s.type === "ForOfStatement" ? " of " : " in "; expr(s.right); out += ") {"; nl(); indent++; block(s.body); indent--; nl(); out += "}"; nl(); return;
    }
    case "WhileStatement": out += "while ("; expr(s.test); out += ") {"; nl(); indent++; block(s.body); indent--; nl(); out += "}"; nl(); return;
    case "DoWhileStatement": out += "do {"; nl(); indent++; block(s.body); indent--; nl(); out += "} while ("; expr(s.test); out += ");"; nl(); return;
    case "SwitchStatement": {
      out += "switch ("; expr(s.discriminant); out += ") {"; nl(); indent++;
      for (const c of s.cases) {
        out += "case "; if (c.test) expr(c.test); else out += "default"; out += ":"; nl();
        for (const st of c.consequent) stmt(st);
      }
      indent--; nl(); out += "}"; nl(); return;
    }
    case "TryStatement": {
      out += "try {"; nl(); indent++; block(s.block); indent--; nl(); out += "}";
      if (s.handler) { out += " catch ("; patternish(s.handler.param); out += ") {"; nl(); indent++; block(s.handler.body); indent--; nl(); out += "}"; }
      if (s.finalizer) { out += " finally {"; nl(); indent++; block(s.finalizer); indent--; nl(); out += "}"; }
      nl(); return;
    }
    case "ThrowStatement": out += "throw "; expr(s.argument); out += ";"; nl(); return;
    case "BreakStatement": out += "break;"; nl(); return;
    case "ContinueStatement": out += "continue;"; nl(); return;
    case "LabeledStatement": out += s.label.name + ": "; stmt(s.body); return;
    case "EmptyStatement": out += ";"; nl(); return;
    case "BlockStatement": out += "{"; nl(); indent++; block(s); indent--; nl(); out += "}"; nl(); return;
    case "ClassDeclaration": expr(s); out += ";"; nl(); return;
    default: out += "/*stmt " + s.type + "*/" + lit(s) + ";"; nl();
  }
}
function patternish(p) {
  if (!p) return;
  if (p.type === "VariableDeclaration") {
    p.declarations.forEach((d, i) => { if (i) out += ", "; pattern(d.id); });
    return;
  }
  pattern(p);
}

if (ast.type === "FunctionExpression" || ast.type === "ArrowFunctionExpression" || ast.type === "CallExpression" || ast.type === "ClassExpression" || ast.type === "FunctionDeclaration") {
  expr(ast);
} else {
  stmt(ast);
}
out += "\n";
process.stdout.write(out);
