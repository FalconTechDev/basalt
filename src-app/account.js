// Account, licence-key and remote vault/publish API client.
//
// Every path, field name and error shape below is the server contract: the sign-in flow, licence
// validation, vault provisioning and the publish screens all depend on it, so request bodies must
// stay exactly as they were. The API base URL and the fetch implementation are late-bound host
// values (the base switches to localhost in dev builds), read through hostEnv().

import { hostEnv } from "./vault.js";

const env = () => hostEnv();

// Server replies are plain JSON objects; a body with an `error` field is a failure.
class AccountError extends Error {
  constructor(response) {
    super(response.error);
    this.response = response;
    this.error = response.error;
  }
}

/** The class behind the inherited `vw` binding: thrown by acctRequest, matched with `instanceof`. */
export function defineAccountError() {
  return AccountError;
}

// localStorage key of the persisted account record (shared with nothing else; the value itself is
// part of the stored-data contract, so it must not change).
const ACCOUNT_STORAGE_KEY = "basalt-account";

// The signed-in account plus licence/subscription details. Only email, name, token, license and key
// survive a restart; validation results and company info are refreshed from the server.
class Account {
  constructor() {
    this.keyValidation = "";
    this.company = "";
    this.expiry = 0;
    this.seats = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEY));
      this.email = saved.email;
      this.name = saved.name;
      this.token = saved.token;
      this.license = saved.license;
      this.key = saved.key;
    } catch (e) {}
  }

  save() {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({
      email: this.email,
      name: this.name,
      token: this.token,
      license: this.license,
      key: this.key,
    }));
  }

  setKey(key) {
    this.key = key;
    this.save();
  }
}

export const account = new Account();

// POSTs a JSON body to the account API and returns the parsed reply. A reply containing `error`
// throws AccountError; anything else is returned as is (no HTTP status check, matching the wire
// contract the callers were written against).
export async function acctRequest(path, body) {
  const e = env();
  const res = await e.mw(e.dw + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if ("error" in data) throw new AccountError(data);
  return data;
}

function storeSession(accountState, res) {
  if (!res.token) return;
  accountState.token = res.token;
  accountState.email = res.email;
  accountState.name = res.name;
  accountState.license = res.license;
  accountState.save();
}

// ---- users and sessions ----

export function acctSignup(email, password, name, next) {
  return acctRequest("/user/signup", { email, password, name, next });
}

export function acctForgetPassword(email) {
  return acctRequest("/user/forgetpass", { email, captcha: "captcha" });
}

export function acctResendConfirmation(email, next) {
  return acctRequest("/user/resendconfirmation", { email, next });
}

export async function acctAuthToken(accountState, token) {
  const res = await acctRequest("/user/authtoken", { token });
  storeSession(accountState, res);
  return res;
}

export async function acctSignIn(accountState, email, password, mfa) {
  const res = await acctRequest("/user/signin", { email, password, mfa });
  storeSession(accountState, res);
  return res;
}

export async function acctSignOut(accountState) {
  try {
    await acctRequest("/user/signout", { token: accountState.token });
  } catch (err) {
    if (err.message !== "Not logged in") throw err;
  }
  accountState.token = "";
  accountState.email = "";
  accountState.name = "";
  accountState.license = "";
  accountState.save();
}

// Returns null when there is no token; rethrows server errors, clearing the local session first
// when the server says the token is no longer valid.
export async function acctUserInfo(accountState) {
  if (!accountState.token) return null;
  try {
    const res = await acctRequest("/user/info", { token: accountState.token });
    accountState.email = res.email;
    accountState.name = res.name;
    accountState.license = res.license;
    accountState.save();
    return res;
  } catch (err) {
    if (err.message === "Not logged in") {
      accountState.email = null;
      accountState.name = null;
      accountState.token = null;
      accountState.license = null;
      accountState.save();
    }
    throw err;
  }
}

// ---- subscriptions and licence keys ----

// Validates the stored business licence key. On an API error reply the key is dropped and the
// server's error text is kept in keyValidation; transport errors are ignored.
export async function acctValidateBusinessKey(accountState) {
  if (!accountState.key) return;
  try {
    const res = await acctRequest("/subscription/business", { key: accountState.key });
    accountState.keyValidation = "valid";
    accountState.company = res.company;
    accountState.expiry = res.expiry;
    accountState.seats = res.seats;
    accountState.save();
  } catch (err) {
    if (err instanceof AccountError) {
      accountState.key = null;
      accountState.keyValidation = err.error;
      accountState.save();
    }
  }
}

export function acctSignupMobileSync(token) {
  return acctRequest("/subscription/sync/signup-mobile", { token });
}

export function acctListSubscriptions(token) {
  return acctRequest("/subscription/list", { token });
}

// ---- remote vaults (sync) ----

export async function acctVaultRegions(token, host) {
  const res = await acctRequest("/vault/regions", { token, host });
  return res.regions;
}

// Vault records from the server predate encryption_version; normalize missing values to 0.
export function acctNormalizeVault(vault) {
  if (vault.encryption_version === undefined) vault.encryption_version = 0;
}

export async function acctListVaults(token) {
  const res = await acctRequest("/vault/list", { token, supported_encryption_version: 3 });
  res.vaults.forEach(acctNormalizeVault);
  res.shared.forEach(acctNormalizeVault);
  return res;
}

export async function acctCreateVault(token, name, keyhash, salt, region, encryptionVersion) {
  const res = await acctRequest("/vault/create", {
    token, name, keyhash, salt, region, encryption_version: encryptionVersion,
  });
  acctNormalizeVault(res);
  return res;
}

export function acctMigrateVault(token, vaultUid, keyhash, salt, region, encryptionVersion) {
  return acctRequest("/vault/migrate", {
    token, vault_uid: vaultUid, keyhash, salt, region, encryption_version: encryptionVersion,
  });
}

export function acctRenameVault(token, vaultUid, name) {
  return acctRequest("/vault/rename", { token, vault_uid: vaultUid, name });
}

export function acctRemoveVaultShare(token, vaultUid, shareUid) {
  return acctRequest("/vault/share/remove", { token, vault_uid: vaultUid, share_uid: shareUid });
}

export function acctVaultAccess(token, vaultUid, keyhash, host, encryptionVersion) {
  return acctRequest("/vault/access", {
    token, vault_uid: vaultUid, keyhash, host, encryption_version: encryptionVersion,
  });
}

// ---- publish sites ----

export function acctDeletePublishSite(token, siteUid) {
  return acctRequest("/publish/delete", { token, site_uid: siteUid });
}

export function acctInvitePublishShare(token, siteUid, email) {
  return acctRequest("/publish/share/invite", { token, site_uid: siteUid, email });
}

export function acctRemovePublishShare(token, siteUid, shareUid) {
  return acctRequest("/publish/share/remove", { token, site_uid: siteUid, share_uid: shareUid });
}
