// Differential test: every function that build-app.mjs replaced is run in its ORIGINAL form (cut out of the base revision of
// src/app.js, with exactly the helpers it used) and in its NEW form (src-app/ + app-core wasm) on generated and hand-picked
// inputs; results, thrown error kinds and in-place mutations must be identical.
//   node tools/app-compare.mjs [--n 4000] [--seed 1] [--only nu,iu] [--bench]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadBase } from "./app-base.mjs";
import { readManifest, buildWasm, MODULES } from "../build-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N = +opt("--n", 4000), SEED = +opt("--seed", 1), ONLY = opt("--only", null)?.split(",");

// ---- helpers the app defines on built-ins (src/enhance.js); the originals expect them ----
const def = (t, n, v) => { if (!t[n]) Object.defineProperty(t, n, { value: v, enumerable: false, configurable: true, writable: true }); };
def(Array.prototype, "contains", Array.prototype.includes);
def(Array.prototype, "first", function () { if (this.length) return this[0]; });
def(Array.prototype, "last", function () { if (this.length) return this[this.length - 1]; });
def(Array.prototype, "unique", function () { return Array.from(new Set(this)); });
def(Array, "combine", (lists) => [].concat(...lists));
def(Math, "clamp", (v, lo, hi) => Math.min(Math.max(v, lo), hi));
def(String, "isString", (v) => typeof v === "string" || v instanceof String);
def(String.prototype, "contains", String.prototype.includes);

// ---- stage the new modules with the wasm filled in, import them as real ES modules ----
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-app-compare-"));
const wasm = buildWasm({ cargo: !argv.includes("--no-cargo") });
for (const m of MODULES) {
  let code = fs.readFileSync(path.join(root, "src-app", m), "utf8");
  if (m === "core.js") code = code.replace("__WASM_B64__", wasm.toString("base64"));
  fs.writeFileSync(path.join(stage, m), code);
}
const NEW = {};
for (const m of MODULES) Object.assign(NEW, await import(pathToFileURL(path.join(stage, m)).href));

const manifest = readManifest();
// functions that are time/DOM dependent and are tested by tools/class-compare.mjs (tools/class-tests/*.mjs) instead
const COVERED_ELSEWHERE = new Set(["wc"]);
const base = loadBase(manifest.base);
// the app-core (Rust) variants that are not wired into the manifest are tested against the same originals
const RUST_EXTRA = [{ orig: "cu", use: "normalizePathRs" }, { orig: "Pf", use: "formatBytesRs" }, { orig: "LT", use: "plainHeadingRs" }, { orig: "IT", use: "linkSafeHeadingRs" }, { orig: "gy", use: "isOlderVersionRs" }, { orig: "Dy", use: "fuzzyMatch" }];
const entries = manifest.entries.concat(RUST_EXTRA).filter((e) => !ONLY || ONLY.includes(e.orig));
const O = new Function(base.closure(manifest.entries.map((e) => e.orig)))();

// ---- random inputs ----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class R {
  constructor(seed) { this.r = rng(seed); }
  f() { return this.r(); }
  i(n) { return Math.floor(this.r() * n); }
  pick(a) { return a[this.i(a.length)]; }
  bool(p = 0.5) { return this.r() < p; }
  chars(alphabet, max) { let s = ""; const n = this.i(max + 1); for (let k = 0; k < n; k++) s += this.pick(alphabet); return s; }
  str(max = 12) { return this.chars(ALPHA, max); }
  path(max = 6) { const parts = []; const n = this.i(max + 1); for (let k = 0; k < n; k++) parts.push(this.word()); return this.pick(["", "/", "\\", "//", "./", "../"]) .concat(parts.join(this.pick(["/", "/", "/", "\\", "//", "/ "]))).concat(this.pick(["", "", "/", "\\", "//"])); }
  word() { return this.chars(WORD, 8) + (this.bool(0.3) ? "." + this.chars(WORD, 4) : ""); }
  int(lo = -5, hi = 50) { return lo + this.i(hi - lo + 1); }
  num() { return this.pick([0, -0, 1, -1, 0.5, 1023, 1024, 1025, 1536, 1048575, 1048576, 1e9, 2 ** 40, 1e15, 123456789.987, 999.995, 1023.9999, 0.125, 1.125, 2.5, 1e18, 1e21, NaN, Infinity, -Infinity, -5, 1152, this.f() * 10 ** this.i(16), this.i(5000)]); }
  uc() { return this.pick(["A", "b", "É", "é", "ß", "İ", "ǅ", "日", "本", "한", "😀", "\u0301", "\u00a0", "\u202f", "\ud800", "\udc00", "Σ", "ς", "ı"]); }
}
const WORD = [..."abcxyzABCXYZ019 -_éЁё日#^[]|%:() \u00a0\u0301ß😀"];
const ALPHA = [..."abcdeABCDE0129 \t\n\r./\\#^[]|%:'\"-_()&<>!?éÉёЖ日本ひ한ß\u00a0\u202f\u0301Σİ😀\ud800\udc00,;*+=@~`{}$"];

const lonely = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
const sizes = ["", "5", "5x6", "0x", " 12 x 34 ", "12 x", "x5", "007", "9999999999999999999", "1 x 2 x 3"];
const FIELDS = ["tags", "Tags", "aliases", "ALIASES", "title", "x"];
const cmpFn = (R_) => { const k = R_.i(3); return (a, b) => (k === 0 ? a - b : k === 1 ? b - a : (a % 3) - (b % 3)); };
const pointOf = (r) => ({ x: r.int(-100, 100) / (r.bool() ? 1 : 4), y: r.int(-100, 100) });
const boxOf = (r) => { const x = r.int(-50, 50), y = r.int(-50, 50); return { minX: x, minY: y, maxX: x + r.int(0, 60), maxY: y + r.int(0, 60) }; };
const sideOf = (r) => r.pick(["top", "left", "right", "bottom", "center", "x"]);
const rgbOf = (r) => ({ r: r.int(0, 255), g: r.int(0, 255), b: r.int(0, 255) });
const frontmatterOf = (r) => { const o = {}; for (let k = r.i(4); k > 0; k--) o[r.pick(FIELDS)] = r.pick([r.str(6), [r.str(5), r.str(5), 3, null, " " + r.str(3) + " "], 5, null, "", [], r.str(6) + " " + r.str(3), true]); return o; };
const hexOf = (r) => r.chars([..."0123456789abcdefABCDEFxg "], 10);
const bytesOf = (r, n = r.i(12)) => Uint8Array.from({ length: n }, () => r.int(0, 255));
const listOf = (r, f, max = 6) => Array.from({ length: r.i(max + 1) }, () => f());
const ver = (r) => r.pick(["", "1", "1.2", "1.2.3", "0.9.10", "1.0", "01.2", "1.2.3.4", "a.b", "1..2", "1.2x", "0x10", " 1.2", "1.2 ", "10.0.0", "2.0", "99999999999999999.1", "-1.0", "+3.1", "1.5.0-beta", "1e3.2"]);
const date = (r) => new Date(r.pick([0, 86400000 * 365 * 30, 1e12, -1e11, 1709800000000, 4102444800000, r.f() * 4e12]));
const mkPrepared = (r) => O.My(r.pick(["", "foo", "foo bar", "Fo Ba", "a-b_c", "日本語", "😀 x", "x.md", "  ", "Ünï", "q\u0301", "ǅa", "i̇", "ßß", "a\ud800"]) + r.str(4));
const fuzzyText = (r) => r.pick(["", "foo bar", "FooBar", "fooBarBaz", "foo/bar/baz.md", "Foo-Bar_baz", "日本語ノート", "x😀y", "Ünï cödé", "İstanbul", "ßtraße", "a b c", "abc", "notes/Daily Notes/2024-01-01"]) + r.str(r.i(15));

// spec: orig name -> (R) => args
const S = {
  nu: (r) => [r.path()], iu: (r) => [r.path()], ru: (r) => [r.path()], ou: (r) => [r.path()], au: (r) => [r.path()], su: (r) => [r.path()],
  lu: (r) => [r.word(), r.pick(["", "md", "TXT", r.word()])], uu: (r) => [r.path()], tu: (r) => [r.path()], cu: (r) => [r.path()],
  hu: (r) => [r.path()], pu: (r) => [r.path()], BL: (r) => [r.path()],
  q2: (r) => [{ extension: r.pick(["md", "png", "", "MD"]), path: r.path() }],
  j2: (r) => [r.pick([{ type: "file", file: { path: r.path() } }, { type: "alias", file: { path: r.path() } }, { type: "unresolved", linktext: r.str() }, { type: "bookmark", bookmarkPath: r.str() }, { type: "x" }])],
  cee: (r) => [r.pick(["manifest.json", "main.js", "styles.css", "data.json", "x", "Main.js", r.str()])], D5: (r) => [{ path: r.path() }, r.str(5)],
  ET: (r) => [r.path() + r.pick(["", "#", "#h", "#^b", "##x#y"])], MT: (r) => [r.path() + r.pick(["", "#", "#h", "#^b", "##x#y"])], RT: (r) => [r.pick([null, undefined, "", "#a", "#^b", "#[^f", "x", "^b"])],
  YC: (r) => [r.pick(["./a", "../a", "http://x", "a:b", "mailto:x", "x/y", "", ".a:b", "C:\\x"]) + r.str(4)], XC: (r) => [r.pick(["<a b>", "<a", "a b", "  <x y> z", " a\tb", "", "<>", "<a>b>"]) + r.str(5)],
  ZC: (r) => [r.pick(["%41", "%E6%97%A5", "%", "%zz", "a%20b", "%25", "%C3", "a b"]) + r.str(3)], eE: (r) => [r.str(14) + r.pick(["", "\\", "\u0000\u0008\u000b", " ", "\u001f\u000e\u000d"])],
  tE: (r) => [r.chars([..."#a \n"], 20) + r.pick(["", "\n# Title", "\n###### x", "####### no", "#nospace\n## h2 two"])], nE: (r) => [r.pick(["", "#", "#a#b", "a##b", " #x # y ", "#\u00a0a"]) + r.str(5)], JC: (r) => [r.str(12)],
  Pf: (r) => [r.num()], rm: (r) => [r.chars([..."aBcDe_09-fG"], 12)], gc: (r) => [r.str(30), r.int(0, 20)], u7: (r) => [r.chars([..."ab\n"], 8)], pP: (r) => [r.pick([null, undefined, "", r.chars([..."a\n \tb"], 12)])],
  yA: (r) => [r.str()], xW: (r) => [r.str(5)], zL: (r) => [r.pick(["", " ", "a\nb", "a".repeat(120), "a b ".repeat(30), r.str(8)])],
  ZI: (r) => [r.pick([null, undefined, "", 0, 5, false, [], [null, 1, "a"], [undefined], ["a", ["b"]], "x", new String("z"), { a: 1 }, true])], YA: (r) => [r.pick(["", [], [1], "a", null, 0])],
  Ree: (r) => [r.chars([..."a b,\"c "], 14)], Bee: (r) => [listOf(r, () => r.str(5))],
  kq: (r) => [r.chars([..."> a"], 10)], Cq: (r) => [r.chars([..."> \t  a"], 14)], Vj: (r) => [r.str(18), r.pick(["a", "b+", "[", "\\d", "", "é", "(x"])],
  FQ: (r) => [r.pick(["a+b", "%41+%20", "%", "%E6%97", "x", ""]) + r.str(3)], NQ: (r) => [r.str(10)], RQ: (r) => [r.str(14), r.pick([undefined, "/", "\\", ",", "ab"])],
  NX: (r) => [r.chars([..."a\n"], 8)], Ej: (r) => [r.str(6)], zx: (r) => [r.pick(sizes)], WZ: (r) => [r.pick([null, "", "12", "0x1f", "abc", "12px", " 7", "-3", "1e3", undefined, "9".repeat(25)])],
  Vl: (r) => [r.pick(["1.5", "x", "", " 2", "-0", "1e3px", null, undefined, 4, "Infinity"]), r.pick([0, 5, "d"])], f_: (r) => [r.pick(["", "a", undefined, null]), r.pick(["", "b", undefined, null])],
  Js: (r) => [r.int(-5, 100000)], uc: (r) => [r.chars([..."a\n"], 10), r.int(-2, 14)], Dv: (r) => [r.chars([..."a\n"], 10), r.int(0, 5)],
  Nb: (r) => [r.pick(["KeyA", "Key", "KeyAB", "Digit1", "", "keyA"])], Fb: (r) => [r.pick([[], ["Mod"], ["Ctrl", "Shift"]]), r.str(2)],
  my: (r) => [{ Alpha: 1, beta: 2, GAMMA: 3 }, r.pick(["alpha", "BETA", "Gamma", "delta", "ALPHA"])], qV: (r) => [{ Alpha: 1, beta: 2, constructor: 3 }, r.pick(["alpha", "BETA", "Gamma", "Alpha", "constructor", "CONSTRUCTOR"])],
  vy: (r) => [r.pick([ver(r), null, undefined, 5, ""])], gy: (r) => [r.pick([ver(r), null, undefined]), r.pick([ver(r), null, undefined, 3])], P1: (r) => [r.pick(["error", "warning", "info", "hint", "x", undefined])],
  L1: (r) => [listOf(r, () => ({ severity: r.pick(["error", "warning", "info", "hint", "x"]) }))], rD: (r) => [r.pick(["Chrome/120.0.1 x", "chrome/9", "no", "", "Chrome/", "Mozilla Chrome/1.2.3.4 Safari"])],
  tY: (r) => [r.pick(["note.x", "file.name", "formula.f", "other.x", "plain", "a.b.c", "", ".x", "file."]) ], nY: (r) => [r.str(4), r.str(4)],
  SY: (r) => [r.pick(["note.x", "note.file.x", "note.formula", "note.", "note.abc.def", "file.file", "x", "", "note.xyz"]) ], xY: (r) => [r.pick(["note.x", "file", "x", "formula.f", "file.a", "", "notes"])],
  PY: (r) => [new Set(r.pick([["a"], ["a", "a 2"], [], ["a", "a 2", "a 3"]])), r.pick(["a", "b"])],
  LT: (r) => [r.chars([..."a b#^[]|%:\n.,()é日 \u00a0\t&!*"], 18)], IT: (r) => [r.chars([..."a b#^[]|%:\n\\(é日 \u00a0\t[%]"], 18)],
  kA: (r) => [r.pick([null, undefined, {}, { a: { value: "<x>", required: true }, b: { required: false }, c: { value: "v" } }])],
  cA: (r) => [r.pick([1, 2, "a", NaN, undefined, 0]), r.pick([1, 2, "b", NaN, 0])], uA: (r) => [r.pick([1, 2, "a", NaN, undefined, 0]), r.pick([1, 2, "b", NaN, 0])],
  MJ: (r) => [r.f(), r.pick([0.5, 0.1, 0.9, 2, r.f()])], SJ: (r) => [r.f(), r.pick([0.5, 0.1, 0.9, r.f()])], l4: (r) => [r.int(0, 12)], cc: (r) => [r.int(0, 20)],
  zs: (r) => [r.pick([[1], 2, "a", null, undefined, [[]]])], ac: (r) => [listOf(r, () => r.pick([1, 2, "1", NaN, NaN, 0, -0]))], lc: (r) => { const l = listOf(r, () => r.int(0, 9), 6); return [l, r.int(-1, 7), r.int(-1, 7)]; },
  N6: (r) => { const l = listOf(r, () => r.int(0, 5), 7); const k = r.int(0, 5); return [l, (x) => x === k]; }, mc: (r) => { const l = listOf(r, () => r.int(0, 30), 9).sort((a, b) => a - b); const k = r.int(-1, 31); return [l, (x) => x - k]; },
  vc: (r) => [r.pick([["a", "b"], ["a", null], [1], [], "x", null, [null], [undefined, "a"]]), r.pick([undefined, true, false])], hF: (r) => [listOf(r, () => r.i(9), 3), listOf(r, () => r.i(9), 3)],
  uF: (r) => [listOf(r, () => r.i(9), 30), r.int(-1, 40), r.int(0, 12), r.int(0, 9)], ve: (r) => { const a = listOf(r, () => r.i(3), 3); return [a, r.bool() ? a.slice() : listOf(r, () => r.i(3), 3)]; },
  ye: (r) => { const a = listOf(r, () => r.i(3), 3); return [a, r.bool() ? a.slice() : listOf(r, () => r.i(3), 3), (x, y) => x == y]; },
  c8: (r) => { const ids = ["a", "b", "c", "d"]; return [listOf(r, () => ({ id: r.pick(ids) }), 5), r.pick([[], ["a", "b"], ["d", "c", "b", "a"]])]; }, HI: (r) => [r.pick([null, undefined, [], [[3, 5]], [[0, 1], [2, 3]]])],
  HV: (r) => [date(r)], zV: (r) => [date(r)], VV: (r) => [r.int(-3, 120)], Ok: (r) => [r.int(0, 300)], Fk: (r) => [rgbOf(r)], Rk: (r) => [rgbOf(r)], Hk: (r) => [rgbOf(r)],
  Lk: (r) => [{ h: r.int(-30, 400), s: r.int(0, 100), l: r.int(0, 100) }], Ik: (r) => [rgbOf(r)], Nk: (r) => [r.pick(["#aabbcc", "AABBCC", "#abc", "zzzzzz", "#12ab9F", "", "#aabbccdd"])],
  H3: (r) => [r.pick(["1,2,3", " 10 , 20,30 ", "a,b,c", "1,2", "300,0,0", "1, 2, 3, 4"])], Df: (r) => [hexOf(r)], Af: (r) => [bytesOf(r).buffer], Gee: (r) => [bytesOf(r, r.i(8))], Kee: (r) => [bytesOf(r, 6), r.int(0, 3)], Yee: (r) => [bytesOf(r, 6), r.int(0, 3)],
  mu: (r) => { const b = new Uint8Array(bytesOf(r, 10).buffer, r.i(3), r.i(5)); return [b]; }, bf: (r) => { const b = new Uint8Array(bytesOf(r, 10).buffer, r.i(3), r.i(5)); return [b]; },
  jb: (r) => [Array.from(bytesOf(r))], Ub: (r) => [Array.from(bytesOf(r, 6)), Array.from(bytesOf(r, r.i(6)))], Jb: (r) => [bytesOf(r, 8 + r.i(6))],
  gu: (r) => [{ birthtimeMs: r.f() * 1e12, mtimeMs: r.pick([0.5, 1.5, r.f() * 1e12]), size: r.i(1e6) }], dk: (r) => [{ ctime: r.f() * 1e12, mtime: r.pick([0.5, 2.5, r.f() * 1e12]), size: r.i(1e6) }],
  Ol: (r) => [r.int(), r.int()], Nl: (r) => [r.int(), r.int(), r.int(), r.int()], Bl: (r) => [pointOf(r), pointOf(r)], Rl: (r) => [pointOf(r), { width: r.int(), height: r.int() }], Fl: (r) => [{ clientX: r.int(), clientY: r.int() }],
  d3: (r) => [r.int(), r.int(), r.int(), r.int()], f3: (r) => [pointOf(r), pointOf(r)], m3: (r) => [{ x: r.int(), y: r.int(), width: r.int(0, 30), height: r.int(0, 30) }], v3: (r) => [boxOf(r)],
  g3: (r) => [listOf(r, () => boxOf(r), 4)], y3: (r) => [boxOf(r), r.int(-3, 9)], b3: (r) => [boxOf(r), boxOf(r)], w3: (r) => [boxOf(r)], k3: (r) => [pointOf(r), { width: r.int(0, 30), height: r.int(0, 30) }],
  P3: (r) => [boxOf(r)], L3: (r) => [listOf(r, () => boxOf(r), 4)], I3: (r) => [listOf(r, () => r.int(-5, 5), 8), (x) => x * 2],
  F3: (r) => [pointOf(r)], N3: (r) => [pointOf(r)], q5: (r) => [sideOf(r), pointOf(r), r.int(0, 20)], H5: (r) => [boxOf(r), sideOf(r)], j5: (r) => [pointOf(r), sideOf(r), pointOf(r), sideOf(r)],
  Ay: (r) => [listOf(r, () => ({ match: { score: r.pick([-1, -0.5, 0, 1, -2.25, NaN]) }, id: r.i(99) }), 6)], Py: (r) => [r.pick([null, undefined, [], [[1, 2], [3, 4]]]), r.int(-3, 5)],
  eT: (r) => [r.pick([null, undefined, frontmatterOf(r)]), r.pick(["tags", "Tags", "title", /^tags$/i, /^ali/i, /^x$/])], tT: (r) => [frontmatterOf(r), r.pick(["tags", /^tags$/i, /^aliases$/i, "title"])],
  iT: (r) => [r.pick([null, undefined, frontmatterOf(r), frontmatterOf(r)])], nT: (r) => [r.pick([frontmatterOf(r), frontmatterOf(r), frontmatterOf(r)])],
  My: (r) => [r.pick(["", "foo", "foo bar", "Fo Ba", "a-b_c", "日本語", "😀 x", "x.md", "  ", "Ünï", "q\u0301", "ǅa", "i̇", "ßß", "a\ud800", "\ud800"]) + r.str(4)],
  Dy: (r) => [mkPrepared(r), fuzzyText(r)],
  xy: (r) => [listOf(r, () => [r.i(9), r.i(20) + 9], 4), r.i(10), r.i(40), r.i(4)],
};

const ok = (a, b) => util.isDeepStrictEqual(a, b);
function run(fn, args) { try { return { v: fn(...args) , a: args }; } catch (e) { return { e: e && e.constructor && e.constructor.name }; } }

let failed = 0, total = 0;
const rows = [];
for (const e of entries) {
  const spec = S[e.orig];
  if (!spec && COVERED_ELSEWHERE.has(e.orig)) { console.log(`skip ${e.orig}: covered by tools/class-compare.mjs`); continue; }
  if (!spec) { console.log(`NO SPEC for ${e.orig}`); failed++; continue; }
  const o = O[e.orig], nw = NEW[e.use];
  let bad = 0, n = 0, thrown = 0;
  for (let k = 0; k < N; k++) {
    const a1 = spec(new R(SEED * 1e6 + k), O), a2 = spec(new R(SEED * 1e6 + k), O);
    // prepared-query objects built by the ORIGINAL My are shared in shape; clone via the same seed above
    const randomA = e.orig === "cc" ? mulberryRandom(k) : null, randomB = e.orig === "cc" ? mulberryRandom(k) : null;
    let ro, rn;
    if (randomA) { const save = Math.random; Math.random = randomA; ro = run(o, a1); Math.random = randomB; rn = run(nw, a2); Math.random = save; }
    else { ro = run(o, a1); rn = run(nw, a2); }
    n++;
    if (ro.e) thrown++;
    const same = ro.e || rn.e ? ro.e === rn.e : ok(ro.v, rn.v) && util.inspect(a1, { depth: 6 }) === util.inspect(a2, { depth: 6 });
    if (!same) {
      bad++;
      if (bad <= 3) console.log(`MISMATCH ${e.orig} -> ${e.use}\n  args: ${util.inspect(a1, { depth: 3 })}\n  old : ${util.inspect(ro, { depth: 4 })}\n  new : ${util.inspect(rn, { depth: 4 })}`);
    }
  }
  total += n; failed += bad;
  rows.push(`${bad ? "FAIL" : "ok  "} ${e.orig.padEnd(4)} ${e.use.padEnd(22)} ${n} cases, ${bad} differ, ${thrown} threw in both`);
}
function mulberryRandom(seed) { const g = rng(seed + 12345); return () => g(); }
console.log(rows.join("\n"));
console.log(`\n${entries.length} functions, ${total} comparisons, ${failed} differences`);

// ---- optional speed comparison of the hot / Rust-backed ones ----
if (argv.includes("--bench")) {
  const time = (label, f, reps) => { f(); const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) f(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; return ms; };
  const r = new R(7);
  const texts = Array.from({ length: 2000 }, () => fuzzyText(r));
  const qs = ["fb", "foo bar", "dn", "note", "日本"].map((q) => O.My(q));
  const old = time("old", () => { for (const q of qs) for (const t of texts) O.Dy(q, t); }, 20);
  const single = time("new single", () => { for (const q of qs) for (const t of texts) NEW.fuzzyMatch(q, t); }, 20);
  const batch = time("new batch", () => { for (const q of qs) NEW.fuzzyMatchMany(q, texts); }, 20);
  const js = time("new js", () => { for (const q of qs) for (const t of texts) NEW.fuzzyMatchJs(q, t); }, 20);
  console.log(`fuzzy search over ${texts.length * qs.length} pairs x20: original JS ${old.toFixed(0)} ms, own JS ${js.toFixed(0)} ms, wasm per call ${single.toFixed(0)} ms, wasm batched ${batch.toFixed(0)} ms`);
  const paths = Array.from({ length: 2000 }, () => r.path());
  const bytes = Array.from({ length: 2000 }, () => r.f() * 10 ** r.i(12));
  const heads = Array.from({ length: 2000 }, () => r.chars([..."a b#^[]|%:\n.,()é日 "], 20));
  const vers = Array.from({ length: 2000 }, () => `${r.i(9)}.${r.i(30)}.${r.i(30)}`);
  const cases = [
    ["normalizePath", () => paths.forEach((p) => O.cu(p)), () => paths.forEach((p) => NEW.normalizePath(p)), () => paths.forEach((p) => NEW.normalizePathRs(p))],
    ["formatBytes", () => bytes.forEach((p) => O.Pf(p)), () => bytes.forEach((p) => NEW.formatBytes(p)), () => bytes.forEach((p) => NEW.formatBytesRs(p))],
    ["plainHeading", () => heads.forEach((p) => O.LT(p)), () => heads.forEach((p) => NEW.plainHeading(p)), () => heads.forEach((p) => NEW.plainHeadingRs(p))],
    ["isOlderVersion", () => vers.forEach((p) => O.gy(p, "5.20.3")), () => vers.forEach((p) => NEW.isOlderVersion(p, "5.20.3")), () => vers.forEach((p) => NEW.isOlderVersionRs(p, "5.20.3"))],
  ];
  for (const [name, a, b, c] of cases) console.log(`${name.padEnd(15)} x2000 x50: original ${time(0, a, 50).toFixed(1)} ms, own JS ${time(0, b, 50).toFixed(1)} ms, wasm ${time(0, c, 50).toFixed(1)} ms`);
}
fs.rmSync(stage, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
