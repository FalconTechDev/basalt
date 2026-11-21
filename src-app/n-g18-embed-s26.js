import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";

// g18 / s26-embed.js — iOS editor extensions, the Bases (.base) file embed and
// the public HoverPopover.create entry point. Host/env access stays lazy.

export function ng18IosEditorExtensions() {
  return [env().P$, env().L$];
}

export function ng18BasesEmbedView(host) {
  /** Embed of a `.base` file inside markdown: hosts a Bases query controller
   *  whose edits are written back to the file after a debounce. */
  function BasesEmbed(app, plugin, info, file, viewName) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.plugin = plugin;
    self.file = file;
    self.containerEl = info.containerEl;
    self.containerEl.addClass("bases-embed", "interactive-child");
    self.containingFile = app.vault.getFileByPath(info.sourcePath);
    self.viewName = viewName;
    self.linkText = info.linktext;
    self.controller = new (env().C$)(app, plugin, self.containerEl, self.containingFile);
    self.addChild(self.controller);
    self.requestSave = host.debounce((query) => {
      app.vault.modify(file, query.toString());
    }, 1000);
    return self;
  }
  inherit(BasesEmbed, host.Component);
  const proto = BasesEmbed.prototype;

  proto.loadQuery = async function () {
    const text = await this.app.vault.read(this.file);
    const query = env().EY.fromString(text);
    query.file = this.file;
    query.saveFn = () => {
      this.controller.setQuery(query);
      this.requestSave(query);
    };
    return query;
  };

  proto.loadFile = async function () {
    let query;
    try {
      query = await this.loadQuery();
    } catch (err) {
      query = err;
    }
    this.controller.clear();
    this.controller.setQueryAndView(query, this.viewName);
  };

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file !== this.file) return;
      (async () => {
        let query;
        try {
          query = await this.loadQuery();
        } catch (err) {
          query = err;
        }
        this.controller.setQuery(query);
      })();
    }));
  };

  return BasesEmbed;
}

export function ng18HoverPopover(host) {
  /** Hover popover that lazily embeds the hovered link's target; doubles as
   *  the entry point used by page previews (`HoverPopover.create`). */
  const Base = env().rX;
  function HoverPopover() {
    const self = Base.apply(this, arguments) || this;
    self.embed = null;
    return self;
  }
  inherit(HoverPopover, Base);

  HoverPopover.create = async function (options) {
    const app = options.app;
    const waitTime = options.waitTime || 0;
    const popover = new HoverPopover(options.hoverParent, options.targetEl, waitTime, options.position);
    await host.sleep(Math.max(0, waitTime - 100));
    if (popover.state === host.PopoverState.Hidden) return null;

    const hoverEl = popover.hoverEl;
    const embedContainer = hoverEl.createDiv();
    const embed = host.EmbedLoader.load({
      app,
      linktext: options.linktext,
      sourcePath: options.sourcePath,
      containerEl: embedContainer,
      state: options.state,
      depth: 0,
    });
    if (embed) {
      popover.embed = embed;
      const enterEdit = () => {
        popover.setIsFocused(true);
        hoverEl.addClass("is-editing");
        const scope = new host.Scope(app.scope);
        app.keymap.pushScope(scope);
        popover.register(() => app.keymap.popScope(scope));
        const doc = hoverEl.doc || window.document;
        const onClick = (evt) => {
          if (!hoverEl.contains(evt.targetNode)) popover.hide();
        };
        doc.addEventListener("click", onClick);
        popover.register(() => doc.removeEventListener("click", onClick));
      };
      const editorAt = (point) => {
        embed.showEditor(point);
        if (embed.editMode) embed.editMode.register(() => popover.hide());
      };
      if (embed instanceof host.s13BasesEmbedView) {
        host.nativeDblClick(hoverEl, () => enterEdit());
      } else if (embed instanceof host.MarkdownEmbedBase) {
        const state = options.state;
        if (state && state.mode === "source") {
          app.workspace.activeEditor = embed;
          editorAt();
        } else {
          host.nativeDblClick(hoverEl, (evt) => {
            enterEdit();
            const target = evt.targetNode;
            if (!target || !host.isEditableTarget(target)) {
              editorAt({ x: evt.clientX, y: evt.clientY });
            }
          });
        }
      }
      popover.watchResize(hoverEl);
      popover.addChild(embed);
      await embed.loadFile();
    }
    if (popover.state === host.PopoverState.Shown) popover.position();
    return popover;
  };

  return HoverPopover;
}
