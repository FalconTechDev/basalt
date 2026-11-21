// g36 clean-room: workspace layout names, release-notes constants, secrets
// storage keys, pane-type + desktop-only guards, the Capacitor SecureStorage
// bridge and the recent-file tracker (spec g36 Part C).
//
// All application values are read lazily through env(); host values only inside
// factory functions. Persistence key strings are contract — do not change.

import { env } from "./env.js";

// ---------------------------------------------------------------------------
// Constants (frozen contract strings)
// ---------------------------------------------------------------------------

export const ng36WorkspaceFileName = "workspace.json";
export const ng36WorkspaceMobileFileName = "workspace-mobile.json";
export const ng36ReleaseNotesViewType = "release-notes";
export const ng36ReleaseNotesRepo = "obsidianmd/obsidian-docs";
export const ng36SecretsWarningDismissedKey = "secrets-encryption-warning-dismissed";
export const ng36SecretsKey = "secrets";
export const ng36SecretsEncryptedKey = "secrets-encrypted";
export const ng36SecretsMetaKey = "secrets-meta";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Valid leaf split direction: boolean or one of the container keywords. */
export function ng36PaneType(direction) {
  if (typeof direction === "boolean") return direction;
  return direction === "tab" || direction === "window" || direction === "split" ? direction : false;
}

/** Throws (after showing a notice) when a desktop-only feature is unavailable. */
export function ng36DesktopOnly() {
  const e = env();
  if (!e.Yl.isDesktopApp) {
    const msg = e.gm.interface.msgDesktopOnlyFeature();
    new e.fb(msg);
    throw new Error(msg);
  }
  if (e.qf < 13) {
    const msg = e.gm.interface.msgUpgradeInstaller();
    new e.fb(msg);
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Capacitor SecureStorage bridge
// ---------------------------------------------------------------------------

const NG36_SECURE_WEB_CHUNK = 3357;
const NG36_SECURE_NATIVE_CHUNK = 9804;

/**
 * Registers the "SecureStorage" Capacitor plugin. Platform implementations are
 * lazy: the webpack chunks are only required when that platform is used.
 * `host.s04CapacitorCore` wins; env().s12capacitor is the same object in-app.
 */
export function ng36SecureStoreNative(host) {
  const e = env();
  const core = (host && host.s04CapacitorCore) || e.s12capacitor;
  let self = null;
  const load = (id) => () => Promise.resolve().then(() => {
    const req = env().s29Require || env().s12webpackRequire;
    return req(id);
  });
  self = core.F3("SecureStorage", {
    web: async () => new (await load(NG36_SECURE_WEB_CHUNK)()).SecureStorageWeb(),
    ios: async () => new (await load(NG36_SECURE_NATIVE_CHUNK)()).SecureStorageNative(self),
    android: async () => new (await load(NG36_SECURE_NATIVE_CHUNK)()).SecureStorageNative(self),
  });
  return self;
}
