// Differential check for the s08 slice: the original declarations (cut from the base revision) and the own
// implementations in src-app/s08-values.js are driven through the same scenarios; logged results must be identical.
//   node tools/s08-compare.mjs [--n 40]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import { readManifest } from "../build-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const N = +(process.argv[process.argv.indexOf("--n") + 1] || 40);

// ---- built-in helpers the app defines (src/enhance.js) ----
const def = (t, n, v) => { if (!t[n]) Object.defineProperty(t, n, { value: v, enumerable: false, configurable: true, writable: true }); };
def(Array.prototype, "contains", Array.prototype.includes);
def(Array.prototype, "first", function () { return this[0]; });
def(Array.prototype, "last", function () { return this[this.length - 1]; });
def(String, "isString", (v) => typeof v === "string" || v instanceof String);
def(Number, "isNumber", (v) => typeof v === "number");
def(String.prototype, "contains", String.prototype.includes);
def(Object, "hasOwn", (o, k) => Object.prototype.hasOwnProperty.call(o, k));

// ---- a permissive moment stub: both sides share it, so any constant answer stays identical ----
const fakeMoment = (d) => ({ fromNow: () => "a while ago", format: () => "2020-01-02", diff: () => 0, isValid: () => true, toDate: () => new Date(0) });
fakeMoment.duration = () => ({ humanize: () => "a few seconds", asMilliseconds: () => 0 });
globalThis.window = globalThis;
globalThis.moment = fakeMoment;

// ---- DOM-ish stubs shared by both worlds ----
const fakeEl = () => {
  const el = {
    calls: [], children: [],
    createEl(tag, opts) { el.calls.push(["createEl", tag]); return fakeEl(); },
    createSpan(cls, opts) { el.calls.push(["createSpan", cls]); return fakeEl(); },
    createDiv(cls, opts) { el.calls.push(["createDiv", cls]); return fakeEl(); },
    setText(s) { el.calls.push(["setText", String(s)]); },
    setAttr(k, v) { el.calls.push(["setAttr", k, String(v)]); },
    addClass(c) { el.calls.push(["addClass", c]); },
    toggleClass(c, f) { el.calls.push(["toggleClass", c, !!f]); },
    appendChild(n) { el.calls.push(["appendChild"]); },
    addEventListener() {}, onClickEvent() {}, isActiveElement() { return false; }, focus() {},
  };
  return el;
};

const STUBS = {
  tW: Object.create(null),
  uW: () => "stub-cls",
  ev: () => null,
  Yl: { isDesktopApp: false, isPhone: false, hasPhysicalKeyboard: true, resourcePathPrefix: "app://obsidian.md/" },
  gm: { interface: { menu: { deleteFile: () => "Delete file" }, msgFailedToOpenHref: ({ href }) => "cannot open " + href } },
  tv: () => {}, Mv: () => {}, sv: 500, kv: () => {},
  nE: (s) => s, Ic: () => {}, Lc: () => false,
  Ug: { forEvent: () => ({ addSections: () => ({ addItem: () => ({}) }) }) },
  Bg: { isModEvent: () => false }, Yc: () => true, fb: function () {},
  pe: { single: () => ({}) }, o_: { of: () => ({}) },
  QW: { getAllForValue: () => ({}), getAllGlobal: () => [] },
  DK: class { constructor(s) { this.formula = null; } }, RK: class {},
  rt: class {}, AK: {}, tU: class {}, _G: {}, CU: class {}, TU: {}, _o: {}, EU: {}, MU: {},
  KG: () => ({}), RG: () => ({}), np: () => null, ej: () => ({ from: 0, to: 0 }),
  XG: () => "", $G: () => ({ name: "", parent: null }), GG: () => {}, IK: () => false,
  Lv: () => {}, Fb: () => "", Rb: () => "", createDiv: () => fakeEl(), $T: class {},
  Zx: (h) => h, Kx: (s) => s, xL: (h) => h, app: {},
};

// ---- original world: dependency functions + the class declarators in dependency order ----
const manifest = readManifest();
const base = loadBase(manifest.base);
const tmp = path.join(os.tmpdir(), "s08-base.js");
fs.writeFileSync(tmp, base.src);
const bb = loadBundle(tmp);
const EXT = `var f=function(e,t){return f=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n])},f(e,t)};function m(e,t){function n(){this.constructor=e}f(e,t),e.prototype=null===t?Object.create(t):(n.prototype=t.prototype,new n)}\nvar v=Object.assign;\n`;

const DEPS_FN = ["zW", "WU", "QG", "WW", "UW", "_W", "jW", "ZG", "Jq", "Qc", "xW", "qV", "vc", "iT", "hu", "ac", "HV", "zV", "ET", "YC", "uW", "nE", "Ic", "Lc", "Yc", "tv", "kv", "Zx", "Kx", "xL", "np", "ej", "XG", "$G", "GG", "IK", "Lv", "Fb", "Rb", "ev"];
const DEPS_VAR = ["cb", "ub", "Vy"];
const CLASSES = [
  ["gW", "s08AnyValue"], ["wW", "s08Value"], ["kW", "s08ScalarValue"], ["CW", "s08StringValue"],
  ["bW", "s08NullValue"], ["EW", "s08NumberValue"], ["MW", "s08BooleanValue"], ["SW", "s08ListValue"],
  ["TW", "s08TagValue"], ["DW", "s08TagsValue"], ["AW", "s08ObjectValue"], ["PW", "s08RegExpValue"],
  ["LW", "s08DateValue"], ["IW", "s08RelativeDateValue"], ["OW", "s08DurationValue"],
  ["FW", "s08IconValue"], ["NW", "s08FileValue"], ["RW", "s08UrlValue"], ["BW", "s08LinkValue"],
  ["VW", "s08ImageValue"], ["yW", "s08ErrorValue"], ["YW", "s08FuncRegistry"], ["GW", "s08FormulaFunc"],
  ["KW", "s08FormulaMethod"], ["XW", "s08SelfFunc"], ["sW", "s08TableResolver"], ["vW", "s08LinkRenderer"],
  ["vj", "s08SearchBarBase"], ["YG", "s08FormulaSuggester"],
];

const initOf = new Map();
for (const n of bb.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) initOf.set(d.id.name, base.src.slice(d.init.start, d.init.end));

const NAMES = [
  ...DEPS_VAR.map((n) => `var ${n}=${initOf.get(n)};`),
  ...DEPS_FN.map((n) => base.fn(n) + "\n"),
  ...CLASSES.map(([o]) => `var ${o}=${initOf.get(o)};`),
];
const RET = [...DEPS_VAR, ...DEPS_FN.map((n) => n), ...CLASSES.map(([o]) => o)];
const stubKeys = Object.keys(STUBS);
const ORIG_WORLD = new Function(...stubKeys, EXT + NAMES.join("\n") + `\nreturn {${RET.join(",")}};`)(...stubKeys.map((k) => STUBS[k]));

// ---- own world ----
const OWN = await import(pathToFileURL(path.join(root, "src-app", "s08-values.js")).href);
const { bindEnv } = await import(pathToFileURL(path.join(root, "src-app", "env.js")).href);
const host = { ...STUBS };
for (const n of [...DEPS_VAR, ...DEPS_FN]) host[n] = ORIG_WORLD[n];
const OWN_CLASSES = {};
for (const [orig, use] of CLASSES) { host[orig] = OWN_CLASSES[orig] = OWN[use](host); }
bindEnv(() => ({
  bW: OWN_CLASSES.bW, CW: OWN_CLASSES.CW, EW: OWN_CLASSES.EW, MW: OWN_CLASSES.MW,
  SW: OWN_CLASSES.SW, LW: OWN_CLASSES.LW, AW: OWN_CLASSES.AW,
  DW: OWN_CLASSES.DW, TW: OWN_CLASSES.TW, BW: OWN_CLASSES.BW, NW: OWN_CLASSES.NW,
  DK: STUBS.DK, RK: STUBS.RK, np: STUBS.np, ej: STUBS.ej,
}));

const W_ORIG = { ...ORIG_WORLD };
const W_OWN = { ...ORIG_WORLD, ...OWN_CLASSES }; // own classes shadow; deps identical

// ---- helpers ----
const describe = (v) => {
  if (v == null) return "null";
  if (typeof v !== "object") return String(v);
  try { return v.toString(); } catch (e) { return "<tostring-throw>"; }
};
const snap = (v) => {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(snap);
  if (v instanceof Date) return "Date(" + v.toISOString() + ")";
  if (v.constructor !== Object) return describe(v);
  const out = {};
  for (const k of Object.keys(v)) { try { out[k] = snap(v[k]); } catch (e) { out[k] = "<err>"; } }
  return out;
};
const logCall = (log, name, fn) => { try { log.push(name + "=" + snap(fn())); } catch (e) { log.push(name + " THROW " + e.constructor.name + ":" + String(e.message).slice(0, 60)); } };

const fakeFile = { path: "folder/note.md", basename: "note", name: "note.md", extension: "md", parent: { path: "folder" }, stat: { ctime: 1000, mtime: 2000, size: 42 }, getShortName: () => "note" };
const fakeApp = {
  metadataCache: {
    getFirstLinkpathDest: (p, src) => (p === "Target" ? fakeFile : null),
    iterateRefsForFile: (f, cb) => { cb({ link: "Other", displayText: "oth" }); cb({ link: "Third" }); },
    resolvedLinks: { "src note.md": { "folder/note.md": 1 } },
    getFileCache: () => ({ tags: [{ tag: "#inline" }], embeds: [{ link: "Emb" }], frontmatter: { tags: ["fm-tag"], key: "val", num: 7 } }),
  },
  vault: { getResourcePath: (f) => "app://res/" + f.path },
  workspace: {}, dragManager: {}, fileManager: {}, internalPlugins: { getEnabledPluginById: () => null },
};

const cases = [
  ["gW", (w, log) => {
    const a = new w.gW(); log.push("icon=" + a.icon);
    logCall(log, "Any.toString", () => w.gW.toString());
    logCall(log, "Any.equals", () => w.gW.equals(a, a) + "/" + w.gW.equals(a, {}));
    logCall(log, "proto.equals", () => a.equals(a));
    logCall(log, "proto.looseEquals", () => a.looseEquals(a));
    logCall(log, "keys", () => JSON.stringify(a.keys()));
    logCall(log, "objectAccess", () => a.objectAccess("x"));
    const el = fakeEl(); a.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["kW", (w, log) => {
    const v = new w.kW("txt"); log.push("data=" + v.data + " icon=" + v.icon);
    logCall(log, "toString", () => v.toString()); logCall(log, "isTruthy", () => v.isTruthy());
    logCall(log, "equals", () => v.equals(new w.kW("txt")) + "/" + v.equals(new w.kW("other")));
    logCall(log, "looseEquals", () => v.looseEquals(new w.kW("txt")) + "/" + v.looseEquals(new w.EW(1)));
  }],
  ["CW", (w, log) => {
    const v = new w.CW("hello"); log.push("icon=" + v.icon + " type=" + v.type);
    logCall(log, "toString", () => v.toString());
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    logCall(log, "oa.length", () => describe(v.objectAccess("length")));
    logCall(log, "oa.LENGTH", () => describe(v.objectAccess("LENGTH")));
    logCall(log, "oa.other", () => v.objectAccess("other"));
    const el = fakeEl(); v.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["bW", (w, log) => {
    logCall(log, "singleton", () => describe(w.bW.value) + " same=" + (w.bW.value === w.bW.value));
    logCall(log, "ctor-throws", () => { try { new w.bW(); return "no"; } catch (e) { return "THROW " + e.message.slice(0, 40); } });
    logCall(log, "toString", () => w.bW.value.toString());
    logCall(log, "isTruthy", () => w.bW.value.isTruthy());
    logCall(log, "equals", () => w.bW.value.equals(w.bW.value));
  }],
  ["EW", (w, log) => {
    const v = new w.EW(42); log.push("icon=" + v.icon);
    const el = fakeEl(); v.renderTo(el); log.push("renderTo42=" + JSON.stringify(el.calls));
    const inf = new w.EW(Infinity); const el2 = fakeEl(); inf.renderTo(el2); log.push("renderToInf=" + JSON.stringify(el2.calls));
    logCall(log, "toString", () => v.toString() + "/" + inf.toString());
  }],
  ["MW", (w, log) => {
    const t = new w.MW(true), f = new w.MW(false);
    logCall(log, "isTruthy", () => t.isTruthy() + "/" + f.isTruthy());
    const el = fakeEl(); t.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
    logCall(log, "equals", () => t.equals(new w.MW(true)) + "/" + t.equals(f));
  }],
  ["SW", (w, log) => {
    const v = new w.SW([3, "x", true, [1, 2], { a: 1 }, null, new w.EW(9)]);
    log.push("icon=" + v.icon + " len=" + v.length());
    for (let i = 0; i < v.data.length; i++) logCall(log, "get" + i, () => describe(v.get(i)));
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy());
    logCall(log, "includes", () => v.includes(new w.EW(9)) + "/" + v.includes(new w.EW(8)));
    logCall(log, "equals", () => v.equals(new w.SW([3, "x", true, [1, 2], { a: 1 }, null, new w.EW(9)])));
    logCall(log, "slice", () => describe(v.slice(1, 3)));
    logCall(log, "reverse", () => describe(v.reverse()));
    logCall(log, "flatten", () => describe(v.flatten()));
    logCall(log, "unique", () => describe(new w.SW([1, 1, "a", "a", 2]).unique()));
    logCall(log, "sort", () => describe(new w.SW([3, 1, 2]).sort()));
    logCall(log, "concat", () => describe(v.concat(new w.SW([7]))));
    logCall(log, "sum", () => describe(new w.SW([1, 2, 3]).sum()));
    logCall(log, "median", () => describe(new w.SW([1, 2, 3, 4]).median()));
    logCall(log, "mean", () => describe(new w.SW([2, 4]).mean()));
    logCall(log, "minmax", () => describe(new w.SW([2, 4]).min()) + "/" + describe(new w.SW([2, 4]).max()));
    logCall(log, "stddev", () => describe(new w.SW([2, 4, 4, 4, 5, 5, 7, 9]).stddev()));
    logCall(log, "join", () => describe(v.join("|")));
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    logCall(log, "oa.length", () => describe(v.objectAccess("length")));
    logCall(log, "getNumbers", () => JSON.stringify(new w.SW([1, "x", new w.EW(2)]).getNumbers()));
    logCall(log, "getDates", () => JSON.stringify(new w.SW(["2020-01-01", "bad", new w.LW(new Date("2021-05-05T00:00:00"))]).getDates()));
    logCall(log, "earliest", () => describe(new w.SW(["2020-01-01", "2021-01-01"]).earliest()));
    logCall(log, "latest", () => describe(new w.SW(["2020-01-01", "2021-01-01"]).latest()));
    const el = fakeEl(); new w.SW([new w.EW(1), "two"]).renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["TW", (w, log) => {
    const v = new w.TW("#Foo/Bar");
    log.push("data=" + v.data + " lower=" + v.lowerTag + " icon=" + v.icon);
    logCall(log, "toString", () => v.toString());
    logCall(log, "tagMatches-self", () => v.tagMatches(new w.TW("#foo")));
    logCall(log, "tagMatches-str", () => v.tagMatches(new w.CW("#foo/bar/baz")) + "/" + v.tagMatches(new w.CW("#foo2")));
    const el = fakeEl(); const r = { renderTag: (t, e) => e.calls.push(["renderTag", t]) }; v.renderTo(el, r); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["DW", (w, log) => {
    const v = new w.DW(["#a", "#b/c"]);
    log.push("icon=" + v.icon + " len=" + v.length());
    logCall(log, "includes", () => v.includes(new w.TW("#a/x")) + "/" + v.includes(new w.TW("#b")) + "/" + v.includes(new w.TW("#c")));
    logCall(log, "toString", () => v.toString());
  }],
  ["AW", (w, log) => {
    const v = new w.AW({ a: 1, b: "x", c: [1, 2], d: { e: 3 } });
    log.push("icon=" + v.icon);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isEmpty", () => v.isEmpty() + "/" + new w.AW({}).isEmpty());
    for (const k of ["a", "b", "c", "d", "missing"]) logCall(log, "get." + k, () => describe(v.get(k)));
    logCall(log, "getInsensitive", () => describe(v.getInsensitive("A")));
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    logCall(log, "valuesRaw", () => JSON.stringify(v.valuesRaw()));
    logCall(log, "equals", () => v.equals(new w.AW({ a: 1, b: "x", c: [1, 2], d: { e: 3 } })) + "/" + v.equals(new w.AW({ a: 2 })));
    const fm = w.AW.fromFrontMatter(fakeApp, fakeFile, { tags: ["t1", "t2"], link: "[[Target]]", plain: "hello", num: 7, when: "2020-01-01", dur: "P1D" });
    for (const k of ["tags", "link", "plain", "num", "when", "dur", "missing"]) logCall(log, "fm." + k, () => describe(fm.get(k)));
  }],
  ["PW", (w, log) => {
    const v = new w.PW(/ab+c/gi);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy());
    log.push("icon=" + v.icon + " type=" + v.type);
  }],
  ["LW", (w, log) => {
    const d = new Date("2020-01-02T03:04:05");
    const v = new w.LW(d, true), vd = new w.LW(d, false);
    log.push("icons=" + v.icon + "/" + vd.icon);
    logCall(log, "toString", () => v.toString() + " | " + vd.toString());
    logCall(log, "printDate", () => v.printDate());
    logCall(log, "printTime", () => v.printTime());
    logCall(log, "dateOnly", () => describe(v.dateOnly()) + " time=" + v.dateOnly().time);
    logCall(log, "relative", () => v.relative());
    logCall(log, "equals", () => v.equals(new w.LW(new Date(d)) , true) + "/" + v.equals(vd));
    logCall(log, "looseEquals-str", () => v.looseEquals(new w.CW(v.toString())));
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    for (const k of ["year", "month", "day", "hour", "minute", "second", "millisecond", "timestamp", "nope"]) logCall(log, "oa." + k, () => describe(v.objectAccess(k)));
    logCall(log, "parse-dt", () => describe(w.LW.parseFromString("2020-01-02T03:04:05")));
    logCall(log, "parse-d", () => describe(w.LW.parseFromString("2020-01-02")));
    logCall(log, "parse-bad", () => w.LW.parseFromString("nope"));
    const el = fakeEl(); v.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["IW", (w, log) => {
    const v = new w.IW(new Date("2020-01-02T03:04:05"), true);
    logCall(log, "toString", () => v.toString());
    const el = fakeEl(); v.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
    logCall(log, "isLW", () => v instanceof w.LW);
  }],
  ["OW", (w, log) => {
    const v = new w.OW(1, 2, 3, 4, 5, 6, 7);
    log.push("icon=" + v.icon);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy() + "/" + new w.OW(0, 0, 0, 0, 0, 0, 0).isTruthy());
    logCall(log, "equals", () => v.equals(new w.OW(1, 2, 3, 4, 5, 6, 7)) + "/" + v.equals(new w.OW(1, 0, 0, 0, 0, 0, 0)));
    logCall(log, "addToDate", () => { const r = v.addToDate(new w.LW(new Date("2020-01-01T00:00:00"), false), true); return describe(r) + " time=" + r.time; });
    logCall(log, "getMilliseconds", () => typeof v.getMilliseconds());
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    for (const k of ["days", "hours", "weeks", "nope"]) logCall(log, "oa." + k, () => describe(v.objectAccess(k)));
    logCall(log, "parse-iso", () => describe(w.OW.parseFromString("P1Y2M3W4DT5H6M7S")));
    logCall(log, "parse-human", () => describe(w.OW.parseFromString("3 days")) + " / " + describe(w.OW.parseFromString("-2hours")));
    logCall(log, "parse-bad", () => w.OW.parseFromString("junk"));
    logCall(log, "fromMs", () => describe(w.OW.fromMilliseconds(1500)));
    logCall(log, "looseEquals", () => v.looseEquals(new w.CW("P1Y2M3W4DT5H6M7S")));
  }],
  ["FW", (w, log) => {
    const v = new w.FW("some-icon");
    log.push("data=" + v.data + " icon=" + v.icon);
    const el = fakeEl(); v.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
    logCall(log, "toString", () => v.toString());
  }],
  ["NW", (w, log) => {
    const v = new w.NW(fakeApp, fakeFile);
    log.push("icon=" + v.icon);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy());
    logCall(log, "equals", () => v.equals(new w.NW(fakeApp, fakeFile)) + "/" + v.equals(new w.NW(fakeApp, { path: "other" })));
    logCall(log, "looseEquals", () => v.looseEquals(new w.CW("folder/note.md")) + "/" + v.looseEquals(new w.CW("x")));
    for (const k of ["getLinks", "getBacklinks", "getEmbeds", "getTags", "getProps"]) logCall(log, k, () => describe(v[k]()));
    logCall(log, "cached", () => v.getLinks() === v.getLinks() && v.getTags() === v.getTags());
    for (const k of ["file", "name", "basename", "fullname", "path", "folder", "ext", "ctime", "mtime", "size", "links", "embeds", "backlinks", "tags", "properties", "nope"]) logCall(log, "oa." + k, () => describe(v.objectAccess(k)));
    logCall(log, "keys", () => JSON.stringify(v.keys()));
    const el = fakeEl(); const r = { renderFileLink: (f, d, e) => e.calls.push(["renderFileLink", f && f.path, d]) }; v.renderTo(el, r); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["RW", (w, log) => {
    const v = new w.RW("https://example.com/x", new w.CW("disp"));
    log.push("icon=" + v.icon + " display=" + v.display);
    logCall(log, "equals", () => v.equals(new w.RW("https://example.com/x", new w.CW("disp"))) + "/" + v.equals(new w.RW("https://example.com/x")));
    const el = fakeEl(); const r = { renderExternalLink: (u, d, e) => e.calls.push(["renderExternalLink", u, d && d.data]) }; v.renderTo(el, r); log.push("renderTo=" + JSON.stringify(el.calls));
    logCall(log, "toString", () => v.toString());
  }],
  ["BW", (w, log) => {
    const disp = new w.CW("shown");
    const v = new w.BW(fakeApp, "Target", "src.md", disp);
    log.push("icon=" + v.icon);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy());
    logCall(log, "resolve", () => { const f = v.resolve(); return f && f.path; });
    logCall(log, "equals", () => v.equals(new w.BW(fakeApp, "Target", "src.md", new w.CW("shown"))) + "/" + v.equals(new w.BW(fakeApp, "Other", "src.md", null)));
    logCall(log, "looseEquals-link", () => v.looseEquals(new w.BW(fakeApp, "Target", "src.md", null)) + "/" + v.looseEquals(new w.BW(fakeApp, "Nope", "src.md", null)));
    logCall(log, "looseEquals-str", () => v.looseEquals(new w.CW("[[Target]]")));
    logCall(log, "looseEquals-file", () => v.looseEquals(new w.NW(fakeApp, fakeFile)));
    const p = w.BW.parseFromString(fakeApp, "[[Target|alias]]", "src.md");
    logCall(log, "parse", () => p && p.data + "|" + (p.display && p.display.data) + "|" + p.sourcePath);
    logCall(log, "parse-nobar", () => { const q = w.BW.parseFromString(fakeApp, "[[Plain]]", "s"); return q && q.data + "|" + q.display; });
    logCall(log, "parse-bad", () => w.BW.parseFromString(fakeApp, "notalink", "s"));
    const fr = w.BW.fromReference(fakeApp, "src.md", { link: "Ref", displayText: "dt" });
    logCall(log, "fromRef", () => fr.data + "|" + fr.display.data + "|" + fr.sourcePath);
    const el = fakeEl(); const r = { renderFileLink: (a, b, e) => e.calls.push(["renderFileLink", a, b && b.data]) }; v.renderTo(el, r); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["VW", (w, log) => {
    const int_ = new w.VW("img/pic.png"), ext = new w.VW("https://x.test/a.png");
    logCall(log, "toString-int", () => int_.toString());
    logCall(log, "toString-ext", () => ext.toString());
    const renderer = { app: { metadataCache: { getFirstLinkpathDest: () => null }, vault: { getResourcePath: (f) => "res/" + f.path } } };
    const el1 = fakeEl(); int_.renderTo(el1, renderer); log.push("renderToInt=" + JSON.stringify(el1.calls));
    const el2 = fakeEl(); ext.renderTo(el2, renderer); log.push("renderToExt=" + JSON.stringify(el2.calls));
  }],
  ["yW", (w, log) => {
    const v = new w.yW("boom");
    log.push("icon=" + v.icon + " msg=" + v.message);
    logCall(log, "toString", () => v.toString());
    logCall(log, "isTruthy", () => v.isTruthy());
    logCall(log, "equals", () => v.equals(new w.yW("boom")) + "/" + v.equals(new w.yW("other")));
    logCall(log, "ctor-err", () => { const e = new w.yW(new Error("kaput")); return e.message; });
    const el = fakeEl(); v.renderTo(el); log.push("renderTo=" + JSON.stringify(el.calls));
  }],
  ["YW", (w, log) => {
    const r = new w.YW();
    const f1 = { name: "DoThing" }, f2 = { name: "Other" };
    r.addForType(w.CW, f1); r.addForType(w.EW, f2); r.addGlobal(f1);
    logCall(log, "findForValue", () => r.findForValue(new w.CW("x"), "dothing") === f1);
    logCall(log, "findForValue-none", () => r.findForValue(new w.MW(true), "dothing"));
    logCall(log, "findGlobal", () => r.findGlobal("DOTHING") === f1);
    logCall(log, "getAllForValue", () => Object.keys(r.getAllForValue(new w.CW("x"))).sort().join(","));
    logCall(log, "getAllGlobal", () => r.getAllGlobal().length);
    r.removeForType(w.CW, "DoThing");
    logCall(log, "afterRemove", () => r.findForValue(new w.CW("x"), "dothing"));
    logCall(log, "removeForType", () => { r.removeForType(w.EW, "Other"); return r.findForValue(new w.EW(1), "other"); });
    logCall(log, "removeForType-bad", () => { try { r.removeForType(w.EW, f2); return "no"; } catch (e) { return e.constructor.name; } });
    logCall(log, "removeGlobal", () => { r.removeGlobal("DoThing"); return r.findGlobal("dothing"); });
  }],
  ["GW", (w, log) => {
    const f = new w.GW();
    logCall(log, "ctx-init", () => f.ctx);
    logCall(log, "serialize", () => f.serialize("a", "b"));
    logCall(log, "applyWithContext", () => { f.apply = function () { return this.ctx + ":" + Array.prototype.slice.call(arguments).join(","); }; return f.applyWithContext("CTX", 1, 2) + "|ctx-after=" + f.ctx; });
  }],
  ["KW", (w, log) => {
    const f = new w.KW();
    f.name = "check"; f.operate = (...a) => a.length;
    logCall(log, "apply", () => describe(f.apply(new w.EW(1), new w.EW(2))));
    logCall(log, "serialize", () => f.serialize("recv", "x", "y"));
  }],
  ["XW", (w, log) => {
    const f = new w.XW();
    f.name = "twice"; f.operate = (v) => v * 2;
    logCall(log, "params", () => f.params[0].name + ":" + f.params[0].type.length);
    logCall(log, "apply", () => describe(f.apply(new w.EW(21))));
  }],
  ["sW", (w, log) => {
    const r = new w.sW({ extra: 1 });
    logCall(log, "resolve-hit", () => r.resolve("anything"));
    logCall(log, "resolve-empty", () => r.resolve(""));
    logCall(log, "resolve-null", () => r.resolve(null));
  }],
];

let failed = 0;
for (let k = 0; k < N; k++) {
  for (const [name, scenario] of cases) {
    const run = (world) => { const log = []; try { scenario(world, log); } catch (e) { log.push("SCENARIO-THROW " + e.constructor.name + ":" + String(e.message).slice(0, 80)); } return log; };
    const a = run(W_ORIG), b = run(W_OWN);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failed++;
      if (failed <= 5) {
        const i = a.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(b[j]));
        console.log(`MISMATCH ${name} iter ${k} @${i}:\n  orig ${JSON.stringify(a[i])}\n  own  ${JSON.stringify(b[i])}`);
      }
    }
  }
}
console.log(failed ? `${failed} mismatches over ${N} iterations x ${cases.length} cases` : `all identical (${N} iterations x ${cases.length} cases)`);

// ---- entry functions ----
const FN_CASES = [
  ["zW", "s08JsToValue", [null, undefined, () => {}, "s", 3.5, true, false, [1, "a"], new Date("2020-01-01T00:00:00"), { x: 1 }, Symbol ? Symbol("s") : 0]],
  ["ZW", "s08KeyGlob", [{ "*": 1 }, { a: 1, b: 2 }, { "?": 1 }]],
  ["WU", "s08ShallowClone", [null, "s", 4, [1, 2], { a: [1], b: { c: 1 } }]],
  ["QG", "s08ChildArray", [fakeEl(), { firstChild: { nextSibling: { nextSibling: null } } }, null]],
  ["WW", "s08VariadicParam", [["p", W_ORIG.EW, W_ORIG.CW]]],
  ["UW", "s08OptionalParam", [["p", W_ORIG.EW]]],
  ["_W", "s08CustomWidgetParam", [["p", "wid", W_ORIG.EW]]],
  ["jW", "s08TypedParam", [["p", W_ORIG.EW, W_ORIG.CW]]],
];
for (const [orig, use, argss] of FN_CASES) {
  for (const args of argss) {
    const call = (fn) => { try { return snap(fn(...args)); } catch (e) { return "THROW " + e.constructor.name + ":" + String(e.message).slice(0, 60); } };
    const a = call(ORIG_WORLD[orig]), b = call(OWN[use]);
    // jW/WW/UW/_W produce {name,type:[classes]} — compare structurally via names
    const norm = (v) => JSON.stringify(v, (k, x) => (typeof x === "function" ? (x.type || x.name || "fn") : x));
    if (norm(a) !== norm(b)) { failed++; console.log(`FN MISMATCH ${orig}: orig=${norm(a)} own=${norm(b)}`); }
  }
}
// ZG and Jq need env-bound stubs
{
  const zg = (fn) => { try { const r = fn({ get: () => null }, "1+1"); return describe(r); } catch (e) { return "THROW " + e.constructor.name; } };
  const a = zg(ORIG_WORLD.ZG ?? ((ctx, s) => { const n = new STUBS.DK(s); if (!(n.formula instanceof STUBS.RK)) { try { return n.formula.getValue(ctx); } catch (e) {} } return ORIG_WORLD.bW.value; }));
  const b = zg(OWN.s08FormulaValue);
  if (describe(a) !== describe(b)) { failed++; console.log(`FN MISMATCH ZG: ${describe(a)} vs ${describe(b)}`); }
}
console.log(failed ? `TOTAL ${failed} mismatches` : "entries identical too");
process.exit(failed ? 1 : 0);
