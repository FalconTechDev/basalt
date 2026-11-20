// g32 clean-room: builds the reveal.js DOM for one markdown deck.
import { env } from "./env.js";
import { randomHex } from "./misc.js";

export async function ng32SlidesBuildDom(app, file, text, addChild) {
  await env().M9.promise;
  const doc = env().activeDocument || document;
  const isLight = app.vault.getConfig("theme") === "moonstone";
  const containerEl = doc.body.createDiv("slides-container");
  const themeCssEl = doc.head.createEl("link", { prepend: true });
  themeCssEl.rel = "stylesheet";
  themeCssEl.href = isLight ? "/lib/reveal/white.css" : "/lib/reveal/black.css";
  const revealCssEl = doc.head.createEl("link", { prepend: true });
  revealCssEl.rel = "stylesheet";
  revealCssEl.href = "/lib/reveal/reveal.css";

  const revealEl = containerEl.createDiv("reveal");
  const slidesEl = revealEl.createDiv("slides");
  const closeBtn = revealEl.createDiv("slides-close-btn");
  env().tv(closeBtn, "lucide-x-square");

  const parsed = env().Kx(text);
  const frontmatter = env().$x(parsed);
  const definitions = { definitions: env().oT(parsed) };
  const all = parsed.children || [];
  const groups = [];
  let current = [];
  for (const child of all) {
    if (child.type === "thematicBreak") {
      groups.push(current);
      current = [];
    } else {
      current.push(child);
    }
  }
  groups.push(current);
  for (const group of groups) {
    if (!group.length) continue;
    parsed.children = group;
    const html = env().Zx(parsed, definitions);
    const section = slidesEl.createEl("section");
    section.appendChild(env().xL(html));
  }
  parsed.children = all;

  const promises = [];
  env().fq.postProcess(app, {
    docId: randomHex(16), sourcePath: file.path, frontmatter, promises,
    addChild: (child) => addChild(child), getSectionInfo: () => null, replace: () => null,
    containerEl: slidesEl, el: slidesEl,
  });
  if (promises.length) await Promise.all(promises);
  return { containerEl, revealEl, slidesEl, themeCssEl, revealCssEl, closeBtn };
}
