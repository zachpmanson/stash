# CR-SQLite Expo Android feasibility app

Disposable Android client for the sibling [`../server`](../server/README.md). This app has its own pnpm workspace/lockfile and Nix flake; work from this directory with `nix develop`. It does not change Stash production schema or data.

## What it checks

- Expo SDK 55 loads the pinned CR-SQLite v0.16.3 Android binaries on x86_64 and arm64.
- The reviewed Stash candidate DDL (mirrored from `../schemas/stash-sync-v1.sql`) opens all five replicated tables on Android, produces CR-SQLite changes and a delete tombstone, and passes SQLite integrity check in a fresh disposable DB. This is a schema/native-runtime smoke test, not the production migration or real-backup migration.
- Independent Expo SQLite connections exchange offline changes in-process.
- A persistent Node 24 server using upstream `@vlcn.io/ws-server` exchanges real WebSocket changes with the app via `@vlcn.io/ws-client`.
- Independently written Android/server rows converge; reconnect/retry does not duplicate rows; server data persists across restart.
- The Android client serializes its CR-SQLite database into a Stash-style ZIP, restores it, retains CR-SQLite metadata, and resumes syncing.
- A Node 24 SQLite peer exchanges changes and serializes/restores CRR data.

The full Android flow was runtime-tested on the x86_64 emulator. The client calls `crsql_finalize()` before closing its SQLite handle; omitting it caused a native extension teardown crash during restore. No production migration, iOS/Pixel validation, or app release is included.

The Expo app allows cleartext networking only for this disposable test. The service remains bound to `127.0.0.1`; Android emulator port forwarding is used for local testing. The Stash candidate schema smoke button is entirely local: it uses its own fresh database and never opens the Stash app database or contacts the server.

## Install and build

Install the app's isolated dependencies:

```sh
cd ~/projects/stash/spikes/crsqlite-expo/app
nix develop --command pnpm install --frozen-lockfile
```

Prepare pinned CR-SQLite binaries and prebuild Android:

```sh
cd ~/projects/stash/spikes/crsqlite-expo/app
nix develop --command bash -c '
  export NODE_ENV=production
  ./scripts/prepare-android-crsqlite.sh
  ./scripts/build-android-x86_64-crsqlite.sh
  ./node_modules/.bin/expo prebuild --platform android --clean
'
```

Build the x86_64 release APK with the shared capped Gradle runner:

```sh
cd ~/projects/stash/spikes/crsqlite-expo/app
NODE_ENV=production /home/beltino/beltino/scripts/build-capped.sh \
  "$PWD" -- assembleRelease -PreactNativeArchitectures=x86_64
```

`prepare-android-crsqlite.sh` fetches the pinned upstream arm64 release library. The x86_64 builder compiles CR-SQLite v0.16.3 from its SHA-256-pinned npm source using its upstream Makefile, Android NDK, Rust nightly, and Nix-provided tools. No compiled binaries are committed. The Expo config plugin packages each prepared ABI under its matching `jniLibs` directory.

## Test against Naboo

The app defaults to `https://stash.zachmanson.com`. The server is behind Caddy Basic auth; enter the configured username/password in the app. Credentials are kept in memory only, sent over HTTPS for both health and WebSocket handshakes, and are never bundled or persisted. The app rejects non-local HTTP URLs when credentials are present.

Install the debug APK, then open **CR-SQLite Android ↔ server spike**. Start with **Smoke-test Stash candidate schema (local only)** to test the candidate schema on-device without server access. For the separate network spike, write one offline row for each of the two independent local replicas, then tap **Connect + verify**. Both peers connect to Naboo with Basic auth; the app reports success only after the two rows converge on both local databases through the remote sync service. Disconnect/reconnect and use **Backup ZIP → restore → reconnect** to check backup/restore and continued exchange.

This test needs no server test endpoints: the second local replica is the observer. Naboo remains candidate-schema-only; its `/test/*` routes stay disabled. Use HTTPS for the public host. The app's candidate schema in `schema.ts` must remain identical to `../server/schema.ts`.

## Host/server SQLite check

```sh
cd ~/projects/stash/spikes/crsqlite-expo/app
./scripts/prepare-linux-peer.sh
nix develop --command node ./scripts/test-linux-peer.mjs
```

This validates bidirectional CR-SQLite exchange and backup serialization in Node's SQLite implementation.

## Production gate

CR-SQLite v0.16.3 rejects CRR tables with a `NOT NULL` non-key column that has no default. Existing Stash schema fields need intentional defaults/nullability decisions. Before adoption, exercise the populated Stash DB/backup ZIP, settle field semantics and schema evolution, and validate the arm64 binary on a device. Do not enable CRRs in Stash's real database yet.
