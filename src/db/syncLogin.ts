import { connectStashSync, disconnectStashSyncAndWait, subscribeStashSyncStatus, type StashSyncStatus } from "./syncClient";
import { createSavedSyncLogin } from "./savedSyncLogin";
import { syncLoginStorage } from "./syncLoginStorage";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";

let clientStatus: StashSyncStatus = { phase: "stopped" };
const savedLogin = createSavedSyncLogin({
  storage: syncLoginStorage,
  disconnect: disconnectStashSyncAndWait,
  connect: async (login) => {
    await connectStashSync(login.serverUrl, { username: login.username, password: login.password });
    return clientStatus.account;
  },
});
let authenticationRejected = false;
subscribeStashSyncStatus((status) => {
  clientStatus = status;
  if (status.phase === "connecting") authenticationRejected = false;
  // Teardown metadata may republish the same rejected status. Forget once per attempt.
  if (status.authenticationRequired && !authenticationRejected) {
    authenticationRejected = true;
    savedLogin.authenticationRejected();
  }
});

// Keep the same Android dev/explicit opt-in gate at the actual entry points,
// including startup and direct routes. Bootstrap never prepares or seeds a DB.
export const subscribeSavedStashLogin = savedLogin.subscribe;
export function bootstrapSavedStashLogin() {
  return STASH_SYNC_DEV_TOOLS ? savedLogin.bootstrap() : Promise.resolve();
}
export function retrySavedStashLogin() {
  if (!STASH_SYNC_DEV_TOOLS) return Promise.reject(new Error("Sync is not enabled in this build."));
  return savedLogin.retry();
}
export function signInStashSync(serverUrl: string, username: string, password: string) {
  if (!STASH_SYNC_DEV_TOOLS) return Promise.reject(new Error("Sync is not enabled in this build."));
  return savedLogin.login(serverUrl, username, password);
}
export const forgetSavedStashLogin = savedLogin.forget;
