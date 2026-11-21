// g35 clean-room: removable filter chip above the hotkey settings list and
// the status-filter id -> title map (spec g35, s29-chrome).

/** Filter chip widget: value + title + once-only remove callback. */
export function ng35DefineHotkeyFilterChip(host) {
  function HotkeyFilterChip(containerEl) {
    this.value = null;
    this.handleRemove = null;
    this.el = createDiv({ cls: "hotkey-filter" });
    this.innerEl = this.el.createDiv({
      cls: "hotkey-filter-inner",
      text: host.t.setting.hotkeys.labelShowAll(),
    });
    this.removeEl = this.el.createDiv("hotkey-filter-remove-button");
    host.setIcon(this.removeEl, "lucide-x");
    host.setTooltip(this.removeEl, host.t.interface.menu.close());
    if (containerEl) containerEl.appendChild(this.el);
  }
  HotkeyFilterChip.prototype.setValue = function (v) { this.value = v; return this; };
  HotkeyFilterChip.prototype.setTitle = function (t) {
    this.innerEl.textContent = t;
    return this;
  };
  HotkeyFilterChip.prototype.onRemove = function (cb) {
    this.handleRemove = cb;
    this.removeEl.addEventListener("click", () => this.remove());
    return this;
  };
  HotkeyFilterChip.prototype.remove = function () {
    this.value = null;
    if (!this.el.isShown()) return;
    this.el.remove();
    if (this.handleRemove) this.handleRemove();
  };
  return HotkeyFilterChip;
}

/** Filter id -> i18n title function (functions, not evaluated strings). */
export function ng35HotkeyFilterTitles(host) {
  const hk = host.t.setting.hotkeys;
  return {
    "show-all": hk.labelShowAll,
    "show-assigned": hk.labelShowAssigned,
    "show-user-assigned": hk.labelShowUserAssigned,
    "show-unassigned": hk.labelShowUnassigned,
  };
}
