// g33 clean-room: per-line bidi direction support for the markdown editor.
// Replaces orig LI (entry), II (declarator), OI (entry), FI (class).

/** Strips leading quote/list/task markers, then asks the host for the direction of the rest. */
export function s20TextDirection(text, host) {
  const m = host.listLinePattern.exec(text);
  const rest = m && m[0] ? text.slice(m[0].length) : text;
  return host.textDirectionOf(rest);
}

/** The three line decorations carrying dir=auto|rtl|ltr (built once per call). */
export function s20BidiMarks(host) {
  return {
    auto: host.cmDecoration.line({ attributes: { dir: "auto" } }),
    rtl: host.cmDecoration.line({ attributes: { dir: "rtl" } }),
    ltr: host.cmDecoration.line({ attributes: { dir: "ltr" } }),
  };
}

function ng33bidiFrontmatterEnd(doc) {
  if (doc.line(1).text !== "---") return -1;
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text === "---") return doc.line(n).to;
  }
  return -1;
}

/** Line decorations for every visible block outside the frontmatter; "auto" inherits the running direction. */
export function s20BidiDecorations(view, host) {
  const doc = view.state.doc;
  const frontmatterEnd = ng33bidiFrontmatterEnd(doc);
  const marks = s20BidiMarks(host);
  const ranges = new host.s20CmRangeSet();
  let previous = "auto";
  for (const block of view.viewportLineBlocks) {
    if (block.from < frontmatterEnd) continue;
    const dir = s20TextDirection(doc.sliceString(block.from, block.to), host);
    const resolved = dir === "auto" ? previous : dir;
    ranges.add(block.from, block.from, marks[resolved] || marks.auto);
    previous = resolved;
  }
  return ranges.finish();
}

export function defineS20BidiPlugin(host) {
  return host.cmViewPlugin.define(
    (view) => ({
      deco: s20BidiDecorations(view, host),
      update(update) {
        if (update.docChanged || update.viewportChanged || update.heightChanged) {
          this.deco = s20BidiDecorations(update.view, host);
        }
      },
    }),
    { decorations: (plugin) => plugin.deco }
  );
}
