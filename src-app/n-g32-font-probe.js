// g32 clean-room: installed-font probe feeding the font suggest cache.
import { idleOrTimeout } from "./metadata-helpers.js";
import { ng32SystemFontList, ng32FontProbeSeen } from "./n-g32-constants.js";

export const ng32FontCache = ["Inter", "Source Code Pro"];
export let ng32FontProbeDone = null;
const ng32FontSample = "abcdefghijklmnopqrstuvwxyz0123456789";
let ng32FontProbeStarted = false;

async function ng32ProbeFontNames(names, ctx, baseWidth) {
  let count = 0;
  for (const name of names) {
    if (ng32FontProbeSeen.has(name)) continue;
    ng32FontProbeSeen.add(name);
    ctx.font = `72px ${name}, monospace`;
    if (ctx.measureText(ng32FontSample).width !== baseWidth) ng32FontCache.push(name);
    if (++count % 10 === 0) await new Promise((resolve) => idleOrTimeout(resolve, 0));
  }
}

export function ng32StartFontProbe(host) {
  if (ng32FontProbeStarted) return ng32FontProbeDone;
  ng32FontProbeStarted = true;
  ng32FontProbeDone = (async () => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) {
      ng32FontCache.sort();
      return;
    }
    ctx.font = "72px monospace";
    const baseWidth = ctx.measureText(ng32FontSample).width;
    const tasks = [];
    if (host.Platform.isDesktopApp) {
      tasks.push((async () => {
        try {
          const fonts = await host.electronBridge("get-fonts").getFonts();
          await ng32ProbeFontNames(fonts || [], ctx, baseWidth);
        } catch (error) { /* probe source unavailable */ }
      })());
    }
    if (host.Platform.isMobileApp) {
      tasks.push((async () => {
        try {
          const result = await host.capacitorApp.getFonts();
          await ng32ProbeFontNames((result && result.fonts) || [], ctx, baseWidth);
        } catch (error) { /* probe source unavailable */ }
      })());
    }
    tasks.push(ng32ProbeFontNames(ng32SystemFontList, ctx, baseWidth));
    await Promise.all(tasks);
    ng32FontCache.sort();
  })();
  return ng32FontProbeDone;
}

export function ng32FontNames(host) {
  ng32StartFontProbe(host);
  return ng32FontCache;
}
