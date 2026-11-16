// Slice s09 — Bases formula engine: the syntax-tree -> AST conversion, the AST node classes with their
// getValue/test evaluation, the formula-text wrapper and the summary-formula registry.
//
// The Lezer parser itself (tables, LR engine, the generated formula grammar xK) stays inherited; this module
// only re-implements the application code that sits on top of it. Formula *values* (numbers, texts, dates,
// lists, ...) are still inherited classes reached through env().
import { env } from "./env.js";
import { inherit } from "./inherit.js";

/** The `values.*` summary formulas offered per value type (minified XK). */
export function s09SummaryFormulas() {
  const { EW, LW, MW, gW } = env();
  return new Map([
    [EW, { Average: "values.mean().round(2)", Min: "values.min()", Max: "values.max()", Sum: "values.sum().round(2)", Range: "values.max() - values.min()", Median: "values.median()", Stddev: "values.stddev().round(2)" }],
    [LW, { Earliest: "values.earliest()", Latest: "values.latest()", Range: "(values.latest() - values.earliest())" }],
    [MW, { Checked: 'values.filter(value == true).length', Unchecked: "values.filter(value == false).length" }],
    [gW, { Empty: 'values.filter(value.isType("null")).length', Filled: 'values.filter(!value.isType("null")).length', Unique: "values.unique().length" }],
  ]);
}

/** `var TK = gm.formulas` — the localized message helpers of the bases plugin. */
export function s09Formulas() { return env().gm.formulas; }

/** `var eY/cY = gm.plugins.bases` — the bases plugin's i18n label/message table. */
export function s09BasesStrings() { return env().gm.plugins.bases; }

// ---------------------------------------------------------------- syntax -> parsed JSON

/** Text covered by a syntax node. */
export function s09NodeText(node, text) { return text.slice(node.from, node.to); }

/** True when the formula is not a plain identifier (used to decide `note[...]` vs `note.prop` refs). */
export function s09IsIdentifierName(text) {
  const parsed = s09ParseFormula(text);
  return parsed.type !== "ident" || parsed.value !== text;
}

/** Depth-first search for the ⚠ error node lezer inserts on parse failure. */
export function s09FindErrorNode(node) {
  if (node.name === "⚠") return node;
  const children = env().QG(node);
  for (let i = 0; i < children.length; i++) {
    const found = s09FindErrorNode(children[i]);
    if (found) return found;
  }
  return null;
}

/** Lezer syntax node -> plain JSON description consumed by the AST classes. */
export function s09TreeToParsed(node, text) {
  const slice = (n) => s09NodeText(n, text);
  if (node.name === "Identifier") return { type: "ident", value: slice(node) };
  if (node.name === "GroupedExpression") return { type: "paren", value: s09TreeToParsed(node.firstChild.nextSibling, text) };
  if (node.name === "UnaryExpression") {
    const op = slice(node.firstChild);
    const expr = s09TreeToParsed(node.lastChild, text);
    if (op === "!") return { type: "not", expr };
    if (op === "-") return { type: "negate", expr };
    throw new Error("Unexpected node in parsed formula");
  }
  if (node.name === "Call") {
    // children: [function, "(", arg, ",", arg, ")"]; commas are skipped one per iteration, exactly like the original
    let child = node.firstChild.nextSibling.nextSibling;
    const args = [];
    for (;;) {
      if (child && child.name === ",") child = child.nextSibling;
      if (!(child && child.name !== ")")) break;
      args.push(child);
      child = child.nextSibling;
    }
    return { type: "call", object: s09TreeToParsed(node.firstChild, text), args: args.map((a) => s09TreeToParsed(a, text)) };
  }
  if (node.name === "ObjectAccess") {
    const head = node.firstChild;
    const index = head.nextSibling.nextSibling;
    return { type: "object_access", object: s09TreeToParsed(head, text), index: s09TreeToParsed(index, text) };
  }
  if (node.name === "ArrayAccess") {
    const head = node.firstChild;
    const index = head.nextSibling.nextSibling;
    return { type: "array_access", array: s09TreeToParsed(head, text), index: s09TreeToParsed(index, text) };
  }
  if (node.name === "AdditiveExpression" || node.name === "MultiplicativeExpression") {
    const left = node.firstChild;
    const op = left.nextSibling;
    const right = op.nextSibling;
    return { type: "math", op: slice(op), left: s09TreeToParsed(left, text), right: s09TreeToParsed(right, text) };
  }
  if (node.name === "LogicalExpression" || node.name === "RelationalExpression" || node.name === "EqualityExpression") {
    const left = node.firstChild;
    const op = left.nextSibling;
    const right = op.nextSibling;
    return { type: "compare", op: slice(op), left: s09TreeToParsed(left, text), right: s09TreeToParsed(right, text) };
  }
  if (node.name === "String") {
    const raw = slice(node);
    const dq = raw.match(/"(.*?)"$/);
    if (dq) return { type: "primitive", value: JSON.parse(raw) };
    const sq = raw.match(/'(.*?)'$/);
    if (sq) {
      const inner = raw.slice(1, -1).replace(/\\'/g, "'").split('\\"').map((p) => p.replace(/"/g, '\\"')).join('\\"');
      return { type: "primitive", value: JSON.parse('"' + inner + '"') };
    }
    throw new Error("Unexpected string node does not have quotes");
  }
  if (node.name === "RegExp") {
    const raw = slice(node);
    const slash = raw.lastIndexOf("/");
    return { type: "regexp", pattern: raw.slice(1, slash), flags: raw.slice(slash + 1) };
  }
  if (node.name === "RealNumber") return { type: "primitive", value: parseFloat(slice(node)) };
  if (node.name === "BooleanLiteral") return { type: "primitive", value: slice(node) === "true" };
  if (node.name === "NullLiteral") return { type: "primitive", value: null };
  if (node.name === "Array") {
    const elems = [];
    let child = node.firstChild.nextSibling;
    for (;;) {
      if (child && child.name === ",") child = child.nextSibling;
      if (!(child && child.name !== "]")) break;
      elems.push(child);
      child = child.nextSibling;
    }
    return { type: "array", elements: elems.map((el) => s09TreeToParsed(el, text)) };
  }
  throw new Error('Unknown node type "' + node.name + '" in parsed formula. (position ' + node.from + ")");
}

/** Parses formula text with the lezer grammar; never throws — failures become `{type:"invalid"}`. */
export function s09ParseFormula(text) {
  if (text.trim() === "") return { type: "empty" };
  const parser = s09FormulaSyntax().parser;
  let tree = null;
  try { tree = parser.parse(text); } catch (e) { return { type: "invalid", rawValue: text }; }
  const top = tree.topNode.firstChild;
  if (text.substring(0, top.from).trim() !== "" || text.substring(top.to).trim() !== "") {
    return { type: "invalid", rawValue: text, parseError: "Unable to parse formula. (position " + top.to + ")" };
  }
  if (s09FindErrorNode(top)) {
    return { type: "invalid", rawValue: text, parseError: "Unable to parse formula. (position " + top.from + ")" };
  }
  try { return s09TreeToParsed(top, text); } catch (e) {
    return { type: "invalid", rawValue: text, parseError: e.message };
  }
}

// The formula grammar (minified AK): lezer NodeSet giving syntax highlighting roles to the formula nodes.
let s09Syntax = null;
export function s09FormulaSyntax() {
  if (s09Syntax) return s09Syntax;
  const { Wj, xK, kh, Wh } = env();
  const props = kh({
    "ObjectAccess ArrayAccess": Wh.variableName,
    'MultiplicativeExpression/"*"': Wh.arithmeticOperator,
    'MultiplicativeExpression/"/"': Wh.arithmeticOperator,
    'MultiplicativeExpression/"%"': Wh.arithmeticOperator,
    'AdditiveExpression/"+"': Wh.arithmeticOperator,
    'AdditiveExpression/"-"': Wh.arithmeticOperator,
    "Identifier": Wh.propertyName,
    "Boolean": Wh.bool,
    "String": Wh.string,
    "RealNumber": Wh.number,
    "( )": Wh.paren,
    "[ ]": Wh.squareBracket,
  });
  s09Syntax = Wj.define({ parser: xK.configure({ props: [props] }) });
  return s09Syntax;
}

// ---------------------------------------------------------------- AST nodes
// The classes are ES5-style constructor functions because inherited code instantiates and `instanceof`-checks
// them; inherit() reproduces the original prototype chain. All of them are reachable both as app-scope vars
// (through the manifest wrappers) and through s09Nodes below, which is the single shared registry so that
// `instanceof`/static dispatch always sees the same objects.

const s09Nodes = {};

/** Collects the `values.*` summary formulas registered for a value class and its ancestors. */
export function s09SummaryFormulasFor(type) {
  const table = s09SummaryFormulas();
  const out = {};
  for (let t = type; t; ) {
    const found = table.get(t);
    if (found) Object.assign(out, found, out);
    if (t === env().gW) break;
    t = Object.getPrototypeOf(t);
  }
  return out;
}

// -- base node ---------------------------------------------------------------------------------------------

function buildFormulaNode() {
  function FormulaNode(type) { this.type = type; }
  FormulaNode.parse = function (text) {
    try {
      return FormulaNode.fromParsedResult(s09ParseFormula(text));
    } catch (e) {
      return new s09Nodes.Invalid(text, e.message);
    }
  };
  FormulaNode.fromParsedResult = function (parsed) {
    if (!Object.prototype.hasOwnProperty.call(parsed, "type")) {
      throw new Error(s09Formulas().msgErrorParseFormula({ formula: JSON.stringify(parsed) }));
    }
    switch (parsed.type) {
      case "empty": return s09Nodes.Empty.fromParsedResult(parsed);
      case "compare": return s09Nodes.Compare.fromParsedResult(parsed);
      case "math": return s09Nodes.Math.fromParsedResult(parsed);
      case "negate":
        return parsed.expr.type === "primitive" && Number.isNumber(parsed.expr.value)
          ? (parsed.expr.value = -parsed.expr.value, s09Nodes.Primitive.fromParsedResult(parsed.expr))
          : s09Nodes.Negate.fromParsedResult(parsed);
      case "not": return s09Nodes.Not.fromParsedResult(parsed);
      case "call": return s09Nodes.Call.fromParsedResult(parsed);
      case "array_access": return s09Nodes.ArrayAccess.fromParsedResult(parsed);
      case "object_access": return s09Nodes.ObjectAccess.fromParsedResult(parsed);
      case "paren": return s09Nodes.Paren.fromParsedResult(parsed);
      case "primitive": return s09Nodes.Primitive.fromParsedResult(parsed);
      case "regexp": return s09Nodes.Regexp.fromParsedResult(parsed);
      case "array": return s09Nodes.Array.fromParsedResult(parsed);
      case "ident": return s09Nodes.Ident.fromParsedResult(parsed);
      case "invalid": return s09Nodes.Invalid.fromParsedResult(parsed);
      default: throw new Error("Invalid type " + parsed.type);
    }
  };
  FormulaNode.prototype.test = function (ctx) { return this.getValue(ctx).isTruthy(); };
  return FormulaNode;
}
export function s09FormulaNode() { return s09Nodes.FormulaNode || (s09Nodes.FormulaNode = buildFormulaNode()); }

function buildInvalidNode() {
  const Base = s09FormulaNode();
  function InvalidNode(value, parseError) {
    const self = Base.call(this, "invalid") || this;
    self.value = value;
    self.parseError = parseError;
    return self;
  }
  inherit(InvalidNode, Base);
  InvalidNode.fromParsedResult = function (p) { return new InvalidNode(p.rawValue, p.parseError); };
  InvalidNode.prototype.getErrorMessage = function () { return this.parseError ? this.parseError : "Unable to parse formula."; };
  InvalidNode.prototype.getValue = function () { return env().bW.value; };
  InvalidNode.prototype.test = function () { return false; };
  return InvalidNode;
}
export function s09InvalidNode() { return s09Nodes.Invalid || (s09Nodes.Invalid = buildInvalidNode()); }

function buildEmptyNode() {
  const Base = s09FormulaNode();
  function EmptyNode() { return Base.call(this, "empty") || this; }
  inherit(EmptyNode, Base);
  EmptyNode.fromParsedResult = function () { return new EmptyNode(); };
  EmptyNode.prototype.getValue = function () { return env().bW.value; };
  EmptyNode.prototype.test = function () { return false; };
  return EmptyNode;
}
export function s09EmptyNode() { return s09Nodes.Empty || (s09Nodes.Empty = buildEmptyNode()); }

function buildCompareNode() {
  const Base = s09FormulaNode();
  function CompareNode(operator, left, right) {
    const self = Base.call(this, "comparison") || this;
    self.operator = operator; self.left = left; self.right = right;
    return self;
  }
  inherit(CompareNode, Base);
  CompareNode.fromParsedResult = function (p) {
    return new CompareNode(p.op, s09FormulaNode().fromParsedResult(p.left), s09FormulaNode().fromParsedResult(p.right));
  };
  CompareNode.prototype.getValue = function (ctx) {
    const { MW, bW, CW, LW, OW, EW, gW } = env();
    const left = this.left, right = this.right;
    switch (this.operator) {
      case "&&": return new MW(left.getValue(ctx).isTruthy() && right.getValue(ctx).isTruthy());
      case "||": return new MW(left.getValue(ctx).isTruthy() || right.getValue(ctx).isTruthy());
    }
    const lv = left.getValue(ctx), rv = right.getValue(ctx);
    switch (this.operator) {
      case "==": return new MW(gW.looseEquals(lv, rv));
      case "!=": return new MW(!gW.looseEquals(lv, rv));
    }
    if (lv instanceof bW) return bW.value;
    if (rv instanceof bW) return bW.value;
    let li, ri;
    if (lv instanceof LW) {
      li = lv.date.getTime();
      if (rv instanceof CW) { const d = LW.parseFromString(rv.data); if (d) rv = d; }
    } else if (lv instanceof OW) {
      li = lv.getMilliseconds();
      if (rv instanceof CW) { const d = OW.parseFromString(rv.data); if (d) rv = d; }
    } else {
      li = lv instanceof EW ? lv.data : lv.toString();
    }
    ri = rv instanceof LW ? rv.date.getTime() : rv instanceof OW ? rv.getMilliseconds() : rv instanceof EW ? rv.data : rv.toString();
    switch (this.operator) {
      case "<": return new MW(li < ri);
      case ">": return new MW(li > ri);
      case "<=": return new MW(li <= ri);
      case ">=": return new MW(li >= ri);
    }
    return bW.value;
  };
  return CompareNode;
}
export function s09CompareNode() { return s09Nodes.Compare || (s09Nodes.Compare = buildCompareNode()); }

function buildMathNode() {
  const Base = s09FormulaNode();
  function MathNode(operator, left, right) {
    const self = Base.call(this, "arithmetic") || this;
    self.operator = operator; self.left = left; self.right = right;
    return self;
  }
  inherit(MathNode, Base);
  MathNode.fromParsedResult = function (p) {
    return new MathNode(p.op, s09FormulaNode().fromParsedResult(p.left), s09FormulaNode().fromParsedResult(p.right));
  };
  MathNode.prototype.getValue = function (ctx) {
    const { EW, LW, CW, OW, SW, bW } = env();
    const lv = this.left.getValue(ctx), rv = this.right.getValue(ctx), op = this.operator;
    if (lv instanceof EW && rv instanceof EW) {
      switch (op) {
        case "+": return new EW(lv.data + rv.data);
        case "-": return new EW(lv.data - rv.data);
        case "*": return new EW(lv.data * rv.data);
        case "/": return new EW(lv.data / rv.data);
        case "%": return new EW(lv.data % rv.data);
        default: throw new Error("Invalid operator");
      }
    }
    let rrv = rv;
    if (lv instanceof LW && rrv instanceof CW) { const d = OW.parseFromString(rrv.data); if (d) rrv = d; }
    if (lv instanceof LW && rrv instanceof OW) {
      if (op !== "+" && op !== "-") throw new Error("Invalid date operator");
      return rrv.addToDate(lv, op === "-");
    }
    if (lv instanceof OW && rrv instanceof EW && (op === "*" || op === "/")) {
      const f = op === "*" ? rrv.data : 1 / rrv.data;
      return new OW(lv.years * f, lv.months * f, lv.days * f, lv.hours * f, lv.minutes * f, lv.seconds * f, lv.milliseconds * f);
    }
    if (lv instanceof OW && rrv instanceof OW && (op === "+" || op === "-")) {
      const sign = op === "+" ? 1 : -1;
      return new OW(lv.years + rrv.years * sign, lv.months + rrv.months * sign, lv.days + rrv.days * sign,
        lv.hours + rrv.hours * sign, lv.minutes + rrv.minutes * sign, lv.seconds + rrv.seconds * sign, lv.milliseconds + rrv.milliseconds * sign);
    }
    if (lv instanceof SW && rrv instanceof SW && op === "+") return lv.concat(rrv);
    if (op === "+" && (lv instanceof CW || rrv instanceof CW)) {
      const ls = lv === bW.value ? "" : lv.toString();
      const rs = rrv === bW.value ? "" : rrv.toString();
      return new CW(ls + rs);
    }
    if (op === "-" && lv instanceof LW && rrv instanceof LW) return OW.fromMilliseconds(lv.date.getTime() - rrv.date.getTime());
    if (lv === bW.value || rrv === bW.value) return bW.value;
    throw new Error("Invalid operator between " + lv.constructor.toString() + " and " + rrv.constructor.toString());
  };
  return MathNode;
}
export function s09MathNode() { return s09Nodes.Math || (s09Nodes.Math = buildMathNode()); }

function buildNegateNode() {
  const Base = s09FormulaNode();
  function NegateNode(expr) {
    const self = Base.call(this, "negate") || this;
    self.expr = expr;
    return self;
  }
  inherit(NegateNode, Base);
  NegateNode.fromParsedResult = function (p) { return new NegateNode(s09FormulaNode().fromParsedResult(p.expr)); };
  NegateNode.prototype.getValue = function (ctx) {
    const { EW, bW } = env();
    const v = this.expr.getValue(ctx);
    if (v === bW.value) return v;
    if (!(v instanceof EW)) throw new Error("Unable to negate " + v.toString());
    return new EW(-v.data);
  };
  return NegateNode;
}
export function s09NegateNode() { return s09Nodes.Negate || (s09Nodes.Negate = buildNegateNode()); }

function buildNotNode() {
  const Base = s09FormulaNode();
  function NotNode(expr) {
    const self = Base.call(this, "not") || this;
    self.expr = expr;
    return self;
  }
  inherit(NotNode, Base);
  NotNode.fromParsedResult = function (p) { return new NotNode(s09FormulaNode().fromParsedResult(p.expr)); };
  NotNode.prototype.getValue = function (ctx) {
    const { MW, bW } = env();
    const v = this.expr.getValue(ctx);
    return v === bW.value ? v : new MW(!v.isTruthy());
  };
  return NotNode;
}
export function s09NotNode() { return s09Nodes.Not || (s09Nodes.Not = buildNotNode()); }

function buildCallNode() {
  const Base = s09FormulaNode();
  function CallNode(name, subject, args) {
    const self = Base.call(this, "function") || this;
    self.name = name; self.subject = subject; self.args = args;
    return self;
  }
  inherit(CallNode, Base);
  CallNode.fromParsedResult = function (p) {
    if (p.type !== "call") throw new Error("Invalid type");
    let subjectNode = p.object;
    const rawArgs = p.args;
    if (!subjectNode || !rawArgs || !Array.isArray(rawArgs)) throw new Error("Invalid function");
    let subject = null;
    if (subjectNode.type === "object_access") {
      subject = s09FormulaNode().fromParsedResult(subjectNode.object);
      subjectNode = subjectNode.index;
    }
    if (subjectNode.type !== "ident") throw new Error("Invalid function name");
    return new CallNode(subjectNode.value, subject, rawArgs.map((a) => s09FormulaNode().fromParsedResult(a)));
  };
  CallNode.prototype.getValue = function (ctx) {
    const { EW, SW, AW, CW, bW } = env();
    const fm = s09Formulas();
    const name = this.name, subjectNode = this.subject, args = this.args;
    if (name === "if") {
      const arity = args.length + (subjectNode ? 1 : 0);
      if (arity < 2) throw new Error(fm.msgErrorNotEnoughArguments({ function: name }));
      if (arity > 3) throw new Error(fm.msgErrorTooManyArguments({ function: name }));
      let subj = subjectNode, rest = args;
      if (!subj) { subj = args[0]; rest = args.slice(1); }
      return (subj.getValue(ctx) || bW.value).isTruthy() ? rest[0].getValue(ctx) : rest.length === 2 ? rest[1].getValue(ctx) : bW.value;
    }
    let fn = null;
    let subjectValue = null;
    if (subjectNode) {
      subjectValue = subjectNode.getValue(ctx) || bW.value;
      fn = env().QW.findForValue(subjectValue, name);
      if (!fn && subjectValue === bW.value) return bW.value;
    } else {
      fn = env().QW.findGlobal(name);
    }
    if (subjectValue instanceof SW) {
      if (name === "reduce") {
        if (args.length < 2) throw new Error(fm.msgErrorNotEnoughArguments({ function: name }));
        if (args.length > 2) throw new Error(fm.msgErrorTooManyArguments({ function: name }));
        const accFn = args[0];
        let acc = args[1].getValue(ctx);
        const step = (i) => {
          const item = subjectValue.get(i);
          const inner = {
            app: ctx.app,
            keys() { return ctx.keys().concat(["index", "value", "acc"]); },
            getByIdentifier(id) {
              if (id === "index") return new EW(i);
              if (id === "value") return item;
              if (id === "acc") return acc;
              return ctx.getByIdentifier(id);
            },
          };
          acc = accFn.getValue(inner);
        };
        for (let i = 0; i < subjectValue.length(); i++) step(i);
        return acc;
      }
      if (name === "filter" || name === "map") {
        if (args.length < 1) throw new Error(fm.msgErrorNotEnoughArguments({ function: name }));
        if (args.length > 1) throw new Error(fm.msgErrorTooManyArguments({ function: name }));
        const fnNode = args[0];
        const len = subjectValue.length();
        const out = [];
        const step = (i) => {
          const item = subjectValue.get(i);
          const inner = {
            app: ctx.app,
            keys() { return ctx.keys().concat(["index", "value"]); },
            getByIdentifier(id) {
              if (id === "index") return new EW(i);
              if (id === "value") return item;
              return ctx.getByIdentifier(id);
            },
          };
          if (name === "filter") { if (fnNode.test(inner)) out.push(item); }
          else if (name === "map") out.push(fnNode.getValue(inner));
        };
        for (let i = 0; i < len; i++) step(i);
        return new SW(out);
      }
    } else if (subjectValue instanceof AW) {
      if (name === "filter" || name === "map") {
        if (args.length < 1) throw new Error(fm.msgErrorNotEnoughArguments({ function: name }));
        if (args.length > 1) throw new Error(fm.msgErrorTooManyArguments({ function: name }));
        const fnNode = args[0];
        const keys = subjectValue.keys();
        const innerFor = (key, val) => ({
          app: ctx.app,
          keys() { return ctx.keys().concat(["key", "value"]); },
          getByIdentifier(id) {
            if (id === "key") return new CW(key);
            if (id === "value") return val;
            return ctx.getByIdentifier(id);
          },
        });
        if (name === "filter") {
          const out = {};
          for (const key of keys) { const val = subjectValue.get(key); if (fnNode.test(innerFor(key, val))) out[key] = val; }
          return new AW(out);
        }
        const out = [];
        for (const key of keys) { const val = subjectValue.get(key); out.push(fnNode.getValue(innerFor(key, val))); }
        return new SW(out);
      }
    }
    if (!fn) {
      const msg = subjectValue
        ? fm.msgErrorInvalidInstanceFunction({ function: name, type: subjectValue.constructor.toString() })
        : fm.msgErrorInvalidFunction({ function: name });
      throw new Error(msg);
    }
    const params = fn.params;
    let pi = 0;
    const callArgs = [];
    const pushArg = (value) => {
      if (pi === params.length) {
        if (!params[params.length - 1].variadic) throw new Error(fm.msgErrorTooManyArguments({ function: name }));
        pi--;
      }
      const p = params[pi];
      if (p.optional && value === bW.value) callArgs.push(null);
      else {
        if (!p.type.some((t) => value instanceof t)) {
          if (value === bW.value) return false;
          throw new Error(fm.msgErrorTypeError({ function: name, parameter: p.name, expected: p.type[0].toString(), given: value.constructor.toString() }));
        }
        callArgs.push(value);
      }
      pi++;
      return true;
    };
    if (subjectValue && !pushArg(subjectValue)) return bW.value;
    for (let i = 0; i < args.length; i++) {
      if (!pushArg(args[i].getValue(ctx) || bW.value)) return bW.value;
    }
    if (pi < params.length) {
      for (let i = pi; i < params.length; i++) {
        if (!params[i].optional && !params[i].variadic) throw new Error(fm.msgErrorNotEnoughArguments({ function: name }));
      }
    }
    return fn.applyWithContext.apply(fn, [ctx, ...callArgs]);
  };
  return CallNode;
}
export function s09CallNode() { return s09Nodes.Call || (s09Nodes.Call = buildCallNode()); }

function buildArrayAccessNode() {
  const Base = s09FormulaNode();
  function ArrayAccessNode(array, index) {
    const self = Base.call(this, "array_access") || this;
    self.array = array; self.index = index;
    return self;
  }
  inherit(ArrayAccessNode, Base);
  ArrayAccessNode.fromParsedResult = function (p) {
    if (p.type !== "array_access") throw new Error("Invalid type");
    if (!Object.prototype.hasOwnProperty.call(p, "array") || !Object.prototype.hasOwnProperty.call(p, "index")) throw new Error("Invalid array access");
    return new ArrayAccessNode(s09FormulaNode().fromParsedResult(p.array), s09FormulaNode().fromParsedResult(p.index));
  };
  ArrayAccessNode.prototype.getValue = function (ctx) {
    const { SW, AW, CW, EW, bW } = env();
    const fm = s09Formulas();
    const target = this.array.getValue(ctx);
    if (!target || target === bW.value) return bW.value;
    const idx = this.index.getValue(ctx);
    if (!idx || idx === bW.value) return bW.value;
    if (target instanceof SW) {
      if (!(idx instanceof EW)) throw new Error("Array index must be an integer. Got " + idx.constructor.toString());
      let i = idx.data;
      if (i < 0) i += target.length();
      return target.get(i);
    }
    if (target instanceof AW) {
      if (!(idx instanceof CW)) throw new Error("Object access must be an string. Got " + idx.constructor.toString());
      return target.objectAccess(idx.data);
    }
    if (target instanceof CW) {
      if (!(idx instanceof EW)) throw new Error("String index must be an integer. Got " + idx.constructor.toString());
      return new CW(target.data.charAt(idx.data));
    }
    if (idx instanceof CW) {
      const hit = target.objectAccess(idx.toString());
      if (hit === null) throw new Error(fm.msgErrorInvalidObjectAccess({ index: idx.data, type: target.constructor.toString() }));
      return hit;
    }
    throw new Error(fm.msgErrorInvalidArrayAccess({ index: idx.toString() }));
  };
  return ArrayAccessNode;
}
export function s09ArrayAccessNode() { return s09Nodes.ArrayAccess || (s09Nodes.ArrayAccess = buildArrayAccessNode()); }

function buildObjectAccessNode() {
  const Base = s09FormulaNode();
  function ObjectAccessNode(object, index) {
    const self = Base.call(this, "object_access") || this;
    self.object = object; self.index = index;
    return self;
  }
  inherit(ObjectAccessNode, Base);
  ObjectAccessNode.fromParsedResult = function (p) {
    if (p.type !== "object_access") throw new Error("Invalid type");
    if (!Object.prototype.hasOwnProperty.call(p, "object") || !Object.prototype.hasOwnProperty.call(p, "index")) throw new Error("Invalid object access");
    if (p.index.type !== "ident") throw new Error("Invalid object access");
    return new ObjectAccessNode(s09FormulaNode().fromParsedResult(p.object), p.index.value);
  };
  ObjectAccessNode.prototype.getValue = function (ctx) {
    const { bW } = env();
    const target = this.object.getValue(ctx);
    if (!target || target === bW.value) return bW.value;
    const hit = target.objectAccess(this.index);
    if (hit === null) throw new Error(s09Formulas().msgErrorInvalidObjectAccess({ index: this.index, type: target.constructor.toString() }));
    return hit;
  };
  return ObjectAccessNode;
}
export function s09ObjectAccessNode() { return s09Nodes.ObjectAccess || (s09Nodes.ObjectAccess = buildObjectAccessNode()); }

function buildParenNode() {
  const Base = s09FormulaNode();
  function ParenNode(value) {
    const self = Base.call(this, "paren_expr") || this;
    self.value = value;
    return self;
  }
  inherit(ParenNode, Base);
  ParenNode.fromParsedResult = function (p) { return new ParenNode(s09FormulaNode().fromParsedResult(p.value)); };
  ParenNode.prototype.getValue = function (ctx) { return this.value.getValue(ctx); };
  return ParenNode;
}
export function s09ParenNode() { return s09Nodes.Paren || (s09Nodes.Paren = buildParenNode()); }

function buildPrimitiveNode() {
  const Base = s09FormulaNode();
  function PrimitiveNode(value) {
    const self = Base.call(this, "primitive") || this;
    self.value = value;
    return self;
  }
  inherit(PrimitiveNode, Base);
  PrimitiveNode.fromParsedResult = function (p) { return new PrimitiveNode(p.value); };
  PrimitiveNode.prototype.getValue = function () { return env().zW(this.value); };
  return PrimitiveNode;
}
export function s09PrimitiveNode() { return s09Nodes.Primitive || (s09Nodes.Primitive = buildPrimitiveNode()); }

function buildRegexpNode() {
  const Base = s09FormulaNode();
  function RegexpNode(value) {
    const self = Base.call(this, "regexp") || this;
    self.value = new (env().PW)(value);
    return self;
  }
  inherit(RegexpNode, Base);
  RegexpNode.fromParsedResult = function (p) { return new RegexpNode(new RegExp(p.pattern, p.flags)); };
  RegexpNode.prototype.getValue = function () { return this.value; };
  return RegexpNode;
}
export function s09RegexpNode() { return s09Nodes.Regexp || (s09Nodes.Regexp = buildRegexpNode()); }

function buildArrayNode() {
  const Base = s09FormulaNode();
  function ArrayNode(elements) {
    const self = Base.call(this, "array") || this;
    self.elements = elements;
    return self;
  }
  inherit(ArrayNode, Base);
  ArrayNode.fromParsedResult = function (p) {
    if (!Object.prototype.hasOwnProperty.call(p, "elements") || !Array.isArray(p.elements)) throw new Error("Invalid array");
    return new ArrayNode(p.elements.map(s09FormulaNode().fromParsedResult));
  };
  ArrayNode.prototype.getValue = function (ctx) {
    return new (env().SW)(this.elements.map((el) => el.getValue(ctx)));
  };
  return ArrayNode;
}
export function s09ArrayNode() { return s09Nodes.Array || (s09Nodes.Array = buildArrayNode()); }

function buildIdentNode() {
  const Base = s09FormulaNode();
  function IdentNode(id) {
    const self = Base.call(this, "ident") || this;
    self.id = id;
    return self;
  }
  inherit(IdentNode, Base);
  IdentNode.fromParsedResult = function (p) { return new IdentNode(p.value); };
  IdentNode.prototype.getValue = function (ctx) { return ctx.getByIdentifier(this.id); };
  return IdentNode;
}
export function s09IdentNode() { return s09Nodes.Ident || (s09Nodes.Ident = buildIdentNode()); }

// -- misc formula wrappers -------------------------------------------------------------------------------

/** A formula kept as its source text; `formula` is the parsed AST (Invalid node on failure). */
export function s09FormulaText() {
  function FormulaText(text) {
    this.text = text;
    this.formula = s09FormulaNode().parse(text);
  }
  FormulaText.prototype.toString = function () { return this.text; };
  FormulaText.prototype.test = function (ctx) { return this.formula.test(ctx); };
  FormulaText.prototype.getValue = function (ctx) {
    try { return this.formula.getValue(ctx); } catch (e) { return new (env().yW)(e); }
  };
  return FormulaText;
}

/** Evaluation context exposing the `values` list of a summary row. */
export function s09ValuesContext() {
  function ValuesContext(app, values) { this.app = app; this.values = values; }
  ValuesContext.prototype.keys = function () { return ["values"]; };
  ValuesContext.prototype.getByIdentifier = function (id) {
    return id.toLowerCase() === "values" ? new (env().SW)(this.values) : env().bW.value;
  };
  return ValuesContext;
}

/** The same context specialised to an empty values list. */
export function s09EmptyValuesContext() {
  const Base = s09ValuesContext();
  function EmptyValuesContext(app) { return Base.call(this, app, []) || this; }
  inherit(EmptyValuesContext, Base);
  return EmptyValuesContext;
}
