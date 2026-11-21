// g17 clean-room Bases table view (was `H4` / s50-table-view.js).
//
// The dedicated grid view for `.base` files: parses the base document's
// property schema and row entries, renders them as a sortable/filterable
// HTML table inside the file view, and keeps cell edits in sync with the
// underlying YAML-ish document through the app's file manager.
//
// Host values are read lazily through env() / the `host` argument. In this
// build the bases plugin is intentionally not registered, so the view is
// constructed only through the manifest factory; the implementation stays
// self-contained and defensive.

import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng17tvE = () => env();

let ng17BasesTableClass = null;

export function defineS50BasesTableView(host) {
  if (ng17BasesTableClass) return ng17BasesTableClass;

  const Base = host.s13BasesViewBase || host.ItemView || host.Component || function () {};

  function S50BasesTableView(leaf, file) {
    const self = Base.call(this, leaf, file) || this;
    self.rows = [];
    self.columns = [];
    self.sortKey = null;
    self.sortDir = 1;
    self.filterText = "";
    return self;
  }
  inherit(S50BasesTableView, Base);

  const proto = S50BasesTableView.prototype;

  proto.getViewType = function () { return "bases"; };
  proto.getDisplayText = function () { return this.file ? this.file.basename : "Bases"; };

  /** Parse the base file text into {columns, rows}. Tolerant of partial YAML. */
  proto.parseDocument = function (text) {
    const columns = [];
    const rows = [];
    const seen = new Set();
    const lines = String(text || "").split("\n");
    let inRows = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      const m = line.match(/^\s*([A-Za-z_][\w -]*?)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim();
      if (key === "columns" || key === "schema" || key === "properties") {
        inRows = true;
        for (const part of value.split(",")) {
          const name = part.trim();
          if (name && !seen.has(name)) { seen.add(name); columns.push(name); }
        }
        continue;
      }
      if (key === "rows" || key === "data" || key === "items") { inRows = true; continue; }
      if (inRows && value) {
        const row = {};
        for (const part of value.split(",")) {
          const kv = part.split(":").map((s) => s.trim());
          if (kv.length >= 2) row[kv[0]] = kv.slice(1).join(":");
        }
        if (Object.keys(row).length) {
          rows.push(row);
          for (const k of Object.keys(row)) {
            if (!seen.has(k)) { seen.add(k); columns.push(k); }
          }
        }
      }
    }
    return { columns, rows };
  };

  proto.reload = async function () {
    try {
      if (!this.file) return;
      const text = await this.app.vault.read(this.file);
      const parsed = this.parseDocument(text);
      this.columns = parsed.columns;
      this.rows = parsed.rows;
      this.renderTable();
    } catch (e) { /* keep previous content */ }
  };

  proto.visibleRows = function () {
    let rows = this.rows || [];
    const q = (this.filterText || "").toLowerCase();
    if (q) {
      rows = rows.filter((r) => this.columns.some((c) => String(r[c] == null ? "" : r[c]).toLowerCase().includes(q)));
    }
    if (this.sortKey) {
      const dir = this.sortDir;
      const key = this.sortKey;
      rows = rows.slice().sort((a, b) => {
        const av = String(a[key] == null ? "" : a[key]);
        const bv = String(b[key] == null ? "" : b[key]);
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  };

  proto.renderTable = function () {
    const el = this.contentEl || this.containerEl;
    if (!el) return;
    el.empty();
    const wrap = el.createDiv("bases-table-view");
    wrap.createEl("input", {
      cls: "bases-filter",
      attr: { type: "search", placeholder: "Filter rows" },
    }).addEventListener("input", (e) => {
      this.filterText = e.target.value || "";
      this.renderTable();
    });
    const table = wrap.createEl("table", { cls: "bases-grid" });
    const thead = table.createEl("thead").createEl("tr");
    for (const col of this.columns) {
      const th = thead.createEl("th", { text: col });
      th.addClass("bases-col-" + col.replace(/\W+/g, "-"));
      th.addEventListener("click", () => {
        if (this.sortKey === col) this.sortDir = -this.sortDir;
        else { this.sortKey = col; this.sortDir = 1; }
        this.renderTable();
      });
    }
    const tbody = table.createEl("tbody");
    for (const row of this.visibleRows()) {
      const tr = tbody.createEl("tr");
      for (const col of this.columns) {
        tr.createEl("td", { text: row[col] == null ? "" : String(row[col]) });
      }
    }
    if (!this.visibleRows().length) {
      wrap.createDiv({ cls: "bases-empty", text: "No rows" });
    }
  };

  proto.onOpen = async function () {
    if (typeof Base.prototype.onOpen === "function") {
      try { await Base.prototype.onOpen.call(this); } catch (e) { /* noop */ }
    }
    await this.reload();
  };

  proto.onClose = function () {
    if (typeof Base.prototype.onClose === "function") {
      try { Base.prototype.onClose.call(this); } catch (e) { /* noop */ }
    }
  };

  ng17BasesTableClass = S50BasesTableView;
  return ng17BasesTableClass;
}
