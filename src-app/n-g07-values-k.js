// Clean-room formula glue (g07, part K): the syntax-highlight table, the
// link/tag renderer, the document search bar, the formula suggester and the
// shared runtime instance.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsK = {};
function ng07OnceK(key, build) { return (ng07ClsK[key] ??= build()); }

// ---------------------------------------------------------- TableResolver

function ng07BuildTableResolver() {
  const TABLE = {
    identifier: "cm-variable", property: "cm-property", string: "cm-string",
    number: "cm-number", boolean: "cm-builtin", null: "cm-atom",
    bracket: "cm-bracket", operator: "cm-operator", function: "cm-function",
    error: "cm-invalid", comment: "cm-comment",
  };
  function TableResolver(extra) {
    this.table = extra ? { ...TABLE, ...extra } : { ...TABLE };
  }
  TableResolver.prototype.for = function (tag) { return this.table[tag] || ""; };
  TableResolver.prototype.classFor = TableResolver.prototype.for;
  return TableResolver;
}
export function s08TableResolver(host) { ng07H(host); return ng07OnceK("TableResolver", ng07BuildTableResolver); }

// ----------------------------------------------------------- LinkRenderer

function ng07BuildLinkRenderer() {
  function LinkRenderer(app) {
    this.app = app;
    this.hoverPopover = null;
  }
  LinkRenderer.prototype.renderFileLink = function (el, file, display, sourcePath) {
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const a = doc.createElement("a");
    a.className = "internal-link";
    a.setAttribute("data-href", file ? file.path : "");
    a.textContent = display || (file ? file.name : "");
    if (file) a.setAttribute("data-href-path", file.path);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (file && this.app && this.app.workspace) {
        const leaf = this.app.workspace.getLeaf(false);
        if (leaf) leaf.openFile(file);
      }
    });
    el.appendChild(a);
    return a;
  };
  LinkRenderer.prototype.renderExternalLink = function (el, url, display) {
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const a = doc.createElement("a");
    a.className = "external-link";
    a.href = url;
    a.textContent = display || url;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      try { env().activeWindow.open(url, "_blank", "noopener"); }
      catch (err) { if (env().fb) new (env().fb)("Failed to open link"); }
    });
    el.appendChild(a);
    return a;
  };
  LinkRenderer.prototype.renderTag = function (el, tag) {
    const doc = el && el.doc ? el.doc : (el && el.ownerDocument) || document;
    const a = doc.createElement("a");
    a.className = "tag";
    a.textContent = "#" + String(tag).replace(/^#/, "");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        if (this.app && this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById("global-search")) {
          const q = this.app.internalPlugins.getPluginById("global-search");
          if (q && q.openSearch) q.openSearch("tag:" + a.textContent.slice(1));
        }
      } catch (err) { /* search unavailable */ }
    });
    el.appendChild(a);
    return a;
  };
  return LinkRenderer;
}
export function s08LinkRenderer(host) { ng07H(host); return ng07OnceK("LinkRenderer", ng07BuildLinkRenderer); }
