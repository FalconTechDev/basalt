// g40 clean-room: ViewHeader — nav-button row above explorer/bookmarks/outline
// panes, plus a ready-made sort menu button (spec g40 Part C).

export function ng40DefineViewHeader(host) {
  function ViewHeader(app, containerEl) {
    this.app = app;
    const header = (this.navHeaderEl = createDiv("nav-header"));
    this.navButtonsEl = header.createDiv("nav-buttons-container");
    containerEl.prepend(header);
  }

  ViewHeader.prototype.addNavButton = function (icon, tooltip, onClick, extraClass) {
    const button = this.navButtonsEl.createDiv("clickable-icon nav-action-button");
    if (extraClass) for (const c of extraClass.split(/\s+/)) if (c) button.classList.add(c);
    button.addEventListener("click", onClick);
    host.setIcon(button, icon);
    host.setTooltip(button, tooltip);
    return button;
  };

  ViewHeader.prototype.addSortButton = function (groups, labels, onPick, current) {
    const labelOf = typeof labels === "function" ? labels : (key) => labels[key]();
    const button = this.addNavButton("lucide-sort-asc", host.t.plugins.fileExplorer.actionChangeSort(), (event) => {
      event.preventDefault();
      if (button.classList.contains("has-active-menu")) return;
      const menu = new host.Menu().setNoIcon();
      for (const group of groups) {
        for (const key of group) {
          menu.addItem((item) => item
            .setTitle(labelOf(key))
            .setChecked(key === current())
            .onClick(() => onPick(key)));
        }
        menu.addSeparator();
      }
      menu.setParentElement(button);
      menu.showAtMouseEvent(event);
    });
    return button;
  };

  return ViewHeader;
}
