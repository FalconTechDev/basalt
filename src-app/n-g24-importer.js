// g24 clean-room: "markdown-importer" plugin — Roam/Bear/Zettelkasten conversion.
import { inherit } from "./inherit.js";
import { env } from "./env.js";

const NG24_IMPORTER_ID = "markdown-importer";

// ---------------------------------------------------------------------------
// pure conversions (exported for tests via plugin methods too)
// ---------------------------------------------------------------------------

export function ng24RoamTags(text) {
  // #[[Tag]] or #[Tag] -> [[Tag]]
  return text.replace(/#\[\[([^\]]+)\]\]/g, (m, inner) => `[[${inner}]]`)
             .replace(/#\[([^\]\[]+)\]/g, (m, inner) => `[[${inner}]]`);
}

export function ng24RoamHighlights(text) {
  return text.replace(/\^\^([^\n^]+)\^\^/g, "==$1==");
}

export function ng24RoamTodos(text) {
  return text.replace(/TODO/g, "[ ]").replace(/DONE/g, "[x]");
}

export function ng24BearHighlights(text) {
  return text.replace(/::([^\n:]+)::/g, "==$1==");
}

export function ng24ZettelNumericLinks(text, files) {
  // "#123" style numeric links -> [[basename-containing-123]]
  const names = files.map((f) => f.basename);
  return text.replace(/#(\d+)/g, (m, num) => {
    const hit = names.find((n) => n.includes(num));
    return hit ? `[[${hit}]]` : m;
  });
}

export function ng24ZettelBeautify(text) {
  // [[file|alias]] stays; [[file]] -> [[file|basename]]
  return text.replace(/\[\[([^\]|]+)\]\]/g, (m, inner) => `[[${inner}|${inner.split("/").pop()}]]`);
}

/** Frontmatter key migration: alias->aliases, tag->tags, cssclass->cssclasses. */
export function ng24MigrateFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return text;
  const yaml = m[1];
  const lines = yaml.split("\n");
  const out = [];
  const map = { alias: "aliases", tag: "tags", cssclass: "cssclasses" };
  let changed = false;
  for (const line of lines) {
    const km = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
    if (!km) { out.push(line); continue; }
    const key = km[1].toLowerCase();
    const value = km[2];
    if (map[key]) {
      const target = map[key];
      // prefer the correct-key line if present
      const hasCorrect = lines.some((l) => new RegExp("^" + target + "\\s*:", "i").test(l));
      if (hasCorrect) { changed = true; continue; } // drop the legacy key
      // split comma values into a yaml list under the new key
      const vals = value.split(",").map((v) => v.trim()).filter(Boolean);
      if (vals.length > 1) {
        out.push(`${target}:`);
        vals.forEach((v) => out.push(`  - ${v}`));
      } else {
        out.push(`${target}: ${vals[0] || ""}`);
      }
      changed = true;
      continue;
    }
    out.push(line);
  }
  if (!changed) return text;
  const body = text.slice(m[0].length);
  const newYaml = out.join("\n");
  if (!newYaml.trim()) return body; // empty frontmatter removed
  return `---\n${newYaml}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// ImporterModal (X8)
// ---------------------------------------------------------------------------

const NG24_TOGGLES = [
  ["roamTags", "Roam tags (#[[Tag]] -> [[Tag]])"],
  ["roamHighlights", "Roam highlights (^^text^^ -> ==text==)"],
  ["roamTodos", "Roam TODO/DONE -> [ ]/[x]"],
  ["bearHighlights", "Bear highlights (::text:: -> ==text==)"],
  ["zettelNumeric", "Zettelkasten numeric links"],
  ["zettelBeautify", "Zettelkasten beautification"],
  ["frontmatter", "Frontmatter migration"],
];

export function ng24DefineImporterModal(host) {
  function ImporterModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.app = app;
    self.options = {};
    NG24_TOGGLES.forEach(([k]) => { self.options[k] = true; });
    self.files = [];
    self.results = [];
    self.cancelled = false;
    self._undo = null;
    return self;
  }
  inherit(ImporterModal, host.Modal);
  const proto = ImporterModal.prototype;

  proto.onload = function () {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Import markdown");
    contentEl.createEl("p", { text: "Convert Roam/Bear/Zettelkasten syntax in your vault." });
    const list = contentEl.createDiv({ cls: "importer-toggles" });
    NG24_TOGGLES.forEach(([key, label]) => {
      const row = list.createEl("label", { cls: "setting-item" });
      const cb = row.createEl("input", { type: "checkbox", attr: { checked: "" } });
      cb.addEventListener("change", () => { this.options[key] = cb.checked; });
      row.createEl("span", { text: label });
    });
    this.progressEl = contentEl.createDiv({ cls: "importer-progress" });
    this.resultsEl = contentEl.createDiv({ cls: "importer-results" });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    this.cancelBtn = buttons.createEl("button", { text: "Cancel" });
    this.finishBtn = buttons.createEl("button", { cls: "mod-cta", text: "Import", disabled: "" });
    this.cancelBtn.addEventListener("click", () => { this.cancelled = true; this.close(); });
    this.finishBtn.addEventListener("click", () => this.run());
    this.finishBtn.disabled = true;
    this.scanFiles();
  };

  proto.scanFiles = async function () {
    this.files = await this.app.vault.getMarkdownFiles();
    this.finishBtn.disabled = !this.files.length;
    this.resultsEl.empty();
    ng24ContentRow(this.resultsEl, `Found ${this.files.length} markdown file(s).`);
  };

  proto.run = async function () {
    this.results = [];
    let done = 0;
    for (const file of this.files) {
      if (this.cancelled) break;
      try {
        const before = await this.app.vault.read(file);
        let after = before;
        const o = this.options;
        if (o.roamTags) after = ng24RoamTags(after);
        if (o.roamHighlights) after = ng24RoamHighlights(after);
        if (o.roamTodos) after = ng24RoamTodos(after);
        if (o.bearHighlights) after = ng24BearHighlights(after);
        if (o.zettelNumeric) after = ng24ZettelNumericLinks(after, this.files);
        if (o.zettelBeautify) after = ng24ZettelBeautify(after);
        if (o.frontmatter) after = ng24MigrateFrontmatter(after);
        if (after !== before) {
          await this.app.vault.process(file, (content) => {
            // process re-reads; apply the same transform pipeline idempotently
            let out = content;
            if (o.roamTags) out = ng24RoamTags(out);
            if (o.roamHighlights) out = ng24RoamHighlights(out);
            if (o.roamTodos) out = ng24RoamTodos(out);
            if (o.bearHighlights) out = ng24BearHighlights(out);
            if (o.zettelNumeric) out = ng24ZettelNumericLinks(out, this.files);
            if (o.zettelBeautify) out = ng24ZettelBeautify(out);
            if (o.frontmatter) out = ng24MigrateFrontmatter(out);
            return out;
          });
          this.results.push({ file: file.path, changed: true });
        } else {
          this.results.push({ file: file.path, changed: false });
        }
      } catch (e) {
        this.results.push({ file: file.path, changed: false, error: e.message });
      }
      done++;
      this.progressEl.setText(`${done}/${this.files.length}`);
      await Promise.resolve(); // microtask yield
    }
    const changed = this.results.filter((r) => r.changed).length;
    new host.Notice(`Import finished: ${changed} file(s) updated.`);
    this.close();
  };

  return ImporterModal;
}

function ng24ContentRow(el, text) {
  el.createEl("div", { cls: "importer-row", text });
}

// ---------------------------------------------------------------------------
// MarkdownImporterPlugin (U8)
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownImporterPlugin(host) {
  function MarkdownImporterPlugin(app, manifest) {
    const self = host.Plugin.call(this, app, manifest) || this;
    self.app = app;
    return self;
  }
  inherit(MarkdownImporterPlugin, host.Plugin);
  const proto = MarkdownImporterPlugin.prototype;

  Object.defineProperty(proto, "id", { get() { return NG24_IMPORTER_ID; } });

  proto.onload = function () {
    this.addCommand({
      id: "markdown-importer:open",
      name: "Open markdown importer",
      callback: () => new host.ImporterModal(this.app).open(),
    });
  };

  return MarkdownImporterPlugin;
}

export const defineMarkdownImporterPlugin = ng24DefineMarkdownImporterPlugin;
export const defineImporterModal = ng24DefineImporterModal;
