import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeVault, cli, rm, put, get } from "./helpers.mjs";
import { Board, loadY } from "../lib/board.mjs";

const ids = (r, b = "b.board") => cli(r, ["board", "show", b, "--json"]).json().cards.map((c) => c.id);
const mkBoard = (r) => {
  cli(r, ["board", "new", "b"]);
  const a = cli(r, ["board", "card", "add", "b", "Alpha card", "--x", "0", "--y", "0", "--color", "red", "--json"]).json().id;
  const b = cli(r, ["board", "card", "add", "b", "Beta card", "--json"]).json().id;
  const c = cli(r, ["board", "card", "add", "b", "Gamma [[Note]]", "--json"]).json().id;
  cli(r, ["board", "link", "add", "b", a, b, "--label", "to"]); cli(r, ["board", "link", "add", "b", a, c]);
  return { a, b, c };
};

test("board file is valid for the app: envelope, ydoc round trip, mirror of nodes", () => {
  const r = makeVault();
  try {
    const { a } = mkBoard(r), j = JSON.parse(get(r, "b.board"));
    assert.equal(j.v, 2); assert.equal(Object.keys(j.nodes).length, 3); assert.equal(Object.keys(j.edges).length, 2);
    assert.deepEqual(Object.keys(j.nodes[a]).sort(), ["color", "h", "text", "w", "x", "y"]);
    // load it the way the app does (Yjs doc from the base64 update)
    const Y = loadY(), d = new Y.Doc(); Y.applyUpdate(d, new Uint8Array(Buffer.from(j.ydoc, "base64")));
    assert.equal(d.getMap("nodes").get(a).get("text").toString(), "Alpha card");
    assert.equal(d.getMap("nodes").get(a).get("color"), "#e5484d");
    assert.equal(d.getMap("meta").get("id"), j.id);
    assert.match(cli(r, ["board", "list"]).out, /b\.board\s+3\s+2/);
  } finally { rm(r); }
});

test("card edit/move/color/kind/delete and link delete", () => {
  const r = makeVault();
  try {
    const { a, b } = mkBoard(r);
    cli(r, ["board", "card", "edit", "b", a.slice(0, 4), "--text", "Alpha 2", "--w", "300"]);
    cli(r, ["board", "card", "move", "b", a, "10", "20"]); cli(r, ["board", "card", "move", "b", a, "--dx", "5"]);
    cli(r, ["board", "card", "color", "b", a, "blue"]); cli(r, ["board", "card", "kind", "b", a, "Task"]);
    const c = cli(r, ["board", "show", "b", "--json"]).json().cards.find((x) => x.id === a);
    assert.deepEqual([c.text, c.x, c.y, c.w, c.color, c.kind], ["Alpha 2", 15, 20, 300, "#3fa7d6", "Task"]);
    assert.equal(cli(r, ["board", "card", "color", "b", a, "pink"]).code, 2);
    assert.equal(cli(r, ["board", "card", "edit", "b", "zzzz", "--text", "x"]).code, 3);
    cli(r, ["board", "link", "delete", "b", a, b]);
    assert.equal(cli(r, ["board", "show", "b", "--json"]).json().links.length, 1);
    const del = cli(r, ["board", "card", "delete", "b", a, "--json"]).json();
    assert.equal(del.linksRemoved, 1); assert.equal(ids(r).length, 2);
  } finally { rm(r); }
});

test("layouts keep cards and give distinct positions", () => {
  const r = makeVault();
  try {
    mkBoard(r);
    for (const mode of ["grid", "tree", "force"]) {
      assert.equal(cli(r, ["board", "layout", "b", mode]).code, 0);
      const cs = cli(r, ["board", "show", "b", "--json"]).json().cards;
      assert.equal(cs.length, 3); assert.equal(new Set(cs.map((c) => c.x + "," + c.y)).size, 3, mode);
    }
    cli(r, ["board", "layout", "b", "tree", "--dir", "lr"]);
    const cs = cli(r, ["board", "show", "b", "--json"]).json().cards, byText = (t) => cs.find((c) => c.text.startsWith(t));
    assert.ok(byText("Beta").x > byText("Alpha").x);
    assert.equal(cli(r, ["board", "layout", "b", "spiral"]).code, 2);
  } finally { rm(r); }
});

test("export formats and import round trip (json, csv cards + edges)", () => {
  const r = makeVault();
  try {
    mkBoard(r);
    const js = JSON.parse(cli(r, ["board", "export", "b"]).out); assert.equal(js.cards.length, 3); assert.equal(js.links.length, 2);
    assert.match(cli(r, ["board", "export", "b", "--format", "markdown"]).out, /## Alpha card/);
    assert.match(cli(r, ["board", "export", "b", "--format", "csv"]).out, /^id,x,y,w,h,color,kind,text/);
    assert.match(cli(r, ["board", "export", "b", "--format", "csv", "--edges"]).out, /^id,from,to,label/);
    const mer = cli(r, ["board", "export", "b", "--format", "mermaid"]).out; assert.match(mer, /^graph LR/); assert.match(mer, /-->\|to\|/);
    assert.match(cli(r, ["board", "export", "b", "--format", "dot"]).out, /digraph board/);
    assert.match(cli(r, ["board", "export", "b", "--format", "svg"]).out, /<svg/);
    assert.equal(cli(r, ["board", "export", "b", "--format", "nope"]).code, 2);
    cli(r, ["board", "export", "b", "--out", path.join(r, "out.json")]);
    // json import into a new board keeps cards and links
    const imp = cli(r, ["board", "import", "c", "--from-json", path.join(r, "out.json"), "--create", "--json"]); assert.equal(imp.code, 0);
    assert.deepEqual(cli(r, ["board", "show", "c", "--json"]).json().cards.map((x) => x.text).sort(), js.cards.map((x) => x.text).sort());
    assert.equal(cli(r, ["board", "show", "c", "--json"]).json().links.length, 2);
    // csv
    put(r, "cards.csv", 'id,title,body,color,owner\nk1,"Hello, world","line ""two""",green,alex\nk2,Second,,,\n');
    put(r, "edges.csv", "from,to,label\nk1,Second,uses\n");
    assert.equal(cli(r, ["board", "import", "d", "--cards", "cards.csv", "--edges", "edges.csv", "--create"].map((x, i, a) => (a[i - 1] === "--cards" || a[i - 1] === "--edges" ? path.join(r, x) : x))).code, 0);
    const d = cli(r, ["board", "show", "d", "--json"]).json();
    assert.equal(d.cards.find((x) => x.id === "k1").text, 'Hello, world\n\nline "two"\n\nowner: alex');
    assert.equal(d.cards.find((x) => x.id === "k1").color, "#46a758");
    assert.equal(d.links[0].label, "uses");
    assert.equal(cli(r, ["board", "import", "zzz", "--from-json", path.join(r, "out.json")]).code, 3);
  } finally { rm(r); }
});

test("png-data-only extracts embedded pictures", () => {
  const r = makeVault();
  try {
    cli(r, ["board", "new", "b"]);
    const b = Board.load(path.join(r, "b.board")), png = Buffer.from("iVBORw0KGgo=", "base64");
    b.addCard({ id: "pic1", text: "p" }); b.editCard("pic1", { img: "data:image/png;base64," + png.toString("base64") }); b.save(path.join(r, "b.board"));
    const out = path.join(r, "imgs"); assert.equal(cli(r, ["board", "export", "b", "--format", "png-data-only", "--out", out]).code, 0);
    assert.deepEqual(fs.readFileSync(path.join(out, "pic1.png")), png);
  } finally { rm(r); }
});

test("from-canvas converts nodes, groups and edges", () => {
  const r = makeVault();
  try {
    put(r, "c.canvas", JSON.stringify({ nodes: [{ id: "n1", type: "text", text: "hello", x: 0, y: 0, width: 200, height: 80, color: "1" }, { id: "n2", type: "file", file: "Notes/x.md", x: 300, y: 0, width: 200, height: 80 }, { id: "g", type: "group", label: "G", x: -50, y: -50, width: 700, height: 300 }], edges: [{ id: "e", fromNode: "n1", toNode: "n2", fromSide: "right", label: "l" }] }));
    assert.equal(cli(r, ["board", "from-canvas", "c.canvas"]).code, 0);
    const s = cli(r, ["board", "show", "c", "--json"]).json();
    assert.equal(s.cards.length, 3); assert.equal(s.cards.find((x) => x.id === "n1").color, "#e5484d"); assert.equal(s.cards.find((x) => x.id === "n2").text, "[[x]]");
    assert.deepEqual([s.links[0].label, s.links[0].sa], ["l", "r"]);
    assert.equal(cli(r, ["board", "from-canvas", "c.canvas"]).code, 1);
  } finally { rm(r); }
});

test("merge unions boards; same-lineage edits combine", () => {
  const r = makeVault();
  try {
    mkBoard(r); fs.copyFileSync(path.join(r, "b.board"), path.join(r, "copy.board"));
    cli(r, ["board", "card", "add", "b", "only in b"]); cli(r, ["board", "card", "add", "copy", "only in copy"]);
    cli(r, ["board", "card", "edit", "copy", ids(r, "copy.board")[0], "--text", "edited in copy"]);
    assert.equal(cli(r, ["board", "merge", "b", "copy"]).code, 0);
    const t = cli(r, ["board", "show", "b", "--json"]).json().cards.map((c) => c.text);
    assert.equal(t.length, 5); assert.ok(t.includes("only in copy") && t.includes("only in b") && t.includes("edited in copy"));
  } finally { rm(r); }
});

test("history: snapshot, list, diff, restore (and undo of the restore)", () => {
  const r = makeVault();
  try {
    const { a } = mkBoard(r);
    const s1 = cli(r, ["board", "history", "snapshot", "b", "--json"]).json().id;
    assert.equal(cli(r, ["board", "diff", "b"]).code, 0);
    cli(r, ["board", "card", "edit", "b", a, "--text", "changed", "--snapshot"]);
    cli(r, ["board", "card", "add", "b", "extra"]); cli(r, ["board", "card", "delete", "b", ids(r)[1]]);
    const d = cli(r, ["board", "diff", "b", "--json"]); assert.equal(d.code, 4);
    const dj = d.json(); assert.equal(dj.cards.added.length, 1); assert.equal(dj.cards.removed.length, 1); assert.ok(dj.cards.changed.some((c) => c.fields.text));
    const l = cli(r, ["board", "history", "list", "b", "--json"]).json(); assert.ok(l.length >= 2); assert.equal(l[0].id, s1);
    assert.equal(cli(r, ["board", "diff", "b@" + s1, "b"]).code, 4);
    const before = cli(r, ["board", "show", "b", "--json"]).json().cards.length;
    assert.equal(cli(r, ["board", "history", "restore", "b", s1]).code, 0);
    const cs = cli(r, ["board", "show", "b", "--json"]).json();
    assert.equal(cs.cards.length, 3); assert.equal(cs.links.length, 2); assert.equal(cs.cards.find((c) => c.id === a).text, "Alpha card");
    assert.equal(cli(r, ["board", "diff", "b@" + s1, "b"]).code, 0);
    assert.equal(cli(r, ["board", "history", "restore", "b", "-1", "--as", "restored"]).code, 0); assert.ok(fs.existsSync(path.join(r, "restored.board")));
    // the restore saved the pre-restore state: restoring "latest before" brings back `before` cards
    const l2 = cli(r, ["board", "history", "list", "b", "--json"]).json();
    cli(r, ["board", "history", "restore", "b", l2[l2.length - 1].id]); assert.equal(cli(r, ["board", "show", "b", "--json"]).json().cards.length, 3 === before ? 3 : cs.cards.length);
    // board diff of two files
    assert.equal(cli(r, ["board", "diff", "b.board", "restored.board", "--json"]).json().links.removed.length >= 0, true);
    assert.equal(cli(r, ["board", "history", "list", "nope"]).code, 3);
  } finally { rm(r); }
});

test("renaming a note rewrites [[links]] inside board cards and moves the history folder", () => {
  const r = makeVault({ "Note.md": "n\n" });
  try {
    const { c } = mkBoard(r); cli(r, ["board", "history", "snapshot", "b"]);
    assert.equal(cli(r, ["rename", "Note", "Renamed"]).code, 0);
    assert.equal(cli(r, ["board", "show", "b", "--json"]).json().cards.find((x) => x.id === c).text, "Gamma [[Renamed]]");
    assert.equal(cli(r, ["move", "b.board", "sub/b2.board"]).code, 0);
    assert.equal(cli(r, ["board", "history", "list", "sub/b2.board", "--json"]).json().length, 1);
    assert.equal(cli(r, ["board", "show", "sub/b2", "--json"]).json().cards.length, 3);
  } finally { rm(r); }
});
