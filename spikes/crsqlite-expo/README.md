# Stash CR-SQLite / Expo feasibility spike

Disposable Android + Node slice. It does not change Stash production schema or data. The root workspace lock adds only spike dependencies; production app dependencies remain untouched.

## What it checks

- Expo SDK 55 can load the pinned CR-SQLite v0.16.3 Android binaries on x86_64 and arm64.
- Two independent Expo SQLite connections can exchange offline changes in-process.
- A persistent Node 24 server using the upstream `@vlcn.io/ws-server` package can exchange real WebSocket changes with the Expo Android app using `@vlcn.io/ws-client`.
- Independently written Android/server rows converge, reconnect/retry does not duplicate rows, and server data persists across process restart.
- The Android client can serialize its CR-SQLite database into a Stash-style ZIP, restore it over the local DB, retain CR-SQLite metadata, and resume syncing.
- A Node 24 SQLite peer can exchange changes and serialize/restore CRR data.

The complete Android flow has been runtime-tested on the x86_64 emulator: offline writes converged, reconnect stayed idempotent, server data survived a process restart, and ZIP backup/restore retained CR-SQLite metadata and resumed sync. The client explicitly calls `crsql_finalize()` before closing its SQLite handle; omitting that caused a native extension teardown crash during restore.

No Stash production migration, public listener, auth, iOS, or Pixel-device behavior is included. The app allows cleartext networking only for this local spike, and the server binds strictly to `127.0.0.1`.

## Build the Android app

From the Stash repo root (the build uses the repository's capped Gradle runner):

```sh
nix develop . --command bash -c '
  cd spikes/crsqlite-expo
  export ANDROID_HOME="$HOME/android-sdk" NODE_ENV=production
  ./scripts/prepare-android-crsqlite.sh
  ./scripts/build-android-x86_64-crsqlite.sh
  ../../node_modules/.bin/expo prebuild --platform android --clean
'
ANDROID_HOME="$HOME/android-sdk" NODE_ENV=production /home/beltino/beltino/scripts/build-capped.sh \
  "$PWD/spikes/crsqlite-expo" -- assembleRelease -PreactNativeArchitectures=x86_64
```

`prepare-android-crsqlite.sh` fetches the pinned upstream arm64 release library. The x86_64 builder compiles CR-SQLite v0.16.3 from its SHA-256-pinned npm source package using its upstream Makefile, Android NDK, Rust nightly, and Nix-provided build tools; no compiled binaries are committed. The Expo config plugin packages each prepared ABI under its matching `jniLibs` directory and enables cleartext networking for this test app only.

## Run the server and Android test

Install workspace dependencies once (the CR-SQLite Node installer needs `unzip`):

```sh
cd ~/projects/stash
nix develop . --command nix shell nixpkgs#unzip --command pnpm install --frozen-lockfile
```

Start the persistent server in one terminal:

```sh
cd ~/projects/stash
nix develop . --command pnpm --filter stash-crsqlite-server-spike start
```

The server is loopback-only at `http://127.0.0.1:8787`; its SQLite database persists under `spikes/crsqlite-expo/server/data/`. See [server/README.md](server/README.md) for reset/configuration details. On an Android emulator, forward the port (this retains the server's loopback-only bind):

```sh
nix develop . --command adb reverse tcp:8787 tcp:8787
nix develop . --command adb install -r spikes/crsqlite-expo/android/app/build/outputs/apk/release/app-release.apk
```

Open **CR-SQLite Android ↔ server spike**. Tap **Write server row (offline)**, then **Write Android row (offline)**, then **Connect + verify**. The screen reports convergence only when the server and Android both contain both rows. Disconnect/reconnect, and use **Backup ZIP → restore → reconnect** to check backup/restore and continued exchange. `/healthz`, `/test/offline-write`, and `/test/notes` are loopback-only test hooks, not production API endpoints.

## Test the host/server SQLite side

```sh
cd spikes/crsqlite-expo
./scripts/prepare-linux-peer.sh
node ./scripts/test-linux-peer.mjs
```

This validates bidirectional CR-SQLite change exchange and backup serialization in Node's SQLite implementation.

## Early schema finding / remaining gate

CR-SQLite v0.16.3 rejects CRR tables with a `NOT NULL` non-key column that has no default. The existing Stash schema has several such columns; those definitions need an intentional defaults/nullability migration or this choice needs revisiting. Before adopting CRRs, exercise the actual populated Stash DB/backup ZIP, settle field semantics and schema evolution, and validate the arm64 binary on a device. This feasibility slice does not test iOS or production migration. Do not enable CRRs in Stash's real database yet.
