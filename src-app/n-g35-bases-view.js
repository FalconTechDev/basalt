// g35 clean-room: BasesView — the abstract base every Bases view type derives
// from: frontmatter transactions with undo/redo, group headings, table export
// and clipboard copy (spec g35, s26-bases-view).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { emptyToNull, keyIgnoringCase, parsePropertyId } from "./text.js";

const ng35Json = (o) => JSON.stringify(o);

/** Bases view base class. ctor (queryController). */
export function ng35BasesView(host) {
  function BasesView(queryController) {
    host.Component.call(this);
    this.allProperties = [];
    this.undoStack = [];
    this.redoStack = [];
    this.app = queryController.app;
    this.queryController = queryController;
  }
  inherit(BasesView, host.Component);
  const P = BasesView.prototype;

  P.getViewActions = function () { return []; };
  P.onResize = function () {};
  P.focus = function () {};
  P.setEphemeralState = function () {};
  P.getEphemeralState = function () { return {}; };
  P.createFileForView = function (file, extra) {
    return this.queryController.newItemMenu.open(file, extra);
  };

  // fn(changes) pushes {file, start, end}; a transaction commits only when at
  // least one change actually differs.
  P.createTransaction = async function (fn) {
    const transaction = { changes: [], state: this.getEphemeralState() };
    await fn(transaction.changes);
    const wrote = transaction.changes.some((c) => ng35Json(c.start) !== ng35Json(c.end));
    if (!wrote) return;
    this.queryController.requestNotifyView();
    this.redoStack = [];
    this.undoStack.push(transaction);
  };

  P.updateProperty = async function (file, prop, value) {
    const v = emptyToNull(value);
    await this.createTransaction(async (changes) => {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const key = keyIgnoringCase(fm, prop);
        const exists = key !== prop || Object.hasOwn(fm, prop);
        if (!exists && v == null) return;
        const start = JSON.parse(ng35Json(fm));
        fm[exists ? key : prop] = v;
        changes.push({ file, start, end: fm });
      });
    });
  };

  // Undo/redo apply a change only while the live frontmatter still equals the
  // recorded opposite state, so concurrent edits are never clobbered.
  const restore = async function (view, from, to, matchKey, assignKey) {
    const t = view[from].pop();
    if (!t) return;
    view[to].push(t);
    view.setEphemeralState(t.state);
    for (const c of t.changes) {
      await view.app.fileManager.processFrontMatter(c.file, (fm) => {
        if (ng35Json(fm) === ng35Json(c[matchKey])) Object.assign(fm, c[assignKey]);
      });
    }
  };
  P.undoTransaction = function () { return restore(this, "undoStack", "redoStack", "end", "start"); };
  P.redoTransaction = function () { return restore(this, "redoStack", "undoStack", "start", "end"); };

  P.createGroupHeadingEl = function (group) {
    if (!group.key) return null;
    const el = env().createDiv("bases-group-heading");
    if (this.config && this.config.groupBy) {
      el.createDiv("bases-group-property").setText(this.config.getDisplayName(this.config.groupBy.property));
    }
    const valueEl = el.createDiv("bases-group-value");
    if (env().gW.equals(group.key, env().bW.value)) {
      valueEl.setText(env().gm.plugins.bases.labelGroupKeyNone());
    } else {
      group.key.renderTo(valueEl, this.app.renderContext);
    }
    return el;
  };

  P.exportTable = function () {
    const props = this.data.properties;
    const cell = (entry, prop) => {
      try {
        const v = entry.getValue(prop);
        if (v == null || env().gW.equals(v, env().bW.value)) return "";
        return v.toString();
      } catch (e) {
        return "";
      }
    };
    const header = props.map((p) => this.config.getDisplayName(p));
    const rows = this.data.data.map((entry) => props.map((p) => cell(entry, p)));
    return new host.s13TableExport(header, rows);
  };

  P.copyToClipboard = function () {
    const table = this.exportTable();
    const markdown = table.toMarkdown();
    const payload = {
      "text/plain": table.toTSV(),
      "text/markdown": markdown,
      "text/html": host.treeToHtml(host.markdownTree(markdown)),
      "basalt/table": table.toTableClipboard(),
    };
    const doc = env().activeDocument;
    const area = doc.createElement("textarea");
    area.value = payload["text/plain"] || Object.values(payload)[0];
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    doc.body.appendChild(area);
    const onCopy = (e) => {
      e.preventDefault();
      for (const type of Object.keys(payload)) e.clipboardData.setData(type, payload[type]);
    };
    doc.addEventListener("copy", onCopy, { once: true });
    area.focus();
    area.select();
    let ok = false;
    try {
      ok = doc.execCommand("copy");
    } catch (e) {
      console.error(e);
    }
    doc.removeEventListener("copy", onCopy);
    area.remove();
    const gm = env().gm.interface;
    new host.Notice(ok ? gm.copied({ context: "generic" }) : gm.copy_failed());
  };

  // Renderer registry: file.name -> file link, note.* -> metadata widget,
  // everything else -> formula.
  P.createRenderer = function (prop, el) {
    const type = prop === "file.name" ? "file" : parsePropertyId(prop).type === "note" ? "note" : "formula";
    const Cls = type === "file" ? env().f$ : type === "note" ? env().d$ : env().m$;
    return new Cls(this, prop, el);
  };

  return BasesView;
}
