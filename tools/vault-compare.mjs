// Behavioural differential test of the vault model: the ORIGINAL classes (TAbstractFile/TFile/TFolder, Vault, FileSystemAdapter and
// the FileManager methods, cut out of the minified bundle at --base with exactly the helpers they use) and the NEW ones
// (src-app/vault.js) run the same scenario on identical temp directory trees; everything observable is logged and must be identical:
// results, error messages, vault events and their order, the vault tree afterwards, the adapter's `files` table, what is on disk.
//   node tools/vault-compare.mjs [--base e011f31] [--only name,name] [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadBundle } from "./split-app.mjs";
import { loadBase } from "./app-base.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt("--base", "e011f31"); // revision whose app.js still holds the original classes (with Basalt's own patches)
const ONLY = opt("--only", null)?.split(",");
const nodeRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------- what the app defines on built-ins and globally
const def = (t, n, v) => { if (!t[n]) Object.defineProperty(t, n, { value: v, enumerable: false, configurable: true, writable: true }); };
def(Array.prototype, "contains", Array.prototype.includes);
def(Array.prototype, "remove", function (item) { for (let i = this.length - 1; i >= 0; i--) if (this[i] === item) this.splice(i, 1); });
def(Array.prototype, "first", function () { if (this.length) return this[0]; });
def(Array.prototype, "last", function () { if (this.length) return this[this.length - 1]; });
def(Array.prototype, "unique", function () { return Array.from(new Set(this)); });
def(String, "isString", (v) => typeof v === "string" || v instanceof String);
def(String.prototype, "contains", String.prototype.includes);
globalThis.activeWindow = globalThis;

// A fake `window` for the adapter: node's fs, a trash that moves things out of the vault, no btime.
const trashDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-trash-"));
let trashN = 0, runId = 0;
globalThis.window = {
  process,
  require(name) {
    if (name === "original-fs") return nodeRequire("fs");
    if (name === "electron") return { ipcRenderer: { sendSync(channel, p) { if (channel !== "trash") return false; fs.renameSync(p, path.join(trashDir, "run" + runId + "-" + String(trashN++) + "-" + path.basename(p))); return true; } } };
    if (name === "btime") throw new Error("no btime");
    return nodeRequire(name);
  },
};

// ---------------------------------------------------------------- the ORIGINAL code, cut from the base revision
const baseOrig = loadBase("ca5acac"); // untouched bundle: original helper bodies
const baseText = execFileSync("git", ["show", `${BASE}:src/app.js`], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
const tmpFile = path.join(os.tmpdir(), "vc-base-app.js");
fs.writeFileSync(tmpFile, baseText);
const bundle = loadBundle(tmpFile);
const decl = new Map();
for (const n of bundle.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.init) decl.set(d.id.name, baseText.slice(d.start, d.end));
const declText = (name) => { if (!decl.has(name)) throw new Error("base has no var " + name); return decl.get(name); };

const helperNames = ["w", "f", "y", "b", "m", "v", "k", "E", "C", "M", "wc", "nu", "iu", "ou", "au", "su", "lu", "cu", "uu", "ru", "tu", "mu", "vu", "gu", "oc", "KT", "GT", "ET", "IT", "LT"];
const origFile = path.join(os.tmpdir(), "vc-orig-app.js");
fs.writeFileSync(origFile, baseOrig.src);
const origDecl = new Map();
for (const n of loadBundle(origFile).body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.init) origDecl.set(d.id.name, "var " + baseOrig.src.slice(d.start, d.end) + ";");
// plus, transitively, every top-level var of the untouched bundle that their text mentions (regexes, tables)
const SKIP_VARS = new Set(["Ul", "zT", "qT", "UT", "_T", "wu", "ku", "Cu", "VT", "vb", "YT", "rc", ...helperNames]);
const extraVars = new Map();
(function collect(text) {
  for (const id of new Set(text.match(/[A-Za-z_$][\w$]*/g) || [])) {
    if (SKIP_VARS.has(id) || extraVars.has(id) || !origDecl.has(id)) continue;
    if (origDecl.get(id).length > 400 || origDecl.get(id).includes("function")) continue; // only small literal tables/regexes
    extraVars.set(id, origDecl.get(id));
    collect(origDecl.get(id));
  }
})(helperNames.map((n) => baseOrig.fn(n) || origDecl.get(n) || "").join("\n"));
const funcsText = [...extraVars.values()].join("\n") + "\n" + helperNames.map((n) => { const t = baseOrig.fn(n) || origDecl.get(n); if (!t) throw new Error("no function " + n); return t; }).join("\n");
const prelude = `
var Ul = process.platform === "win32";
var rc = /[\\\\^$.*+?()[\\]{}|]/g;
${funcsText}
var zT = Ul ? '*"\\\\/<>:|?' : "\\\\/:";
var qT = zT.split("").join(" ");
var UT = new RegExp("[" + oc(zT) + "]");
var _T = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
var wu = process.platform === "darwin", ku = process.platform === "win32", Cu = wu || ku;
${declText("VT")};
${declText("vb")};
var YT = ".basalt";
`;
// the declarators in source order: the file model + vault, the adapter, the file manager
const classCode = ["QT", "XT", "$T", "ZT", "JT", "Eu", "mI"].map(declText).map((t) => "var " + t.replace(/^\$T=/, "$T=")).join(";\n");

const Yl = { isDesktopApp: true, resourcePathPrefix: "file:///" };
const AC = ["theme", "baseFontSize", "cssTheme"];
const PC = { newFileLocation: "root", newFileFolderPath: "", attachmentFolderPath: "/", alwaysUpdateLinks: false, trashOption: "system", promptDelete: true };
const gm = { plugins: { fileExplorer: { labelUntitledFile: () => "Untitled", labelUntitledFolder: () => "Untitled folder", msgInvalidCharacters: () => "Invalid characters: " } } };
const If = (name) => nodeRequire(name);

const factory = new Function("Yl", "AC", "PC", "gm", "If", "$ORIG", `${prelude}\n${classCode.replace(/\bvar (\w+|\$T)=/g, "var $1=")};\nreturn { TAbstractFile: QT, TFile: $T, TFolder: ZT, Vault: JT, FileSystemAdapter: Eu, FileManager: mI, wc, KT, GT, vb, UT, qT };`);
const orig = factory(Yl, AC, PC, gm, If, null);

// ---------------------------------------------------------------- the NEW code
const V = await import(pathToFileURL(path.join(root, "src-app/vault.js")).href);
V.bindEnv(() => ({ Yl, If, UT: orig.UT, KT: orig.KT, AC, PC, debounce: orig.wc, gm, GT: orig.GT, qT: orig.qT, vb: orig.vb }));
const NewAdapter = V.createFileSystemAdapter();
const fresh = {
  TAbstractFile: V.fileClass("TAbstractFile"), TFile: V.fileClass("TFile"), TFolder: V.fileClass("TFolder"),
  FileSystemAdapter: NewAdapter, Vault: V.createVault(orig.VT_for_new ?? eventsClass(), NewAdapter),
  FileManager: null,
};
function eventsClass() { return new Function(`${prelude}; return VT;`)(); }
// New FileManager = a second copy of the original class with our methods put over it (what the build does to the bundle text)
const NewFM = new Function("Yl", "AC", "PC", "gm", "If", `${prelude}\n${classCode};\nreturn mI;`)(Yl, AC, PC, gm, If);
for (const [key, fn] of Object.entries({
  getMarkdownNewFileParent: V.fmMarkdownNewFileParent, getNewFileParent: V.fmNewFileParent, registerFileParentCreator: V.fmRegisterFileParentCreator, unregisterFileCreator: V.fmUnregisterFileCreator,
  canCreateFileWithExt: V.fmCanCreateFileWithExt, createNewMarkdownFileFromLinktext: V.fmCreateNewMarkdownFileFromLinktext, createNewMarkdownFile: V.fmCreateNewMarkdownFile, createNewFile: V.fmCreateNewFile,
  createNewFolder: V.fmCreateNewFolder, renameFile: V.fmRenameFile, runAsyncLinkUpdate: V.fmRunAsyncLinkUpdate, trashFile: V.fmTrashFile, getAvailablePathForAttachment: V.fmGetAvailablePathForAttachment,
})) NewFM.prototype[key] = fn;
fresh.FileManager = NewFM;

// ---------------------------------------------------------------- scenario machinery
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => (typeof s === "string" ? s : s);
function describeItem(x) { return x == null ? x : x.constructor && x.path !== undefined ? `${x instanceof fileTypes.TFolder ? "folder" : "file"}:${x.path}` : x; }
let fileTypes = null;

async function runScenario(impl, scenario) {
  fileTypes = impl;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-vault-"));
  trashN = 0; runId++;
  const log = [];
  const scrub = (m) => m.replace(dir, "<dir>").replace(/[A-Za-z]:[^']*?vc-(?:vault|trash)-\w+(?:\\run\d+-\d+)?/g, "<tmp>");
  const rec = (...a) => log.push(a.map((x) => (x instanceof Error ? `Error(${x.code || ""}:${scrub(x.message)})` : x)));
  try {
    scenario.setup?.(dir);
    const adapter = new impl.FileSystemAdapter(dir);
    const vault = new impl.Vault(adapter);
    const events = [];
    for (const name of ["create", "modify", "delete", "rename", "closed", "config-changed"]) {
      vault.on(name, (item, old) => events.push([name, item && item.path !== undefined ? item.path : item, old]));
    }
    await vault.setupConfig?.call(vault).catch((e) => rec("setupConfig failed", e));
    await vault.load();
    await sleep(100);
    // the initial scan runs concurrently: its order is up to the disk, so compare it as a set
    rec("scan", events.splice(0).map((e) => JSON.stringify(e)).sort());
    const fm = new impl.FileManager({ vault, metadataCache: { onCleanCache: (cb) => cb(), iterateAllRefs: () => {}, getLinkpathDest: () => [] }, workspace: { getActiveFile: () => null } });
    const ctx = {
      dir, vault, adapter, fm, impl, rec, events,
      step: async (label, fn) => {
        let result;
        try { result = await fn(); rec(label, "ok", describeItem(result)); } catch (e) { rec(label, "throws", e); }
        await settle(vault);
        const ev = events.splice(0);
        if (/copy|folder|external|symlink/.test(label)) ev.sort(); // these walk a whole tree concurrently: the order is up to the disk
        rec("  events", ev.map((e) => JSON.stringify(e)));
      },
      sync: (label, fn) => { let r; try { r = fn(); } catch (e) { r = e; } rec(label, r instanceof Error ? r : describeItem(r)); },
    };
    await scenario.run(ctx);
    await settle(vault);
    await sleep(150);
    await settle(vault);
    rec("late events", events.splice(0).map((e) => JSON.stringify(e)));
    rec("tree", treeOf(vault));
    rec("adapter.files", Object.keys(adapter.files).sort().map((k) => `${k}=${adapter.files[k].type}:${adapter.files[k].realpath}`));
    rec("disk", diskOf(dir));
    rec("fileMap", Object.keys(vault.fileMap).sort());
    adapter.stopWatch();
  } finally {
    await sleep(50);
    if (!argv.includes("--keep")) fs.rmSync(dir, { recursive: true, force: true });
  }
  return log;
}
async function settle(vault) {
  await sleep(120);
  for (let i = 0; i < 3; i++) await vault.adapter.queue(() => Promise.resolve());
}
function treeOf(vault) {
  const lines = [];
  (function walk(folder, indent) {
    for (const c of [...folder.children].sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0))) {
      lines.push(indent + (c.children ? "D " : "F ") + c.name + " | " + c.path + (c.children ? "" : ` | ${c.basename}.${c.extension} deleted=${c.deleted} parent=${c.parent && c.parent.path}`));
      if (c.children) walk(c, indent + "  ");
    }
  })(vault.getRoot(), "");
  return lines;
}
function diskOf(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      const full = path.join(d, n);
      const st = fs.lstatSync(full);
      out.push(rel + n + (st.isDirectory() ? "/" : st.isSymbolicLink() ? "@" : ` (${st.size})`));
      if (st.isDirectory()) walk(full, rel + n + "/");
    }
  })(dir, "");
  return out;
}

// ---------------------------------------------------------------- scenarios
const w = (dir, rel, text = "") => { const p = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const scenarios = [
  {
    name: "create-modify-read",
    setup(dir) { w(dir, "existing.md", "# hi\n"); w(dir, "folder/inner.md", "inner"); w(dir, ".hidden/secret.md", "s"); },
    async run(c) {
      const { vault, step } = c;
      await step("create a.md", () => vault.create("a.md", "alpha"));
      await step("create again", () => vault.create("a.md", "again"));
      await step("create no parent", () => vault.create("nodir/b.md", "x"));
      await step("create in folder", () => vault.create("folder/b.md", "bee"));
      await step("create py", () => vault.create("script.py", "print(1)"));
      await step("create canvas", () => vault.create("board.canvas", "{}"));
      await step("create session", () => vault.create("tmp.session", "{}"));
      await step("create no ext", () => vault.create("README", "r"));
      await step("create double ext", () => vault.create("arch.tar.gz", "r"));
      await step("create unicode", () => vault.create("Заметка 日本語 😀.md", "u"));
      await step("create NFD name", () => vault.create("café.md", "u"));
      await step("create bad char", () => vault.create(process.platform === "win32" ? "bad*name.md" : "bad\\name.md", "x"));
      await step("create trailing dot", () => vault.create("dot.", "x"));
      await step("create CON", () => vault.create("con.md", "x"));
      await step("create binary", () => vault.createBinary("bin.dat", new Uint8Array([1, 2, 3, 250]).buffer));
      await step("create folder", () => vault.createFolder("newfolder/deeper"));
      await step("create folder again", () => vault.createFolder("newfolder"));
      const a = vault.getFileByPath("a.md");
      await step("read", () => vault.read(a));
      await step("cachedRead", () => vault.cachedRead(a));
      c.sync("cacheState", () => a.stat && a.stat.size);
      await step("modify", () => vault.modify(a, "alpha2"));
      await step("cachedRead2", () => vault.cachedRead(a));
      await step("modify mtime", () => vault.modify(a, "alpha3", { mtime: 1700000000000 }));
      c.sync("stat after", () => a.stat.mtime);
      await step("append", () => vault.append(a, "+more"));
      await step("read after append", () => vault.read(a));
      await step("process same", () => vault.process(a, (t) => t));
      await step("process change", () => vault.process(a, (t) => t.toUpperCase()));
      await step("cachedRead3", () => vault.cachedRead(a));
      await step("modifyBinary", () => vault.modifyBinary(vault.getFileByPath("bin.dat"), new Uint8Array([9, 9]).buffer));
      await step("appendBinary", () => vault.appendBinary(vault.getFileByPath("bin.dat"), new Uint8Array([7]).buffer));
      await step("readBinary", () => vault.readBinary(vault.getFileByPath("bin.dat")).then((b) => Array.from(new Uint8Array(b)).join(",")));
      await step("readRaw", () => vault.readRaw("a.md"));
      await step("bom", async () => { fs.writeFileSync(path.join(c.dir, "bom.md"), "﻿bom text"); await sleep(100); return vault.read(vault.getFileByPath("bom.md")); });
      await step("modify missing", () => vault.modify(Object.assign(Object.create(Object.getPrototypeOf(a)), a, { path: "gone/none.md" }), "x"));
      await step("exists", () => vault.exists("A.MD"));
      await step("exists cs", () => vault.exists("A.MD", true));
      c.sync("lookups", () => [vault.getAbstractFileByPath("a.md")?.path, vault.getAbstractFileByPath("A.md"), vault.getAbstractFileByPathInsensitive("A.MD")?.path, vault.getFolderByPath("folder")?.path, vault.getFileByPath("folder"), vault.getFileByPath("hasOwnProperty")].join("|"));
      c.sync("insensitive ties", () => { // fake events: two paths that differ only by case (possible on a case-sensitive disk), and keys whose lower case changes length
        for (const p of ["Tie.md", "tie.md", "TIE.md", "İdx.md", "123", "9", "ǅ.md"]) vault.onChange("file-created", p, undefined, {});
        const out = ["TIE.MD", "tie.MD", "tİe.md", "idx.md", "i̇dx.md", "İDX.md", "123", "9", "ǆ.md", "Ǆ.md", "nope"].map((p) => vault.getAbstractFileByPathInsensitive(p)?.path);
        vault.onChange("file-removed", "Tie.md");
        out.push(vault.getAbstractFileByPathInsensitive("TIE.MD")?.path);
        for (const p of ["Tie.md", "tie.md", "TIE.md", "İdx.md", "123", "9", "ǅ.md"]) vault.onChange("file-removed", p);
        out.push(vault.getAbstractFileByPathInsensitive("TIE.MD")?.path);
        return out.join("|");
      });
      c.sync("avail", () => [vault.getAvailablePath("a", "md"), vault.getAvailablePath("Untitled", "md"), vault.getAvailablePath("folder", ""), vault.getAvailablePath("x/y", "md")].join("|"));
      c.sync("lists", () => [vault.getFiles().map((f) => f.path).sort().join(","), vault.getMarkdownFiles().map((f) => f.path).sort().join(","), vault.getAllFolders().map((f) => f.path).sort().join(","), vault.getAllFolders(true).map((f) => f.path).sort().join(","), vault.getAllLoadedFiles().length, vault.isEmpty(), vault.getName().replace(/vc-vault-[\w-]+/, "<dir>")].join("|"));
      c.sync("counts", () => [vault.getRoot().getFileCount(), vault.getRoot().getFolderCount(), vault.getRoot().getParentPrefix(), vault.getFolderByPath("folder").getParentPrefix(), vault.getRoot().isRoot()].join("|"));
      c.sync("file props", () => { const f = vault.getFileByPath("arch.tar.gz"); return [f.name, f.basename, f.extension, f.getShortName(), String(f), vault.getFileByPath("a.md").getShortName()].join("|"); });
      c.sync("config", () => { vault.setConfig("theme", "moonstone"); vault.setConfig("zzz", [1]); const z = vault.getConfig("zzz"); z.push(2); return [vault.getConfig("theme"), JSON.stringify(vault.getConfig("zzz")), vault.getConfig("trashOption"), vault.getConfig("nope")].join("|"); });
      c.sync("configDir", () => { vault.setConfigDir("bad/.x"); const a1 = vault.configDir; vault.setConfigDir("."); const a2 = vault.configDir; vault.setConfigDir(".cfg"); return [a1, a2, vault.configDir, vault.getConfigFile("app"), c.impl.Vault.validateConfigDir(".ok"), c.impl.Vault.validateConfigDir("no")].join("|"); });
      await step("save config", () => vault.saveConfig());
      await step("config json", () => vault.readConfigJson("app"));
      await step("config json missing", () => vault.readConfigJson("nothing"));
      await step("plugin data", async () => { await vault.writePluginData(".cfg/plugins/p", { a: 1 }); return JSON.stringify(await vault.readPluginData(".cfg/plugins/p")); });
      await step("generate", async () => { const out = []; for await (const { file, content } of vault.generateFiles(vault.getFiles().filter((f) => ["md", "canvas", "py"].includes(f.extension)), false)) out.push(file.path + ":" + content.length); return out.sort().join(","); });
      await step("iterate", async () => { const out = []; for await (const { file, content } of vault.iterateFiles(vault.getMarkdownFiles(), true)) out.push(file.path + ":" + content.length); return out.sort().join(","); });
      c.sync("resource path", () => vault.getResourcePath(a).replace(/\?\d+$/, "?T").replace(c.dir.replace(/\\/g, "/"), "<dir>"));
      c.sync("resolveFilePath", () => vault.resolveFilePath(path.join(c.dir, "a.md"))?.path);
      c.sync("resolveFileUrl", () => vault.resolveFileUrl(c.adapter.getResourcePath("a.md"))?.path);
    },
  },
  {
    name: "rename-move-delete",
    setup(dir) { w(dir, "n.md", "n"); w(dir, "tree/one.md", "1"); w(dir, "tree/sub/two.py", "2"); w(dir, "tree/sub/deep/three.canvas", "3"); w(dir, "other/keep.md", "k"); w(dir, "Case.md", "c"); w(dir, "folderCase/x.md", "x"); },
    async run(c) {
      const { vault, step } = c;
      const f = (p) => vault.getAbstractFileByPath(p);
      await step("rename file", () => vault.rename(f("n.md"), "m.md"));
      await step("rename same", () => vault.rename(f("m.md"), "m.md"));
      await step("rename onto existing", () => vault.rename(f("m.md"), "Case.md"));
      await step("rename case only", () => vault.rename(f("Case.md"), "case.md"));
      await step("rename case only 2", () => vault.rename(f("case.md"), "CASE.md"));
      await step("rename folder case only", () => vault.rename(f("folderCase"), "FolderCase"));
      await step("rename folder with kids", () => vault.rename(f("tree"), "forest"));
      await step("move file into folder", () => vault.rename(f("m.md"), "other/m.md"));
      await step("move folder inside", () => vault.rename(f("forest/sub"), "other/sub"));
      await step("rename to unicode", () => vault.rename(f("other/m.md"), "other/Ёж 日本.md"));
      await step("rename bad char", () => vault.rename(f("other/keep.md"), process.platform === "win32" ? "other/k*.md" : "other/k\\.md"));
      await step("rename missing", () => vault.rename(Object.assign(Object.create(Object.getPrototypeOf(f("other/keep.md"))), f("other/keep.md"), { path: "nowhere.md" }), "x.md"));
      c.sync("newPath", () => {
        const file = f("other/keep.md"); const folder = f("other"); const root = vault.getRoot();
        return [file.getNewPathAfterRename("k2"), file.getNewPathAfterRename("k2.txt"), file.getNewPathAfterRename("k2.py"), file.getNewPathAfterRename("  spaced  "), file.getNewPathAfterRename("tab\tname"), file.getNewPathAfterRename("a.b.c"),
          file.getNewPathAfterRename("noext."), file.getNewPathAfterRename(".hidden"), file.getNewPathAfterRename("x.verylongextension1"), file.getNewPathAfterRename("x.canvas"), file.getNewPathAfterRename("x.session"), file.getNewPathAfterRename("日本.語"),
          folder.getNewPathAfterRename("fold.er"), folder.getNewPathAfterRename("\u0001z"), root.getNewPathAfterRename("x"), f("other/Ёж 日本.md").getNewPathAfterRename("Q"), vault.checkForDuplicate(file, "keep"), !!vault.checkForDuplicate(f("other/sub/two.py"), "keep.md"),
          vault.checkForDuplicate(f("other/sub/two.py"), "two")].join("|");
      });
      await step("copy file", () => vault.copy(f("other/keep.md"), "other/keep copy.md"));
      await step("copy folder", () => vault.copy(f("other/sub"), "copied"));
      await step("copy onto existing", () => vault.copy(f("other/keep.md"), "other/keep copy.md"));
      await step("delete file", () => vault.delete(f("other/keep copy.md")));
      await step("delete non-empty folder no force", () => vault.delete(f("copied")));
      await step("delete folder force", () => vault.delete(f("copied"), true));
      await step("delete root", () => vault.delete(vault.getRoot()));
      await step("delete null", () => vault.delete(null));
      await step("trash local", () => vault.trash(f("other/keep.md"), false));
      await step("trash system", () => vault.trash(f("other/Ёж 日本.md"), true));
      await step("trash folder local", () => vault.trash(f("other/sub"), false));
      await step("trash local same name", async () => { await vault.create("keep.md", "k2"); return vault.trash(f("keep.md"), false); });
      await step("trash local same name 2", async () => { await vault.create("keep.md", "k3"); return vault.trash(f("keep.md"), false); });
      await step("trash root", () => vault.trash(vault.getRoot(), true));
      c.sync("deleted flags", () => [vault.getAbstractFileByPath("keep.md"), vault.getAbstractFileByPath("other/keep.md")].join("|"));
    },
  },
  {
    name: "external-changes-and-odd-names",
    setup(dir) { w(dir, "base.md", "b"); w(dir, "dirA/x.md", "x"); },
    async run(c) {
      const { vault, step, dir } = c;
      const P = (...p) => path.join(dir, ...p);
      await step("external create", async () => { fs.writeFileSync(P("ext.md"), "e"); await sleep(250); });
      await step("external modify", async () => { fs.writeFileSync(P("ext.md"), "e longer"); await sleep(250); });
      await step("external folder", async () => { fs.mkdirSync(P("extdir", "nested"), { recursive: true }); fs.writeFileSync(P("extdir", "nested", "n.md"), "n"); await sleep(300); });
      await step("external remove file", async () => { fs.unlinkSync(P("ext.md")); await sleep(400); });
      await step("external rename file", async () => { fs.renameSync(P("base.md"), P("base2.md")); await sleep(500); });
      await step("external remove folder", async () => { fs.rmSync(P("dirA"), { recursive: true }); await sleep(500); });
      await step("external hidden", async () => { fs.mkdirSync(P(".hid")); fs.writeFileSync(P(".hid", "h.md"), "h"); fs.writeFileSync(P(".dot.md"), "h"); await sleep(250); });
      await step("external odd ext", async () => { for (const n of ["a.py", "b.canvas", "c.session", "d.", "e.verylongextension", "f", "g.MD", ".h"]) fs.writeFileSync(P(n), n); await sleep(300); });
      await step("long name", () => vault.create("l".repeat(120) + ".md", "long"));
      await step("deep path", async () => { const deep = Array.from({ length: 8 }, (_, i) => "d".repeat(20) + i).join("/"); await vault.createFolder(deep); return vault.create(deep + "/leaf.md", "leaf"); });
      let linked = true;
      try { fs.symlinkSync(P("extdir"), P("linkdir"), "junction"); } catch { linked = false; }
      await step("symlink dir", async () => { await sleep(400); });
      if (linked) {
        await step("update symlink dir", () => vault.adapter.update("linkdir"));
        await step("create via symlink", () => vault.create("linkdir/viaLink.md", "v"));
        await step("rename symlink dir", () => vault.rename(vault.getAbstractFileByPath("linkdir"), "linkdir2"));
      }
      let fileLinked = true;
      try { fs.symlinkSync(P("a.py"), P("link.py"), "file"); } catch { fileLinked = false; }
      await step("symlink file", async () => { await sleep(400); if (fileLinked) await vault.adapter.update("link.py"); });
      await step("dangling symlink", async () => { try { fs.symlinkSync(P("missing-target.md"), P("dangling.md"), "file"); } catch { /* needs privileges */ } await sleep(300); await vault.adapter.update("dangling.md"); });
      await step("adapter stat", async () => [JSON.stringify(await vault.adapter.stat("a.py")).replace(/"(ctime|mtime)":\d+/g, '"$1":N'), JSON.stringify(await vault.adapter.stat("extdir")).replace(/"(ctime|mtime)":\d+/g, '"$1":N'), JSON.stringify(await vault.adapter.stat("nope"))].join("|"));
      await step("adapter list", async () => JSON.stringify(Object.fromEntries(Object.entries(await vault.adapter.list("")).map(([k, v]) => [k, v.sort()]))));
      await step("adapter list sub", async () => JSON.stringify(await vault.adapter.list("extdir")));
      await step("adapter list missing", () => vault.adapter.list("zzz"));
      await step("adapter exists", async () => [await vault.adapter.exists("a.py"), await vault.adapter.exists("A.PY"), await vault.adapter.exists("A.PY", true), await vault.adapter.exists("none")].join(","));
      await step("adapter rename existing", () => vault.adapter.rename("a.py", "b.canvas"));
      await step("adapter remove missing", () => vault.adapter.remove("nonexistent.md"));
      await step("adapter rmdir non-empty", () => vault.adapter.rmdir("extdir", false));
      await step("adapter mkdir", () => vault.adapter.mkdir("m1/m2/m3"));
      await step("adapter write ctime", () => vault.adapter.write("m1/w.md", "w", { mtime: 1600000000000, ctime: 1500000000000, immediate: () => c.rec("immediate called") }));
      await step("adapter process", () => vault.adapter.process("m1/w.md", (t) => t + "!"));
      await step("adapter read missing", () => vault.adapter.read("m1/none.md"));
      await step("adapter readBinary missing", () => vault.adapter.readBinary("m1/none.md"));
      c.sync("adapter paths", () => [vault.adapter.getBasePath() === dir, vault.adapter.getName() === path.basename(dir), vault.adapter.getRealPath("linkdir/x"), vault.adapter.getFullPath("m1/w.md") === P("m1", "w.md"), vault.adapter.getFilePath("m1/w.md").replace(/^file:\/\/.*vc-vault-[^/]*/, "file://<dir>"), vault.adapter.insensitive].join("|"));
      await step("adapter trashLocal", () => vault.adapter.trashLocal("m1/w.md"));
      await step("adapter trashSystem", () => vault.adapter.trashSystem("m1/m2"));
      await step("adapter trashSystem missing", () => vault.adapter.trashSystem("m1/missing"));
    },
  },
  {
    name: "file-manager",
    setup(dir) { w(dir, "Untitled.md", "u"); w(dir, "notes/in.md", "i"); w(dir, "attach/x.png", "p"); },
    async run(c) {
      const { vault, fm, step } = c;
      c.sync("parents", () => [fm.getNewFileParent("notes/in.md").path, fm.getNewFileParent("", "x.md").path, fm.canCreateFileWithExt("md"), fm.canCreateFileWithExt("py"), fm.canCreateFileWithExt(""), fm.canCreateFileWithExt("canvas")].join("|"));
      fm.registerFileParentCreator("py", () => vault.getFolderByPath("notes"));
      c.sync("parents 2", () => [fm.getNewFileParent("", "x.py").path, fm.canCreateFileWithExt("py"), fm.getNewFileParent("", "x.unknown").path].join("|"));
      vault.setConfig("newFileLocation", "folder"); vault.setConfig("newFileFolderPath", "notes");
      c.sync("parents folder", () => [fm.getNewFileParent("", "q.md").path, fm.getMarkdownNewFileParent("").path].join("|"));
      vault.setConfig("newFileFolderPath", "missing");
      c.sync("parents folder missing", () => fm.getNewFileParent("", "q.md").path);
      vault.setConfig("newFileLocation", "current");
      c.sync("parents current", () => [fm.getNewFileParent("notes/in.md", "q.md").path, fm.getNewFileParent("loose.md", "q.md").path, fm.getNewFileParent("nodir/x.md", "q.md").path].join("|"));
      vault.setConfig("newFileLocation", "root");
      await step("new md untitled", () => fm.createNewMarkdownFile(null, undefined));
      await step("new md untitled 2", () => fm.createNewMarkdownFile(null, ""));
      await step("new md named", () => fm.createNewMarkdownFile(vault.getFolderByPath("notes"), "Fresh"));
      await step("new md named ext", () => fm.createNewMarkdownFile(vault.getFolderByPath("notes"), "Fresh.md", "content"));
      await step("new md path name", () => fm.createNewMarkdownFile(null, "auto/made/folders/Deep"));
      await step("new md dup", () => fm.createNewMarkdownFile(null, "Untitled"));
      await step("new md spaces", () => fm.createNewMarkdownFile(null, "  padded name  "));
      await step("new md bad", () => fm.createNewMarkdownFile(null, process.platform === "win32" ? "bad*" : "bad\\"));
      await step("new file py", () => fm.createNewFile(null, "tool", "py", "x=1"));
      await step("new file unknown ext", () => fm.createNewFile(null, "weird", "xyz"));
      await step("new file ext from name", () => fm.createNewFile(null, "script.py"));
      await step("new file canvas", () => fm.createNewFile(null, "board", "canvas", "{}"));
      await step("from linktext", () => fm.createNewMarkdownFileFromLinktext("Link Target", "notes/in.md"));
      await step("from linktext path", () => fm.createNewMarkdownFileFromLinktext("sub/Link2", "notes/in.md"));
      await step("from linktext invalid", () => fm.createNewMarkdownFileFromLinktext("bad#name", "notes/in.md"));
      await step("new folder", () => fm.createNewFolder(null));
      await step("new folder 2", () => fm.createNewFolder(vault.getRoot()));
      await step("new folder in", () => fm.createNewFolder(vault.getFolderByPath("notes")));
      await step("rename file", () => fm.renameFile(vault.getFileByPath("Untitled.md"), "Renamed.md"));
      await step("rename folder", () => fm.renameFile(vault.getFolderByPath("notes"), "notes2"));
      await step("rename throws", () => fm.renameFile(vault.getFileByPath("Renamed.md"), "notes2"));
      await step("rename after throw", () => fm.renameFile(vault.getFileByPath("Renamed.md"), "Renamed2.md"));
      await step("nested link update", () => fm.runAsyncLinkUpdate(async () => { await fm.renameFile(vault.getFileByPath("Renamed2.md"), "Nested.md"); return 1; }));
      for (const opt of ["system", "local", "none", "weird"]) {
        vault.setConfig("trashOption", opt);
        await step("trashFile " + opt, async () => { const f = await vault.create("t-" + opt + ".md", "t"); await fm.trashFile(f); return vault.getAbstractFileByPath("t-" + opt + ".md"); });
      }
      vault.setConfig("attachmentFolderPath", "attach");
      await step("attachment path", () => fm.getAvailablePathForAttachment("x.png"));
      await step("attachment path src", () => fm.getAvailablePathForAttachment("pic [1]#a.png", "notes2/in.md"));
      vault.setConfig("attachmentFolderPath", "./media");
      await step("attachment rel", () => fm.getAvailablePathForAttachment("y.png", "notes2/in.md"));
      vault.setConfig("attachmentFolderPath", "./");
      await step("attachment next to note", () => fm.getAvailablePathForAttachment("z.png", "notes2/in.md"));
      vault.setConfig("attachmentFolderPath", "/");
      await step("attachment root", () => fm.getAvailablePathForAttachment("z.png"));
    },
  },
];

function diffCut(a = "", b = "") { let i = 0; while (i < a.length && a[i] === b[i]) i++; const from = Math.max(0, i - 40); return [a.slice(from, i + 160), b.slice(from, i + 160)]; }
// ---------------------------------------------------------------- --bench: old vs new on a big tree
if (argv.includes("--bench")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bench-"));
  const FILES = +opt("--files", 20000);
  for (let d = 0; d < 200; d++) { fs.mkdirSync(path.join(dir, "folder" + d)); for (let f = 0; f < FILES / 200; f++) fs.writeFileSync(path.join(dir, "folder" + d, "Note number " + f + ".md"), "x"); }
  for (const [name, impl] of [["original", orig], ["own", fresh], ["original", orig], ["own", fresh]]) {
    const t0 = performance.now();
    const adapter = new impl.FileSystemAdapter(dir);
    const vault = new impl.Vault(adapter);
    await vault.load();
    const t1 = performance.now();
    let hit = 0;
    for (let i = 0; i < 500; i++) if (vault.getAbstractFileByPathInsensitive("FOLDER" + (i % 200) + "/note NUMBER " + (i % 100) + ".MD")) hit++;
    const t2 = performance.now();
    const n = vault.getFiles().length;
    const t3 = performance.now();
    console.log(name.padEnd(8), "scan+load", (t1 - t0).toFixed(0), "ms,", n, "files; 500 insensitive lookups", (t2 - t1).toFixed(0), "ms (" + hit + " hits); getFiles", (t3 - t2).toFixed(1), "ms");
    adapter.stopWatch();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
// ---------------------------------------------------------------- run
let failed = 0;
for (const sc of scenarios) {
  if (ONLY && !ONLY.includes(sc.name)) continue;
  const a = await runScenario(orig, sc);
  const b = await runScenario(fresh, sc);
  const sa = a.map((x) => JSON.stringify(x)), sb = b.map((x) => JSON.stringify(x));
  let bad = 0;
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) { bad++; if (bad <= 6) console.log(`  [${sc.name}] line ${i}\n    orig: ${sa[i]}\n    new : ${sb[i]}`); }
  }
  console.log(`${bad ? "FAIL" : "ok  "} ${sc.name}: ${sa.length} log lines${bad ? `, ${bad} differ` : ""}`);
  if (bad) failed++;
}
process.exit(failed ? 1 : 0);
