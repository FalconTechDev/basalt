// g32 clean-room: one labelled row of the startup-time report.
export function ng32DefineStartupStat() {
  function Ng32StartupStat(containerEl) {
    this.rowEl = containerEl.createDiv("startup-stat");
    this.infoEl = this.rowEl.createDiv("startup-info");
  }

  Ng32StartupStat.prototype.setHeading = function (heading) {
    this.rowEl.toggleClass("mod-heading", heading);
    return this;
  };

  Ng32StartupStat.prototype.addLabel = function (text) {
    this.infoEl.createSpan({ cls: "startup-label", text });
    return this;
  };

  Ng32StartupStat.prototype.addDesc = function (text) {
    this.infoEl.createSpan({ cls: "startup-desc", text });
    return this;
  };

  Ng32StartupStat.prototype.addValue = function (text) {
    this.rowEl.createDiv({ cls: "startup-value", text });
    return this;
  };

  return Ng32StartupStat;
}
