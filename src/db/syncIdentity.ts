/** Shared by the network client and saved-login boundary; never accepts URL userinfo. */
export function normalizedBaseUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Sync server URL must start with https://");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Basic-auth credentials require HTTPS outside localhost");
  }
  if (url.username || url.password) throw new Error("Use a server URL without embedded credentials.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

export type SavedSyncLogin = { version: 1; serverUrl: string; username: string; password: string };
export type SyncAccount = Pick<SavedSyncLogin, "serverUrl" | "username">;

export function normalizeSyncLogin(value: unknown): SavedSyncLogin {
  if (!value || typeof value !== "object") throw new Error("Invalid saved sync login. Forget it and sign in again.");
  const record = value as Partial<SavedSyncLogin>;
  if (record.version !== 1 || typeof record.serverUrl !== "string" || typeof record.username !== "string" ||
      typeof record.password !== "string" || !record.username.trim() || !record.password || record.username.includes(":")) {
    throw new Error("Invalid sync login. Enter a username and password again.");
  }
  return { version: 1, serverUrl: normalizedBaseUrl(record.serverUrl).toString(), username: record.username.trim(), password: record.password };
}
