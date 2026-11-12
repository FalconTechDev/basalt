// Product branding: "Obsidian" -> "Basalt" in everything a person reads.
//
// What is deliberately left alone, because changing it would break something rather than rename something:
//   - the cryptographic labels (ObsidianAesSivEnc, ObsidianKeyHash, ...): changing them makes existing encrypted data unreadable
//   - URLs and e-mail addresses (obsidian.md, help.obsidian.md/Obsidian+Publish/...)
//   - the .obsidian vault config folder, obsidian.json and the obsidian:// protocol
// The terminal command is renamed (`obsidian` -> `basalt`, shipped as Basalt.com); its named pipe keeps the old name because the console client is a binary that hard-codes it.
// The regex below skips anything glued to a word character, a '/', '+', '%' or '.', which covers all of those.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NAME = "Basalt";
// Where the project lives; the vendor's site/help/changelog links go here instead. Change in one place.
export const REPO = "https://github.com/FalconTechDev/basalt";
export const SHOWN_VERSION = "0.1.0";
const RE = /(?<![\/+%\w.])Obsidian(?![\w+%])/g;
export const brandText = (s) => s.replace(RE, NAME);
// obsidian.md pages (site, account, help, changelog) -> the repo. The service endpoints (releases., publish., api.) are left: they are APIs, not pages.
const brandLinks = (s) => s
  .replace(/https?:\/\/obsidian\.md\/changelog[^"'`\s)]*/g, REPO + "/releases")
  .replace(/https?:\/\/help\.obsidian\.md[^"'`\s)]*/g, REPO + "/wiki")
  .replace(/https?:\/\/obsidian\.md(?![\w.])[^"'`\s)]*/g, REPO);
const brandCli = (s) => s.replace(/"obsidian"/g, '"basalt"').replace(/Usage: obsidian </g, "Usage: basalt <");

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");

// The canvas export stamps a logo + wordmark in the corner. The original is a ~2 KB path drawing;
// this is the new crystal mark with the new name.
export function watermark() {
  const logo = fs.readFileSync(path.join(root, "branding", "logo-small.png")).toString("base64");
  return `<image href="data:image/png;base64,${logo}" x="0" y="0" width="17" height="25"/>` +
    `<text x="25" y="19.5" font-size="21" font-weight="700" font-family="Inter, Segoe UI, system-ui, sans-serif" fill="currentColor">${NAME}</text>`;
}
// The splash screens (vault picker, help window, loading screen) draw the old gem and the "Obsidian" wordmark as inline SVG.
export function brandSplash(s) {
  const png = fs.readFileSync(path.join(root, "branding", "logo-splash.png"));
  const w = 512 * (300 / 442), _ = w; // logo aspect 0.68 -> centred in the 512x512 box
  const imgW = Math.round(512 * 0.68), imgX = Math.round((512 - imgW) / 2);
  const logo = `<image href="data:image/png;base64,${png.toString("base64")}" x="${imgX}" y="0" width="${imgW}" height="512"/>`;
  const mark = `<text x="256" y="68" text-anchor="middle" font-size="84" font-weight="700" style="font-family:var(--font-interface, Inter, Segoe UI, system-ui, sans-serif)" fill="currentColor">${NAME}</text>`;
  return s
    .replace(/innerHTML='<radialGradient id="logo-bottom-left"[^']*'/g, () => `innerHTML='${logo}'`)
    .replace(/innerHTML='<path d="M46\.9 0c27 0 46\.9 17\.4[^']*'/g, () => `innerHTML='${mark}'`);
}

export function brandApp(app) {
  const i = app.indexOf("t.innerHTML='<path d=\"M7 14.6");
  if (i >= 0) {
    const e = app.indexOf("',t}", i);
    if (e > i) app = app.slice(0, i) + "t.innerHTML='" + watermark() + app.slice(e);
  }
  // glued to "%c" and to a backslash-t escape in the source, so the generic rule skips them
  return brandSplash(brandCli(brandLinks(brandText(app))))
    .replace(/%cObsidian Developer Console/g, `%c${NAME} Developer Console`)
    .replace(/\\tObsidian version/g, `\\t${NAME} version`);
}

function rewrite(file, fn) {
  if (!fs.existsSync(file)) return false;
  const before = fs.readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) { fs.writeFileSync(file, after); return true; }
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = [];
  const touch = (f, fn = brandText) => { if (rewrite(f, fn)) changed.push(path.relative(root, f)); };

  for (const f of ["i18n.js", "i18n-ru.js", "starter.js", "help.js", "starter.html", "help.html", "index.html", "package.json"]) touch(path.join(src, f));
  for (const f of ["starter.js", "help.js"]) touch(path.join(src, f), brandSplash);
  // "Obsidian Extracted" was the working title of this fork
  for (const f of ["starter.html", "help.html", "index.html"]) touch(path.join(src, f), (s) => s.replace(/Obsidian Extracted/g, NAME).replace(/Basalt Extracted/g, NAME));
  touch(path.join(src, "main.js"), (s) => brandLinks(brandText(s)).replace('includes("obsidian")', 'includes("basalt")').replace(/Bt\(i\)/g, `Bt("${SHOWN_VERSION}")`).replace('instead of "obsidian"', 'instead of "basalt"').split("obsidian-cli-${").join("basalt-cli-${").split(".obsidian-cli.sock").join(".basalt-cli.sock"));
  touch(path.join(root, "canvas-engine", "fp-canvas.src.js"));
  touch(path.join(src, "vault-sync.js"));
  touch(path.join(root, "stub", "main.js"));
  console.log(changed.length ? "branded:\n  " + changed.join("\n  ") : "already branded");
}
