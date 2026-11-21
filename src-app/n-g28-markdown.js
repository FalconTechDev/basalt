// g28 markdown-extras (spec g28 Part H): reading-mode helpers — unresolved
// link marking, query embeds, embed depth, properties editor lookup, EmbedLoader.
import { linkPath, parseLinktext } from "./n-g28-path.js";

function ng28FindAll(el, selector) {
  if (typeof el.findAll === "function") return el.findAll(selector);
  return Array.prototype.slice.call(el.querySelectorAll(selector));
}

function ng28ToggleClass(el, cls, on) {
  if (typeof el.toggleClass === "function") el.toggleClass(cls, !!on);
  else el.classList.toggle(cls, !!on);
}

/** Marks .internal-link anchors whose target does not resolve. host: refreshLinkStates. */
export function updateUnresolvedLinks(app, el, sourcePath, getHref, host) {
  const hrefOf = getHref || host.internalLinkHref;
  const links = ng28FindAll(el, "a.internal-link");
  for (const link of links) {
    const href = hrefOf(link, el);
    if (!href) continue;
    ng28ToggleClass(link, "is-unresolved", app.metadataCache.isUnresolved(linkPath(href), sourcePath));
  }
}

/** Replaces a ```query block element with a query-results embed. host: queryEmbed. */
export function renderQueryEmbed(app, query, el, sourcePath, host) {
  const doc = el.ownerDocument || document;
  const box = doc.createElement("div");
  box.className = "internal-query";
  const header = doc.createElement("div");
  header.className = "internal-query-header";
  const icon = doc.createElement("span");
  icon.className = "internal-query-header-icon";
  header.appendChild(icon);
  host.setIcon(icon, "lucide-search");
  const title = doc.createElement("span");
  title.className = "internal-query-header-title";
  title.textContent = query;
  header.appendChild(title);
  box.appendChild(header);
  const results = doc.createElement("div");
  results.className = "search-result-container";
  box.appendChild(results);
  el.replaceWith(box);
  return new host.QueryResults(app, results, query, sourcePath);
}

/** Nearest embed depth recorded for el or an ancestor (0 when none). host: embedDepth. */
export function embedDepthAt(el, host) {
  const depths = host.embedDepths;
  for (let node = el; node; node = node.parentElement) {
    if (depths.has(node)) return depths.get(node);
  }
  return 0;
}

/** The live properties editor for the active file, or null. host: propertiesPlugin. */
export async function propertiesPlugin(app, host) {
  const editor = host.activePropertiesEditor(app.workspace);
  if (editor) return editor;
  const file = app.workspace.getActiveFile();
  if (!file || file.extension !== "md") return null;
  const plugin = app.internalPlugins.getEnabledPluginById("properties");
  if (!plugin) return null;
  const view = await plugin.ensurePropertiesView(file);
  return view ? view.metadataEditor : null;
}

/** Resolves ![[...]] embeds to specialised or generic embed views. host: EmbedLoader. */
export function defineEmbedLoader(host) {
  function load(ctx) {
    ctx.depth = (ctx.depth || 0) + 1;
    ctx.containerEl.innerHTML = "";
    const app = ctx.app;
    const { path, subpath } = parseLinktext(ctx.linktext);
    const dest = app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
    let embed = null;
    if (dest) {
      const creator = app.embedRegistry.getEmbedCreator(dest);
      if (creator && ctx.depth <= 5) embed = creator(ctx, dest, subpath);
      if (!embed) embed = new host.FileEmbed(ctx, dest, subpath);
    }
    if (!embed) embed = new host.FallbackEmbed(ctx);
    ctx.containerEl.classList.add("is-loaded");
    host.embedDepths.set(ctx.containerEl, ctx.depth);
    return embed;
  }
  return { load };
}
