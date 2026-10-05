# Stash CR-SQLite WebSocket service foundation

This isolated Node 24/TypeScript service exercises upstream `@vlcn.io/ws-server` with CR-SQLite 0.16.3 and the disposable `notes` candidate schema. It is **not connected to Stash's production schema/database or app lifecycle**. Keep app rollout, schema migration, and media sync gated under [zpm/stash#26](https://github.com/zachpmanson/stash/issues/26).

## Trust boundary

- The listener is fixed to `127.0.0.1`; there is no bind-address override or firewall listener. Naboo Caddy is the only ingress.
- Caddy requires its existing Basic-auth identity and overwrites `X-Auth-User` with the configured single-tenant `zach` identity; no client-supplied value is trusted. The WebSocket upgrade callback accepts only the configured `AUTH_USER` (default `zach`). The same Caddy route covers HTTP and WebSocket requests.
- The service cannot authenticate a direct-origin client that can reach loopback and forge the header. That is why it must remain loopback-only, with Caddy proxying to it on the same host. Never change the bind address or expose this port directly.
- `ENABLE_TEST_ENDPOINTS=1` exposes disposable offline-write/inspection HTTP hooks. It is disabled by default and must not be set in deployment.

Malformed WebSocket handshakes are rejected with HTTP 400 instead of throwing through the upstream upgrade handler. The automated lifecycle test verifies that malformed requests do not take down the service, rejects a valid upgrade without `X-Auth-User` (HTTP 401), accepts one with the stamped identity, and exercises an active connection during shutdown. It also backs up/restores a CR-SQLite database and verifies persistence after restart.

## Runtime configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | TCP port; validated as 1–65535 |
| `DATA_DIR` | `./data` | Persistent directory containing `stash-spike.sqlite` |
| `SCHEMA_DIR` | `./schemas` | Server schema directory (the pinned candidate schema is written at startup) |
| `AUTH_USER` | `zach` | Exact Caddy-stamped `X-Auth-User` allowed to upgrade |
| `ENABLE_TEST_ENDPOINTS` | unset | Set to `1` only for local integration tests |

Startup creates/validates the database before opening the listener: schema name/version, required candidate CRR table, and SQLite `integrity_check`. `/healthz` reports readiness and the schema version. Logs are newline-delimited JSON; the upstream websocket library may also emit its own logs.

## Local development and tests

Install workspace dependencies from this server directory using its own flake (the devshell includes `unzip`):

```sh
cd ~/projects/stash/spikes/crsqlite-expo/server
nix develop --command pnpm install --frozen-lockfile
```

Build the isolated x86_64 Linux service package used by Naboo:

```sh
nix build .#packages.x86_64-linux.crsqlite-sync
```

Run static checking and the auth/restart/backup test:

```sh
nix develop --command pnpm typecheck
nix develop --command pnpm test
```

For the end-to-end Android flow, see [`../app/README.md`](../app/README.md). The normal test endpoints remain disabled unless explicitly opted in; do not use them as a product API.

## Backup, restore, and reset

**Stop the service before backup, restore, or reset.** The helper uses SQLite's online backup API and checks SQLite integrity, CR-SQLite schema identity/version, and CRR metadata in both the produced backup and restore source:

```sh
cd ~/projects/stash/spikes/crsqlite-expo/server
nix develop --command pnpm db backup /safe/path/stash-sync.sqlite
nix develop --command pnpm db restore /safe/path/stash-sync.sqlite
```

Restore first makes a timestamped rollback backup of the current database, validates the selected backup, then atomically replaces the live database and removes stale WAL/SHM sidecars. Keep the rollback file until the service has restarted and health/data checks pass. To reset only the disposable peer, stop the service and remove `spikes/crsqlite-expo/server/data/`; the next startup creates an empty database from the candidate schema. Never point this service at Stash's production database.

## Active-client shutdown

The upstream `@vlcn.io/ws-server@0.2.3` installs a SIGINT handler that destroys its DB cache before active WebSocket peers release references. Its upgrade handler also throws on malformed/missing `Sec-WebSocket-Protocol` headers; the local patch turns those into HTTP 400 responses. Its outbound stream also leaves retry timers running on close, and its filesystem watcher shutdown did not expose/await the underlying close. A narrow local patch cancels those timers and returns the watcher-close promise. This service removes only the upstream SIGINT listener and uses ordered SIGINT/SIGTERM shutdown: stop accepting connections, destroy active sockets, wait for connection handlers, then destroy the database cache and await the filesystem watcher. The upstream watcher/debounce stack still leaves timer handles after close, so after all data-bearing resources are drained the service flushes its logs and exits explicitly. The automated test sends a real `AnnouncePresence` over an authenticated WebSocket (holding the server DB cache reference), stops under SIGTERM, and verifies persistence/backup/restore/restart.

## Dependency/runtime notes

The server uses Node 24, `@vlcn.io/ws-server@0.2.3`, `@vlcn.io/ws-common@0.2.0`, and `@vlcn.io/crsqlite@0.16.3`. The CR-SQLite package's Node 24 JSON-module compatibility adjustment is maintained as a small local patch. `better-sqlite3@12.6.2` is pinned because the older version requested upstream does not compile on Node 24.
