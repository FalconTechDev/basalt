// g30 clean-room: audio/image/video file views, media embed classes and the
// shared media-embed base (spec g30 part E). One parameterised factory per
// kind instead of three mirrored class bodies.
import {env} from "./env.js";
import {inherit} from "./inherit.js";

export function ng30Inherit(child, base) {
  return inherit(child, base);
}

export const ng30ViewTypeAudio = "audio";
export const ng30ViewTypeImage = "image";
export const ng30ViewTypeVideo = "video";

const NG30_VIEWS = [
  {
    key: "audio", viewType: ng30ViewTypeAudio, icon: "lucide-file-audio",
    extSet: "audioExtensions", boxClass: "audio-container",
    display: "Dc", stopMedia: true,
  },
  {
    key: "image", viewType: ng30ViewTypeImage, icon: "lucide-image",
    extSet: "mediaExtensions", boxClass: "image-container",
    display: "xc", stopMedia: false,
  },
  {
    key: "video", viewType: ng30ViewTypeVideo, icon: "lucide-video",
    extSet: "videoExtensions", boxClass: "video-container",
    display: "Ac", stopMedia: true,
  },
];

function ng30MediaView(host, spec) {
  function MediaView() {
    const self = host.EditableFileView.call(this) || this;
    self.icon = spec.icon;
    return self;
  }
  inherit(MediaView, host.EditableFileView);
  const proto = MediaView.prototype;
  proto.getViewType = function () { return spec.viewType; };
  proto.canAcceptExtension = function (ext) { return host[spec.extSet].contains(ext); };
  proto.onLoadFile = async function (file) {
    if (spec.stopMedia) env().Kc(this.contentEl);
    this.contentEl.empty();
    const box = this.contentEl.createDiv(spec.boxClass);
    await env()[spec.display](box, this.app.vault.getResourcePath(file));
  };
  MediaView.VIEW_TYPE = spec.viewType;
  MediaView.displayInEl = function (file, app, containerEl) {
    return env()[spec.display](containerEl, app.vault.getResourcePath(file));
  };
  return MediaView;
}

export function ng30AudioView(host) { return ng30MediaView(host, NG30_VIEWS[0]); }
export function ng30ImageView(host) { return ng30MediaView(host, NG30_VIEWS[1]); }
export function ng30VideoView(host) { return ng30MediaView(host, NG30_VIEWS[2]); }

// ---- embeds ---------------------------------------------------------------------------------------

let ng30MediaEmbedSlot = null; // {host, cls}

/** `eJ` — base class of the media embeds; stops playback on unload. */
export function ng30MediaEmbed(host) {
  function MediaEmbed(ctx, file) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.file = file;
    self.containerEl.classList.add("media-embed");
    return self;
  }
  inherit(MediaEmbed, host.Component);
  MediaEmbed.prototype.onunload = function () {
    env().Kc(this.containerEl);
    host.Component.prototype.onunload.call(this);
  };
  ng30MediaEmbedSlot = { host, cls: MediaEmbed };
  return MediaEmbed;
}

const NG30_EMBEDS = [
  { key: "image", className: "image-embed", view: "ImageView", factory: ng30ImageEmbed },
  { key: "audio", className: "audio-embed", view: "AudioView", factory: ng30AudioEmbed },
  { key: "video", className: "video-embed", view: "VideoView", factory: ng30VideoEmbed },
];

function ng30MediaEmbedKind(host, spec) {
  const slot = ng30MediaEmbedSlot;
  const Base = slot && slot.host === host ? slot.cls : env().eJ;
  function Embed(ctx, file) {
    const self = Base.call(this, ctx, file) || this;
    self.containerEl.classList.add(spec.className);
    return self;
  }
  inherit(Embed, Base);
  Embed.prototype.loadFile = function () {
    return host[spec.view].displayInEl(this.file, this.app, this.containerEl);
  };
  return Embed;
}

export function ng30ImageEmbed(host) { return ng30MediaEmbedKind(host, NG30_EMBEDS[0]); }
export function ng30AudioEmbed(host) { return ng30MediaEmbedKind(host, NG30_EMBEDS[1]); }
export function ng30VideoEmbed(host) { return ng30MediaEmbedKind(host, NG30_EMBEDS[2]); }
