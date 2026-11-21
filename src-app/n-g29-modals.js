// g29 clean-room: theme picker fuzzy suggest, promise-based prompt modal and
// numeric setting component (spec Part F).
function ng29SuggestItem(suggestion) {
  return suggestion && suggestion.item !== undefined ? suggestion.item : suggestion;
}

export function s04ThemePicker(host) {
  class ThemePicker extends host.FuzzySuggestModal {
    constructor(app) {
      super(app);
      this.initialTheme = app.customCss.theme;
      this.requestThemePreview = host.debounce((name) => this.previewTheme(name), 100, true);
      const cp = host.t.plugins.commandPalette;
      this.setInstructions([
        { command: "↑↓", purpose: cp.instructionNavigate() },
        { command: "↵", purpose: cp.instructionUse() },
        { command: "esc", purpose: cp.instructionDismiss() },
      ]);
      this.scope.register([], "Tab", () => false);
      this.scope.register([], "Enter", (event) => {
        if (event.isComposing) return;
        this.selectActiveSuggestion(event);
        return false;
      });
    }

    getItems() {
      const app = this.app;
      const items = [{ name: "", display: host.t.setting.appearance.labelDefaultTheme() }];
      for (const name in app.customCss.themes) items.push({ name, display: name });
      for (const name of app.customCss.oldThemes || []) {
        if (!(name in app.customCss.themes)) items.push({ name, display: name + " (Legacy)" });
      }
      return items;
    }

    getItemText(item) { return item.display; }

    renderSuggestion(suggestion, el) {
      if (super.renderSuggestion) super.renderSuggestion(suggestion, el);
      const item = ng29SuggestItem(suggestion);
      if (item && item.name === this.initialTheme && el && el.createSpan) {
        el.createSpan({ cls: "flair mod-pop", text: host.t.setting.appearance.labelCurrentlyActive() });
      }
    }

    onChooseItem(item) {
      this.app.customCss.setTheme(item.name);
    }

    onSelectedChange(suggestion, event) {
      if (event && event.instanceOf && event.instanceOf(KeyboardEvent)) {
        this.requestThemePreview(ng29SuggestItem(suggestion).name);
      }
    }

    previewTheme(name) {
      if (this.isOpen) this.app.customCss.setTheme(name);
    }

    onEscapeKey(event) {
      if (super.onEscapeKey) super.onEscapeKey(event);
      this.app.customCss.setTheme(this.initialTheme);
    }
  }
  return ThemePicker;
}
