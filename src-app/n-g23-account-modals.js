// g23 clean-room: login + commercial-licence dialogs (spec g23 §2.7/§3.7).
import { inherit } from "./inherit.js";
import { ng23T } from "./n-g23-util.js";
import { account, acctSignIn, acctValidateBusinessKey, AccountError } from "./n-g23-account.js";

const ACCT_T = (host, key, fb, arg) => ng23T(host, "setting.account." + key, fb, arg);
const ABOUT_T = (host, key, fb, arg) => ng23T(host, "setting.about." + key, fb, arg);
const NG23IF_T = (host, key, fb) => ng23T(host, "interface." + key, fb);

export const NG23_WIKI_URL = "https://github.com/FalconTechDev/basalt/wiki";
export const NG23_REPO_URL = "https://github.com/FalconTechDev/basalt";

// ===========================================================================
// LoginModal (orig R7): sign-in form with lazy MFA reveal.
// ===========================================================================

export function defineLoginModal(host) {
  function LoginModal(app) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-lg", "mod-form");
    self.setTitle(ACCT_T(host, "labelLogIn", "Log in"));

    const content = self.contentEl;
    content.empty();

    // loader cube (hidden until a request runs)
    const loader = content.createDiv("loader-cube");
    loader.hide();
    for (let i = 1; i <= 9; i++) loader.createDiv("sk-cube sk-cube" + i);
    self._loader = loader;

    const body = content.createDiv("mod-form-content");
    self._body = body;

    // error line
    const errWrap = body.createDiv("message-container");
    const errEl = errWrap.createDiv("message mod-error");
    errEl.hide();
    self._errorEl = errEl;

    const mkField = (opts) => {
      const p = body.createEl("p", { cls: "form-field" });
      if (opts.label) p.createEl("label", { cls: "input-label", text: opts.label });
      const input = p.createEl("input", {
        attr: {
          type: opts.type,
          autocomplete: opts.autocomplete,
          placeholder: opts.placeholder,
        },
      });
      if (opts.maxLength) input.setAttribute("maxlength", String(opts.maxLength));
      if (opts.inputMode) input.setAttribute("inputmode", opts.inputMode);
      input.addEventListener("input", () => { input.value = opts.sanitize ? opts.sanitize(input.value) : input.value; });
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter") self.login();
      });
      return { p, input };
    };

    const emailF = mkField({
      type: "email",
      autocomplete: "email",
      label: ACCT_T(host, "labelEmail", "Email"),
      placeholder: ACCT_T(host, "placeholderEmail", "Email"),
    });
    self._emailP = emailF.p;
    self._email = emailF.input;

    const passF = mkField({
      type: "password",
      autocomplete: "current-password",
      label: ACCT_T(host, "labelPassword", "Password"),
      placeholder: ACCT_T(host, "placeholderPassword", "Password"),
    });
    self._passP = passF.p;
    self._pass = passF.input;

    const mfaF = mkField({
      type: "text",
      autocomplete: "one-time-code",
      inputMode: "numeric",
      maxLength: 6,
      label: ACCT_T(host, "labelMfaCode", "6-digit 2FA code"),
      placeholder: ACCT_T(host, "labelMfaCode", "6-digit 2FA code"),
      sanitize: (v) => v.replace(/\D/g, "").slice(0, 6),
    });
    self._mfaP = mfaF.p;
    self._mfa = mfaF.input;
    self._mfaP.hide();

    // forgot-password link
    const forgot = body.createEl("a", {
      cls: "mod-secondary",
      text: ACCT_T(host, "labelForgotPassword", "Forgot password?"),
      attr: { href: NG23_REPO_URL, target: "_blank", rel: "noopener" },
    });
    forgot.addEventListener("click", (event) => {
      event.preventDefault();
      try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
    });

    self.addButton("mod-cta", ACCT_T(host, "buttonLogin", "Sign in"), () => self.login());
    self.addCancelButton();
    return self;
  }
  inherit(LoginModal, host.ButtonModal);
  const proto = LoginModal.prototype;

  proto._showError = function (text) {
    this._errorEl.setText(text || "");
    this._errorEl.show();
  };

  proto._hideError = function () {
    this._errorEl.hide();
  };

  proto.login = async function () {
    const self = this;
    this._hideError();
    const email = this._email.value.trim();
    const password = this._pass.value;
    const mfa = this._mfa.value.trim();
    if (!email) { this._showError(ACCT_T(host, "messageEmptyEmail", "Please enter your email.")); return true; }
    if (!email.includes("@")) { this._showError(ACCT_T(host, "messageInvalidEmail", "Please enter a valid email.")); return true; }
    if (!password) { this._showError(ACCT_T(host, "messageEmptyPassword", "Please enter your password.")); return true; }
    if (mfa && !/^\d{6}$/.test(mfa)) { this._showError(ACCT_T(host, "mfaWrongFormat", "The code must be 6 digits.")); return true; }

    this._loader.show();
    this._body.hide();
    try {
      await acctSignIn(account, email, password, mfa || undefined);
      this.close();
      return false;
    } catch (err) {
      if (err instanceof AccountError) {
        const msg = String(err.message || "");
        if (msg.indexOf("2FA code is incorrect") >= 0) {
          this._showError(ACCT_T(host, "mfaVerificationFailed", "Incorrect authentication code."));
        } else if (msg.indexOf("2FA code") >= 0) {
          this._emailP.hide();
          this._passP.hide();
          this._mfaP.show();
          this._showError(err.error || msg);
        } else {
          this._showError(err.error || msg);
        }
      } else {
        this._showError(ACCT_T(host, "messageLoginFailed", "Login failed. Please try again."));
      }
      return true;
    } finally {
      self._loader.hide();
      self._body.show();
    }
  };

  return LoginModal;
}
// ===========================================================================
// LicenseModal (orig B7): commercial licence key activation.
// ===========================================================================

export function defineLicenseModal(host) {
  function LicenseModal(app) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-lg", "mod-form");
    self.setTitle(ABOUT_T(host, "labelCommercialLicense", "Commercial licence"));

    const content = self.contentEl;
    content.empty();

    const errWrap = content.createDiv("message-container");
    const errEl = errWrap.createDiv("message mod-error");
    errEl.hide();
    self._errorEl = errEl;

    const p = content.createEl("p", { cls: "form-field" });
    p.createEl("label", { cls: "input-label", text: ABOUT_T(host, "labelLicenseKey", "Licence key") });
    const input = p.createEl("input", {
      attr: {
        type: "text",
        placeholder: ABOUT_T(host, "licenseKeyPlaceholder", "Licence key"),
        autocomplete: "off",
      },
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        Promise.resolve(self.activate()).then((result) => { if (result === false) self.close(); });
      }
    });
    self._input = input;

    // learn-more link (hidden on Android)
    if (!(host.Platform && host.Platform.isAndroidApp)) {
      content.createEl("a", {
        cls: "mod-secondary",
        text: NG23IF_T(host, "buttonLearnMore", "Learn more"),
        attr: { href: NG23_WIKI_URL, target: "_blank", rel: "noopener" },
      });
    }

    self.addButton("mod-cta", ABOUT_T(host, "buttonActivate", "Activate"), () => self.activate());
    self.addCancelButton();
    return self;
  }
  inherit(LicenseModal, host.ButtonModal);
  const proto = LicenseModal.prototype;

  proto._showError = function (text) {
    this._errorEl.setText(text || "");
    this._errorEl.show();
  };

  proto.activate = async function () {
    this._errorEl.hide();
    account.key = this._input.value.trim();
    await acctValidateBusinessKey(account);
    if (account.keyValidation === "valid") return false; // close the dialog
    this._showError(account.keyValidation || ABOUT_T(host, "labelInvalidCommercialLicense", "Invalid licence key"));
    return true; // keep open
  };

  return LicenseModal;
}

