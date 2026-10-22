import { normalizeSyncLogin, type SavedSyncLogin, type SyncAccount } from "./syncIdentity";

export type SavedLoginState = {
  busy: boolean;
  account?: SyncAccount;
  message?: string;
  /** Storage outcome is uncertain; offer Forget again, never claim it was erased. */
  storageError?: boolean;
};
export type SyncLoginStorage = {
  read: () => Promise<SavedSyncLogin | null>;
  write: (login: SavedSyncLogin) => Promise<void>;
  remove: () => Promise<void>;
};
type Dependencies = {
  storage: SyncLoginStorage;
  /** Returns only the identity established by the actual authenticated client. */
  connect: (login: SavedSyncLogin) => Promise<SyncAccount | undefined>;
  disconnect: () => Promise<void>;
};

/** Single process owner. Secrets never enter observable state. All storage is serialized;
 * cancellation advances immediately, before any asynchronous read/write/setup can finish.
 */
export function createSavedSyncLogin(deps: Dependencies) {
  let generation = 0;
  let bootstrapped = false;
  let queue: Promise<unknown> = Promise.resolve();
  let state: SavedLoginState = { busy: false };
  const listeners = new Set<(state: SavedLoginState) => void>();
  const publish = (next: SavedLoginState) => {
    state = next;
    for (const listener of listeners) {
      if (state !== next) break;
      try { listener(next); } catch { /* Observers cannot interrupt ownership. */ }
    }
  };
  const enqueue = (operation: () => Promise<void>) => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  // Attach a rejection handler immediately, including while waiting for queued storage.
  const stopNow = () => deps.disconnect().then(() => undefined, () => "Sync could not stop safely. Restart the app before reconnecting.");
  const remove = async () => {
    try { await deps.storage.remove(); }
    catch { throw new Error("Could not erase the saved login from secure storage. It may reconnect after restart. Try Forget saved login again."); }
  };
  const establish = async (login: SavedSyncLogin, token: number, save: boolean) => {
    const account = await deps.connect(login);
    if (token !== generation) return;
    if (!account || account.serverUrl !== login.serverUrl || account.username !== login.username) {
      throw new Error("Sync did not establish this account. Retry when the local replica is ready.");
    }
    if (save) {
      try { await deps.storage.write(login); }
      catch {
        if (token !== generation) return;
        publish({ busy: false, account, storageError: true, message: "Connected for this session, but saving the login could not be confirmed. Sign out to remove any saved copy." });
        throw new Error(state.message);
      }
    }
    if (token === generation) publish({ busy: false, account, message: "Login saved securely on this device." });
  };
  const reconnect = () => {
    if (state.busy) return queue;
    const token = ++generation;
    publish({ ...state, busy: true, message: "Reading saved login…" });
    return enqueue(async () => {
      if (token !== generation) return;
      let login: SavedSyncLogin | null;
      try { login = await deps.storage.read(); }
      catch {
        if (token !== generation) return;
        publish({ busy: false, storageError: true, message: "Could not read the saved login. Retry or forget it before signing in again." });
        throw new Error(state.message);
      }
      if (token !== generation) return;
      if (!login) { publish({ busy: false }); return; }
      const { serverUrl, username } = login;
      publish({ busy: true, account: { serverUrl, username }, message: "Reconnecting with saved login…" });
      try { await establish(login, token, false); }
      catch (error) {
        if (token !== generation) return;
        publish({ busy: false, account: { serverUrl, username }, message: "Saved login retained. Sync could not reconnect; check connectivity and replica preparation, then retry." });
        throw error;
      }
    });
  };
  const forget = (invalid = false) => {
    const token = ++generation;
    bootstrapped = true;
    const draining = stopNow();
    publish({ ...state, busy: true, message: invalid ? "Login rejected; forgetting saved credentials…" : "Signing out and forgetting saved login…" });
    return enqueue(async () => {
      let storageFailure: string | undefined;
      try { await remove(); } catch (error) { storageFailure = (error as Error).message; }
      const drainFailure = await draining;
      if (token !== generation) return;
      publish({ busy: false, ...(storageFailure ? { storageError: true } : {}), message: storageFailure ?? drainFailure ?? (invalid ? "Login rejected. Saved credentials cleared; sign in again." : "Signed out. Saved login forgotten.") });
      if (storageFailure || drainFailure) throw new Error(storageFailure ?? drainFailure);
    });
  };
  return {
    subscribe(listener: (state: SavedLoginState) => void) {
      listeners.add(listener); listener(state);
      return () => { listeners.delete(listener); };
    },
    bootstrap() {
      if (bootstrapped) return queue;
      bootstrapped = true;
      // Startup errors are represented in state; no unhandled rejection or auth retry timer.
      return reconnect().catch(() => {});
    },
    retry: reconnect,
    login(serverUrl: string, username: string, password: string) {
      const login = normalizeSyncLogin({ version: 1, serverUrl, username, password });
      const token = ++generation;
      bootstrapped = true;
      const draining = stopNow();
      publish({ busy: true, message: "Signing in…" });
      return enqueue(async () => {
        try {
          const drainFailure = await draining;
          if (token !== generation) return;
          if (drainFailure) throw new Error(drainFailure);
          // A replacement must never leave the previous account reconnectable on disk.
          try { await remove(); }
          catch (error) {
            if (token === generation) publish({ busy: false, storageError: true, message: (error as Error).message });
            throw error;
          }
          if (token !== generation) return;
          await establish(login, token, true);
        } catch (error) {
          if (token !== generation) return;
          if (state.busy) publish({ busy: false, message: "Sign in did not complete. No verified login was saved." });
          throw error;
        }
      });
    },
    forget: () => forget(),
    authenticationRejected: () => { void forget(true).catch(() => {}); },
  };
}
