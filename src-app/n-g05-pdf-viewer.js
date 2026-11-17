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
