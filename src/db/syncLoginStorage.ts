import * as SecureStore from "expo-secure-store";
import { normalizeSyncLogin, type SavedSyncLogin } from "./syncIdentity";
import type { SyncLoginStorage } from "./savedSyncLogin";

const KEY = "stash.sync.login.v1";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "stash.sync.login",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

/** Native Keystore-encrypted preferences / Keychain only. No plaintext fallback. */
export const syncLoginStorage: SyncLoginStorage = {
  async read() {
    try {
      const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
      return raw === null ? null : normalizeSyncLogin(JSON.parse(raw));
    } catch { throw new Error("Could not read secure sync login storage."); }
  },
  async write(login: SavedSyncLogin) {
    try { await SecureStore.setItemAsync(KEY, JSON.stringify(normalizeSyncLogin(login)), OPTIONS); }
    catch { throw new Error("Could not save secure sync login storage."); }
  },
  async remove() {
    try { await SecureStore.deleteItemAsync(KEY, OPTIONS); }
    catch { throw new Error("Could not erase secure sync login storage."); }
  },
};
