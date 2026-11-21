// g27 registry: ViewRegistry (orig p0) — app.viewRegistry. Maps view-type
// names to creator functions and file extensions to view types; seeds itself
// with the built-in views. An Events subclass so on/off/trigger/offref work.
import { inherit, methods } from "./n-g27-inherit.js";

export function defineViewRegistry(host) {
  function ViewRegistry() {
    const self = host.Events.call(this) || this;
    self.viewByType = {};
    self.typeByExtension = {};
    const builtins = [
      [host.markdownExtensions, host.MarkdownView, host.MarkdownView.VIEW_TYPE],
      [host.imageExtensions, host.ImageView, host.ImageView.VIEW_TYPE],
      [host.audioExtensions, host.AudioView, host.AudioView.VIEW_TYPE],
      [host.videoExtensions, host.VideoView, host.VideoView.VIEW_TYPE],
      [host.pdfExtensions, host.PdfView, host.PdfView.VIEW_TYPE],
      [null, host.ReleaseNotesView, host.releaseNotesType],
    ];
    for (const [extensions, ViewClass, type] of builtins) {
      const creator = (leaf) => new ViewClass(leaf);
      if (extensions) self.registerViewWithExtensions(extensions, type, creator);
      else self.registerView(type, creator);
    }
    return self;
  }
  inherit(ViewRegistry, host.Events);

  methods(ViewRegistry, {
    registerView(type, creator) {
      if (Object.prototype.hasOwnProperty.call(this.viewByType, type)) {
        throw new Error('Attempting to register an existing view type "' + type + '"');
      }
      this.viewByType[type] = creator;
      this.trigger("view-registered", type);
    },

    unregisterView(type) {
      if (!Object.prototype.hasOwnProperty.call(this.viewByType, type)) return;
      delete this.viewByType[type];
      this.trigger("view-unregistered", type);
    },

    registerExtensions(extensions, type) {
      // all-or-nothing: validate every extension before writing any
      for (const ext of extensions) {
        if (Object.prototype.hasOwnProperty.call(this.typeByExtension, ext)) {
          throw new Error('Attempting to register an existing file extension "' + ext + '"');
        }
      }
      for (const ext of extensions) this.typeByExtension[ext] = type;
      this.trigger("extensions-updated");
    },

    unregisterExtensions(extensions) {
      for (const ext of extensions) delete this.typeByExtension[ext];
      this.trigger("extensions-updated");
    },

    registerViewWithExtensions(extensions, type, creator) {
      this.registerView(type, creator);
      if (extensions) this.registerExtensions(extensions, type);
    },

    getViewCreatorByType(type) {
      return this.viewByType[type];
    },

    getTypeByExtension(ext) {
      return this.typeByExtension[ext];
    },

    isExtensionRegistered(ext) {
      return Object.prototype.hasOwnProperty.call(this.typeByExtension, ext);
    },
  });

  return ViewRegistry;
}
