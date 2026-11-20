// g32 clean-room: "rate the app" banner for the mobile settings window.
import { runTransition } from "./animation.js";
import { ng15AnimateCollapse } from "./n-g15-tree.js";
import { ng32MobileFeedbackFlag } from "./n-g32-constants.js";
import { ng32FeedbackShouldShow } from "./n-g32-feedback-gate.js";

export function ng32DefineFeedbackBanner(host) {
  function Ng32FeedbackBanner(app, parentEl) {
    this.app = app;
    this.containerEl = parentEl.createDiv({ cls: "feedback-banner-container" });
    this.containerEl.hide();
    this.bannerEl = this.containerEl.createDiv("feedback-banner");
    this.bannerEl.createDiv({ cls: "feedback-banner-title", text: host.i18n.interface.mobile.feedback.labelFeedback() });
    const content = this.bannerEl.createDiv("feedback-banner-content");
    content.createDiv({ cls: "feedback-banner-body", text: host.i18n.interface.mobile.feedback.labelFeedbackDesc() });
    content.createEl("button", { text: host.i18n.interface.mobile.feedback.actionRate() })
      .addEventListener("click", () => this.submitRating());
    content.createDiv({ cls: "feedback-banner-dismiss-button", text: host.i18n.interface.mobile.feedback.actionDismiss() })
      .addEventListener("click", () => {
        localStorage.setItem(ng32MobileFeedbackFlag, "1");
        this.hide();
      });
  }

  Ng32FeedbackBanner.prototype.shouldShow = function () {
    return ng32FeedbackShouldShow(this.app, host);
  };

  Ng32FeedbackBanner.prototype.show = async function () {
    if (await this.shouldShow()) this.containerEl.show();
  };

  Ng32FeedbackBanner.prototype.hide = async function () {
    const height = this.containerEl.offsetHeight || 0;
    this.containerEl.style.height = `${height}px`;
    const spec = new host.Transition({ duration: 150, fn: "cubic-bezier(0.45,0.05,0.55,0.95)" });
    spec.addProp("height", `${height}px`, "0px", "")
      .addProp("opacity", "1", "0", "")
      .addProp("transform", "scaleY(1)", "scaleY(0)", "");
    runTransition(this.bannerEl, spec, () => {});
    await host.sleep(70);
    await ng15AnimateCollapse(this.containerEl);
    this.containerEl.hide();
  };

  Ng32FeedbackBanner.prototype.submitRating = async function () {
    localStorage.setItem(ng32MobileFeedbackFlag, "1");
    await host.s16ReviewApi.requestReview();
    await host.sleep(400);
    await this.hide();
  };

  return Ng32FeedbackBanner;
}
