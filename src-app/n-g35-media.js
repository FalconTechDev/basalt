// g35 clean-room: audio and image file views (spec g35, s26-media).
// Superseded in the bundle by the s11 slice; behaviour is kept for the export
// contract. Both views share one parameterized base.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

function ng35MediaView(host, viewType, icon, containerClass, display) {
  function MediaView() {
    host.EditableFileView.apply(this, arguments);
    this.icon = icon;
  }
  inherit(MediaView, host.EditableFileView);
  MediaView.VIEW_TYPE = viewType;
  MediaView.prototype.getViewType = function () { return viewType; };
  MediaView.prototype.canAcceptExtension = function (ext) {
    return (viewType === "audio" ? host.audioExtensions : host.imageExtensions).contains(ext);
  };
  MediaView.prototype.onLoadFile = async function (file) {
    env().Kc(this.contentEl);
    this.contentEl.empty();
    const container = this.contentEl.createDiv(containerClass);
    await MediaView.displayInEl(file, this.app, container);
  };
  MediaView.displayInEl = async function (file, app, containerEl) {
    return display(containerEl, app.vault.getResourcePath(file));
  };
  return MediaView;
}

export const ng35AudioViewType = "audio";
export const ng35ImageViewType = "image";

export function ng35AudioView(host) {
  return ng35MediaView(host, "audio", "lucide-file-audio", "audio-container",
    (el, path) => env().Dc(el, path));
}

export function ng35ImageView(host) {
  return ng35MediaView(host, "image", "lucide-image", "image-container",
    (el, path) => env().xc(el, path));
}
