// g32 clean-room: reveal.js deck overlay lifecycle.
import { env } from "./env.js";
import { ng32SlidesBuildDom } from "./n-g32-slides-dom.js";

let ng32SlidesViewClass = null;

export function ng32DefineSlidesView() {
  if (ng32SlidesViewClass) return ng32SlidesViewClass;
  const Component = env().jm;

  class Ng32SlidesView extends Component {
    constructor(app) {
      super(app);
      this.app = app;
      this.containerEl = null;
      this.revealEl = null;
      this.slidesEl = null;
      this.themeCssEl = null;
      this.revealCssEl = null;
      this.deck = null;
      this.scope = new (env().Ng)();
      this.scope.register([], "Escape", () => {
        this.close();
        return false;
      });
    }

    async openFile(file) {
      this.destroy();
      this.app.keymap.pushScope(this.scope);
      const text = await this.app.vault.read(file);
      try {
        const dom = await ng32SlidesBuildDom(this.app, file, text, (child) => this.addChild(child));
        this.containerEl = dom.containerEl;
        this.revealEl = dom.revealEl;
        this.slidesEl = dom.slidesEl;
        this.themeCssEl = dom.themeCssEl;
        this.revealCssEl = dom.revealCssEl;
        dom.closeBtn.addEventListener("click", () => this.close());
        await env().M9.promise;
        this.deck = new Reveal(this.revealEl, {
          embedded: true, keyboardCondition: "focused", controlsTutorial: false, overview: false,
        }).initialize();
        setTimeout(() => this.revealEl.dispatchEvent(new PointerEvent("pointerdown")), 0);
      } catch (error) {
        console.error(error);
        this.close();
      }
    }

    close() {
      return this.destroy();
    }

    destroy() {
      this.app.keymap.popScope(this.scope);
      const detach = (el) => {
        if (!el) return;
        if (el.detach) el.detach(); else el.remove();
      };
      detach(this.containerEl);
      detach(this.revealCssEl);
      detach(this.themeCssEl);
      this.containerEl = null;
      this.revealEl = null;
      this.slidesEl = null;
      this.themeCssEl = null;
      this.revealCssEl = null;
      if (this.deck) {
        this.deck.destroy();
        this.deck = null;
      }
    }
  }

  ng32SlidesViewClass = Ng32SlidesView;
  return Ng32SlidesView;
}
