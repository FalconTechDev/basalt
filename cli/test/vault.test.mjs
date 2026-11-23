import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeVault, cli, rm, put, get } from "./helpers.mjs";
import { getProperties, setProperty, extractLinks, extractTags } from "../lib/md.mjs";

const V = () => makeVault({
  "Alpha.md": "---\ntags: [x, project/a]\nstatus: open\n---\n# Alpha\nsee [[Beta]] and [[Missing]] ![[pic.png]] #todo\n```\n[[inCode]]\n```\n",
  "notes/Beta.md": "# Beta\nback [[Alpha#h|al]] [md](../Alpha.md) [[notes/Beta]]\n",
  "pic.png": "x", "Empty.md": "", "dup/Beta.md": "dup",
});

test("md helpers: frontmatter round trip keeps other lines", () => {
  const t = "---\ntags: [a]\ntitle: \"x: y\"\nn: 3\n---\nbody\n";
  assert.deepEqual(getProperties(t), { tags: ["a"], title: "x: y", n: 3 });
  assert.equal(setProperty(t, "n", undefined), "---\ntags: [a]\ntitle: \"x: y\"\n---\nbody\n");
  assert.match(setProperty(t, "list", ["a", "b c"]), /list:\n {2}- a\n {2}- b c\n---/);
  assert.equal(setProperty("plain\n", "k", "v"), "---\nk: v\n---\nplain\n");
  assert.deepEqual(extractTags("#a #b/c `#no` 12 #1"), ["a", "b/c"]);
  assert.equal(extractLinks("`[[x]]` [[y]]").length, 1);
});

test("vault info, files, read, write, create", () => {
  const r = V();
  try {
    assert.equal(cli(r, ["vault", "info", "--json"]).json().notes, 4);
    assert.deepEqual(cli(r, ["files", "list", "--ext", "png", "--json"]).json().map((x) => x.path), ["pic.png"]);
    assert.equal(cli(r, ["files", "list", "--tag", "project"]).out.trim(), "Alpha.md");
    assert.equal(cli(r, ["files", "list", "--modified-since", "1h", "--ext", "md", "--json"]).json().length, 4);
    assert.match(cli(r, ["files", "tree"]).out, /notes\//);
    assert.equal(cli(r, ["read", "Alpha", "--lines", "5"]).out.trim(), "# Alpha");
    assert.match(cli(r, ["read", "Alpha", "--frontmatter"]).out, /status: open/);
    assert.equal(cli(r, ["write", "n/new", "--text", "hi"]).code, 0);
    assert.equal(get(r, "n/new.md"), "hi");
    cli(r, ["write", "n/new", "--append"], { input: "more" });
    assert.equal(get(r, "n/new.md"), "hi\nmore");
    cli(r, ["write", "Alpha", "--prepend", "--text", "TOP"]);
    assert.match(get(r, "Alpha.md"), /^---\n[\s\S]*---\nTOP\n# Alpha/);
    assert.equal(cli(r, ["write", "n/new", "--text", "x", "--no-overwrite"]).code, 1);
    put(r, "Templates/T.md", "# {{title}} {{date:YYYY}}");
    cli(r, ["create", "made", "--template", "T"]);
    assert.match(get(r, "made.md"), /^# made \d{4}$/);
    assert.equal(cli(r, ["create", "made"]).code, 1);
  } finally { rm(r); }
});

test("links, backlinks, unresolved, orphans, tags, outline, stats, properties", () => {
  const r = V();
  try {
    const l = cli(r, ["links", "Alpha", "--json"]).json();
    assert.equal(l.find((x) => x.target === "Beta").resolved, "dup/Beta.md".length ? l.find((x) => x.target === "Beta").resolved : null);
    assert.equal(l.find((x) => x.target === "Missing").resolved, null);
    assert.equal(l.find((x) => x.target === "pic.png").resolved, "pic.png");
    assert.ok(!l.some((x) => x.target === "inCode"));
    assert.equal(cli(r, ["backlinks", "Alpha", "--json"]).json()[0].from, "notes/Beta.md");
    assert.deepEqual(cli(r, ["unresolved", "--json"]).json().map((x) => x.target), ["Missing"]);
    assert.ok(cli(r, ["orphans"]).out.includes("Empty.md"));
    const tags = cli(r, ["tags", "--json"]).json().map((x) => x.tag);
    assert.ok(tags.includes("todo") && tags.includes("project/a"));
    assert.equal(cli(r, ["tags", "project"]).out.trim(), "Alpha.md");
    assert.equal(cli(r, ["outline", "Alpha", "--json"]).json()[0].text, "Alpha");
    assert.equal(cli(r, ["stats", "--json"]).json().notes, 4);
    assert.equal(cli(r, ["properties", "Alpha", "status"]).out.trim(), "open");
    cli(r, ["properties", "set", "Alpha", "status", "done"]);
    cli(r, ["properties", "set", "Alpha", "tags", "new", "--add"]);
    assert.deepEqual(cli(r, ["properties", "Alpha", "--json"]).json(), { tags: ["x", "project/a", "new"], status: "done" });
    cli(r, ["properties", "remove", "Alpha", "status"]);
    assert.equal(cli(r, ["properties", "Alpha", "status"]).code, 3);
    assert.match(get(r, "Alpha.md"), /# Alpha\nsee/);
  } finally { rm(r); }
});

test("search: text, regex, tag, property, context, json", () => {
  const r = V();
  try {
    assert.equal(cli(r, ["search", "BACK", "--json"]).json()[0].path, "notes/Beta.md");
    assert.equal(cli(r, ["search", "BACK", "--case", "--json"]).json().length, 0);
    assert.equal(cli(r, ["search", "se+ ", "--regex", "-l"]).out.trim(), "Alpha.md");
    assert.equal(cli(r, ["search", "--prop", "status=open", "-l"]).out.trim(), "Alpha.md");
    assert.equal(cli(r, ["search", "--prop", "status!=open", "-l"]).out.includes("Alpha.md"), false);
    assert.equal(cli(r, ["search", "--tag", "x", "-l"]).out.trim(), "Alpha.md");
    const m = cli(r, ["search", "# Alpha", "-C", "1", "--json"]).json()[0].matches[0];
    assert.equal(m.after.length, 1);
    assert.equal(cli(r, ["search"]).code, 2);
  } finally { rm(r); }
});

test("rename and move rewrite wikilinks, embeds, md links; dry run changes nothing", () => {
  const r = makeVault({
    "A.md": "[[B]] [[B#h|x]] ![[B]] [md](folder/B.md) [[folder/B]] `[[B]]`\n",
    "folder/B.md": "see [rel](../A.md) [[A]]\n",
    "C.canvas": JSON.stringify({ nodes: [{ id: "1", type: "file", file: "folder/B.md", x: 0, y: 0, width: 9, height: 9 }], edges: [] }),
  });
  try {
    const before = get(r, "A.md");
    const dry = cli(r, ["rename", "folder/B.md", "Z", "--dry-run", "--json"]);
    assert.equal(dry.json().dryRun, true); assert.equal(get(r, "A.md"), before); assert.ok(fs.existsSync(path.join(r, "folder/B.md")));
    assert.equal(cli(r, ["rename", "folder/B.md", "Z"]).code, 0);
    assert.equal(get(r, "A.md"), "[[Z]] [[Z#h|x]] ![[Z]] [md](folder/Z.md) [[folder/Z]] `[[B]]`\n");
    assert.equal(JSON.parse(get(r, "C.canvas")).nodes[0].file, "folder/Z.md");
    assert.equal(cli(r, ["move", "folder/Z.md", "deep/er/"]).code, 0);
    assert.equal(get(r, "A.md"), "[[Z]] [[Z#h|x]] ![[Z]] [md](deep/er/Z.md) [[deep/er/Z]] `[[B]]`\n");
    assert.equal(get(r, "deep/er/Z.md"), "see [rel](../../A.md) [[A]]\n");
    // folder move
    assert.equal(cli(r, ["move", "deep", "moved"]).code, 0);
    assert.match(get(r, "A.md"), /\(moved\/er\/Z\.md\)/);
    assert.equal(cli(r, ["check"]).code, 0);
    assert.equal(cli(r, ["move", "A", "moved/er/Z.md"]).code, 1);
  } finally { rm(r); }
});

test("delete goes to the trash, force removes", () => {
  const r = V();
  try {
    const d = cli(r, ["delete", "Empty", "--json"]).json();
    assert.equal(d.trashed, ".trash/Empty.md"); assert.ok(fs.existsSync(path.join(r, ".trash/Empty.md"))); assert.ok(!fs.existsSync(path.join(r, "Empty.md")));
    cli(r, ["write", "Empty", "--text", "again"]); cli(r, ["delete", "Empty"]);
    assert.ok(fs.existsSync(path.join(r, ".trash/Empty 1.md")));
    assert.equal(cli(r, ["delete", "pic.png", "--force"]).code, 0); assert.ok(!fs.existsSync(path.join(r, ".trash/pic.png")));
    assert.equal(cli(r, ["delete", "nope"]).code, 3);
  } finally { rm(r); }
});

test("daily note uses config and creates once", () => {
  const r = makeVault({}); put(r, ".basalt/daily-notes.json", JSON.stringify({ folder: "Daily", format: "YYYY/MM-DD" }));
  try {
    const p = cli(r, ["daily", "--date", "2026-03-05", "--json"]).json();
    assert.deepEqual([p.path, p.created], ["Daily/2026/03-05.md", true]);
    cli(r, ["daily", "--date", "2026-03-05", "--append", "- item"]);
    assert.equal(get(r, "Daily/2026/03-05.md"), "# 2026-03-05\n- item\n");
    assert.equal(cli(r, ["daily", "--date", "2026-03-05", "--json"]).json().created, false);
  } finally { rm(r); }
});

test("check: exit codes and options", () => {
  const r = V();
  try {
    const c = cli(r, ["check", "--json"]);
    assert.equal(c.code, 4); const j = c.json();
    assert.equal(j.broken.length, 1); assert.equal(j.empty[0], "Empty.md"); assert.equal(j.dupes[0].name, "beta");
    assert.equal(cli(r, ["check", "--only", "dupes"]).code, 0);
    assert.equal(cli(r, ["check", "--only", "dupes", "--fail-on", "dupes"]).code, 4);
    put(r, "Alpha.md", "ok\n"); assert.equal(cli(r, ["check", "--only", "broken"]).code, 0);
  } finally { rm(r); }
});

test("ergonomics: help in ru and en, exit codes, vault discovery, completion, quiet, usage errors", () => {
  const r = V();
  try {
    assert.match(cli(r, ["rename", "--help"]).out, /Rename a file/);
    assert.match(cli(null, ["rename", "--help", "--lang", "ru"]).out, /Переименовать/);
    assert.match(cli(null, ["--lang", "ru"]).out, /командная строка/);
    assert.equal(cli(r, ["bogus"]).code, 2); assert.equal(cli(r, ["read"]).code, 2); assert.equal(cli(r, ["read", "nope"]).code, 3);
    assert.equal(cli(r, ["files", "list", "--nope"]).code, 2);
    const e = cli(r, ["read", "nope", "--json"]); assert.equal(JSON.parse(e.err).code, 3);
    assert.equal(cli(r, ["write", "q", "--text", "1", "-q"]).out, "");
    // auto-detect by walking up
    const sub = path.join(r, "notes"); const out = cli(null, ["vault", "info", "--json"].concat([]), { env: { BASALT_VAULT: r } }).json(); assert.equal(out.root, fs.realpathSync(r) === r ? r : out.root);
    const found = require_spawn(sub); assert.equal(found.status, 0);
    assert.match(cli(null, ["completion", "bash"]).out, /complete -o default -F _basalt/);
    assert.match(cli(null, ["completion", "powershell"]).out, /Register-ArgumentCompleter/);
    assert.equal(cli(null, ["completion", "zsh"]).code, 2);
    assert.equal(cli(null, ["vault", "info"], { env: { BASALT_VAULT: path.join(r, "none") } }).code, 3);
  } finally { rm(r); }
});

import { spawnSync } from "node:child_process";
import { ENTRY } from "./helpers.mjs";
function require_spawn(cwd) { return spawnSync(process.execPath, [ENTRY, "vault", "info", "--json"], { cwd, encoding: "utf8", env: { ...process.env, BASALT_VAULT: "" } }); }
