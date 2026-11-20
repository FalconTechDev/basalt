// g32 clean-room: policy gates for the mobile feedback banner.
import { ng32MobileFeedbackFlag } from "./n-g32-constants.js";

const NG32_MIN_FILES = 50;
const NG32_MIN_AGE_MS = 15552e6;

export async function ng32FeedbackShouldShow(app, host) {
  if (host.s16DevBuild) return true;
  if (!navigator.onLine) return false;
  if (localStorage.getItem(ng32MobileFeedbackFlag)) return false;
  const licensed = host.s16License.license
    || app.internalPlugins.getEnabledPluginById("sync")?.getRemoteVaultId();
  if (!licensed) return false;
  if (host.Platform.isIosApp && !(await host.capacitorApp.isInstalledFromStore())) return false;
  if (app.vault.getRoot().getFileCount() < NG32_MIN_FILES) return false;
  const stat = await app.vault.adapter.stat(app.vault.configDir);
  return Date.now() - stat.ctime >= NG32_MIN_AGE_MS;
}
