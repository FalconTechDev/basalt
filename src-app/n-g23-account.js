// g23 clean-room: account/licence API client + persisted account record.
// Spec g23 §2.7/§3.7. All HTTP goes through env().mw (fetch) against env().dw.
import { env } from "./env.js";

export const NG23_ACCOUNT_STORAGE_KEY = "basalt-account";

/** Error thrown by acctRequest for any JSON body carrying an `error` field. */
export class AccountError extends Error {
  constructor(response) {
    const message = response && response.error ? String(response.error) : "Account error";
    super(message);
    this.name = "AccountError";
    this.response = response;
    this.error = response && response.error;
  }
}

/** Manifest class factory for orig vw. */
export function defineAccountError(host) {
  return AccountError;
}

function ng23AcctPersisted() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(NG23_ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch (err) {
    return null;
  }
}

function ng23AcctField(value) {
  return value === undefined || value === null ? "" : value;
}

/** The persisted account record (orig Hw declarator -> __basaltOwn.account). */
export const account = (() => {
  const saved = ng23AcctPersisted() || {};
  const rec = {
    email: saved.email,
    name: saved.name,
    token: saved.token,
    license: saved.license,
    key: saved.key,
    keyValidation: undefined,
    company: undefined,
    expiry: undefined,
    seats: undefined,
    save() {
      try {
        const data = {
          email: ng23AcctField(rec.email),
          name: ng23AcctField(rec.name),
          token: ng23AcctField(rec.token),
          license: ng23AcctField(rec.license),
          key: ng23AcctField(rec.key),
        };
        globalThis.localStorage.setItem(NG23_ACCOUNT_STORAGE_KEY, JSON.stringify(data));
      } catch (err) {}
    },
    setKey(key) {
      rec.key = key;
      rec.save();
    },
  };
  return rec;
})();
/** POST JSON to the account API; any body with an `error` field is a failure. */
export async function acctRequest(path, body) {
  const res = await env().mw(env().dw + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "error")) {
    throw new AccountError(data);
  }
  return data;
}

function ng23AcctIsNotLoggedIn(err) {
  return err instanceof AccountError && err.message === "Not logged in";
}

/** Stores the session fields when the response carries a token. */
function ng23AcctStoreSession(res) {
  if (res && res.token) {
    account.token = res.token;
    account.email = res.email;
    account.name = res.name;
    account.license = res.license;
    account.save();
  }
  return res;
}

// ---- session endpoints -------------------------------------------------

export async function acctSignup(email, password, name, next) {
  return acctRequest("/user/signup", { email, password, name, next });
}

export async function acctForgetPassword(email) {
  return acctRequest("/user/forgetpass", { email, captcha: "captcha" });
}

export async function acctResendConfirmation(email, next) {
  return acctRequest("/user/resendconfirmation", { email, next });
}

export async function acctAuthToken(token) {
  return ng23AcctStoreSession(await acctRequest("/user/authtoken", { token }));
}

export async function acctSignIn(accountArg, email, password, mfa) {
  const res = await acctRequest("/user/signin", { email, password, mfa });
  ng23AcctStoreSession(res);
  return res;
}

export async function acctSignOut(accountArg) {
  const target = accountArg || account;
  try {
    await acctRequest("/user/signout", { token: target.token });
  } catch (err) {
    if (!ng23AcctIsNotLoggedIn(err)) throw err;
  }
  target.token = "";
  target.email = "";
  target.name = "";
  target.license = "";
  target.save();
}

export async function acctUserInfo(accountArg) {
  const target = accountArg || account;
  if (!target.token) return null;
  let res;
  try {
    res = await acctRequest("/user/info", { token: target.token });
  } catch (err) {
    if (ng23AcctIsNotLoggedIn(err)) {
      target.email = "";
      target.name = "";
      target.token = "";
      target.license = "";
      target.save();
    }
    throw err;
  }
  if (res) {
    if (res.email !== undefined) target.email = res.email;
    if (res.name !== undefined) target.name = res.name;
    if (res.license !== undefined) target.license = res.license;
    target.save();
  }
  return res;
}

export async function acctValidateBusinessKey(accountArg) {
  const target = accountArg || account;
  if (!target.key) return;
  try {
    const res = await acctRequest("/subscription/business", { key: target.key });
    target.keyValidation = "valid";
    target.company = res && res.company;
    target.expiry = res && res.expiry;
    target.seats = res && res.seats;
    target.save();
  } catch (err) {
    if (err instanceof AccountError) {
      target.key = null;
      target.keyValidation = err.error;
      target.save();
    }
  }
}
export async function acctSignupMobileSync(token) {
  return ng23AcctStoreSession(await acctRequest("/subscription/sync/signup-mobile", { token }));
}

export async function acctListSubscriptions(token) {
  return acctRequest("/subscription/list", { token });
}

// ---- remote vaults -----------------------------------------------------

export async function acctVaultRegions(token, host) {
  const res = await acctRequest("/vault/regions", { token, host });
  return res && res.regions;
}

export function acctNormalizeVault(vault) {
  if (vault && vault.encryption_version === undefined) vault.encryption_version = 0;
  return vault;
}

export async function acctListVaults(token) {
  const res = await acctRequest("/vault/list", { token, supported_encryption_version: 3 });
  if (res && Array.isArray(res.vaults)) res.vaults.forEach(acctNormalizeVault);
  if (res && Array.isArray(res.shared)) res.shared.forEach(acctNormalizeVault);
  return res;
}

export async function acctCreateVault(token, name, keyhash, salt, region, encryption_version) {
  return acctRequest("/vault/create", { token, name, keyhash, salt, region, encryption_version });
}

export async function acctMigrateVault(token, vault_uid, keyhash, salt, region, encryption_version) {
  return acctRequest("/vault/migrate", { token, vault_uid, keyhash, salt, region, encryption_version });
}

export async function acctRenameVault(token, vault_uid, name) {
  return acctRequest("/vault/rename", { token, vault_uid, name });
}

export async function acctDeleteVault(token, vault_uid) {
  return acctRequest("/vault/delete", { token, vault_uid });
}

export async function acctListVaultShares(token, vault_uid) {
  return acctRequest("/vault/share/list", { token, vault_uid });
}

export async function acctInviteVaultShare(token, vault_uid, email) {
  return acctRequest("/vault/share/invite", { token, vault_uid, email });
}

export async function acctRemoveVaultShare(token, vault_uid, share_uid) {
  return acctRequest("/vault/share/remove", { token, vault_uid, share_uid });
}

export async function acctVaultAccess(token, vault_uid, keyhash, host, encryption_version) {
  return acctRequest("/vault/access", { token, vault_uid, keyhash, host, encryption_version });
}

// ---- publish sites -----------------------------------------------------

export async function acctDeletePublishSite(token, site_uid) {
  return acctRequest("/publish/delete", { token, site_uid });
}

export async function acctInvitePublishShare(token, site_uid, email) {
  return acctRequest("/publish/share/invite", { token, site_uid, email });
}

export async function acctRemovePublishShare(token, site_uid, share_uid) {
  return acctRequest("/publish/share/remove", { token, site_uid, share_uid });
}

export async function acctListPublishSites(token) {
  return acctRequest("/publish/list", { token });
}

export async function acctCreatePublishSite(token) {
  return acctRequest("/publish/create", { token });
}

export async function acctListPublishShares(token, site_uid) {
  return acctRequest("/publish/share/list", { token, site_uid });
}

export async function acctAcceptPublishShare(token, code) {
  return acctRequest("/publish/share/accept", { token, code });
}

