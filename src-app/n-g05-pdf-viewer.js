// g05 clean-room: the manifest-facing factories for the pdf viewer classes.
// Each factory memoises its class per host so `instanceof` stays stable across
// callers; cross-class lookups go through ng05PdfKitGet and resolve lazily.
import { ng05BuildPasswordDialog, ng05BuildToolbar } from "./n-g05-pdf-dialog.js";
import { ng05BuildController } from "./n-g05-pdf-controller.js";
import { ng05BuildComponent, ng05BuildView, ng05BuildEmbed } from "./n-g05-pdf-component.js";

const ng05Kit = new WeakMap(); // host -> { key: class }

/** Lazily builds (once per host) and returns a named class from the kit. */
export function ng05PdfKitGet(host, key, build) {
  let slot = ng05Kit.get(host);
  if (!slot) ng05Kit.set(host, slot = {});
  return slot[key] || (slot[key] = build());
}

export function ng05PdfPasswordDialogClass(host) {
  return ng05PdfKitGet(host, "password", () => ng05BuildPasswordDialog(host));
}
export function ng05PdfToolbarClass(host) {
  return ng05PdfKitGet(host, "toolbar", () => ng05BuildToolbar(host));
}
export function ng05PdfViewerClass(host) {
  // prefetch the pdf.js runtime once the window has loaded; earlier attempts
  // would race the app's script loader against module MIME checks, and the
  // loader caches its promise so a failed early attempt poisons every retry
  const warm = () => {
    try { Promise.resolve(host.s27LoadPdfViewer()).catch(() => {}); } catch (e) {}
  };
  // wait until the app reports ready: by then any CDP-driven shim is in place,
  // and the script loader's cached promise is only created on first use
  const poll = setInterval(() => {
    try {
      if (window.app && window.app.workspace && window.app.workspace.layoutReady) {
        clearInterval(poll); clearTimeout(fallback); warm();
      }
    } catch (e) {}
  }, 500);
  const fallback = setTimeout(() => { clearInterval(poll); warm(); }, 20000);
  if (typeof window === "undefined") { clearInterval(poll); clearTimeout(fallback); warm(); }
  return ng05PdfKitGet(host, "controller", () => ng05BuildController(host));
}
export function ng05PdfComponentClass(host) {
  return ng05PdfKitGet(host, "component", () => ng05BuildComponent(host));
}
export function ng05PdfViewClass(host) {
  return ng05PdfKitGet(host, "view", () => ng05BuildView(host));
}
export function ng05PdfEmbedClass(host) {
  return ng05PdfKitGet(host, "embed", () => ng05BuildEmbed(host));
}
