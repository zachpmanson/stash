# Stash CR-SQLite / Expo feasibility spike

Disposable Android-only slice; it does not change Stash's production database, app configuration, or dependency lockfile.

## What it checks

- Expo SDK 55's existing `expo-sqlite.loadExtensionAsync` API can be built into Android arm64 and x86_64 APKs with CR-SQLite native libraries.
- On-device, two independent Expo SQLite connections can each write offline, exchange `crsql_changes` rows, and converge.
- On-device, Stash's current `serializeAsync` database-backup primitive preserves CRR rows/schema metadata through serialization and restore.
- On the host/server side, a Node 24 `node:sqlite` process can load the upstream Linux x86_64 build, exchange changes between independent SQLite databases, and serialize/restore CRR data.

The native client test is an in-process exchange between two SQLite connections, not the eventual HTTP/WebSocket transport. No transport, auth, or production migration is included.

## Build the Android app

From the Stash repo root (the build uses the repository's capped Gradle runner):

```sh
nix develop . --command bash -c '
  cd spikes/crsqlite-expo
  ./scripts/prepare-android-crsqlite.sh
  ./scripts/build-android-x86_64-crsqlite.sh
  ANDROID_HOME="$HOME/android-sdk" NODE_ENV=production ../../node_modules/.bin/expo prebuild --platform android --clean
'
ANDROID_HOME="$HOME/android-sdk" /home/beltino/beltino/scripts/build-capped.sh \
  "$PWD/spikes/crsqlite-expo" -- assembleRelease -PreactNativeArchitectures=x86_64
```

`prepare-android-crsqlite.sh` fetches the pinned upstream arm64 release library. The x86_64 builder compiles CR-SQLite v0.16.3 from its SHA-256-pinned npm source package using its upstream Makefile, Android NDK, Rust nightly, and Nix-provided build tools; no compiled binaries are committed. The Expo config plugin packages each prepared ABI under its matching `jniLibs` directory.

Install the resulting `spikes/crsqlite-expo/android/app/build/outputs/apk/release/app-release.apk` on an x86_64 Android emulator. Open **CR-SQLite Expo Spike** and tap **Run spike**. Verified on the local Android 35 x86_64 AVD: extension load passed; the independent Expo SQLite connections converged on both offline-written rows; serialize/restore preserved the rows and four CR-SQLite schema objects. The Pixel is not required for this first runtime proof.

## Test the host/server SQLite side

Requires Node 24 and the project's devshell:

```sh
cd spikes/crsqlite-expo
./scripts/prepare-linux-peer.sh
node ./scripts/test-linux-peer.mjs
```

This validates bidirectional CR-SQLite change exchange and backup serialization in Node's SQLite implementation, not Expo/Android-to-server wire transport.

## Early schema finding / remaining gate

CR-SQLite v0.16.3 rejects CRR tables with a `NOT NULL` non-key column that has no default. The existing Stash schema has several such columns; those definitions need an intentional defaults/nullability migration or this choice needs revisiting. Before adopting CRRs, exercise the actual populated Stash DB/backup ZIP, settle field semantics and schema evolution, and validate the arm64 binary on a device. This slice does not test transport/auth, iOS, or production migration. Do not enable CRRs in Stash's real database yet.
