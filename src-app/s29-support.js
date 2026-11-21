// Compatibility shim: the g36 implementation lives in n-g36-support.js and
// n-g36-recent.js; acceptance tests import this historical path directly.
import { ng36WorkspaceFileName, ng36WorkspaceMobileFileName, ng36ReleaseNotesViewType, ng36ReleaseNotesRepo, ng36SecretsWarningDismissedKey, ng36SecretsKey, ng36SecretsEncryptedKey, ng36SecretsMetaKey, ng36PaneType, ng36DesktopOnly, ng36SecureStoreNative } from "./n-g36-support.js";
import { ng36RecentFileTracker } from "./n-g36-recent.js";
export const s29WorkspaceFileName = ng36WorkspaceFileName;
export const s29WorkspaceMobileFileName = ng36WorkspaceMobileFileName;
export const s29ReleaseNotesViewType = ng36ReleaseNotesViewType;
export const s29ReleaseNotesRepo = ng36ReleaseNotesRepo;
export const s29SecretsWarningDismissedKey = ng36SecretsWarningDismissedKey;
export const s29SecretsKey = ng36SecretsKey;
export const s29SecretsEncryptedKey = ng36SecretsEncryptedKey;
export const s29SecretsMetaKey = ng36SecretsMetaKey;
export const s29PaneType = ng36PaneType;
export const s29DesktopOnly = ng36DesktopOnly;
export const defineSecureStoreNative = ng36SecureStoreNative;
export const defineRecentFileTracker = ng36RecentFileTracker;
