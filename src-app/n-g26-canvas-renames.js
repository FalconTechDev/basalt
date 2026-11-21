// g26 clean-room: canvas rename repair batch (spec g26 Part D.3).
// After files are renamed, every .canvas whose metadata index records an embed
// of an old path gets its JSON rewritten (node.file / node.background) through
// vault.process, with a loading->success Notice reporting the counts.

function ng26CanvasStrings(host) {
  return host.canvasI18n;
}

export async function ng26ProcessCanvasRenames(plugin, host) {
  const app = plugin.app;
  const batch = plugin.renames;
  plugin.renames = [];
  if (!batch.length) return;
  const moved = new Set(batch.map((pair) => pair[0]));
  const rewrite = new Map(batch);

  const all = plugin.index ? plugin.index.getAll() : {};
  const dirty = [];
  for (const path of Object.keys(all)) {
    const entry = all[path];
    if (entry && entry.embeds && entry.embeds.some((embed) => moved.has(embed.file))) dirty.push(path);
  }
  if (!dirty.length) return;

  const strings = ng26CanvasStrings(host);
  const notice = new host.Notice(strings.msgUpdatingLinks({ count: dirty.length }));
  notice.containerEl.addClass("is-loading");

  let updated = 0;
  for (const path of dirty) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof host.TFile)) continue;
    await app.vault.process(file, (text) => {
      if (!text) return text;
      const data = JSON.parse(text);
      let changed = 0;
      for (const node of data.nodes || []) {
        if (node.type === "file" && rewrite.has(node.file)) {
          node.file = rewrite.get(node.file);
          changed++;
        } else if (node.type === "group" && rewrite.has(node.background)) {
          node.background = rewrite.get(node.background);
          changed++;
        }
      }
      updated += changed;
      return changed ? host.canvasSerialize(data) : text;
    });
  }

  if (updated > 0) {
    notice.containerEl.removeClass("is-loading");
    notice.containerEl.addClass("mod-success");
    notice.setMessage(strings.msgUpdatedLinks({ count: updated }));
  }
}
